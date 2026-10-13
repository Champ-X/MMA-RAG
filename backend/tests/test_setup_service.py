"""Managed onboarding contracts without touching developer credentials/storage."""
import asyncio
import json
import stat
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import setup_service
from app.core.runtime_paths import PROVIDER_FIELDS


@pytest.mark.parametrize("fail", [False, True])
def test_prepare_bge_uses_temporary_instance_released_after_inference(tmp_path, monkeypatch, fail):
    import weakref
    from app.core import sparse_encoder
    references = []

    class TemporaryEncoder:
        def __init__(self, *args):
            references.append(weakref.ref(self))

        def encode_query(self, text):
            return {} if fail else {"sparse": {42: 0.7}}

    monkeypatch.setattr(sparse_encoder, "BGEM3SparseEncoder", TemporaryEncoder)
    monkeypatch.setattr(sparse_encoder, "get_sparse_encoder", lambda: pytest.fail("prepare must not retain the shared inference model"))
    monkeypatch.setattr(setup_service, "_model_artifacts", lambda name: [{"path": "synthetic", "size": 1}])
    if fail:
        with pytest.raises(RuntimeError, match="nonempty"):
            setup_service._warm_model("bge_m3")
    else:
        assert setup_service._warm_model("bge_m3")["artifacts"]
    assert len(references) == 1 and references[0]() is None


@pytest.fixture
def managed(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.core.llm import LLMRegistry
    from app.core.llm.manager import llm_manager
    from app.modules.pi_agent.config import get_pi_settings
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("TESSMORA_SETUP_TOKEN", "synthetic-setup-token")
    for field in PROVIDER_FIELDS.values():
        monkeypatch.setattr(settings, field, "")
    monkeypatch.setattr(llm_manager, "registry", LLMRegistry())
    monkeypatch.setattr(get_pi_settings(), "model_api_key", None)
    monkeypatch.setattr(setup_service, "_prepare_storage", lambda: None)
    service = setup_service.SetupService(tmp_path)
    monkeypatch.setattr(setup_service, "_service", service)
    return service


def test_no_credentials_status_does_not_construct_or_download_models(managed, monkeypatch):
    monkeypatch.setattr(setup_service, "_warm_model", lambda name: pytest.fail("status must not load models"))
    result = managed.status()
    assert result["managed"] and result["setup_required"]
    assert not any(result[key] for key in ("configured", "tested", "prepared", "ready"))
    assert result["required_local_models"] == ["bge_m3"]
    assert result["providers"]["siliconflow"] == {"configured": False}


def test_setup_api_auth_and_no_raw_credentials(managed):
    from app.api.setup import router
    app = FastAPI()
    app.include_router(router, prefix="/api/setup")
    with TestClient(app) as client:
        assert client.get("/api/setup/status").status_code == 200
        assert client.get("/api/setup/config").status_code == 401
        assert client.get("/api/setup/config", headers={"X-Tessmora-Setup-Token": b"invalid-\xff-token"}).status_code == 401
        assert client.post("/api/setup/config", json={"credentials": {"deepseek": "do-not-return-this"}}).status_code == 401
        response = client.post("/api/setup/config", headers={"X-Tessmora-Setup-Token": "synthetic-setup-token"}, json={"credentials": {"deepseek": "do-not-return-this", "siliconflow": "synthetic-sf"}})
        assert response.status_code == 200, response.text
        assert "do-not-return-this" not in response.text
        assert response.json()["providers"]["deepseek"]["configured"]
        assert not response.json()["tested"]
    mode = stat.S_IMODE((managed.root / "setup.json").stat().st_mode)
    assert mode == 0o600


@pytest.mark.asyncio
async def test_invalid_credential_probe_never_commits(managed, monkeypatch):
    from app.core.llm import connection_probe
    seen = []

    async def fail_probe(source, **kwargs):
        seen.append(getattr(source, "api_key", None))
        return {"success": False, "error_code": "authentication", **kwargs}

    monkeypatch.setattr(connection_probe, "run_probe", fail_probe)
    monkeypatch.setattr(setup_service, "_tool_probe", fail_probe)
    result = await managed.test({"credentials": {"deepseek": "invalid-synthetic", "siliconflow": "invalid-synthetic"}})
    assert not result["success"] and result["test_receipt"] is None
    assert "invalid-synthetic" in seen
    assert not (managed.root / "setup.json").exists()
    assert not managed.status()["configured"]


@pytest.mark.asyncio
async def test_receipt_binds_exact_draft_and_shared_runtime(managed, monkeypatch):
    from app.core.llm import connection_probe
    from app.core.llm.manager import llm_manager

    async def success_probe(source, **kwargs):
        return {"success": True, "message": "synthetic test", **kwargs}

    monkeypatch.setattr(connection_probe, "run_probe", success_probe)
    monkeypatch.setattr(setup_service, "_tool_probe", success_probe)
    draft = {"credentials": {"deepseek": "synthetic-deepseek", "siliconflow": "synthetic-sf"}}
    result = await managed.test(draft)
    assert result["success"]
    receipt = result["test_receipt"]
    with pytest.raises(ValueError, match="重新测试"):
        await managed.save({**draft, "credentials": {"deepseek": "changed", "siliconflow": "synthetic-sf"}, "test_receipt": receipt})
    assert not (managed.root / "setup.json").exists()
    registry_identity = llm_manager.registry
    status = await managed.save({**draft, "test_receipt": receipt})
    assert status["configured"] and status["tested"] and not status["ready"]
    assert llm_manager.registry is registry_identity
    assert llm_manager.registry.get_provider("deepseek").api_key == "synthetic-deepseek"
    reopened = setup_service.SetupService(managed.root)
    assert reopened.status()["tested"]
    assert "synthetic-deepseek" not in json.dumps(reopened.status())
    await managed.shutdown()


@pytest.mark.asyncio
async def test_prepare_retry_preserves_completed_model_and_restart_recovers(managed, monkeypatch):
    setup_service.atomic_private_json(managed.root / "setup.json", {"version": 1, "capabilities": ["text", "image"], "credentials": {}})
    calls = []
    artifact = managed.root / "synthetic-model.bin"
    artifact.write_bytes(b"synthetic")
    evidence = {"artifacts": [{"path": str(artifact), "size": artifact.stat().st_size}]}

    def warm(name):
        calls.append(name)
        if name == "clip":
            raise ConnectionError("interrupted-download")
        return evidence

    monkeypatch.setattr(setup_service, "_warm_model", warm)
    result = await managed.prepare()
    assert result["state"] == "running"
    await managed._task
    assert managed.progress()["state"] == "error"
    assert managed.progress()["models"]["bge_m3"]["state"] == "ready"
    monkeypatch.setattr(setup_service, "_warm_model", lambda name: (calls.append(name), evidence)[1])
    await managed.prepare()
    await managed._task
    assert calls == ["bge_m3", "clip", "clip"]
    assert managed.progress()["completed"] == 2
    assert managed.progress()["state"] == "ready"
    persisted = json.loads((managed.root / "prepare.json").read_text())
    persisted["state"] = "running"
    persisted["models"]["clip"]["state"] = "running"
    setup_service.atomic_private_json(managed.root / "prepare.json", persisted)
    restarted = setup_service.SetupService(managed.root)
    assert restarted.progress()["state"] == "interrupted"
    assert restarted.progress()["models"]["clip"]["state"] == "interrupted"
    assert restarted.progress()["models"]["bge_m3"]["state"] == "ready"
    await restarted.prepare()
    await restarted._task
    assert calls == ["bge_m3", "clip", "clip", "clip"]


@pytest.mark.asyncio
async def test_prepare_only_selected_models_and_prevents_concurrent_jobs(managed, monkeypatch):
    seen = []
    monkeypatch.setattr(setup_service, "_warm_model", lambda name: seen.append(name))
    await managed.prepare()
    task = managed._task
    await managed.prepare()
    assert managed._task is task
    await task
    assert seen == ["bge_m3"]
    with pytest.raises(ValueError, match="先保存"):
        await managed.prepare(["text", "video"])


@pytest.mark.asyncio
async def test_model_failure_keeps_phase_safe_causes_and_durable_progress(managed, monkeypatch):
    from app.core.model_preparation import report_preparation
    import errno
    def warm(name):
        report_preparation("metadata")
        assert managed.progress()["models"][name]["phase"] == "metadata"
        raise OSError(errno.ENETUNREACH, "https://secret:password@example.test/token-secret")
    monkeypatch.setattr(setup_service, "_warm_model", warm)
    await managed.prepare()
    await managed._task
    result = managed.progress()
    model = result["models"]["bge_m3"]
    assert result["state"] == "error" and result["error_code"] == "MODEL_NETWORK"
    assert model["phase"] == "metadata" and model["error_type"] == "OSError"
    assert "下载源" in model["message"] and "磁盘" not in model["message"]
    assert "password" not in (managed.root / "prepare.json").read_text()
    assert setup_service.SetupService(managed.root).progress()["models"]["bge_m3"]["error_code"] == "MODEL_NETWORK"


def test_late_download_events_cannot_overwrite_recovered_or_retried_progress(managed):
    stale = {"state": "running", "phase": "download"}
    current = {"state": "running", "phase": "metadata"}
    managed._progress = {"state": "running", "models": {"bge_m3": current}}
    managed._model_event("bge_m3", stale, {"phase": "download", "message": "late"})
    assert current["phase"] == "metadata"


def test_worker_refreshes_saved_credentials_before_new_tasks(managed):
    from app.core.llm.manager import llm_manager
    setup_service.atomic_private_json(managed.root / "setup.json", {"version": 1, "capabilities": ["text"], "credentials": {"deepseek": "worker-synthetic", "siliconflow": "sf"}, "task_models": {}})
    managed.refresh_worker_config()
    assert llm_manager.registry.get_provider("deepseek").api_key == "worker-synthetic"
    old = llm_manager.registry.get_provider("deepseek")
    managed.refresh_worker_config()
    assert llm_manager.registry.get_provider("deepseek") is old


def test_model_requirements_keep_sparse_and_multimodal_contract():
    assert setup_service.required_local_models(["text"]) == ["bge_m3"]
    assert set(setup_service.required_local_models(["text", "video"])) == {"bge_m3", "clip", "clap"}


@pytest.mark.asyncio
async def test_storage_error_retains_specific_diagnosis_and_retry_skips_cached_models(managed, monkeypatch):
    from app.core.storage_health import StorageUnavailable, storage_failure
    from app.core.llm import connection_probe
    from qdrant_client.http.exceptions import UnexpectedResponse
    import httpx
    artifact = managed.root / "cached.bin"
    artifact.write_bytes(b"cached")
    managed._progress["models"] = {"bge_m3": {"state": "ready", "artifacts": [{"path": str(artifact), "size": 6}]}}
    async def success(source, **kwargs):
        return {"success": True, **kwargs}
    monkeypatch.setattr(connection_probe, "run_probe", success)
    monkeypatch.setattr(setup_service, "_tool_probe", success)
    draft = {"credentials": {"deepseek": "d", "siliconflow": "s"}}
    receipt = (await managed.test(draft))["test_receipt"]
    await managed.save({**draft, "test_receipt": receipt})
    assert managed.status()["ready"]
    monkeypatch.setattr(setup_service, "_warm_model", lambda _: pytest.fail("storage failure and cached models must not download"))

    def fail():
        raise StorageUnavailable(storage_failure("qdrant", UnexpectedResponse(502, "private-key", b"private-key", httpx.Headers())))

    monkeypatch.setattr(setup_service, "_prepare_storage", fail)
    await managed.prepare()
    await managed._task
    progress = managed.progress()
    assert progress["stage"] == "storage"
    assert progress["error_code"] == "STORAGE_UNAVAILABLE"
    assert progress["storage"]["http_status"] == 502
    assert not managed.status()["ready"] and managed.status()["setup_required"]
    assert "Qdrant" in progress["message"] and "502" in progress["message"]
    assert "private-key" not in (managed.root / "prepare.json").read_text()
    monkeypatch.setattr(setup_service, "_prepare_storage", lambda: None)
    await managed.prepare()
    await managed._task
    assert managed.progress()["state"] == "ready"
    assert managed.progress()["completed"] == 1
    assert managed.status()["ready"]
    assert "storage" not in managed.progress() and "error_code" not in managed.progress()


def test_worker_does_not_recover_api_owned_preparation(managed):
    setup_service.atomic_private_json(managed.root / "prepare.json", {"state": "running", "models": {"bge_m3": {"state": "running"}}, "completed": 0, "total": 1})
    worker = setup_service.SetupService(managed.root, recover_preparation=False)
    assert worker.progress()["state"] == "running"
    assert json.loads((managed.root / "prepare.json").read_text())["state"] == "running"


def test_managed_app_lifespan_starts_without_credentials_or_storage(tmp_path):
    """A separate process proves the checkout .env and singletons cannot mask it."""
    import os
    import subprocess
    import sys
    backend = Path(__file__).resolve().parents[1]
    env = {key: value for key, value in os.environ.items() if not any(word in key for word in ("API_KEY", "TOKEN", "SECRET", "PI_AGENT_", "DEFAULT_"))}
    env.update(PYTHONPATH=str(backend), TESSMORA_STATE_DIR=str(tmp_path), TESSMORA_SETUP_TOKEN="synthetic-token", MINIO_ENDPOINT="127.0.0.1:1", QDRANT_HOST="127.0.0.1", QDRANT_PORT="1", REDIS_URL="redis://127.0.0.1:1/0")
    code = r"""
from app.main import app
from app.core.config import settings
from fastapi.testclient import TestClient
assert not settings.siliconflow_api_key
assert not settings.deepseek_api_key
assert not settings.preload_local_models_on_startup
with TestClient(app) as client:
    assert client.get('/health').status_code == 200
    assert client.get('/api/setup/status').json()['setup_required']
    payloads = [{'credentials': {'deepseek': 'synthetic-secret\n'}}, {'credentials': {'deepseek': {'value': 'synthetic-secret'}}}, {'unknown': 'synthetic-secret'}, {'credentials': {'unknown': 'synthetic-secret'}}]
    for payload in payloads:
        response = client.post('/api/setup/config', headers={'X-Tessmora-Setup-Token': 'synthetic-token'}, json=payload)
        assert response.status_code == 422
        assert 'synthetic-secret' not in response.text
        denied = client.post('/api/setup/config', json=payload)
        assert denied.status_code == 401
        assert 'synthetic-secret' not in denied.text
print('NO_KEY_LIFESPAN_OK')
"""
    process = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60)
    assert process.returncode == 0, (process.stdout[-4000:], process.stderr[-4000:])
    assert "NO_KEY_LIFESPAN_OK" in process.stdout


@pytest.mark.asyncio
async def test_completed_onboarding_survives_route_edit_but_missing_cache_requires_prepare(managed, monkeypatch):
    from app.core.llm import connection_probe
    from app.core.llm.manager import llm_manager
    async def success(source, **kwargs):
        return {"success": True, **kwargs}
    monkeypatch.setattr(connection_probe, "run_probe", success)
    monkeypatch.setattr(setup_service, "_tool_probe", success)
    artifact = managed.root / "model.bin"
    artifact.write_bytes(b"synthetic")
    monkeypatch.setattr(setup_service, "_warm_model", lambda name: {"artifacts": [{"path": str(artifact), "size": 9}]})
    draft = {"credentials": {"deepseek": "d", "siliconflow": "s"}}
    receipt = (await managed.test(draft))["test_receipt"]
    await managed.save({**draft, "test_receipt": receipt})
    await managed.prepare()
    await managed._task
    assert managed.status()["ready"] and not managed.status()["setup_required"]
    llm_manager.registry.update_task_model("final_generation", "Qwen/Qwen3.8-27B", persist=True)
    assert not managed.status()["tested"]
    assert not managed.status()["setup_required"]
    artifact.unlink()
    assert not managed.status()["prepared"] and managed.status()["setup_required"]


@pytest.mark.asyncio
async def test_existing_vectors_prevent_setup_embedding_changes(managed, monkeypatch):
    def blocked():
        raise ValueError("现有知识库已包含向量")
    monkeypatch.setattr(setup_service, "_assert_embedding_change_safe", blocked)
    with pytest.raises(ValueError, match="包含向量"):
        await managed.save({"task_models": {"embedding": "different-embedding"}})
    assert not (managed.root / "setup.json").exists()


@pytest.mark.asyncio
async def test_managed_empty_media_branches_never_load_encoders(managed):
    from types import SimpleNamespace
    from app.modules.retrieval.search_engine import HybridSearchEngine
    from app.modules.ingestion.storage.vector_store import VectorStore
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    calls = []
    def count(**kwargs):
        calls.append(kwargs["collection_name"])
        return SimpleNamespace(count=0)
    engine.vector_store = VectorStore.__new__(VectorStore)
    engine.vector_store.client = SimpleNamespace(count=count)
    # No llm_manager/local_models fields: touching a model would fail this test.
    assert await engine._visual_search("rollback", [], ["demo"], visual_intent="implicit_enrichment") == []
    assert await engine._audio_search("rollback", ["demo"], audio_intent="implicit_enrichment") == []
    assert await engine._video_search("rollback", ["demo"], visual_query="rollback") == []
    assert set(calls) == {"image_vectors", "audio_vectors", "video_shot_vectors"}


@pytest.mark.asyncio
async def test_existing_or_unknown_media_inventory_preserves_retrieval(managed, monkeypatch):
    from types import SimpleNamespace
    from app.modules.retrieval.search_engine import HybridSearchEngine
    from app.modules.ingestion.storage.vector_store import VectorStore
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.vector_store = VectorStore.__new__(VectorStore)
    engine.vector_store.client = SimpleNamespace(count=lambda **kw: SimpleNamespace(count=1))
    assert not await engine._managed_media_is_empty("image", ["existing"])
    def unavailable(**kwargs):
        raise ConnectionError("test")
    engine.vector_store.client.count = unavailable
    assert not await engine._managed_media_is_empty("audio", ["existing"])
    monkeypatch.delenv("TESSMORA_STATE_DIR")
    assert not await engine._managed_media_is_empty("image", ["existing"])


def test_capability_checks_include_independent_pi_media_routes(managed, monkeypatch):
    from app.modules.pi_agent.config import get_pi_settings
    pi = get_pi_settings()
    monkeypatch.setattr(pi, "enabled", True)
    monkeypatch.setattr(pi, "embedding_model", "openrouter:qwen/qwen3-embedding-8b")
    monkeypatch.setattr(pi, "audio_model", "aliyun_bailian:qwen3.5-omni-plus")
    status = managed.status()
    plans = status["capability_checks"]
    for capability in ("text", "image", "audio", "video"):
        assert any(row["task"] == "pi_embedding" and row["provider"] == "openrouter" for row in plans[capability])
    assert any(row["task"] == "pi_vision" and row["provider"] == "aliyun_bailian" for row in plans["image"])
    assert any(row["task"] == "pi_audio" and row["provider"] == "aliyun_bailian" for row in plans["audio"])
    assert {"pi_vision", "pi_audio"}.issubset({row["task"] for row in plans["video"]})
    assert not any(row["task"] in {"pi_vision", "pi_audio"} for row in plans["text"])


def test_worker_forwards_only_explicit_transport_environment(monkeypatch):
    from app.modules.pi_agent.supervisor import _worker_environment
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"):
        monkeypatch.setenv(name, "synthetic-transport-value")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "private-provider-secret")
    monkeypatch.setenv("TESSMORA_SETUP_TOKEN", "private-setup-token")
    result = _worker_environment()
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"):
        assert result[name] == "synthetic-transport-value"
    assert "DEEPSEEK_API_KEY" not in result
    assert "TESSMORA_SETUP_TOKEN" not in result


@pytest.mark.asyncio
async def test_media_setup_probes_independent_pi_models_before_issuing_receipt(managed, monkeypatch):
    from app.core.llm import connection_probe
    from app.modules.pi_agent.config import get_pi_settings
    from pydantic import SecretStr
    pi = get_pi_settings()
    monkeypatch.setattr(pi, "vision_model", "aliyun_bailian:qwen3-vl-plus")
    monkeypatch.setattr(pi, "model_api_key", SecretStr("synthetic-pi-key"))
    seen = []
    async def probe(source, **kwargs):
        seen.append((kwargs["model"], kwargs["capability"]))
        return {"success": kwargs["model"] != pi.vision_model, **kwargs}
    async def tools(source, **kwargs):
        assert source.api_key == "synthetic-pi-key"
        return {"success": True, **kwargs}
    monkeypatch.setattr(connection_probe, "run_probe", probe)
    monkeypatch.setattr(setup_service, "_tool_probe", tools)
    result = await managed.test({"capabilities": ["text", "image"], "credentials": {"deepseek": "d", "siliconflow": "s", "aliyun_bailian": "b"}})
    assert (pi.vision_model, "vision") in seen
    assert not result["success"] and result["test_receipt"] is None
    assert not (managed.root / "setup.json").exists()
