"""Contract/failure tests only; model quality is measured by evaluate_jev.py."""
import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.llm.jev import JevClient, JevError, JevScores
from app.core.llm.manager import LLMCallResult
from app.modules.retrieval.reranker import Reranker


def response(scores=(.2, .9)):
    return {"model": "jev-1.13.0", "answers": {
        f"d{i}": {"type": "noul", "noul": score} for i, score in enumerate(scores)
    }, "usage": {"input_tokens": 500, "output_tokens": 40}}


@pytest.mark.asyncio
async def test_one_batch_isolates_documents_and_joins_by_id_not_answer_order():
    calls = []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert body['state'] == {'query': '问题'}
        assert body['questions']['d0']['instructions']['passage'] == 'A'
        assert body['questions']['d1']['instructions']['passage'] == 'B'
        data = response()
        data['answers'] = dict(reversed(list(data['answers'].items())))
        return httpx.Response(200, json=data)
    client = JevClient('secret', transport=httpx.MockTransport(handler))
    result = await client.score('问题', ['A', 'B'])
    assert result.scores == [{'index': 0, 'relevance_score': .2}, {'index': 1, 'relevance_score': .9}]
    assert len(calls) == 1
    assert client.reserved_input_tokens == 500
    assert result.metadata()['estimated_usd'] == pytest.approx(.000021)


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', [float('nan'), float('inf'), -1, 1.01, True, '0.8', None])
async def test_invalid_scores_never_become_rankings(bad):
    # httpx JSON encoding rejects nonfinite; raw content intentionally tests decoder.
    transport = httpx.MockTransport(lambda _: httpx.Response(200, content=json.dumps(response((bad, .9))).encode()))
    client = JevClient('secret', transport=transport)
    with pytest.raises(JevError, match='invalid_score'):
        await client.score('q', ['A', 'B'])
    assert client.reserved_input_tokens > 500  # Unknown billing keeps reservation.


@pytest.mark.asyncio
@pytest.mark.parametrize('mutation,reason', [
    (lambda d: d['answers'].pop('d1'), 'incomplete_answers'),
    (lambda d: d.update(model='jev-latest'), 'model_mismatch'),
    (lambda d: d['usage'].update(input_tokens=-1), 'invalid_usage'),
])
async def test_partial_or_wrong_model_responses_fail_intact(mutation, reason):
    data = response()
    mutation(data)
    client = JevClient('secret', transport=httpx.MockTransport(lambda _: httpx.Response(200, json=data)))
    with pytest.raises(JevError, match=reason):
        await client.score('q', ['A', 'B'])


@pytest.mark.asyncio
async def test_budget_is_reserved_atomically_before_await_and_not_reset_on_failure():
    calls = 0
    async def handler(request):
        nonlocal calls
        calls += 1
        await asyncio.sleep(.01)
        return httpx.Response(503, text='secret reflected by server')
    client = JevClient('secret', max_input_tokens=3500, transport=httpx.MockTransport(handler))
    results = await asyncio.gather(*(client.score('q', ['A']) for _ in range(5)), return_exceptions=True)
    assert calls == 1
    assert str(results[0]) == 'http_503'
    assert all(str(exc) == 'budget_exhausted' for exc in results[1:])
    assert 'secret' not in str(results)


@pytest.mark.asyncio
async def test_rate_limit_opens_circuit_without_retry():
    calls = 0
    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429)
    client = JevClient('secret', transport=httpx.MockTransport(handler))
    with pytest.raises(JevError, match='http_429'):
        await client.score('q', ['A'])
    with pytest.raises(JevError, match='circuit_open'):
        await client.score('q', ['A'])
    assert calls == 1


@pytest.mark.asyncio
async def test_deadline_and_cancellation_do_not_leak_network_tasks():
    cancelled = asyncio.Event()
    async def handler(request):
        try:
            await asyncio.sleep(20)
        finally:
            cancelled.set()
    client = JevClient('secret', timeout_s=.03, transport=httpx.MockTransport(handler))
    with pytest.raises(JevError, match='timeout'):
        await client.score('q', ['A'])
    assert cancelled.is_set()
    client.timeout_s = 10
    task = asyncio.create_task(client.score('q', ['A']))
    await asyncio.sleep(.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def fixture_ranker():
    ranker = Reranker()
    ranker.jev_mode = 'off'
    ranker.llm_manager = SimpleNamespace(rerank=AsyncMock(return_value=LLMCallResult(success=True, data=[
        {'index': 0, 'relevance_score': .9}, {'index': 1, 'relevance_score': .1},
    ])))
    ranker.jev_client = SimpleNamespace(score=AsyncMock(return_value=JevScores(
        [{'index': 0, 'relevance_score': .1}, {'index': 1, 'relevance_score': .9}],
        'jev-1.13.0', {'input_tokens': 500, 'output_tokens': 40}, .1)))
    raw = {'dense': [{'id': str(i), 'score': 1 / (61 + i), 'content_type': 'doc',
                      'payload': {'text_content': f'evidence {i}', 'kb_id': 'authorized-kb', 'file_id': f'file-{i}'}}
                     for i in range(2)]}
    return ranker, raw


@pytest.mark.asyncio
async def test_disabled_shadow_replace_and_failure_preserve_scope_and_input():
    ranker, raw = fixture_ranker()
    original = copy.deepcopy(raw)
    baseline = await ranker.rerank('q', raw)
    ranker.jev_client.score.assert_not_awaited()
    ranker.jev_mode = 'shadow'
    shadow = await ranker.rerank('q', raw)
    assert shadow['results'] == baseline['results']
    assert shadow['scorer']['proposed_ids'] == ['1', '0']
    ranker.jev_mode = 'replace'
    ranker.llm_manager.rerank.reset_mock()
    replaced = await ranker.rerank('q', raw)
    assert [r['id'] for r in replaced['results']] == ['1', '0']
    ranker.llm_manager.rerank.assert_not_awaited()
    assert all(r['payload']['kb_id'] == 'authorized-kb' for r in replaced['results'])
    ranker.jev_client.score.side_effect = JevError('timeout')
    fallback = await ranker.rerank('q', raw)
    assert fallback['results'] == baseline['results']
    assert fallback['scorer']['reason'] == 'timeout'
    ranker.llm_manager.rerank.assert_awaited_once()
    assert raw == original


@pytest.mark.asyncio
async def test_jev_keeps_explicit_modality_reservations_even_with_zero_scores():
    ranker = Reranker()
    ranker.jev_mode = 'replace'
    ranker.top_k = 20
    ranker.final_top_k = 5
    async def scores(query, docs):
        return JevScores([{'index': i, 'relevance_score': .9 if '文档' in d else 0}
                          for i, d in enumerate(docs)], 'jev-1.13.0', {'input_tokens': 500, 'output_tokens': 40}, .1)
    ranker.jev_client = SimpleNamespace(score=scores)
    raw = {'dense': [{'id': f't{i}', 'score': 1, 'content_type': 'doc', 'payload': {'text_content': 'text'}} for i in range(22)],
           'video': [{'id': f'v{i}', 'score': .001, 'content_type': 'video', 'payload': {'description': 'clip'}} for i in range(2)]}
    result = await ranker.rerank('show videos', raw, SimpleNamespace(video_intent='explicit_demand'))
    assert sum(r['content_type'] == 'video' for r in result['results']) == 2
    assert len(result['results']) == 5
