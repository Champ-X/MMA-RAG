"""Public citation score contract: absent measurements are never zero-filled."""

from math import isfinite
from typing import Any, Dict, Optional


SCORE_KEYS = ("dense", "sparse", "visual", "rerank", "final")


def finite_score(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if isfinite(value) else None


def merge_retrieval_scores(*measurements: Dict[str, Any]) -> Dict[str, float]:
    """Retain each channel's best observed score across duplicate evidence."""
    merged: Dict[str, float] = {}
    for mapping in measurements:
        for channel, value in (mapping or {}).items():
            measured = finite_score(value)
            if measured is not None and (channel not in merged or measured > merged[channel]):
                merged[channel] = measured
    return merged


def result_score_metadata(result: Dict[str, Any]) -> Dict[str, Any]:
    """Keep raw channel measurements separate from fusion/ranking weights."""
    retrieval_scores = result.get("retrieval_scores") or {}
    scores = {key: finite_score(retrieval_scores.get(key)) for key in SCORE_KEYS[:3]}
    scores["rerank"] = finite_score(
        result.get("rerank_score", result.get("cross_encoder_score"))
    )
    scores["final"] = finite_score(result.get("final_score"))
    return {"score_version": 2, "scores": scores}


def citation_score_fields(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize both serializers, including references made by legacy callers."""
    if metadata.get("score_version") == 2:
        stored = metadata.get("scores") or {}
        scores = {key: finite_score(stored.get(key)) for key in SCORE_KEYS}
    else:
        # The old scalar was a composite score, despite being called rerank in
        # the public payload. Its missing channel measurements cannot be rebuilt.
        scores = {key: None for key in SCORE_KEYS}
        scores["final"] = finite_score(metadata.get("score"))
    return {"score_version": 2, "scores": scores}
