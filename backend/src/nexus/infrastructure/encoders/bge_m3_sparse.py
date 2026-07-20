from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import Any

from nexus.infrastructure.encoders.locks import model_load_lock
from nexus.shared.domain.errors import CapabilityUnavailableError

logger = logging.getLogger(__name__)


class BGEM3SparseEncoder:
    """Lazy BGE-M3 lexical-weight adapter with local/mirror model resolution."""

    name = "bge-m3-lexical-v1"

    def __init__(
        self,
        *,
        model_id: str = "BAAI/bge-m3",
        revision: str = "main",
        use_fp16: bool = False,
        hf_endpoint: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.revision = revision
        self.use_fp16 = use_fp16
        self.hf_endpoint = hf_endpoint
        self._model: Any | None = None
        self._lock = Lock()

    def _model_instance(self) -> Any:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            with model_load_lock():
                try:
                    from FlagEmbedding import BGEM3FlagModel
                    from huggingface_hub import snapshot_download
                except ImportError as exc:
                    raise CapabilityUnavailableError(
                        "BGE-M3 dependencies are not installed; install the 'models' extra"
                    ) from exc
                model_path = Path(self.model_id).expanduser()
                if not model_path.exists():
                    try:
                        model_path = Path(
                            snapshot_download(
                                repo_id=self.model_id,
                                revision=self.revision,
                                endpoint=self.hf_endpoint,
                                allow_patterns=[
                                    "config.json",
                                    "model.safetensors",
                                    "pytorch_model.bin",
                                    "sentencepiece.bpe.model",
                                    "special_tokens_map.json",
                                    "tokenizer.json",
                                    "tokenizer_config.json",
                                    "colbert_linear.pt",
                                    "sparse_linear.pt",
                                ],
                            )
                        )
                    except Exception as exc:
                        raise CapabilityUnavailableError(
                            "BGE-M3 model assets are unavailable",
                            details={"model_id": self.model_id, "error_type": type(exc).__name__},
                        ) from exc
                # FlagEmbedding versions differ here; local resolution and the generic
                # encode fallback keep the adapter compatible without trust_remote_code.
                self._model = BGEM3FlagModel(str(model_path), use_fp16=self.use_fp16)
                return self._model

    def encode_query(self, text: str) -> dict[int, float]:
        model = self._model_instance()
        encode = getattr(model, "encode_queries", model.encode)
        output = encode(
            [text],
            return_dense=False,
            return_sparse=True,
            return_colbert_vecs=False,
        )
        weights = output.get("lexical_weights") or []
        return self._normalize(weights[0] if weights else {})

    def encode_documents(self, texts: list[str], *, batch_size: int = 32) -> list[dict[int, float]]:
        model = self._model_instance()
        encode = getattr(model, "encode_corpus", model.encode)
        output = encode(
            texts,
            return_dense=False,
            return_sparse=True,
            return_colbert_vecs=False,
            batch_size=batch_size,
        )
        weights = output.get("lexical_weights") or []
        return [
            self._normalize(weights[index] if index < len(weights) else {})
            for index in range(len(texts))
        ]

    def health(self, *, load: bool = False) -> dict[str, object]:
        if not load and self._model is None:
            return {
                "status": "configured",
                "model_id": self.model_id,
                "revision": self.revision,
                "loaded": False,
            }
        try:
            vector = self.encode_query("health probe")
            return {
                "status": "ready",
                "model_id": self.model_id,
                "revision": self.revision,
                "loaded": True,
                "non_zero": len(vector),
            }
        except Exception as exc:
            logger.warning("BGE-M3 health probe failed: %s", type(exc).__name__)
            return {
                "status": "unavailable",
                "model_id": self.model_id,
                "revision": self.revision,
                "error_type": type(exc).__name__,
            }

    def manifest(self) -> dict[str, object]:
        return {
            "type": "local_sparse_model",
            "model_id": self.model_id,
            "revision": self.revision,
            "output": "lexical_weights",
            "preprocess": "bge_m3_flag_model",
        }

    @staticmethod
    def _normalize(value: object) -> dict[int, float]:
        if not isinstance(value, dict):
            return {}
        return {int(key): float(weight) for key, weight in value.items() if float(weight) != 0.0}
