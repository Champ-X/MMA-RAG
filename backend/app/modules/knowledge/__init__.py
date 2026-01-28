"""
知识库管理模块
负责知识库的CRUD操作和画像系统
"""

from .service import KnowledgeBaseService
from .portraits import PortraitGenerator
from .router import KnowledgeRouter

__all__ = [
    "KnowledgeBaseService",
    "PortraitGenerator", 
    "KnowledgeRouter"
]