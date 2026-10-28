"""Exercise scope and candidate-budget controls through the production callers."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.config import settings
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge import router as router_module
from app.modules.knowledge.router import KnowledgeRouter, RoutingResult
from app.modules.retrieval import search_engine as search_module
from app.modules.retrieval.search_engine import HybridSearchEngine


@pytest.mark.asyncio
async def test_video_anchors_recover_single_view_answer_without_extra_search_or_candidates(monkeypatch):
    def point(identifier, score):
        return SimpleNamespace(id=identifier, score=score, payload={"kb_id": "selected", "file_id": "file"})

    hits = {
        "caption_dense": [point("consensus-a", .6), point("consensus-b", .59)],
        "asr_dense": [point("answer", .9), point("consensus-a", .6), point("consensus-b", .59)],
        "caption_sparse": [point("consensus-a", 9), point("consensus-b", 8)],
        "asr_sparse": [point("consensus-a", 9), point("consensus-b", 8)],
    }
    query = Mock(side_effect=lambda **kwargs: SimpleNamespace(points=hits[kwargs["using"]]))
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points=query)
    options = dict(
        caption_query_vector=[1, 0], asr_query_vector=[1, 0],
        caption_query_sparse={1: .1}, asr_query_sparse={1: .1},
        target_kb_ids=["selected"], target_file_ids=["file"], limit=2,
    )
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", False)
    baseline = await store.search_video_shots(**options)
    baseline_calls = [deepcopy(call.kwargs) for call in query.call_args_list]
    query.reset_mock()
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", True)
    optimized = await store.search_video_shots(**options)

    assert [row["id"] for row in baseline] == ["consensus-a", "consensus-b"]
    assert [row["id"] for row in optimized] == ["consensus-a", "answer"]
    assert len(optimized) == len(baseline) == 2
    assert query.call_count == len(baseline_calls) == 4
    assert [call.kwargs for call in query.call_args_list] == baseline_calls  # Same index filters, views and TopN.
    answer = optimized[1]
    assert answer["score"] == pytest.approx(1 / 61)
    assert answer["semantic_evidence_anchor"]["views"] == ["asr_dense"]
    assert answer["payload"]["kb_id"] == "selected"


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled,expected_ids", [(False, ["consensus", "keyframe-shot::frame"]), (True, ["consensus", "answer"])])
async def test_visual_enrichment_preserves_semantic_anchor_and_provenance_within_limit(monkeypatch, enabled, expected_ids):
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", enabled)
    embed = AsyncMock(return_value=SimpleNamespace(success=True, data=[[1, 0]]))
    sparse = AsyncMock(return_value={"sparse": {1: .1}})
    monkeypatch.setattr(search_module, "embed_queries", embed)
    monkeypatch.setattr(search_module, "_encode_sparse_query", sparse)
    shots = [
        {"id": "consensus", "score": .05, "payload": {"kb_id": "selected", "file_id": "file", "shot_id": "s1", "caption": "scene"}},
        {"id": "answer", "score": .0001, "payload": {"kb_id": "selected", "file_id": "file", "shot_id": "s2", "asr_text": "direct answer"},
         "route_scores": {"asr_dense": .9}, "semantic_evidence_anchor": {"views": ["asr_dense"], "scores": {"asr_dense": .9}}},
    ]
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.llm_manager = object()
    engine.sparse_encoder = object()
    engine._managed_media_is_empty = AsyncMock(return_value=False)
    engine._generate_clip_text_vector = AsyncMock(return_value=[1, 0])
    engine.vector_store = SimpleNamespace(
        search_video_shots=AsyncMock(return_value=shots),
        search_video_keyframes=AsyncMock(return_value=[{
            "id": "frame", "score": .8,
            "payload": {"kb_id": "selected", "file_id": "file", "shot_id": "s3", "shot_caption": "visual alternative"},
        }]),
    )

    results = await engine._video_search("spoken answer", ["selected"], ["file"], visual_query="scene", limit=2)

    assert [row["id"] for row in results] == expected_ids
    assert len(results) == 2
    embed.assert_awaited_once()
    sparse.assert_awaited_once()
    engine.vector_store.search_video_shots.assert_awaited_once()
    engine.vector_store.search_video_keyframes.assert_awaited_once()
    if enabled:
        assert results[1]["metadata"]["semantic_evidence_anchor"]["views"] == ["asr_dense"]
        assert results[1]["retrieval_scores"]["dense"] == .9
        assert "direct answer" in results[1]["content"]


@pytest.fixture
def coverage_router(monkeypatch):
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "coverage")
    embed = AsyncMock(return_value=SimpleNamespace(success=True, data=[[1, 0]]))
    monkeypatch.setattr(router_module, "embed_queries", embed)
    router = KnowledgeRouter.__new__(KnowledgeRouter)
    router.llm_manager = object()
    router._enrich_target_kbs = AsyncMock(return_value=[])
    router._default_routing = AsyncMock(side_effect=AssertionError("prototype failure must preserve valid summary routing"))
    router.vector_store = SimpleNamespace(
        search_kb_portraits_topn=AsyncMock(return_value=[
            {"kb_id": "primary", "score": .8}, {"kb_id": "secondary", "score": .77}, {"kb_id": "third", "score": .6},
        ]),
        search_kb_topic_prototypes=AsyncMock(return_value=[
            {"kb_id": "new", "score": .9}, {"kb_id": "primary", "score": .5},
            {"kb_id": "secondary", "score": .4},
        ]),
    )
    return router, embed


@pytest.mark.asyncio
async def test_route_query_strong_content_evidence_preserves_primary_and_scope_budget(coverage_router):
    router, embed = coverage_router
    result = await router.route_query("find the evidence", max_targets=2)
    assert result.target_kb_ids == ["primary", "new"]
    assert result.routing_method == "content_prototype_coverage"
    selection = result.routing_details["content_prototype_selection"]
    assert selection["evicted_kb_ids"] == ["secondary"]
    assert selection["inserted_kb_ids"] == ["new"]
    assert set(result.confidence_scores) == {"primary", "new"}
    embed.assert_awaited_once()
    assert router.vector_store.search_kb_topic_prototypes.call_args.kwargs["query_vector"] == [1, 0]


@pytest.mark.asyncio
@pytest.mark.parametrize("prototype_hits", [
    [], [{"kb_id": "new", "score": .48}, {"kb_id": "primary", "score": .3}],
    [{"kb_id": "new", "score": .8}, {"kb_id": "primary", "score": .79}],
])
async def test_route_query_missing_weak_or_ambiguous_content_keeps_summary_scope(coverage_router, prototype_hits):
    router, _ = coverage_router
    router.vector_store.search_kb_topic_prototypes.return_value = prototype_hits
    result = await router.route_query("find the evidence", max_targets=2)
    assert result.target_kb_ids == ["primary", "secondary"]
    assert result.routing_method == "dual_kb"


@pytest.mark.asyncio
async def test_route_query_prototype_index_outage_does_not_expand_to_all_kbs(coverage_router):
    router, _ = coverage_router
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points_groups=Mock(side_effect=ConnectionError("prototype index unavailable")))
    store.search_kb_portraits_topn = router.vector_store.search_kb_portraits_topn
    router.vector_store = store

    result = await router.route_query("find the evidence", max_targets=2)

    assert result.target_kb_ids == ["primary", "secondary"]
    assert result.routing_method == "dual_kb"
    store.client.query_points_groups.assert_called_once()
    router._default_routing.assert_not_called()


@pytest.mark.asyncio
async def test_route_query_explicit_scope_bypasses_content_prototypes_and_embedding(coverage_router):
    router, embed = coverage_router
    result = await router.route_query("find the evidence", kb_context={"kb_ids": ["selected"], "selected_files": [{"file_id": "f"}]})
    assert result.target_kb_ids == ["selected"]
    assert result.routing_method == "explicit"
    embed.assert_not_awaited()
    router.vector_store.search_kb_topic_prototypes.assert_not_awaited()
    router.vector_store.search_kb_portraits_topn.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_query_agent_exploration_bypasses_content_prototypes(coverage_router):
    router, _ = coverage_router
    router._get_modality_inventory = AsyncMock(return_value={})
    router._apply_agent_exploration_strategy = AsyncMock(return_value=RoutingResult(
        target_kb_ids=["primary", "secondary"], confidence_scores={"primary": 1.0, "secondary": .9},
        routing_method="agent_exploration", total_candidates=3, processing_time=0,
    ))
    result = await router.route_query("find the evidence", routing_hints={"agent_mode": True, "agent_round": 2})
    assert result.target_kb_ids == ["primary", "secondary"]
    router._apply_agent_exploration_strategy.assert_awaited_once()
    router.vector_store.search_kb_topic_prototypes.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_query_one_target_budget_does_not_admit_prototype(coverage_router):
    router, _ = coverage_router
    result = await router.route_query("find the evidence", max_targets=1)
    assert result.target_kb_ids == ["primary"]
    assert result.routing_details["content_prototype_selection"]["reason"] == "no_supplement_budget"
