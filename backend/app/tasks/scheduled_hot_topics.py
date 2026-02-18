"""
定时任务：按配置周期（如每日 08:00）将 Tavily 热点/新闻导入指定知识库。
需配置 TAVILY_API_KEY 与 TAVILY_HOT_TOPICS_KB_ID（可选，不配置则仅能通过 API 手动触发）。
"""

import asyncio
from typing import Any, Optional

from app.core.config import settings
from app.core.logger import get_logger
from app.modules.ingestion.hot_topics_ingest import run_hot_topics_ingest

# 使用项目根目录的 celery_app，在 worker 中通过 include 加载
from celery_app import celery_app

logger = get_logger(__name__)


@celery_app.task(bind=True, name="app.tasks.scheduled_hot_topics.ingest_hot_topics_task")
def ingest_hot_topics_task(
    self,
    kb_id: Optional[str] = None,
    query: Optional[str] = None,
    topic: Optional[str] = None,
    time_range: Optional[str] = None,
    max_results: Optional[int] = None,
    use_llm_summary: bool = True,
) -> dict:
    """
    Celery 任务：执行热点导入（Tavily → 可选 LLM 整理 → 入库）。
    可由 Beat 每日触发，或手动 delay() 调用。

    Args:
        kb_id: 目标知识库 ID；若为 None 则使用配置 TAVILY_HOT_TOPICS_KB_ID
        query, topic, time_range, max_results: 透传至 run_hot_topics_ingest
        use_llm_summary: 是否用 LLM 整理

    Returns:
        与 run_hot_topics_ingest 返回值一致（含 file_id, status, chunks_processed 等）
    """
    target_kb_id = kb_id or getattr(settings, "tavily_hot_topics_kb_id", None) or ""
    if not target_kb_id:
        logger.warning("未配置 TAVILY_HOT_TOPICS_KB_ID 且未传入 kb_id，跳过热点导入")
        return {"status": "skipped", "message": "未指定知识库 ID"}

    if not (getattr(settings, "tavily_api_key", None) or "").strip():
        logger.warning("未配置 TAVILY_API_KEY，跳过热点导入")
        return {"status": "skipped", "message": "未配置 TAVILY_API_KEY"}

    async def _run() -> dict:
        return await run_hot_topics_ingest(
            kb_id=target_kb_id,
            query=query,
            topic=topic,
            time_range=time_range,
            max_results=max_results,
            use_llm_summary=use_llm_summary,
        )

    try:
        result: dict = asyncio.run(_run())
        logger.info("定时热点导入完成: kb_id={}, file_id={}", target_kb_id, result.get("file_id"))
        return result
    except Exception as e:
        logger.exception("定时热点导入失败: %s", e)
        raise
