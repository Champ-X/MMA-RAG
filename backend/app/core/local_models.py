"""Shared, lazily loaded CLIP/CLAP inference runtimes for this process.

Only model weights and processors live here. Ingestion tasks and their mutable
state remain owned by their services. Each model has a separate reentrant lock:
loading, preprocessing, and inference on one processor/model are serialized,
while CLIP and CLAP can run independently.
"""

from contextlib import contextmanager
from threading import Lock, RLock
from time import perf_counter
from typing import Any, Dict, Iterator, List, Tuple

from app.core.logger import get_logger


logger = get_logger(__name__)

CLIP_MODEL_ID = "openai/clip-vit-large-patch14"
CLAP_MODEL_ID = "laion/clap-htsat-fused"


class _ModelSlot:
    def __init__(self, model_id: str):
        self.lock = RLock()
        self.model: Any = None
        self.processor: Any = None
        self.status: Dict[str, Any] = {
            "model_id": model_id,
            "state": "unloaded",
            "loaded": False,
            "warmed": False,
            "load_count": 0,
            "load_attempts": 0,
            "warmup_count": 0,
            "warmup_attempts": 0,
            "load_seconds": None,
            "warmup_seconds": None,
            "cache_source": None,
            "error_type": None,
        }


class LocalModelRuntime:
    """Own shared local models; obtain the application instance via the getter.

    ``snapshot`` only takes a short metadata lock, so readiness inspection does
    not wait for a download, model load, or inference to finish. Durations refer
    to the latest attempt; counts distinguish attempts from successful work.
    ``warmed`` means a text encoding has succeeded, whether issued by startup
    warmup or a real query. ``warmup_count`` only counts explicit warmup runs.
    """

    def __init__(self):
        self._status_lock = Lock()
        self._slots = {
            "clip": _ModelSlot(CLIP_MODEL_ID),
            "clap": _ModelSlot(CLAP_MODEL_ID),
        }

    def snapshot(self) -> Dict[str, Dict[str, Any]]:
        """Return detached, input-free state without acquiring inference locks."""
        with self._status_lock:
            return {name: dict(slot.status) for name, slot in self._slots.items()}

    @staticmethod
    def _cached_pretrained_pair(
        model_type: Any, processor_type: Any, model_id: str
    ) -> Tuple[Any, Any, str]:
        """Use complete local artifacts without a Hub metadata round trip.

        Missing local artifacts keep the existing download behavior. Each
        component retries independently, avoiding a second weight allocation
        when only the processor cache is incomplete. Other failures propagate.
        """
        cache_source = "local"

        def load_component(component_type: Any) -> Any:
            nonlocal cache_source
            try:
                return component_type.from_pretrained(model_id, local_files_only=True)
            except OSError:
                cache_source = "remote_allowed"
                return component_type.from_pretrained(model_id)

        model = load_component(model_type)
        processor = load_component(processor_type)
        return model, processor, cache_source

    def _load_clip_pair(self) -> Tuple[Any, Any, str]:
        # Imports stay lazy: creating or inspecting the runtime never loads
        # torch/transformers or the model itself.
        import torch
        from transformers import CLIPModel, CLIPProcessor

        model, processor, source = self._cached_pretrained_pair(
            CLIPModel, CLIPProcessor, CLIP_MODEL_ID
        )
        model.eval()
        if torch.cuda.is_available():
            model = model.to(torch.device("cuda"))
        return model, processor, source

    def _load_clap_pair(self) -> Tuple[Any, Any, str]:
        import torch
        from transformers import ClapModel, ClapProcessor

        model, processor, source = self._cached_pretrained_pair(
            ClapModel, ClapProcessor, CLAP_MODEL_ID
        )
        model.eval()
        if torch.cuda.is_available():
            model.to(torch.device("cuda"))
        return model, processor, source

    def _ensure_loaded(self, name: str) -> _ModelSlot:
        """Load under the caller's model lock; publish only a complete pair."""
        slot = self._slots[name]
        if slot.model is not None and slot.processor is not None:
            return slot

        started = perf_counter()
        with self._status_lock:
            slot.status.update(state="loading", error_type=None)
            slot.status["load_attempts"] += 1
        logger.info("正在加载本地模型: model={}", slot.status["model_id"])
        try:
            loader = self._load_clip_pair if name == "clip" else self._load_clap_pair
            model, processor, cache_source = loader()
            if model is None or processor is None:
                raise RuntimeError("Local model loader returned an incomplete pair")
        except Exception as exc:
            duration = perf_counter() - started
            with self._status_lock:
                slot.status.update(
                    state="error", load_seconds=duration, error_type=type(exc).__name__
                )
            logger.warning(
                "本地模型加载失败: model={} seconds={:.3f} error_type={}",
                slot.status["model_id"], duration, type(exc).__name__,
            )
            raise

        duration = perf_counter() - started
        with self._status_lock:
            slot.model, slot.processor = model, processor
            slot.status.update(
                state="loaded", loaded=True, load_seconds=duration,
                cache_source=cache_source, error_type=None,
            )
            slot.status["load_count"] += 1
        logger.info(
            "本地模型加载完成: model={} seconds={:.3f} cache_source={}",
            slot.status["model_id"], duration, cache_source,
        )
        return slot

    @contextmanager
    def _session(self, name: str) -> Iterator[Tuple[Any, Any]]:
        slot = self._slots[name]
        with slot.lock:
            self._ensure_loaded(name)
            try:
                yield slot.model, slot.processor
            except Exception as exc:
                # Consumer failures never discard valid shared weights. Store
                # only the exception class; inputs and exception text stay out
                # of runtime diagnostics.
                with self._status_lock:
                    slot.status.update(state="error", error_type=type(exc).__name__)
                raise
            else:
                with self._status_lock:
                    slot.status["error_type"] = None
                    if slot.status["state"] == "error":
                        slot.status["state"] = (
                            "ready" if slot.status["warmed"] else "loaded"
                        )

    def _mark_text_encoded(self, name: str) -> None:
        """Real queries also complete the same first text-inference work."""
        with self._status_lock:
            status = self._slots[name].status
            status.update(warmed=True, error_type=None)
            if status["state"] != "warming":
                status["state"] = "ready"

    def clip_session(self):
        """Yield (CLIP model, processor) with exclusive use of both objects."""
        return self._session("clip")

    def clap_session(self):
        """Yield (CLAP model, processor) with exclusive use of both objects."""
        return self._session("clap")

    def encode_clip_text(self, text: str) -> List[float]:
        """Preserve the existing CLIP query tokenizer and normalization."""
        import torch

        with self.clip_session() as (model, processor):
            inputs = processor.tokenizer(
                text, return_tensors="pt", padding=True, truncation=True
            )
            if torch.cuda.is_available():
                device = torch.device("cuda")
                inputs = {
                    key: value.to(device) if hasattr(value, "to") else value
                    for key, value in inputs.items()
                }
            with torch.no_grad():
                text_features = model.get_text_features(**inputs)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                vector = text_features.cpu().numpy()[0].tolist()
            assert len(vector) == 768, (
                f"CLIP文本向量维度错误: 期望768，实际{len(vector)}"
            )
            self._mark_text_encoded("clip")
            return vector

    def encode_clap_text(self, text: str) -> List[float]:
        """Preserve the existing CLAP text processing and 512-D output."""
        import numpy as np
        import torch

        with self.clap_session() as (model, processor):
            inputs = processor(text=[text])
            device = next(model.parameters()).device

            def to_device_tensor(value: Any) -> Any:
                if hasattr(value, "to"):
                    return value.to(device)
                if isinstance(value, (list, np.ndarray)):
                    return torch.tensor(value, device=device)
                return value

            inputs = {key: to_device_tensor(value) for key, value in inputs.items()}
            with torch.no_grad():
                text_features = model.get_text_features(**inputs)
            if text_features is None:
                raise ValueError("CLAP get_text_features 返回空")
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            vector = text_features.cpu().numpy()[0].tolist()
            if len(vector) != 512:
                vector = (vector + [0.0] * 512)[:512]
            self._mark_text_encoded("clap")
            return vector

    def _warmup(self, name: str) -> Dict[str, Any]:
        slot = self._slots[name]
        with slot.lock:
            self._ensure_loaded(name)
            with self._status_lock:
                if slot.status["warmed"] and slot.status["state"] != "error":
                    return dict(slot.status)
                slot.status.update(state="warming", error_type=None)
                slot.status["warmup_attempts"] += 1
            started = perf_counter()
            try:
                if name == "clip":
                    self.encode_clip_text("a quiet scene")
                else:
                    self.encode_clap_text("a piece of music")
            except Exception as exc:
                duration = perf_counter() - started
                with self._status_lock:
                    slot.status.update(
                        state="error", warmup_seconds=duration,
                        error_type=type(exc).__name__,
                    )
                logger.warning(
                    "本地模型预热失败: model={} seconds={:.3f} error_type={}",
                    slot.status["model_id"], duration, type(exc).__name__,
                )
                raise
            duration = perf_counter() - started
            with self._status_lock:
                slot.status.update(
                    state="ready", warmed=True, warmup_seconds=duration, error_type=None
                )
                slot.status["warmup_count"] += 1
                result = dict(slot.status)
            logger.info(
                "本地模型预热完成: model={} seconds={:.3f}",
                slot.status["model_id"], duration,
            )
            return result

    def warmup_clip(self) -> Dict[str, Any]:
        return self._warmup("clip")

    def warmup_clap(self) -> Dict[str, Any]:
        return self._warmup("clap")

    def warmup(self) -> Dict[str, Dict[str, Any]]:
        """Warm both text paths without competing for CPU during startup."""
        self.warmup_clip()
        self.warmup_clap()
        return self.snapshot()


_runtime: LocalModelRuntime | None = None
_runtime_lock = Lock()


def get_local_model_runtime() -> LocalModelRuntime:
    """Return the shared runtime, without loading models on first access."""
    global _runtime
    if _runtime is None:
        with _runtime_lock:
            if _runtime is None:
                _runtime = LocalModelRuntime()
    return _runtime
