"""Budget-preserving selection of strong evidence from distinct semantic views.

Rank fusion rewards agreement. A passage which directly answers a speech query
can nevertheless lose to passages matching both picture descriptions and sparse
terms. Keep a bounded number of strong view winners visible to the downstream
reranker without adding retrieval calls or increasing its candidate budget.

This module does not infer permissions, call models, or treat scores as calibrated
probabilities. Callers supply the allowed semantic views and experiment thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class EvidenceSelection:
    candidates: list[dict[str, Any]]
    details: dict[str, Any]


@dataclass(frozen=True)
class PrototypeRouteSelection:
    targets: list[str]
    details: dict[str, Any]


def _score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    score = float(value)
    return score if math.isfinite(score) else None


def select_evidence_anchors(
    rrf_candidates: Sequence[Mapping[str, Any]],
    view_hits: Mapping[str, Sequence[Mapping[str, Any]] | None],
    limit: int,
    *,
    semantic_views: Sequence[str] = ("caption_dense", "asr_dense"),
    min_score: float = 0.5,
    min_relative_score: float = 0.9,
    max_anchors: int = 2,
) -> EvidenceSelection:
    """Keep strong semantic top-1 hits within an existing candidate limit.

    ``rrf_candidates`` and each ``view_hits[view]`` are already ranked lists.
    A view hit needs only ``id`` and its native ``score``; it must also exist in
    the complete fused candidate list so source metadata can never be invented.
    Only explicitly eligible semantic views participate: sparse/CLIP scores have
    different scales and are not comparable to text-space cosine similarities.

    A winner qualifies only above both the absolute floor and a fraction of the
    strongest semantic winner. Duplicate winners occupy one slot. If qualifying
    winners exceed the budget, keep the strongest first. Other slots preserve
    the original fusion order; no score is inflated and input records are not
    mutated. Thresholds are policy parameters, not accuracy guarantees.
    """
    if type(limit) is not int or limit < 0:
        raise ValueError("limit must be a nonnegative integer")
    if type(max_anchors) is not int or max_anchors < 0:
        raise ValueError("max_anchors must be a nonnegative integer")
    floor, ratio = _score(min_score), _score(min_relative_score)
    if floor is None or floor < 0 or ratio is None or not 0 <= ratio <= 1:
        raise ValueError("invalid semantic evidence thresholds")

    ordered: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in rrf_candidates:
        identifier = str(row.get("id") or "")
        if not identifier or identifier in by_id:
            continue
        candidate = dict(row)
        ordered.append(candidate)
        by_id[identifier] = candidate
    baseline = ordered[:limit]
    baseline_ids = [str(row["id"]) for row in baseline]

    winners: list[tuple[str, str, float]] = []
    for view in dict.fromkeys(semantic_views):
        rows = view_hits.get(view)
        if not rows or not isinstance(rows[0], Mapping):
            continue
        identifier = str(rows[0].get("id") or "")
        score = _score(rows[0].get("score"))
        if identifier in by_id and score is not None:
            winners.append((identifier, view, score))
    strongest = max((score for _, _, score in winners), default=0.0)
    threshold = max(floor, strongest * ratio)

    qualifying: dict[str, dict[str, float]] = {}
    for identifier, view, score in winners:
        if score >= threshold and score > 0:
            qualifying.setdefault(identifier, {})[view] = score
    # Stable ties preserve semantic_views order rather than hash/set order.
    anchor_ids = sorted(qualifying, key=lambda identifier: -max(qualifying[identifier].values()))[
        :min(limit, max_anchors)
    ]
    selected_ids = set(anchor_ids)
    for row in ordered:
        if len(selected_ids) >= limit:
            break
        selected_ids.add(str(row["id"]))

    selected: list[dict[str, Any]] = []
    for row in ordered:
        identifier = str(row["id"])
        if identifier not in selected_ids:
            continue
        if identifier in anchor_ids:
            row["semantic_evidence_anchor"] = {
                "views": list(qualifying[identifier]),
                "scores": dict(qualifying[identifier]),
                "reason": "strong_semantic_view_winner",
            }
        selected.append(row)

    selected_order = [str(row["id"]) for row in selected]
    return EvidenceSelection(
        candidates=selected,
        details={
            "policy": "semantic_view_anchors_v1",
            "candidate_limit": limit,
            "max_anchors": max_anchors,
            "min_score": floor,
            "min_relative_score": ratio,
            "effective_threshold": threshold,
            "semantic_views": list(dict.fromkeys(semantic_views)),
            "anchor_ids": anchor_ids,
            "inserted_ids": [identifier for identifier in selected_order if identifier not in baseline_ids],
            "evicted_ids": [identifier for identifier in baseline_ids if identifier not in selected_ids],
            "candidate_count": len(selected),
        },
    )


def select_prototype_routes(
    baseline_targets: Sequence[str],
    prototype_scores: Mapping[str, float],
    *,
    max_targets: int = 2,
    min_score: float = 0.5,
    min_absolute_gap: float = 0.04,
    min_relative_gap: float = 0.12,
) -> PrototypeRouteSelection:
    """Supplement portrait routing with strong independent content evidence.

    The caller supplies one comparable semantic score per authorized KB, normally
    the maximum similarity across that KB's content prototypes. Explicit user
    scopes must bypass this policy. The original first target is always retained;
    a clearly dominant prototype winner can occupy the last available slot only.
    A missing runner-up cannot establish dominance and leaves the route unchanged.
    This is a conservative decision rule, not a calibrated confidence estimate.
    """
    if type(max_targets) is not int or max_targets < 0:
        raise ValueError("max_targets must be a nonnegative integer")
    floor = _score(min_score)
    absolute_floor = _score(min_absolute_gap)
    relative_floor = _score(min_relative_gap)
    if (
        floor is None or floor < 0
        or absolute_floor is None or absolute_floor < 0
        or relative_floor is None or not 0 <= relative_floor <= 1
    ):
        raise ValueError("invalid prototype routing thresholds")

    baseline = list(dict.fromkeys(str(kb_id) for kb_id in baseline_targets if kb_id))[:max_targets]
    scores = [
        (str(kb_id), value)
        for kb_id, raw in prototype_scores.items()
        if kb_id and (value := _score(raw)) is not None
    ]
    # ID ties make diagnostics deterministic; equal scores never pass the gap.
    scores.sort(key=lambda pair: (-pair[1], pair[0]))
    winner = scores[0][0] if scores else None
    first = scores[0][1] if scores else None
    second = scores[1][1] if len(scores) > 1 else None
    absolute_gap = first - second if first is not None and second is not None else None
    relative_gap = absolute_gap / max(abs(first), 1e-9) if absolute_gap is not None else None

    targets = list(baseline)
    reason = "no_baseline_anchor"
    if baseline:
        if max_targets < 2:
            reason = "no_supplement_budget"
        elif len(scores) < 2:
            reason = "insufficient_prototypes"
        elif winner in baseline:
            reason = "winner_already_selected"
        elif first < floor or first <= 0:
            reason = "weak_prototype_score"
        elif absolute_gap <= 0 or absolute_gap < absolute_floor:
            reason = "weak_absolute_gap"
        elif relative_gap < relative_floor:
            reason = "weak_relative_gap"
        elif not set(baseline).issubset({kb_id for kb_id, _ in scores}):
            # Rebuilds migrate one KB at a time. An absent content signal must
            # not count as evidence against an existing summary candidate.
            reason = "baseline_prototypes_incomplete"
        else:
            if len(targets) >= max_targets:
                targets[-1] = winner
            else:
                targets.append(winner)
            reason = "dominant_content_prototype"

    return PrototypeRouteSelection(
        targets=targets,
        details={
            "policy": "conservative_content_prototype_v1",
            "reason": reason,
            "max_targets": max_targets,
            "min_score": floor,
            "min_absolute_gap": absolute_floor,
            "min_relative_gap": relative_floor,
            "baseline_targets": baseline,
            "winner_kb_id": winner,
            "winner_score": first,
            "runner_up_score": second,
            "absolute_gap": absolute_gap,
            "relative_gap": relative_gap,
            "inserted_kb_ids": [kb_id for kb_id in targets if kb_id not in baseline],
            "evicted_kb_ids": [kb_id for kb_id in baseline if kb_id not in targets],
        },
    )
