"""Provider contract tests; mocked replies do not measure model quality."""
import asyncio
import copy
import json

import httpx
import pytest

from app.core.llm.decision_catalog import DECISION_MODELS, get_decision_model, list_decision_models
from app.core.llm.jev import JevClient, JevError


QUESTIONS = {
    "supported": {"type": "noul", "instructions": {"claim": "值为 3。", "question": "Is the claim supported?"},
                  "criteria": {"true": "Supported", "false": "Unsupported"}},
    "topic": {"type": "choice", "instructions": "Select the topic.",
              "criteria": {"number": "A numeric value", "color": "A color"}},
    "strength": {"type": "score", "instructions": "How direct is the evidence?",
                 "criteria": ["Absent", "Indirect", "Direct"]},
}


def decision_response(model="openai/gpt-6-luna-decisions-20261006", cost=.0001):
    data = {
        "model": model, "provider": "OpenAI",
        "answers": {
            "supported": {"type": "noul", "noul": .95},
            "topic": {"type": "choice", "choice": "number", "confidence": .9,
                      "probabilities": {"number": .9, "color": .1}},
            "strength": {"type": "score", "score": 1.9, "confidence": .9,
                         "probabilities": {"0": 0, "1": .1, "2": .9}},
        },
        "usage": {"input_tokens": 200, "output_tokens": 0},
    }
    if cost is not None:
        data["usage"]["cost"] = cost
    return data


def openrouter_client(handler, **kwargs):
    return JevClient("openrouter-secret", provider="openrouter",
                     model="openai/gpt-6-luna-decisions", transport=httpx.MockTransport(handler), **kwargs)


@pytest.mark.asyncio
async def test_openrouter_sends_decisions_contract_and_accepts_exact_versioned_alias():
    calls = []
    state = {"text": "值为 3。", "numbers": [3]}
    original = copy.deepcopy(QUESTIONS)

    def handler(request):
        calls.append(request)
        assert str(request.url) == "https://openrouter.ai/api/alpha/decisions"
        assert request.headers["authorization"] == "Bearer openrouter-secret"
        body = json.loads(request.content)
        assert body == {"model": "openai/gpt-6-luna-decisions", "state": state,
                        "questions": QUESTIONS, "provider": {"allow_fallbacks": False}}
        return httpx.Response(200, json=decision_response())

    client = openrouter_client(handler)
    result = await client.evaluate(state, QUESTIONS, prompt_version="probe-v1")
    assert result.answers["supported"]["noul"] == .95
    assert result.answers["topic"]["choice"] == "number"
    assert result.answers["strength"]["score"] == 1.9
    assert result.metadata() == {
        "model": "openai/gpt-6-luna-decisions-20261006",
        "usage": {"input_tokens": 200, "output_tokens": 0, "cost": .0001},
        "duration_s": result.duration_s, "prompt_version": "probe-v1",
        "provider": "OpenAI", "route": "openrouter",
        "requested_model": "openai/gpt-6-luna-decisions",
        "reported_usd": .0001, "estimated_usd": None, "cost_source": "provider_reported",
    }
    assert client.reserved_input_tokens == 200
    assert len(calls) == 1 and QUESTIONS == original


@pytest.mark.asyncio
@pytest.mark.parametrize("state", [{"text": "中文", "nested": [3, False]}, ["甲", "乙"], "Already plain text"])
async def test_native_state_types_are_preserved_without_mutation_or_double_encoding(state):
    original = copy.deepcopy(state)

    def handler(request):
        payload = json.loads(request.content)
        assert payload["state"] == state
        assert payload["questions"] == QUESTIONS
        return httpx.Response(200, json=decision_response())

    result = await openrouter_client(handler).evaluate(state, QUESTIONS, prompt_version="test")
    assert result.provider == "OpenAI" and state == original


def test_catalog_only_accepts_documented_exact_aliases_and_exposes_safe_fields():
    assert len({(entry.provider, entry.id) for entry in DECISION_MODELS}) == len(DECISION_MODELS)
    assert len(list_decision_models()) >= 4
    for entry, public in zip(DECISION_MODELS, list_decision_models()):
        assert public == {"id": entry.id, "name": entry.name, "provider": entry.provider}
        assert entry.accepts_response_model(entry.id)
        assert all(entry.accepts_response_model(alias) for alias in entry.response_model_ids)
        assert not entry.accepts_response_model(entry.id + "-unapproved-variant")
        assert not entry.accepts_response_model(None)
    assert get_decision_model("typesafe", "openai/gpt-6-luna-decisions") is None
    assert get_decision_model("openrouter", "openai/gpt-6-luna") is None
    assert get_decision_model("openrouter", "respan/span-01") is None
    assert get_decision_model("openrouter", "respan/span-01-lite") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("actual_model", ["openai/gpt-6-luna", "openai/gpt-6-luna-decisions-20990101",
                                          "openai/gpt-6-luna-decisions-other", "typesafe/jev-1.13-20260917"])
async def test_other_models_or_unreviewed_versions_are_not_silent_fallbacks(actual_model):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=decision_response(actual_model))

    client = openrouter_client(handler)
    with pytest.raises(JevError, match="^model_mismatch$"):
        await client.evaluate("state", QUESTIONS, prompt_version="test")
    assert len(calls) == 1 and client.reserved_input_tokens > 200


@pytest.mark.asyncio
@pytest.mark.parametrize("cost,source", [(None, "unavailable"), (0, "provider_reported")])
async def test_missing_cost_is_unknown_and_zero_reported_cost_remains_zero(cost, source):
    result = await openrouter_client(lambda _: httpx.Response(200, json=decision_response(cost=cost))).evaluate(
        "state", QUESTIONS, prompt_version="test")
    assert result.metadata()["reported_usd"] == cost
    assert result.metadata()["estimated_usd"] is None
    assert result.metadata()["cost_source"] == source


@pytest.mark.asyncio
@pytest.mark.parametrize("cost", [-1, True, "0.1", float("nan"), float("inf")])
async def test_invalid_billing_is_rejected_and_reservation_retained(cost):
    client = openrouter_client(lambda _: httpx.Response(200, content=json.dumps(decision_response(cost=cost))))
    with pytest.raises(JevError, match="^invalid_usage$"):
        await client.evaluate("state", QUESTIONS, prompt_version="test")
    assert client.reserved_input_tokens > 200


@pytest.mark.asyncio
async def test_reranking_retains_selected_route_and_cost_receipt():
    def handler(request):
        assert json.loads(request.content)["questions"]["d0"]["instructions"]["passage"] == "Evidence"
        return httpx.Response(200, json={"model": "openai/gpt-6-luna-decisions-20261006", "provider": "OpenAI",
                                       "answers": {"d0": {"type": "noul", "noul": .9}},
                                       "usage": {"input_tokens": 100, "output_tokens": 0, "cost": .00001}})
    result = await openrouter_client(handler).score("Question", ["Evidence"])
    assert result.scores == [{"index": 0, "relevance_score": .9}]
    assert result.metadata()["requested_model"] == "openai/gpt-6-luna-decisions"
    assert result.metadata()["provider"] == "OpenAI"
    assert result.metadata()["estimated_usd"] is None
    assert result.metadata()["reported_usd"] == .00001


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 402, 403, 429, 529])
async def test_gateway_errors_are_sanitized_and_open_the_shared_route_circuit(status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "openrouter-secret private state"})

    client = openrouter_client(handler)
    with pytest.raises(JevError, match=f"^http_{status}$"):
        await client.evaluate("private state", QUESTIONS, prompt_version="test")
    reservation = client.reserved_input_tokens
    with pytest.raises(JevError, match="^circuit_open$"):
        await client.evaluate("private state", QUESTIONS, prompt_version="test")
    assert len(calls) == 1 and client.reserved_input_tokens == reservation


@pytest.mark.asyncio
async def test_openrouter_deadline_includes_network_and_keeps_budget_reservation():
    cancelled = asyncio.Event()

    async def handler(request):
        try:
            await asyncio.sleep(20)
        finally:
            cancelled.set()

    client = openrouter_client(handler, timeout_s=.02)
    with pytest.raises(JevError, match="^timeout$"):
        await client.evaluate("state", QUESTIONS, prompt_version="test")
    assert cancelled.is_set() and client.reserved_input_tokens > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation,reason", [
    (lambda response: response["answers"]["topic"].pop("probabilities"), "invalid_probabilities"),
    (lambda response: response["answers"]["topic"].pop("confidence"), "invalid_probabilities"),
    (lambda response: response["answers"].pop("supported"), "incomplete_answers"),
    (lambda response: response["answers"]["strength"].update(score=3), "invalid_score"),
])
async def test_partial_choices_and_missing_distributions_never_invent_confidence(mutation, reason):
    response = decision_response()
    mutation(response)
    client = openrouter_client(lambda _: httpx.Response(200, json=response))
    with pytest.raises(JevError, match=f"^{reason}$"):
        await client.evaluate("state", QUESTIONS, prompt_version="test")


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,model", [("other", "jev-1.13.0"), ("openrouter", "chat-only-model")])
async def test_unknown_routes_fail_before_credentials_or_context_can_be_sent(provider, model):
    def forbidden_request(request):
        pytest.fail("Unknown route must not perform network I/O")

    client = JevClient("private-key", provider=provider, model=model, transport=httpx.MockTransport(forbidden_request))
    with pytest.raises(JevError, match="^unsupported_model$"):
        await client.evaluate("state", QUESTIONS, prompt_version="test")
    assert client.reserved_input_tokens == 0


def test_client_cache_separates_credentials_and_limits_without_route_switch_budget_reset(monkeypatch):
    from app.core.config import settings
    from app.core.llm import jev

    monkeypatch.setattr(jev, "_clients", {})
    monkeypatch.setattr(settings, "typesafe_api_key", "typesafe-secret")
    monkeypatch.setattr(settings, "openrouter_api_key", "openrouter-secret")
    direct = jev.get_decision_client("typesafe", "jev-1.13.0")
    luna = jev.get_decision_client("openrouter", "openai/gpt-6-luna-decisions")
    assert direct._api_key == "typesafe-secret" and luna._api_key == "openrouter-secret"
    luna.reserved_input_tokens = 543
    assert jev.get_decision_client("typesafe", "jev-1.13.0") is direct
    assert jev.get_decision_client("openrouter", "openai/gpt-6-luna-decisions") is luna
    assert luna.reserved_input_tokens == 543
    monkeypatch.setattr(settings, "openrouter_api_key", "rotated-secret")
    assert jev.get_decision_client("openrouter", luna.model) is not luna
    monkeypatch.setattr(settings, "openrouter_api_key", "openrouter-secret")
    monkeypatch.setattr(settings, "jev_timeout_s", settings.jev_timeout_s + .1)
    assert jev.get_decision_client("openrouter", luna.model) is not luna
    assert "openrouter-secret" not in repr(jev._clients)
    assert "typesafe-secret" not in repr(jev._clients)
