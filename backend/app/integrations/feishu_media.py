"""
从 MinIO 读取引用图片字节（内网），供上传飞书使用。
逻辑与 app.api.chat 中引用解析保持一致。
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import unquote, urlparse

from app.core.logger import get_logger
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter

logger = get_logger(__name__)


def _normalize_media_file_path(file_path: str) -> str:
    raw = unquote((file_path or "").strip())
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        raw = unquote(parsed.path or "")
    raw = raw.split("?", 1)[0].split("#", 1)[0].strip()
    return raw.lstrip("/")


def _build_object_path_candidates(file_path: str, media_prefix: str) -> List[str]:
    raw = _normalize_media_file_path(file_path)
    if not raw:
        return []
    candidates: List[str] = []

    def _add(p: str) -> None:
        p = (p or "").strip().lstrip("/")
        if p and p not in candidates:
            candidates.append(p)

    _add(raw)
    if "/" in raw:
        _add(raw.split("/", 1)[1])
    base_name = Path(raw).name
    if base_name:
        _add(f"{media_prefix}/{base_name}")
    return candidates


def _build_bucket_candidates(minio_adapter: MinIOAdapter, kb_id: str) -> List[str]:
    candidates: List[str] = []
    for b in [minio_adapter.get_bucket_for_kb(kb_id), minio_adapter.bucket_name_for_kb(kb_id), kb_id]:
        if not b or b in candidates:
            continue
        try:
            if minio_adapter.client.bucket_exists(b):
                candidates.append(b)
        except Exception:
            continue
    if not candidates:
        candidates.append(minio_adapter.get_bucket_for_kb(kb_id))
    return candidates


_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def looks_like_image_path(file_path: Optional[str]) -> bool:
    if not file_path:
        return False
    suf = Path(_normalize_media_file_path(file_path)).suffix.lower()
    return suf in _IMAGE_EXT


async def read_image_bytes(kb_id: str, file_path: str) -> Optional[Tuple[bytes, str]]:
    """
    返回 (bytes, filename_hint)；不存在或失败返回 None。
    """
    if not kb_id or not file_path:
        return None
    adapter = MinIOAdapter()
    bucket_candidates = _build_bucket_candidates(adapter, kb_id)
    object_candidates = _build_object_path_candidates(file_path, "images")
    if not object_candidates:
        return None
    name = Path(object_candidates[0]).name or "image.bin"
    for bucket in bucket_candidates:
        for object_path in object_candidates:
            try:
                adapter.client.stat_object(bucket, object_path)
                data = await adapter.get_file_content(bucket, object_path)
                if data:
                    return data, name
            except Exception:
                continue
    logger.debug(f"飞书发图：MinIO 未找到 kb_id={kb_id} path={file_path}")
    return None
