"""
内容来源抽象：产出 (bytes, suggested_filename) 供 ingestion 管道消费。
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ContentSourceResult:
    """单条内容来源结果"""
    content: bytes
    suggested_filename: str
    content_type: Optional[str] = None


class BaseContentSource:
    """内容来源基类：从某处获取字节与建议文件名，不负责解析/存储。"""

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}>"
