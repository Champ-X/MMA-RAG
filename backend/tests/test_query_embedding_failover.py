"""Query failover must preserve indexed vector space, deadlines and attribution."""
import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import settings
from app.core.llm.manager import LLMManager
from app.core.llm.model_health import ModelHealth
from app.core.llm.providers.openrouter import OpenRouterProvider
from app.core.llm.query_embeddings import QueryEmbeddingCache, embed_queries


@pytest.fixture(autouse=True)
def short_deadlines(monkeypatch):
    monkeypatch.setattr(settings, "query_embedding_timeout_seconds", .015)
    monkeypatch.setattr(settings, "query_embedding_fallback_timeout_seconds", .03)


async def stalled(**kwargs):
    await asyncio.sleep(10)


async def working(texts, model, **kwargs):
    return [[float(len(text)), 1.0] for text in texts]


def make_manager(primary=stalled, backup=working):
    configs = {
        "primary": {"provider": "siliconflow", "type": "embedding", "embedding_space": "fixture-v1",
                    "embedding_dimensions": 2, "query_fallback": "backup"},
        "backup": {"provider": "openrouter", "type": "embedding", "embedding_space": "fixture-v1",
                   "embedding_dimensions": 2, "embedding_options": {"provider": {"ignore": ["siliconflow"]}}},
    }
    providers = {"siliconflow": SimpleNamespace(embed_texts=AsyncMock(side_effect=primary)),
                 "openrouter": SimpleNamespace(embed_texts=AsyncMock(side_effect=backup))}
    manager = object.__new__(LLMManager)
    manager.registry = SimpleNamespace(
        get_task_model=lambda _: "primary",
        get_model_config=lambda model: configs.get(model, {}),
        get_raw_model_name=lambda model: model,
        get_provider=providers.get,
        # Query recovery owns its budget; this unrelated chain must never run.
        get_task_fallbacks=lambda _: ["unrelated-space"],
        model_health=ModelHealth(),
    )
    return manager, configs, providers


@pytest.mark.asyncio
async def test_primary_success_never_calls_backup():
    manager, _, providers = make_manager(primary=working)
    result = await embed_queries(manager, ["query"])
    assert result.success and result.model_used == "primary" and not result.fallback_used
    assert providers["openrouter"].embed_texts.await_count == 0


@pytest.mark.asyncio
async def test_primary_retry_can_recover_without_switching():
    calls = 0

    async def recover(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            await stalled()
        return await working(**kwargs)

    manager, _, providers = make_manager(primary=recover)
    result = await embed_queries(manager, ["query"])
    assert result.success and calls == 2 and not result.fallback_used
    assert providers["openrouter"].embed_texts.await_count == 0


@pytest.mark.asyncio
async def test_two_cancelled_primary_attempts_then_compatible_backup_are_shared():
    cancelled = 0

    async def primary(**kwargs):
        nonlocal cancelled
        try:
            await stalled()
        finally:
            cancelled += 1

    manager, _, providers = make_manager(primary=primary)
    cache = QueryEmbeddingCache()
    result = await cache.embed(manager, ["query", "variant"])
    assert result.success and result.fallback_used and result.model_used == "backup"
    assert .03 <= result.duration < .3 and cancelled == 2
    result.data[0][0] = -1
    rows = await asyncio.gather(*[cache.embed(manager, texts) for texts in
                                 (["variant", "query", "query"], ["query"], ["new"])] )
    assert rows[0].data == [[7.0, 1.0], [5.0, 1.0], [5.0, 1.0]]
    assert all(r.success and r.model_used == "backup" and r.fallback_used for r in rows)
    assert providers["siliconflow"].embed_texts.await_count == 2
    assert providers["openrouter"].embed_texts.await_count == 2  # initial batch + unseen text
    assert providers["openrouter"].embed_texts.await_args.kwargs["provider"] == {"ignore": ["siliconflow"]}
    assert cache.reused_vectors == 4 and not cache.failures
    assert [r["provider"] for r in manager.registry.model_health.snapshot()] == ["openrouter"]

    # Recovery is not a global model switch, nor an ingestion cooldown.
    providers["siliconflow"].embed_texts.side_effect = working
    assert (await manager.embed(["ingestion"], fallback=False)).model_used == "primary"
    assert (await QueryEmbeddingCache().embed(manager, ["query"])).model_used == "primary"


@pytest.mark.asyncio
async def test_total_outage_is_bounded_and_not_repeated_by_other_branches():
    manager, _, providers = make_manager(backup=stalled)
    cache = QueryEmbeddingCache()
    started = time.monotonic()
    rows = await asyncio.gather(*(cache.embed(manager, [text]) for text in ["a", "b", "c"]))
    assert .06 <= time.monotonic() - started < .3
    assert all(not r.success and r.error_category == "query_timeout" for r in rows)
    assert rows[1].duration == rows[2].duration == 0
    assert providers["siliconflow"].embed_texts.await_count == 2
    assert providers["openrouter"].embed_texts.await_count == 1
    assert manager.registry.model_health.snapshot() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 429, 503])
async def test_http_failures_advance_without_retrying_a_cooling_primary(status):
    async def fail(**kwargs):
        response = httpx.Response(status, request=httpx.Request("POST", "https://example.test/embeddings"))
        raise httpx.HTTPStatusError("failed", request=response.request, response=response)

    manager, _, providers = make_manager(primary=fail)
    result = await embed_queries(manager, ["query"])
    assert result.success and result.fallback_used
    assert providers["siliconflow"].embed_texts.await_count == 1
    assert manager.registry.model_health.snapshot()[0]["cooling_down"]


@pytest.mark.asyncio
@pytest.mark.parametrize("unavailable", ["no_key", "space", "dimensions", "no_space", "primary_changed"])
async def test_incompatible_or_unconfigured_routes_never_receive_queries(unavailable):
    manager, configs, providers = make_manager()
    backup = providers["openrouter"]
    if unavailable == "no_key":
        providers.pop("openrouter")
    elif unavailable == "space":
        configs["backup"]["embedding_space"] = "different-weights"
    elif unavailable == "dimensions":
        configs["backup"]["embedding_dimensions"] = 3
    elif unavailable == "no_space":
        configs["primary"].pop("embedding_space")
    else:
        manager.registry.get_task_model = lambda _: "backup"
        providers["openrouter"].embed_texts.side_effect = stalled
    result = await embed_queries(manager, ["query"])
    assert not result.success and not result.fallback_used
    if unavailable != "primary_changed":
        assert backup.embed_texts.await_count == 0
    else:
        assert providers["siliconflow"].embed_texts.await_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("vectors", [[], [[1.0]], [[1.0, float("nan")]], [[1.0, 0.0], [0.0, 1.0]]])
async def test_invalid_backup_vectors_fail_before_retrieval_and_are_not_retried(vectors):
    manager, _, providers = make_manager()
    providers["openrouter"].embed_texts.side_effect = None
    providers["openrouter"].embed_texts.return_value = vectors
    cache = QueryEmbeddingCache()
    first = await cache.embed(manager, ["query"])
    second = await cache.embed(manager, ["other"])
    assert not first.success and first.error_category == "invalid_embedding"
    assert not second.success and second.duration == 0
    assert providers["openrouter"].embed_texts.await_count == 1


@pytest.mark.asyncio
async def test_changed_backup_config_does_not_reuse_old_vectors_or_preference():
    manager, configs, providers = make_manager()
    cache = QueryEmbeddingCache()
    await cache.embed(manager, ["query"])
    configs["backup"]["embedding_options"]["provider"]["only"] = ["example-provider"]
    result = await cache.embed(manager, ["query"])
    assert result.success and providers["siliconflow"].embed_texts.await_count == 4
    assert providers["openrouter"].embed_texts.await_count == 2


@pytest.mark.asyncio
async def test_cancellation_during_backup_propagates_without_poisoning_request():
    started = asyncio.Event()

    async def backup(**kwargs):
        started.set()
        await stalled()

    manager, _, providers = make_manager(backup=backup)
    cache = QueryEmbeddingCache()
    task = asyncio.create_task(cache.embed(manager, ["query"]))
    await asyncio.wait_for(started.wait(), .3)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not cache.failures and manager.registry.model_health.snapshot() == []
    providers["siliconflow"].embed_texts.side_effect = working
    assert (await cache.embed(manager, ["query"])).model_used == "primary"


@pytest.mark.asyncio
async def test_openrouter_sends_explicit_provider_exclusion(monkeypatch):
    payloads = []

    def handler(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 0.0]}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    provider = OpenRouterProvider("test")
    await provider.embed_texts(["query"], "qwen/qwen3-embedding-8b", provider={"ignore": ["siliconflow"]})
    assert payloads == [{"model": "qwen/qwen3-embedding-8b", "input": ["query"],
                         "provider": {"ignore": ["siliconflow"]}}]
