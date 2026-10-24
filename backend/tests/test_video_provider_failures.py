"""Provider refusals remain request-scoped and never fan out into automatic retries."""
import sys
from types import SimpleNamespace

import httpx
import pytest

from app.core.llm.model_health import ModelHealth, ProviderAPIError, classify_error, raise_for_stream_error
from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
from test_model_call_reliability import manager, registry, failure


@pytest.mark.parametrize('code', ['DataInspectionFailed', 'data_inspection_failed'])
def test_refusal_metadata_is_request_scoped_without_raw_content(code):
    error = ProviderAPIError('private provider response', status_code=400, code=code, request_id='request-123')
    evidence = classify_error(error)
    assert evidence['category'] == 'content_policy'
    assert evidence['scope'] == 'request' and evidence['cooldown_seconds'] == 0
    assert evidence['retryable'] is False and evidence['request_id'] == 'request-123'
    assert 'private' not in str(evidence)
    health = ModelHealth()
    health.record('p', 'model', 'chat_completion', duration=.1, error=error)
    assert health.blocked('p', 'model', 'chat_completion') is None


def test_http_and_stream_request_ids_are_preserved():
    response = httpx.Response(400, json={'error': {'code': 'DataInspectionFailed', 'message': 'private'}},
                              headers={'x-request-id': 'http-request'}, request=httpx.Request('POST', 'https://example.test'))
    evidence = classify_error(httpx.HTTPStatusError('failed', request=response.request, response=response))
    assert evidence['category'] == 'content_policy' and evidence['request_id'] == 'http-request'
    with pytest.raises(ProviderAPIError) as caught:
        raise_for_stream_error({'request_id': 'stream-request', 'error': {'code': 'data_inspection_failed'}})
    assert classify_error(caught.value)['request_id'] == 'stream-request'


@pytest.mark.asyncio
@pytest.mark.parametrize('rejecting_model', ['a', 'b'])
async def test_nonstream_refusal_stops_primary_or_fallback_chain(rejecting_model):
    r = registry(); m = manager(r); calls = []
    async def chat(**kwargs):
        calls.append(kwargs['model'])
        if kwargs['model'] == rejecting_model:
            raise ProviderAPIError('private input', status_code=400, code='DataInspectionFailed', request_id='request-456')
        raise failure(503)
    r._providers['p'].chat_completion = chat
    result = await m.chat([])
    assert not result.success and result.error_category == 'content_policy'
    assert result.provider_code == 'DataInspectionFailed' and result.request_id == 'request-456'
    assert result.retryable is False and 'private' not in result.error
    assert calls == (['a'] if rejecting_model == 'a' else ['a', 'b'])
    assert not r.model_health.blocked('p', rejecting_model, 'chat_completion')


@pytest.mark.asyncio
async def test_stream_refusal_stops_before_any_fallback():
    r = registry(); m = manager(r); calls = []; closed = []
    async def stream(**kwargs):
        calls.append(kwargs['model'])
        try:
            yield {'error': {'code': 'DataInspectionFailed', 'status': 400, 'request_id': 'stream-789'}}
        finally:
            closed.append(kwargs['model'])
    r._providers['p'].stream_chat = stream
    with pytest.raises(ProviderAPIError):
        async for _ in m.stream_chat([]):
            pytest.fail('refused request must not emit text')
    assert calls == ['a'] and closed == ['a']


@pytest.mark.asyncio
@pytest.mark.parametrize('as_dict', [False, True])
async def test_dashscope_sdk_error_keeps_code_and_request_id(monkeypatch, as_dict):
    error = {'status_code': 400, 'code': 'DataInspectionFailed', 'message': 'private response', 'request_id': 'sdk-123', 'output': None}
    response = error if as_dict else SimpleNamespace(**error)
    call = lambda **_kwargs: response if not as_dict else [response]
    monkeypatch.setitem(sys.modules, 'dashscope', SimpleNamespace(MultiModalConversation=SimpleNamespace(call=call)))
    provider = AliyunBailianProvider('fake-offline-key')
    with pytest.raises(ProviderAPIError) as caught:
        await provider._chat_completion_video_local(path='/tmp/fake.mp4', fps=1, text='fixture', model='qwen-test', kwargs={})
    assert caught.value.code == 'DataInspectionFailed' and caught.value.request_id == 'sdk-123'
    assert 'private' not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize('response_kind', ['http', 'sse'])
async def test_real_bailian_stream_adapter_does_not_lose_refusal(monkeypatch, response_kind):
    import json
    requests = []
    payload = {'error': {'code': 'DataInspectionFailed', 'message': 'private response', 'request_id': 'adapter-request'}}
    def handler(request):
        requests.append(json.loads(request.content)['model'])
        if response_kind == 'http':
            return httpx.Response(400, json=payload)
        return httpx.Response(200, text='data: ' + json.dumps(payload) + '\n\n', headers={'content-type': 'text/event-stream'})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda *a, **kw: original(*a, transport=httpx.MockTransport(handler), **kw))
    r = registry()
    r._providers['p'] = AliyunBailianProvider('fake-offline-key')
    with pytest.raises((ProviderAPIError, httpx.HTTPStatusError)) as caught:
        async for _ in manager(r).stream_chat([]):
            pytest.fail('refused request must not emit text')
    evidence = classify_error(caught.value)
    assert requests == ['a']
    assert evidence['category'] == 'content_policy' and evidence['request_id'] == 'adapter-request'
    assert evidence['retryable'] is False
