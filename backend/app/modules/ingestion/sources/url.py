"""
从单个 URL 拉取内容，产出 ContentSourceResult。

支持两种模式：
- 文件下载：原样保存字节，由 ingestion 按扩展名解析（PDF/DOCX/图片/音视频…）。
- 网页解析：识别为 HTML 时调用 webpage_extractor 抽取正文为 Markdown 入库。

mode = auto / webpage / file 由调用方指定，auto 时按 Content-Type 自动判定。
"""

import re
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import unquote, urlparse

import httpx

from app.core.logger import get_logger
from .base import BaseContentSource, ContentSourceResult
from .webpage_extractor import (
    DEFAULT_IMAGE_MAX_BYTES,
    DEFAULT_IMAGE_MAX_COUNT,
    DEFAULT_USER_AGENT,
    WebpageExtractionResult,
    extract_from_github_blob_url,
    extract_webpage,
    filename_from_title,
)

logger = get_logger(__name__)

# 安全限制
DEFAULT_TIMEOUT = 30.0
MAX_BODY_BYTES = 100 * 1024 * 1024  # 100MB
ALLOWED_SCHEMES = ("http", "https")
HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")

UrlMode = Literal["auto", "webpage", "file"]


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


def _is_html_response(content_type: str, body: bytes) -> bool:
    """根据 Content-Type 主类型 + magic bytes 兜底判定是否 HTML。"""
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if any(ct.startswith(t) for t in HTML_CONTENT_TYPES):
        return True
    if ct:
        # 显式声明了非 HTML 的类型（image/*、application/pdf 等），不再走 magic bytes
        return False
    head = body[:512].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<head" in head[:200]


def _build_webpage_result(
    url: str,
    extraction: WebpageExtractionResult,
) -> ContentSourceResult:
    filename = filename_from_title(extraction.title, url)
    meta: dict[str, object] = {
        "extractor": extraction.extractor,
        "title": extraction.title,
        "site": extraction.site,
        "author": extraction.author,
        "published": extraction.published,
        "source_url": extraction.source_url or url,
        "kind": "webpage",
        "image_count": extraction.image_count,
    }
    cleaned = {k: v for k, v in meta.items() if v not in (None, "")}
    ext = extraction.extras or {}
    if ext.get("github_blob_url"):
        cleaned["github_blob_url"] = ext["github_blob_url"]
    # asset_map 可能为空 dict，仍允许放入（区别于 None）；调用方据此决定是否传给 process_file_upload
    if extraction.asset_map:
        cleaned["asset_map"] = extraction.asset_map
    return ContentSourceResult(
        content=extraction.markdown.encode("utf-8"),
        suggested_filename=filename,
        content_type="text/markdown",
        meta=cleaned,
    )


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

    def _validate_scheme(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in self.allowed_schemes:
            raise ValueError(f"不允许的 URL 协议: {parsed.scheme}")

    def _check_size(self, content: bytes) -> None:
        if len(content) > self.max_bytes:
            raise ValueError(f"内容过大: {len(content)} > {self.max_bytes} bytes")

    def fetch(
        self,
        url: str,
        *,
        mode: UrlMode = "auto",
        include_links: bool = True,
        include_images: bool = True,
        download_images: bool = True,
        image_max_count: int = DEFAULT_IMAGE_MAX_COUNT,
        image_max_bytes: int = DEFAULT_IMAGE_MAX_BYTES,
    ) -> ContentSourceResult:
        """同步拉取 URL（仅文件模式同步可用；网页解析请使用 fetch_async）。"""
        self._validate_scheme(url)

        with httpx.Client(
            timeout=self.timeout,
            follow_redirects=True,
            headers={"User-Agent": DEFAULT_USER_AGENT},
        ) as client:
            response = client.get(url)
            response.raise_for_status()
            content = response.content
            self._check_size(content)

        if mode == "webpage" or (mode == "auto" and _is_html_response(response.headers.get("content-type", ""), content)):
            raise RuntimeError("网页正文抽取需要异步上下文，请改调用 fetch_async()")

        filename = _filename_from_headers(response.headers) or _filename_from_url(url)
        return ContentSourceResult(
            content=content,
            suggested_filename=filename,
            content_type=response.headers.get("content-type"),
        )

    async def fetch_async(
        self,
        url: str,
        *,
        mode: UrlMode = "auto",
        include_links: bool = True,
        include_images: bool = True,
        download_images: bool = True,
        image_max_count: int = DEFAULT_IMAGE_MAX_COUNT,
        image_max_bytes: int = DEFAULT_IMAGE_MAX_BYTES,
    ) -> ContentSourceResult:
        """异步拉取 URL，根据 mode 返回原始字节或抽取后的 Markdown。

        网页解析时若 ``include_images`` 与 ``download_images`` 同时为 True，会带上
        Referer/UA 并发下载页面内的图片，作为 ``asset_map`` 挂到 result.meta，
        供 ``process_file_upload`` 走 Markdown 相对路径图片的多模态管道。
        """
        self._validate_scheme(url)

        # GitHub blob 页面（如 .../blob/main/README.md）：优先 raw.githubusercontent.com，
        # 保留 README 内相对路径图片并可正确下载（HTML 渲染页抽取常丢图）。
        if mode in ("auto", "webpage"):
            gh_result = await extract_from_github_blob_url(
                url,
                include_links=include_links,
                include_images=include_images,
                download_images=download_images and include_images,
                image_max_count=image_max_count,
                image_max_bytes=image_max_bytes,
                http_timeout=self.timeout,
                max_raw_bytes=self.max_bytes,
            )
            if gh_result is not None:
                logger.info(
                    "GitHub blob raw 快路径完成: images={}, title={}",
                    gh_result.image_count,
                    (gh_result.title or "")[:40],
                )
                return _build_webpage_result(url, gh_result)

        async with httpx.AsyncClient(
            timeout=self.timeout,
            follow_redirects=True,
            headers={"User-Agent": DEFAULT_USER_AGENT},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            content = response.content
        self._check_size(content)

        content_type_header = response.headers.get("content-type", "")
        is_html = _is_html_response(content_type_header, content)

        # 决定走哪条路
        if mode == "webpage" or (mode == "auto" and is_html):
            extraction = await extract_webpage(
                url,
                content,
                include_links=include_links,
                include_images=include_images,
                download_images=download_images and include_images,
                image_max_count=image_max_count,
                image_max_bytes=image_max_bytes,
            )
            logger.info(
                "URL 网页抽取完成: extractor={}, title={}, length={}, images={}",
                extraction.extractor,
                (extraction.title or "")[:60],
                len(extraction.markdown),
                extraction.image_count,
            )
            return _build_webpage_result(url, extraction)

        filename = _filename_from_headers(response.headers) or _filename_from_url(url)
        return ContentSourceResult(
            content=content,
            suggested_filename=filename,
            content_type=content_type_header or None,
        )
