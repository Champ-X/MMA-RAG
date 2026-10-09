"""Query deadlines cancel remote work without changing ingestion or vector space."""
import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import httpx

from app.core.config import settings
from app.core.llm.manager import LLMManager
from app.core.llm.model_health import ModelHealth
from app.core.llm.query_embeddings import QueryEmbeddingCache, embed_queries


@pytest.mark.asyncio
@pytest.mark.parametrize("cached", [False, True])
async def test_query_deadline_cancels_hung_embedding_without_global_cooldown(monkeypatch, cached):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", 0.02)
    cancelled = asyncio.Event()

    async def encode(texts, model):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()

    provider = SimpleNamespace(embed_texts=AsyncMock(side_effect=encode))
    manager = object.__new__(LLMManager)
    manager.registry = SimpleNamespace(
        get_task_model=lambda _: "indexed-model",
        get_model_config=lambda _: {"provider": "p", "type": "embedding"},
        get_raw_model_name=lambda model: model,
        get_provider=lambda _: provider,
        get_task_fallbacks=lambda _: [],
        model_health=ModelHealth(),
    )
    result = await asyncio.wait_for(
        embed_queries(manager, ["query"], QueryEmbeddingCache() if cached else None),
        timeout=0.5,
    )
    assert not result.success and result.error_category == "query_timeout"
    assert result.model_used == "indexed-model" and not result.fallback_used
    assert result.duration >= .02
    assert cancelled.is_set()
    provider.embed_texts.assert_awaited_once_with(texts=["query"], model="indexed-model")
    assert manager.registry.model_health.snapshot() == []


@pytest.mark.asyncio
async def test_query_setting_does_not_limit_ingestion_embedding(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", 0.001)

    async def encode(texts, model):
        await asyncio.sleep(0.01)
        return [[1.0, 0.0]]

    manager = object.__new__(LLMManager)
    manager.registry = SimpleNamespace(
        get_task_model=lambda _: "indexed-model",
        get_model_config=lambda _: {"provider": "p", "type": "embedding"},
        get_raw_model_name=lambda model: model,
        get_provider=lambda _: SimpleNamespace(embed_texts=encode),
        model_health=ModelHealth(),
    )
    result = await manager.embed(["ingestion document"])
    assert result.success and result.data == [[1.0, 0.0]]


def make_manager(encode):
    provider = SimpleNamespace(embed_texts=AsyncMock(side_effect=encode))
    manager = object.__new__(LLMManager)
    config = {"provider": "p", "type": "embedding", "dimensions": 2}
    manager.registry = SimpleNamespace(
        get_task_model=lambda _: "indexed-model",
        get_model_config=lambda _: config,
        get_raw_model_name=lambda model: model,
        get_provider=lambda _: provider,
        get_task_fallbacks=lambda _: [],
        model_health=ModelHealth(),
    )
    return manager, provider, config


@pytest.mark.asyncio
async def test_timeout_is_local_to_request_and_does_not_block_ingestion_or_next_query(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .02)
    cancelled = asyncio.Event()

    async def encode(texts, model):
        if texts == ["slow query"]:
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()
        return [[1.0, 0.0] for _ in texts]

    manager, provider, _ = make_manager(encode)
    cache = QueryEmbeddingCache()
    timeout = await cache.embed(manager, ["slow query"])
    assert timeout.error_category == "query_timeout" and cancelled.is_set()
    assert manager.registry.model_health.snapshot() == []

    # Other branches of the same request cannot each spend another deadline.
    repeated = await cache.embed(manager, ["different query branch"])
    assert repeated.error_category == "query_timeout" and repeated.duration == 0
    assert provider.embed_texts.await_count == 1

    ingestion = await manager.embed(["ingestion document"])
    assert ingestion.success
    next_query = await QueryEmbeddingCache().embed(manager, ["next query"])
    assert next_query.success and provider.embed_texts.await_count == 3
    assert manager.registry.model_health.snapshot()[0]["failure_count"] == 0


@pytest.mark.asyncio
async def test_concurrent_branches_share_one_timeout_and_keep_previous_good_vectors(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .02)

    async def encode(texts, model):
        if texts != ["warm"]:
            await asyncio.sleep(10)
        return [[1.0, 0.0]]

    manager, provider, _ = make_manager(encode)
    cache = QueryEmbeddingCache()
    assert (await cache.embed(manager, ["warm"])).success
    results = await asyncio.gather(*[
        cache.embed(manager, [text]) for text in ["slow", "other", "warm"]
    ])
    assert [result.error_category for result in results] == ["query_timeout", "query_timeout", None]
    assert results[1].duration == 0 and results[2].data == [[1.0, 0.0]]
    assert provider.embed_texts.await_count == 2 and cache.reused_vectors == 1


@pytest.mark.asyncio
async def test_cached_vector_is_available_while_an_unrelated_network_miss_waits():
    started, release = asyncio.Event(), asyncio.Event()

    async def encode(texts, model):
        if texts == ["slow"]:
            started.set()
            await release.wait()
        return [[1.0, 0.0] for _ in texts]

    manager, provider, _ = make_manager(encode)
    cache = QueryEmbeddingCache()
    await cache.embed(manager, ["warm"])
    slow = asyncio.create_task(cache.embed(manager, ["slow"]))
    try:
        await asyncio.wait_for(started.wait(), .5)
        warm = await asyncio.wait_for(cache.embed(manager, ["warm", "warm"]), .1)
        assert warm.success and warm.data == [[1.0, 0.0], [1.0, 0.0]]
        assert not slow.done()
        warm.data[0][0] = -1
        assert (await cache.embed(manager, ["warm"])).data == [[1.0, 0.0]]
        assert provider.embed_texts.await_count == 2
    finally:
        release.set()
        await slow


@pytest.mark.asyncio
async def test_changed_model_configuration_can_retry_after_request_timeout(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .02)

    async def encode(texts, model):
        await asyncio.sleep(10)

    manager, provider, config = make_manager(encode)
    cache = QueryEmbeddingCache()
    assert (await cache.embed(manager, ["query"])).error_category == "query_timeout"
    config["dimensions"] = 3
    provider.embed_texts.side_effect = None
    provider.embed_texts.return_value = [[1.0, 0.0, 0.0]]
    result = await cache.embed(manager, ["query"])
    assert result.success and result.data == [[1.0, 0.0, 0.0]]
    assert provider.embed_texts.await_count == 2


@pytest.mark.asyncio
async def test_actual_provider_errors_keep_global_health_and_are_not_request_timeouts(monkeypatch):
    request = httpx.Request("POST", "https://example.test/embeddings")
    response = httpx.Response(503, request=request)

    async def encode(texts, model):
        raise httpx.HTTPStatusError("unavailable", request=request, response=response)

    manager, provider, _ = make_manager(encode)
    cache = QueryEmbeddingCache()
    result = await cache.embed(manager, ["query"])
    assert result.error_category == "provider_error"
    health = manager.registry.model_health.snapshot()
    assert health[0]["failure_count"] == 1 and health[0]["cooling_down"]
    future = time.time() + 16
    monkeypatch.setattr("app.core.llm.model_health.time.time", lambda: future)
    provider.embed_texts.side_effect = None
    provider.embed_texts.return_value = [[1.0, 0.0]]
    assert (await cache.embed(manager, ["query"])).success
    assert provider.embed_texts.await_count == 2


@pytest.mark.asyncio
async def test_caller_cancellation_does_not_poison_request_cache_or_model_health(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .5)
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def encode(texts, model):
        started.set()
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()

    manager, provider, _ = make_manager(encode)
    cache = QueryEmbeddingCache()
    task = asyncio.create_task(cache.embed(manager, ["query"]))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set() and manager.registry.model_health.snapshot() == []
    provider.embed_texts.side_effect = None
    provider.embed_texts.return_value = [[1.0, 0.0]]
    assert (await cache.embed(manager, ["query"])).success
