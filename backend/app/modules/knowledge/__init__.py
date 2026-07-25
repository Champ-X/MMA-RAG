"""
知识库管理模块
负责知识库的CRUD操作和画像系统
"""

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .portraits import PortraitGenerator
    from .router import KnowledgeRouter
    from .service import KnowledgeBaseService

__all__ = [
    "KnowledgeBaseService",
    "PortraitGenerator", 
    "KnowledgeRouter"
]

_EXPORTS = {
    "KnowledgeBaseService": (".service", "KnowledgeBaseService"),
    "PortraitGenerator": (".portraits", "PortraitGenerator"),
    "KnowledgeRouter": (".router", "KnowledgeRouter"),
}


def __getattr__(name: str) -> Any:
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(target[0], __name__)
    value = getattr(module, target[1])
    globals()[name] = value
    return value
