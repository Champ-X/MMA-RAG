"""Latency optimizations must preserve scope, evidence and deterministic order."""
import asyncio
import copy
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.manager import LLMCallResult
from app.core.llm.query_embeddings import QueryEmbeddingCache
from app.modules.ingestion.storage.vector_store import (
    TEXT_CHUNK_COLLECTION, VIDEO_SHOT_COLLECTION, VIDEO_KEYFRAME_COLLECTION, VectorStore,
)
from app.modules.retrieval.search_engine import HybridSearchEngine
from app.modules.retrieval.service import RetrievalService


class Embeddings:
    def __init__(self):
        self.model = "model-a"
        self.config = {"provider": "a", "dimensions": 2}
        self.calls = []
        self.registry = SimpleNamespace(
            get_task_model=lambda _: self.model,
            get_model_config=lambda _: self.config,
        )
        self.failure = False
        self.fallback = False

    async def embed(self, texts):
        self.calls.append(list(texts))
        await asyncio.sleep(0)
        return LLMCallResult(
            success=not self.failure,
            data=None if self.failure else [[float(len(t)), 1.0] for t in texts],
            model_used="fallback" if self.fallback else self.model,
            fallback_used=self.fallback,
        )


@pytest.mark.asyncio
async def test_embedding_reuse_preserves_text_order_duplicates_and_values():
    manager = Embeddings()
    cache = QueryEmbeddingCache()
    original = await cache.embed(manager, ["query", "variant"])
    original.data[0][0] = -1  # Consumers must not corrupt the reusable vector.
    results = await asyncio.gather(*[
        cache.embed(manager, texts) for texts in (["variant", "query", "query"], ["query"])
    ])
    assert results[0].data == [[7.0, 1.0], [5.0, 1.0], [5.0, 1.0]]
    assert results[1].data == [[5.0, 1.0]]
    assert manager.calls == [["query", "variant"]]
    assert cache.reused_vectors == 4


@pytest.mark.asyncio
async def test_cache_never_normalizes_text_or_crosses_requests_or_model_config():
    manager = Embeddings()
    cache = QueryEmbeddingCache()
    for text in ["Hi", "hi", " hi", "hi "]:
        await cache.embed(manager, [text])
    manager.model = "model-b"
    await cache.embed(manager, ["Hi"])
    manager.config = {"provider": "b", "dimensions": 2}
    await cache.embed(manager, ["Hi"])
    await QueryEmbeddingCache().embed(manager, ["Hi"])
    assert len(manager.calls) == 7


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["failure", "fallback", "partial"])
async def test_failed_fallback_or_partial_embedding_batches_are_not_cached(mode):
    manager = Embeddings()
    cache = QueryEmbeddingCache()
    if mode == "partial":
        manager.embed = AsyncMock(return_value=LLMCallResult(
            success=True, data=[[1.0]], model_used="model-a",
        ))
    else:
        setattr(manager, mode, True)
    await cache.embed(manager, ["a", "b"])
    await cache.embed(manager, ["a", "b"])
    assert (manager.embed.await_count if mode == "partial" else len(manager.calls)) == 2
    assert cache.reused_vectors == 0


@pytest.mark.asyncio
async def test_partial_cache_miss_keeps_provider_batch_and_fallback_intact():
    manager = Embeddings()
    cache = QueryEmbeddingCache()
    await cache.embed(manager, ["a"])
    manager.fallback = True
    result = await cache.embed(manager, ["a", "new"])
    assert manager.calls == [["a"], ["a", "new"]]
    assert result.fallback_used is True
    assert result.model_used == "fallback"


def service_with_probe(empty=False):
    service = RetrievalService.__new__(RetrievalService)
    service.search_engine = SimpleNamespace(vector_store=SimpleNamespace(
        is_retrieval_index_empty=AsyncMock(return_value=empty),
    ))
    service._update_retrieval_stats = lambda *args, **kwargs: None
    return service


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_standalone_chat_greeting_never_calls_preprocessing_or_storage(stream):
    service = service_with_probe()
    service._preprocess_query = AsyncMock(side_effect=AssertionError("unnecessary LLM call"))
    if stream:
        events = [event async for event in service.search_stream(query="你好！", allow_smalltalk=True)]
        assert [stage for stage, _ in events] == ["retrieval", "_result"]
        result = events[-1][1]
    else:
        result = await service.search(query="你好！", allow_smalltalk=True)
    assert result.debug_info["fast_path"] == "standalone_greeting"
    assert result.context.original_query == "你好！"
    assert result.reranked_results == []
    service._preprocess_query.assert_not_awaited()
    service.search_engine.vector_store.is_retrieval_index_empty.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("query,kb,history,attachment,allow", [
    ("你好，请找部署文档", None, [], None, True),
    ("《你好》", None, [], None, True),
    ("你好是什么意思", None, [], None, True),
    ("你好?", None, [], None, True),
    ("hi", None, [{"role": "assistant", "content": "要搜索哪个关键词？"}], None, True),
    ("你好", {"kb_ids": ["kb-a"]}, [], None, True),
    ("你好", {"selected_files": [{"file_id": "f"}]}, [], None, True),
    ("你好", None, [], "图片描述", True),
    ("你好", None, [], None, False),  # Explicit retrieval API is not casual chat.
])
async def test_ambiguous_or_scoped_greetings_keep_retrieval(query, kb, history, attachment, allow):
    service = service_with_probe(False)
    assert await service._try_fast_path(query, kb, history, attachment, allow) is None


@pytest.mark.asyncio
async def test_empty_index_shortcut_is_fresh_and_unknown_probe_fails_open():
    service = service_with_probe(True)
    probe = service.search_engine.vector_store.is_retrieval_index_empty
    first = await service._try_fast_path("部署步骤", None, [], None)
    assert first.debug_info["fast_path"] == "empty_index"
    probe.return_value = False  # Newly ingested document must be visible immediately.
    assert await service._try_fast_path("部署步骤", None, [], None) is None
    probe.return_value = None
    assert await service._try_fast_path("部署步骤", None, [], None) is None
    probe.side_effect = ConnectionError("storage unavailable")
    assert await service._try_fast_path("部署步骤", None, [], None) is None
    assert probe.await_count == 4


INDEXES = [TEXT_CHUNK_COLLECTION, "image_vectors", "audio_vectors",
           VIDEO_SHOT_COLLECTION, VIDEO_KEYFRAME_COLLECTION, "kb_portraits"]


@pytest.mark.asyncio
@pytest.mark.parametrize("populated", INDEXES + [None, "error"])
async def test_empty_probe_checks_every_modality_and_does_not_treat_errors_as_empty(populated):
    counts = []
    def count(collection_name, exact, timeout):
        assert exact is True
        counts.append(collection_name)
        if populated == "error":
            raise ConnectionError("Qdrant unavailable")
        return SimpleNamespace(count=int(collection_name == populated))
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(
        get_collections=lambda: SimpleNamespace(collections=[SimpleNamespace(name=n) for n in INDEXES]),
        count=count,
    )
    empty = await store.is_retrieval_index_empty()
    assert empty is (None if populated == "error" else populated is None)
    if populated is None:
        assert counts == INDEXES


def bare_engine():
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.rrf_weights = {"dense": 1.0, "sparse": .8, "visual": 1.2,
                          "audio": 1.0, "video": 1.1, "selected_file": 2.4}
    engine.rrf_k = 60
    return engine


@pytest.mark.asyncio
async def test_all_branches_overlap_and_fusion_keeps_original_branch_order():
    engine = bare_engine()
    started = set()
    all_started = asyncio.Event()
    names = ["dense", "sparse", "visual", "audio", "video", "selected_file"]
    source = {
        name: [{"id": name, "score": 0.8, "content_type": "doc", "payload": {}}]
        for name in names
    }
    def branch(name):
        async def run(*args, **kwargs):
            started.add(name)
            if len(started) == len(names):
                all_started.set()
            # A sequential implementation cannot pass this rendezvous.
            await asyncio.wait_for(all_started.wait(), 1)
            await asyncio.sleep((len(names) - names.index(name)) * .001)
            return copy.deepcopy(source[name])
        return run
    for name in names:
        method = "_selected_file_bootstrap_search" if name == "selected_file" else f"_{name}_search"
        setattr(engine, method, branch(name))
    result = await engine.search(
        {"dense_query": "query"}, ["kb"], selected_files=[{"file_id": "f"}],
        visual_intent="explicit_demand", audio_intent="explicit_demand", video_intent="explicit_demand",
    )
    assert list(result["raw_results"]) == names
    assert result["raw_results"] == source
    assert set(result["branch_times"]) == set(names)
    # Explicit audio/video each weigh 1.2, video demand lowers visual to .9.
    # Equal audio/video scores retain the original audio-before-video order.
    assert [r["id"] for r in result["fused_results"]] == [
        "selected_file", "audio", "video", "dense", "visual", "sparse",
    ]


@pytest.mark.asyncio
async def test_slow_branch_is_awaited_and_branch_failure_keeps_other_evidence():
    engine = bare_engine()
    release = asyncio.Event()
    sparse_started = asyncio.Event()
    async def dense(*args, **kwargs):
        await release.wait()
        return [{"id": "essential-evidence", "score": .9, "payload": {}}]
    async def sparse(**kwargs):
        sparse_started.set()
        raise ConnectionError("injected")
    engine._dense_search, engine._sparse_search = dense, sparse
    task = asyncio.create_task(engine.search({"dense_query": "query"}, ["kb"]))
    await asyncio.wait_for(sparse_started.wait(), 1)
    assert not task.done()
    release.set()
    result = await task
    assert result["raw_results"]["sparse"] == []
    assert result["fused_results"][0]["id"] == "essential-evidence"


@pytest.mark.asyncio
async def test_request_cancellation_cancels_all_remote_search_branches():
    engine = bare_engine()
    started, cancelled = set(), set()
    ready = asyncio.Event()
    def branch(name):
        async def run(*args, **kwargs):
            started.add(name)
            if len(started) == 2:
                ready.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.add(name)
        return run
    engine._dense_search, engine._sparse_search = branch("dense"), branch("sparse")
    task = asyncio.create_task(engine.search({"dense_query": "query"}, ["kb"]))
    await asyncio.wait_for(ready.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled == {"dense", "sparse"}


@pytest.mark.asyncio
async def test_dense_query_fanout_keeps_filters_and_primary_query_on_equal_score():
    engine = bare_engine()
    engine.llm_manager = Embeddings()
    ready = asyncio.Event()
    calls = []
    async def search_text_chunks(**kwargs):
        calls.append(kwargs)
        if len(calls) == 3:
            ready.set()
        await asyncio.wait_for(ready.wait(), 1)
        await asyncio.sleep((4 - int(kwargs["query_vector"][0])) * .001)
        return [{"id": "shared", "score": .8, "payload": {}}]
    engine.vector_store = SimpleNamespace(search_text_chunks=search_text_chunks)
    rows = await engine._dense_search("a", ["bb", "ccc"], ["kb"], ["file"], "factual")
    assert len(calls) == 3
    assert all(c["kb_ids"] == ["kb"] and c["file_ids"] == ["file"] for c in calls)
    assert all(c["limit"] == 20 and c["score_threshold"] == 0 for c in calls)
    assert len(rows) == 1
    assert rows[0]["query_source"] == "a"
    assert rows[0]["is_primary_query"] is True


@pytest.mark.asyncio
async def test_qdrant_query_runs_off_event_loop_without_changing_arguments():
    store = VectorStore.__new__(VectorStore)
    loop_thread = threading.get_ident()
    captured = {}
    def query_points(**kwargs):
        assert threading.get_ident() != loop_thread
        captured.update(kwargs)
        return SimpleNamespace(points=[SimpleNamespace(id="doc", score=.8, payload={"kb_id": "kb"})])
    store.client = SimpleNamespace(query_points=query_points)
    rows = await store.search_text_chunks([1.0, 0.0], kb_ids=["kb"], file_ids=["file"], limit=20)
    assert rows == [{"id": "doc", "score": .8, "payload": {"kb_id": "kb"}}]
    assert captured["limit"] == 20
    assert captured["query_filter"] is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_service_shares_one_embedding_batch_from_routing_through_all_modalities(stream):
    from app.core.llm.query_embeddings import embed_queries
    from app.modules.knowledge.router import RoutingResult
    service = service_with_probe(False)
    manager = Embeddings()
    engine = bare_engine()
    engine.llm_manager = manager
    async def text_search(**kwargs):
        return [{"id": "doc", "score": .9, "payload": {"text_content": "evidence"}}]
    engine.vector_store = SimpleNamespace(
        is_retrieval_index_empty=AsyncMock(return_value=False),
        search_text_chunks=text_search,
    )
    engine._sparse_search = AsyncMock(return_value=[])
    def modal(modality):
        async def search(query, *args, embedding_cache=None, **kwargs):
            vector = await embed_queries(manager, [query], embedding_cache)
            assert vector.data == [[5.0, 1.0]]
            return [{"id": modality, "score": .8, "content_type": modality, "payload": {}}]
        return search
    engine._visual_search = modal("image")
    engine._audio_search = modal("audio")
    engine._video_search = modal("video")
    service.search_engine = engine
    prepared = {
        "original_query": "query", "refined_query": "query", "intent_type": "analysis",
        "is_complex": True, "visual_intent": "explicit_demand",
        "audio_intent": "explicit_demand", "video_intent": "explicit_demand",
        "search_strategies": {"dense_query": "query", "multi_view_queries": ["variant"],
                              "sparse_keywords": ["key"]},
    }
    service._preprocess_query = AsyncMock(return_value=prepared)
    async def route(query, embedding_cache=None, **kwargs):
        await embed_queries(manager, [query, *kwargs["query_variants"]], embedding_cache)
        return RoutingResult(["kb"], {"kb": 1.0}, "semantic", 1, 0.0)
    service.kb_router = SimpleNamespace(
        route_query=route, resolve_to_qdrant_kb_ids=AsyncMock(return_value=["kb"]),
    )
    async def rerank(context, search_results):
        return {"results": search_results["fused_results"]}
    service._apply_reranking = rerank
    if stream:
        events = [event async for event in service.search_stream("query")]
        result = events[-1][1]
        assert [stage for stage, _ in events] == ["intent", "routing", "retrieval", "_result"]
    else:
        result = await service.search("query")
    assert manager.calls == [["query", "variant"]]
    assert result.debug_info["reused_embedding_vectors"] == 5
    assert {row["id"] for row in result.reranked_results} == {"doc", "image", "audio", "video"}
    assert result.context.search_strategies == prepared["search_strategies"]
