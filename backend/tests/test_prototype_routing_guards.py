"""Guard optional content routing during migration, slow reads and complex plans."""

import asyncio
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.config import settings
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge import router as router_module
from app.modules.knowledge.router import KnowledgeRouter


@pytest.fixture
def router(monkeypatch):
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "coverage")
    monkeypatch.setattr(router_module, "embed_queries", AsyncMock(
        return_value=SimpleNamespace(success=True, data=[[1.0, 0.0]]),
    ))
    instance = KnowledgeRouter.__new__(KnowledgeRouter)
    instance.llm_manager = object()
    instance._enrich_target_kbs = AsyncMock(return_value=[])
    instance._default_routing = AsyncMock(side_effect=AssertionError("valid summary route must survive"))
    instance.vector_store = SimpleNamespace(
        search_kb_portraits_topn=AsyncMock(return_value=[
            {"kb_id": "primary", "score": .8},
            {"kb_id": "secondary", "score": .77},
            {"kb_id": "third", "score": .6},
        ]),
        search_kb_topic_prototypes=AsyncMock(return_value=[
            {"kb_id": "new", "score": .95},
            {"kb_id": "primary", "score": .5},
            {"kb_id": "secondary", "score": .4},
            {"kb_id": "third", "score": .3},
        ]),
    )
    return instance


@pytest.mark.asyncio
@pytest.mark.parametrize("unmigrated", ["primary", "secondary"])
async def test_partial_portrait_migration_cannot_evict_summary_candidates(router, unmigrated):
    router.vector_store.search_kb_topic_prototypes.return_value = [
        hit for hit in router.vector_store.search_kb_topic_prototypes.return_value
        if hit["kb_id"] != unmigrated
    ]
    result = await router.route_query("answer from two topics", max_targets=2)

    assert result.target_kb_ids == ["primary", "secondary"]
    assert result.routing_details["content_prototype_selection"]["reason"] == "baseline_prototypes_incomplete"
    router._default_routing.assert_not_awaited()


@pytest.mark.asyncio
async def test_complete_migration_still_admits_dominant_content_evidence(router):
    result = await router.route_query("locate concrete evidence", max_targets=2)

    assert result.target_kb_ids == ["primary", "new"]
    assert result.routing_details["content_prototype_selection"]["evicted_kb_ids"] == ["secondary"]
    assert result.routing_details["content_prototype_status"] == "available"


@pytest.mark.asyncio
@pytest.mark.parametrize("budget,targets,reason", [
    (2, ["primary", "secondary"], "decision_source_preservation"),
    (3, ["primary", "secondary", "new"], "dominant_content_prototype"),
])
async def test_decision_requirements_preserve_sources_but_allow_a_spare_slot(router, budget, targets, reason):
    result = await router.route_query(
        "compare evidence for two requirements", max_targets=budget,
        routing_hints={"decision_requirements": [{"id": "first"}, {"id": "second"}]},
    )

    assert result.target_kb_ids == targets
    details = result.routing_details["content_prototype_selection"]
    assert details["reason"] == reason
    assert details["evicted_kb_ids"] == []


@pytest.mark.asyncio
async def test_modality_supplement_retains_prior_content_selection_trace(router):
    router._get_modality_inventory = AsyncMock(return_value={
        "primary": {"text": 10}, "secondary": {"audio": 5},
        "new": {"video": 5}, "third": {"image": 5},
    })
    result = await router.route_query(
        "find a supporting image", max_targets=2,
        routing_hints={"modality_intents": {"image": "explicit_demand"}},
    )

    assert result.target_kb_ids == ["primary", "third"]
    assert result.routing_method == "modality_coverage"
    assert result.routing_details["base_routing_method"] == "content_prototype_coverage"
    assert result.routing_details["modality_coverage_kb_ids"] == ["third"]
    assert result.routing_details["content_prototype_selection"]["inserted_kb_ids"] == ["new"]
    assert result.routing_details["content_prototype_hits"][0]["kb_id"] == "new"
    assert result.routing_details["content_prototype_status"] == "available"


@pytest.mark.asyncio
async def test_slow_grouped_read_has_a_short_deadline_and_keeps_summary_route(router, monkeypatch):
    started, release, finished = Event(), Event(), Event()

    def blocked_grouped_read(**kwargs):
        assert kwargs["timeout"] == 1  # Server work also has a bounded timeout.
        started.set()
        try:
            assert release.wait(2), "test did not release the blocked SDK call"
            return SimpleNamespace(groups=[])
        finally:
            finished.set()

    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points_groups=Mock(side_effect=blocked_grouped_read))
    store.search_kb_portraits_topn = router.vector_store.search_kb_portraits_topn
    router.vector_store = store
    monkeypatch.setattr(router_module, "ROUTING_PROTOTYPE_TIMEOUT_SECONDS", .01)
    try:
        result = await asyncio.wait_for(router.route_query("find evidence", max_targets=2), timeout=.5)
        assert started.is_set()
        assert not finished.is_set()  # Optional SDK work cannot gate the result.
        assert result.target_kb_ids == ["primary", "secondary"]
        assert result.routing_details["content_prototype_status"] == "timeout"
        router._default_routing.assert_not_awaited()
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 2)
