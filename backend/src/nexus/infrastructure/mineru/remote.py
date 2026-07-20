from __future__ import annotations

import base64
import json
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError


@dataclass(frozen=True, slots=True)
class MinerUImage:
    name: str
    path: str
    data: bytes


@dataclass(frozen=True, slots=True)
class MinerUExtraction:
    task_id: str
    markdown: str
    content_list: tuple[dict[str, object], ...]
    images: tuple[MinerUImage, ...]


class _MinerUClient(Protocol):
    def extract(self, source: str, **options: object) -> object: ...

    def close(self) -> None: ...


class MinerURemoteAdapter:
    """Authenticated adapter for MinerU's official Precision API.

    The SDK performs the signed-URL upload, asynchronous polling and result ZIP
    download. This adapter keeps credentials out of manifests/errors and exposes a
    small, stable internal result contract to the parser layer.
    """

    def __init__(
        self,
        *,
        token: str | None,
        base_url: str = "https://mineru.net/api/v4",
        model: str = "vlm",
        language: str = "ch",
        timeout_seconds: int = 900,
        client_factory: Callable[..., _MinerUClient] | None = None,
    ) -> None:
        self._token = token.strip() if token else None
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.language = language
        self.timeout_seconds = timeout_seconds
        self._client_factory = client_factory

    @property
    def configured(self) -> bool:
        return bool(self._token)

    def credential_status(self) -> dict[str, object]:
        status: dict[str, object] = {"token_configured": self.configured}
        if not self._token:
            status["status"] = "not_configured"
            return status
        status["status"] = "configured"
        parts = self._token.split(".")
        if len(parts) != 3:
            return status
        try:
            payload = json.loads(
                base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
            )
            expires_epoch = int(payload["exp"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return status
        expires_at = datetime.fromtimestamp(expires_epoch, UTC)
        status["expires_at"] = expires_at.isoformat()
        status["expired"] = expires_at <= datetime.now(UTC)
        if status["expired"]:
            status["status"] = "expired"
        return status

    def extract(self, *, content: bytes, filename: str) -> MinerUExtraction:
        if not self._token:
            raise CapabilityUnavailableError(
                "MinerU Precision API is required for PDF/DOC/PPT ingestion and "
                "MINERU_TOKEN is not configured",
                details={"capability": "mineru_precision_api", "filename": filename},
            )
        credential = self.credential_status()
        if credential.get("expired") is True:
            raise CapabilityUnavailableError(
                "MINERU_TOKEN is expired",
                details={
                    "capability": "mineru_precision_api",
                    "filename": filename,
                    "credential_status": "expired",
                    "expires_at": credential.get("expires_at"),
                },
            )
        suffix = Path(filename).suffix.lower()
        try:
            with tempfile.TemporaryDirectory(prefix="nexus-mineru-") as temp_dir:
                local_path = Path(temp_dir) / f"source{suffix}"
                local_path.write_bytes(content)
                client = self._make_client()
                try:
                    result = client.extract(
                        str(local_path),
                        model=self.model,
                        formula=True,
                        table=True,
                        language=self.language,
                        timeout=self.timeout_seconds,
                    )
                finally:
                    client.close()
        except CapabilityUnavailableError:
            raise
        except Exception as exc:
            message = self._redact(str(exc))
            raise CapabilityUnavailableError(
                "MinerU Precision API parsing failed; no semantic fallback was attempted",
                details={
                    "capability": "mineru_precision_api",
                    "filename": filename,
                    "error_type": type(exc).__name__,
                    "error": message,
                },
            ) from exc

        state = str(getattr(result, "state", "unknown"))
        if state != "done":
            error = self._redact(str(getattr(result, "error", "") or ""))
            raise CapabilityUnavailableError(
                "MinerU Precision API did not complete successfully",
                details={
                    "capability": "mineru_precision_api",
                    "filename": filename,
                    "state": state,
                    "error": error,
                },
            )
        raw_content_list = getattr(result, "content_list", None) or []
        content_list = tuple(item for item in raw_content_list if isinstance(item, dict))
        markdown = str(getattr(result, "markdown", "") or "")
        if not content_list and not markdown.strip():
            raise ValidationError("MinerU produced neither content_list nor Markdown")
        images = tuple(
            MinerUImage(
                name=str(getattr(image, "name", "image")),
                path=str(getattr(image, "path", getattr(image, "name", "image"))),
                data=bytes(getattr(image, "data", b"")),
            )
            for image in (getattr(result, "images", None) or [])
            if getattr(image, "data", None)
        )
        return MinerUExtraction(
            task_id=str(getattr(result, "task_id", "")),
            markdown=markdown,
            content_list=content_list,
            images=images,
        )

    def _make_client(self) -> _MinerUClient:
        if self._client_factory is not None:
            return self._client_factory(token=self._token, base_url=self.base_url)
        try:
            from mineru import MinerU
        except ImportError as exc:
            raise CapabilityUnavailableError(
                "mineru-open-sdk is required for MinerU Precision API ingestion",
                details={"capability": "mineru_precision_api"},
            ) from exc
        return MinerU(token=self._token, base_url=self.base_url)

    def _redact(self, message: str) -> str:
        return message.replace(self._token or "\0", "[REDACTED]")
