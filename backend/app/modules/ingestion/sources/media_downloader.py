"""
多渠道媒体下载来源：从 Google Images / Pixabay / Internet Archive 等搜索并下载图片等，
产出 (bytes, suggested_filename) 供 ingestion 消费。
提取自 MultiMediaDownloader，无 PyQt 依赖；可选依赖：yt_dlp, internetarchive, google-search-results。
"""

import os
import random
from pathlib import Path
from typing import List, Optional, Callable, Any

import requests

from app.core.logger import get_logger
from .base import BaseContentSource, ContentSourceResult

logger = get_logger(__name__)

# 环境变量中的 API 密钥（可选）
ENV_SERPAPI_KEY = "SERPAPI_KEY"
ENV_PIXABAY_API_KEY = "PIXABAY_API_KEY"

# 下载限制
DOWNLOAD_TIMEOUT = 30
MAX_IMAGE_BYTES = 50 * 1024 * 1024  # 50MB per file


def _log(log_fn: Optional[Callable[[str], None]], msg: str) -> None:
    if log_fn:
        log_fn(msg)
    else:
        logger.info(msg)


def _download_url_to_bytes(
    url: str,
    timeout: int = DOWNLOAD_TIMEOUT,
    suggested_name: Optional[str] = None,
) -> ContentSourceResult:
    """从 URL 下载到内存，返回 (bytes, suggested_filename)。suggested_name 优先用于按关键词命名。"""
    resp = requests.get(url, stream=True, timeout=timeout)
    resp.raise_for_status()
    content = resp.content
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError(f"文件过大: {len(content)} bytes")
    if suggested_name:
        name = suggested_name if "." in suggested_name else f"{suggested_name}.jpg"
    else:
        name = url.rstrip("/").split("/")[-1].split("?")[0] or "download"
        if "." not in name:
            name = f"{name}.jpg"
    return ContentSourceResult(content=content, suggested_filename=name)


class MediaDownloaderSource(BaseContentSource):
    """
    多渠道媒体搜索+下载：按关键词从选定渠道获取图片（或后续扩展视频/音频），
    每次返回一批 ContentSourceResult，由调用方逐个送入 process_file_upload。
    """

    def __init__(
        self,
        serpapi_key: Optional[str] = None,
        pixabay_key: Optional[str] = None,
        log_fn: Optional[Callable[[str], None]] = None,
    ):
        self.serpapi_key = serpapi_key or os.environ.get(ENV_SERPAPI_KEY)
        self.pixabay_key = pixabay_key or os.environ.get(ENV_PIXABAY_API_KEY)
        self._log = lambda msg: _log(log_fn, msg)

    def search_google_images(
        self, query: str, num_to_fetch: int, randomize: bool = True
    ) -> List[str]:
        """SerpAPI 搜索 Google 图片，返回图片 URL 列表。randomize 为 True 时使用随机起始页以增加多样性。"""
        if not self.serpapi_key:
            self._log("SERPAPI_KEY 未配置，跳过 Google 图片搜索")
            return []
        try:
            from serpapi import GoogleSearch
        except ImportError:
            self._log("未安装 google-search-results (serpapi)，跳过 Google 图片搜索")
            return []
        urls: List[str] = []
        start_page = random.randint(0, 5) if randomize else 0
        num_pages = max(1, (num_to_fetch + 99) // 100)
        for p in range(num_pages):
            ijn = start_page + p
            params = {
                "engine": "google_images",
                "q": query,
                "api_key": self.serpapi_key,
                "ijn": ijn,
                "tbm": "isch",
            }
            try:
                results = GoogleSearch(params).get_dict()
                if "images_results" not in results:
                    break
                for item in results["images_results"]:
                    if "original" in item:
                        urls.append(item["original"])
                        if len(urls) >= num_to_fetch:
                            return urls
            except Exception as e:
                self._log(f"SerpAPI 调用失败: {e}")
                break
        return urls

    def search_pixabay(
        self,
        query: str,
        media_type: str,
        num_to_fetch: int,
        randomize: bool = True,
        **kwargs: Any,
    ) -> List[str]:
        """Pixabay 搜索图片/视频，返回 URL 列表。randomize 为 True 时使用随机页码以增加多样性。"""
        if not self.pixabay_key:
            self._log("PIXABAY_API_KEY 未配置，跳过 Pixabay 搜索")
            return []
        endpoint = "videos/" if media_type == "videos" else ""
        api_url = f"https://pixabay.com/api/{endpoint}"
        params = {"key": self.pixabay_key, "q": query, "safesearch": "true", "per_page": min(num_to_fetch, 200)}
        if randomize:
            params["page"] = random.randint(0, 10)
        params.update(kwargs)
        try:
            resp = requests.get(api_url, params=params, timeout=DOWNLOAD_TIMEOUT)
            resp.raise_for_status()
            hits = resp.json().get("hits", [])
            urls = []
            for item in hits:
                if media_type == "images" and item.get("largeImageURL"):
                    urls.append(item["largeImageURL"])
                elif media_type == "videos" and item.get("videos", {}).get("medium", {}).get("url"):
                    urls.append(item["videos"]["medium"]["url"])
                if len(urls) >= num_to_fetch:
                    break
            return urls
        except Exception as e:
            self._log(f"Pixabay API 调用失败: {e}")
            return []

    def search_archive_items(
        self,
        query: str,
        media_type: str,
        num_to_fetch: int,
        sort_by: str = "relevance",
        randomize: bool = True,
    ) -> List[str]:
        """Internet Archive 搜索，返回 identifier 列表。randomize 为 True 时打乱顺序以增加多样性。"""
        try:
            from internetarchive import search_items
        except ImportError:
            self._log("未安装 internetarchive，跳过 Internet Archive 搜索")
            return []
        sort_options = []
        if sort_by == "popular":
            sort_options.append("downloads desc")
        elif sort_by == "newest":
            sort_options.append("publicdate desc")
        search_query = f'title:("{query}") AND mediatype:{media_type}'
        fetch_count = num_to_fetch * 3 if randomize else num_to_fetch
        try:
            results = search_items(search_query, sorts=sort_options)
            identifiers = []
            for i, result in enumerate(results):
                if i >= fetch_count:
                    break
                identifiers.append(result["identifier"])
            if randomize and len(identifiers) > num_to_fetch:
                random.shuffle(identifiers)
                identifiers = identifiers[:num_to_fetch]
            else:
                identifiers = identifiers[:num_to_fetch]
            return identifiers
        except Exception as e:
            self._log(f"Internet Archive 搜索失败: {e}")
            return []

    def download_archive_image_files(
        self,
        identifiers: List[str],
        keyword: str,
        required_count: int,
        file_formats: Any = "*.jp*g",
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> List[ContentSourceResult]:
        """从 Internet Archive 的 item 中下载图片文件，返回 (bytes, filename) 列表。按关键词命名。"""
        try:
            from internetarchive import get_item
        except ImportError:
            return []
        results: List[ContentSourceResult] = []
        keyword_safe = keyword.replace(" ", "_").strip() or "query"
        for identifier in identifiers:
            if len(results) >= required_count:
                break
            try:
                item = get_item(identifier)
                files = (
                    item.get_files(formats=file_formats)
                    if isinstance(file_formats, list)
                    else item.get_files(glob_pattern=file_formats)
                )
                for f in files:
                    if len(results) >= required_count:
                        break
                    try:
                        content = requests.get(f.url, timeout=DOWNLOAD_TIMEOUT).content
                        if len(content) > MAX_IMAGE_BYTES:
                            continue
                        # 按关键词命名：{关键词}_archive_{序号}.ext
                        ext = Path(f.name).suffix.lower() or ".jpg"
                        name = f"{keyword_safe}_archive_{len(results)+1:03d}{ext}"
                        results.append(ContentSourceResult(content=content, suggested_filename=name))
                        if progress_callback:
                            progress_callback(len(results), required_count, name)
                    except Exception as e:
                        self._log(f"下载 Archive 文件失败 {f.name}: {e}")
            except Exception as e:
                self._log(f"处理 Archive 项 {identifier} 失败: {e}")
        return results

    def fetch_image_search(
        self,
        query: str,
        source: str,
        quantity: int,
        *,
        pixabay_image_type: str = "photo",
        pixabay_order: str = "popular",
        archive_sort: str = "relevance",
        randomize: bool = True,
        progress_callback: Optional[Callable[[str, int, int, str], None]] = None,
    ) -> List[ContentSourceResult]:
        """
        按关键词从指定渠道搜索并下载图片，返回 ContentSourceResult 列表。
        文件名统一为：{关键词}_{渠道}_{序号}.jpg（按关键词命名）。
        source: "google_images" | "pixabay" | "internet_archive"
        randomize: 为 True 时同关键词多次搜索会得到不同结果（随机页/打乱顺序）。
        progress_callback: (stage, current, total, message) 用于进度展示。
        """
        keyword_safe = query.replace(" ", "_").strip() or "query"
        num_to_fetch = min(quantity * 3, 50)

        def _cb(stage: str, cur: int, total: int, msg: str) -> None:
            if progress_callback:
                progress_callback(stage, cur, total, msg)

        _cb("searching", 0, 0, "搜索中…")
        results: List[ContentSourceResult] = []

        if source == "google_images":
            urls = self.search_google_images(query, num_to_fetch, randomize=randomize)
            for i, url in enumerate(urls):
                if len(results) >= quantity:
                    break
                filename = f"{keyword_safe}_google_{len(results)+1:03d}.jpg"
                _cb("downloading", len(results) + 1, quantity, filename)
                try:
                    r = _download_url_to_bytes(url, suggested_name=filename)
                    results.append(r)
                except Exception as e:
                    self._log(f"下载图片失败 {url[:50]}...: {e}")
        elif source == "pixabay":
            urls = self.search_pixabay(
                query,
                "images",
                num_to_fetch,
                randomize=randomize,
                image_type=pixabay_image_type,
                order=pixabay_order,
            )
            for i, url in enumerate(urls):
                if len(results) >= quantity:
                    break
                filename = f"{keyword_safe}_pixabay_{len(results)+1:03d}.jpg"
                _cb("downloading", len(results) + 1, quantity, filename)
                try:
                    r = _download_url_to_bytes(url, suggested_name=filename)
                    results.append(r)
                except Exception as e:
                    self._log(f"下载 Pixabay 图片失败: {e}")
        elif source == "internet_archive":
            ids = self.search_archive_items(
                query, "image", num_to_fetch, sort_by=archive_sort, randomize=randomize
            )

            def _archive_progress(cur: int, total: int, name: str) -> None:
                _cb("downloading", cur, total, name)

            results = self.download_archive_image_files(
                ids, keyword_safe, quantity, "*.jp*g", progress_callback=_archive_progress
            )[:quantity]
        else:
            raise ValueError(f"不支持的图片渠道: {source}")
        return results[:quantity]
