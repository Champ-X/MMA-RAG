from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from nexus.shared.domain.errors import CapabilityUnavailableError


class OpenAIEmbeddingEncoder:
    """Projection-bound OpenAI-compatible embedding adapter with strict dimensions."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        model: str,
        dimension: int,
        timeout_seconds: float = 60,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.dimension = dimension
        self.timeout_seconds = timeout_seconds
        self.name = f"openai-embedding:{model}:{dimension}"
        self.route_resolver: Callable[[str, tuple[str, ...]], dict[str, str] | None] | None = None

    def encode_query(self, text: str) -> list[float]:
        return self.encode_documents([text])[0]

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            route = (
                self.route_resolver("dense_embedding", ("embedding",))
                if self.route_resolver
                else None
            )
            endpoint = route["endpoint"] if route else self.endpoint
            api_key = route["api_key"] if route else self.api_key
            model = route["model"] if route else self.model
            response = httpx.post(
                f"{endpoint.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": texts},
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            rows = sorted(payload.get("data", []), key=lambda item: int(item.get("index", 0)))
            vectors = [self._validate(item.get("embedding")) for item in rows]
            if len(vectors) != len(texts):
                raise ValueError(
                    f"embedding count mismatch: expected {len(texts)}, received {len(vectors)}"
                )
            return vectors
        except Exception as exc:
            raise CapabilityUnavailableError(
                "Dense embedding provider call failed",
                details={"model": self.model, "error_type": type(exc).__name__},
            ) from exc

    def health(self, *, probe: bool = False) -> dict[str, object]:
        if not probe:
            return {
                "status": "configured",
                "model": self.model,
                "dimension": self.dimension,
                "protocol": "openai_embeddings",
            }
        try:
            vector = self.encode_query("MMA-RAG embedding health probe")
            return {
                "status": "ready",
                "model": self.model,
                "dimension": len(vector),
                "protocol": "openai_embeddings",
            }
        except Exception as exc:
            return {
                "status": "unavailable",
                "model": self.model,
                "dimension": self.dimension,
                "error_type": type(exc).__name__,
            }

    def manifest(self) -> dict[str, object]:
        return {
            "type": "remote_embedding",
            "protocol": "openai_embeddings",
            "endpoint": self.endpoint,
            "model": self.model,
            "dimension": self.dimension,
            "normalization": "provider_output",
        }

    def _validate(self, raw: object) -> list[float]:
        if not isinstance(raw, list):
            raise ValueError("embedding is not an array")
        vector = [float(item) for item in raw]
        if len(vector) != self.dimension:
            raise ValueError(
                f"embedding dimension mismatch: expected {self.dimension}, got {len(vector)}"
            )
        if not all(math.isfinite(item) for item in vector):
            raise ValueError("embedding contains a non-finite value")
        return vector


@dataclass(frozen=True, slots=True)
class RerankItem:
    index: int
    score: float


class RemoteReranker:
    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        model: str,
        timeout_seconds: float = 60,
    ) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.name = f"remote-reranker:{model}"
        self.route_resolver: Callable[[str, tuple[str, ...]], dict[str, str] | None] | None = None

    def rerank(self, query: str, documents: list[str]) -> list[RerankItem]:
        if not documents:
            return []
        try:
            route = self.route_resolver("reranking", ("rerank",)) if self.route_resolver else None
            endpoint = route["endpoint"].rstrip("/") + "/rerank" if route else self.endpoint
            api_key = route["api_key"] if route else self.api_key
            model = route["model"] if route else self.model
            response = httpx.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "query": query,
                    "documents": [document[:10_000] for document in documents[:100]],
                    "top_n": min(len(documents), 100),
                    "return_documents": False,
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            values: list[RerankItem] = []
            for item in payload.get("results", []):
                index = int(item.get("index", -1))
                score = float(item.get("relevance_score", item.get("score", 0)))
                if 0 <= index < len(documents) and math.isfinite(score):
                    values.append(RerankItem(index=index, score=score))
            if not values:
                raise ValueError("reranker response contains no valid results")
            return values
        except Exception as exc:
            raise CapabilityUnavailableError(
                "Reranker provider call failed",
                details={"model": self.model, "error_type": type(exc).__name__},
            ) from exc

    def health(self, *, probe: bool = False) -> dict[str, object]:
        if not probe:
            return {"status": "configured", "model": self.model}
        try:
            results = self.rerank("health", ["health", "unrelated"])
            return {"status": "ready", "model": self.model, "result_count": len(results)}
        except Exception as exc:
            return {
                "status": "unavailable",
                "model": self.model,
                "error_type": type(exc).__name__,
            }
