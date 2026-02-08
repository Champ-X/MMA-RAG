"""
知识库内容来源层
负责从不同来源获取 (bytes, suggested_filename)，供 IngestionService.process_file_upload 消费。
"""

from .base import ContentSourceResult, BaseContentSource
from .url import UrlSource
from .media_downloader import MediaDownloaderSource

__all__ = [
    "ContentSourceResult",
    "BaseContentSource",
    "UrlSource",
    "MediaDownloaderSource",
]
