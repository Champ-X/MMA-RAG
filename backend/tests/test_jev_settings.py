import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
from starlette.responses import StreamingResponse
import httpx
import pytest

from app.api import jev as api
from app.core.config import settings
from app.core import jev_settings as runtime


@pytest.fixture
def app(monkeypatch):
    for field in ("jev_intent_mode", "jev_rerank_mode", "jev_citation_mode"):
        monkeypatch.setattr(settings, field, "off")
    monkeypatch.setattr(settings, "jev_citation_strategy", "per_unit")
    monkeypatch.setattr(settings, "typesafe_api_key", "test-secret-not-for-responses")
    app = FastAPI()
    app.add_middleware(runtime.JevConfigMiddleware)
    app.include_router(api.router, prefix="/api/jev")
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize("intent_mode,rerank_mode", [("adaptive", "shadow"), ("force", "force")])
async def test_api_persists_complete_config_without_exposing_credentials(app, intent_mode, rerank_mode):
    wanted = dict(provider="typesafe", model="jev-1.13.0", intent_mode=intent_mode, rerank_mode=rerank_mode, citation_mode="shadow", citation_strategy="batch_choice")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        initial = await client.get("/api/jev/settings")
        assert initial.json()["config"] == runtime.OFF_CONFIG.model_dump()
        response = await client.put("/api/jev/settings", json=wanted)
        assert response.status_code == 200
        assert response.json()["config"] == wanted
        assert response.json()["api_key_configured"] is True
        assert "test-secret" not in response.text
        assert (await client.get("/api/jev/settings")).json()["config"] == wanted
    # A new store/process observes the persisted configuration, without settings mutation.
    assert runtime.JevConfigStore(runtime.jev_config_store.path).read().model_dump() == wanted
    assert settings.jev_intent_mode == "off"
    assert "test-secret" not in runtime.jev_config_store.path.read_text()


def test_force_environment_modes_are_validated(monkeypatch):
    from app.core.config import Settings
    monkeypatch.setenv("JEV_INTENT_MODE", "force")
    monkeypatch.setenv("JEV_RERANK_MODE", "force")
    environment = Settings(_env_file=None, SILICONFLOW_API_KEY="test")
    assert environment.jev_intent_mode == environment.jev_rerank_mode == "force"
    assert runtime.JevConfig(intent_mode="force", rerank_mode="force", citation_mode="off", citation_strategy="per_unit").enabled


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"intent_mode": "replace"}, {"citation_mode": "replace"}, {"citation_strategy": "background"}, {"api_key": "unexpected-secret"}])
async def test_invalid_input_never_changes_saved_state(app, change):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    before = runtime.jev_config_store.path.read_bytes()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put("/api/jev/settings", json={**runtime.OFF_CONFIG.model_dump(), **change})
        assert response.status_code == 422
        assert (await client.put("/api/jev/settings", json={"intent_mode": "adaptive"})).status_code == 422
    assert runtime.jev_config_store.path.read_bytes() == before


@pytest.mark.asyncio
async def test_no_key_blocks_enabling_but_allows_disabling(app, monkeypatch):
    monkeypatch.setattr(settings, "typesafe_api_key", "  ")
    runtime.jev_config_store.write(runtime.OFF_CONFIG.model_copy(update={"intent_mode": "adaptive"}))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/jev/settings")).json()["api_key_configured"] is False
        assert (await client.put("/api/jev/settings", json={**runtime.OFF_CONFIG.model_dump(), "citation_mode": "shadow"})).status_code == 409
        assert (await client.put("/api/jev/settings", json=runtime.OFF_CONFIG.model_dump())).status_code == 200


@pytest.mark.asyncio
async def test_failed_atomic_write_leaves_original_config_active(app, monkeypatch):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    def fail(*args):
        raise OSError("private internal path")
    monkeypatch.setattr(runtime.os, "replace", fail)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put("/api/jev/settings", json={**runtime.OFF_CONFIG.model_dump(), "intent_mode": "adaptive"})
        assert response.status_code == 503
        assert "private internal path" not in response.text
    assert runtime.get_jev_config() == runtime.OFF_CONFIG
    assert not list(runtime.jev_config_store.path.parent.glob(".jev-*.tmp"))


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [b"{broken", b"\xff\xfe"])
async def test_invalid_file_disables_jev_and_can_be_recovered(app, monkeypatch, content):
    runtime.jev_config_store.path.write_bytes(content)
    monkeypatch.setattr(settings, "jev_intent_mode", "adaptive")
    assert runtime.get_jev_config() == runtime.OFF_CONFIG
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/jev/settings")).status_code == 503
        assert (await client.put("/api/jev/settings", json=runtime.OFF_CONFIG.model_dump())).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_inflight_request_keeps_snapshot_while_next_request_sees_change(app, streaming):
    entered, release = asyncio.Event(), asyncio.Event()
    @app.get("/hold")
    async def hold():
        if streaming:
            async def events():
                yield runtime.get_jev_config().intent_mode + "\n"
                entered.set()
                await release.wait()
                yield runtime.get_jev_config().intent_mode + "\n"
            return StreamingResponse(events(), media_type="text/plain")
        before = runtime.get_jev_config().intent_mode
        entered.set()
        await release.wait()
        return {"before": before, "after": runtime.get_jev_config().intent_mode}
    @app.get("/next")
    async def next_request():
        return {"mode": runtime.get_jev_config().intent_mode}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        inflight = asyncio.create_task(client.get("/hold"))
        await asyncio.wait_for(entered.wait(), timeout=1)
        response = await client.put("/api/jev/settings", json={**runtime.OFF_CONFIG.model_dump(), "intent_mode": "adaptive"})
        assert response.status_code == 200
        assert (await client.get("/next")).json() == {"mode": "adaptive"}
        release.set()
        completed = await inflight
        if streaming:
            assert completed.text == "off\noff\n"
        else:
            assert completed.json() == {"before": "off", "after": "off"}
    assert runtime._request_config.get() is None


@pytest.mark.asyncio
async def test_frozen_evaluation_ignores_ui_settings_and_rejects_writes(app, monkeypatch):
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    saved_path = runtime.jev_config_store.path
    saved_bytes = saved_path.read_bytes()
    monkeypatch.setattr(settings, "jev_intent_mode", "adaptive")
    monkeypatch.setattr(settings, "jev_citation_mode", "shadow")
    monkeypatch.setattr(settings, "jev_citation_strategy", "batch_choice")
    monkeypatch.setattr(runtime.jev_config_store, "path", None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        config = (await client.get("/api/jev/settings")).json()["config"]
        assert config == {
            "provider": "typesafe", "model": "jev-1.13.0",
            "intent_mode": "adaptive", "rerank_mode": "off",
            "citation_mode": "shadow", "citation_strategy": "batch_choice",
        }
        response = await client.put("/api/jev/settings", json=runtime.OFF_CONFIG.model_dump())
        assert response.status_code == 409
        assert "只读" in response.json()["detail"]
    assert saved_path.read_bytes() == saved_bytes
    assert runtime.get_jev_config().model_dump() == config


@pytest.mark.asyncio
async def test_existing_processors_follow_saved_modes_without_recreation(app, monkeypatch):
    from app.modules.retrieval.processors import intent
    from app.modules.retrieval import reranker
    from app.modules.generation import jev_answer_audit, jev_citation_batch
    processor = intent.IntentProcessor()
    processor._process_generative = AsyncMock(return_value={"intent_type": "factual"})
    classify = AsyncMock(return_value=({"intent_type": "factual"}, {"accepted": True}))
    monkeypatch.setattr(intent, "classify_intent", classify)
    ranker = reranker.Reranker()
    shared_client = ranker.jev_client
    ranker._apply_cross_encoder_reranking = AsyncMock(return_value=[{"id": "original"}])
    ranker._select_candidates_for_reranking = lambda candidates, context: candidates
    ranker._build_document_content = lambda item: "source"
    ranker._merge_scores = lambda *args: [{"id": "jev", "final_score": .9}]
    score = AsyncMock(return_value=SimpleNamespace(scores=[.9], metadata=lambda: {}))
    monkeypatch.setattr(shared_client, "score", score)
    batch = AsyncMock(return_value={"strategy": "batch_choice", "diagnostic_only": True})
    monkeypatch.setattr(jev_citation_batch, "audit_answer_batch", batch)

    await processor.process("default limit")
    assert (await ranker._rank_with_optional_jev("q", [{"id": "candidate"}], None))[1]["mode"] == "off"
    assert await jev_answer_audit.maybe_audit_answer("claim[1]", {}) is None
    classify.assert_not_awaited()
    score.assert_not_awaited()
    runtime.jev_config_store.write(runtime.JevConfig(intent_mode="adaptive", rerank_mode="replace", citation_mode="shadow", citation_strategy="batch_choice"))
    assert (await processor.process("default limit"))["jev_decision"]["accepted"]
    assert (await ranker._rank_with_optional_jev("q", [{"id": "candidate"}], None))[0][0]["id"] == "jev"
    assert (await jev_answer_audit.maybe_audit_answer("claim[1]", {}))["strategy"] == "batch_choice"
    assert ranker.jev_client is shared_client  # Toggling never resets the worker budget.
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    await processor.process("default limit")
    await ranker._rank_with_optional_jev("q", [{"id": "candidate"}], None)
    assert await jev_answer_audit.maybe_audit_answer("claim[1]", {}) is None
    classify.assert_awaited_once()
    score.assert_awaited_once()
    batch.assert_awaited_once()
