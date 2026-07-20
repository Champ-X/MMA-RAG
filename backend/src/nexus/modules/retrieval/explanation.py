from __future__ import annotations

from dataclasses import dataclass

from nexus.modules.retrieval.domain import ChannelResult


@dataclass(frozen=True, slots=True)
class SearchExplanation:
    """Stable, user-facing diagnosis derived from observable retrieval facts."""

    outcome: str
    severity: str
    scope_evidence_count: int
    candidate_count: int
    completed_channels: int
    failed_channels: int
    unavailable_channels: int
    suggested_actions: tuple[str, ...] = ()


def explain_search(
    *,
    channels: tuple[ChannelResult, ...],
    hit_count: int,
    scope_evidence_count: int,
) -> SearchExplanation:
    completed = sum(result.status == "completed" for result in channels)
    failed = sum(result.status == "failed" for result in channels)
    unavailable = sum(result.status == "unavailable" for result in channels)
    candidate_count = sum(
        len(result.candidates) for result in channels if result.status == "completed"
    )
    facts = {
        "scope_evidence_count": max(0, scope_evidence_count),
        "candidate_count": candidate_count,
        "completed_channels": completed,
        "failed_channels": failed,
        "unavailable_channels": unavailable,
    }
    if hit_count:
        if failed or unavailable:
            return SearchExplanation(
                outcome="evidence_found_degraded",
                severity="warning",
                suggested_actions=("inspect_retrieval_details",),
                **facts,
            )
        return SearchExplanation(outcome="evidence_found", severity="success", **facts)
    if scope_evidence_count <= 0:
        return SearchExplanation(
            outcome="scope_empty",
            severity="warning",
            suggested_actions=("add_sources", "inspect_ingestion"),
            **facts,
        )
    if completed == 0:
        return SearchExplanation(
            outcome="retrieval_unavailable",
            severity="error",
            suggested_actions=("inspect_system_status", "retry_search"),
            **facts,
        )
    if candidate_count:
        return SearchExplanation(
            outcome="scope_projection_mismatch",
            severity="error",
            suggested_actions=("inspect_scope_snapshot", "rebuild_search_projection"),
            **facts,
        )
    if failed or unavailable:
        return SearchExplanation(
            outcome="retrieval_incomplete",
            severity="warning",
            suggested_actions=("inspect_system_status", "retry_search"),
            **facts,
        )
    return SearchExplanation(
        outcome="no_relevant_evidence",
        severity="info",
        suggested_actions=("broaden_query", "review_scope"),
        **facts,
    )


def aggregate_search_explanations(
    explanations: tuple[SearchExplanation, ...],
    *,
    hit_count: int,
) -> SearchExplanation | None:
    if not explanations:
        return None
    facts = {
        "scope_evidence_count": max(item.scope_evidence_count for item in explanations),
        "candidate_count": sum(item.candidate_count for item in explanations),
        "completed_channels": sum(item.completed_channels for item in explanations),
        "failed_channels": sum(item.failed_channels for item in explanations),
        "unavailable_channels": sum(item.unavailable_channels for item in explanations),
    }
    if hit_count:
        if facts["failed_channels"] or facts["unavailable_channels"]:
            return SearchExplanation(
                outcome="evidence_found_degraded",
                severity="warning",
                suggested_actions=("inspect_retrieval_details",),
                **facts,
            )
        return SearchExplanation(outcome="evidence_found", severity="success", **facts)
    priority = {
        "scope_projection_mismatch": 6,
        "retrieval_unavailable": 5,
        "retrieval_incomplete": 4,
        "scope_empty": 3,
        "no_relevant_evidence": 2,
        "evidence_found_degraded": 1,
        "evidence_found": 0,
    }
    selected = max(explanations, key=lambda item: priority.get(item.outcome, -1))
    return SearchExplanation(
        outcome=selected.outcome,
        severity=selected.severity,
        suggested_actions=selected.suggested_actions,
        **facts,
    )
