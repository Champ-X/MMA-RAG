"""
热点/新闻导入编排：Tavily 搜索 → 可选 LLM 整理 → 生成 Markdown → process_file_upload 入库。
"""

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.llm.manager import llm_manager
from app.core.logger import get_logger

from .sources.tavily_hot_topics import fetch_hot_topics
from .service import get_ingestion_service

logger = get_logger(__name__)

# LLM 整理热点用的系统提示（产出 Markdown，摘要需丰富、可读、便于检索）
HOT_TOPICS_SUMMARY_SYSTEM = """你是一个专业的信息整理助手。根据提供的「热点/新闻搜索结果」列表，整理成一篇结构清晰、内容丰富的 Markdown 文档。

要求：
1. 标题：使用「# 每日热点摘要 YYYY-MM-DD」（日期由用户提供）。
2. 每条热点一个二级标题 ##，按重要性/相关性排序。
3. 每条条目的内容要丰富、可读，不要只写一句话。应尽量保留并组织以下信息：
   - 核心事实与结论（谁、何时、做了什么、结果或趋势）；
   - 具体名称：公司/产品/模型/人物等（如智谱 GLM-5、MiniMax M2.5、字节 Seedance 2.0、科大讯飞等）；
   - 应用场景或行业（如智能体、影视广告、商业化等）；
   - 时间节点或趋势判断（如「2026 年将成为商业化关键年」「从技术竞速转向价值竞速」）；
   - 来源：在段末用 Markdown 链接标出，格式为「来源：[媒体名称](url)」。
4. 每条约 2–4 段，信息密度高但条理清楚；若原文过长可提炼要点，不要大段照抄。
5. 只输出 Markdown，不要输出多余解释或代码块包裹。
6. 全文使用中文撰写。"""


def _build_simple_markdown(items: List[Dict[str, Any]], date_str: str) -> str:
    """将 Tavily 结果用简单模板拼成 Markdown（不调用 LLM）。"""
    lines = [f"# 每日热点摘要 {date_str}", ""]
    for i, item in enumerate(items, 1):
        title = (item.get("title") or "无标题").strip()
        url = (item.get("url") or "").strip()
        content = (item.get("content") or "").strip()
        block = f"## {i}. {title}"
        if url:
            block += f"\n\n来源：[{title}]({url})"
        if content:
            block += f"\n\n{content[:2000]}" + ("..." if len(content) > 2000 else "")
        lines.append(block)
        lines.append("")
    return "\n".join(lines)


def _slug_for_filename(text: str, max_len: int = 40) -> str:
    """将搜索关键词转为文件名安全片段：去首尾空白、替换非法字符、截断长度。"""
    if not (text or isinstance(text, str)):
        return "热点"
    s = text.strip()
    s = re.sub(r'[\s\\/:*?"<>|]+', "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:max_len] if s else "热点"


def _extract_llm_content(result: Any) -> str:
    """从 LLMCallResult 中取出回复文本。"""
    if result is None or not getattr(result, "success", False):
        return ""
    data = getattr(result, "data", None)
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        choices = data.get("choices", [])
        if choices and len(choices) > 0:
            msg = choices[0].get("message", {})
            return (msg.get("content") or "").strip()
    return ""


async def run_hot_topics_ingest(
    kb_id: str,
    *,
    query: Optional[str] = None,
    topic: Optional[str] = None,
    time_range: Optional[str] = None,
    max_results: Optional[int] = None,
    use_extract: Optional[bool] = None,
    extract_max_urls: Optional[int] = None,
    use_llm_summary: bool = True,
    user_id: Optional[str] = None,
    processing_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    执行热点导入：Tavily 拉取 → 可选 LLM 整理 → 生成「关键词_YYYY-MM-DD.md」→ 入库。

    Args:
        kb_id: 目标知识库 ID（必填）
        query, topic, time_range, max_results, use_extract, extract_max_urls: 透传至 fetch_hot_topics
        use_llm_summary: 是否用 LLM 整理成摘要文档；否则用简单模板
        user_id: 可选用户 ID
        processing_id: 可选，供进度轮询

    Returns:
        与 process_file_upload 一致的字典：file_id, status, processing_id, chunks_processed 等
    """
    if not (getattr(settings, "tavily_api_key", None) or "").strip():
        raise ValueError("TAVILY_API_KEY 未配置，无法执行热点导入")

    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    # 用于文件名的关键词：请求未传则用配置默认（与 fetch_hot_topics 内部一致）
    query_for_name = (query or "").strip() or getattr(
        settings, "tavily_hot_topics_default_query", "科技热点 互联网新闻 AI动态"
    )
    slug = _slug_for_filename(query_for_name)
    loop = asyncio.get_event_loop()
    ingestion = get_ingestion_service()
    if processing_id:
        ingestion.update_processing_status(
            processing_id, stage="fetching", message="正在拉取热点…", progress=0
        )

    # 1. Tavily 搜索（同步，放线程池）
    items = await loop.run_in_executor(
        None,
        lambda: fetch_hot_topics(
            query=query,
            topic=topic,
            time_range=time_range,
            max_results=max_results,
            use_extract=use_extract,
            extract_max_urls=extract_max_urls,
        ),
    )

    if not items:
        if processing_id:
            ingestion.update_processing_status(
                processing_id, status="completed", message="Tavily 未返回任何热点结果"
            )
        return {
            "file_id": None,
            "status": "completed",
            "processing_id": processing_id,
            "chunks_processed": 0,
            "message": "Tavily 未返回任何热点结果，未生成文档",
        }
    logger.info("Tavily 热点拉取到 {} 条，开始整理并入库", len(items))
    if processing_id:
        ingestion.update_processing_status(
            processing_id, stage="summarizing", message="正在整理摘要…", progress=20
        )

    # 2. 整理成 Markdown
    if use_llm_summary:
        # 优化：减少每条内容长度，避免 prompt 过长导致超时
        # 根据条数动态调整每条的字符上限：条数多时每条更短，条数少时每条可稍长
        # 目标：总 prompt 控制在约 15,000-20,000 字符（约 20,000-30,000 tokens），避免超时
        max_items = len(items)
        if max_items <= 5:
            chars_per_item = 2000  # 条数少时每条可较长
        elif max_items <= 8:
            chars_per_item = 1500  # 中等条数
        else:
            chars_per_item = 1000  # 条数多时每条较短，避免总 prompt 过长
        
        context_parts = []
        for i, item in enumerate(items, 1):
            content_preview = (item.get('content', '') or '').strip()
            if len(content_preview) > chars_per_item:
                content_preview = content_preview[:chars_per_item] + "..."
            context_parts.append(
                f"[{i}] 标题: {item.get('title', '')}\nURL: {item.get('url', '')}\n内容摘要:\n{content_preview}"
            )
        context = "\n\n---\n\n".join(context_parts)
        user_content = f"今日日期：{date_str}\n\n请根据以下热点搜索结果整理成一篇「每日热点摘要」Markdown（共 {max_items} 条）：\n\n{context}"
        messages = [
            {"role": "system", "content": HOT_TOPICS_SUMMARY_SYSTEM},
            {"role": "user", "content": user_content},
        ]
        try:
            # 热点整理需要处理长 prompt，显式设置 max_tokens 避免输出被截断
            # 同时传递超时提示，让 LLM provider 使用更长的超时时间
            llm_result = await llm_manager.chat(
                messages=messages,
                task_type="final_generation",
                temperature=0.3,
                max_tokens=4000,  # 10 条 × 每条约 300-400 tokens = 3000-4000 tokens
            )
            content_md = _extract_llm_content(llm_result)
            if not content_md:
                logger.warning("LLM 热点整理返回为空，回退到简单模板")
                content_md = _build_simple_markdown(items, date_str)
        except Exception as e:
            logger.warning("LLM 热点整理失败，回退到简单模板: {}", e)
            content_md = _build_simple_markdown(items, date_str)
    else:
        content_md = _build_simple_markdown(items, date_str)

    # 3. 生成文件并入库（按搜索关键词与日期命名，无「热点_」前缀）
    file_path = f"{slug}_{date_str}.md"
    content_bytes = content_md.encode("utf-8")
    ingest_result = await ingestion.process_file_upload(
        file_content=content_bytes,
        file_path=file_path,
        kb_id=kb_id,
        user_id=user_id,
        processing_id=processing_id,
    )
    return ingest_result
