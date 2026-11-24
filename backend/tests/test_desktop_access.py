import json
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from app.core.desktop_access import DesktopAccess
from app.core import desktop_credentials
from app.core.setup_service import atomic_private_json


@pytest.mark.asyncio
async def test_listener_requires_current_workspace(monkeypatch):
    key = "a" * 48
    workspace = str(uuid4())
    monkeypatch.setenv("TESSMORA_WORKSPACE_ID", workspace)
    monkeypatch.setenv("TESSMORA_DESKTOP_TOKEN", key)
    app = FastAPI()
    app.add_middleware(DesktopAccess)

    @app.get("/api/knowledge")
    async def knowledge():
        return {"ok": True}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:31522") as c:
        assert (await c.get("/api/knowledge")).status_code == 401
        hdr = {"Authorization": "Bearer " + key}
        assert (await c.get("/api/knowledge", headers=hdr)).status_code == 200
        assert (await c.get("/api/knowledge", headers={**hdr, "Origin": "https://another.example"})).status_code == 403
        assert (await c.get("/api/knowledge", headers={**hdr, "Host": "another.example"})).status_code == 403


def test_credential_rotation_is_atomic_and_recoverable(tmp_path, monkeypatch):
    class Vault:
        entries = {}

        def set_password(self, service, key, value):
            self.entries[service, key] = value

        def get_password(self, service, key):
            return self.entries.get((service, key))

        def delete_password(self, service, key):
            self.entries.pop((service, key), None)

    vault = Vault()
    monkeypatch.setattr(desktop_credentials, "_keychain", lambda: vault)
    monkeypatch.setenv("TESSMORA_WORKSPACE_ID", str(uuid4()))
    path = tmp_path / "setup.json"
    first = {"version": 1, "credentials": {"deepseek": "secret-one"}}
    desktop_credentials.save(path, first, atomic_private_json)
    public = json.loads(path.read_text())
    assert "secret-one" not in path.read_text()
    assert desktop_credentials.hydrate(public)["credentials"] == first["credentials"]
    second = {**first, "credentials": {"deepseek": "secret-two"}}

    def disk_full(*args):
        raise OSError("full")

    with pytest.raises(OSError):
        desktop_credentials.save(path, second, disk_full)
    assert len(vault.entries) == 1
    assert desktop_credentials.hydrate(public)["credentials"] == first["credentials"]
    desktop_credentials.save(path, second, atomic_private_json)
    assert len(vault.entries) == 1
    assert desktop_credentials.hydrate(json.loads(path.read_text()))["credentials"] == second["credentials"]
    vault.entries.clear()
    assert desktop_credentials.hydrate(json.loads(path.read_text()))["credentials"] == {}
