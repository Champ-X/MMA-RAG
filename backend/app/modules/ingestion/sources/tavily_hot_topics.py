"""
Tavily 热点/新闻来源：仅负责联网（Search + 可选 Extract），产出结构化结果供导入编排使用。
不继承 BaseContentSource，不直接产出 bytes/filename。
"""

from typing import Any, Dict, List, Literal, Optional

from app.core.config import settings

# Tavily API 合法值，与 SDK 类型一致
SearchDepth = Literal["basic", "advanced", "fast", "ultra-fast"]
Topic = Literal["general", "news", "finance"]
TimeRange = Literal["day", "week", "month", "year"]
VALID_SEARCH_DEPTHS: tuple[SearchDepth, ...] = ("basic", "advanced", "fast", "ultra-fast")
VALID_TOPICS: tuple[Topic, ...] = ("general", "news", "finance")
VALID_TIME_RANGES: tuple[TimeRange, ...] = ("day", "week", "month", "year")
from app.core.logger import get_logger

logger = get_logger(__name__)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """从 dict 或对象属性取值，兼容 Tavily SDK 返回格式。"""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _get_tavily_client():
    """延迟导入并创建同步 Tavily 客户端（在 run_in_executor 中调用）。"""
    from tavily import TavilyClient  # type: ignore[import-untyped]

    api_key = getattr(settings, "tavily_api_key", None) or ""
    if not api_key:
        raise ValueError("TAVILY_API_KEY 未配置，无法使用热点导入")
    return TavilyClient(api_key=api_key)


def fetch_hot_topics(
    query: Optional[str] = None,
    topic: Optional[str] = None,
    time_range: Optional[str] = None,
    max_results: Optional[int] = None,
    search_depth: Optional[str] = None,
    use_extract: Optional[bool] = None,
    extract_max_urls: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    调用 Tavily Search（+ 可选 Extract），返回结构化热点列表。

    Args:
        query: 搜索关键词，默认使用配置的 tavily_hot_topics_default_query
        topic: general | news | finance，默认 news
        time_range: day | week | month | year，默认 day
        max_results: 1–20，默认配置值
        search_depth: basic | advanced，默认配置
        use_extract: 是否对 Search 结果中的前 N 条 URL 再调 Extract
        extract_max_urls: Extract 的 URL 数量上限

    Returns:
        List[Dict]，每项含 title, url, content（snippet 或 snippet+Extract 摘要）, score 等
    """
    api_key = getattr(settings, "tavily_api_key", None) or ""
    if not api_key:
        raise ValueError("TAVILY_API_KEY 未配置")

    q = query or getattr(settings, "tavily_hot_topics_default_query", "科技热点 互联网新闻 AI动态")
    t_raw = topic or getattr(settings, "tavily_hot_topics_topic", "news")
    t: Topic = t_raw if t_raw in VALID_TOPICS else "news"
    tr_raw = time_range or getattr(settings, "tavily_hot_topics_time_range", "day")
    tr: TimeRange = tr_raw if tr_raw in VALID_TIME_RANGES else "day"
    mr = max_results if max_results is not None else getattr(settings, "tavily_max_results", 10)
    sd_raw = search_depth or getattr(settings, "tavily_search_depth", "basic")
    sd: SearchDepth = sd_raw if sd_raw in VALID_SEARCH_DEPTHS else "basic"
    ue = use_extract if use_extract is not None else getattr(settings, "tavily_use_extract", False)
    emu = extract_max_urls if extract_max_urls is not None else getattr(settings, "tavily_extract_max_urls", 5)

    client = _get_tavily_client()
    # Search API
    response = client.search(
        query=q,
        search_depth=sd,
        topic=t,
        time_range=tr,
        max_results=mr,
    )
    results = getattr(response, "results", None) or (response.get("results", []) if isinstance(response, dict) else [])
    out: List[Dict[str, Any]] = []
    for r in results:
        item = {
            "title": _get(r, "title") or "",
            "url": _get(r, "url") or "",
            "content": _get(r, "content") or "",
            "score": _get(r, "score"),
        }
        out.append(item)

    if not out:
        return out

    if ue and emu > 0:
        urls = [x["url"] for x in out[:emu] if x.get("url")]
        if urls:
            try:
                extract_resp = client.extract(urls=urls)
                extracted = getattr(extract_resp, "results", None) or (
                    extract_resp.get("results", []) if isinstance(extract_resp, dict) else []
                )
                url_to_raw: Dict[str, str] = {_get(e, "url", ""): (_get(e, "raw_content") or "") for e in extracted}
                for i, item in enumerate(out[:emu]):
                    raw = url_to_raw.get(item["url"], "")
                    if raw:
                        item["content"] = (item["content"] or "").strip()
                        if item["content"]:
                            item["content"] += "\n\n---\n\n" + (raw[:8000] if len(raw) > 8000 else raw)
                        else:
                            item["content"] = raw[:8000] if len(raw) > 8000 else raw
            except Exception as e:
                logger.warning("Tavily Extract 失败，仅使用 Search 摘要: {}", e)

    return out
