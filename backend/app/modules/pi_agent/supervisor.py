"""One host supervisor, bounded independent Pi workers, durable NDJSON event ingestion."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict
import fcntl
from functools import partial
import json
import os
from pathlib import Path
import time
import threading

from .catalog import SourceCatalog, Source, source_id
from .config import ROOT, resolve_model
from .contracts import RunRequest, TERMINAL_STATUSES
from .gateway import KnowledgeGateway
from .media import MediaInspector
from .models import ModelTransport
from .policy import AccessScope, BudgetLedger, ToolError
from .store import RunStore, RunConflict
from .tools import ToolSet, definitions

WORKER = ROOT / "agent-runtime" / "src" / "worker.mjs"
WORKER_EVENTS = {"model.started", "model.completed", "model.rejected", "model.cancelled",
                 "action.delta", "answer.delta", "answer.reset", "tool.rejected", "context.compacted"}


class PiSupervisor:
    def __init__(self, settings, registry, *, storage=None, vector_client=None, worker=WORKER):
        self.settings, self.registry, self.worker = settings, registry, worker
        settings.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = (settings.data_dir / "supervisor.lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise ToolError("supervisor_busy", "已有服务进程持有 Pi 任务账本；请使用单实例或为不同实例设置独立目录") from None
        self.store = RunStore(settings.data_dir / "runs.sqlite3")
        self.store.recover_interrupted()
        self.io_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pi-source")
        self.run_gate = asyncio.Semaphore(settings.max_concurrent_runs)
        self.search_gate = asyncio.Semaphore(settings.max_concurrent_searches)
        self.creation_lock = asyncio.Lock()
        self.jobs, self.processes = {}, {}
        self.closed = False
        if storage is None or vector_client is None:
            from app.core.config import settings as app_settings
            from minio import Minio
            from qdrant_client import AsyncQdrantClient
            import urllib3
            storage = storage or Minio(app_settings.minio_endpoint, access_key=app_settings.minio_access_key,
                secret_key=app_settings.minio_secret_key, secure=app_settings.minio_secure,
                region=app_settings.minio_region or "us-east-1",
                http_client=urllib3.PoolManager(num_pools=2, maxsize=2, block=True,
                    timeout=urllib3.Timeout(connect=5, read=15), retries=False))
            vector_client = vector_client or AsyncQdrantClient(host=app_settings.qdrant_host, port=app_settings.qdrant_port,
                api_key=app_settings.qdrant_api_key or None, timeout=12,
                limits=__import__("httpx").Limits(max_connections=4, max_keepalive_connections=2))
        self.storage, self.vectors = storage, vector_client

    @staticmethod
    async def _settle_io(future):
        # A timeout, explicit stop and host shutdown may cancel the same task.
        # None can release capacity or source files while native I/O still runs.
        while not future.done():
            try:
                await asyncio.shield(future)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not future.cancelled():
            future.exception()  # Consume a late read failure during cancellation.

    async def blocking(self, function, *args, **kwargs):
        future = asyncio.get_running_loop().run_in_executor(self.io_pool, partial(function, *args, **kwargs))
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            # Keep the run's slot and temporary files until bounded physical I/O
            # actually settles; a cancelled browser cannot create orphan reads.
            await self._settle_io(future)
            raise

    def _redact(self, value):
        if isinstance(value, str):
            if self.settings.model_api_key:
                value = value.replace(self.settings.model_api_key.get_secret_value(), "[redacted]")
            for provider in self.registry.list_providers():
                key = getattr(self.registry.get_provider(provider), "api_key", None)
                if key:
                    value = value.replace(key, "[redacted]")
            return value
        if isinstance(value, dict):
            return {k: self._redact(v) for k, v in value.items() if k not in {"api_key", "authorization", "baseUrl"}}
        if isinstance(value, list):
            return [self._redact(v) for v in value]
        return value

    async def start(self, request: RunRequest, owner: str):
        if self.closed or not self.settings.enabled:
            raise ToolError("pi_unavailable", "纯 Agent 模式当前不可用")
        async with self.creation_lock:
            existing = self.store.find_request(owner, request.client_request_id)
            if existing:
                return self.store.create(owner=owner, request=request.model_dump(), config=existing["config"])[0]
            if len(self.jobs) >= self.settings.max_concurrent_runs + self.settings.max_queued_runs:
                raise ToolError("queue_full", "纯 Agent 的运行队列已满，请稍后重试", retryable=True)
            if request.parent_run_id:
                parent = self.store.get(request.parent_run_id, owner=owner)
                if parent["session_id"] != request.session_id:
                    raise ToolError("invalid_parent", "关联任务不属于当前会话")
            model, key = resolve_model(self.registry, request.model, self.settings)
            # Reject an explicitly forbidden scope without reading any storage.
            # Source existence and canonical identities are validated by the
            # durable preparation phase before tools or model calls can begin.
            if self.settings.allowed_kb_ids is not None:
                AccessScope.from_request(request, set(self.settings.allowed_kb_ids))
            public = {"engine": "pi", "protocol_version": 1, "model": model["name"], "provider": model["provider"],
                      "thinking_enabled": self.settings.thinking_enabled,
                      "budget": self.settings.budget.model_dump(), "scope": None, "scope_ready": False,
                      "tool_models": {"embedding": self.settings.embedding_model, "vision": self.settings.vision_model, "audio": self.settings.audio_model}}
            run, created = self.store.create(owner=owner, request=request.model_dump(), config=public)
            if created:
                task = asyncio.create_task(self._run(run["id"], request, owner, model, key))
                self.jobs[run["id"]] = task
                def settled(done):
                    # asyncio can cancel a queued task before its coroutine starts.
                    self.jobs.pop(run["id"], None)
                    if done.cancelled() and self.store.get(run["id"])["status"] not in TERMINAL_STATUSES:
                        self.store.transition(run["id"], "cancelled", data={"message": "排队中的任务已取消"})
                task.add_done_callback(settled)
            return run

    async def _admit_preparation(self, ledger, emit):
        ledger.check_time()
        if self.settings.yield_to_legacy:
            from .admission import legacy_activity
            await legacy_activity.wait(emit, parent_span_id="sources")
        ledger.check_time()

    async def _load_catalog(self, ledger, emit):
        await self._admit_preparation(ledger, emit)
        loop, stopped = asyncio.get_running_loop(), threading.Event()
        def checkpoint():
            if stopped.is_set():
                raise ToolError("cancelled", "来源准备已取消")
            ledger.check_time()
            if not self.settings.yield_to_legacy:
                return
            from .admission import legacy_activity
            if not legacy_activity.active:
                return
            # The synchronous MinIO iterator can reach another page after an
            # old request starts. Admit each subsequent read through the loop,
            # while retaining a cooperative stop path for this worker thread.
            waiting = asyncio.run_coroutine_threadsafe(self._admit_preparation(ledger, emit), loop)
            try:
                while True:
                    if stopped.is_set():
                        raise ToolError("cancelled", "来源准备已取消")
                    ledger.check_time()
                    try:
                        waiting.result(timeout=.05)
                        return
                    except FutureTimeout:
                        pass
            finally:
                if not waiting.done():
                    waiting.cancel()
        future = loop.run_in_executor(self.io_pool, partial(SourceCatalog.load, self.storage, checkpoint=checkpoint))
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            # Stop before another page/metadata request; an already-issued read
            # keeps its bounded I/O slot until it settles, never an orphan scan.
            stopped.set()
            await self._settle_io(future)
            raise

    async def _prepare(self, run_id, request, owner, ledger, emit):
        started = time.monotonic()
        emit("sources.started", {"message": "正在准备可读取的来源与检索范围。"}, span_id="sources")
        try:
            catalog = await self._load_catalog(ledger, emit)
        except ToolError:
            raise
        except Exception:
            raise ToolError("catalog_unavailable", "无法读取来源目录，请检查知识库服务后重试。") from None
        allowed = set(catalog.knowledge_bases)
        if self.settings.allowed_kb_ids is not None:
            allowed &= set(self.settings.allowed_kb_ids)
        scope = AccessScope.from_request(request, allowed)
        for reference in request.selected_files + request.reference_files:
            catalog.get(source_id(reference.kb_id, reference.file_id), scope)
        from .uploads import attachment_source
        attachments = []
        for item in request.attachments:
            await self._admit_preparation(ledger, emit)
            attachments.append(await self.blocking(attachment_source, item, owner, self.settings))
        catalog = SourceCatalog([*catalog.sources.values(), *attachments], catalog.knowledge_bases)
        from app.modules.chat.references import resolve_message_references
        refs = [catalog.get(source_id(f.kb_id, f.file_id), scope) for f in request.reference_files]
        try:
            _, annotated, bindings = resolve_message_references(request.message, request.mentions,
                [{"kb_id": s.kb_id, "file_id": s.file_id, "name": s.name, "type": s.modality,
                  "kb_name": catalog.knowledge_bases.get(s.kb_id, "")} for s in refs],
                [{"id": s.attachment_id, "name": s.name, "type": s.modality, "index": i + 1} for i, s in enumerate(attachments)])
        except ValueError as error:
            raise ToolError("invalid_reference", str(error)) from None
        ledger.check_time()
        self.store.finish_preparation(run_id, scope=scope.public(), sources=[asdict(s) for s in catalog.visible(scope)],
                                      duration_ms=round((time.monotonic() - started) * 1000))
        return catalog, scope, annotated, bindings

    async def _run(self, run_id, request, owner, model, key):
        ledger, transport, process = None, None, None
        try:
            async with self.run_gate:
                if self.store.get(run_id)["status"] == "cancelling":
                    raise asyncio.CancelledError
                ledger = BudgetLedger(self.settings.budget)
                self.store.transition(run_id, "running", data={"model": model["name"]})
                def emit(event, data, **spans):
                    return self.store.append(run_id, event, self._redact(data), **spans)
                async with asyncio.timeout(self.settings.budget.wall_seconds):
                    catalog, scope, annotated, bindings = await self._prepare(run_id, request, owner, ledger, emit)
                    transport = ModelTransport(self.registry, self.settings, ledger, emit)
                    gateway = KnowledgeGateway(catalog, scope, self.vectors, transport, self.search_gate)
                    media = MediaInspector(catalog, self.storage, transport, ledger, self.settings, self.blocking)
                    toolset = ToolSet(run_id, self.store, catalog, scope, ledger, gateway, media, emit, self.blocking)
                    inputs = [s.public(scope) for s in catalog.visible(scope) if s.attachment or (s.kb_id, s.file_id) in scope.references]
                    history = [{"role": h.get("role"), "content": str(h.get("content", ""))[:2000]} for h in request.history
                               if h.get("role") in {"user", "assistant"}][-8:]
                    prompt = json.dumps({"current_question": annotated, "reference_bindings": bindings,
                        "input_materials": inputs, "search_scope": scope.public(),
                        "accessible_knowledge_bases": [{"id": k, "name": v} for k, v in catalog.knowledge_bases.items() if k in scope.allowed_kbs],
                        "history_for_context_only_not_evidence": history,
                        "budget": self.settings.budget.model_dump()}, ensure_ascii=False)
                    config = {"run_id": run_id, "model": model, "api_key": key, "budget": self.settings.budget.model_dump(),
                              "thinking_level": "medium" if self.settings.thinking_enabled else "off",
                              "tools": definitions(), "prompt": prompt}
                    env = {name: value for name, value in os.environ.items() if name in {
                        "PATH", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"}}
                    if self.settings.yield_to_legacy:
                        from .admission import legacy_activity
                        await legacy_activity.wait(emit)
                    process = await asyncio.create_subprocess_exec(self.settings.node_binary, str(self.worker),
                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                        cwd=ROOT / "agent-runtime", env=env, limit=2 * 1024 * 1024)
                    self.processes[run_id] = process
                    result = await self._pipe(process, config, toolset, ledger, emit)
                if self.store.get(run_id)["status"] == "cancelling":
                    raise asyncio.CancelledError
                # A worker cannot invent an accepted final answer in its settled frame.
                accepted = toolset.final_result
                if accepted:
                    status, state = accepted["terminal"], accepted
                else:
                    status, state = "failed", {"code": result.get("code", "no_final_answer"),
                        "message": self._redact(result.get("message", "Agent 未提交有效结果"))}
                state = {**state, "usage": ledger.snapshot()}
                self.store.transition(run_id, status, state=state, data=state)
        except asyncio.CancelledError:
            state = {"code": "cancelled", "message": "任务已取消，已取得的证据和过程仍可查看。",
                     "usage": ledger.snapshot() if ledger else {}}
            current = self.store.get(run_id)["status"]
            if current not in TERMINAL_STATUSES:
                self.store.transition(run_id, "cancelled", state=state, data=state)
        except Exception as error:
            code = "time_budget_exhausted" if isinstance(error, TimeoutError) else error.code if isinstance(error, ToolError) else "runtime_failed"
            message = "本轮运行时间预算已用尽，已取得的证据仍可查看。" if isinstance(error, TimeoutError) else str(error) if isinstance(error, ToolError) else "Pi 运行服务未能完成任务，请查看已保存的过程并重试。"
            state = {"code": code, "message": message, "usage": ledger.snapshot() if ledger else {}}
            if self.store.get(run_id)["status"] not in TERMINAL_STATUSES:
                self.store.transition(run_id, "failed", state=state, data=state)
        finally:
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 2)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
            if transport:
                await transport.close()
            self.jobs.pop(run_id, None)
            self.processes.pop(run_id, None)

    async def _pipe(self, process, config, toolset, ledger, emit):
        write_lock, calls, tool_gate = asyncio.Lock(), set(), asyncio.Semaphore(2)
        async def send(value):
            async with write_lock:
                process.stdin.write((json.dumps(value, ensure_ascii=False) + "\n").encode())
                await process.stdin.drain()
        async def drain_errors():
            # Drain to prevent pipe deadlock, but never persist provider stderr.
            while await process.stderr.read(4096):
                pass
        stderr = asyncio.create_task(drain_errors())
        async def handle(message):
            method, params = message.get("method"), message.get("params") or {}
            try:
                if method == "model_request":
                    if self.settings.yield_to_legacy:
                        from .admission import legacy_activity
                        await legacy_activity.wait(emit)
                    closing = ledger.finalizing
                    result = ledger.admit_main_model(params["turn"], params["input_bytes"], params["max_output_tokens"])
                    if ledger.finalizing and not closing:
                        emit("budget.finalizing", {"message": "预算接近上限，Pi 将使用已有证据形成回答并说明缺口。"})
                elif method == "model_usage":
                    ledger.settle_model(params["turn"], params.get("usage"))
                    result = {"ok": True, "remaining_model_requests": ledger.limits.model_requests - ledger.model_requests}
                elif method == "tool":
                    async with tool_gate:
                        if self.settings.yield_to_legacy:
                            from .admission import legacy_activity
                            await legacy_activity.wait(emit, parent_span_id=f"tool:{params['tool_call_id']}")
                        result = await toolset.execute(params["tool_call_id"], params["name"], params["args"])
                else:
                    raise ToolError("invalid_protocol", "未知的 Pi 宿主请求")
                await send({"type": "response", "id": message["id"], "result": result})
            except ToolError as error:
                await send({"type": "response", "id": message["id"], "error": str(error)})
        try:
            await send({"type": "start", "config": config})
            while line := await process.stdout.readline():
                message = json.loads(line)
                if message.get("type") == "event":
                    if message.get("event_type") in WORKER_EVENTS:
                        event, data = message["event_type"], message.get("data") or {}
                        emit(event, data, span_id=f"model:{data['turn']}" if "turn" in data else None)
                elif message.get("type") == "request":
                    if len(calls) >= 50:
                        raise ToolError("worker_overflow", "Pi 请求队列超过本轮预算")
                    task = asyncio.create_task(handle(message))
                    calls.add(task)
                    # Consume errors; a failed protocol response makes the pipe fail,
                    # while the wall deadline bounds a worker waiting on a lost reply.
                    task.add_done_callback(lambda done: (calls.discard(done), done.exception() if not done.cancelled() else None))
                elif message.get("type") == "settled":
                    if calls:
                        await asyncio.gather(*calls)
                    return message.get("result") or {}
            return {"code": "worker_exit", "message": "Pi 工作进程提前退出，未提交有效回答。"}
        finally:
            for task in calls:
                task.cancel()
            await asyncio.gather(*calls, return_exceptions=True)
            stderr.cancel()
            await asyncio.gather(stderr, return_exceptions=True)

    async def cancel(self, run_id, owner):
        run = self.store.get(run_id, owner=owner)
        if run["status"] in TERMINAL_STATUSES or run["status"] == "cancelling":
            return run
        self.store.transition(run_id, "cancelling", owner=owner)
        task = self.jobs.get(run_id)
        if task:
            task.cancel()
        else:
            self.store.transition(run_id, "cancelled")
        return self.store.get(run_id, owner=owner)

    async def close(self):
        self.closed = True
        jobs = list(self.jobs.values())
        for task in jobs:
            task.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
        await self.vectors.close()
        self.io_pool.shutdown(wait=True, cancel_futures=True)
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        self.lock.close()
