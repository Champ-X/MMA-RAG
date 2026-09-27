"""Factual queries must reach evidence in a non-text routed KB in both paths."""
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.modules.knowledge.router import RoutingResult
from app.modules.retrieval.service import RetrievalService, _apply_target_modality_fallback


def prepared(query='介绍一下茶叶的驯化史'):
    return dict(original_query=query, refined_query=query, intent_type='factual', is_complex=False,
                visual_intent='unnecessary', audio_intent='unnecessary', video_intent='unnecessary',
                search_strategies={'dense_query': query, 'sparse_keywords': [], 'multi_view_queries': []})


def service_fixture(inventory):
    service = RetrievalService.__new__(RetrievalService)
    service._try_fast_path = AsyncMock(return_value=None)
    service._preprocess_query = AsyncMock(return_value=prepared())
    service.kb_router = SimpleNamespace(
        route_query=AsyncMock(return_value=RoutingResult(['tea'], {'tea': 1.0}, 'semantic', 1, 0)),
        get_modality_inventory=AsyncMock(return_value=inventory),
        resolve_to_qdrant_kb_ids=AsyncMock(return_value=['tea']),
    )
    async def search(**kw):
        assert kw['target_kb_ids'] == ['tea']
        assert kw['target_file_ids'] == []
        results = [{'id': 'tea-shot', 'content_type': 'video'}] if kw['video_intent'] == 'implicit_enrichment' else []
        return {'raw_results': {'video': results}}
    service.search_engine = SimpleNamespace(search=search)
    service.reranker = SimpleNamespace(rerank=AsyncMock(side_effect=lambda **kw: {'results': kw['raw_results']['video']}))
    service._update_retrieval_stats = lambda **kw: None
    return service


@pytest.mark.asyncio
@pytest.mark.parametrize('stream', [False, True])
async def test_direct_search_reaches_video_evidence_without_agent_or_media_keywords(stream):
    service = service_fixture({'tea': {'name': '生物科普', 'text': 0, 'video': 397}})
    if stream:
        events = [event async for event in service.search_stream('介绍一下茶叶的驯化史')]
        result = events[-1][1]
        intents = [p for stage, p in events if stage == 'intent']
        assert intents[-1]['video_intent'] == 'implicit_enrichment'
        assert intents[-1]['target_modality_fallback']['available_count'] == 397
    else:
        result = await service.search('介绍一下茶叶的驯化史')
    assert result.reranked_results[0]['id'] == 'tea-shot'
    assert result.context.video_intent == 'implicit_enrichment'
    assert result.debug_info['target_modality_fallback']['kb_id'] == 'tea'
    service.reranker.rerank.assert_awaited_once()


@pytest.mark.parametrize('inventory,intents', [
    ({'tea': {'text': 1, 'video': 397}}, {}),
    ({'tea': {'text': 0, 'video': 0}}, {}),
    ({'tea': {'text': 0, 'video': 397}}, {'visual_intent': 'explicit_demand'}),
    ({'outside': {'text': 0, 'video': 397}}, {}),
])
def test_no_blanket_expansion_or_out_of_scope_anchor(inventory, intents):
    original = {**prepared(), **intents}
    updated, info = _apply_target_modality_fallback(original, target_kb_ids=['tea'],
        modality_inventory=inventory, routing_details={'anchor_kb_id': 'outside'})
    assert updated == original
    assert info == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('query,files', [
    ('介绍茶史，不要视频', []), ('只查文档介绍茶史', []),
    ('Tea history without video', []), ('Tea history', [{'file_id': 'selected'}]),
])
async def test_explicit_source_restrictions_do_not_trigger_inventory_fallback(query, files):
    service = service_fixture({'tea': {'text': 0, 'video': 397}})
    original = prepared(query)
    updated, info = await service._prepare_target_modality(original,
        SimpleNamespace(target_kb_ids=['tea']), selected_files=files)
    assert updated == original and info == {}
    service.kb_router.get_modality_inventory.assert_not_awaited()


@pytest.mark.asyncio
async def test_inventory_failure_retains_original_strategy_without_mutating_it():
    service = service_fixture({})
    service.kb_router.get_modality_inventory.side_effect = RuntimeError('unavailable')
    original = prepared()
    snapshot = copy.deepcopy(original)
    updated, info = await service._prepare_target_modality(original,
        SimpleNamespace(target_kb_ids=['tea']), selected_files=[])
    assert updated == snapshot and original == snapshot and info == {}


def test_history_diagnostics_keep_actual_jev_use_and_fallback_without_source_payloads():
    from app.api.chat import _retrieval_diagnostics
    run = {'jev_decision': {'accepted': False, 'reason': 'uncertain_or_complex'},
           'reranking_scorer': {'mode': 'replace', 'status': 'ok'},
           'target_modality_fallback': {'modality': 'video'}, 'source_payload': 'private'}
    direct = _retrieval_diagnostics(SimpleNamespace(debug_info=run))
    agent = _retrieval_diagnostics(SimpleNamespace(debug_info={'retrieval_runs': [run]}))
    assert direct == agent
    assert direct['runs'][0]['jev_decision']['accepted'] is False
    assert direct['runs'][0]['reranking_scorer']['status'] == 'ok'
    assert 'source_payload' not in direct['runs'][0]
