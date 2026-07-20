from __future__ import annotations

import io
import os
import subprocess
import threading
from typing import Any

from nexus.infrastructure.encoders.locks import model_load_lock
from nexus.shared.domain.errors import CapabilityUnavailableError


class TransformersMultimodalEncoder:
    """Projection-bound CLIP/CLAP adapter, loaded lazily in media/index workers."""

    visual_dimension = 768
    acoustic_dimension = 512

    def __init__(
        self,
        *,
        clip_model_id: str,
        clip_revision: str,
        clap_model_id: str,
        clap_revision: str,
        hf_endpoint: str | None = None,
    ) -> None:
        self.clip_model_id = clip_model_id
        self.clip_revision = clip_revision
        self.clap_model_id = clap_model_id
        self.clap_revision = clap_revision
        self.hf_endpoint = hf_endpoint
        if hf_endpoint:
            os.environ.setdefault("HF_ENDPOINT", hf_endpoint)
        self._clip_model: Any | None = None
        self._clip_processor: Any | None = None
        self._clap_model: Any | None = None
        self._clap_processor: Any | None = None
        self._clip_lock = threading.Lock()
        self._clap_lock = threading.Lock()

    @property
    def name(self) -> str:
        return f"clip:{self.clip_model_id}|clap:{self.clap_model_id}"

    def encode_image(self, content: bytes) -> list[float]:
        from PIL import Image

        model, processor = self._clip()
        torch = self._torch()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        inputs = self._to_device(inputs, model)
        with torch.no_grad():
            vector = model.get_image_features(**inputs)
        return self._normalized(vector, self.visual_dimension)

    def encode_visual_query(self, text: str) -> list[float]:
        model, processor = self._clip()
        torch = self._torch()
        inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
        inputs = self._to_device(inputs, model)
        with torch.no_grad():
            vector = model.get_text_features(**inputs)
        return self._normalized(vector, self.visual_dimension)

    def encode_audio(
        self, content: bytes, *, start_ms: int | None = None, end_ms: int | None = None
    ) -> list[float]:
        model, processor = self._clap()
        torch = self._torch()
        try:
            import numpy as np

            start_seconds = max(0.0, float(start_ms or 0) / 1000.0)
            duration_seconds = (
                max(0.05, min(30.0, float(end_ms - (start_ms or 0)) / 1000.0))
                if end_ms is not None
                else 30.0
            )
            completed = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    "pipe:0",
                    "-ss",
                    f"{start_seconds:.3f}",
                    "-t",
                    f"{duration_seconds:.3f}",
                    "-vn",
                    "-f",
                    "f32le",
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "pipe:1",
                ],
                input=content,
                capture_output=True,
                check=False,
                timeout=60,
            )
            if completed.returncode != 0:
                raise RuntimeError(f"ffmpeg exited with status {completed.returncode}")
            waveform = np.frombuffer(completed.stdout, dtype="<f4").copy()
        except Exception as exc:
            raise CapabilityUnavailableError(
                "CLAP could not decode the audio object",
                details={"error_type": type(exc).__name__},
            ) from exc
        if len(waveform) == 0:
            raise CapabilityUnavailableError("CLAP received an empty audio segment")
        extractor = processor.feature_extractor
        inputs = extractor([waveform], sampling_rate=48_000, return_tensors="pt")
        inputs = self._to_device(inputs, model)
        with torch.no_grad():
            vector = model.get_audio_features(**inputs)
        return self._normalized(vector, self.acoustic_dimension)

    def encode_video_frame(self, content: bytes, *, timestamp_ms: int = 0) -> list[float]:
        """Decode a bounded representative frame before applying the pinned CLIP model."""

        try:
            completed = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    "pipe:0",
                    "-ss",
                    f"{max(0, timestamp_ms) / 1000.0:.3f}",
                    "-frames:v",
                    "1",
                    "-f",
                    "image2pipe",
                    "-vcodec",
                    "png",
                    "pipe:1",
                ],
                input=content,
                capture_output=True,
                check=False,
                timeout=60,
            )
            if completed.returncode != 0 or not completed.stdout:
                raise RuntimeError(f"ffmpeg exited with status {completed.returncode}")
        except Exception as exc:
            raise CapabilityUnavailableError(
                "CLIP could not decode a representative video frame",
                details={"error_type": type(exc).__name__},
            ) from exc
        return self.encode_image(completed.stdout)

    def encode_acoustic_query(self, text: str) -> list[float]:
        model, processor = self._clap()
        torch = self._torch()
        inputs = processor(text=[text], return_tensors="pt", padding=True)
        inputs = self._to_device(inputs, model)
        with torch.no_grad():
            vector = model.get_text_features(**inputs)
        return self._normalized(vector, self.acoustic_dimension)

    def health(self, *, load: bool = False) -> dict[str, object]:
        result: dict[str, object] = {
            "status": "configured",
            "clip": {
                "model_id": self.clip_model_id,
                "dimension": self.visual_dimension,
                "loaded": self._clip_model is not None,
            },
            "clap": {
                "model_id": self.clap_model_id,
                "dimension": self.acoustic_dimension,
                "loaded": self._clap_model is not None,
            },
        }
        if not load:
            return result
        failures: list[str] = []
        try:
            self._clip()
        except Exception as exc:
            failures.append(f"clip:{type(exc).__name__}")
        try:
            self._clap()
        except Exception as exc:
            failures.append(f"clap:{type(exc).__name__}")
        result["status"] = "ready" if not failures else "unavailable"
        result["failures"] = failures
        result["clip"]["loaded"] = self._clip_model is not None  # type: ignore[index]
        result["clap"]["loaded"] = self._clap_model is not None  # type: ignore[index]
        return result

    def manifest(self) -> dict[str, object]:
        return {
            "type": "local_feature_models",
            "clip": {
                "model_id": self.clip_model_id,
                "revision": self.clip_revision,
                "dimension": self.visual_dimension,
                "preprocess": "transformers-processor",
            },
            "clap": {
                "model_id": self.clap_model_id,
                "revision": self.clap_revision,
                "dimension": self.acoustic_dimension,
                "sample_rate": 48_000,
                "preprocess": "ffmpeg-mono-48khz-segment-max-30s",
            },
            "video_preprocess": "ffmpeg-representative-frame-png",
        }

    def _clip(self) -> tuple[Any, Any]:
        if self._clip_model is not None and self._clip_processor is not None:
            return self._clip_model, self._clip_processor
        with self._clip_lock:
            if self._clip_model is None or self._clip_processor is None:
                try:
                    with model_load_lock():
                        from transformers import CLIPModel, CLIPProcessor

                        self._clip_model = CLIPModel.from_pretrained(
                            self.clip_model_id, revision=self.clip_revision
                        ).eval()
                        self._clip_processor = CLIPProcessor.from_pretrained(
                            self.clip_model_id, revision=self.clip_revision
                        )
                        self._place(self._clip_model)
                except Exception as exc:
                    raise CapabilityUnavailableError(
                        "CLIP model assets are unavailable",
                        details={
                            "model_id": self.clip_model_id,
                            "error_type": type(exc).__name__,
                        },
                    ) from exc
        return self._clip_model, self._clip_processor

    def _clap(self) -> tuple[Any, Any]:
        if self._clap_model is not None and self._clap_processor is not None:
            return self._clap_model, self._clap_processor
        with self._clap_lock:
            if self._clap_model is None or self._clap_processor is None:
                try:
                    with model_load_lock():
                        from transformers import ClapModel, ClapProcessor

                        self._clap_model = ClapModel.from_pretrained(
                            self.clap_model_id, revision=self.clap_revision
                        ).eval()
                        self._clap_processor = ClapProcessor.from_pretrained(
                            self.clap_model_id, revision=self.clap_revision
                        )
                        self._place(self._clap_model)
                except Exception as exc:
                    raise CapabilityUnavailableError(
                        "CLAP model assets are unavailable",
                        details={
                            "model_id": self.clap_model_id,
                            "error_type": type(exc).__name__,
                        },
                    ) from exc
        return self._clap_model, self._clap_processor

    @staticmethod
    def _torch() -> Any:
        try:
            import torch

            return torch
        except ImportError as exc:
            raise CapabilityUnavailableError(
                "Feature model dependencies are not installed; install the 'models' extra"
            ) from exc

    def _place(self, model: Any) -> None:
        torch = self._torch()
        if torch.cuda.is_available():
            model.to(torch.device("cuda"))

    @staticmethod
    def _to_device(inputs: dict[str, Any], model: Any) -> dict[str, Any]:
        device = next(model.parameters()).device
        return {
            key: value.to(device) if hasattr(value, "to") else value
            for key, value in inputs.items()
        }

    @staticmethod
    def _normalized(value: Any, expected_dimension: int) -> list[float]:
        value = value / value.norm(dim=-1, keepdim=True).clamp(min=1e-12)
        vector = value.detach().cpu().float().numpy()[0].tolist()
        if len(vector) != expected_dimension:
            raise CapabilityUnavailableError(
                "Feature encoder dimension differs from its pinned Index manifest",
                details={"expected": expected_dimension, "actual": len(vector)},
            )
        return [float(item) for item in vector]
