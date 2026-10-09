"""Original adopted source exclusions survive actual Agent -> tool -> retrieval.

Network/storage/planner results are mocked, but child preprocessing, file
binding, inherited modality merging, search adapter and Agent merge are real.
"""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.agent.models import AgentDecision
from app.modules.agent.service import AgenticRetrievalService, _merge_retrieval_results
from app.modules.agent.tools import MultimodalKnowledgeSearchTool, ToolContext
from app.modules.retrieval.processors.intent import IntentProcessor
from test_routed_modality_fallback import service_fixture, prepared


IMAGE = {'id': 'image-leak', 'content_type': 'image', 'final_score': .9,
         'payload': {'caption': 'restricted image', 'kb_id': 'tea'}}
FILES = [{'file_id': 'img-file', 'name': 'map.png', 'type': 'png'},
         {'file_id': 'doc-file', 'name': 'notes.pdf', 'type': 'pdf'}]
SCOPE = {'kb_ids': ['tea'], 'selected_files': FILES}


def original_policy(action='adopted'):
    return {'policy_version': 'decision-intent-v3.1',
            'planning': {'grounding_state': 'positive', 'grounding_signal': .99, 'context_signal': .01},
            'modalities': {'image': {'status': 'forbidden', 'action': action,
                                    'effective_intent': 'unnecessary',
                                    'signals': {'forbidden': .99}}}}


def actual_retriever(policy=None, *, leak_after_reranking=False):
    service = service_fixture({'tea': {'text': 3, 'image': 4, 'audio': 9}})
    service.intent_processor = IntentProcessor()
    service.intent_processor.process = AsyncMock(side_effect=AssertionError('child made a remote intent call'))
    original = prepared('Only use written evidence; exclude images')
    if policy is not None:
        original['decision_requirements'] = deepcopy(policy)
    service._preprocess_query = AsyncMock(return_value=original)

    async def engine_search(**kwargs):
        document = {'id': kwargs['query_strategies']['dense_query'], 'content_type': 'doc', 'final_score': .8,
                    'payload': {'text_content': 'Written evidence', 'kb_id': 'tea'}}
        # Deliberately model an index route leaking the excluded media type.
        return {'raw_results': {'dense': [document, deepcopy(IMAGE)]},
                'fused_results': [document, deepcopy(IMAGE)]}

    service.search_engine = SimpleNamespace(search=AsyncMock(side_effect=engine_search))
    async def rank(**kwargs):
        rows = list(kwargs['raw_results']['dense'])
        if leak_after_reranking:
            rows.append(deepcopy(IMAGE))
        return {'results': rows}
    service.reranker = SimpleNamespace(rerank=AsyncMock(side_effect=rank))
    return service


@pytest.mark.asyncio
@pytest.mark.parametrize('leak_after_reranking', [False, True])
async def test_agent_children_keep_root_prohibition_through_keywords_file_bootstrap_and_final_merge(leak_after_reranking):
    policy = original_policy()
    frozen_policy = deepcopy(policy)
    retriever = actual_retriever(policy, leak_after_reranking=leak_after_reranking)
    agent = AgenticRetrievalService(retriever,
        planner=SimpleNamespace(decide=AsyncMock(return_value=AgentDecision(
            'search', 'Find the requested fact', ['查看所选图片里的图片与流程图']))),
        max_rounds=1, max_queries_per_round=1, max_total_queries=1)
    result = await agent.search(query='Only use written evidence; exclude images', kb_context=deepcopy(SCOPE))
    calls = retriever.search_engine.search.await_args_list
    assert len(calls) == 2  # Original anchor plus one actual preplanned child.
    for call in calls:
        assert call.kwargs['visual_intent'] == 'unnecessary'
        assert call.kwargs['target_kb_ids'] == ['tea']
        assert call.kwargs['target_file_ids'] == ['img-file', 'doc-file']
        assert [item['file_id'] for item in call.kwargs['selected_files']] == ['doc-file']
    child_hints = retriever.kb_router.route_query.await_args_list[1].kwargs['routing_hints']
    inherited = child_hints['decision_requirements']
    assert inherited['source'] == 'agent_inherited_exclusions'
    assert set(inherited['modalities']) == {'image'}
    assert inherited['modalities']['image']['action'] == 'adopted'
    assert 'planning' not in inherited  # Root grounding cannot start extra child evidence work.
    assert result.retrieval_result.context.visual_intent == 'unnecessary'
    assert all(row['content_type'] == 'doc' for row in result.retrieval_result.reranked_results)
    assert all(row['content_type'] == 'doc' for rows in result.retrieval_result.raw_results.values() for row in rows)
    assert result.retrieval_result.context.decision_requirements['modalities']['image']['action'] == 'adopted'
    retriever._preprocess_query.assert_awaited_once()
    retriever.intent_processor.process.assert_not_awaited()
    assert policy == frozen_policy


@pytest.mark.asyncio
async def test_inherited_prohibition_survives_conflicting_base_modality_before_sync():
    retriever = actual_retriever()
    tool = MultimodalKnowledgeSearchTool(retriever)
    result = await tool.execute(query='查看图片', context=ToolContext(
        kb_context=deepcopy(SCOPE), session_context=[], attachment_context=None,
        base_modality_intents={'image': 'explicit_demand'}, decision_requirements=original_policy()))
    assert result.context.visual_intent == 'unnecessary'
    record = result.context.decision_requirements['modalities']['image']
    assert record['action'] == 'adopted' and record['effective_intent'] == 'unnecessary'
    assert 'image' not in result.context.selected_file_modalities
    assert [item['file_id'] for item in retriever.search_engine.search.await_args.kwargs['selected_files']] == ['doc-file']
    assert all(item['content_type'] == 'doc' for item in result.reranked_results)
    retriever._preprocess_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('policy', [None, original_policy(action='conflict_retained_baseline')])
async def test_off_or_unadopted_proposal_does_not_change_existing_child_search(policy):
    retriever = actual_retriever()
    result = await MultimodalKnowledgeSearchTool(retriever).execute(query='查看图片', context=ToolContext(
        kb_context=deepcopy(SCOPE), session_context=[], attachment_context=None,
        base_modality_intents={'image': 'explicit_demand'}, decision_requirements=policy))
    assert result.context.visual_intent == 'explicit_demand'
    assert result.context.decision_requirements is None
    assert retriever.search_engine.search.await_args.kwargs['selected_files'] == FILES
    assert any(item['content_type'] == 'image' for item in result.reranked_results)
    hints = retriever.kb_router.route_query.await_args.kwargs['routing_hints']
    assert 'agent_adopted_exclusions' not in hints


def test_merge_uses_original_policy_even_when_no_original_anchor_result_survives():
    from test_agentic_retrieval import _retrieval_result
    child = _retrieval_result('child images', [deepcopy(IMAGE), {
        'id': 'doc', 'content_type': 'doc', 'final_score': .7, 'payload': {'text_content': 'keep'}}])
    child.context.visual_intent = 'explicit_demand'
    merged = _merge_retrieval_results(original_query='Exclude images', retrieval_results=[child], trace=[],
        executed_queries=['child images'], max_evidence=5,
        modality_requirements={'image': 'explicit_demand'}, decision_requirements=original_policy())
    assert [item['id'] for item in merged.reranked_results] == ['doc']
    assert merged.context.visual_intent == 'unnecessary'
    assert merged.debug_info['agent']['modality_requirements']['image'] == 'unnecessary'
