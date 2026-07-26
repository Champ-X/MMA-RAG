import json
import math
from pathlib import Path
from types import SimpleNamespace

import pytest

from evaluation.cli import compare_reports
from evaluation.judge import _extract_json_object
from evaluation.live import (
    LiveEvaluationError,
    ensure_isolated_target,
    judge_predictions,
)
from evaluation.metrics import (
    context_precision,
    mrr_at_k,
    ndcg_at_k,
    recall_at_k,
    score_dataset,
)
from evaluation.schema import (
    ClaimJudgment,
    EvalCase,
    EvalDataset,
    EvidenceContext,
    GenerationJudgment,
    Prediction,
    Qrel,
    normalize_document_id,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DATASET_PATH = REPO_ROOT / "evals" / "baseline_v1" / "manifest.json"


def _case() -> EvalCase:
    return EvalCase(
        case_id="metric-case",
        question="question",
        reference_answer="answer",
        qrels=(Qrel("a.md", 3), Qrel("b.md", 1)),
    )


def _context(document_id: str) -> EvidenceContext:
    return EvidenceContext(document_id=document_id, content=f"content for {document_id}")


def test_baseline_dataset_is_versioned_and_hash_validated():
    dataset = EvalDataset.load(DATASET_PATH)

    assert dataset.name == "tessmora-rag-baseline"
    assert dataset.version == "1.0.0"
    assert len(dataset.documents) == 7
    assert len(dataset.cases) == 8
    assert len(dataset.fingerprint) == 64
    assert {case.case_id for case in dataset.cases} == {
        "eval-001-rollback",
        "eval-002-canary",
        "eval-003-p1",
        "eval-004-backup",
        "eval-005-access",
        "eval-006-limits",
        "eval-007-p1-release",
        "eval-008-boundary",
    }


def test_document_id_normalization_removes_ingestion_uuid_prefix():
    assert normalize_document_id(
        "documents/35ac5e55-04d1-410a-81ef-c6965a47c270_ops-rollback.md"
    ) == "ops-rollback.md"
    assert normalize_document_id("OPS-ROLLBACK.md") == "ops-rollback.md"


def test_retrieval_metrics_use_graded_qrels_and_first_distinct_hit():
    case = _case()
    contexts = (
        _context("noise.md"),
        _context("b.md"),
        _context("a.md"),
        _context("a.md"),
    )

    assert recall_at_k(case, contexts, 1) == 0.0
    assert recall_at_k(case, contexts, 2) == 0.5
    assert recall_at_k(case, contexts, 3) == 1.0
    assert mrr_at_k(case, contexts, 3) == 0.5

    actual_dcg = 1 / math.log2(3) + 7 / math.log2(4)
    ideal_dcg = 7 / math.log2(2) + 1 / math.log2(3)
    assert ndcg_at_k(case, contexts, 3) == pytest.approx(actual_dcg / ideal_dcg)

    duplicate_first = (_context("a.md"), _context("a.md"), _context("b.md"))
    assert recall_at_k(case, duplicate_first, 2) == 0.5
    assert ndcg_at_k(case, duplicate_first, 2) == pytest.approx(7 / ideal_dcg)


def test_context_precision_is_mean_precision_at_relevant_ranks():
    assert context_precision((False, True, True)) == pytest.approx(
        ((1 / 2) + (2 / 3)) / 2
    )
    assert context_precision((False, False)) == 0.0


@pytest.mark.asyncio
async def test_dense_only_ingestion_still_uses_named_vector_contract():
    from app.modules.ingestion.storage.vector_store import VectorStore

    captured = {}

    class FakeQdrantClient:
        def upsert(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(operation_id=17)

    vector_store = object.__new__(VectorStore)
    vector_store.client = FakeQdrantClient()

    result = await vector_store.upsert_text_chunks(
        "eval-kb",
        [
            {
                "text": "dense fallback",
                "vector": [0.1, 0.2],
                "file_id": "file-1",
                "file_path": "fallback.md",
                "file_type": "md",
            }
        ],
    )

    assert result["points_inserted"] == 1
    assert captured["points"][0].vector == {"dense": [0.1, 0.2]}


def test_score_dataset_aggregates_all_six_metric_families():
    dataset = EvalDataset.load(DATASET_PATH)
    predictions = {}
    for case in dataset.cases:
        contexts = tuple(_context(qrel.document_id) for qrel in case.qrels)
        predictions[case.case_id] = Prediction(
            case_id=case.case_id,
            answer="synthetic answer",
            retrieved_contexts=contexts,
            generation_contexts=contexts,
            generation_judgment=GenerationJudgment(
                claims=(
                    ClaimJudgment("supported", True),
                    ClaimJudgment("unsupported", False),
                ),
                answer_relevance=0.75,
                context_relevance=tuple(True for _ in contexts),
            ),
        )

    report = score_dataset(dataset, predictions, ks=(1, 3, 5))

    assert report["aggregate"]["retrieval"]["recall@5"]["value"] == 1.0
    assert report["aggregate"]["retrieval"]["ndcg@5"]["value"] == 1.0
    assert report["aggregate"]["retrieval"]["mrr@5"]["value"] == 1.0
    assert report["aggregate"]["generation"]["faithfulness"]["value"] == 0.5
    assert report["aggregate"]["generation"]["answer_relevance"]["value"] == 0.75
    assert report["aggregate"]["generation"]["context_precision"]["value"] == 1.0
    assert report["context_precision_sources"] == {"judge": 8}


def test_score_without_judge_reports_missing_semantic_metrics_not_fake_zeros():
    dataset = EvalDataset.load(DATASET_PATH)
    predictions = {
        case.case_id: Prediction(
            case_id=case.case_id,
            answer="",
            retrieved_contexts=tuple(_context(qrel.document_id) for qrel in case.qrels),
        )
        for case in dataset.cases
    }

    report = score_dataset(dataset, predictions)

    faithfulness = report["aggregate"]["generation"]["faithfulness"]
    relevance = report["aggregate"]["generation"]["answer_relevance"]
    assert faithfulness == {"value": None, "evaluated_cases": 0, "total_cases": 8}
    assert relevance == {"value": None, "evaluated_cases": 0, "total_cases": 8}
    assert report["aggregate"]["generation"]["context_precision"]["value"] == 1.0
    assert report["context_precision_sources"] == {"qrels": 8}


def test_score_requires_exactly_one_prediction_per_case():
    dataset = EvalDataset.load(DATASET_PATH)

    with pytest.raises(ValueError, match="missing="):
        score_dataset(dataset, {})


def test_live_target_requires_explicit_evaluation_marker_or_read_only_opt_in():
    assert ensure_isolated_target(
        {"evaluation_mode": True}, kb_id=None, allow_shared_read_only=False
    )
    assert not ensure_isolated_target(
        {"evaluation_mode": False},
        kb_id="existing-eval-kb",
        allow_shared_read_only=True,
    )
    with pytest.raises(LiveEvaluationError, match="not marked evaluation_mode"):
        ensure_isolated_target(
            {"evaluation_mode": False}, kb_id=None, allow_shared_read_only=False
        )


def test_judge_json_parser_accepts_fenced_json_only_for_compatibility():
    parsed = _extract_json_object(
        """```json
        {"claims": [], "answer_relevance": 0.5, "context_relevance": [true]}
        ```"""
    )

    assert parsed["answer_relevance"] == 0.5
    assert parsed["context_relevance"] == [True]


def test_saved_answers_can_be_rejudged_without_rerunning_retrieval():
    dataset = EvalDataset.load(DATASET_PATH)
    predictions = {
        case.case_id: Prediction(
            case_id=case.case_id,
            answer="saved answer",
            retrieved_contexts=tuple(_context(qrel.document_id) for qrel in case.qrels),
            metadata={"run": {"judge": {"model": "floating-alias"}}},
        )
        for case in dataset.cases
    }

    class FakeJudge:
        metadata = {
            "backend": "fake",
            "model": "fixed-version",
            "prompt_version": "test-v1",
        }

        def judge(self, *, case, answer, contexts):
            assert answer == "saved answer"
            return GenerationJudgment(
                claims=(ClaimJudgment(case.case_id, True),),
                answer_relevance=1.0,
                context_relevance=tuple(True for _ in contexts),
            )

    judged = judge_predictions(
        dataset=dataset,
        predictions=predictions,
        judge=FakeJudge(),
        progress=lambda _: None,
    )

    assert len(judged) == 8
    assert judged[0].generation_judgment is not None
    assert judged[0].metadata["run"]["judge"]["model"] == "fixed-version"
    assert predictions[judged[0].case_id].generation_judgment is None


def test_report_compare_detects_regression_and_rejects_other_dataset():
    baseline = {
        "dataset": {"fingerprint": "same"},
        "aggregate": {
            "retrieval": {"recall@5": {"value": 0.9}},
            "generation": {"faithfulness": {"value": 0.8}},
        },
    }
    candidate = {
        "dataset": {"fingerprint": "same"},
        "aggregate": {
            "retrieval": {"recall@5": {"value": 0.85}},
            "generation": {"faithfulness": {"value": 0.79}},
        },
    }

    result, passed = compare_reports(baseline, candidate, max_regression=0.03)

    assert not passed
    assert result["metrics"]["retrieval.recall@5"]["status"] == "regression"
    assert result["metrics"]["generation.faithfulness"]["status"] == "pass"

    other = json.loads(json.dumps(candidate))
    other["dataset"]["fingerprint"] = "different"
    with pytest.raises(ValueError, match="different dataset fingerprints"):
        compare_reports(baseline, other, max_regression=0.03)

    configured_baseline = json.loads(json.dumps(baseline))
    configured_candidate = json.loads(json.dumps(candidate))
    configured_baseline["configuration"] = {
        "judge": {"model": "fixed-v1"},
        "agent_mode": "direct",
    }
    configured_candidate["configuration"] = {
        "judge": {"model": "floating-alias"},
        "agent_mode": "direct",
    }
    with pytest.raises(ValueError, match=r"configuration\.judge"):
        compare_reports(
            configured_baseline, configured_candidate, max_regression=0.03
        )
