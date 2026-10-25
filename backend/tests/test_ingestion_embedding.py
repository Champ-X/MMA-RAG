"""No-network ingestion embedding: bounded work, exact recovery and safe retries."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.llm.manager import LLMCallResult, LLMManager
from app.core.llm.model_health import ModelHealth
from app.modules.ingestion import embedding as module
from app.modules.ingestion.embedding import (
    IngestionEmbeddingConfig, IngestionEmbeddingError, embed_ingestion_texts,
)


def config(**kwargs):
    return replace(IngestionEmbeddingConfig(), backoff_base_seconds=.001,
                   backoff_max_seconds=.002, **kwargs)


def vectors(texts):
    return [[float(len(text)), float(sum(map(ord, text)))] for text in texts]


def manager(handler=None):
    async def success(**kwargs):
        return LLMCallResult(True, data=vectors(kwargs['texts']), model_used='indexed-model')
    return SimpleNamespace(
        registry=SimpleNamespace(
            get_task_model=lambda _: 'indexed-model',
            get_model_config=lambda _: {'embedding_dimensions': 2, 'embedding_space': 'fixed-v1'},
        ),
        embed=AsyncMock(side_effect=handler or success),
    )


def failed(category='transport', status=None, **kwargs):
    return LLMCallResult(False, error='ReadTimeout: transport (HTTP None)',
                         error_category=category, status_code=status,
                         model_used='indexed-model', **kwargs)


@pytest.mark.asyncio
async def test_batches_preserve_all_input_order_and_report_progress():
    instance = manager()
    texts = [str(i) for i in range(70)]
    progress = []
    assert await embed_ingestion_texts(instance, texts, on_progress=progress.append) == vectors(texts)
    calls = instance.embed.await_args_list
    assert [len(call.kwargs['texts']) for call in calls] == [32, 32, 6]
    assert [row['completed'] for row in progress] == [0, 32, 64, 70]
    assert all(call.kwargs['model'] == 'indexed-model' and call.kwargs['fallback'] is False for call in calls)


@pytest.mark.asyncio
@pytest.mark.parametrize('budget', ['tokens', 'bytes'])
async def test_token_and_json_byte_budgets_bound_requests(budget):
    instance = manager()
    texts = ['中文\\"\n' * 2 for _ in range(5)]
    if budget == 'tokens':
        cfg = config(max_batch_tokens=module._estimated_tokens(texts[0]) * 2)
    else:
        cfg = config(max_batch_bytes=module._payload_bytes('indexed-model', texts[:2]))
    assert await embed_ingestion_texts(instance, texts, config=cfg) == vectors(texts)
    assert [len(call.kwargs['texts']) for call in instance.embed.await_args_list] == [2, 2, 1]


@pytest.mark.asyncio
async def test_single_oversized_input_is_not_truncated_or_sent():
    instance = manager()
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['small', 'a' * 100], config=config(max_batch_tokens=10))
    assert error.value.error_code == 'dense_embedding_input_too_large'
    instance.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_rejecting_single_input_size_is_not_retried():
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = failed('request_error', 413)
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a'], config=config())
    assert error.value.error_code == 'dense_embedding_input_too_large'
    assert instance.embed.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(('category', 'status'), [('transport', None), ('request_error', 413)])
async def test_failed_big_batch_shrinks_without_dropping_or_duplicating_inputs(category, status):
    async def encode(**kwargs):
        texts = kwargs['texts']
        return failed(category, status) if len(texts) > 2 else LLMCallResult(True, data=vectors(texts))
    instance = manager(encode)
    texts = ['a', 'b', 'c', 'd']
    assert await embed_ingestion_texts(instance, texts, config=config()) == vectors(texts)
    assert [call.kwargs['texts'] for call in instance.embed.await_args_list] == [texts, texts[:2], texts[2:]]


@pytest.mark.asyncio
@pytest.mark.parametrize(('category', 'status'), [('rate_limited', 429), ('provider_error', 503)])
async def test_transient_http_failure_retries_same_model(category, status):
    instance = manager()
    instance.embed.side_effect = [failed(category, status), LLMCallResult(True, data=vectors(['a', 'b']))]
    assert await embed_ingestion_texts(instance, ['a', 'b'], config=config()) == vectors(['a', 'b'])
    assert instance.embed.await_count == 2
    assert all(call.kwargs['fallback'] is False for call in instance.embed.await_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize(('category', 'status'), [
    ('authentication', 401), ('billing', 402), ('access_denied', 403), ('content_policy', 400), ('request_error', 400),
])
async def test_permanent_failure_does_not_retry_or_split_and_preserves_evidence(category, status):
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = LLMCallResult(False, error='blocked', error_category=category, status_code=status,
                                               provider_code='blocked-code', request_id='req-1', model_used='indexed-model')
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a', 'b'], config=config())
    assert instance.embed.await_count == 1
    fields = error.value.status_fields()
    assert fields['failed_stage'] == 'dense_embedding'
    assert fields['provider_request_id'] == 'req-1' and fields['provider_code'] == 'blocked-code'
    assert fields['retryable'] is False and fields['error_category'] == category


@pytest.mark.asyncio
async def test_repeated_timeout_is_bounded_and_keeps_timeout_code():
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = failed()
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a'], config=config(max_retries=2))
    assert instance.embed.await_count == 3
    assert error.value.error_code == 'dense_embedding_timeout' and error.value.retryable


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', [[], [[1]], [[1, float('nan')]], [[1, float('inf')]], [[True, 2]], [['1', 2]]])
async def test_invalid_vectors_never_reach_checkpoint_or_caller(bad):
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = LLMCallResult(True, data=bad)
    save = AsyncMock()
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a'], checkpoint_save=save)
    assert error.value.error_code == 'dense_embedding_invalid_response'
    save.assert_not_awaited()
    assert instance.embed.await_count == 1


@pytest.mark.asyncio
async def test_changed_model_is_never_mixed_into_configured_space():
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = LLMCallResult(True, data=[[1, 2]], model_used='another-model')
    with pytest.raises(IngestionEmbeddingError, match='向量模型发生变化'):
        await embed_ingestion_texts(instance, ['a'])


@pytest.mark.asyncio
async def test_successful_batches_resume_and_key_binds_order_model_and_dimensions():
    saved, progress = {}, []
    instance = manager()
    instance.embed.side_effect = [LLMCallResult(True, data=vectors(['a', 'b'])), failed('authentication', 401)]
    cfg = config(batch_size=2)
    with pytest.raises(IngestionEmbeddingError):
        await embed_ingestion_texts(instance, ['a', 'b', 'c'], config=cfg,
                                    checkpoint_load=saved.get, checkpoint_save=saved.__setitem__)
    assert len(saved) == 1
    resumed = manager()
    assert await embed_ingestion_texts(resumed, ['a', 'b', 'c'], config=cfg, on_progress=progress.append,
                                       checkpoint_load=saved.get, checkpoint_save=saved.__setitem__) == vectors(['a', 'b', 'c'])
    assert resumed.embed.await_args.kwargs['texts'] == ['c']
    assert progress[1]['cached'] and progress[1]['completed'] == 2
    different = manager()
    await embed_ingestion_texts(different, ['b', 'a'], config=cfg, checkpoint_load=saved.get)
    assert different.embed.await_count == 1
    different.embed.reset_mock()
    with pytest.raises(IngestionEmbeddingError, match='向量模型发生变化'):
        await embed_ingestion_texts(different, ['a', 'b'], model='other-route', config=cfg, checkpoint_load=saved.get)
    assert different.embed.await_count == 1  # the old model's checkpoint was not used
    different.embed.reset_mock()
    different.registry.get_model_config = lambda _: {'embedding_dimensions': 3, 'embedding_space': 'fixed-v1'}
    different.embed.side_effect = None
    different.embed.return_value = LLMCallResult(True, data=[[1, 2, 3], [4, 5, 6]])
    assert await embed_ingestion_texts(different, ['a', 'b'], config=cfg, checkpoint_load=saved.get) == [[1, 2, 3], [4, 5, 6]]
    assert different.embed.await_count == 1


@pytest.mark.asyncio
async def test_corrupt_checkpoint_is_recomputed_and_replaced():
    instance, save = manager(), AsyncMock()
    assert await embed_ingestion_texts(instance, ['a'], checkpoint_load=lambda _: [[float('nan'), 2]],
                                       checkpoint_save=save) == vectors(['a'])
    assert instance.embed.await_count == save.await_count == 1


@pytest.mark.asyncio
async def test_global_concurrency_is_shared_across_uploads():
    active = maximum = 0
    entered, release = asyncio.Event(), asyncio.Event()
    async def encode(**kwargs):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        if active == 2:
            entered.set()
        try:
            await release.wait()
            return LLMCallResult(True, data=vectors(kwargs['texts']))
        finally:
            active -= 1
    instance = manager(encode)
    tasks = [asyncio.create_task(embed_ingestion_texts(instance, [str(i)])) for i in range(5)]
    await asyncio.wait_for(entered.wait(), .5)
    await asyncio.sleep(0)
    assert maximum == 2 and instance.embed.await_count == 2
    release.set()
    await asyncio.gather(*tasks)
    assert maximum == 2


@pytest.mark.asyncio
async def test_one_document_runs_two_batches_concurrently_and_restores_input_order():
    second_entered, release_first = asyncio.Event(), asyncio.Event()
    finished, progress = [], []
    async def encode(**kwargs):
        text = kwargs['texts'][0]
        if text == 'first':
            await second_entered.wait()
            await release_first.wait()
        else:
            second_entered.set()
        finished.append(text)
        return LLMCallResult(True, data=vectors(kwargs['texts']))
    instance = manager(encode)
    texts = ['first', 'second', 'third']
    task = asyncio.create_task(embed_ingestion_texts(instance, texts, config=config(batch_size=1), on_progress=progress.append))
    await asyncio.wait_for(second_entered.wait(), .5)
    await asyncio.sleep(0)
    assert finished == ['second', 'third']
    release_first.set()
    assert await task == vectors(texts)
    assert [row['completed'] for row in progress] == sorted(row['completed'] for row in progress)
    assert progress[-1]['completed'] == 3


@pytest.mark.asyncio
async def test_multiple_document_workers_still_share_one_global_request_cap():
    active = maximum = 0
    both_entered, release = asyncio.Event(), asyncio.Event()
    async def encode(**kwargs):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        if active == 2:
            both_entered.set()
        try:
            await release.wait()
            return LLMCallResult(True, data=vectors(kwargs['texts']))
        finally:
            active -= 1
    instance = manager(encode)
    tasks = [asyncio.create_task(embed_ingestion_texts(instance, ['a', 'b', 'c'], config=config(batch_size=1))) for _ in range(3)]
    await asyncio.wait_for(both_entered.wait(), .5)
    await asyncio.sleep(0)
    assert maximum == 2 and instance.embed.await_count == 2
    release.set()
    results = await asyncio.gather(*tasks)
    assert results == [vectors(['a', 'b', 'c'])] * 3
    assert maximum == 2


@pytest.mark.asyncio
async def test_first_batch_failure_cancels_sibling_and_does_not_start_more_batches():
    sibling_entered, sibling_cancelled = asyncio.Event(), asyncio.Event()
    async def encode(**kwargs):
        if kwargs['texts'] == ['bad']:
            await sibling_entered.wait()
            return failed('authentication', 401, provider_code='auth', request_id='req-auth', retryable=False)
        sibling_entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            sibling_cancelled.set()
    instance = manager(encode)
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['bad', 'sibling', 'unstarted'], config=config(batch_size=1))
    assert sibling_cancelled.is_set()
    assert [call.kwargs['texts'] for call in instance.embed.await_args_list] == [['bad'], ['sibling']]
    assert error.value.provider_request_id == 'req-auth'
    assert error.value.provider_code == 'auth' and error.value.retryable is False


@pytest.mark.asyncio
async def test_failed_parallel_batch_waits_for_cancelled_checkpoint_write_to_settle():
    import threading
    from app.modules.ingestion.storage.async_io import settled_write
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    checkpoint_entered = asyncio.Event()
    def save_sync():
        entered.set()
        assert release.wait(3)
        finished.set()
    async def save(*_args):
        checkpoint_entered.set()
        await settled_write(save_sync)
    async def encode(**kwargs):
        if kwargs['texts'] == ['bad']:
            await checkpoint_entered.wait()
            await asyncio.to_thread(entered.wait, 1)
            return failed('authentication', 401, retryable=False)
        return LLMCallResult(True, data=vectors(kwargs['texts']))
    task = asyncio.create_task(embed_ingestion_texts(manager(encode), ['good', 'bad'],
                              config=config(batch_size=1), checkpoint_save=save))
    try:
        await asyncio.wait_for(checkpoint_entered.wait(), .5)
        await asyncio.sleep(.02)
        assert not task.done() and not finished.is_set()
        release.set()
        with pytest.raises(IngestionEmbeddingError) as error:
            await task
        assert error.value.error_category == 'authentication'
        assert finished.is_set()
    finally:
        release.set()


@pytest.mark.asyncio
async def test_parallel_total_budget_cancels_all_workers_and_releases_global_slots():
    started, cancelled = [], []
    async def encode(**kwargs):
        text = kwargs['texts'][0]
        started.append(text)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(text)
    instance = manager(encode)
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a', 'b', 'c'], config=config(batch_size=1, total_timeout_seconds=.02))
    assert error.value.error_code == 'dense_embedding_budget_exhausted'
    assert set(started) == set(cancelled) == {'a', 'b'}
    assert await embed_ingestion_texts(manager(), ['after']) == vectors(['after'])


@pytest.mark.asyncio
async def test_budget_includes_provider_queue_and_cooldown():
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = failed(retry_after_seconds=15)
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a'], config=config(total_timeout_seconds=.02))
    assert error.value.error_code == 'dense_embedding_budget_exhausted'
    assert instance.embed.await_count == 1


@pytest.mark.asyncio
async def test_attempt_cancellation_and_queue_budget_release_shared_slot():
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def hung(**kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    instance = manager(hung)
    first = asyncio.create_task(embed_ingestion_texts(instance, ['a'], config=config(concurrency=1)))
    await entered.wait()
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['b'], config=config(concurrency=1, total_timeout_seconds=.02))
    assert error.value.error_code == 'dense_embedding_budget_exhausted'
    assert instance.embed.await_count == 1
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert cancelled.is_set()
    assert await embed_ingestion_texts(manager(), ['c'], config=config(concurrency=1)) == vectors(['c'])


@pytest.mark.asyncio
async def test_cancellation_during_backoff_stays_cancelled(monkeypatch):
    entered = asyncio.Event()
    async def paused(_delay):
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(module.asyncio, 'sleep', paused)
    instance = manager()
    instance.embed.side_effect = None
    instance.embed.return_value = failed()
    task = asyncio.create_task(embed_ingestion_texts(instance, ['a']))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert instance.embed.await_count == 1


@pytest.mark.asyncio
async def test_real_manager_cooldown_is_waited_without_spending_a_retry(monkeypatch):
    from app.core.llm import manager as manager_module, model_health
    now, sleeps = [100.0], []
    monkeypatch.setattr(model_health, 'time', SimpleNamespace(time=lambda: now[0]))
    monkeypatch.setattr(manager_module, 'time', SimpleNamespace(time=lambda: now[0], monotonic=module.time.monotonic))
    async def advance(delay):
        sleeps.append(delay)
        now[0] += delay
    monkeypatch.setattr(module.asyncio, 'sleep', advance)
    provider = SimpleNamespace(embed_texts=AsyncMock(side_effect=[httpx.ReadTimeout('private'), [[1.0, 2.0]]]))
    instance = object.__new__(LLMManager)
    instance.registry = SimpleNamespace(
        get_task_model=lambda _: 'indexed-model',
        get_model_config=lambda _: {'provider': 'fixture', 'embedding_dimensions': 2},
        get_raw_model_name=lambda model: model,
        get_provider=lambda _: provider,
        get_task_fallbacks=lambda _: ['incompatible-backup'],
        model_health=ModelHealth(),
    )
    # Existing sibling failure must not consume our two actual attempts.
    instance.registry.model_health.record('fixture', 'indexed-model', 'embed_texts', duration=60,
                                         error=httpx.ReadTimeout('private'))
    assert await embed_ingestion_texts(instance, ['a'], config=config(max_retries=1)) == [[1.0, 2.0]]
    assert sleeps == [15.0, 15.0]
    assert provider.embed_texts.await_count == 2
    assert all(call.kwargs['model'] == 'indexed-model' for call in provider.embed_texts.await_args_list)


@pytest.mark.asyncio
async def test_real_manager_attempt_timeout_cancels_provider_and_preserves_timeout_code():
    cancelled = asyncio.Event()
    async def stalled(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    provider = SimpleNamespace(embed_texts=AsyncMock(side_effect=stalled))
    instance = object.__new__(LLMManager)
    instance.registry = SimpleNamespace(
        get_task_model=lambda _: 'indexed-model',
        get_model_config=lambda _: {'provider': 'fixture', 'embedding_dimensions': 2},
        get_raw_model_name=lambda model: model,
        get_provider=lambda _: provider,
        get_task_fallbacks=lambda _: [],
        model_health=ModelHealth(),
    )
    with pytest.raises(IngestionEmbeddingError) as error:
        await embed_ingestion_texts(instance, ['a'], config=config(max_retries=0, attempt_timeout_seconds=.01))
    assert cancelled.is_set()
    assert error.value.error_code == 'dense_embedding_timeout'
    assert error.value.error_category == 'transport'
    assert provider.embed_texts.await_count == 1


@pytest.mark.asyncio
async def test_siliconflow_response_indexes_are_reordered_and_invalid_indexes_rejected():
    from app.core.llm.providers.silicon_flow import SiliconFlowProvider
    provider = SiliconFlowProvider('offline-placeholder')
    payload = {'model': 'indexed-model', 'input': ['a', 'b']}
    async def post(*_args, **_kwargs):
        return httpx.Response(200, request=httpx.Request('POST', 'https://example.invalid/embeddings'),
                              json={'data': [{'index': 1, 'embedding': [2]}, {'index': 0, 'embedding': [1]}]})
    client = SimpleNamespace(post=post)
    try:
        assert await provider._embed_with_client(client, payload) == [[1], [2]]
        for data in ([{'index': 0, 'embedding': [1]}] * 2,
                     [{'embedding': [1]}, {'embedding': [2]}],
                     [{'index': -1, 'embedding': [1]}, {'index': 1, 'embedding': [2]}]):
            client.post = AsyncMock(return_value=httpx.Response(
                200, request=httpx.Request('POST', 'https://example.invalid/embeddings'), json={'data': data}))
            with pytest.raises(ValueError, match='indexes'):
                await provider._embed_with_client(client, payload)
    finally:
        await provider.close()
