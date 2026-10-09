"""Bailian native contract and configuration isolation, not model quality tests."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import jev as api
from app.core import jev_settings as runtime
from app.core.config import settings
from app.core.decision_providers import DECISION_ENDPOINTS, validate_bailian_endpoint
from app.core.llm import jev


MODEL = "decision-model-preview"
QUESTIONS = {
    "n": {"type": "noul", "instructions": "Is the service available?"},
    "c": {"type": "choice", "instructions": {"passage": "服务可用", "question": "选择状态"},
          "criteria": {"available": "Available", "unavailable": "Unavailable"}},
    "s": {"type": "score", "instructions": "How clear is availability?", "criteria": ["No support", "Explicit support"]},
}
RESPONSE = {
    "model": MODEL, "request_id": "native-receipt", "latency_ms": 51.3,
    "answers": {
        "n": {"type": "noul", "noul": 1.0},
        "c": {"type": "choice", "choice": "available", "confidence": .73,
              "probabilities": {"available": .82, "unavailable": .18}},
        "s": {"type": "score", "score": .71, "confidence": .82,
              "probabilities": {"0": .29, "1": .71}},
    },
    "usage": {"input_tokens": 96},
}


def client(handler, **kwargs):
    return jev.JevClient("bailian-private", provider="bailian", model=MODEL,
                         transport=httpx.MockTransport(handler), **kwargs)


@pytest.mark.asyncio
async def test_native_three_types_and_structured_instructions_preserve_real_probability_and_usage():
    calls = []
    original = copy.deepcopy(QUESTIONS)

    def handle(request):
        calls.append(request)
        assert str(request.url) == DECISION_ENDPOINTS["bailian"]
        assert request.headers["authorization"] == "Bearer bailian-private"
        assert json.loads(request.content) == {"model": MODEL, "state": ["服务可用"], "questions": QUESTIONS}
        return httpx.Response(200, json=RESPONSE)

    current = client(handle)
    result = await current.evaluate(["服务可用"], QUESTIONS, prompt_version="contract")
    assert result.answers == RESPONSE["answers"]
    assert result.usage == {"input_tokens": 96}
    assert result.metadata()["route"] == "bailian"
    assert result.metadata()["provider"] == "Alibaba Cloud Bailian"
    assert result.metadata()["reported_usd"] is None
    assert result.metadata()["estimated_usd"] is None
    assert result.metadata()["cost_source"] == "unavailable"
    assert current.reserved_input_tokens == 96
    assert len(calls) == 1 and original == QUESTIONS


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation,reason", [
    (lambda data: data["usage"].clear(), "invalid_usage"),
    (lambda data: data["usage"].update(input_tokens=True), "invalid_usage"),
    (lambda data: data["usage"].update(output_tokens=-1), "invalid_usage"),
    (lambda data: data["usage"].update(cost="free"), "invalid_usage"),
    (lambda data: data["answers"]["c"].pop("confidence"), "invalid_probabilities"),
    (lambda data: data["answers"]["c"].pop("probabilities"), "invalid_probabilities"),
    (lambda data: data["answers"]["s"].update(score=2), "invalid_score"),
    (lambda data: data["answers"].pop("n"), "incomplete_answers"),
    (lambda data: data.update(model="decision-model-preview-new"), "model_mismatch"),
])
async def test_missing_native_contract_is_rejected_without_fabrication_or_retries(mutation, reason):
    data = copy.deepcopy(RESPONSE)
    mutation(data)
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(200, json=data)
    current = client(handle)
    with pytest.raises(jev.JevError, match=f"^{reason}$"):
        await current.evaluate("service available", QUESTIONS, prompt_version="contract")
    assert len(calls) == 1 and current.reserved_input_tokens > 96


@pytest.mark.parametrize("endpoint", [
    "https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone",
    "https://llm-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone",
    DECISION_ENDPOINTS["bailian"],
])
@pytest.mark.asyncio
async def test_explicit_official_regional_endpoint_is_used(endpoint):
    assert validate_bailian_endpoint(endpoint) == endpoint
    def handle(request):
        assert str(request.url) == endpoint
        return httpx.Response(200, json=RESPONSE)
    await client(handle, endpoint=endpoint).evaluate("state", QUESTIONS, prompt_version="contract")


@pytest.mark.parametrize("endpoint", [
    "http://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/systemone",
    "https://trial.cn-beijing.maas.aliyuncs.com.evil.example/compatible-mode/v1/systemone",
    "https://user:secret@trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone",
    "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone?api_key=secret",
    "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    "https://trial.cn-beijing.maas.aliyuncs.com:443/compatible-mode/v1/systemone",
    "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone#fragment",
])
@pytest.mark.asyncio
async def test_invalid_endpoint_never_receives_credentials(endpoint):
    def forbidden(request):
        pytest.fail("Invalid endpoint must not receive credentials")
    with pytest.raises(ValueError):
        validate_bailian_endpoint(endpoint)
    current = client(forbidden, endpoint=endpoint)
    with pytest.raises(jev.JevError, match="^invalid_endpoint$"):
        await current.evaluate("state", QUESTIONS, prompt_version="contract")
    assert current.reserved_input_tokens == 0


def test_bailian_uses_separate_credential_and_endpoint_cache(monkeypatch):
    monkeypatch.setattr(jev, "_clients", {})
    monkeypatch.setattr(settings, "bailian_decision_api_key", "dedicated-decision-key")
    monkeypatch.setattr(settings, "aliyun_bailian_api_key", "existing-chat-key")
    current = jev.get_decision_client("bailian", MODEL)
    current.reserved_input_tokens = 123
    assert current._api_key == "dedicated-decision-key"
    assert jev.get_decision_client("bailian", MODEL) is current
    assert current.reserved_input_tokens == 123
    monkeypatch.setattr(settings, "bailian_decision_endpoint", "https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone")
    assert jev.get_decision_client("bailian", MODEL) is not current
    assert "dedicated-decision-key" not in repr(jev._clients)


def test_bailian_environment_default_does_not_change_legacy_saved_route(monkeypatch):
    monkeypatch.setattr(settings, "decision_provider", "bailian")
    monkeypatch.setattr(settings, "decision_model", None)
    assert runtime.JevConfigStore.environment_config().model == MODEL
    legacy = runtime.JevConfig.model_validate({"intent_mode": "off", "rerank_mode": "off", "citation_mode": "off", "citation_strategy": "per_unit"})
    assert legacy.provider == "typesafe" and legacy.model == "jev-1.13.0"


def test_strict_uncertainty_keeps_an_actionable_sanitized_reason():
    error = jev.JevRequiredError("intent", "uncertain_decision")
    assert error.diagnostics()["reason"] == "uncertain_decision"
    assert error.diagnostics()["fallback_used"] is False


@pytest.mark.asyncio
async def test_api_catalog_probe_and_missing_key_are_isolated_from_chat_key(monkeypatch):
    monkeypatch.setattr(settings, "bailian_decision_api_key", None)
    monkeypatch.setattr(settings, "aliyun_bailian_api_key", "chat-key-is-not-authorized-for-decision")
    app = FastAPI()
    app.include_router(api.router, prefix="/api/decision")
    selection = {"provider": "bailian", "model": MODEL}
    runtime.jev_config_store.write(runtime.OFF_CONFIG)
    before = runtime.jev_config_store.path.read_bytes()
    evaluate = AsyncMock(return_value=SimpleNamespace(model=MODEL, duration_s=.1))
    monkeypatch.setattr(api, "get_decision_client", lambda provider, model: SimpleNamespace(evaluate=evaluate))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        body = (await http.get("/api/decision/settings")).json()
        bailian = next(p for p in body["providers"] if p["id"] == "bailian")
        assert bailian["api_key_configured"] is False and bailian["endpoint_kind"] == "trial"
        assert any(m["provider"] == "bailian" and m["id"] == MODEL for m in body["models"])
        denied = await http.post("/api/decision/test", json=selection)
        assert denied.status_code == 409 and "BAILIAN_DECISION_API_KEY" in denied.text
        monkeypatch.setattr(settings, "bailian_decision_api_key", "private-key")
        good = await http.post("/api/decision/test", json=selection)
        assert good.status_code == 200 and good.json()["success"] is True
    assert len(evaluate.call_args.args[1]) == 3
    assert "private-key" not in good.text
    assert runtime.jev_config_store.path.read_bytes() == before
