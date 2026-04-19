"""
内容来源抽象：产出 (bytes, suggested_filename) 供 ingestion 管道消费。
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class ContentSourceResult:
    """单条内容来源结果"""
    content: bytes
    suggested_filename: str
    content_type: Optional[str] = None
    # 可选元数据，例如网页抽取时的 extractor / title / source_url 等，供上层 API 透出
    meta: Dict[str, Any] = field(default_factory=dict)


class BaseContentSource:
    """内容来源基类：从某处获取字节与建议文件名，不负责解析/存储。"""

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}>"
