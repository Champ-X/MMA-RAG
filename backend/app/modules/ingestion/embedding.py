"""Bounded, resumable dense embedding for ingestion (never the query path)."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import math
import time
import weakref
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from app.core.llm.manager import LLMCallResult


@dataclass(frozen=True)
class IngestionEmbeddingConfig:
    batch_size: int = 32
    max_batch_tokens: int = 16_000
    max_batch_bytes: int = 131_072
    concurrency: int = 2
    max_retries: int = 2
    total_timeout_seconds: float = 300.0
    attempt_timeout_seconds: float = 60.0
    backoff_base_seconds: float = 1.0
    backoff_max_seconds: float = 8.0

    def __post_init__(self):
        for name in ("batch_size", "max_batch_tokens", "max_batch_bytes", "concurrency"):
            value = getattr(self, name)
            if type(value) is not int or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        if type(self.max_retries) is not int or self.max_retries < 0:
            raise ValueError("max_retries must be a nonnegative integer")
        for name in ("total_timeout_seconds", "attempt_timeout_seconds", "backoff_base_seconds", "backoff_max_seconds"):
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be positive and finite")


class IngestionEmbeddingError(RuntimeError):
    """Safe structured failure fields for upload state and manual recovery."""

    def __init__(self, message: str, *, error_code: str = "dense_embedding_failed",
                 result: LLMCallResult | None = None, model_used: str = "",
                 retryable: bool = False, batch_start: int = 0, batch_count: int = 0):
        super().__init__(message)
        self.error_code = error_code
        self.error_category = getattr(result, "error_category", None)
        self.retryable = retryable
        self.status_code = getattr(result, "status_code", None)
        self.provider_code = getattr(result, "provider_code", None)
        self.provider_request_id = getattr(result, "request_id", None)
        self.model_used = getattr(result, "model_used", None) or model_used
        self.failed_stage = "dense_embedding"
        self.batch_start = batch_start
        self.batch_count = batch_count

    def status_fields(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in (
            "error_code", "error_category", "retryable", "status_code", "provider_code",
            "provider_request_id", "model_used", "failed_stage",
        )}


class _Limiter:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.active = 0
        self.condition = asyncio.Condition()

    @asynccontextmanager
    async def slot(self):
        async with self.condition:
            await self.condition.wait_for(lambda: self.active < self.capacity)
            self.active += 1
        try:
            yield
        finally:
            async with self.condition:
                self.active -= 1
                self.condition.notify_all()


# Every upload on the server's event loop shares one limiter. Separate loops
# used by tests/restarts never retain loop-bound semaphore state. If concurrent
# callers disagree, the stricter cap wins instead of creating another pool.
_limiters: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _limiter(capacity: int) -> _Limiter:
    loop = asyncio.get_running_loop()
    limiter = _limiters.get(loop)
    if limiter is None:
        limiter = _limiters[loop] = _Limiter(capacity)
    limiter.capacity = min(limiter.capacity, capacity)
    return limiter


def _estimated_tokens(text: str) -> int:
    # UTF-8 bytes are a conservative upper bound for byte-pair tokenizers. This
    # deliberately trades some request packing for no tokenizer/model download.
    return max(1, len(text.encode("utf-8")))


def _payload_bytes(model: str, texts: Sequence[str]) -> int:
    return len(json.dumps({"model": model, "input": texts}, ensure_ascii=False).encode("utf-8"))


def _batches(texts: list[str], model: str, config: IngestionEmbeddingConfig):
    start, token_count = 0, 0
    for index, text in enumerate(texts):
        tokens = _estimated_tokens(text)
        if tokens > config.max_batch_tokens or _payload_bytes(model, [text]) > config.max_batch_bytes:
            raise IngestionEmbeddingError(
                "单条文本超过入库向量化请求预算，请调整分块后重试。",
                error_code="dense_embedding_input_too_large", model_used=model,
                batch_start=index, batch_count=1,
            )
        if index > start and (index - start >= config.batch_size or
                              token_count + tokens > config.max_batch_tokens or
                              _payload_bytes(model, texts[start:index + 1]) > config.max_batch_bytes):
            yield start, index
            start, token_count = index, 0
        token_count += tokens
    if start < len(texts):
        yield start, len(texts)


def _validated_vectors(value: Any, count: int, dimensions: int) -> list[list[float]]:
    if not isinstance(value, list) or len(value) != count:
        raise ValueError("Embedding vector count does not match input")
    vectors = []
    for row in value:
        if not isinstance(row, (list, tuple)) or len(row) != dimensions:
            raise ValueError("Embedding vector dimensions do not match the configured space")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in row):
            raise ValueError("Embedding vector contains nonfinite or nonnumeric values")
        vectors.append([float(item) for item in row])
    return vectors


async def _callback(callback: Callable | None, *args):
    if callback is None:
        return None
    value = callback(*args)
    return await value if inspect.isawaitable(value) else value


def _transient(result: LLMCallResult) -> bool:
    if result.error_category in {"authentication", "billing", "access_denied", "content_policy", "configuration"}:
        return False
    if result.status_code in {401, 402, 403} or result.retryable is False:
        return False
    return result.error_category in {"transport", "rate_limited", "provider_error"} or (
        result.status_code == 429 or result.status_code is not None and 500 <= result.status_code < 600
    )


def _failure(result: LLMCallResult, model: str, start: int, count: int) -> IngestionEmbeddingError:
    timeout = "timeout" in str(result.error or "").lower()
    code = "dense_embedding_timeout" if timeout else "dense_embedding_unavailable" if _transient(result) else "dense_embedding_failed"
    message = "文本向量化请求超时，原文件和已完成批次已保留，可稍后重新处理。" if timeout else "文本向量化未完成，原文件和已完成批次已保留。"
    return IngestionEmbeddingError(message, error_code=code, result=result, model_used=model,
                                   retryable=_transient(result), batch_start=start, batch_count=count)


async def embed_ingestion_texts(
    manager: Any, texts: Sequence[str], *, config: IngestionEmbeddingConfig | None = None,
    model: str | None = None, on_progress: Callable | None = None,
    checkpoint_load: Callable | None = None, checkpoint_save: Callable | None = None,
) -> list[list[float]]:
    """Return input-ordered vectors, or raise ``IngestionEmbeddingError``.

    Checkpoint hooks load(key)->vectors|None / save(key,vectors), sync or async.
    Keys bind schema version, exact model, dimensions and exact ordered inputs.
    Hooks must not block the event loop; storage callers should use async I/O or
    ``to_thread``. The total budget includes queueing, hooks, retries and cooldown.
    No input truncation, model fallback, or swallowing of cancellation occurs.
    """
    config = config or IngestionEmbeddingConfig()
    texts = list(texts)
    if not texts:
        return []
    if any(not isinstance(text, str) or not text.strip() for text in texts):
        raise IngestionEmbeddingError("入库向量化输入包含空文本或无效文本。", error_code="dense_embedding_invalid_input")
    model = model or manager.registry.get_task_model("embedding")
    model_config = manager.registry.get_model_config(model) if model else {}
    dimensions = model_config.get("embedding_dimensions")
    if not model or type(dimensions) is not int or dimensions < 1:
        raise IngestionEmbeddingError("入库向量模型或向量维度未配置。", error_code="dense_embedding_configuration", model_used=model or "")
    planned = list(_batches(texts, model_config.get("raw_model", model), config))
    limiter = _limiter(config.concurrency)
    deadline = time.monotonic() + config.total_timeout_seconds
    completed = requests = retries = 0
    last_result = None
    active_start = active_count = 0
    progress_lock = asyncio.Lock()

    async def progress(cached=False):
        # An asynchronous callback must not publish an older completed count
        # after another worker has already published a newer one.
        async with progress_lock:
            await _callback(on_progress, {"completed": completed, "total": len(texts), "requests": requests,
                                          "retries": retries, "model_used": model, "cached": cached})

    async def pause(attempt: int, result: LLMCallResult):
        delay = min(config.backoff_max_seconds, config.backoff_base_seconds * 2 ** min(attempt, 16))
        delay = max(delay, float(getattr(result, "retry_after_seconds", 0.0) or 0.0))
        if delay >= deadline - time.monotonic():
            raise TimeoutError()
        await asyncio.sleep(delay)

    async def batch(start: int, end: int, inherited_attempts: int = 0) -> list[list[float]]:
        nonlocal completed, requests, retries, last_result, active_start, active_count
        values = texts[start:end]
        identity = json.dumps(["ingestion-dense-v1", model, model_config.get("embedding_space"), dimensions, values],
                              ensure_ascii=False, separators=(",", ":"))
        key = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        cached = await _callback(checkpoint_load, key)
        if cached is not None:
            try:
                vectors = _validated_vectors(cached, len(values), dimensions)
            except ValueError:
                # Corrupt/old checkpoints are never used as index vectors.
                vectors = None
            if vectors is not None:
                completed += len(values)
                await progress(cached=True)
                return vectors

        attempts = inherited_attempts
        while True:
            active_start, active_count = start, len(values)
            async with limiter.slot():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                result = await manager.embed(
                    texts=values, model=model, fallback=False,
                    attempt_timeout=min(config.attempt_timeout_seconds, remaining),
                    total_timeout=remaining, **model_config.get("embedding_options", {}),
                )
            last_result = result
            # Shared model cooldowns can change while this upload is queued.
            # Waiting for one does not spend another provider-attempt allowance.
            if getattr(result, "cooldown_blocked", False) and _transient(result):
                await pause(attempts, result)
                continue
            requests += 1
            if result.success:
                if result.model_used and result.model_used != model:
                    raise IngestionEmbeddingError("向量模型发生变化，拒绝混用不同向量空间。", error_code="dense_embedding_invalid_response", model_used=model)
                try:
                    vectors = _validated_vectors(result.data, len(values), dimensions)
                except ValueError as exc:
                    raise IngestionEmbeddingError(str(exc), error_code="dense_embedding_invalid_response", result=result, model_used=model,
                                                  batch_start=start, batch_count=len(values)) from exc
                await _callback(checkpoint_save, key, vectors)
                completed += len(values)
                await progress()
                return vectors

            transient = _transient(result)
            oversized = result.status_code == 413
            if oversized and len(values) == 1:
                raise IngestionEmbeddingError(
                    "单条文本超出服务商请求限制，请调整分块后重试。",
                    error_code="dense_embedding_input_too_large", result=result, model_used=model,
                    batch_start=start, batch_count=1,
                )
            if not (transient or oversized) or attempts >= config.max_retries:
                raise _failure(result, model, start, len(values))
            retries += 1
            await pause(attempts, result)
            attempts += 1
            # Timeout/oversized batches shrink immediately. Other transient
            # failures get one same-size retry before reducing the payload.
            shrink = oversized or result.error_category == "transport" or attempts >= 2
            if shrink and len(values) > 1:
                middle = start + len(values) // 2
                left = await batch(start, middle, attempts)
                right = await batch(middle, end, attempts)
                vectors = left + right
                await _callback(checkpoint_save, key, vectors)
                return vectors

    try:
        async with asyncio.timeout(config.total_timeout_seconds):
            await progress()
            output: list[list[list[float]]] = [[] for _ in planned]
            remaining_batches = iter(enumerate(planned))
            stopped = asyncio.Event()

            async def worker():
                try:
                    for index, (start, end) in remaining_batches:
                        if stopped.is_set():
                            return
                        output[index] = await batch(start, end)
                except BaseException:
                    stopped.set()
                    raise

            workers = [asyncio.create_task(worker(), name=f"ingestion-dense-worker-{i}")
                       for i in range(min(config.concurrency, len(planned)))]
            try:
                await asyncio.gather(*workers)
            except BaseException:
                # gather propagates the first failure without cancelling sibling
                # work. Stop new batches, then wait until all workers have left
                # their provider call or settled their checkpoint write. Repeated
                # request cancellation must not release ownership early either.
                for task in workers:
                    if not task.done():
                        task.cancel()
                drain = asyncio.gather(*workers, return_exceptions=True)
                while not drain.done():
                    try:
                        await asyncio.shield(drain)
                    except asyncio.CancelledError:
                        continue
                drain.result()
                raise
            return [vector for values in output for vector in values]
    except TimeoutError as exc:
        raise IngestionEmbeddingError(
            "入库向量化超过本轮时间预算，原文件和已完成批次已保留。",
            error_code="dense_embedding_budget_exhausted", result=last_result, model_used=model,
            retryable=True, batch_start=active_start, batch_count=active_count,
        ) from exc
