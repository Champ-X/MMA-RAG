import httpx
import pytest
import time
from types import SimpleNamespace
from fastapi import FastAPI
from pydantic import SecretStr

from app.api import collection, pi_agent
from app.modules.collection.store import CollectionNotFound


class FakeService:
    async def capabilities(self):
        return {"channels": {"tavily": {"available": False}}}

    async def create(self, request):
        return {"id": "run", "kb_id": request.kb_id, "status": "planning"}

    async def list(self, kb_id):
        return {"runs": []}

    async def get(self, run_id):
        raise CollectionNotFound("采集任务不存在")


@pytest.fixture(autouse=True)
def local_workspace(monkeypatch):
    monkeypatch.setattr(pi_agent, "get_pi_settings", lambda: SimpleNamespace(
        api_token=None, trusted_user_id=None, enabled=False))


def make_app(monkeypatch):
    monkeypatch.setattr(collection, "get_collection_service", lambda: FakeService())
    app = FastAPI()
    app.include_router(collection.router, prefix="/api/collection")
    return app


@pytest.mark.asyncio
async def test_api_contract_validation_and_errors(monkeypatch):
    app = make_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1234)), base_url="http://localhost") as client:
        assert (await client.get("/api/collection/capabilities")).json()["channels"]
        body = {"kb_id": "kb", "prompt": "素材", "client_request_id": "request-0001", "mode": "review", "max_items": 5}
        response = await client.post("/api/collection/runs", json=body)
        assert response.status_code == 202
        assert response.json()["kb_id"] == "kb"
        assert (await client.get("/api/collection/runs?kb_id=kb")).json() == {"runs": []}
        assert (await client.get("/api/collection/runs/missing")).status_code == 404
        assert (await client.post("/api/collection/runs", json={**body, "max_items": 21})).status_code == 422
        assert (await client.post("/api/collection/runs", json={**body, "prompt": " "})).status_code == 422
        assert (await client.post("/api/collection/runs/run/collect", json={"candidate_ids": []})).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("client_host,base_url,origin", [
    ("192.0.2.10", "http://localhost", None),
    ("127.0.0.1", "http://remote.example", None),
    ("127.0.0.1", "http://localhost", "https://remote.example"),
])
async def test_unconfigured_collection_rejects_remote_access(monkeypatch, client_host, base_url, origin):
    app = make_app(monkeypatch)
    headers = {"origin": origin} if origin else {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(client_host, 1234)), base_url=base_url, headers=headers) as client:
        assert (await client.get("/api/collection/capabilities")).status_code == 403
        assert (await client.get("/api/collection/runs?kb_id=kb")).status_code == 403
        body = {"kb_id": "kb", "prompt": "素材", "client_request_id": "request-0001"}
        assert (await client.post("/api/collection/runs", json=body)).status_code == 403
        assert (await client.post("/api/collection/runs/run/collect", json={"candidate_ids": ["item"]})).status_code == 403
        assert (await client.post("/api/collection/runs/run/retry")).status_code == 403
        assert (await client.post("/api/collection/runs/run/cancel")).status_code == 403


@pytest.mark.asyncio
async def test_configured_workspace_token_and_cookie_allow_remote_without_pi_mode(monkeypatch):
    settings = SimpleNamespace(api_token=SecretStr("test-collection-token"), trusted_user_id="test-workspace", enabled=False)
    monkeypatch.setattr(pi_agent, "get_pi_settings", lambda: settings)
    app = make_app(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("192.0.2.10", 1234)), base_url="https://workspace.example") as client:
        assert (await client.get("/api/collection/capabilities")).status_code == 401
        assert (await client.get("/api/collection/capabilities", headers={"authorization": "Bearer invalid"})).status_code == 401
        assert (await client.get("/api/collection/capabilities", headers={"authorization": "Bearer test-collection-token"})).status_code == 200
        cookie = pi_agent.media_cookie(settings, str(int(time.time())))
        client.cookies.set("pi_workspace", cookie)
        assert (await client.get("/api/collection/capabilities")).status_code == 200
        # An explicit invalid bearer must not be rescued by a previous cookie.
        assert (await client.get("/api/collection/capabilities", headers={"authorization": "Bearer invalid"})).status_code == 401
