"""Deterministic IR metrics and RAGAS-style generation score aggregation."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from statistics import fmean
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .schema import (
    EvalCase,
    EvalDataset,
    EvidenceContext,
    Prediction,
    normalize_document_id,
)


def _qrel_map(case: EvalCase) -> Dict[str, int]:
    return {
        normalize_document_id(item.document_id): item.relevance for item in case.qrels
    }


def _ranked_relevances(
    case: EvalCase,
    contexts: Sequence[EvidenceContext],
    k: Optional[int] = None,
) -> List[int]:
    qrels = _qrel_map(case)
    seen: set[str] = set()
    values: List[int] = []
    selected = contexts if k is None else contexts[:k]
    for context in selected:
        document_id = normalize_document_id(context.document_id)
        relevance = qrels.get(document_id, 0)
        if relevance and document_id in seen:
            relevance = 0
        if relevance:
            seen.add(document_id)
        values.append(relevance)
    return values


def recall_at_k(case: EvalCase, contexts: Sequence[EvidenceContext], k: int) -> float:
    """Fraction of distinct qrel documents retrieved in the first ``k`` ranks."""
    qrels = _qrel_map(case)
    hits = sum(1 for value in _ranked_relevances(case, contexts, k) if value > 0)
    return hits / len(qrels)


def _dcg(relevances: Iterable[int]) -> float:
    return sum(
        (2**relevance - 1) / math.log2(rank + 2)
        for rank, relevance in enumerate(relevances)
    )


def ndcg_at_k(case: EvalCase, contexts: Sequence[EvidenceContext], k: int) -> float:
    """Graded nDCG using qrel levels 1–3 and zero gain for duplicate documents."""
    actual = _ranked_relevances(case, contexts, k)
    ideal = sorted((item.relevance for item in case.qrels), reverse=True)[:k]
    ideal_dcg = _dcg(ideal)
    return _dcg(actual) / ideal_dcg if ideal_dcg else 0.0


def mrr_at_k(case: EvalCase, contexts: Sequence[EvidenceContext], k: int) -> float:
    """Reciprocal rank of the first relevant document within the first ``k`` ranks."""
    for rank, relevance in enumerate(_ranked_relevances(case, contexts, k), start=1):
        if relevance > 0:
            return 1.0 / rank
    return 0.0


def context_precision(relevance: Sequence[bool]) -> float:
    """RAGAS-style context precision: mean precision at each relevant rank."""
    relevant_count = 0
    precision_sum = 0.0
    for rank, is_relevant in enumerate(relevance, start=1):
        if is_relevant:
            relevant_count += 1
            precision_sum += relevant_count / rank
    return precision_sum / relevant_count if relevant_count else 0.0


def faithfulness(prediction: Prediction) -> Optional[float]:
    """Fraction of answer claims judged to be supported by supplied context."""
    judgment = prediction.generation_judgment
    if judgment is None:
        return None
    if not judgment.claims:
        return 0.0
    return sum(1 for claim in judgment.claims if claim.supported) / len(judgment.claims)


def answer_relevance(prediction: Prediction) -> Optional[float]:
    judgment = prediction.generation_judgment
    return judgment.answer_relevance if judgment is not None else None


def context_precision_for(case: EvalCase, prediction: Prediction) -> Tuple[float, str]:
    contexts = prediction.generation_contexts or prediction.retrieved_contexts
    judgment = prediction.generation_judgment
    if judgment is not None:
        return context_precision(judgment.context_relevance), "judge"
    labels = [value > 0 for value in _ranked_relevances(case, contexts)]
    return context_precision(labels), "qrels"


def _round(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(float(value), 6)


def _aggregate(values: Iterable[Optional[float]], total_cases: int) -> Dict[str, Any]:
    present = [float(value) for value in values if value is not None]
    return {
        "value": _round(fmean(present)) if present else None,
        "evaluated_cases": len(present),
        "total_cases": total_cases,
    }


def score_dataset(
    dataset: EvalDataset,
    predictions: Mapping[str, Prediction],
    *,
    ks: Sequence[int] = (1, 3, 5),
    run_metadata: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Score one complete prediction set and return a stable JSON report."""
    normalized_ks = tuple(sorted(set(int(k) for k in ks)))
    if not normalized_ks or any(k <= 0 for k in normalized_ks):
        raise ValueError("ks must contain positive integers")
    expected = {case.case_id for case in dataset.cases}
    actual = set(predictions)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        details = []
        if missing:
            details.append(f"missing={missing}")
        if extra:
            details.append(f"extra={extra}")
        raise ValueError("prediction ids do not match dataset: " + ", ".join(details))

    per_case: Dict[str, Any] = {}
    aggregate_values: Dict[str, List[Optional[float]]] = {}
    context_precision_sources: Dict[str, int] = {}
    for case in dataset.cases:
        prediction = predictions[case.case_id]
        retrieval: Dict[str, float] = {}
        for k in normalized_ks:
            retrieval[f"recall@{k}"] = recall_at_k(case, prediction.retrieved_contexts, k)
            retrieval[f"ndcg@{k}"] = ndcg_at_k(case, prediction.retrieved_contexts, k)
            retrieval[f"mrr@{k}"] = mrr_at_k(case, prediction.retrieved_contexts, k)
        faithfulness_value = faithfulness(prediction)
        answer_relevance_value = answer_relevance(prediction)
        context_precision_value, precision_source = context_precision_for(case, prediction)
        context_precision_sources[precision_source] = (
            context_precision_sources.get(precision_source, 0) + 1
        )
        generation = {
            "faithfulness": faithfulness_value,
            "answer_relevance": answer_relevance_value,
            "context_precision": context_precision_value,
            "context_precision_source": precision_source,
        }
        per_case[case.case_id] = {
            "tags": list(case.tags),
            "retrieval": {key: _round(value) for key, value in retrieval.items()},
            "generation": {
                key: (_round(value) if isinstance(value, float) else value)
                for key, value in generation.items()
            },
            "retrieved_context_count": len(prediction.retrieved_contexts),
            "generation_context_count": len(
                prediction.generation_contexts or prediction.retrieved_contexts
            ),
        }
        for key, value in retrieval.items():
            aggregate_values.setdefault(key, []).append(value)
        aggregate_values.setdefault("faithfulness", []).append(faithfulness_value)
        aggregate_values.setdefault("answer_relevance", []).append(answer_relevance_value)
        aggregate_values.setdefault("context_precision", []).append(context_precision_value)

    total_cases = len(dataset.cases)
    retrieval_metrics = {
        key: _aggregate(aggregate_values[key], total_cases)
        for k in normalized_ks
        for key in (f"recall@{k}", f"ndcg@{k}", f"mrr@{k}")
    }
    generation_metrics = {
        key: _aggregate(aggregate_values[key], total_cases)
        for key in ("faithfulness", "answer_relevance", "context_precision")
    }
    return {
        "schema_version": "1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "name": dataset.name,
            "version": dataset.version,
            "fingerprint": dataset.fingerprint,
            "cases": total_cases,
        },
        "configuration": {
            "ks": list(normalized_ks),
            **(dict(run_metadata) if run_metadata else {}),
        },
        "aggregate": {
            "retrieval": retrieval_metrics,
            "generation": generation_metrics,
        },
        "context_precision_sources": context_precision_sources,
        "cases": per_case,
    }
