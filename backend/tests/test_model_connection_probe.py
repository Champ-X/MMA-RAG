"""Exact draft routing, real modality inputs and bounded probe isolation."""
import asyncio
import base64
import copy
import json
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
import httpx
import pytest

from app.api import model_probe as api
from app.core.llm import connection_probe as probe
from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
from app.core.llm.providers.deepseek import DeepSeekProvider
from app.core.llm.providers.openrouter import OpenRouterProvider


class Registry:
    def __init__(self):
        self.source = SimpleNamespace(api_key="private-key", base_url="https://provider.test/v1")
        self.models = {
            "deepseek:exact-model": {"provider": "deepseek", "type": "chat", "raw_model": "exact-model"},
            "openrouter:org/model": {"provider": "openrouter", "type": "chat,vision,audio,video", "raw_model": "org/model"},
            "Qwen/embed": {"provider": "siliconflow", "type": "embedding", "raw_model": "Qwen/embed"},
        }
        self.persisted = {"generation": "previous-model", "fallbacks": ["another-model"]}
        self.health = {"deepseek": {"retry_after": 9999999999, "failure_count": 10}}

    def list_models(self, capability=None):
        return [model for model, config in self.models.items() if capability is None or capability in config["type"].split(",")]

    def get_model_config(self, model):
        return self.models.get(model, {})

    def get_raw_model_name(self, model):
        return self.models[model]["raw_model"]

    def get_provider(self, _provider):
        return self.source


@pytest.fixture
def app(monkeypatch):
    registry = Registry()
    monkeypatch.setattr(api, "get_registry", lambda: registry)
    monkeypatch.setattr(probe, "_active_probes", 0)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/chat")
    return app, registry


async def request(app, **changes):
    body = {"provider": "deepseek", "model": "deepseek:exact-model", "capability": "chat", **changes}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/api/chat/models/test", json=body)


@pytest.mark.asyncio
async def test_api_probes_exact_draft_without_config_health_or_fallback_changes(app, monkeypatch):
    app, registry = app
    before = copy.deepcopy(registry.__dict__)
    standalone = SimpleNamespace(chat_completion=AsyncMock(return_value={"choices": [{"message": {"content": "OK"}}]}))
    monkeypatch.setattr(probe, "create_probe_provider", lambda source, provider: standalone)
    response = await request(app)
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["model"] == "deepseek:exact-model"
    standalone.chat_completion.assert_awaited_once()
    assert standalone.chat_completion.call_args.kwargs["model"] == "exact-model"
    assert registry.__dict__ == before
    assert "private-key" not in response.text
    assert probe._active_probes == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"model": "unregistered"}, {"model": "https://arbitrary.test/api"}, {"model": "x" * 201},
    {"model": "contains\nnewline"}, {"model": 123}, {"provider": "openrouter"},
    {"provider": "unknown"}, {"capability": "embedding"}, {"capability": "shell"},
    {"messages": [{"role": "user", "content": "private"}]},
])
async def test_api_rejects_invalid_routes_and_extra_payload_without_calling(app, monkeypatch, changes):
    app, _ = app
    call = AsyncMock()
    monkeypatch.setattr(api, "run_probe", call)
    assert (await request(app, **changes)).status_code == 422
    call.assert_not_awaited()


@pytest.mark.parametrize("data", [None, [], [[]], [[True]], [[float("nan")]], [[float("inf")]], [["1"]], [[1], [2]]])
def test_embedding_rejects_empty_nonfinite_and_invalid_vectors(data):
    with pytest.raises(probe.ProbeFailure, match="invalid_response"):
        probe.validate_result(data, "embedding", provider="siliconflow", raw_model="embedding")


@pytest.mark.parametrize("data", [
    None, [], [{"index": 0, "score": 1}], [{"index": 0, "score": 1}, {"index": 0, "score": .5}],
    [{"index": True, "score": 1}, {"index": 1, "score": .5}],
    [{"index": 0, "score": float("nan")}, {"index": 1, "score": .5}],
    [{"index": 0}, {"index": 1, "score": .5}],
    [{"index": -1, "score": 1}, {"index": 1, "score": .5}],
])
def test_rerank_rejects_invalid_indices_duplicates_and_scores(data):
    with pytest.raises(probe.ProbeFailure, match="invalid_response"):
        probe.validate_result(data, "reranker", provider="siliconflow", raw_model="rerank")


def test_valid_embedding_and_both_provider_rerank_score_shapes():
    assert "维度为 3" in probe.validate_result([[1, 0.5, -0.2]], "embedding", provider="siliconflow", raw_model="embedding")
    for key in ["score", "relevance_score"]:
        assert "2 条" in probe.validate_result([{ "index": 1, key: .2}, {"index": 0, key: .1}], "reranker", provider="aliyun_bailian", raw_model="rerank")


@pytest.mark.parametrize("data", [None, {}, {"choices": []}, {"error": "upstream secret"}, {"choices": [{"message": {"content": " "}}]}])
def test_invalid_text_response_is_not_success(data):
    with pytest.raises(probe.ProbeFailure):
        probe.validate_result(data, "chat", provider="deepseek", raw_model="test")


def test_openrouter_version_alias_succeeds_without_echoing_response_body_or_identity():
    result = probe.validate_result({"model": "private-upstream-identifier", "choices": [{"message": {"content": "private-content"}}]}, "chat", provider="openrouter", raw_model="org/public-alias")
    assert "版本别名" in result
    assert "private" not in result


@pytest.mark.asyncio
@pytest.mark.parametrize("status,code", [(400, "request_rejected"), (401, "authentication"), (402, "billing"), (403, "access_denied"), (404, "not_found"), (429, "rate_limited"), (503, "provider_error")])
async def test_http_failures_are_sanitized_and_do_not_trigger_fallback(monkeypatch, status, code):
    error = httpx.HTTPStatusError("private-token-and-response", request=httpx.Request("POST", "https://secret-url.test"), response=httpx.Response(status, text="private-api-key"))
    standalone = SimpleNamespace(chat_completion=AsyncMock(side_effect=error))
    monkeypatch.setattr(probe, "create_probe_provider", lambda *args: standalone)
    result = await probe.run_probe(None, provider="deepseek", model="deepseek:exact", raw_model="exact", capability="chat")
    assert result["success"] is False and result["error_code"] == code
    assert "private" not in json.dumps(result) and "secret-url" not in json.dumps(result)
    assert standalone.chat_completion.await_count == 1


@pytest.mark.asyncio
async def test_missing_credentials_and_unsupported_adapters_are_explicit():
    result = await probe.run_probe(None, provider="deepseek", model="exact", raw_model="exact", capability="chat")
    assert result["error_code"] == "missing_key"
    assert probe.safe_error_code(NotImplementedError("private details")) == "unsupported"


@pytest.mark.asyncio
async def test_deadline_cancels_attempt_and_restores_concurrency_slot(monkeypatch):
    cancelled = asyncio.Event()
    async def slow(*args):
        try:
            await asyncio.sleep(60)
        finally:
            cancelled.set()
    monkeypatch.setattr(probe, "_perform", slow)
    monkeypatch.setattr(probe, "PROBE_TIMEOUT_SECONDS", .01)
    result = await probe.run_probe(None, provider="deepseek", model="exact", raw_model="exact", capability="chat")
    assert result["error_code"] == "timeout"
    assert cancelled.is_set() and probe._active_probes == 0


@pytest.mark.asyncio
async def test_bounded_concurrency_is_immediate_and_cancel_releases_slot(monkeypatch):
    gate = asyncio.Event()
    started = asyncio.Event()
    async def slow(*args):
        started.set()
        await gate.wait()
        return "valid"
    monkeypatch.setattr(probe, "_perform", slow)
    params = {"provider": "deepseek", "model": "exact", "raw_model": "exact", "capability": "chat"}
    tasks = [asyncio.create_task(probe.run_probe(None, **params)) for _ in range(2)]
    await started.wait()
    assert (await probe.run_probe(None, **params))["error_code"] == "busy"
    tasks[0].cancel()
    with pytest.raises(asyncio.CancelledError):
        await tasks[0]
    assert probe._active_probes == 1
    gate.set()
    assert (await tasks[1])["success"] is True
    assert probe._active_probes == 0


@pytest.mark.asyncio
async def test_video_worker_cancellation_kills_and_reaps_process_with_secret_only_on_stdin(monkeypatch):
    entered = asyncio.Event()
    received = {}
    class Process:
        returncode = None
        killed = False
        waited = False
        async def communicate(self, data):
            received["stdin"] = data
            entered.set()
            await asyncio.sleep(60)
        def kill(self):
            self.killed = True
        async def wait(self):
            self.waited = True
            self.returncode = -9
    process = Process()
    async def spawn(*args, **kwargs):
        received["argv"] = args
        return process
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(probe.isolated_bailian_video(SimpleNamespace(api_key="private-key", base_url="https://base.test"), "model"))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert process.killed and process.waited
    assert "private-key" not in repr(received["argv"])
    assert json.loads(received["stdin"])["api_key"] == "private-key"


@pytest.mark.asyncio
async def test_video_deadline_reaps_a_real_child_process(monkeypatch):
    real_spawn = asyncio.create_subprocess_exec
    children = []
    async def harmless_worker(*args, **kwargs):
        child = await real_spawn(sys.executable, "-c", "import time; time.sleep(60)", **kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(asyncio, "create_subprocess_exec", harmless_worker)
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(probe.isolated_bailian_video(
            SimpleNamespace(api_key="synthetic-key", base_url="https://base.test"), "exact-model",
        ), .1)
    assert len(children) == 1
    assert children[0].returncode is not None and children[0].returncode != 0


@pytest.mark.asyncio
async def test_real_provider_transport_exact_model_no_fallback_and_no_source_mutation(monkeypatch):
    requests = []
    def handle(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={"model": "org/model-dated", "choices": [{"message": {"content": "OK"}}]})
    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: client(*args, transport=httpx.MockTransport(handle), **kwargs))
    source = OpenRouterProvider("synthetic-secret")
    before = copy.deepcopy(source.__dict__)
    result = await probe.run_probe(source, provider="openrouter", model="openrouter:org/model", raw_model="org/model", capability="chat")
    assert result["success"] is True
    assert len(requests) == 1 and requests[0]["model"] == "org/model"
    assert requests[0]["provider"] == {"allow_fallbacks": False}
    assert "models" not in requests[0]
    assert source.__dict__ == before


@pytest.mark.asyncio
@pytest.mark.parametrize("capability,kind", [("vision", "image_url"), ("audio", "input_audio"), ("video", "video_url")])
async def test_multimodal_probes_send_real_synthetic_media(monkeypatch, capability, kind):
    requests = []
    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "org/model", "choices": [{"message": {"content": "Description"}}]})
    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: client(*args, transport=httpx.MockTransport(handle), **kwargs))
    result = await probe.run_probe(OpenRouterProvider("synthetic-secret"), provider="openrouter", model="openrouter:org/model", raw_model="org/model", capability=capability)
    assert result["success"] is True
    media = requests[0]["messages"][0]["content"][1]
    assert media["type"] == kind
    if capability == "audio":
        assert base64.b64decode(media[kind]["data"])[:4] == b"RIFF"
    elif capability == "vision":
        assert base64.b64decode(media[kind]["url"].split(",", 1)[1])[:8] == b"\x89PNG\r\n\x1a\n"
    else:
        assert base64.b64decode(media[kind]["url"].split(",", 1)[1])[4:8] == b"ftyp"


@pytest.mark.asyncio
async def test_bailian_rerank_probe_does_not_fabricate_missing_scores(monkeypatch):
    def handle(request):
        return httpx.Response(200, json={"results": [{"index": 0}, {"index": 1}]})
    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: client(*args, transport=httpx.MockTransport(handle), **kwargs))
    result = await probe.run_probe(AliyunBailianProvider("synthetic-key"), provider="aliyun_bailian", model="aliyun_bailian:qwen3-rerank", raw_model="qwen3-rerank", capability="reranker")
    assert result["error_code"] == "invalid_response"


def test_provider_clone_has_no_shared_runtime_registry():
    source = DeepSeekProvider("synthetic-key")
    source.set_registry(object())
    clone = probe.create_probe_provider(source, "deepseek")
    assert clone is not source and clone._registry is None
    assert clone.api_key == source.api_key and clone.base_url == source.base_url
