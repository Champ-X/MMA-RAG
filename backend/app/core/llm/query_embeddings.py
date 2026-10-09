"""Request-local reuse of successful, identical query embeddings.

No text normalization, approximate matches, cross-request storage, or fallback
model vectors are cached. A partially cached batch is sent intact to preserve
provider batching and fallback behavior. Query-only deadline failures suppress
further uncached calls in this request, without cooling down ingestion models.
"""

import asyncio
import copy
import json
import time
from typing import List, Optional

from app.core.config import settings
from app.core.logger import get_logger
from .manager import LLMCallResult

logger = get_logger(__name__)


async def _embed_query_batch(manager, texts: List[str]) -> LLMCallResult:
    registry = getattr(manager, "registry", None)
    model = registry.get_task_model("embedding") if registry else ""
    timeout = settings.query_embedding_timeout_seconds
    started = time.monotonic()
    try:
        # Cancellation propagates through LLMManager without recording a
        # provider failure: this is the query's patience limit, not evidence
        # that the same model cannot finish an ingestion batch.
        return await asyncio.wait_for(manager.embed(texts=texts), timeout=timeout)
    except asyncio.TimeoutError:
        elapsed = time.monotonic() - started
        logger.warning("Query embedding deadline exceeded: model={} duration={:.3f}s", model, elapsed)
        return LLMCallResult(
            success=False, error=f"Query embedding exceeded {timeout:g}s deadline",
            duration=elapsed, model_used=model or "", error_category="query_timeout",
        )


class QueryEmbeddingCache:
    def __init__(self):
        self._vectors = {}
        self._timed_out_signatures = set()
        self._lock = asyncio.Lock()
        self.reused_vectors = 0
        self.failures = []

    def _observe(self, result):
        if not result.success:
            receipt = {"reason": "query_timeout" if result.error_category == "query_timeout" else "embedding_failed",
                       "model": result.model_used}
            if receipt not in self.failures:
                self.failures.append(receipt)
        return result

    def _lookup(self, manager, texts):
        registry = getattr(manager, "registry", None)
        model = registry.get_task_model("embedding") if registry else None
        if not model or not texts:
            return None, [], None
        config = registry.get_model_config(model)
        signature = (id(manager), model, json.dumps(config, sort_keys=True, default=str))
        keys = [(signature, text) for text in texts]
        if all(key in self._vectors for key in keys):
            self.reused_vectors += len(keys)
            return signature, keys, LLMCallResult(
                success=True,
                data=[copy.deepcopy(self._vectors[key]) for key in keys],
                model_used=model,
            )
        return signature, keys, None

    async def embed(self, manager, texts: List[str]) -> LLMCallResult:
        # A successful vector is immutable from the cache's perspective. Reading
        # it needs no network lock: a slow miss must not hold up ready media
        # branches. There is no await between lookup and copying these vectors.
        _, _, cached = self._lookup(manager, texts)
        if cached is not None:
            return cached
        async with self._lock:
            # Recheck after waiting: another branch may have filled the cache,
            # or the caller may have changed the embedding configuration.
            signature, keys, cached = self._lookup(manager, texts)
            if cached is not None:
                return cached
            if signature is None:
                return self._observe(await _embed_query_batch(manager, texts))
            # Include configuration so switching provider/dimensions/model in
            # the middle of a request cannot reuse an incompatible vector.
            model = signature[1]

            if signature in self._timed_out_signatures:
                return LLMCallResult(
                    success=False, model_used=model, error_category="query_timeout",
                    error="Query embedding deadline already exceeded for this request",
                )

            result = self._observe(await _embed_query_batch(manager, texts))
            if result.error_category == "query_timeout":
                self._timed_out_signatures.add(signature)
            if (
                result.success
                and not result.fallback_used
                and result.model_used == model
                and isinstance(result.data, list)
                and len(result.data) == len(texts)
                and all(isinstance(vector, list) and vector for vector in result.data)
            ):
                for key, vector in zip(keys, result.data):
                    self._vectors[key] = copy.deepcopy(vector)
            return result


async def embed_queries(manager, texts: List[str], cache: Optional[QueryEmbeddingCache] = None):
    if cache is None:
        return await _embed_query_batch(manager, texts)
    return await cache.embed(manager, texts)
