"""Flash routes send reasoning and JSON-mode options on actual HTTP payloads."""
import json

import httpx
import pytest

from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
from app.core.llm.providers.deepseek import DeepSeekProvider


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("model,options,expected", [
    ("qwen3.5-flash", {}, False),
    ("qwen3.5-flash", {"enable_thinking": True}, True),
    ("qwen3.5-plus", {}, None),
])
async def test_flash_defaults_to_no_thinking_without_overriding_explicit_choice(
    monkeypatch, stream, model, options, expected,
):
    payloads = []

    def handle(request):
        payload = json.loads(request.content)
        payloads.append(payload)
        if payload["stream"]:
            return httpx.Response(200, text=(
                'data: {"choices":[{"delta":{"content":"ready"}}]}\n\n'
                'data: [DONE]\n\n'
            ), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ready"}}]})

    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: client(
        *a, transport=httpx.MockTransport(handle), **kw,
    ))
    provider = AliyunBailianProvider("synthetic-test-key")
    kwargs = dict(messages=[{"role": "user", "content": "Return JSON"}], model=model,
                  max_tokens=16, response_format={"type": "json_object"}, **options)
    if stream:
        chunks = [chunk async for chunk in provider.stream_chat(**kwargs)]
        assert chunks[0]["choices"][0]["delta"]["content"] == "ready"
    else:
        result = await provider.chat_completion(**kwargs)
        assert result["choices"][0]["message"]["content"] == "ready"
    assert len(payloads) == 1
    assert payloads[0]["response_format"] == {"type": "json_object"}
    if expected is None:
        assert "enable_thinking" not in payloads[0]
    else:
        assert payloads[0]["enable_thinking"] is expected


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("options,expected", [
    ({}, {"type": "disabled"}),
    ({"thinking": {"type": "enabled"}}, {"type": "enabled"}),
])
async def test_deepseek_flash_reserves_tokens_for_content(monkeypatch, stream, options, expected):
    payloads = []

    def handle(request):
        payload = json.loads(request.content)
        payloads.append(payload)
        if payload["stream"]:
            return httpx.Response(200, text=(
                'data: {"choices":[{"delta":{"content":"ready"}}]}\n\n'
                'data: [DONE]\n\n'
            ), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ready"}}]})

    client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: client(
        *a, transport=httpx.MockTransport(handle), **kw,
    ))
    provider = DeepSeekProvider("synthetic-test-key")
    kwargs = dict(messages=[{"role": "user", "content": "Return JSON"}], model="deepseek-flash",
                  max_tokens=16, response_format={"type": "json_object"}, **options)
    if stream:
        chunks = [chunk async for chunk in provider.stream_chat(**kwargs)]
        assert chunks[0]["choices"][0]["delta"]["content"] == "ready"
    else:
        result = await provider.chat_completion(**kwargs)
        assert result["choices"][0]["message"]["content"] == "ready"
    assert payloads[0]["thinking"] == expected
    assert payloads[0]["response_format"] == {"type": "json_object"}
