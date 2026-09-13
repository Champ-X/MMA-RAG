"""Failure evidence and routing tests; no real credentials or services."""
import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from app.core.llm import LLMRegistry
from app.core.llm.manager import LLMManager
from app.core.llm.model_health import ModelHealth, classify_error
from app.core.llm import models_catalog as catalog


def failure(status, code=None):
    response = httpx.Response(status, json={"code": code, "message": "failed"},
        request=httpx.Request("POST", "https://example.test/chat/completions"))
    return httpx.HTTPStatusError("failed", request=response.request, response=response)


def registry(models=None):
    r = object.__new__(LLMRegistry)
    r._models = models or {n: {"provider": "p", "type": "chat", "raw_model": n} for n in "abcd"}
    r._providers = {"p": SimpleNamespace(chat_completion=AsyncMock())}
    r._task_config = {"final_generation": {"model": "a", "fallbacks": ["b", "c", "d"]}}
    r._task_routing = {"final_generation": "a"}
    r.model_health = ModelHealth()
    return r


def manager(r):
    m = object.__new__(LLMManager); m.registry = r
    return m


@pytest.mark.parametrize("status,code,category,scope", [
    (403, 30003, "model_disabled", "model"), (401, None, "authentication", "provider"),
    (402, None, "billing", "provider"), (404, None, "not_found", "model"),
    (429, None, "rate_limited", "model"), (503, None, "provider_error", "model"),
    (400, None, "request_error", "model"),
])
def test_error_classification(status, code, category, scope):
    result = classify_error(failure(status, code))
    assert (result["category"], result["scope"]) == (category, scope)
    assert "message" not in result


@pytest.mark.asyncio
async def test_disabled_primary_only_called_once_then_recovers(monkeypatch):
    r = registry(); m = manager(r); calls = []
    async def chat(**kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "a": raise failure(403, 30003)
        return {"choices": [{"message": {"content": "OK"}}]}
    r._providers["p"].chat_completion = chat
    for _ in range(2):
        result = await m.chat([])
        assert result.success and result.model_used == "b" and result.fallback_used
    assert calls == ["a", "b", "b"]
    future = time.time() + 601
    monkeypatch.setattr("app.core.llm.model_health.time.time", lambda: future)
    await m.chat([])
    assert calls[-2:] == ["a", "b"]


@pytest.mark.asyncio
async def test_auth_failure_skips_provider():
    r = registry(); m = manager(r)
    r._providers["p"].chat_completion.side_effect = failure(401)
    result = await m.chat([])
    assert not result.success and result.error_category == "authentication"
    assert r._providers["p"].chat_completion.await_count == 1


@pytest.mark.asyncio
async def test_bad_input_does_not_disable_and_fallback_bounded():
    r = registry(); m = manager(r)
    r._providers["p"].chat_completion.side_effect = failure(400)
    for _ in range(2): assert not (await m.chat([])).success
    assert r._providers["p"].chat_completion.await_count == 6
    assert not r.model_health.blocked("p", "a", "chat_completion")


@pytest.mark.asyncio
async def test_missing_alias_runs_and_payload_not_mutated():
    r = registry(); m = manager(r)
    r._models["a"].update(catalog_presence="missing", raw_model="actual-api-id")
    r._providers["p"].chat_completion.return_value = {"choices": [{}]}
    params = {"messages": []}
    result = await m._call_with_model("chat_completion", "a", params)
    assert result.success and params == {"messages": []}
    assert r._providers["p"].chat_completion.call_args.kwargs["model"] == "actual-api-id"


@pytest.mark.asyncio
async def test_total_timeout_cancels_primary():
    r = registry(); m = manager(r); cancelled = asyncio.Event()
    async def slow(**kwargs):
        try: await asyncio.sleep(10)
        finally: cancelled.set()
    r._providers["p"].chat_completion = AsyncMock(side_effect=slow)
    result = await m.chat([], total_timeout=0.01)
    assert not result.success and cancelled.is_set()
    assert r._providers["p"].chat_completion.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("partial", [False, True])
async def test_stream_no_failover_after_content(partial):
    r = registry(); m = manager(r); calls = []
    async def stream(**kwargs):
        calls.append(kwargs["model"])
        if kwargs["model"] == "a":
            if partial: yield {"choices": [{"delta": {"content": "prefix"}}]}
            raise failure(403, 30003)
        yield {"choices": []}
        yield {"choices": [{"delta": {"content": "OK"}}]}
    r._providers["p"].stream_chat = stream
    received = []
    if partial:
        with pytest.raises(httpx.HTTPStatusError):
            async for text in m.stream_chat([]): received.append(text)
        assert received == ["prefix"] and calls == ["a"]
    else:
        async for text in m.stream_chat([]): received.append(text)
        assert received == ["OK"] and calls == ["a", "b"]
        assert r.model_health.blocked("p", "a", "chat_completion")


@pytest.mark.asyncio
async def test_incompatible_fallback_skipped():
    r = registry(); m = manager(r)
    r._models["a"]["type"] = r._models["c"]["type"] = "chat,vision"
    async def chat(**kwargs):
        if kwargs["model"] == "a": raise failure(403, 30003)
        return {"choices": [{}]}
    r._providers["p"].chat_completion = AsyncMock(side_effect=chat)
    result = await m.chat([{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,test"}}]}])
    assert result.success and result.model_used == "c"
    assert r._providers["p"].chat_completion.await_count == 2


def test_metadata_removes_capability_and_reduces_limit():
    r = registry()
    r._models["a"].update(type="chat,vision,audio", context_length=200000)
    r.add_model("a", {"provider": "p", "type": "chat", "context_length": 32000})
    assert r._models["a"]["type"] == "chat" and r._models["a"]["context_length"] == 32000


def test_unknown_openrouter_not_omnimodal():
    r = registry(); r._providers["openrouter"] = object()
    cfg = r.get_model_config("openrouter:unknown/model")
    assert cfg["type"] == "chat" and cfg["capability_source"] == "unknown"
    assert catalog._openrouter_arch_to_types({"output_modalities": ["image"]}) == ""


@pytest.mark.asyncio
async def test_missing_catalog_and_failed_refresh_retains_snapshot(monkeypatch):
    r = registry({"old": {"provider": "deepseek", "type": "chat", "catalog_synced": True}})
    r._providers = {"deepseek": object()}
    monkeypatch.setattr(catalog.settings, "deepseek_api_key", "test")
    monkeypatch.setattr(catalog, "_catalog_provider_status", {})
    fetch = AsyncMock(return_value=[("deepseek:new", {"provider": "deepseek", "type": "chat"})])
    monkeypatch.setattr(catalog, "_fetch_deepseek_models", fetch)
    await catalog._refresh_all_providers(r)
    assert r._models["old"]["catalog_presence"] == "missing" and not r._models["old"]["catalog_synced"]
    fetch.side_effect = httpx.ConnectError("offline")
    await catalog._refresh_all_providers(r)
    assert r._models["deepseek:new"]["catalog_presence"] == "present"
    status = catalog.get_llm_catalog_status()["providers"]["deepseek"]
    assert not status["ok"] and status["last_success_at"]


@pytest.mark.asyncio
async def test_catalog_ttl_scoped_to_registry(monkeypatch):
    fetch = AsyncMock(); monkeypatch.setattr(catalog, "_refresh_all_providers", fetch)
    a, b = registry(), registry()
    await catalog.ensure_llm_catalog_fresh(a)
    await catalog.ensure_llm_catalog_fresh(a)
    await catalog.ensure_llm_catalog_fresh(b)
    assert fetch.await_count == 2


def test_video_candidates_require_supported_protocol():
    r = registry({"vision": {"provider": "aliyun_bailian", "type": "chat,video", "raw_model": "qwen3-vl-plus"},
                  "omni": {"provider": "aliyun_bailian", "type": "chat,video,audio", "raw_model": "qwen3-omni-flash"}})
    r._providers = {"aliyun_bailian": object()}
    assert not r._is_model_compatible_with_task("video_parsing", "vision")
    assert r._is_model_compatible_with_task("video_parsing", "omni")


def test_generation_only_models_are_not_chat_and_unknown_limit_preserves_known():
    assert catalog.infer_siliconflow_model_types("image-generator", ["text-to-image"]) == ""
    r = registry(); r._models["a"]["context_length"] = 128000
    r.add_model("a", {"provider": "p", "context_length": None})
    assert r._models["a"]["context_length"] == 128000


def test_sse_and_sdk_errors_keep_codes():
    from app.core.llm.model_health import ProviderAPIError, raise_for_stream_error
    with pytest.raises(ProviderAPIError) as caught:
        raise_for_stream_error({"error": {"code": 404, "message": "No endpoints"}})
    assert classify_error(caught.value)["category"] == "not_found"
    assert classify_error(ProviderAPIError("Model disabled", status_code=403, code=30003))["category"] == "model_disabled"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_name", ["siliconflow", "deepseek", "openrouter", "aliyun_bailian"])
async def test_http_provider_respects_explicit_timeout_and_preserves_stream_error(monkeypatch, provider_name):
    from app.core.llm.providers.silicon_flow import SiliconFlowProvider
    from app.core.llm.providers.deepseek import DeepSeekProvider
    from app.core.llm.providers.openrouter import OpenRouterProvider
    from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
    classes = dict(siliconflow=SiliconFlowProvider, deepseek=DeepSeekProvider,
                   openrouter=OpenRouterProvider, aliyun_bailian=AliyunBailianProvider)
    requests = []
    def handler(request):
        requests.append(request)
        import json
        if json.loads(request.content).get("stream"):
            return httpx.Response(403, json={"code": 30003, "message": "Model disabled."})
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: original(*a, transport=httpx.MockTransport(handler), **kw))
    provider = classes[provider_name]("test")
    await provider.chat_completion(messages=[], model="chat-model", timeout=7, max_tokens=16)
    assert requests[0].extensions["timeout"]["read"] == 7
    with pytest.raises(httpx.HTTPStatusError) as caught:
        async for _ in provider.stream_chat(messages=[], model="chat-model", timeout=7): pass
    assert classify_error(caught.value)["category"] == "model_disabled"
    assert requests[-1].extensions["timeout"]["read"] == 7
    if hasattr(provider, "close"): await provider.close()


@pytest.mark.asyncio
async def test_embedding_failure_never_selects_unconfigured_different_space():
    r = registry({"embed": {"provider": "p", "type": "embedding"},
                  "other": {"provider": "p", "type": "embedding"}})
    r._task_config = {"embedding": {"model": "embed", "fallbacks": []}}
    r._task_routing = {"embedding": "embed"}
    r._providers["p"].embed_texts = AsyncMock(side_effect=failure(403, 30003))
    result = await manager(r).embed(["test"])
    assert not result.success and result.model_used == "embed"
    assert r._providers["p"].embed_texts.await_count == 1


def test_candidates_show_cooldown_without_overwriting_saved_preference():
    r = registry()
    r.model_health.record("p", "a", "chat_completion", duration=0.1, error=failure(403, 30003))
    rows = r.list_task_candidates("final_generation")
    assert rows[-1]["model"] == "a" and rows[-1]["cooldown"]["category"] == "model_disabled"
    assert r.get_task_model("final_generation") == "a"
    assert r.list_model_details()["a"]["call_health"][0]["cooling_down"]
