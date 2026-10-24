"""Offline checks for DashScope's incremental video completion contract."""
import json
import sys
from types import SimpleNamespace

import pytest

from app.core.llm.model_health import ProviderAPIError
from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider


def sdk_response(as_dict, *, text="", reason=None, usage=None, request_id=None, output_kind="choices", status=200, code=None):
    content = [{"text": text}]
    message = {"role": "assistant", "content": content}
    choice = {"message": message, "finish_reason": reason}
    if not as_dict:
        choice = SimpleNamespace(message=SimpleNamespace(role="assistant", content=[SimpleNamespace(text=text)]),
                                 finish_reason=reason)
    choices = [choice] if output_kind == "choices" else []
    output = {"choices": choices} if as_dict else SimpleNamespace(choices=choices)
    if output_kind == "none":
        output = None
    data = {"status_code": status, "output": output, "usage": usage, "request_id": request_id, "code": code}
    return data if as_dict else SimpleNamespace(**data)


async def complete(monkeypatch, responses):
    calls = []
    def call(**kwargs):
        calls.append(kwargs)
        return responses
    monkeypatch.setitem(sys.modules, "dashscope", SimpleNamespace(MultiModalConversation=SimpleNamespace(call=call)))
    result = await AliyunBailianProvider("offline-key")._chat_completion_video_local(
        path="/tmp/offline.mp4", fps=2, text="fixture", model="qwen-test", kwargs={})
    assert len(calls) == 1 and calls[0]["stream"] is True and calls[0]["incremental_output"] is True
    return result


@pytest.mark.asyncio
@pytest.mark.parametrize("as_dict", [False, True])
@pytest.mark.parametrize("output_kind", ["none", "empty_choices"])
@pytest.mark.parametrize("reason", ["stop", "length"])
async def test_repeated_incremental_prefix_is_preserved_before_usage_only_chunk(monkeypatch, as_dict, output_kind, reason):
    responses = [
        sdk_response(as_dict, text="[", request_id="stream-receipt"),
        # This delta begins with the entire preceding output. It must still be appended.
        sdk_response(as_dict, text="[1]", reason="null"),
        sdk_response(as_dict, text="]", reason=reason),
        sdk_response(as_dict, usage={"input_tokens": 5, "output_tokens": 5, "total_tokens": 10}, output_kind=output_kind),
    ]
    result = await complete(monkeypatch, iter(responses))
    assert result["choices"][0]["message"]["content"] == "[[1]]"
    assert json.loads(result["choices"][0]["message"]["content"]) == [[1]]
    assert result["choices"][0]["finish_reason"] == reason
    assert result["request_id"] == "stream-receipt"
    assert result["usage"]["total_tokens"] == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("as_dict", [False, True])
async def test_single_sdk_response_retains_finish_and_request_metadata(monkeypatch, as_dict):
    response = sdk_response(as_dict, text='{"ok":true}', reason="stop", request_id="single-receipt",
                            usage={"total_tokens": 4})
    result = await complete(monkeypatch, response)
    assert json.loads(result["choices"][0]["message"]["content"]) == {"ok": True}
    assert result["choices"][0]["finish_reason"] == "stop"
    assert result["request_id"] == "single-receipt"
    assert result["usage"] == {"total_tokens": 4}


@pytest.mark.asyncio
@pytest.mark.parametrize("as_dict", [False, True])
async def test_late_error_does_not_return_partial_json(monkeypatch, as_dict):
    responses = [
        sdk_response(as_dict, text='{"partial":', request_id="partial-receipt"),
        sdk_response(as_dict, status=400, code="DataInspectionFailed", request_id="error-receipt", output_kind="none"),
    ]
    with pytest.raises(ProviderAPIError) as caught:
        await complete(monkeypatch, iter(responses))
    assert caught.value.code == "DataInspectionFailed"
    assert caught.value.request_id == "error-receipt"
    assert caught.value.status_code == 400
