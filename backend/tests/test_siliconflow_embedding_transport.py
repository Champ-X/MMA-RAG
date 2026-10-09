"""Embedding transport diagnostics never retain private request/response data."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.core.config import Settings, settings
from app.core.llm import LLMRegistry
from app.core.llm.providers import silicon_flow as module


PRIVATE = "private-input-or-provider-detail"
KEY = "private-api-key"


@pytest.fixture
def logs(monkeypatch):
    records = []
    monkeypatch.setattr(module, "logger", SimpleNamespace(
        log=lambda level, template, *values: records.append((level, template.format(*values))),
    ))
    return records


def transport_factory(monkeypatch, handler):
    constructor_args = []
    real_client = httpx.AsyncClient

    def create(**kwargs):
        constructor_args.append(dict(kwargs))
        return real_client(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(module.httpx, "AsyncClient", create)
    return constructor_args


def assert_safe(logs):
    rendered = repr(logs)
    assert PRIVATE not in rendered and KEY not in rendered
    assert "Authorization" not in rendered and "Bearer" not in rendered


@pytest.mark.asyncio
@pytest.mark.parametrize("header_wait,level", [(0.1, "DEBUG"), (1.1, "INFO")])
async def test_trace_summarizes_transport_phases_without_private_info(monkeypatch, logs, header_wait, level):
    clock = [10.0]
    monkeypatch.setattr(module, "time", SimpleNamespace(perf_counter=lambda: clock[0]))
    payloads = []

    async def handler(request):
        payloads.append(json.loads(request.content))
        trace = request.extensions["trace"]
        for operation, duration in [
            ("connection.connect_tcp", .01), ("connection.start_tls", .02),
            ("http11.send_request_headers", .003), ("http11.send_request_body", .004),
            ("http11.receive_response_headers", header_wait), ("http11.receive_response_body", .01),
        ]:
            await trace(operation + ".started", {"headers": [("Authorization", KEY)], "body": PRIVATE})
            clock[0] += duration
            await trace(operation + ".complete", {"return_value": PRIVATE})
        await trace("http11.response_closed.complete", {"private": PRIVATE})
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 0.0]}]})

    transport_factory(monkeypatch, handler)
    provider = module.SiliconFlowProvider(KEY)
    try:
        assert await provider.embed_texts([PRIVATE], "indexed-model") == [[1.0, 0.0]]
    finally:
        await provider.close()
    assert payloads == [{"model": "indexed-model", "input": [PRIVATE]}]
    assert len(logs) == 1 and logs[0][0] == level
    message = logs[0][1]
    assert "model=indexed-model batch_size=1 status=ok" in message
    assert "last_phase=response_body" in message and "status_code=200" in message
    phases = json.loads(message.split("phase_durations=", 1)[1].split(" error_type=", 1)[0])
    assert phases == {
        "dns_tcp": .01, "tls": .02, "request_headers": .003,
        "request_body": .004, "response_headers": header_wait, "response_body": .01,
    }
    assert_safe(logs)


@pytest.mark.asyncio
async def test_cancellation_keeps_last_inflight_phase_and_does_not_retry(monkeypatch, logs):
    entered = asyncio.Event()
    requests = []
    clock = [10.0]
    monkeypatch.setattr(module, "time", SimpleNamespace(perf_counter=lambda: clock[0]))

    async def handler(request):
        requests.append(request)
        await request.extensions["trace"]("http11.receive_response_headers.started", {"private": PRIVATE})
        entered.set()
        await asyncio.Event().wait()

    clients = transport_factory(monkeypatch, handler)
    provider = module.SiliconFlowProvider(KEY, embedding_trust_env=False)
    task = asyncio.create_task(provider.embed_texts([PRIVATE], "indexed-model"))
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        clock[0] += 12
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        task.cancel()
        await provider.close()
    assert len(requests) == len(clients) == 1
    assert logs[0][0] == "WARNING"
    assert "status=cancelled duration=12.000s last_phase=response_headers" in logs[0][1]
    assert '"response_headers": 12.0' in logs[0][1]
    assert_safe(logs)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "timeout", "runtime"])
async def test_failure_logs_are_safe_and_never_retry_http_or_timeout(monkeypatch, logs, failure):
    calls = []

    async def handler(request):
        calls.append(request)
        trace = request.extensions["trace"]
        await trace("http11.receive_response_headers.started", {"private": PRIVATE})
        if failure == "http":
            await trace("http11.receive_response_headers.complete", {"return_value": PRIVATE})
            return httpx.Response(503, text=PRIVATE, headers={"private": KEY})
        error = httpx.ReadTimeout(PRIVATE) if failure == "timeout" else RuntimeError(PRIVATE)
        await trace("http11.receive_response_headers.failed", {"exception": error})
        raise error

    clients = transport_factory(monkeypatch, handler)
    provider = module.SiliconFlowProvider(KEY)
    expected = {"http": httpx.HTTPStatusError, "timeout": httpx.ReadTimeout, "runtime": RuntimeError}[failure]
    try:
        with pytest.raises(expected):
            await provider.embed_texts([PRIVATE], "indexed-model")
    finally:
        await provider.close()
    assert len(calls) == len(clients) == len(logs) == 1
    assert logs[0][0] == "WARNING" and "status=error" in logs[0][1]
    assert "last_phase=response_headers" in logs[0][1]
    if failure == "http":
        assert "status_code=503" in logs[0][1]
    assert_safe(logs)


@pytest.mark.asyncio
@pytest.mark.parametrize("trust_env", [True, False])
async def test_embedding_trust_env_does_not_change_chat_transport(monkeypatch, logs, trust_env):
    def handler(request):
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}], "choices": [{}]})

    clients = transport_factory(monkeypatch, handler)
    provider = module.SiliconFlowProvider(KEY, embedding_trust_env=trust_env)
    try:
        assert await provider.embed_texts([PRIVATE], "indexed-model") == [[1.0]]
        await provider.chat_completion([{"role": "user", "content": PRIVATE}], "chat-model")
    finally:
        await provider.close()
    assert clients[0] == {"timeout": 60.0, "trust_env": trust_env}
    assert len(clients) == 2 and "trust_env" not in clients[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("trust_env", [True, False])
async def test_existing_event_loop_recovery_retains_embedding_transport_setting(monkeypatch, logs, trust_env):
    models = []

    def handler(request):
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            raise RuntimeError("Event loop is closed " + PRIVATE)
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}]})

    clients = transport_factory(monkeypatch, handler)
    provider = module.SiliconFlowProvider(KEY, embedding_trust_env=trust_env)
    try:
        assert await provider.embed_texts([PRIVATE], "indexed-model") == [[1.0]]
    finally:
        await provider.close()
    assert models == ["indexed-model", "indexed-model"]
    assert clients == [{"timeout": 60.0, "trust_env": trust_env}] * 2
    assert [level for level, _ in logs] == ["WARNING", "DEBUG"]
    assert_safe(logs)


def test_embedding_trust_env_default_and_environment_override(monkeypatch):
    monkeypatch.delenv("SILICONFLOW_EMBEDDING_TRUST_ENV", raising=False)
    assert Settings(_env_file=None, SILICONFLOW_API_KEY=KEY).siliconflow_embedding_trust_env is True
    monkeypatch.setenv("SILICONFLOW_EMBEDDING_TRUST_ENV", "false")
    assert Settings(_env_file=None, SILICONFLOW_API_KEY=KEY).siliconflow_embedding_trust_env is False


def test_registry_supplies_embedding_transport_setting(monkeypatch):
    import app.core.llm as registry_module

    captured = []

    def provider(api_key, **kwargs):
        captured.append(kwargs)
        return SimpleNamespace(set_registry=lambda _: None)

    monkeypatch.setattr(registry_module, "SiliconFlowProvider", provider)
    monkeypatch.setattr(settings, "siliconflow_embedding_trust_env", False)
    for field in ("deepseek_api_key", "openrouter_api_key", "aliyun_bailian_api_key"):
        monkeypatch.setattr(settings, field, None)
    monkeypatch.setattr(LLMRegistry, "_apply_saved_task_overrides", lambda _: None)
    registry = LLMRegistry()
    assert registry.get_provider("siliconflow") is not None
    assert captured == [{"embedding_trust_env": False}]
