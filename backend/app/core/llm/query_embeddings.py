"""Bounded query recovery and request-local reuse of compatible embeddings.

Retry the primary once on a query deadline, then try one explicitly compatible
provider. Successful recovery is reused only inside this request, with its real
model attribution. Neither query cancellation nor failover changes ingestion.
"""

import asyncio
import copy
import json
import math
import time
from typing import List, Optional

from app.core.config import settings
from app.core.logger import get_logger
from .manager import LLMCallResult

logger = get_logger(__name__)


class QueryEmbeddingError(RuntimeError):
    """An unavailable query vector is not a successful search with zero hits."""


def _query_fallback(registry, model):
    """Catalog membership or matching dimensions alone do not imply compatibility."""
    if registry is None:
        return None
    config = registry.get_model_config(model)
    candidate = config.get("query_fallback")
    if not candidate or candidate == model or not config.get("embedding_space"):
        return None
    backup = registry.get_model_config(candidate)
    if (
        backup.get("embedding_space") == config["embedding_space"]
        and backup.get("embedding_dimensions") == config.get("embedding_dimensions")
        and isinstance(config.get("embedding_dimensions"), int)
        and config["embedding_dimensions"] > 0
        and registry.get_provider(backup.get("provider", "")) is not None
    ):
        return candidate
    return None


def _valid_vectors(data, count, dimensions=None):
    return (
        isinstance(data, list) and len(data) == count
        and all(
            isinstance(vector, list) and vector
            and (dimensions is None or len(vector) == dimensions)
            and all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector)
            for vector in data
        )
    )


async def _embed_query_batch(manager, texts: List[str], preferred_model=None) -> LLMCallResult:
    registry = getattr(manager, "registry", None)
    model = registry.get_task_model("embedding") if registry else ""
    config = registry.get_model_config(model) if registry else {}
    backup = _query_fallback(registry, model)
    timeout = settings.query_embedding_timeout_seconds
    started = time.monotonic()

    async def attempt(candidate, deadline):
        options = registry.get_model_config(candidate).get("embedding_options", {}) if registry else {}
        try:
            # This layer owns the sequence/budget. Do not let the manager run a
            # second fallback chain, or cool down ingestion on query cancellation.
            result = await asyncio.wait_for(
                manager.embed(texts=texts, fallback=False,
                              **({"model": candidate} if candidate else {}), **options),
                timeout=deadline,
            )
        except asyncio.TimeoutError:
            result = LLMCallResult(
                success=False, error=f"Query embedding exceeded {deadline:g}s attempt",
                model_used=candidate or "", error_category="query_timeout",
            )
        if result.success and not _valid_vectors(result.data, len(texts), config.get("embedding_dimensions")):
            result = LLMCallResult(False, error="Invalid query embedding batch or dimensions",
                                   model_used=candidate or "", error_category="invalid_embedding")
        result.fallback_used = result.fallback_used or bool(backup and candidate == backup)
        # Include failed primary waiting in the successful fallback receipt.
        result.duration = time.monotonic() - started
        logger.info("Query embedding attempt: model={} fallback={} success={} reason={} elapsed={:.3f}s",
                    candidate, result.fallback_used, result.success, result.error_category, result.duration)
        return result

    # Once recovery succeeds, new texts in the same request go directly to that
    # provider instead of paying the primary timeout twice in every branch.
    if not backup or preferred_model != backup:
        for _ in range(2):
            result = await attempt(model, timeout)
            if result.success:
                return result
            # Actual HTTP errors already have classified cooldowns. Repeating
            # a 401/429/503 immediately cannot help; advance to the backup.
            if result.error_category != "query_timeout":
                break
    if backup:
        result = await attempt(backup, settings.query_embedding_fallback_timeout_seconds)
    return result


class QueryEmbeddingCache:
    def __init__(self):
        self._vectors = {}
        self._failed_signatures = {}
        self._preferred_models = {}
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
        backup = _query_fallback(registry, model)
        configs = [config, backup, registry.get_model_config(backup) if backup else None]
        signature = (id(manager), model, json.dumps(configs, sort_keys=True, default=str))
        keys = [(signature, text) for text in texts]
        if all(key in self._vectors for key in keys):
            sources = {(self._vectors[key][1], self._vectors[key][2]) for key in keys}
            if len(sources) == 1:
                used_model, fallback_used = sources.pop()
                self.reused_vectors += len(keys)
                return signature, keys, LLMCallResult(
                    success=True,
                    data=[copy.deepcopy(self._vectors[key][0]) for key in keys],
                    model_used=used_model, fallback_used=fallback_used,
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

            if signature in self._failed_signatures:
                failed = copy.copy(self._failed_signatures[signature])
                failed.duration = 0
                return failed

            result = self._observe(await _embed_query_batch(manager, texts, self._preferred_models.get(signature)))
            if result.error_category == "query_timeout" or (not result.success and result.fallback_used):
                self._failed_signatures[signature] = copy.copy(result)
            backup = _query_fallback(manager.registry, model)
            compatible_fallback = bool(backup and result.fallback_used and result.model_used == backup)
            if (
                result.success
                and ((not result.fallback_used and result.model_used == model) or compatible_fallback)
                and _valid_vectors(result.data, len(texts))
            ):
                if compatible_fallback:
                    self._preferred_models[signature] = result.model_used
                for key, vector in zip(keys, result.data):
                    self._vectors[key] = (copy.deepcopy(vector), result.model_used, result.fallback_used)
            return result


async def embed_queries(manager, texts: List[str], cache: Optional[QueryEmbeddingCache] = None):
    if cache is None:
        return await _embed_query_batch(manager, texts)
    return await cache.embed(manager, texts)
