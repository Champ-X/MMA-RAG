import asyncio
from pathlib import Path
import threading
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.config import PiSettings, resolve_model
from app.modules.pi_agent.contracts import RunBudget, RunRequest, SourceFile
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.store import RunNotFound
from app.modules.pi_agent.supervisor import PiSupervisor, WORKER


class Registry:
    def list_models(self, kind):
        return ["fake:test"]
    def get_model_config(self, name):
        return {"type": "chat", "provider": "fake", "raw_model": "test"}
    def get_provider(self, name):
        return type("Provider", (), {"api_key": "provider-secret-value", "base_url": "http://localhost:1"})()
    def list_providers(self):
        return ["fake"]


class Vectors:
    async def close(self):
        pass


class ReasoningRegistry(Registry):
    def get_model_config(self, name):
        return {"type": "chat", "provider": "deepseek", "raw_model": "deepseek-flash"}


def test_pi_thinking_configuration_cannot_silently_enable_an_unsupported_provider(tmp_path):
    normal = PiSettings(data_dir=tmp_path, thinking_enabled=False)
    assert resolve_model(Registry(), None, normal)[0]["reasoning"] is False
    thinking = normal.model_copy(update={"thinking_enabled": True})
    with pytest.raises(ValueError, match="尚未配置推理协议"):
        resolve_model(Registry(), None, thinking)
    assert resolve_model(ReasoningRegistry(), None, thinking)[0]["compat"]["thinkingFormat"] == "deepseek"


def make_host(tmp_path, monkeypatch, *, script=None, **settings):
    monkeypatch.setattr(SourceCatalog, "load", lambda _, **kwargs: SourceCatalog([], {}))
    worker = tmp_path / "worker.mjs"
    worker.write_text(script or """
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') console.log(JSON.stringify({type:'request',id:'tool',method:'tool',params:{tool_call_id:'t',name:'ask_user',args:{question:'需要比较哪个年份？',options:['2025','2026']}}}));
 else if(m.type==='response') {console.log(JSON.stringify({type:'settled',result:{terminal:'completed',answer:'worker invented answer'}}));process.exit();}
});
""")
    return PiSupervisor(PiSettings(data_dir=tmp_path / "ledger", **settings), Registry(),
                        storage=object(), vector_client=Vectors(), worker=worker)


def request(key="request-key"):
    return RunRequest(client_request_id=key, session_id="session", message="比较结果")


async def wait_until(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(.005)


@pytest.mark.asyncio
async def test_pipe_preserves_structured_budget_refusal_and_readmits_without_phantom_usage(tmp_path, monkeypatch):
    script = """
import {createInterface} from 'node:readline';
const send=(id,method,params)=>console.log(JSON.stringify({type:'request',id,method,params}));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line), r=m.result;
 if(m.type==='start') send('full','model_request',{turn:1,input_bytes:999999,max_output_tokens:256});
 else if(m.id==='full') {
  if(r?.allowed!==false || !Number.isInteger(r.max_input_bytes) || r.allow_recall!==false) process.exit(10);
  send('short','model_request',{turn:1,input_bytes:1000,max_output_tokens:256});
 } else if(m.id==='short') {
  if(!r?.allowed || !r.final_turn || r.allow_recall!==false) process.exit(11);
  send('usage','model_usage',{turn:1,usage:{totalTokens:256}});
 } else if(m.id==='usage') send('recall','tool',{tool_call_id:'r',name:'recall_evidence',args:{evidence_ids:[1]}});
 else if(m.id==='recall') {
  if(!r?.isError || r.details.code!=='research_budget_exhausted') process.exit(12);
  send('finish','tool',{tool_call_id:'a',name:'ask_user',args:{question:'需要补充哪份资料？'}});
 } else if(m.id==='finish') {
  console.log(JSON.stringify({type:'settled',result:r.details})); process.exit();
 }
});
"""
    host = make_host(tmp_path, monkeypatch, script=script)
    try:
        run = await host.start(request(), "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        result = host.store.get(run["id"])
        assert result["status"] == "needs_input"
        assert result["state"]["usage"]["model_requests"] == 1
        assert result["state"]["usage"]["model_tokens"] == 256
        assert result["state"]["usage"]["unknown_usage_requests"] == 0
        assert any(event["type"] == "budget.finalizing" for event in host.store.events(run["id"]))
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_real_pi_unpaid_rejection_is_persisted_without_a_model_completion(tmp_path, monkeypatch):
    host = make_host(tmp_path, monkeypatch, budget=RunBudget(model_tokens=1000))
    host.worker = WORKER
    try:
        run = await host.start(request(), "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 5)
        saved = host.store.get(run["id"])
        assert saved["status"] == "failed"
        assert saved["state"]["usage"]["model_requests"] == 0
        assert saved["state"]["usage"]["model_tokens"] == 0
        model_events = [e for e in host.store.events(run["id"]) if e["type"].startswith("model.")]
        assert [e["type"] for e in model_events] == ["model.rejected"]
        assert model_events[0]["span_id"] == "model:1"
        assert model_events[0]["data"]["executed"] is False
        assert "无法容纳" in model_events[0]["data"]["message"]
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_pi_thinking_is_recorded_and_forwarded_to_the_worker(tmp_path, monkeypatch):
    script = """
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') {
  if(m.config.thinking_level!=='medium') process.exit(10);
  console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{tool_call_id:'ask',name:'ask_user',args:{question:'哪一份资料？'}}}));
 } else if(m.type==='response') {
  console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();
 }
});
"""
    host = make_host(tmp_path, monkeypatch, thinking_enabled=True, script=script)
    host.registry = ReasoningRegistry()
    try:
        run = await host.start(request(), "alice")
        assert run["config"]["thinking_enabled"] is True
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        assert host.store.get(run["id"])["status"] == "needs_input"
    finally:
        await host.close()


class PausedCatalogStorage:
    """Pause one native read; subsequent iterator pages must be admitted again."""
    def __init__(self):
        self.started, self.release = threading.Event(), threading.Event()
        self.reads = []

    def list_buckets(self):
        self.reads.append("buckets")
        return [SimpleNamespace(name="kb-one")]

    def list_objects(self, bucket, **kwargs):
        self.reads.append("page-1")
        self.started.set()
        assert self.release.wait(3), "Test did not release its native read"
        yield SimpleNamespace(object_name="documents/11111111-1111-1111-1111-111111111111_one.txt", etag="v1", size=3)
        self.reads.append("page-2")
        yield SimpleNamespace(object_name="documents/22222222-2222-2222-2222-222222222222_two.txt", etag="v2", size=3)


@pytest.mark.asyncio
async def test_source_preparation_is_durable_cancellable_and_yields_to_legacy(tmp_path, monkeypatch):
    from app.modules.pi_agent import admission
    activity = admission.LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    host = make_host(tmp_path, monkeypatch)
    reads = []
    def catalog(*args, **kwargs):
        reads.append("storage")
        return SourceCatalog([], {})
    monkeypatch.setattr(SourceCatalog, "load", catalog)
    activity.enter()
    try:
        run = await asyncio.wait_for(host.start(request(), "alice"), .5)
        await asyncio.sleep(.02)
        assert not reads, "Source preparation must also yield while legacy retrieval is active"
        assert host.store.get(run["id"])["status"] in {"queued", "running"}
        assert any(event["type"] == "resource.waiting" for event in host.store.events(run["id"]))
        await host.cancel(run["id"], "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values(), return_exceptions=True), .5)
        assert host.store.get(run["id"])["status"] == "cancelled"
        assert not reads and not host.processes
    finally:
        activity.leave()
        await host.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_catalog_pagination_yields_if_legacy_enters_mid_scan(tmp_path, monkeypatch, cancel):
    from app.modules.pi_agent import admission
    load_catalog = SourceCatalog.load
    activity = admission.LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    host = make_host(tmp_path, monkeypatch)
    monkeypatch.setattr(SourceCatalog, "load", load_catalog)
    storage = host.storage = PausedCatalogStorage()
    try:
        run = await host.start(request(), "alice")
        assert run["config"]["scope_ready"] is False and run["config"]["scope"] is None
        await wait_until(storage.started.is_set)
        activity.enter()
        storage.release.set()
        await wait_until(lambda: any(e["type"] == "resource.waiting" for e in host.store.events(run["id"])))
        assert storage.reads == ["buckets", "page-1"]
        assert not host.processes
        with pytest.raises(RunNotFound):
            host.store.artifact(run["id"], "_sources")
        if cancel:
            await host.cancel(run["id"], "alice")
        else:
            activity.leave()
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        result = host.store.get(run["id"])
        if cancel:
            assert result["status"] == "cancelled" and not result["config"]["scope_ready"]
            assert storage.reads == ["buckets", "page-1"]
        else:
            assert result["status"] == "needs_input" and result["config"]["scope_ready"]
            assert storage.reads == ["buckets", "page-1", "page-2"]
            assert len(host.store.artifact(run["id"], "_sources")) == 2
            events = host.store.events(run["id"])
            waiting = next(e for e in events if e["type"] == "resource.waiting")
            resumed = next(e for e in events if e["type"] == "resource.resumed")
            prepared = next(e for e in events if e["type"] == "sources.completed")
            tool = next(e for e in events if e["type"] == "tool.started")
            assert waiting["parent_span_id"] == resumed["parent_span_id"] == "sources"
            assert waiting["seq"] < resumed["seq"] < prepared["seq"] < tool["seq"]
    finally:
        storage.release.set()
        if activity.active:
            activity.leave()
        await host.close()


@pytest.mark.asyncio
async def test_repeated_cancellation_retains_slot_until_native_read_settles(tmp_path, monkeypatch):
    load_catalog = SourceCatalog.load
    host = make_host(tmp_path, monkeypatch, max_concurrent_runs=1, max_queued_runs=0)
    monkeypatch.setattr(SourceCatalog, "load", load_catalog)
    storage = host.storage = PausedCatalogStorage()
    try:
        run = await host.start(request(), "alice")
        await wait_until(storage.started.is_set)
        task = host.jobs[run["id"]]
        await host.cancel(run["id"], "alice")
        await asyncio.sleep(.01)
        # A shutdown or timeout can cancel the same task while it drains I/O.
        task.cancel()
        await asyncio.sleep(.01)
        assert not task.done(), "Repeated cancellation must not release an in-flight native read"
        assert host.store.get(run["id"])["status"] == "cancelling"
        with pytest.raises(ToolError, match="队列已满"):
            await host.start(request("next-request"), "alice")
        storage.release.set()
        await asyncio.wait_for(task, 2)
        assert storage.reads == ["buckets", "page-1"]
        assert host.store.get(run["id"])["status"] == "cancelled"
        assert not host.processes and not host.jobs
    finally:
        storage.release.set()
        await host.close()


@pytest.mark.asyncio
async def test_source_preparation_consumes_wall_budget_without_starting_worker(tmp_path, monkeypatch):
    # Shorten only the test's clock budget; production validation requires >=10s.
    budget = RunBudget().model_copy(update={"wall_seconds": .08})
    host = make_host(tmp_path, monkeypatch, budget=budget)
    stopped = threading.Event()
    def catalog(_, *, checkpoint):
        try:
            while True:
                checkpoint()
                threading.Event().wait(.005)
        finally:
            stopped.set()
    monkeypatch.setattr(SourceCatalog, "load", catalog)
    try:
        run = await host.start(request(), "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        result = host.store.get(run["id"])
        assert result["status"] == "failed" and result["state"]["code"] == "time_budget_exhausted"
        assert result["state"]["usage"]["model_requests"] == 0
        assert not result["config"]["scope_ready"] and stopped.is_set()
        assert not host.processes
    finally:
        await host.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["catalog_unavailable", "source_unavailable", "invalid_reference"])
async def test_preparation_failure_is_durable_and_never_reaches_model(tmp_path, monkeypatch, failure):
    from app.modules.pi_agent.catalog import Source, source_id
    host = make_host(tmp_path, monkeypatch)
    source = Source(source_id("one", "file"), "one", "file", "原文.txt", "doc", "v1", 3)
    spec = request()
    def catalog(*args, **kwargs):
        if failure == "catalog_unavailable":
            raise OSError("private-storage-location provider-secret-value")
        return SourceCatalog([source], {"one": "资料库"})
    monkeypatch.setattr(SourceCatalog, "load", catalog)
    if failure == "source_unavailable":
        spec.selected_files = [SourceFile(kb_id="one", file_id="missing")]
    elif failure == "invalid_reference":
        spec.message = "@假名.txt"
        spec.reference_files = [SourceFile(kb_id="one", file_id="file")]
        spec.mentions = [{"source": "knowledge", "kbId": "one", "fileId": "file", "name": "假名.txt", "type": "doc", "start": 0, "end": 7}]
    try:
        run = await host.start(spec, "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        result = host.store.get(run["id"])
        assert result["status"] == "failed" and result["state"]["code"] == failure
        assert not result["config"]["scope_ready"] and result["state"]["usage"]["model_requests"] == 0
        events = host.store.events(run["id"])
        assert not any(e["type"].startswith(("model.", "tool.")) for e in events)
        assert "private-storage-location" not in str(events) and "provider-secret-value" not in str(events)
        with pytest.raises(RunNotFound):
            host.store.artifact(run["id"], "_sources")
    finally:
        await host.close()


def test_pi_model_selection_defaults_to_its_own_configured_set():
    settings = PiSettings(model="fake:pi-model")
    assert resolve_model(Registry(), None, settings)[0]["name"] == "fake:pi-model"
    with pytest.raises(ValueError, match="可用模型范围"):
        resolve_model(Registry(), "fake:legacy-model", settings)
    settings.allowed_models = ["fake:pi-model", "fake:verified-tools-model"]
    assert resolve_model(Registry(), "fake:verified-tools-model", settings)[0]["name"] == "fake:verified-tools-model"


@pytest.mark.asyncio
async def test_real_process_protocol_only_accepts_host_validated_answer_and_replays(tmp_path, monkeypatch):
    host = make_host(tmp_path, monkeypatch)
    try:
        run = await host.start(request(), "alice")
        duplicate = await host.start(request(), "alice")
        assert duplicate["id"] == run["id"]
        await asyncio.gather(*host.jobs.values())
        result = host.store.get(run["id"])
        assert result["status"] == "needs_input"
        assert result["state"]["answer"] == "需要比较哪个年份？"
        assert "provider-secret-value" not in str(host.store.events(run["id"])) + str(result)
        after = host.store.events(run["id"], after=2)
        assert [e["seq"] for e in after] == list(range(3, result["seq"] + 1))
        assert host.processes == {}
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_cancel_before_coroutine_start_does_not_leave_zombie_queue(tmp_path, monkeypatch):
    host = make_host(tmp_path, monkeypatch)
    try:
        run = await host.start(request(), "alice")
        await host.cancel(run["id"], "alice")
        await asyncio.gather(*host.jobs.values(), return_exceptions=True)
        await asyncio.sleep(0)
        assert host.store.get(run["id"])["status"] == "cancelled"
        assert host.jobs == {} and host.processes == {}
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_running_worker_cancellation_releases_capacity_and_kills_child(tmp_path, monkeypatch):
    host = make_host(tmp_path, monkeypatch, script="process.stdin.resume(); setInterval(()=>{},10000);", max_concurrent_runs=1, max_queued_runs=0)
    try:
        run = await host.start(request(), "alice")
        for _ in range(100):
            if run["id"] in host.processes:
                break
            await asyncio.sleep(.01)
        child = host.processes[run["id"]]
        with pytest.raises(ToolError, match="队列已满"):
            await host.start(request("request-next"), "alice")
        await host.cancel(run["id"], "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values(), return_exceptions=True), 5)
        assert child.returncode is not None
        assert host.store.get(run["id"])["status"] == "cancelled"
        assert not host.jobs
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_exclusive_lock_prevents_second_host_recovery(tmp_path, monkeypatch):
    host = make_host(tmp_path, monkeypatch)
    try:
        run = host.store.create(owner="alice", request=request().model_dump(), config={})[0]
        with pytest.raises(ToolError, match="已有服务进程"):
            make_host(tmp_path, monkeypatch)
        assert host.store.get(run["id"])["status"] == "queued"
    finally:
        await host.close()
    replacement = make_host(tmp_path, monkeypatch)
    try:
        assert replacement.store.get(run["id"])["status"] == "failed"
    finally:
        await replacement.close()


@pytest.mark.asyncio
async def test_http_authorization_replay_and_private_artifact_boundary(tmp_path, monkeypatch):
    from app.api import pi_agent as api
    host = make_host(tmp_path, monkeypatch)
    monkeypatch.setattr(api, "host", lambda: host)
    monkeypatch.setattr(api, "get_pi_settings", lambda: host.settings)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/pi")
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
            bad = await client.post("/api/pi/runs", json=request().model_dump(), headers={"Origin": "https://attacker.example"})
            assert bad.status_code == 403
            created = await client.post("/api/pi/runs", json=request().model_dump())
            assert created.status_code == 200, created.text
            run = created.json()
            await asyncio.gather(*host.jobs.values())
            replay = await client.get(f"/api/pi/runs/{run['id']}/events?after=2")
            assert replay.status_code == 200
            assert f"id: {run['id']}:3" in replay.text and f"id: {run['id']}:1\n" not in replay.text
            assert (await client.get(f"/api/pi/runs/{run['id']}/artifacts/_sources")).status_code == 404
            assert (await client.get(f"/api/pi/runs/{run['id']}/events", headers={"Last-Event-ID": "another:3"})).status_code == 400
            from pydantic import SecretStr
            host.settings.api_token = SecretStr("correct-token")
            assert (await client.get(f"/api/pi/runs/{run['id']}")).status_code == 401
            host.settings.trusted_user_id = "someone-else"
            assert (await client.get(f"/api/pi/runs/{run['id']}", headers={"Authorization": "Bearer correct-token"})).status_code == 404
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_evidence_media_supports_ranges_and_rejects_invalid_offsets(tmp_path, monkeypatch):
    from dataclasses import asdict
    import hashlib
    from app.api import pi_agent as api
    from app.modules.pi_agent.catalog import Source
    host = make_host(tmp_path, monkeypatch)
    monkeypatch.setattr(api, "host", lambda: host)
    monkeypatch.setattr(api, "get_pi_settings", lambda: host.settings)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/pi")
    raw = b"0123456789"
    original = tmp_path / "sound"
    original.write_bytes(raw)
    run = host.store.create(owner="local-workspace", request=request().model_dump(), config={})[0]
    source = Source("src_test", "", "att", "sound.wav", "audio", hashlib.sha256(raw).hexdigest(), len(raw),
                    attachment_id="att", local_path=str(original))
    host.store.put_artifact(run["id"], "_sources", [asdict(source)])
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
            path = f"/api/pi/runs/{run['id']}/sources/src_test/content"
            result = await client.get(path, headers={"Range": "bytes=2-5"})
            assert result.status_code == 206 and result.content == b"2345"
            assert result.headers["content-range"] == "bytes 2-5/10"
            assert (await client.get(path, headers={"Range": "bytes=-3"})).content == b"789"
            assert (await client.get(path, headers={"Range": "bytes=20-30"})).status_code == 416
            assert (await client.get(path, headers={"Range": "bytes=" + "9" * 100 + "-"})).status_code == 416
            assert result.headers["content-security-policy"].startswith("sandbox")
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_media_cookie_requires_auth_expires_and_binds_workspace(tmp_path, monkeypatch):
    from app.api import pi_agent as api
    from app.core.llm.manager import llm_manager
    host = make_host(tmp_path, monkeypatch, api_token="correct-token", trusted_user_id="alice")
    monkeypatch.setattr(api, "host", lambda: host)
    monkeypatch.setattr(api, "get_pi_settings", lambda: host.settings)
    monkeypatch.setattr(llm_manager, "registry", Registry())
    app = FastAPI()
    app.include_router(api.router, prefix="/api/pi")
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://localhost") as client:
            assert (await client.get("/api/pi/config")).status_code == 401
            response = await client.get("/api/pi/config", headers={"Authorization": "Bearer correct-token"})
            assert response.status_code == 200
            assert all(flag in response.headers["set-cookie"] for flag in ("HttpOnly", "Secure", "SameSite=strict"))
            assert (await client.get("/api/pi/runs", params={"session_id": "s"})).status_code == 200
            host.settings.trusted_user_id = "bob"
            assert (await client.get("/api/pi/runs", params={"session_id": "s"})).status_code == 401
            client.cookies.clear()
            stale = api.media_cookie(host.settings, str(int(api.time.time()) - 21601))
            for cookie in (stale, "9" * 5000 + ".bad", "1.forged"):
                assert (await client.get("/api/pi/config", headers={"Cookie": "pi_workspace=" + cookie})).status_code == 401
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_json_cannot_invent_local_attachment_descriptors(tmp_path, monkeypatch):
    from app.api import pi_agent as api
    host = make_host(tmp_path, monkeypatch)
    monkeypatch.setattr(api, "host", lambda: host)
    monkeypatch.setattr(api, "get_pi_settings", lambda: host.settings)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/pi")
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
            response = await client.post("/api/pi/runs", json={**request().model_dump(), "attachments": [{"id": "invented"}]})
            assert response.status_code == 422
            assert response.json()["detail"]["code"] == "invalid_attachment"
            assert not host.jobs
    finally:
        await host.close()
