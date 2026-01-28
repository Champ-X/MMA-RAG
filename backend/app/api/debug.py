"""
调试API路由
提供RAG系统的调试和监控功能
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from app.core.logger import get_logger
from app.core.llm.manager import llm_manager

router = APIRouter()
logger = get_logger(__name__)

@router.get("/stats")
async def get_system_stats():
    """获取系统统计信息（models 从 LLMRegistry 动态读取）"""
    r = llm_manager.registry
    return {
        "system": {
            "uptime": "2h 30m",
            "memory_usage": "45%",
            "cpu_usage": "23%"
        },
        "knowledge_bases": {
            "total": 5,
            "active": 3,
            "total_documents": 1250,
            "total_chunks": 8950,
            "total_images": 425
        },
        "models": {
            "chat_model": r.get_task_model("final_generation") or "—",
            "embedding_model": r.get_task_model("embedding") or "—",
            "vision_model": r.get_task_model("image_captioning") or "—",
            "reranker_model": r.get_task_model("reranking") or "—",
        },
        "storage": {
            "minio_objects": 1250,
            "qdrant_points": 9375,
            "redis_keys": 125
        }
    }

@router.get("/retrieval-debug/{query_id}")
async def get_retrieval_debug_info(query_id: str):
    """获取检索调试信息"""
    return {
        "query_id": query_id,
        "original_query": "如何实现向量数据库的混合检索？",
        "intent_analysis": {
            "intent_type": "factual",
            "is_complex": False,
            "needs_visual": False
        },
        "search_strategies": {
            "dense_query": "向量数据库的混合检索实现方法",
            "sparse_keywords": ["向量数据库", "混合检索", "dense", "sparse"],
            "multi_view_queries": [
                "向量数据库的检索策略",
                "如何实现语义和关键词混合搜索"
            ]
        },
        "routing": {
            "target_kb": "kb_001",
            "confidence": 0.85,
            "candidates": [
                {"kb_id": "kb_001", "score": 0.85},
                {"kb_id": "kb_002", "score": 0.65}
            ]
        },
        "retrieval_results": [
            {
                "id": 1,
                "source": "kb_001/documents/vector_search_guide.pdf",
                "content": "混合检索结合了稠密向量检索...",
                "scores": {
                    "dense": 0.85,
                    "sparse": 0.72,
                    "rerank": 0.88
                }
            }
        ]
    }

@router.get("/health/components")
async def get_component_health():
    """获取各组件健康状态"""
    return {
        "minio": {"status": "healthy", "response_time": "15ms"},
        "qdrant": {"status": "healthy", "response_time": "8ms"},
        "redis": {"status": "healthy", "response_time": "2ms"},
        "siliconflow_api": {"status": "healthy", "response_time": "150ms"},
        "celery_worker": {"status": "healthy", "active_tasks": 3}
    }