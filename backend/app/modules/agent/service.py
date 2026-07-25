"""Bounded Observe → Decide → Act loop for multimodal knowledge retrieval."""

from __future__ import annotations

import asyncio
import copy
import time
from collections import defaultdict
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple

from app.core.config import settings
from app.core.llm.manager import llm_manager
from app.core.logger import get_logger
from app.modules.agent.models import AgentDecision, AgentRunResult, AgentTraceStep
from app.modules.agent.planner import AgentPlanner
from app.modules.agent.tools import (
    AgentToolRegistry,
    MultimodalKnowledgeSearchTool,
    ToolContext,
)
from app.modules.retrieval.service import RetrievalResult

logger = get_logger(__name__)

_INTENT_PRIORITY = {
    "unnecessary": 0,
    "implicit_enrichment": 1,
    "explicit_demand": 2,
}


def _result_key(result: Dict[str, Any]) -> str:
    return f"{result.get('content_type') or ''}:{result.get('id') or ''}"


def _result_content(result: Dict[str, Any]) -> str:
    payload = result.get("payload") or {}
    content_type = result.get("content_type")
    if content_type == "image":
        return str(payload.get("caption") or result.get("content") or "")
    if content_type == "audio":
        return str(
            payload.get("transcript")
            or payload.get("description")
            or result.get("content")
            or ""
        )
    if content_type == "video":
        return " ".join(
            str(payload.get(key) or "").strip()
            for key in ("scene_summary", "caption", "asr_text", "description")
            if payload.get(key)
        )
    return str(payload.get("text_content") or result.get("content") or "")


def _evidence_digest(
    evidence: Dict[str, Dict[str, Any]],
    *,
    max_items: int = 12,
    max_chars_per_item: int = 500,
) -> str:
    if not evidence:
        return ""
    rows: List[str] = []
    ranked = sorted(
        evidence.values(),
        key=lambda item: (
            int(item.get("_agent_hit_count", 1)),
            float(item.get("_agent_score", item.get("final_score", 0.0)) or 0.0),
        ),
        reverse=True,
    )
    for index, item in enumerate(ranked[:max_items], 1):
        payload = item.get("payload") or {}
        content = " ".join(_result_content(item).split())[:max_chars_per_item]
        file_name = str(payload.get("file_path") or payload.get("file_name") or "")
        rows.append(
            f"[E{index}] type={item.get('content_type') or 'doc'} "
            f"file={file_name or '-'} hits={item.get('_agent_hit_count', 1)} "
            f"content={content or '(no textual description)'}"
        )
    return "\n".join(rows)


def _stronger_intent(current: str, candidate: str) -> str:
    return (
        candidate
        if _INTENT_PRIORITY.get(candidate, 0) > _INTENT_PRIORITY.get(current, 0)
        else current
    )


def _agent_rounds_payload(
    trace: List[AgentTraceStep],
    *,
    current_round: Optional[int] = None,
    current_reason: str = "",
    current_queries: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Serialize completed rounds and optionally append the currently running round."""
    rounds = [
        {
            **step.to_dict(),
            "status": "failed" if step.error else "completed",
        }
        for step in trace
        if step.action == "search"
    ]
    if current_round is not None:
        rounds.append(
            {
                "round": current_round,
                "action": "search",
                "reason": current_reason,
                "queries": list(current_queries or []),
                "result_count": 0,
                "new_evidence_count": 0,
                "total_evidence_count": (
                    trace[-1].total_evidence_count if trace else 0
                ),
                "target_kbs": [],
                "duration_seconds": 0.0,
                "status": "processing",
            }
        )
    return rounds


def _merge_retrieval_results(
    *,
    original_query: str,
    retrieval_results: Iterable[RetrievalResult],
    trace: List[AgentTraceStep],
    executed_queries: List[str],
    max_evidence: int,
) -> RetrievalResult:
    results = list(retrieval_results)
    if not results:
        raise ValueError("Agent mode produced no retrieval result")

    evidence: Dict[str, Dict[str, Any]] = {}
    raw_results: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    target_kb_ids: List[str] = []
    target_kbs_by_id: Dict[str, Dict[str, Any]] = {}
    selected_modalities: List[str] = []
    total_processing_time = 0.0

    for search_index, retrieval in enumerate(results):
        total_processing_time += float(retrieval.processing_time or 0.0)
        for route, values in (retrieval.raw_results or {}).items():
            raw_results[route].extend(values or [])
        for kb_id in getattr(retrieval.context, "target_kb_ids", []) or []:
            if kb_id not in target_kb_ids:
                target_kb_ids.append(kb_id)
        for target_kb in getattr(retrieval.context, "target_kbs", []) or []:
            if not isinstance(target_kb, dict) or not target_kb.get("id"):
                continue
            kb_id = str(target_kb["id"])
            existing = target_kbs_by_id.get(kb_id)
            if existing is None or (
                existing.get("name") == kb_id and target_kb.get("name") != kb_id
            ):
                target_kbs_by_id[kb_id] = dict(target_kb)
        for modality in getattr(retrieval.context, "selected_file_modalities", []) or []:
            if modality not in selected_modalities:
                selected_modalities.append(modality)

        for rank, raw_item in enumerate(retrieval.reranked_results or []):
            item = copy.deepcopy(raw_item)
            key = _result_key(item)
            if key.endswith(":"):
                continue
            score = float(item.get("final_score", item.get("score", 0.0)) or 0.0)
            previous = evidence.get(key)
            if previous is None:
                item["_agent_hit_count"] = 1
                item["_agent_best_rank"] = rank
                item["_agent_source_searches"] = [search_index]
                item["_agent_original_score"] = score
                item["_agent_score"] = score + (0.02 / (rank + 1))
                evidence[key] = item
                continue

            hit_count = int(previous.get("_agent_hit_count", 1)) + 1
            previous["_agent_hit_count"] = hit_count
            previous["_agent_best_rank"] = min(
                int(previous.get("_agent_best_rank", rank)),
                rank,
            )
            previous.setdefault("_agent_source_searches", []).append(search_index)
            best_original = max(
                float(previous.get("_agent_original_score", 0.0) or 0.0),
                score,
            )
            previous["_agent_original_score"] = best_original
            previous["_agent_score"] = (
                best_original
                + min(0.12, 0.04 * (hit_count - 1))
                + (0.02 / (int(previous["_agent_best_rank"]) + 1))
            )

    merged_items = sorted(
        evidence.values(),
        key=lambda item: float(item.get("_agent_score", 0.0) or 0.0),
        reverse=True,
    )[:max_evidence]
    for item in merged_items:
        item["final_score"] = float(
            item.get("_agent_score", item.get("final_score", 0.0)) or 0.0
        )
        metadata = dict(item.get("metadata") or {})
        metadata["agent_hit_count"] = int(item.get("_agent_hit_count", 1))
        metadata["agent_source_searches"] = list(item.get("_agent_source_searches", []))
        item["metadata"] = metadata

    merged_context = copy.deepcopy(results[0].context)
    merged_context.original_query = original_query
    merged_context.refined_query = original_query
    merged_context.is_complex = len(executed_queries) > 1 or merged_context.is_complex
    merged_context.target_kb_ids = target_kb_ids
    merged_context.target_kbs = [
        target_kbs_by_id.get(
            kb_id,
            {
                "id": kb_id,
                "name": kb_id,
                "score": float(
                    getattr(merged_context, "confidence_scores", {}).get(kb_id, 0.0)
                ),
            },
        )
        for kb_id in target_kb_ids
    ]
    merged_context.selected_file_modalities = selected_modalities
    merged_context.processing_time = total_processing_time

    strategies = dict(getattr(merged_context, "search_strategies", {}) or {})
    strategies["agent_queries"] = list(executed_queries)
    strategies["multi_view_queries"] = list(
        dict.fromkeys(
            list(strategies.get("multi_view_queries", []) or []) + executed_queries
        )
    )
    merged_context.search_strategies = strategies

    for retrieval in results[1:]:
        for field in ("visual_intent", "audio_intent", "video_intent"):
            setattr(
                merged_context,
                field,
                _stronger_intent(
                    str(getattr(merged_context, field, "unnecessary")),
                    str(getattr(retrieval.context, field, "unnecessary")),
                ),
            )

    debug_info = {
        "agent": {
            "enabled": True,
            "executed_queries": list(executed_queries),
            "steps": [step.to_dict() for step in trace],
            "unique_evidence_count": len(evidence),
            "selected_evidence_count": len(merged_items),
        },
        "retrieval_runs": [retrieval.debug_info for retrieval in results],
        "total_time": total_processing_time,
    }
    return RetrievalResult(
        context=merged_context,
        raw_results=dict(raw_results),
        reranked_results=merged_items,
        processing_time=total_processing_time,
        debug_info=debug_info,
    )


class AgenticRetrievalService:
    """Orchestrates iterative, read-only calls into the existing retriever."""

    def __init__(
        self,
        retrieval_service: Any,
        *,
        planner: Optional[AgentPlanner] = None,
        max_rounds: Optional[int] = None,
        max_queries_per_round: Optional[int] = None,
        max_total_queries: Optional[int] = None,
        max_evidence: Optional[int] = None,
    ) -> None:
        self.planner = planner or AgentPlanner(llm_manager)
        self.max_rounds = max_rounds or settings.agent_max_rounds
        self.max_queries_per_round = (
            max_queries_per_round or settings.agent_max_queries_per_round
        )
        self.max_total_queries = max_total_queries or settings.agent_max_total_queries
        self.max_evidence = max_evidence or settings.agent_max_evidence
        self.registry = AgentToolRegistry()
        self.registry.register(MultimodalKnowledgeSearchTool(retrieval_service))

    async def search(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
        model: Optional[str] = None,
    ) -> AgentRunResult:
        result: Optional[AgentRunResult] = None
        async for stage, payload in self.search_stream(
            query=query,
            kb_context=kb_context,
            session_context=session_context,
            attachment_context=attachment_context,
            model=model,
        ):
            if stage == "_result":
                result = payload
        if result is None:
            raise RuntimeError("Agentic retrieval did not return a result")
        return result

    async def search_stream(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
        model: Optional[str] = None,
    ) -> AsyncGenerator[Tuple[str, Any], None]:
        clean_query = " ".join((query or "").split()).strip()
        if not clean_query:
            raise ValueError("query must not be empty")

        yield (
            "intent",
            {
                "message": "Agent 模式已启用，正在分析证据需求",
                "intent_type": "agentic",
                "original_query": clean_query,
                "refined_query": clean_query,
                "is_complex": True,
                "agent_mode": True,
            },
        )

        tool = self.registry.get("multimodal_knowledge_search")
        tool_context = ToolContext(
            kb_context=kb_context,
            session_context=list(session_context or []),
            attachment_context=attachment_context,
        )
        retrieval_runs: List[RetrievalResult] = []
        evidence: Dict[str, Dict[str, Any]] = {}
        trace: List[AgentTraceStep] = []
        executed_queries: List[str] = []
        executed_keys = set()
        stop_reason = "max_rounds"
        stagnation_rounds = 0
        routing_emitted = False

        for round_number in range(1, self.max_rounds + 1):
            remaining = self.max_total_queries - len(executed_queries)
            if remaining <= 0:
                stop_reason = "query_budget"
                break

            decision = await self.planner.decide(
                query=clean_query,
                evidence_digest=_evidence_digest(evidence),
                executed_queries=executed_queries,
                round_number=round_number,
                max_rounds=self.max_rounds,
                max_queries=min(self.max_queries_per_round, remaining),
                model=model,
            )
            if decision is None:
                if not retrieval_runs:
                    decision = AgentDecision(
                        action="search",
                        reason="规划器不可用，使用原始问题执行保底检索",
                        queries=[clean_query],
                    )
                else:
                    stop_reason = "planner_fallback"
                    break

            if decision.action == "final" and retrieval_runs:
                trace.append(
                    AgentTraceStep(
                        round=round_number,
                        action="final",
                        reason=decision.reason or "现有证据已足够",
                    )
                )
                stop_reason = "evidence_sufficient"
                break

            candidate_queries = decision.queries or [clean_query]
            queries: List[str] = []
            for candidate in candidate_queries:
                normalized = " ".join(candidate.split()).strip()
                key = normalized.casefold()
                if not normalized or key in executed_keys:
                    continue
                queries.append(normalized)
                executed_keys.add(key)
                if len(queries) >= min(self.max_queries_per_round, remaining):
                    break
            if not queries:
                if not retrieval_runs:
                    queries = [clean_query]
                    executed_keys.add(clean_query.casefold())
                else:
                    stop_reason = "no_new_queries"
                    break

            yield (
                "routing",
                {
                    "message": f"Agent 第 {round_number} 轮计划了 {len(queries)} 条检索",
                    "target_kbs": [],
                    "fallback_search": not bool((kb_context or {}).get("kb_ids")),
                    "agent_mode": True,
                    "agent_round": round_number,
                    "agent_reason": decision.reason,
                    "sub_queries": list(queries),
                    "agent_rounds": _agent_rounds_payload(
                        trace,
                        current_round=round_number,
                        current_reason=decision.reason,
                        current_queries=queries,
                    ),
                },
            )

            started = time.monotonic()
            gathered = await asyncio.gather(
                *(tool.execute(query=item, context=tool_context) for item in queries),
                return_exceptions=True,
            )
            successful: List[RetrievalResult] = []
            errors: List[str] = []
            for item in gathered:
                if isinstance(item, Exception):
                    errors.append(str(item))
                else:
                    successful.append(item)
            if not successful:
                if not retrieval_runs:
                    raise RuntimeError(errors[0] if errors else "Agent retrieval failed")
                trace.append(
                    AgentTraceStep(
                        round=round_number,
                        action="search",
                        reason=decision.reason,
                        queries=queries,
                        total_evidence_count=len(evidence),
                        duration_seconds=time.monotonic() - started,
                        error="; ".join(errors)[:1000],
                    )
                )
                yield (
                    "retrieval",
                    {
                        "message": f"Agent 第 {round_number} 轮检索失败，使用已有证据继续",
                        "target_kbs": [],
                        "sub_queries": list(executed_queries),
                        "total_found": len(evidence),
                        "reranked_count": min(len(evidence), self.max_evidence),
                        "agent_mode": True,
                        "agent_round": round_number,
                        "agent_reason": decision.reason,
                        "agent_new_evidence": 0,
                        "agent_tool": tool.name,
                        "agent_rounds": _agent_rounds_payload(trace),
                    },
                )
                stop_reason = "tool_error"
                break

            executed_queries.extend(queries)
            before_count = len(evidence)
            result_count = 0
            for retrieval in successful:
                retrieval_runs.append(retrieval)
                for raw_item in retrieval.reranked_results or []:
                    result_count += 1
                    key = _result_key(raw_item)
                    if not key.endswith(":") and key not in evidence:
                        evidence[key] = raw_item
            new_count = len(evidence) - before_count
            stagnation_rounds = stagnation_rounds + 1 if new_count == 0 else 0
            step = AgentTraceStep(
                round=round_number,
                action="search",
                reason=decision.reason,
                queries=queries,
                result_count=result_count,
                new_evidence_count=new_count,
                total_evidence_count=len(evidence),
                duration_seconds=time.monotonic() - started,
                error="; ".join(errors)[:1000] if errors else None,
            )
            trace.append(step)

            target_kbs: List[Dict[str, Any]] = []
            for retrieval in successful:
                confidence = getattr(retrieval.context, "confidence_scores", {}) or {}
                enriched_targets = getattr(retrieval.context, "target_kbs", []) or []
                names_by_id = {
                    str(row.get("id")): str(row.get("name") or row.get("id"))
                    for row in enriched_targets
                    if isinstance(row, dict) and row.get("id")
                }
                for kb_id in getattr(retrieval.context, "target_kb_ids", []) or []:
                    if any(row["id"] == kb_id for row in target_kbs):
                        continue
                    target_kbs.append(
                        {
                            "id": kb_id,
                            "name": names_by_id.get(kb_id, kb_id),
                            "score": float(confidence.get(kb_id, 0.0)),
                        }
                    )
            if target_kbs and not routing_emitted:
                routing_emitted = True
            step.target_kbs = target_kbs

            yield (
                "retrieval",
                {
                    "message": (
                        f"Agent 第 {round_number} 轮完成：新增 {new_count} 条证据"
                    ),
                    "target_kbs": target_kbs,
                    "sub_queries": list(executed_queries),
                    "total_found": len(evidence),
                    "reranked_count": min(len(evidence), self.max_evidence),
                    "agent_mode": True,
                    "agent_round": round_number,
                    "agent_reason": decision.reason,
                    "agent_new_evidence": new_count,
                    "agent_tool": tool.name,
                    "agent_rounds": _agent_rounds_payload(trace),
                },
            )

            if stagnation_rounds >= 1:
                stop_reason = "no_new_evidence"
                break

        merged = _merge_retrieval_results(
            original_query=clean_query,
            retrieval_results=retrieval_runs,
            trace=trace,
            executed_queries=executed_queries,
            max_evidence=self.max_evidence,
        )
        run_result = AgentRunResult(
            retrieval_result=merged,
            trace=trace,
            stop_reason=stop_reason,
            executed_queries=executed_queries,
        )
        merged.debug_info["agent"].update(run_result.metadata())
        yield ("_result", run_result)
