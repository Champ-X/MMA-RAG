"""Wall-clock and streaming response budgets, with cancellable fake providers."""
import asyncio
import time
from types import SimpleNamespace

import pytest

from app.core.llm import LLMRegistry
from app.core.llm.manager import LLMCallResult, LLMManager
from app.core.llm.model_health import ModelHealth
import app.core.llm.manager as manager_module


def make_manager(task="final_generation", model_type="chat"):
    registry = object.__new__(LLMRegistry)
    registry._models = {
        name: {"provider": "test", "type": model_type, "raw_model": name}
        for name in ("primary", "backup", "last")
    }
    registry._providers = {"test": SimpleNamespace()}
    registry._task_config = {task: {"model": "primary", "fallbacks": ["backup", "last"]}}
    registry._task_routing = {task: "primary"}
    registry.model_health = ModelHealth()
    manager = object.__new__(LLMManager)
    manager.registry = registry
    return manager, registry._providers["test"]


def content(text):
    return {"choices": [{"delta": {"content": text}}]}


@pytest.mark.asyncio
async def test_hanging_chat_primary_is_cancelled_before_fast_fallback():
    manager, provider = make_manager()
    calls, cancelled = [], asyncio.Event()

    async def chat(*, model, messages, timeout, max_tokens):
        calls.append(model)
        if model == "primary":
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()
        assert cancelled.is_set()
        return {"choices": [{"message": {"content": "ready"}}]}

    provider.chat_completion = chat
    started = time.monotonic()
    result = await manager.chat([], timeout=300, attempt_timeout=.02, total_timeout=.5)
    assert result.success and result.model_used == "backup" and result.fallback_used
    assert calls == ["primary", "backup"] and cancelled.is_set()
    assert time.monotonic() - started < .4


@pytest.mark.asyncio
async def test_total_budget_covers_all_chat_attempts():
    manager, provider = make_manager()
    calls, cancelled = [], []

    async def chat(**kwargs):
        calls.append(kwargs["model"])
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(kwargs["model"])

    provider.chat_completion = chat
    result = await manager.chat([], attempt_timeout=.04, total_timeout=.06)
    assert not result.success
    assert calls == cancelled == ["primary", "backup"]


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit_total", [None, .01])
async def test_explicit_provider_timeout_overrides_short_default_but_not_total(monkeypatch, explicit_total):
    manager, provider = make_manager()
    monkeypatch.setitem(manager_module._INTERACTIVE_CHAT_TIMEOUTS, "final_generation", (.005, .01))

    async def chat(**kwargs):
        assert kwargs["timeout"] == .15
        await asyncio.sleep(.03)
        return {"choices": [{}]}

    provider.chat_completion = chat
    options = {} if explicit_total is None else {"total_timeout": explicit_total}
    result = await manager.chat([], timeout=.15, fallback=False, **options)
    assert result.success is (explicit_total is None)


@pytest.mark.asyncio
@pytest.mark.parametrize("task,attempt,total", [
    ("intent_recognition", 12, 30),
    ("query_rewriting", 12, 30),
    ("final_generation", 30, 75),
    ("health_check", 8, 12),
    ("image_captioning", None, 180),
    ("audio_transcription", None, 180),
    ("kb_portrait_generation", None, 180),
    ("document_chunking", None, 180),
    ("video_parsing", None, 360),
])
async def test_default_budget_contract_preserves_ingestion(monkeypatch, task, attempt, total):
    manager, _ = make_manager(task)
    captured = {}

    async def capture(method, model, params):
        captured.update(params)
        return LLMCallResult(True)

    monkeypatch.setattr(manager, "_call_with_model", capture)
    before = time.monotonic()
    await manager.chat([], task_type=task)
    assert captured.get("_attempt_timeout") == attempt
    assert total - .5 <= captured["_deadline"] - before <= total + .5
    if task == "video_parsing":
        assert captured["timeout"] == 180


@pytest.mark.asyncio
@pytest.mark.parametrize("task", ["document_chunking", "video_parsing"])
async def test_long_input_explicit_total_and_attempt_are_preserved(monkeypatch, task):
    manager, _ = make_manager(task)
    captured = {}

    async def capture(method, model, params):
        captured.update(params)
        return LLMCallResult(True)

    monkeypatch.setattr(manager, "_call_with_model", capture)
    before = time.monotonic()
    await manager.chat([], task_type=task, timeout=600, attempt_timeout=500, total_timeout=900)
    assert captured["timeout"] == 600 and captured["_attempt_timeout"] == 500
    assert 899.5 <= captured["_deadline"] - before <= 900.5


@pytest.mark.asyncio
@pytest.mark.parametrize("task", ["embedding", "reranking"])
async def test_embedding_and_reranking_consume_internal_attempt_option(task):
    manager, provider = make_manager(task, "embedding" if task == "embedding" else "reranker")
    calls, cancelled = [], asyncio.Event()

    async def run(model):
        calls.append(model)
        if model == "primary":
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.set()
        return [[1.0]] if task == "embedding" else [{"index": 0, "relevance_score": 1.0}]

    # Strict signatures detect accidental forwarding of attempt_timeout.
    async def embed_texts(*, texts, model):
        return await run(model)

    async def rerank(*, query, documents, model):
        return await run(model)

    provider.embed_texts, provider.rerank = embed_texts, rerank
    if task == "embedding":
        result = await manager.embed(["query"], attempt_timeout=.02, total_timeout=.5)
    else:
        result = await manager.rerank("query", ["document"], attempt_timeout=.02, total_timeout=.5)
    assert result.success and result.fallback_used and cancelled.is_set()
    assert calls == ["primary", "backup"]


@pytest.mark.asyncio
async def test_reasoning_heartbeats_do_not_extend_first_answer_deadline():
    manager, provider = make_manager()
    calls, closed = [], []

    async def stream(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        try:
            if model == "primary":
                while True:
                    yield {"choices": [{"delta": {"reasoning_content": "thinking"}}]}
                    await asyncio.sleep(.003)
            yield content("answer")
        finally:
            closed.append(model)

    provider.stream_chat = stream
    result = [text async for text in manager.stream_chat([], first_content_timeout=.02, total_timeout=.5)]
    assert result == ["answer"] and calls == closed == ["primary", "backup"]
    assert manager.registry.model_health.blocked("test", "primary", "chat_completion")


@pytest.mark.asyncio
async def test_first_content_budget_does_not_limit_ongoing_answer():
    manager, provider = make_manager()
    calls = []

    async def stream(**kwargs):
        calls.append(kwargs["model"])
        yield content("first")
        await asyncio.sleep(.04)
        yield content("last")

    provider.stream_chat = stream
    result = [text async for text in manager.stream_chat([], first_content_timeout=.01, total_timeout=.5)]
    assert result == ["first", "last"] and calls == ["primary"]


@pytest.mark.asyncio
async def test_total_timeout_after_content_closes_stream_without_fallback():
    manager, provider = make_manager()
    calls, closed, received = [], asyncio.Event(), []

    async def stream(**kwargs):
        calls.append(kwargs["model"])
        try:
            yield content("prefix")
            await asyncio.sleep(10)
        finally:
            closed.set()

    provider.stream_chat = stream
    with pytest.raises(TimeoutError):
        async for text in manager.stream_chat([], first_content_timeout=.01, total_timeout=.03):
            received.append(text)
    assert received == ["prefix"] and calls == ["primary"] and closed.is_set()


@pytest.mark.asyncio
async def test_timeout_scope_does_not_cancel_consumer_between_yields():
    manager, provider = make_manager()

    async def stream(**kwargs):
        yield content("first")
        yield content("last")

    provider.stream_chat = stream
    result = []
    async for text in manager.stream_chat([], first_content_timeout=.01, total_timeout=.3):
        result.append(text)
        await asyncio.sleep(.025)
    assert result == ["first", "last"]


@pytest.mark.asyncio
async def test_video_stream_keeps_long_input_default(monkeypatch):
    manager, provider = make_manager("video_parsing")
    monkeypatch.setattr(manager_module, "_FIRST_CONTENT_TIMEOUT", .005)

    async def stream(**kwargs):
        await asyncio.sleep(.02)
        yield content("video answer")

    provider.stream_chat = stream
    result = [text async for text in manager.stream_chat([], task_type="video_parsing", total_timeout=.2)]
    assert result == ["video answer"]


@pytest.mark.asyncio
@pytest.mark.parametrize("cleanup_hangs", [False, True])
async def test_cleanup_failure_does_not_prevent_precontent_fallback(monkeypatch, cleanup_hangs):
    manager, provider = make_manager()
    monkeypatch.setattr(manager_module, "_STREAM_CLOSE_TIMEOUT", .01)
    closed, calls = [], []

    class BrokenStream:
        async def __anext__(self):
            raise RuntimeError("original failure")

        async def aclose(self):
            try:
                if cleanup_hangs:
                    await asyncio.sleep(10)
                raise ValueError("cleanup failure")
            finally:
                closed.append("primary")

    async def backup():
        yield content("backup")

    def stream(**kwargs):
        calls.append(kwargs["model"])
        return BrokenStream() if kwargs["model"] == "primary" else backup()

    provider.stream_chat = stream
    result = [text async for text in manager.stream_chat([], first_content_timeout=.03, total_timeout=.5)]
    assert result == ["backup"] and calls == ["primary", "backup"] and closed == ["primary"]


@pytest.mark.asyncio
async def test_cleanup_error_does_not_hide_postcontent_failure():
    manager, provider = make_manager()
    calls = []

    class BrokenStream:
        sent = False

        async def __anext__(self):
            if not self.sent:
                self.sent = True
                return content("prefix")
            raise RuntimeError("original failure")

        async def aclose(self):
            raise ValueError("cleanup failure")

    def stream(**kwargs):
        calls.append(kwargs["model"])
        return BrokenStream()

    provider.stream_chat = stream
    with pytest.raises(RuntimeError, match="original failure"):
        async for _ in manager.stream_chat([]):
            pass
    assert calls == ["primary"]


@pytest.mark.asyncio
async def test_cancelled_request_closes_provider_without_fallback():
    manager, provider = make_manager()
    started, closed = asyncio.Event(), asyncio.Event()
    calls = []

    async def stream(**kwargs):
        calls.append(kwargs["model"])
        try:
            started.set()
            await asyncio.sleep(10)
            yield content("unreachable")
        finally:
            closed.set()

    provider.stream_chat = stream

    async def consume():
        return [text async for text in manager.stream_chat([])]

    task = asyncio.create_task(consume())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set() and calls == ["primary"]
