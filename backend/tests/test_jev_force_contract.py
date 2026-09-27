"""Forced Jev failures must reach users without success, fallback or generation."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi import FastAPI
from app.api import chat
from app.core.llm.jev import JevRequiredError
from app.modules.retrieval.service import RetrievalService
from app.modules.agent.service import AgenticRetrievalService
from app.modules.agent.models import AgentDecision


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['preprocess', 'rerank', 'modality'])
async def test_retrieval_wrappers_do_not_swallow_required_jev_failure(method):
    service = RetrievalService.__new__(RetrievalService)
    failure = JevRequiredError('rerank' if method == 'rerank' else 'intent', 'timeout')
    service.intent_processor = SimpleNamespace(process=AsyncMock(side_effect=failure))
    service.query_rewriter = SimpleNamespace(rewrite=AsyncMock(side_effect=AssertionError('must not rewrite')))
    service.reranker = SimpleNamespace(rerank=AsyncMock(side_effect=failure))
    with pytest.raises(JevRequiredError) as caught:
        if method == 'preprocess':
            await service._preprocess_query('茶叶驯化史', [])
        elif method == 'modality':
            await service.get_agent_modality_requirements(query='茶叶驯化史')
        else:
            await service._apply_reranking(SimpleNamespace(refined_query='茶叶驯化史'), {'raw_results': {}})
    assert caught.value is failure
    service.query_rewriter.rewrite.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['_prepare_original_query_anchor', '_run_original_query_anchor', '_get_modality_requirements'])
async def test_agent_anchor_failure_is_not_replaced_by_child_search(method):
    failure = JevRequiredError('intent', 'timeout')
    retriever = SimpleNamespace(prepare_agent_original_query=AsyncMock(side_effect=failure),
        search=AsyncMock(side_effect=failure), get_agent_modality_requirements=AsyncMock(side_effect=failure))
    service = AgenticRetrievalService(retriever)
    kwargs = dict(query='茶叶驯化史', kb_context=None, session_context=[], attachment_context=None)
    if method == '_run_original_query_anchor': kwargs['preprocessing_result'] = {}
    with pytest.raises(JevRequiredError): await getattr(service, method)(**kwargs)


@pytest.mark.asyncio
async def test_agent_does_not_turn_partial_round_failure_into_success():
    async def search(query, **kwargs):
        if query == '失败的子查询': raise JevRequiredError('rerank', 'timeout')
        return object()  # A successful sibling must not hide the forced-stage failure.
    service = AgenticRetrievalService(SimpleNamespace(search=search))
    service._prepare_original_query_anchor = AsyncMock(return_value=None)
    service._get_modality_requirements = AsyncMock(return_value={})
    service.planner = SimpleNamespace(decide=AsyncMock(return_value=AgentDecision(
        action='search', queries=['成功的子查询', '失败的子查询'])))
    with pytest.raises(JevRequiredError):
        async for _ in service.search_stream(query='介绍茶史'): pass


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['direct', 'agent'])
@pytest.mark.parametrize('multipart', [False, True])
async def test_http_stream_reports_explicit_failure_without_saving_success(monkeypatch, mode, multipart):
    async def fail(**kwargs):
        yield 'intent', {'stage_status': 'processing'}
        raise JevRequiredError('intent', 'budget_exhausted')
    monkeypatch.setattr(chat, 'sessions', {})
    monkeypatch.setattr(chat, 'retrieval_service', SimpleNamespace(search_stream=fail))
    monkeypatch.setattr(chat, 'agentic_retrieval_service', SimpleNamespace(search_stream=fail))
    generation = AsyncMock(side_effect=AssertionError('must not generate'))
    monkeypatch.setattr(chat, 'generation_service', SimpleNamespace(stream_generate_response=generation))
    app = FastAPI();app.include_router(chat.router, prefix='/api/chat')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
        fields = dict(message='茶叶驯化史', sessionId='force-failure', agentMode=mode)
        response = await c.post('/api/chat/stream', data=fields) if multipart else await c.get('/api/chat/stream', params=fields)
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'error'
    assert events[-1]['diagnostics'] == {'code':'jev_required_failed', 'stage':'intent', 'reason':'budget_exhausted', 'fallback_used':False}
    assert '未回退' in events[-1]['message']
    assert not any(event['type'] in {'complete','message'} for event in events)
    assert chat.sessions['force-failure']['messages'] == []
    generation.assert_not_called()


def test_required_error_never_exposes_provider_payload():
    error = JevRequiredError('intent', 'secret_provider_payload')
    assert error.reason == 'unexpected_error'
    assert 'secret_provider_payload' not in str(error)


@pytest.mark.asyncio
@pytest.mark.parametrize('query', ['你好', '茶叶驯化史'])
async def test_force_intent_does_not_disappear_behind_greeting_or_empty_index_shortcuts(monkeypatch, query):
    from app.modules.retrieval import service as module
    monkeypatch.setattr(module, 'get_jev_config', lambda: SimpleNamespace(intent_mode='force'))
    service = RetrievalService.__new__(RetrievalService)
    probe = AsyncMock(return_value=True)
    service.search_engine = SimpleNamespace(vector_store=SimpleNamespace(is_retrieval_index_empty=probe))
    assert await service._try_fast_path(query, None, [], None, allow_smalltalk=True) is None
    probe.assert_not_awaited()
