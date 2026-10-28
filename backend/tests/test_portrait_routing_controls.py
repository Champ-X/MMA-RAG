"""Controlled routing experiments must preserve the established default path."""

import asyncio
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import numpy as np
import pytest
from qdrant_client import QdrantClient, models

from app.core.config import settings
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge.router import KnowledgeRouter


@pytest.mark.asyncio
async def test_payload_projection_preserves_real_qdrant_ranking(monkeypatch):
    # Exercise Qdrant's actual cosine/filter/payload implementation, isolated
    # from the user's persistent collections and external embedding providers.
    client = QdrantClient(location=":memory:")
    client.create_collection("kb_portraits", vectors_config=models.VectorParams(size=8, distance=models.Distance.COSINE))
    rng = np.random.default_rng(20261027)
    vectors = rng.normal(size=(65, 8))
    client.upsert("kb_portraits", points=[models.PointStruct(
        id=i, vector=v.tolist(), payload={"kb_id": f"kb-{i % 12}", "cluster_size": i + 1,
                                         "topic_summary": "内容摘要" * 200, "generation": "fixture"},
    ) for i, v in enumerate(vectors)])
    store = VectorStore.__new__(VectorStore)
    store.client = client
    try:
        for query in rng.normal(size=(8, 8)):
            monkeypatch.setattr(settings, "knowledge_routing_compact_payload", False)
            full = await store.search_kb_portraits_topn(query.tolist())
            monkeypatch.setattr(settings, "knowledge_routing_compact_payload", True)
            compact = await store.search_kb_portraits_topn(query.tolist())
            fields = ("id", "kb_id", "cluster_size")
            assert [[r[f] for f in fields] for r in compact] == [[r[f] for f in fields] for r in full]
            assert [r["score"] for r in compact] == pytest.approx([r["score"] for r in full], abs=1e-6)
            assert all(set(r["payload"]) == {"kb_id", "cluster_size"} for r in compact)
            router = KnowledgeRouter.__new__(KnowledgeRouter)
            full_scores = router._calculate_multi_signal_scores([full])
            compact_scores = router._calculate_multi_signal_scores([compact])
            assert compact_scores == pytest.approx(full_scores, abs=1e-6)
            assert (await router._apply_routing_strategy(full_scores)).target_kb_ids == (await router._apply_routing_strategy(compact_scores)).target_kb_ids
    finally:
        client.close()


def test_aggregation_experiment_is_independent_and_reversible(monkeypatch):
    router = KnowledgeRouter.__new__(KnowledgeRouter)
    nodes = [{"kb_id": "a", "score": v} for v in [.9, .6, .6, .6, .6]] + [{"kb_id": "b", "score": .72}]
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "legacy")
    before = router._calculate_kb_scores_from_topn(nodes)
    assert before["a"] < before["b"]
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "max")
    assert router._calculate_kb_scores_from_topn(nodes) == {"a": .9, "b": .72}
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "legacy")
    assert router._calculate_kb_scores_from_topn(nodes) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["legacy", "max"])
async def test_explicit_scope_bypasses_all_scoring_experiments(monkeypatch, mode):
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", mode)
    router = KnowledgeRouter.__new__(KnowledgeRouter)
    router.kb_service = SimpleNamespace(get_knowledge_base_metadata=AsyncMock(return_value={"name": "Selected"}))
    router.vector_store = SimpleNamespace(search_kb_portraits_topn=AsyncMock(side_effect=AssertionError("must not route explicit scope")))
    result = await router.route_query("比较所有知识库", kb_context={"kb_ids": ["selected"], "selected_files": [{"file_id": "f"}]})
    assert result.target_kb_ids == ["selected"]
    assert result.routing_method == "explicit"
    router.vector_store.search_kb_portraits_topn.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["count_kb_chunks", "count_kb_audio", "count_kb_video"])
async def test_portrait_strict_counts_do_not_turn_outages_into_empty_kbs(method):
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(count=Mock(side_effect=ConnectionError("index unavailable")))
    # Existing diagnostic callers retain their tolerant contract.
    assert await getattr(store, method)("kb") in (0, (0, 0))
    with pytest.raises(ConnectionError):
        await getattr(store, method)("kb", strict=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("method", [
    "scroll_text_chunks_for_sampling", "scroll_image_vectors_for_sampling",
    "scroll_audio_vectors_for_sampling", "scroll_video_shot_samples_for_portrait",
])
async def test_portrait_page_errors_are_not_successful_end_of_stream(method):
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(
        get_collection=Mock(return_value=SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors={"dense": {}})))),
        scroll=Mock(side_effect=ConnectionError("page unavailable")),
    )
    with pytest.raises(ConnectionError):
        await getattr(store, method)("kb", limit=500, offset="next-page")


@pytest.mark.asyncio
async def test_portrait_schema_read_failure_cannot_select_an_arbitrary_vector():
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(get_collection=Mock(side_effect=ConnectionError("schema unavailable")), scroll=Mock())
    with pytest.raises(ConnectionError):
        await store.scroll_text_chunks_for_sampling("kb", limit=500)
    store.client.scroll.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", [
    "count_kb_chunks", "count_kb_audio", "count_kb_video",
    "scroll_text_chunks_for_sampling", "scroll_image_vectors_for_sampling",
    "scroll_audio_vectors_for_sampling", "scroll_video_shot_samples_for_portrait",
])
async def test_portrait_io_leaves_event_loop_available_for_retrieval(method):
    started, release = Event(), Event()

    def blocked_io(*args, **kwargs):
        started.set()
        assert release.wait(2), "portrait I/O blocked the event loop"
        return SimpleNamespace(count=0) if method.startswith("count_") else ([], None)

    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(
        count=blocked_io, scroll=blocked_io,
        get_collection=lambda *a: SimpleNamespace(config=SimpleNamespace(params=SimpleNamespace(vectors={"dense": {}}))),
    )
    options = {"strict": True} if method.startswith("count_") else {"limit": 1}
    task = asyncio.create_task(getattr(store, method)("kb", **options))
    try:
        assert await asyncio.wait_for(asyncio.to_thread(started.wait, 2), timeout=3)
        # This coroutine progresses while the slow portrait I/O is still
        # pending, as an unrelated online retrieval request must be able to.
        assert not task.done()
    finally:
        release.set()
        await task
