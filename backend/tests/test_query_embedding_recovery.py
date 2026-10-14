"""A routing timeout must be recoverable, never evidence of an empty media KB."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import httpx
from fastapi import FastAPI

from app.api import chat
from app.core.config import settings
from app.core.llm.manager import LLMCallResult
from app.core.llm.query_embeddings import QueryEmbeddingCache, embed_queries
from app.modules.knowledge.router import KnowledgeRouter, RoutingResult
from app.modules.retrieval.search_engine import HybridSearchEngine
from app.modules.retrieval.service import RetrievalService


def manager_with(encode):
    return SimpleNamespace(
        registry=SimpleNamespace(
            get_task_model=lambda _: "indexed-model",
            get_model_config=lambda _: {"provider": "p", "dimensions": 2},
        ),
        embed=AsyncMock(side_effect=encode),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("cached", [False, True])
async def test_one_transient_timeout_recovers_original_batch_and_reuses_vectors(monkeypatch, cached):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .02)
    cancelled = asyncio.Event()
    calls = []

    async def encode(texts, **kwargs):
        calls.append(list(texts))
        if len(calls) == 1:
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()
        return LLMCallResult(True, data=[[float(len(t)), 1.0] for t in texts], model_used="indexed-model")

    manager = manager_with(encode)
    cache = QueryEmbeddingCache() if cached else None
    batch = ["古筝主奏的冥想纯音乐", "适合阅读的古风器乐"]
    result = await embed_queries(manager, batch, cache)

    assert result.success and cancelled.is_set()
    assert calls == [batch, batch]
    assert result.data == [[float(len(t)), 1.0] for t in batch]
    if cache:
        branches = await asyncio.gather(*(cache.embed(manager, [batch[0]]) for _ in range(4)))
        assert all(row.success for row in branches)
        assert len(calls) == 2 and cache.reused_vectors == 4
        assert cache.failures == []


def failing_engine():
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.rrf_weights = {"dense": 1.0, "sparse": .8, "visual": 1.2,
                          "audio": 1.0, "video": 1.1, "selected_file": 2.4}
    engine.rrf_k = 60
    engine.llm_manager = manager_with(None)
    engine.llm_manager.embed.return_value = LLMCallResult(
        False, error_category="authentication", model_used="indexed-model",
    )
    engine._managed_media_is_empty = AsyncMock(return_value=False)
    engine.vector_store = SimpleNamespace(count_kb_audio=AsyncMock(return_value=16))
    engine._sparse_search = AsyncMock(return_value=[{
        "id": "unrelated-doc", "score": .8, "content_type": "doc", "payload": {},
    }])
    return engine


@pytest.mark.asyncio
@pytest.mark.parametrize("modality", ["visual", "audio", "video"])
async def test_failed_required_media_branch_is_not_a_successful_empty_search(modality):
    engine = failing_engine()
    result = await engine.search(
        {"dense_query": "find requested material"}, ["kb"],
        **{f"{modality}_intent": "explicit_demand"}, embedding_cache=QueryEmbeddingCache(),
    )
    assert result["strategy"] == "error"
    assert modality in result["branch_errors"]
    assert "检索未完成" in result["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("modality", [None, "visual", "audio", "video"])
async def test_usable_sparse_evidence_survives_optional_embedding_failure(modality):
    engine = failing_engine()
    result = await engine.search(
        {"dense_query": "document question"}, ["kb"],
        **({f"{modality}_intent": "implicit_enrichment"} if modality else {}),
        embedding_cache=QueryEmbeddingCache(),
    )
    assert result["strategy"] != "error"
    assert [r["id"] for r in result["fused_results"]] == ["unrelated-doc"]


@pytest.mark.asyncio
@pytest.mark.parametrize("modality,kind", [("visual", "image"), ("audio", "audio"), ("video", "video")])
async def test_selected_material_can_satisfy_required_modality_during_embedding_outage(modality, kind):
    engine = failing_engine()
    engine._selected_file_bootstrap_search = AsyncMock(return_value=[{
        "id": "selected", "score": 1.0, "content_type": kind, "payload": {},
    }])
    result = await engine.search(
        {"dense_query": "describe selected material"}, ["kb"], selected_files=[{"file_id": "selected"}],
        **{f"{modality}_intent": "explicit_demand"}, embedding_cache=QueryEmbeddingCache(),
    )
    assert result["strategy"] != "error"
    assert any(r["id"] == "selected" for r in result["fused_results"])


@pytest.mark.asyncio
async def test_no_evidence_after_failed_dense_search_is_an_error():
    engine = failing_engine()
    engine._sparse_search.return_value = []
    result = await engine.search({"dense_query": "document question"}, ["kb"])
    assert result["strategy"] == "error" and result["branch_errors"] == {"dense": "query_embedding_failed"}


@pytest.mark.asyncio
async def test_successful_empty_search_remains_valid():
    engine = failing_engine()
    engine._dense_search = AsyncMock(return_value=[])
    engine._sparse_search.return_value = []
    engine._audio_search = AsyncMock(return_value=[])
    result = await engine.search({"dense_query": "no matching music"}, ["kb"], audio_intent="explicit_demand")
    assert result["strategy"] != "error"
    assert result["fused_results"] == [] and result["branch_errors"] == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("query", [
    "寻找一首以古筝为主奏乐器、风格为古风、适合冥想和阅读时聆听的纯音乐",
    "寻找以古筝为主奏乐器、适合冥想和阅读时聆听的古风纯音乐",
    "寻找以古筝为主奏乐器、古风风格、适合冥想和阅读时聆听的纯音乐",
])
async def test_recorded_query_variants_keep_semantic_route_after_timeout(monkeypatch, query):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .01)
    calls = 0

    async def encode(texts, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(10)
        return LLMCallResult(True, data=[[1.0, 0.0] for _ in texts], model_used="indexed-model")

    router = KnowledgeRouter.__new__(KnowledgeRouter)
    router.llm_manager = manager_with(encode)
    router.vector_store = SimpleNamespace(search_kb_portraits_topn=AsyncMock(return_value=[
        {"kb_id": "music", "score": .4774}, {"kb_id": "documents", "score": .2286},
    ]))
    router.kb_service = SimpleNamespace(get_knowledge_base_metadata=AsyncMock(return_value={"name": "music"}))
    result = await router.route_query(query, query_variants=["古筝冥想音乐"], embedding_cache=QueryEmbeddingCache())
    assert result.routing_method == "single_kb_dominant"
    assert result.target_kb_ids == ["music"] and result.query_count == 2
    assert calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["sse_get", "sse_post", "message"])
async def test_embedding_outage_never_generates_or_saves_a_false_no_content_answer(monkeypatch, transport):
    engine = failing_engine()
    service = RetrievalService.__new__(RetrievalService)
    service.search_engine = engine
    prepared = {
        "original_query": "古筝冥想音乐", "refined_query": "古筝冥想音乐", "intent_type": "factual",
        "is_complex": False, "audio_intent": "explicit_demand",
        "search_strategies": {"dense_query": "古筝冥想音乐", "multi_view_queries": []},
    }
    service._try_fast_path = AsyncMock(return_value=None)
    service._preprocess_query = AsyncMock(return_value=prepared)
    service._prepare_target_modality = AsyncMock(return_value=(prepared, {}))
    service._route_to_knowledge_bases = AsyncMock(return_value=RoutingResult(["kb"], {"kb": 1.0}, "default_all", 1, 0))
    service.kb_router = SimpleNamespace(resolve_to_qdrant_kb_ids=AsyncMock(return_value=["kb"]))
    service._apply_reranking = AsyncMock(side_effect=AssertionError("must not rank incomplete evidence"))
    monkeypatch.setattr(chat, "retrieval_service", service)
    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace())
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    params = {"message": "古筝冥想音乐", "agentMode": "direct", "sessionId": "outage"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        if transport == "message":
            response = await client.post("/api/chat/message", json=params)
            assert response.status_code == 500
            assert "检索未完成" in response.text
        else:
            response = (await client.get("/api/chat/stream", params=params) if transport == "sse_get"
                        else await client.post("/api/chat/stream", data=params))
            import json
            events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
            assert events[-1]["type"] == "error" and "检索未完成" in events[-1]["message"]
            assert events[-1]["stage_timings"]["retrieval"]["status"] == "failed"
            assert not any(e["type"] in {"message", "complete", "citations"} for e in events)
    service._apply_reranking.assert_not_awaited()
    assert chat.sessions["outage"]["messages"] == []
