"""Provider selection, migration, credential boundaries and non-mutating probes."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import jev as api
from app.core import jev_settings as runtime
from app.core.config import settings
from app.core.llm.jev import JevError


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(settings, "typesafe_api_key", "private-typesafe-key")
    monkeypatch.setattr(settings, "openrouter_api_key", "private-openrouter-key")
    app = FastAPI()
    app.add_middleware(runtime.JevConfigMiddleware)
    app.include_router(api.router, prefix="/api/decision")
    return app


def selection():
    return {"provider": "openrouter", "model": "openai/gpt-6-luna-decisions"}


def test_old_saved_config_keeps_original_provider_even_when_environment_changes(monkeypatch):
    runtime.jev_config_store.path.write_text(
        '{"intent_mode":"adaptive","rerank_mode":"off","citation_mode":"off","citation_strategy":"per_unit"}'
    )
    monkeypatch.setattr(settings, "decision_provider", "openrouter")
    monkeypatch.setattr(settings, "decision_model", selection()["model"])
    loaded = runtime.jev_config_store.read()
    assert loaded.provider == "typesafe"
    assert loaded.model == "jev-1.13.0"
    assert loaded.intent_mode == "adaptive"


def test_environment_provider_selects_matching_default(monkeypatch):
    monkeypatch.setattr(settings, "decision_provider", "openrouter")
    assert runtime.jev_config_store.read().model == selection()["model"]


def test_invalid_environment_model_disables_decisions(monkeypatch):
    monkeypatch.setattr(settings, "decision_model", "unsupported-model")
    assert runtime.get_jev_config() == runtime.OFF_CONFIG
    with pytest.raises(runtime.JevConfigUnavailable, match="环境配置无效"):
        runtime.jev_config_store.read()


@pytest.mark.asyncio
async def test_catalog_and_route_persist_without_any_secrets(app):
    wanted = {**runtime.OFF_CONFIG.model_dump(), **selection(), "intent_mode": "adaptive"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put("/api/decision/settings", json=wanted)
        assert response.status_code == 200
        assert response.json()["config"] == wanted
        assert any(m["id"] == wanted["model"] for m in response.json()["models"])
        assert {p["id"] for p in response.json()["providers"]} == {"typesafe", "openrouter", "bailian"}
        assert "private-" not in response.text
    assert runtime.jev_config_store.read().model_dump() == wanted
    assert "private-" not in runtime.jev_config_store.path.read_text()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"provider": "typesafe", "model": "openai/gpt-6-luna-decisions"},
    {"provider": "openrouter", "model": "openai/general-chat"},
    {"provider": "arbitrary", "model": "jev-1.13.0"},
])
async def test_invalid_route_rejected_without_altering_config(app, change):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    before = runtime.jev_config_store.path.read_bytes()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.put("/api/decision/settings", json={**runtime.OFF_CONFIG.model_dump(), **change})).status_code == 422
        assert (await client.post("/api/decision/test", json=change)).status_code == 422
    assert runtime.jev_config_store.path.read_bytes() == before


@pytest.mark.asyncio
async def test_selected_provider_key_required_but_disabling_allowed(app, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", None)
    draft = {**runtime.OFF_CONFIG.model_dump(), **selection()}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        enabled = await client.put("/api/decision/settings", json={**draft, "intent_mode": "adaptive"})
        assert enabled.status_code == 409
        assert "OPENROUTER_API_KEY" in enabled.json()["detail"]
        assert (await client.post("/api/decision/test", json=selection())).status_code == 409
        disabled = await client.put("/api/decision/settings", json=draft)
        assert disabled.status_code == 200
        assert disabled.json()["api_key_configured"] is False


@pytest.mark.asyncio
async def test_probe_uses_draft_selection_checks_three_types_and_never_saves(app, monkeypatch):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    before = runtime.jev_config_store.path.read_bytes()
    evaluate = AsyncMock(return_value=SimpleNamespace(model="openai/gpt-6-luna-decisions-20261006", duration_s=.1))
    seen = []
    def factory(provider, model):
        seen.append((provider, model))
        return SimpleNamespace(evaluate=evaluate)
    monkeypatch.setattr(api, "get_decision_client", factory)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/decision/test", json=selection())
    assert response.json()["success"] is True
    assert response.json()["model"].endswith("20261006")
    assert seen == [("openrouter", selection()["model"])]
    assert {q["type"] for q in evaluate.call_args.args[1].values()} == {"noul", "choice", "score"}
    assert runtime.jev_config_store.path.read_bytes() == before


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,expected", [("timeout", "timeout"), ("http_403", "http_403"), ("secret=private-key", "invalid_response_or_transport")])
async def test_probe_failure_is_safe_and_preserves_saved_route(app, monkeypatch, reason, expected):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    monkeypatch.setattr(api, "get_decision_client", lambda *args: SimpleNamespace(evaluate=AsyncMock(side_effect=JevError(reason))))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = (await client.post("/api/decision/test", json=selection())).json()
    assert result["success"] is False
    assert result["error"] == expected
    assert "private" not in str(result)
    assert runtime.jev_config_store.read() == runtime.OFF_CONFIG
