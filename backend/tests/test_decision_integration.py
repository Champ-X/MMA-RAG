"""Request-level Decision routing through the existing retrieval/generation stages.

Only the upstream HTTP transport is replaced. These tests exercise the real
client factory, response validation, persistent configuration, request snapshot,
intent gates, reranker and citation dispatcher without a live provider call.
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.core import jev_settings as runtime
from app.core.config import settings
from app.core.llm import jev
from app.modules.generation.jev_answer_audit import maybe_audit_answer
from app.modules.retrieval.processors.intent import IntentProcessor
from app.modules.retrieval.reranker import Reranker


ROUTES = [
    ("typesafe", "jev-1.13.0", "jev-1.13.0", "TypeSafe"),
    ("openrouter", "openai/gpt-6-luna-decisions", "openai/gpt-6-luna-decisions-20261006", "OpenAI"),
    ("openrouter", "typesafe/jev-1.13", "typesafe/jev-1.13-20260917", "TypeSafe"),
]
RAW_RESULTS = {"dense": [
    {"id": "evidence", "score": .01, "content_type": "doc",
     "payload": {"text_content": "每日限额是600次。", "kb_id": "selected-kb"}},
]}
REFERENCES = {"1": {"content_type": "doc", "content": "每日限额是600次。"}}


def config(provider="typesafe", model="jev-1.13.0", **overrides):
    return runtime.JevConfig(**{
        "provider": provider, "model": model,
        "intent_mode": "force", "rerank_mode": "force",
        "citation_mode": "shadow", "citation_strategy": "per_unit", **overrides,
    })


def upstream_reply(payload, actual_model, provider):
    answers = {}
    for name, question in payload["questions"].items():
        if question["type"] == "noul":
            answers[name] = {"type": "noul", "noul": .05 if name in {
                "is_complex", "needs_context", "contradicted",
            } else .95}
            continue
        choices = question["criteria"]
        chosen = next(choice for choice in ("factual", "unnecessary", "supported") if choice in choices)
        probabilities = {choice: .1 / (len(choices) - 1) for choice in choices}
        probabilities[chosen] = .9
        answers[name] = {"type": "choice", "choice": chosen,
                         "probabilities": probabilities, "confidence": .9}
    return {"model": actual_model, "provider": provider, "answers": answers,
            "usage": {"input_tokens": 50, "output_tokens": 10, "cost": .00001}}


@pytest.fixture
def routed_clients(monkeypatch):
    monkeypatch.setattr(settings, "typesafe_api_key", "fake-typesafe-key")
    monkeypatch.setattr(settings, "openrouter_api_key", "fake-openrouter-key")
    monkeypatch.setattr(jev, "_clients", {})
    monkeypatch.setattr(jev, "_shared_client", None)
    requests, clients = [], {}
    for route, model, actual_model, provider in ROUTES:
        client = jev.get_decision_client(route, model)

        def respond(request, expected_route=route, expected_model=model,
                    response_model=actual_model, upstream_provider=provider):
            payload = json.loads(request.content)
            assert payload["model"] == expected_model
            assert str(request.url) == (
                "https://api.typesafe.ai/v1/systemone" if expected_route == "typesafe"
                else "https://openrouter.ai/api/alpha/decisions"
            )
            assert request.headers["authorization"] == f"Bearer fake-{expected_route}-key"
            requests.append({"route": expected_route, "model": expected_model, "payload": payload})
            return httpx.Response(200, json=upstream_reply(payload, response_model, upstream_provider))

        client._transport = httpx.MockTransport(respond)
        clients[(route, model)] = client
    return clients, requests


def application(*, pause_after_intent=None):
    # These service objects intentionally survive all provider changes.
    processor, ranker = IntentProcessor(), Reranker()
    processor._process_generative = AsyncMock(return_value={"intent_type": "baseline"})
    ranker._apply_cross_encoder_reranking = AsyncMock(return_value=[{"id": "baseline"}])
    app = FastAPI()
    app.add_middleware(runtime.JevConfigMiddleware)

    @app.get("/exercise")
    async def exercise():
        intent = await processor.process("每日限额是多少？")
        if pause_after_intent is not None:
            entered, release = pause_after_intent
            entered.set()
            await release.wait()
        reranked = await ranker.rerank("每日限额是多少？", RAW_RESULTS)
        audit = await maybe_audit_answer("每日限额是600次[1]。", REFERENCES)
        return {"intent": intent, "reranked": reranked, "audit": audit}

    return app, processor, ranker


def assert_used_route(result, route, actual_model, strategy):
    metadata = [result["intent"]["jev_decision"], result["reranked"]["scorer"]]
    audit = result["audit"]
    metadata.append(audit["batch_metadata"] if strategy == "batch_choice"
                    else audit["units"][0]["result"]["metadata"])
    assert all(item["route"] == route and item["model"] == actual_model for item in metadata)
    assert result["intent"]["jev_decision"]["accepted"]
    assert result["reranked"]["results"][0]["id"] == "evidence"
    assert audit["diagnostic_only"] is True
    assert audit["coverage"]["evaluated_units"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("strategy", ["per_unit", "batch_choice"])
async def test_existing_stages_follow_provider_switches_and_retain_client_budget(routed_clients, strategy):
    clients, requests = routed_clients
    app, processor, ranker = application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        for route, model, actual_model, _ in [*ROUTES, ROUTES[0]]:
            runtime.jev_config_store.write(config(route, model, citation_strategy=strategy))
            result = await client.get("/exercise")
            assert result.status_code == 200
            assert_used_route(result.json(), route, actual_model, strategy)
            assert [(r["route"], r["model"]) for r in requests[-3:]] == [(route, model)] * 3
            assert ranker.jev_client is clients[(route, model)]
    assert len(requests) == 12
    assert clients[ROUTES[0][:2]].reserved_input_tokens == 300
    assert clients[ROUTES[1][:2]].reserved_input_tokens == 150
    assert clients[ROUTES[2][:2]].reserved_input_tokens == 150
    processor._process_generative.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
async def test_inflight_request_keeps_provider_for_later_rerank_and_citation(routed_clients):
    _, requests = routed_clients
    entered, release = asyncio.Event(), asyncio.Event()
    app, _, _ = application(pause_after_intent=(entered, release))
    runtime.jev_config_store.write(config())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        inflight = asyncio.create_task(client.get("/exercise"))
        await asyncio.wait_for(entered.wait(), timeout=2)
        runtime.jev_config_store.write(config(*ROUTES[1][:2]))
        release.set()
        result = await inflight
        assert_used_route(result.json(), "typesafe", "jev-1.13.0", "per_unit")
        following = await client.get("/exercise")
        assert_used_route(following.json(), "openrouter", ROUTES[1][2], "per_unit")
    assert [request["route"] for request in requests] == ["typesafe"] * 3 + ["openrouter"] * 3
    assert runtime._request_config.get() is None


@pytest.mark.asyncio
async def test_openrouter_failure_preserves_adaptive_replace_and_diagnostic_semantics(routed_clients):
    clients, requests = routed_clients
    selected = ROUTES[1][:2]
    clients[selected]._transport = httpx.MockTransport(lambda _: httpx.Response(503))
    runtime.jev_config_store.write(config(*selected, intent_mode="adaptive", rerank_mode="replace"))
    app, processor, ranker = application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
        response = await client.get("/exercise")
    assert response.status_code == 200
    result = response.json()
    assert result["intent"]["intent_type"] == "baseline"
    assert result["intent"]["jev_decision"]["reason"] == "http_503"
    assert result["reranked"]["scorer"]["status"] == "fallback"
    assert result["reranked"]["scorer"]["reason"] == "http_503"
    assert result["audit"]["units"][0]["result"] == {"status": "not_evaluated", "reason": "http_503"}
    processor._process_generative.assert_awaited_once()
    ranker._apply_cross_encoder_reranking.assert_awaited_once()
    assert requests == []  # No implicit request to a different route.


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["intent", "rerank"])
async def test_openrouter_required_failure_stops_without_using_other_models(routed_clients, stage):
    clients, requests = routed_clients
    selected = ROUTES[1][:2]
    clients[selected]._transport = httpx.MockTransport(lambda _: httpx.Response(503))
    runtime.jev_config_store.write(config(*selected))
    processor, ranker = IntentProcessor(), Reranker()
    processor._process_generative = AsyncMock()
    ranker._apply_cross_encoder_reranking = AsyncMock()
    with pytest.raises(jev.JevRequiredError) as failure:
        if stage == "intent":
            await processor.process("每日限额是多少？")
        else:
            await ranker.rerank("每日限额是多少？", RAW_RESULTS)
    assert failure.value.stage == stage
    assert failure.value.reason == "http_503"
    assert failure.value.diagnostics()["fallback_used"] is False
    processor._process_generative.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()
    assert requests == []


@pytest.mark.parametrize("legacy", [False, True])
def test_retrieval_evaluation_records_effective_public_decision_selection(monkeypatch, legacy):
    from evaluation import retrieval_local
    selected = config() if legacy else config(*ROUTES[1][:2])
    public = selected.model_dump()
    if legacy:
        public.pop("provider")
        public.pop("model")
    responses = {
        "/health": {"status": "healthy", "version": "test"},
        "/api/chat/models": {"current_config": {"intent": {"provider": "baseline", "model": "baseline"}}},
        "/api/jev/settings": {"config": public, "api_key_configured": True},
    }
    monkeypatch.setattr(retrieval_local, "request_json", lambda url: responses[url.removeprefix("http://local")])
    dataset = SimpleNamespace(sources={}, manifest={"provenance": {"snapshot_payload_sha256": "frozen"}})
    retriever = retrieval_local.LocalAPIRetriever(dataset, base_url="http://local")
    assert retriever.configuration["decision_config"] == selected.model_dump()
    assert "api_key_configured" not in retriever.configuration["decision_config"]


@pytest.mark.asyncio
async def test_native_retrieval_evaluation_keeps_fingerprinted_decision_config():
    from evaluation.retrieval_systems import LocalCoreRetriever, system_fingerprint
    retriever = LocalCoreRetriever.__new__(LocalCoreRetriever)
    retriever.decision_config = config(*ROUTES[1][:2])
    runtime.jev_config_store.write(config())

    async def native_search(case, top_k):
        assert runtime.get_jev_config() == retriever.decision_config
        runtime.jev_config_store.write(config(*ROUTES[2][:2]))
        await asyncio.sleep(0)
        assert runtime.get_jev_config() == retriever.decision_config
        return {"hits": [], "diagnostics": {}}

    retriever._search = native_search
    await retriever.search({"query": "fixed evaluation query"}, 5)
    assert runtime._request_config.get() is None
    assert runtime.get_jev_config() == config(*ROUTES[2][:2])
    assert "backend/app/core/jev_settings.py" in system_fingerprint()
