"""LLM planner for iterative knowledge retrieval.

The planner uses a tiny, provider-neutral JSON contract instead of relying on
native function calling.  Every configured chat provider in this project can
therefore participate in Agent mode.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional

from app.core.logger import get_logger
from app.modules.agent.models import AgentDecision

logger = get_logger(__name__)

_FENCED_JSON_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)

PLANNER_SYSTEM_PROMPT = """你是 Tessmora Omni-Modal Agentic Retrieval Platform 的检索规划器。
你的职责不是回答用户，而是判断当前证据是否足够，并决定下一步是否继续检索。

可用工具只有 read-only 的 multimodal_knowledge_search。它会完整复用系统现有能力：
Dense + Sparse + Visual + Audio + Video、多知识库画像路由、RRF 与 Cross-Encoder 重排。

规则：
1. 证据为空时必须 search；若已有“原问题直接检索锚点”证据，先判断其是否已覆盖主问题，不得把它当作空证据。
2. 将复杂问题拆为互补、短而明确的检索问题；一次最多 3 条。
3. 若“原问题多模态要求”中图片、音频或视频不是 unnecessary，至少安排一条检索问题明确表达对应模态需求；不要把原问题已有的模态要求丢失在子查询改写中。
4. 不重复已经执行过的查询；根据证据缺口提出后续查询。
5. 原问题直接检索已解析出主题或知识库时，子查询必须沿用该已解析语义。不得仅因词面多义就擅自扩展到另一个领域；只有现有证据或用户问题明确要求时才能跨领域补查。
6. 参考知识库探索记录：若仍有证据缺口，优先用新的主题/模态表述触发尚未探索的相关知识库；不要为了“新”而牺牲相关性。
7. 已有证据能覆盖用户问题的主要方面时返回 final。
8. 只输出一个 JSON 对象，不要 Markdown，不要解释。

JSON 格式：
{"action":"search","reason":"为什么需要这些证据","queries":["问题1","问题2"]}
或
{"action":"final","reason":"证据为什么已经足够","queries":[]}
"""


def _normalize_queries(values: Iterable[Any], *, max_queries: int) -> List[str]:
    queries: List[str] = []
    seen = set()
    for value in values:
        query = re.sub(r"\s+", " ", str(value or "")).strip()
        if not query:
            continue
        query = query[:500]
        key = query.casefold()
        if key in seen:
            continue
        seen.add(key)
        queries.append(query)
        if len(queries) >= max_queries:
            break
    return queries


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    raw = (text or "").strip()
    fenced = _FENCED_JSON_RE.search(raw)
    if fenced:
        raw = fenced.group(1).strip()

    candidates = [raw]
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidates.append(raw[start : end + 1])

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            return value
    return None


def parse_planner_decision(text: str, *, max_queries: int = 3) -> Optional[AgentDecision]:
    payload = _extract_json_object(text)
    if not payload:
        return None
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"search", "final"}:
        return None
    reason = re.sub(r"\s+", " ", str(payload.get("reason") or "")).strip()[:800]
    raw_queries = payload.get("queries")
    queries = _normalize_queries(
        raw_queries if isinstance(raw_queries, list) else [],
        max_queries=max_queries,
    )
    if action == "search" and not queries:
        return None
    return AgentDecision(action=action, reason=reason, queries=queries)


class AgentPlanner:
    def __init__(self, llm_manager: Any):
        self.llm_manager = llm_manager

    async def decide(
        self,
        *,
        query: str,
        evidence_digest: str,
        executed_queries: List[str],
        round_number: int,
        max_rounds: int,
        max_queries: int,
        explored_knowledge_bases: Optional[List[Dict[str, Any]]] = None,
        modality_requirements: Optional[Dict[str, str]] = None,
        anchor_knowledge_bases: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
    ) -> Optional[AgentDecision]:
        user_prompt = f"""<task>
用户问题：{query}
当前轮次：{round_number}/{max_rounds}
已经执行的查询：{json.dumps(executed_queries, ensure_ascii=False)}
知识库探索记录：{json.dumps(explored_knowledge_bases or [], ensure_ascii=False)}
原问题多模态要求：{json.dumps(modality_requirements or {}, ensure_ascii=False)}
原问题直接检索锚点知识库：{json.dumps(anchor_knowledge_bases or [], ensure_ascii=False)}
</task>

<evidence>
{evidence_digest or "尚无证据。"}
</evidence>

请输出下一步 JSON。"""
        result = await self.llm_manager.chat(
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            task_type="final_generation",
            model=model,
            temperature=0.1,
            max_tokens=900,
        )
        if not result.success:
            logger.warning("Agent planner 调用失败: %s", result.error)
            return None
        content = (
            (result.data or {})
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        decision = parse_planner_decision(content, max_queries=max_queries)
        if decision is None:
            logger.warning("Agent planner 输出无法解析，启用安全降级: %s", str(content)[:300])
        return decision
