"""Durable, file-scoped ingestion checkpoints; never included in the asset list."""
import asyncio
import base64
import gzip
import io
import json
import re
from typing import Any

from minio.error import S3Error
from .storage.async_io import settled_write

DOCUMENT_TYPES = frozenset({"pdf", "docx", "pptx", "txt", "md", "excel"})


class DocumentProcessingError(RuntimeError):
    """Keep provider failure metadata when a document's image caption fails."""
    def __init__(self, message: str, result=None):
        super().__init__(message)
        self.result = result

    def status_fields(self):
        result = self.result
        policy = getattr(result, "error_category", None) == "content_policy"
        return {
            "failed_stage": "image_captioning",
            "error_code": "content_policy" if policy else "document_image_caption_failed",
            "retryable": False if policy else getattr(result, "retryable", None) is not False,
            "provider_code": getattr(result, "provider_code", None),
            "provider_request_id": getattr(result, "request_id", None),
            "model_used": getattr(result, "model_used", None),
        }


def usable_image_caption(caption):
    return isinstance(caption, str) and bool(caption.strip()) and not caption.startswith(
        ("无法生成", "VLM API返回空响应", "图片描述生成失败", "解析失败")
    )


def retry_capabilities(status: dict) -> dict:
    """Also enrich older persisted failures without rewriting their history."""
    result = dict(status)
    supported = (
        status.get("file_type") in DOCUMENT_TYPES | {"video"}
        and all(status.get(k) for k in ("file_id", "bucket", "object_path"))
        and status.get("storage_persisted") is not False
        and status.get("status") != "deleted"
    )
    result["retry_supported"] = bool(supported)
    if supported:
        result["storage_persisted"] = True
    if supported and status.get("status") == "failed" and status.get("retryable") is None:
        result["retryable"] = status.get("error_code") != "content_policy"
    if status.get("status") == "failed" and "ReadTimeout" in str(status.get("error") or "") and "密集向量化" in str(status.get("error") or ""):
        result.setdefault("failed_stage", "dense_embedding")
        result.setdefault("error_code", "dense_embedding_timeout")
    return result


def _encode(value):
    if isinstance(value, bytes):
        return {"__ingestion_bytes__": base64.b64encode(value).decode("ascii")}
    raise TypeError(f"Unsupported checkpoint value: {type(value).__name__}")


def _decode(value):
    if set(value) == {"__ingestion_bytes__"}:
        return base64.b64decode(value["__ingestion_bytes__"], validate=True)
    return value


class DocumentCheckpoints:
    def __init__(self, client, *, bucket: str, file_id: str, object_path: str):
        if not bucket or not re.fullmatch(r"[A-Za-z0-9_-]+", file_id) or not object_path:
            raise ValueError("Incomplete document checkpoint identity")
        self.client, self.bucket = client, bucket
        self.file_id, self.object_path = file_id, object_path
        self.prefix = f".ingestion/{file_id}/"

    def _path(self, key):
        if not re.fullmatch(r"[A-Za-z0-9_/-]+", key) or ".." in key:
            raise ValueError("Invalid checkpoint key")
        return f"{self.prefix}{key}.json.gz"

    async def load(self, key: str) -> Any:
        def read():
            try:
                response = self.client.get_object(self.bucket, self._path(key))
            except S3Error as exc:
                if exc.code in {"NoSuchKey", "NoSuchObject"}:
                    return None
                raise
            try:
                envelope = json.loads(gzip.decompress(response.read()), object_hook=_decode)
            finally:
                response.close()
                response.release_conn()
            if envelope.get("schema") != 1 or envelope.get("file_id") != self.file_id or envelope.get("object_path") != self.object_path:
                raise ValueError("Document checkpoint identity/schema mismatch")
            return envelope["data"]
        return await asyncio.to_thread(read)

    async def save(self, key: str, data: Any) -> None:
        def write():
            envelope = {"schema": 1, "file_id": self.file_id, "object_path": self.object_path, "data": data}
            body = gzip.compress(json.dumps(envelope, ensure_ascii=False, allow_nan=False, default=_encode).encode(), compresslevel=3)
            self.client.put_object(self.bucket, self._path(key), io.BytesIO(body), len(body), content_type="application/gzip")
        await settled_write(write)
