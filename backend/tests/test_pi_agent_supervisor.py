import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.config import PiSettings, resolve_model
from app.modules.pi_agent.contracts import RunRequest
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.supervisor import PiSupervisor


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


def make_host(tmp_path, monkeypatch, *, script=None, **settings):
    monkeypatch.setattr(SourceCatalog, "load", lambda _: SourceCatalog([], {}))
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
