"""
从单个 URL 拉取内容，产出 (bytes, suggested_filename)。
"""

import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, unquote

import httpx

from app.core.logger import get_logger
from .base import BaseContentSource, ContentSourceResult

logger = get_logger(__name__)

# 安全限制
DEFAULT_TIMEOUT = 30.0
MAX_BODY_BYTES = 100 * 1024 * 1024  # 100MB
ALLOWED_SCHEMES = ("http", "https")


def _filename_from_url(url: str) -> str:
    path = urlparse(url).path
    name = unquote(Path(path).name.strip()) or "download"
    if not Path(name).suffix:
        name = f"{name}.bin"
    return name


def _filename_from_headers(headers: httpx.Headers) -> Optional[str]:
    cd = headers.get("content-disposition")
    if not cd:
        return None
    m = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\';]+)', cd, re.I)
    if m:
        return m.group(1).strip().strip('"\'')
    m = re.search(r'filename=([^;\s]+)', cd, re.I)
    if m:
        return m.group(1).strip().strip('"\'')
    return None


class UrlSource(BaseContentSource):
    """从给定 URL 下载内容，返回 ContentSourceResult。"""

    def __init__(
        self,
        timeout: float = DEFAULT_TIMEOUT,
        max_bytes: int = MAX_BODY_BYTES,
        allowed_schemes: tuple[str, ...] = ALLOWED_SCHEMES,
    ):
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.allowed_schemes = allowed_schemes

    def fetch(self, url: str) -> ContentSourceResult:
        """同步拉取 URL，返回 (content, suggested_filename)。"""
        parsed = urlparse(url)
        if parsed.scheme not in self.allowed_schemes:
            raise ValueError(f"不允许的 URL 协议: {parsed.scheme}")

        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()
            content = response.content
            if len(content) > self.max_bytes:
                raise ValueError(f"内容过大: {len(content)} > {self.max_bytes} bytes")

        filename = _filename_from_headers(response.headers) or _filename_from_url(url)
        return ContentSourceResult(content=content, suggested_filename=filename)

    async def fetch_async(self, url: str) -> ContentSourceResult:
        """异步拉取 URL。"""
        parsed = urlparse(url)
        if parsed.scheme not in self.allowed_schemes:
            raise ValueError(f"不允许的 URL 协议: {parsed.scheme}")

        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            content = response.content
            filename = _filename_from_headers(response.headers) or _filename_from_url(url)
        if len(content) > self.max_bytes:
            raise ValueError(f"内容过大: {len(content)} > {self.max_bytes} bytes")
        return ContentSourceResult(content=content, suggested_filename=filename)
