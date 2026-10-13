"""First-run configuration, isolated provider probes and resumable preparation.

The managed installation owns setup.json; source checkout .env files are never
modified. Probe receipts bind a successful test to the exact draft and expire.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from threading import RLock

from app.core.runtime_paths import PROVIDER_FIELDS, state_dir
from app.core.storage_health import StorageUnavailable, check_storage, storage_failure
from app.core.model_preparation import observe_preparation, report_preparation, model_failure
from app.core.logger import get_logger

logger = get_logger(__name__)

CAPABILITIES = ("text", "image", "audio", "video")
REQUIRED_MODELS = {"text": ("bge_m3",), "image": ("bge_m3", "clip"), "audio": ("bge_m3", "clap"), "video": ("bge_m3", "clip", "clap")}
BASE_TASKS = ("final_generation", "intent_recognition", "query_rewriting", "document_chunking", "suggestion_generation", "kb_portrait_generation", "embedding", "reranking")
MEDIA_TASKS = {"image": ("image_captioning",), "audio": ("audio_transcription",), "video": ("video_parsing", "image_captioning", "audio_transcription")}


def atomic_private_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def required_local_models(capabilities: list[str]) -> list[str]:
    return list(dict.fromkeys(model for capability in capabilities for model in REQUIRED_MODELS[capability]))


def _assert_embedding_change_safe() -> None:
    """Changing vector spaces requires a new empty store, even at equal dimensions."""
    from app.core.config import settings
    from qdrant_client import QdrantClient
    client = QdrantClient(**settings.get_qdrant_config(), https=False, timeout=5)
    try:
        for row in client.get_collections().collections:
            if (client.get_collection(row.name).points_count or 0) > 0:
                raise ValueError("现有知识库已包含向量，不能直接更换 Embedding 模型。请保留当前模型或使用新的数据目录。")
    except ValueError:
        raise
    except Exception:
        raise ValueError("无法确认现有向量索引是否为空，暂不更换 Embedding 模型；请检查存储服务。") from None
    finally:
        client.close()


def _prepare_storage() -> None:
    for row in check_storage()["checks"]:
        if not row["success"]:
            raise StorageUnavailable(row)
    from app.modules.ingestion.storage.vector_store import VectorStore
    store = None
    try:
        # Run once, whether credentials were just saved or loaded on restart.
        store = VectorStore(initialize_collections=False)
        store._ensure_collections(strict=True)
        present = {row.name for row in store.client.get_collections().collections}
        if not set(store.collections).issubset(present):
            raise RuntimeError("Required retrieval collections are unavailable")
    except Exception as error:
        raise StorageUnavailable(storage_failure("qdrant", error)) from None
    finally:
        if store is not None:
            store.client.close()


def _model_artifacts(name: str) -> list[dict]:
    from app.core.config import settings
    from app.core.local_models import CLIP_MODEL_ID, CLAP_MODEL_ID
    from huggingface_hub import snapshot_download
    model_id = {"bge_m3": settings.bge_m3_model_id, "clip": CLIP_MODEL_ID, "clap": CLAP_MODEL_ID}[name]
    local = Path(model_id).expanduser()
    snapshot = local if local.is_dir() else Path(snapshot_download(repo_id=model_id, local_files_only=True))
    artifacts = [{"path": str(path.absolute()), "size": path.stat().st_size} for path in snapshot.rglob("*") if path.is_file()]
    if not artifacts or not any(row["path"].endswith((".safetensors", ".bin", ".pt")) for row in artifacts):
        raise RuntimeError("Model cache has no verified weight files")
    return artifacts


def _artifacts_ready(row: dict) -> bool:
    if row.get("state") != "ready" or not row.get("artifacts"):
        return False
    try:
        return all(Path(item["path"]).is_file() and Path(item["path"]).stat().st_size == item["size"] for item in row["artifacts"])
    except (KeyError, OSError, TypeError):
        return False


def _warm_model(name: str) -> dict:
    # Preparation verifies durable cache, not the API process's model residency.
    # Temporary instances avoid retaining a second BGE copy beside the worker.
    import gc
    runtime = None
    try:
        report_preparation("load")  # Includes first import of the model runtime.
        if name == "bge_m3":
            from app.core.config import settings
            from app.core.sparse_encoder import BGEM3SparseEncoder
            runtime = BGEM3SparseEncoder(settings.bge_m3_model_id, settings.bge_m3_use_fp16)
            result = runtime.encode_query("Tessmora 文档检索准备")
            if not result.get("sparse"):
                raise RuntimeError("Sparse encoder did not return a nonempty vector")
        else:
            from app.core.local_models import LocalModelRuntime
            runtime = LocalModelRuntime()
            getattr(runtime, f"warmup_{name}")()
        report_preparation("artifacts")
        return {"artifacts": _model_artifacts(name)}
    finally:
        runtime = None
        gc.collect()


def _warm_model_observed(name: str, callback) -> dict:
    with observe_preparation(callback):
        return _warm_model(name)


async def _tool_probe(provider, *, provider_name: str, model: str, raw_model: str) -> dict:
    """Check the tools protocol used by Pi using harmless synthetic arguments."""
    import httpx
    from app.core.llm.connection_probe import safe_error_code, ERROR_MESSAGES
    result = {"provider": provider_name, "model": model, "capability": "tools", "success": False, "duration_ms": 0}
    started = time.perf_counter()
    if not provider or not getattr(provider, "api_key", ""):
        return {**result, "error_code": "missing_key", "message": ERROR_MESSAGES["missing_key"]}
    payload = {"model": raw_model, "messages": [{"role": "user", "content": "Call tessmora_ping with value ok."}],
               "tools": [{"type": "function", "function": {"name": "tessmora_ping", "description": "Test connection", "parameters": {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]}}}],
               "tool_choice": {"type": "function", "function": {"name": "tessmora_ping"}}, "max_tokens": 128}
    if provider_name in {"deepseek", "aliyun_bailian"}:
        payload["thinking" if provider_name == "deepseek" else "enable_thinking"] = {"type": "disabled"} if provider_name == "deepseek" else False
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{provider.base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {provider.api_key}"}, json=payload)
            response.raise_for_status()
            calls = response.json()["choices"][0]["message"]["tool_calls"]
            assert calls and calls[0]["function"]["name"] == "tessmora_ping"
            assert json.loads(calls[0]["function"]["arguments"]).get("value") == "ok"
        return {**result, "success": True, "message": "Pi 工具调用协议测试通过", "duration_ms": round((time.perf_counter() - started) * 1000)}
    except Exception as exc:
        code = safe_error_code(exc)
        return {**result, "error_code": code, "message": ERROR_MESSAGES[code], "duration_ms": round((time.perf_counter() - started) * 1000)}


class SetupService:
    def __init__(self, root: Path | None = None, *, recover_preparation: bool = True):
        self.root = root if root is not None else state_dir()
        self._lock = RLock()
        self._save_lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._receipts: dict[str, tuple[str, float]] = {}
        self._retired_providers = []
        self._progress = self._read("prepare.json", {"state": "idle", "models": {}, "completed": 0, "total": 0})
        if recover_preparation and self._progress.get("state") == "running":
            self._progress["state"] = "interrupted"
            for row in self._progress.get("models", {}).values():
                if row.get("state") == "running":
                    row.update(state="interrupted", message="准备被中断；再次准备将复用已下载的缓存。")
            self._persist_progress()

    def _read(self, name: str, default: dict) -> dict:
        path = self.root / name if self.root else None
        return json.loads(path.read_text(encoding="utf-8")) if path and path.exists() else default

    def _config(self) -> dict:
        return self._read("setup.json", {"version": 1, "capabilities": ["text"], "credentials": {}, "task_models": {}})

    def _persist_progress(self) -> None:
        if self.root:
            atomic_private_json(self.root / "prepare.json", self._progress)

    def progress(self) -> dict:
        with self._lock:
            result = json.loads(json.dumps(self._progress))
        for row in result.get("models", {}).values():
            row.pop("artifacts", None)
            if row.get("started_at"):
                row["elapsed_seconds"] = round(max(0, row.get("finished_at", time.time()) - row["started_at"]), 1)
            if row.get("state") == "running" and row.get("updated_at"):
                row["idle_seconds"] = round(max(0, time.time() - row["updated_at"]), 1)
        if result.get("state") == "running":
            result["elapsed_seconds"] = round(time.time() - result.get("started_at", time.time()), 1)
        return result

    def _draft(self, changes: dict) -> dict:
        from app.core.config import settings
        from app.core.llm.manager import llm_manager
        saved = self._config()
        credentials = {name: getattr(settings, field, None) or "" for name, field in PROVIDER_FIELDS.items()}
        credentials.update(saved.get("credentials", {}))
        credentials.update(changes.get("credentials") or {})
        routes = {task: llm_manager.registry.get_task_model(task) for task in llm_manager.registry._task_config}
        routes.update(changes.get("task_models") or {})
        return {"version": 1, "capabilities": changes.get("capabilities") or saved.get("capabilities", ["text"]), "credentials": credentials, "task_models": routes}

    @staticmethod
    def _fingerprint(draft: dict) -> str:
        from app.modules.pi_agent.config import get_pi_settings
        pi = get_pi_settings()
        payload = {key: draft[key] for key in ("capabilities", "credentials", "task_models")}
        payload["pi"] = {"enabled": pi.enabled, "model": pi.model, "embedding": pi.embedding_model,
                         "vision": pi.vision_model, "audio": pi.audio_model, "base_url": pi.model_base_url,
                         "key": pi.model_api_key.get_secret_value() if pi.model_api_key else None}
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def _registry(self, draft: dict):
        from app.core.config import settings
        from app.core.llm import LLMRegistry
        override = settings.model_copy(update={PROVIDER_FIELDS[name]: value for name, value in draft["credentials"].items()})
        registry = LLMRegistry(settings_override=override)
        # Keep dynamically discovered catalog entries while using fresh clients.
        from app.core.llm.manager import llm_manager
        registry._models.update(llm_manager.registry._models)
        from app.core.llm import TASK_MODEL_TYPES
        for task, model in draft["task_models"].items():
            original = llm_manager.registry.get_task_model(task)
            if task not in registry._task_config:
                raise ValueError(f"未知任务类型: {task}")
            if model != original:
                config = registry.get_model_config(model)
                if model not in registry._models or TASK_MODEL_TYPES[task] not in str(config.get("type", "")).split(","):
                    raise ValueError(f"模型不可用于任务 {task}: {model}")
                if task == "video_parsing" and (config.get("provider") != "aliyun_bailian" or "omni" not in model.lower()):
                    raise ValueError("视频解析需要支持本地视频的百炼 Omni 模型")
            registry._task_config[task]["model"] = model
            registry._task_routing[task] = model
        return registry

    @staticmethod
    def _plan(registry, capabilities: list[str]) -> list[dict]:
        from app.core.llm import TASK_MODEL_TYPES
        tasks = list(BASE_TASKS)
        for capability in capabilities:
            tasks.extend(MEDIA_TASKS.get(capability, ()))
        entries = []
        seen = set()
        for task in tasks:
            model = registry.get_task_model(task)
            config = registry.get_model_config(model or "")
            provider = config.get("provider", model.split(":", 1)[0] if model and ":" in model else "siliconflow")
            capability = TASK_MODEL_TYPES[task]
            if (model, capability) not in seen:
                entries.append({"provider": provider, "model": model, "capability": capability, "task": task})
                seen.add((model, capability))
        from app.modules.pi_agent.config import get_pi_settings
        pi = get_pi_settings()
        if pi.enabled:
            pi_checks = [(pi.model, "tools", "pi_agent"), (pi.embedding_model, "embedding", "pi_embedding")]
            if any(kind in capabilities for kind in ("image", "video")):
                pi_checks.append((pi.vision_model, "vision", "pi_vision"))
            if any(kind in capabilities for kind in ("audio", "video")):
                pi_checks.append((pi.audio_model, "audio", "pi_audio"))
            for model, capability, task in pi_checks:
                if (model, capability) in seen:
                    continue
                config = registry.get_model_config(model)
                entries.append({"provider": config.get("provider", model.split(":", 1)[0] if ":" in model else "siliconflow"), "model": model, "capability": capability, "task": task})
                seen.add((model, capability))
        return entries

    def status(self) -> dict:
        from app.core.llm.manager import llm_manager
        from app.core.config import settings
        draft = self._draft({})
        saved = self._config()
        registry = llm_manager.registry
        plan = self._plan(registry, draft["capabilities"])
        providers = {name: {"configured": bool(draft["credentials"].get(name))} for name in PROVIDER_FIELDS}
        from app.modules.pi_agent.config import get_pi_settings
        pi = get_pi_settings()
        configured = all((row["task"] == "pi_agent" and bool(pi.model_api_key)) or providers.get(row["provider"], {}).get("configured", False) for row in plan)
        fingerprint = self._fingerprint(draft)
        tested = bool(saved.get("tested_fingerprint") and hmac.compare_digest(saved["tested_fingerprint"], fingerprint))
        required = required_local_models(draft["capabilities"])
        progress = self.progress()
        prepared = all(_artifacts_ready(self._progress.get("models", {}).get(model, {})) for model in required)
        preparation_blocked = progress.get("state") in {"running", "error", "interrupted"}
        ready = configured and tested and prepared and not preparation_blocked
        return {"managed": bool(self.root), "setup_required": bool(self.root) and (not saved.get("completed_at") or not configured or not prepared or preparation_blocked),
                "onboarding_complete": bool(saved.get("completed_at")),
                "configured": configured, "tested": tested, "prepared": prepared, "ready": ready,
                "capabilities": draft["capabilities"], "providers": providers, "task_models": draft["task_models"],
                "required_local_models": required, "checks": plan, "progress": progress,
                "capability_checks": {kind: self._plan(registry, list(dict.fromkeys(["text", kind]))) for kind in CAPABILITIES},
                "pi_models": {"enabled": pi.enabled, "chat": pi.model, "embedding": pi.embedding_model, "vision": pi.vision_model, "audio": pi.audio_model},
                "configured_at": saved.get("configured_at"), "tested_at": saved.get("tested_at"),
                "models": [{"id": model, "provider": registry.get_model_config(model).get("provider"),
                            "type": registry.get_model_config(model).get("type")}
                           for model in registry.list_models()]}

    async def _validate_embedding_change(self, draft: dict) -> None:
        from app.core.llm.manager import llm_manager
        if draft["task_models"].get("embedding") != llm_manager.registry.get_task_model("embedding"):
            await asyncio.to_thread(_assert_embedding_change_safe)

    async def test(self, changes: dict) -> dict:
        from app.core.llm.connection_probe import run_probe
        draft = self._draft(changes)
        await self._validate_embedding_change(draft)
        registry = self._registry(draft)
        results = []
        try:
            for row in self._plan(registry, draft["capabilities"]):
                provider = registry.get_provider(row["provider"])
                if row["capability"] == "tools":
                    from app.modules.pi_agent.config import get_pi_settings
                    from types import SimpleNamespace
                    pi = get_pi_settings()
                    if pi.model_api_key or pi.model_base_url:
                        provider = SimpleNamespace(api_key=pi.model_api_key.get_secret_value() if pi.model_api_key else getattr(provider, "api_key", ""), base_url=pi.model_base_url or getattr(provider, "base_url", ""))
                    result = await _tool_probe(provider, provider_name=row["provider"], model=row["model"], raw_model=registry.get_raw_model_name(row["model"]))
                else:
                    result = await run_probe(provider, provider=row["provider"], model=row["model"], raw_model=registry.get_raw_model_name(row["model"]), capability=row["capability"])
                results.append({**result, "task": row["task"]})
        finally:
            for provider in registry._providers.values():
                close = getattr(provider, "close", None)
                if close:
                    await close()
        success = bool(results) and all(row["success"] for row in results)
        receipt = secrets.token_urlsafe(32) if success else None
        self._receipts = {key: value for key, value in self._receipts.items() if value[1] > time.time()}
        if receipt:
            self._receipts[receipt] = (self._fingerprint(draft), time.time() + 1800)
        return {"success": success, "results": results, "test_receipt": receipt}

    async def save(self, changes: dict) -> dict:
        async with self._save_lock:
            return await self._save(changes)

    async def _save(self, changes: dict) -> dict:
        if not self.root:
            raise ValueError("配置写入需要 TESSMORA_STATE_DIR；源码安装的 .env 保持不变。")
        draft = self._draft(changes)
        await self._validate_embedding_change(draft)
        # Rebase omitted fields after a potentially asynchronous storage check.
        draft = self._draft(changes)
        old = self._config()
        fingerprint = self._fingerprint(draft)
        tested = old.get("tested_fingerprint") == fingerprint
        receipt = changes.get("test_receipt")
        if receipt:
            proof = self._receipts.get(receipt)
            if not proof or proof[1] < time.time() or not hmac.compare_digest(proof[0], fingerprint):
                raise ValueError("连接测试结果已过期或配置已改变，请重新测试。")
            tested = True
        registry = self._registry(draft)  # Validate before touching disk/settings.
        if old.get("completed_at"):
            draft["completed_at"] = old["completed_at"]
        draft["configured_at"] = time.time()
        if tested:
            draft.update(tested_fingerprint=fingerprint, tested_at=time.time() if receipt else old.get("tested_at"))
            if self._progress.get("state") not in {"running", "error", "interrupted"} and all(_artifacts_ready(self._progress.get("models", {}).get(name, {})) for name in required_local_models(draft["capabilities"])):
                draft["completed_at"] = draft.get("completed_at", time.time())
        atomic_private_json(self.root / "setup.json", draft)
        from app.core.config import settings
        from app.core.llm.manager import llm_manager
        for name, field in PROVIDER_FIELDS.items():
            setattr(settings, field, draft["credentials"][name])
        # Existing requests retain their provider object; future calls use the
        # new clients. Keep the registry identity used by catalog/health workers.
        current = llm_manager.registry
        self._retired_providers.extend(current._providers.values())
        current._providers = registry._providers
        current._models = registry._models
        current._task_config = registry._task_config
        current._task_routing = registry._task_routing
        current.model_health = registry.model_health
        for provider in current._providers.values():
            if hasattr(provider, "set_registry"):
                provider.set_registry(current)
        # Existing Settings screen and setup share precisely the same overrides.
        current._write_task_overrides(draft["task_models"])
        return self.status()

    def refresh_worker_config(self) -> None:
        """Called before each Celery task; workers share the API's config volume."""
        if not self.root:
            return
        path = self.root / "setup.json"
        if not path.exists():
            return
        from app.core.runtime_paths import backend_data_dir
        routes_path = backend_data_dir() / "llm_task_overrides.json"
        stamp = (path.stat().st_mtime_ns, routes_path.stat().st_mtime_ns if routes_path.exists() else None)
        if getattr(self, "_worker_config_stamp", None) == stamp:
            return
        from app.core.config import settings
        from app.core.llm import LLMRegistry
        from app.core.llm.manager import llm_manager
        saved = self._config()
        for name, field in PROVIDER_FIELDS.items():
            if name in saved.get("credentials", {}):
                setattr(settings, field, saved["credentials"][name])
        replacement = LLMRegistry()
        current = llm_manager.registry
        self._retired_providers.extend(current._providers.values())
        for attr in ("_providers", "_models", "_task_config", "_task_routing", "model_health"):
            setattr(current, attr, getattr(replacement, attr))
        for provider in current._providers.values():
            if hasattr(provider, "set_registry"):
                provider.set_registry(current)
        self._worker_config_stamp = stamp

    async def prepare(self, capabilities: list[str] | None = None) -> dict:
        if not self.root:
            raise ValueError("模型准备需要 TESSMORA_STATE_DIR。")
        selected = self._config().get("capabilities", ["text"])
        if capabilities and capabilities != selected:
            raise ValueError("请先保存使用能力，再准备对应模型。")
        if self._task and not self._task.done():
            return self.progress()
        required = required_local_models(selected)
        with self._lock:
            previous = self._progress.get("models", {})
            models = {name: previous[name] if _artifacts_ready(previous.get(name, {})) else {"state": "pending", "message": "等待准备"} for name in required}
            self._progress = {"state": "running", "stage": "storage", "message": "检查 Qdrant 与 MinIO，准备检索集合", "models": models, "completed": sum(row["state"] == "ready" for row in models.values()), "total": len(required), "started_at": time.time()}
            self._persist_progress()
        self._task = asyncio.create_task(self._prepare(required), name="tessmora-model-setup")
        return self.progress()

    def _model_event(self, name: str, row: dict, event: dict) -> None:
        with self._lock:
            # A cancelled background thread must not update a later attempt.
            if self._progress.get("state") != "running" or self._progress["models"].get(name) is not row or row["state"] != "running":
                return
            if all(row.get(key) == value for key, value in event.items()):
                return
            if row.get("phase") != event["phase"]:
                for key in ("downloaded_bytes", "total_bytes", "files_completed", "files_total"):
                    row.pop(key, None)
                logger.info("Model preparation: model={} phase={}", name, event["phase"])
            row.update(**event, updated_at=time.time())
            self._persist_progress()

    async def _prepare(self, names: list[str]) -> None:
        try:
            try:
                await asyncio.to_thread(_prepare_storage)
            except Exception as exc:
                with self._lock:
                    detail = exc.detail if isinstance(exc, StorageUnavailable) else None
                    self._progress.update(state="error", error_code="STORAGE_UNAVAILABLE", error_type=type(exc).__name__,
                                          message=detail["message"] if detail else "存储初始化失败，请运行 tessmora doctor 检查。")
                    if detail:
                        self._progress.update(storage=detail, hint=detail["hint"], error_type=detail["error_type"])
                    self._persist_progress()
                return
            with self._lock:
                self._progress.update(stage="models", message="存储已就绪，开始准备本地模型")
                self._persist_progress()
            for name in names:
                if self._progress["models"][name]["state"] == "ready":
                    continue
                with self._lock:
                    row = {"state": "running", "phase": "cache", "message": "检查本地模型缓存", "started_at": time.time(), "updated_at": time.time()}
                    self._progress["models"][name] = row
                    self._persist_progress()
                try:
                    evidence = await asyncio.to_thread(_warm_model_observed, name, lambda event: self._model_event(name, row, event))
                except Exception as exc:
                    with self._lock:
                        detail = model_failure(exc, row.get("phase", "cache"))
                        row.update(state="error", finished_at=time.time(), **detail)
                        self._progress.update(state="error", message=detail["message"], error_code=detail["error_code"], hint=detail["hint"], finished_at=time.time())
                        logger.error("Model preparation failed: model={} phase={} code={} error_type={} causes={} http_status={}",
                                     name, detail["phase"], detail["error_code"], detail["error_type"], detail["causes"], detail.get("http_status"))
                        self._persist_progress()
                    return
                with self._lock:
                    self._progress["models"][name].update(state="ready", message="模型已通过真实推理验证", finished_at=time.time(), **(evidence or {}))
                    logger.info("Model preparation ready: model={}", name)
                    self._progress["completed"] += 1
                    self._persist_progress()
            with self._lock:
                self._progress.update(state="ready", stage="complete", message="所选能力已就绪", finished_at=time.time())
                self._persist_progress()
            if self.status()["ready"]:
                saved = self._config()
                saved["completed_at"] = saved.get("completed_at", time.time())
                atomic_private_json(self.root / "setup.json", saved)
        except asyncio.CancelledError:
            with self._lock:
                self._progress["state"] = "interrupted"
                for row in self._progress["models"].values():
                    if row["state"] == "running":
                        row.update(state="interrupted", message="准备被中断；重启后可继续。")
                self._persist_progress()
            raise

    async def shutdown(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        for provider in self._retired_providers:
            close = getattr(provider, "close", None)
            if close:
                await close()
        self._retired_providers.clear()


_service: SetupService | None = None


def get_setup_service(*, recover_preparation: bool = True) -> SetupService:
    global _service
    if _service is None:
        _service = SetupService(recover_preparation=recover_preparation)
    return _service
