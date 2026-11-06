"""Read already-loaded local query encoders without starting model preparation.

Pi owns its query cache; only model weights/inference locks are shared with the
ordinary retrieval path. Importing this module cannot load torch or a model.
"""
from __future__ import annotations

import asyncio
import math
import sys


class QueryVectorUnavailable(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class LocalQueryVectors:
    def __init__(self):
        self._values = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _encoder(kind):
        # A readiness check must not import the heavy encoder, instantiate its
        # singleton, download weights, or turn a search into model preparation.
        module = sys.modules.get("app.core.sparse_encoder" if kind == "sparse" else "app.core.local_models")
        if kind == "sparse":
            encoder = getattr(module, "_sparse_encoder", None)
            if encoder is None or getattr(encoder, "_model", None) is None or not getattr(encoder, "_initialized", False):
                raise QueryVectorUnavailable("local_model_not_ready")
            return encoder.encode_query
        runtime = getattr(module, "_runtime", None)
        if runtime is None or not runtime.snapshot().get(kind, {}).get("loaded", False):
            raise QueryVectorUnavailable("local_model_not_ready")
        return getattr(runtime, f"encode_{kind}_text")

    async def encode(self, kind: str, query: str):
        if kind not in {"sparse", "clip", "clap"}:
            raise QueryVectorUnavailable("unsupported_local_encoder")
        # Serialize this run's local work and reuse only exact successful query
        # vectors. The shared runtimes also serialize inference across callers.
        async with self._lock:
            identity = (kind, query)
            if identity in self._values:
                return self._values[identity]
            encode = self._encoder(kind)
            task = asyncio.create_task(asyncio.to_thread(encode, query))
            try:
                value = await asyncio.shield(task)
            except asyncio.CancelledError:
                # Thread inference cannot be cancelled. Settle it before
                # releasing capacity; no hidden inference outlives the run.
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        continue
                    except Exception:
                        break
                if not task.cancelled():
                    task.exception()
                raise
            except Exception:
                raise QueryVectorUnavailable("local_encoding_failed") from None
            if kind == "sparse":
                value = value.get("sparse") if isinstance(value, dict) else None
                if not isinstance(value, dict) or not value or any(
                    not isinstance(index, int) or isinstance(index, bool) or index < 0
                    or not isinstance(weight, (int, float)) or isinstance(weight, bool)
                    or not math.isfinite(weight) or weight <= 0 for index, weight in value.items()
                ):
                    raise QueryVectorUnavailable("invalid_local_vector")
            elif not isinstance(value, list) or not value or any(
                not isinstance(number, (int, float)) or isinstance(number, bool) or not math.isfinite(number)
                for number in value
            ) or not any(value):
                raise QueryVectorUnavailable("invalid_local_vector")
            self._values[identity] = value
            return value
