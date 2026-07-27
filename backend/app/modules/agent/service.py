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

_MODALITY_NAMES = ("image", "audio", "video")
_MODALITY_CONTEXT_FIELDS = {
    "image": "visual_intent",
    "audio": "audio_intent",
    "video": "video_intent",
}
_MODALITY_QUERY_TERMS = {
    "image": (
        "图片", "图像", "图表", "照片", "海报", "封面", "截图", "视觉", "示意图",
        "image", "photo", "poster", "cover", "figure", "chart", "diagram", "visual",
    ),
    "audio": (
        "音频", "音乐", "歌曲", "主题曲", "原声", "录音", "声音",
        "audio", "music", "song", "soundtrack", "voice",
    ),
    "video": (
        "视频", "电影", "影片", "影视", "影视剧", "电视剧", "剧集", "动画片", "片段", "影像", "画面",
        "video", "movie", "film", "clip", "footage",
    ),
}
_MODALITY_QUERY_SUFFIXES = {
    "image": "图片与相关视觉素材",
    "audio": "音频、音乐或声音素材",
    "video": "视频片段或影像素材",
}


def _normalize_modality_intent(value: Any) -> str:
    intent = str(value or "unnecessary").strip()
    return intent if intent in _INTENT_PRIORITY else "unnecessary"


def _normalize_modality_requirements(
    values: Optional[Dict[str, Any]],
) -> Dict[str, str]:
    values = values or {}
    return {
        modality: _normalize_modality_intent(
            values.get(modality, values.get(_MODALITY_CONTEXT_FIELDS[modality]))
        )
        for modality in _MODALITY_NAMES
    }


def _result_modality(result: Dict[str, Any]) -> str:
    content_type = str(result.get("content_type") or "doc").strip().lower()
    return content_type if content_type in _MODALITY_NAMES else "doc"


def _evidence_modalities(evidence: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    counts = {modality: 0 for modality in _MODALITY_NAMES}
    for result in evidence.values():
        modality = _result_modality(result)
        if modality in counts:
            counts[modality] += 1
    return counts


def _query_covers_modality(query: str, modality: str) -> bool:
    normalized = str(query or "").casefold()
    return any(term.casefold() in normalized for term in _MODALITY_QUERY_TERMS[modality])


def _pending_modalities(
    *,
    evidence: Dict[str, Dict[str, Any]],
    requirements: Dict[str, str],
    attempted_queries: Iterable[str],
) -> List[str]:
    """Return required modalities that have neither evidence nor one attempt."""
    available = _evidence_modalities(evidence)
    attempted = list(attempted_queries)
    return [
        modality
        for modality in _MODALITY_NAMES
        if requirements.get(modality, "unnecessary") != "unnecessary"
        and available[modality] == 0
        and not any(_query_covers_modality(item, modality) for item in attempted)
    ]


def _ensure_modality_coverage_queries(
    *,
    original_query: str,
    candidate_queries: Iterable[str],
    evidence: Dict[str, Dict[str, Any]],
    requirements: Dict[str, str],
    executed_queries: Iterable[str],
    max_queries: int,
) -> List[str]:
    """Add one explicit query for each still-uncovered required modality.

    The full original-question analysis can mark an image need as implicit.
    Child queries are deliberately concise and often omit that signal.  A
    single explicit coverage query lets the existing visual/audio/video
    retrieval pipeline run without turning every Agent query into an
    expensive multimodal search.
    """
    queries: List[str] = []
    seen = set()
    for candidate in candidate_queries:
        clean = " ".join(str(candidate or "").split()).strip()
        key = clean.casefold()
        if not clean or key in seen:
            continue
        seen.add(key)
        queries.append(clean)
        if len(queries) >= max_queries:
            break

    pending = _pending_modalities(
        evidence=evidence,
        requirements=requirements,
        attempted_queries=list(executed_queries) + queries,
    )
    # Explicit user demands take precedence if the round has no spare slot.
    pending.sort(
        key=lambda modality: _INTENT_PRIORITY.get(requirements.get(modality, ""), 0),
        reverse=True,
    )
    replace_index = len(queries) - 1
    for modality in pending:
        coverage_query = " ".join(
            (original_query, _MODALITY_QUERY_SUFFIXES[modality])
        ).strip()[:500]
        if len(queries) < max_queries:
            queries.append(coverage_query)
        elif replace_index >= 0:
            queries[replace_index] = coverage_query
            replace_index -= 1

    # Replacements above can create a duplicate in edge cases.
    unique_queries: List[str] = []
    seen.clear()
    for candidate in queries:
        key = candidate.casefold()
        if key not in seen:
            seen.add(key)
            unique_queries.append(candidate)
    return unique_queries[:max_queries]


def _modality_reserve_count(modality: str, intent: str) -> int:
    if intent == "explicit_demand":
        return {"image": 5, "audio": 3, "video": 3}[modality]
    if intent == "implicit_enrichment":
        return {"image": 4, "audio": 2, "video": 2}[modality]
    return 0


def _original_query_anchor_reserve(max_evidence: int) -> int:
    """Keep a bounded slice of the normal direct-retrieval result.

    The anchor is intentionally a floor rather than the whole answer: it
    protects the original question from planner drift while leaving at least
    half of the evidence budget available to iterative Agent discoveries.
    """
    return min(10, max(1, max_evidence // 2))


def _select_evidence_with_modality_protection(
    ranked_items: List[Dict[str, Any]],
    *,
    max_evidence: int,
    requirements: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Prevent document-heavy Agent rounds from crowding out modal evidence."""
    selected = list(ranked_items[:max_evidence])
    protected = set()

    for modality in _MODALITY_NAMES:
        required = _modality_reserve_count(modality, requirements.get(modality, ""))
        if required <= 0:
            continue
        candidates = [item for item in ranked_items if _result_modality(item) == modality]
        required = min(required, len(candidates), max_evidence)
        if required <= 0:
            continue

        for item in selected:
            if _result_modality(item) == modality and len(
                [key for key in protected if key[0] == modality]
            ) < required:
                protected.add((modality, _result_key(item)))

        selected_count = sum(
            1 for item in selected if _result_modality(item) == modality
        )
        for candidate in candidates:
            if selected_count >= required:
                break
            if candidate in selected:
                protected.add((modality, _result_key(candidate)))
                continue
            replacement_index = next(
                (
                    index
                    for index in range(len(selected) - 1, -1, -1)
                    if _result_modality(selected[index]) != modality
                    and (
                        _result_modality(selected[index]),
                        _result_key(selected[index]),
                    )
                    not in protected
                ),
                None,
            )
            if replacement_index is None:
                break
            selected[replacement_index] = candidate
            protected.add((modality, _result_key(candidate)))
            selected_count += 1

    return sorted(
        selected,
        key=lambda item: float(item.get("_agent_score", 0.0) or 0.0),
        reverse=True,
    )


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


def _seed_evidence_from_original_query_anchor(
    evidence: Dict[str, Dict[str, Any]],
    retrieval: RetrievalResult,
) -> int:
    """Make the direct original-query result available to the first plan.

    The anchor is not an extra visible Agent round, but the planner must be
    able to inspect it before deciding whether a decomposition is necessary.
    Otherwise every first decision starts from an artificial ``no evidence``
    state and tends to fan out into unrelated meanings of an ambiguous term.
    """
    added = 0
    for rank, raw_item in enumerate(retrieval.reranked_results or []):
        if not isinstance(raw_item, dict):
            continue
        key = _result_key(raw_item)
        if key.endswith(":") or key in evidence:
            continue
        item = copy.deepcopy(raw_item)
        score = float(item.get("final_score", item.get("score", 0.0)) or 0.0)
        item["_agent_hit_count"] = 1
        item["_agent_best_rank"] = rank
        item["_agent_source_searches"] = [-1]
        item["_agent_original_score"] = score
        item["_agent_original_query_anchor"] = True
        item["_agent_score"] = score + (0.02 / (rank + 1))
        evidence[key] = item
        added += 1
    return added


def _anchor_knowledge_bases(retrieval: Optional[RetrievalResult]) -> List[Dict[str, Any]]:
    """Return concise source provenance for the planner prompt."""
    if retrieval is None:
        return []
    context = getattr(retrieval, "context", None)
    if context is None:
        return []
    confidence = getattr(context, "confidence_scores", {}) or {}
    names_by_id = {
        str(row.get("id")): str(row.get("name") or row.get("id"))
        for row in (getattr(context, "target_kbs", []) or [])
        if isinstance(row, dict) and row.get("id")
    }
    return [
        {
            "id": str(kb_id),
            "name": names_by_id.get(str(kb_id), str(kb_id)),
            "score": float(confidence.get(kb_id, 0.0) or 0.0),
        }
        for kb_id in (getattr(context, "target_kb_ids", []) or [])
        if str(kb_id).strip()
    ]


def _is_focused_original_query_anchor(retrieval: Optional[RetrievalResult]) -> bool:
    """Whether a direct result is strong enough to constrain first-round fanout.

    A single clearly routed KB with several hits is a resolved interpretation
    of the original question.  The Agent may still run one focused gap-filling
    query, but it should not immediately spend the full budget on alternate
    meanings.  Broad or weak direct routes remain free to fan out normally.
    """
    if retrieval is None or len(retrieval.reranked_results or []) < 3:
        return False
    target_ids = {
        str(kb_id).strip()
        for kb_id in (getattr(retrieval.context, "target_kb_ids", []) or [])
        if str(kb_id).strip()
    }
    return len(target_ids) == 1


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
    modality_requirements: Optional[Dict[str, str]] = None,
    original_query_anchor_count: int = 0,
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
        is_original_query_anchor = search_index < original_query_anchor_count
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
                item["_agent_original_query_anchor"] = is_original_query_anchor
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
            previous["_agent_original_query_anchor"] = bool(
                previous.get("_agent_original_query_anchor")
                or is_original_query_anchor
            )
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

    effective_modality_requirements = _normalize_modality_requirements(
        modality_requirements
    )
    for retrieval in results:
        for modality, field in _MODALITY_CONTEXT_FIELDS.items():
            effective_modality_requirements[modality] = _stronger_intent(
                effective_modality_requirements[modality],
                _normalize_modality_intent(getattr(retrieval.context, field, "unnecessary")),
            )

    ranked_items = sorted(
        evidence.values(),
        key=lambda item: float(item.get("_agent_score", 0.0) or 0.0),
        reverse=True,
    )
    # Subqueries are each reranked against their *own* wording.  Without an
    # original-query anchor, broad facts that happen to recur across those
    # queries can outrank the document that actually answers the user.  Keep
    # a compact direct-retrieval slice at the front, then fill the remaining
    # budget with Agent discoveries and apply the existing modality guards.
    anchor_items = [
        item for item in ranked_items
        if item.get("_agent_original_query_anchor")
    ]
    if anchor_items:
        anchor_limit = _original_query_anchor_reserve(max_evidence)
        reserved_anchor_items = anchor_items[:anchor_limit]
        reserved_keys = {_result_key(item) for item in reserved_anchor_items}
        selection_candidates = reserved_anchor_items + [
            item for item in ranked_items if _result_key(item) not in reserved_keys
        ]
    else:
        selection_candidates = ranked_items
    merged_items = _select_evidence_with_modality_protection(
        selection_candidates,
        max_evidence=max_evidence,
        requirements=effective_modality_requirements,
    )
    if anchor_items:
        merged_items.sort(
            key=lambda item: (
                bool(item.get("_agent_original_query_anchor")),
                float(item.get("_agent_score", 0.0) or 0.0),
            ),
            reverse=True,
        )
    for item in merged_items:
        item["final_score"] = float(
            item.get("_agent_score", item.get("final_score", 0.0)) or 0.0
        )
        metadata = dict(item.get("metadata") or {})
        metadata["agent_hit_count"] = int(item.get("_agent_hit_count", 1))
        metadata["agent_source_searches"] = list(item.get("_agent_source_searches", []))
        metadata["agent_original_query_anchor"] = bool(
            item.get("_agent_original_query_anchor")
        )
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

    for modality, field in _MODALITY_CONTEXT_FIELDS.items():
        setattr(
            merged_context,
            field,
            _stronger_intent(
                str(getattr(merged_context, field, "unnecessary")),
                effective_modality_requirements[modality],
            ),
        )

    debug_info = {
        "agent": {
            "enabled": True,
            "executed_queries": list(executed_queries),
            "steps": [step.to_dict() for step in trace],
            "unique_evidence_count": len(evidence),
            "selected_evidence_count": len(merged_items),
            "modality_requirements": effective_modality_requirements,
            "selected_modalities": _evidence_modalities(
                {_result_key(item): item for item in merged_items}
            ),
            "original_query_anchor": {
                "enabled": bool(original_query_anchor_count),
                "available_evidence_count": len(anchor_items),
                "reserved_evidence_count": sum(
                    1
                    for item in merged_items
                    if item.get("_agent_original_query_anchor")
                ),
            },
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
        self.retrieval_service = retrieval_service
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
        retrieval_runs: List[RetrievalResult] = []
        evidence: Dict[str, Dict[str, Any]] = {}
        trace: List[AgentTraceStep] = []
        executed_queries: List[str] = []
        executed_keys = set()
        stop_reason = "max_rounds"
        stagnation_rounds = 0
        routing_emitted = False
        explored_kb_counts: Dict[str, int] = {}
        explored_kb_names: Dict[str, str] = {}
        original_query_preprocessing = await self._prepare_original_query_anchor(
            query=clean_query,
            kb_context=kb_context,
            session_context=session_context,
            attachment_context=attachment_context,
        )
        original_query_anchor: Optional[RetrievalResult] = None
        if original_query_preprocessing is not None:
            modality_requirements = _normalize_modality_requirements(
                {
                    "image": original_query_preprocessing.get("visual_intent"),
                    "audio": original_query_preprocessing.get("audio_intent"),
                    "video": original_query_preprocessing.get("video_intent"),
                }
            )
            # The normal retrieval path is a quality floor, not another Agent
            # round.  It must complete before planning: planning from an empty
            # ledger was the source of unnecessary cross-domain fanout (for
            # example treating a resolved product name as a different field).
            original_query_anchor = await self._run_original_query_anchor(
                query=clean_query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=attachment_context,
                preprocessing_result=original_query_preprocessing,
            )
            if original_query_anchor is not None:
                seeded = _seed_evidence_from_original_query_anchor(
                    evidence,
                    original_query_anchor,
                )
                logger.info(
                    "Agent 原问题锚点已进入规划证据池: evidence_count={}",
                    seeded,
                )
        else:
            modality_requirements = await self._get_modality_requirements(
                query=clean_query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=attachment_context,
            )

        for round_number in range(1, self.max_rounds + 1):
            remaining = self.max_total_queries - len(executed_queries)
            if remaining <= 0:
                stop_reason = "query_budget"
                break

            pending_modalities = _pending_modalities(
                evidence=evidence,
                requirements=modality_requirements,
                attempted_queries=executed_queries,
            )
            round_query_limit = min(self.max_queries_per_round, remaining)
            # Do not turn a focused direct hit into three speculative first
            # round branches.  An uncovered explicit modality remains allowed
            # to use the normal budget so requests such as "海报 + 主题曲" can
            # still reserve both needed knowledge bases.
            if (
                round_number == 1
                and _is_focused_original_query_anchor(original_query_anchor)
                and not any(
                    modality_requirements.get(modality) == "explicit_demand"
                    for modality in pending_modalities
                )
            ):
                round_query_limit = min(round_query_limit, 1)

            decision = await self.planner.decide(
                query=clean_query,
                evidence_digest=_evidence_digest(evidence),
                executed_queries=executed_queries,
                round_number=round_number,
                max_rounds=self.max_rounds,
                max_queries=round_query_limit,
                explored_knowledge_bases=[
                    {
                        "id": kb_id,
                        "name": explored_kb_names.get(kb_id, kb_id),
                        "rounds": count,
                    }
                    for kb_id, count in explored_kb_counts.items()
                ],
                modality_requirements=modality_requirements,
                anchor_knowledge_bases=_anchor_knowledge_bases(original_query_anchor),
                model=model,
            )
            if decision is None:
                if not evidence:
                    decision = AgentDecision(
                        action="search",
                        reason="规划器不可用，使用原始问题执行保底检索",
                        queries=[clean_query],
                    )
                else:
                    decision = AgentDecision(
                        action="final",
                        reason="规划器不可用，保留原问题已命中的直接证据",
                    )
            if (
                decision.action == "final"
                and evidence
                and pending_modalities
                and remaining > 0
            ):
                decision = AgentDecision(
                    action="search",
                    reason=(
                        "原问题仍缺少一次"
                        + "、".join(
                            {"image": "图片", "audio": "音频", "video": "视频"}[item]
                            for item in pending_modalities
                        )
                        + "证据检索，补足多模态覆盖"
                    ),
                    queries=[],
                )

            if decision.action == "final" and evidence:
                trace.append(
                    AgentTraceStep(
                        round=round_number,
                        action="final",
                        reason=decision.reason or "现有证据已足够",
                    )
                )
                stop_reason = "evidence_sufficient"
                break

            candidate_queries = _ensure_modality_coverage_queries(
                original_query=clean_query,
                candidate_queries=decision.queries or [clean_query],
                evidence=evidence,
                requirements=modality_requirements,
                executed_queries=executed_queries,
                max_queries=round_query_limit,
            )
            queries: List[str] = []
            for candidate in candidate_queries:
                normalized = " ".join(candidate.split()).strip()
                key = normalized.casefold()
                if not normalized or key in executed_keys:
                    continue
                queries.append(normalized)
                executed_keys.add(key)
                if len(queries) >= round_query_limit:
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
            # All subqueries in one round share the same immutable exploration
            # snapshot. The ledger is advanced once per KB after the round ends.
            round_tool_context = ToolContext(
                kb_context=kb_context,
                session_context=list(session_context or []),
                attachment_context=attachment_context,
                agent_round=round_number,
                explored_kb_counts=dict(explored_kb_counts),
                base_modality_intents=modality_requirements,
            )
            gathered = await asyncio.gather(
                *(tool.execute(query=item, context=round_tool_context) for item in queries),
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
                if not retrieval_runs and not evidence:
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
            for target in target_kbs:
                kb_id = str(target.get("id") or "").strip()
                if not kb_id:
                    continue
                explored_kb_counts[kb_id] = explored_kb_counts.get(kb_id, 0) + 1
                explored_kb_names[kb_id] = str(target.get("name") or kb_id)

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

        merged_retrieval_runs = list(retrieval_runs)
        if original_query_anchor is not None:
            merged_retrieval_runs.insert(0, original_query_anchor)

        merged = _merge_retrieval_results(
            original_query=clean_query,
            retrieval_results=merged_retrieval_runs,
            trace=trace,
            executed_queries=executed_queries,
            max_evidence=self.max_evidence,
            modality_requirements=modality_requirements,
            original_query_anchor_count=1 if original_query_anchor is not None else 0,
        )
        run_result = AgentRunResult(
            retrieval_result=merged,
            trace=trace,
            stop_reason=stop_reason,
            executed_queries=executed_queries,
        )
        merged.debug_info["agent"].update(run_result.metadata())
        merged.debug_info["agent"]["explored_knowledge_bases"] = [
            {
                "id": kb_id,
                "name": explored_kb_names.get(kb_id, kb_id),
                "rounds": count,
            }
            for kb_id, count in explored_kb_counts.items()
        ]
        yield ("_result", run_result)

    async def _prepare_original_query_anchor(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]],
        session_context: Optional[List[Dict[str, str]]],
        attachment_context: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Build one reusable direct-retrieval plan for the original question."""
        preparer = getattr(self.retrieval_service, "prepare_agent_original_query", None)
        if not callable(preparer):
            return None
        try:
            prepared = await preparer(
                query=query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=attachment_context,
            )
            if isinstance(prepared, dict):
                return prepared
            logger.warning("Agent 原问题锚点预处理返回了无效结果，跳过直接检索锚点")
        except Exception as exc:
            logger.warning("Agent 原问题锚点预处理失败，继续使用子查询检索: %s", exc)
        return None

    async def _run_original_query_anchor(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]],
        session_context: Optional[List[Dict[str, str]]],
        attachment_context: Optional[str],
        preprocessing_result: Dict[str, Any],
    ) -> Optional[RetrievalResult]:
        """Run original-query retrieval as a quality floor for Agent mode.

        This must be the same retrieval baseline used by direct mode.  Agent
        novelty and modality routing is useful for *follow-up* subqueries, but
        applying it to the original question can silently change a correct
        direct route into a different KB set before the planner sees any
        evidence.  The resulting direct hit remains a hidden quality floor;
        later Agent rounds can still explore additional sources when a real
        evidence gap exists.
        """
        try:
            result = await self.retrieval_service.search(
                query=query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=attachment_context,
                preplanned=False,
                routing_hints={},
                preprocessing_result=preprocessing_result,
            )
            logger.info(
                "Agent 原问题检索锚点完成: query={!r}, results={}",
                query[:100],
                len(result.reranked_results or []),
            )
            return result
        except Exception as exc:
            # Deep research remains available when the anchor's normal path
            # has a transient model/vector failure.
            logger.warning("Agent 原问题检索锚点失败，继续使用 Agent 证据: %s", exc)
            return None

    async def _get_modality_requirements(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]],
        session_context: Optional[List[Dict[str, str]]],
        attachment_context: Optional[str],
    ) -> Dict[str, str]:
        """Use the main retriever's original-query analyzer when available."""
        analyzer = getattr(self.retrieval_service, "get_agent_modality_requirements", None)
        if not callable(analyzer):
            return _normalize_modality_requirements(None)
        try:
            requirements = await analyzer(
                query=query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=attachment_context,
            )
            return _normalize_modality_requirements(requirements)
        except Exception as exc:
            logger.warning("Agent 多模态预分析不可用，继续使用保底策略: %s", exc)
            return _normalize_modality_requirements(None)
