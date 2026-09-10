"""Request-local reuse of successful, identical query embeddings.

No text normalization, approximate matches, cross-request storage, or fallback
model vectors are cached. A partially cached batch is sent intact to preserve
provider batching and fallback behavior.
"""

import asyncio
import copy
import json
from typing import List, Optional

from .manager import LLMCallResult


class QueryEmbeddingCache:
    def __init__(self):
        self._vectors = {}
        self._lock = asyncio.Lock()
        self.reused_vectors = 0

    async def embed(self, manager, texts: List[str]) -> LLMCallResult:
        async with self._lock:
            registry = getattr(manager, "registry", None)
            model = registry.get_task_model("embedding") if registry else None
            if not model or not texts:
                return await manager.embed(texts=texts)
            # Include configuration so switching provider/dimensions/model in
            # the middle of a request cannot reuse an incompatible vector.
            config = registry.get_model_config(model)
            signature = (id(manager), model, json.dumps(config, sort_keys=True, default=str))
            keys = [(signature, text) for text in texts]
            if all(key in self._vectors for key in keys):
                self.reused_vectors += len(keys)
                return LLMCallResult(
                    success=True,
                    data=[copy.deepcopy(self._vectors[key]) for key in keys],
                    model_used=model,
                )

            result = await manager.embed(texts=texts)
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
        return await manager.embed(texts=texts)
    return await cache.embed(manager, texts)
