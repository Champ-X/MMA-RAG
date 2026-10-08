import hashlib
import json
from copy import deepcopy

import pytest

from evaluation.retrieval_schema import create_dataset, digest, RetrievalDataset
from evaluation.retrieval_metrics import score_run, compare_runs
from evaluation.retrieval_runner import BM25Retriever, RunLedger, run_retrieval
from evaluation.schema import EvaluationDataError


@pytest.fixture
def dataset(tmp_path):
    body = "The alert threshold is 2%. Rollback takes 10 minutes. The cafeteria opens at noon."
    source = {"id": "ops", "text": body, "text_sha256": hashlib.sha256(body.encode()).hexdigest(), "modality": "doc", "metadata": {"kb_id": "kb-a"},
              "units": [{"id": "threshold", "text": "The alert threshold is 2%."}, {"id": "rollback", "text": "Rollback takes 10 minutes."},
                        {"id": "unrelated", "text": "The cafeteria opens at noon."}]}
    anchors = [{"source_id": "ops", "source_sha256": source["text_sha256"], "quote": quote} for quote in ("threshold is 2%", "10 minutes")]
    case = {"id": "q1", "query": "What threshold triggers action and how long does rollback take?", "split": "test", "cluster_id": "ops-topic",
            "tags": ["doc", "multi_evidence"], "answerability": "answerable", "qrels": {"ops": 3}, "qrels_complete": True,
            "scope": {"kb_ids": ["kb-a"]}, "annotation": {"origin": "test fixture"},
            "evidence_groups": [{"id": "trigger", "alternatives": [[anchors[0]]]}, {"id": "duration", "alternatives": [[anchors[1]]]}]}
    no_answer = {**case, "id": "q2", "query": "Which country hosts the service?", "cluster_id": "no-answer", "tags": ["no_answer"],
                 "answerability": "unanswerable", "qrels": {}, "evidence_groups": []}
    return create_dataset(tmp_path / "dataset", name="fixture", sources=[source], cases=[case, no_answer], provenance={"origin": "synthetic test"})


def records(dataset, ids=("threshold", "rollback")):
    source = dataset.sources["ops"]
    config = {"profile": "test", "model_stack": {"embedding": "fixed"}}
    hits = [{"id": u["id"], "source_id": "ops", "source_sha256": source["text_sha256"], "content": u["text"], "modality": "doc", "kb_id": "kb-a"}
            for u in source["units"] if u["id"] in ids]
    return [{"case_id": c["id"], "dataset_fingerprint": dataset.fingerprint, "configuration": config, "configuration_fingerprint": digest(config),
             "status": "success", "hits": hits if c["id"] == "q1" else [], "duration_seconds": .1} for c in dataset.cases]


def test_correct_document_wrong_passage_is_not_complete_evidence(dataset):
    report = score_run(dataset, records(dataset, ("unrelated",)))
    values = report["cases"]["q1"]["metrics"]
    assert values["document_recall@5"] == 1
    assert values["evidence_group_recall@5"] == 0
    assert values["all_evidence_groups_hit@5"] == 0


def test_groups_require_all_facts_and_no_answer_has_no_fake_recall(dataset):
    one = score_run(dataset, records(dataset, ("threshold",)))
    both = score_run(dataset, records(dataset))
    assert one["cases"]["q1"]["metrics"]["evidence_group_recall@5"] == .5
    assert both["cases"]["q1"]["metrics"]["all_evidence_groups_hit@5"] == 1
    assert both["cases"]["q2"]["metrics"]["document_recall@5"] is None
    assert both["aggregate"]["metrics"]["document_recall@5"]["evaluated_cases"] == 1


def test_failure_counts_as_failed_answerable_task_and_not_successful_abstention(dataset):
    rows = records(dataset)
    for row in rows:
        row.update(status="timeout", error={"category": "TimeoutError"}, hits=[])
    report = score_run(dataset, rows)
    assert report["aggregate"]["metrics"]["failure_rate"]["value"] == 1
    assert report["aggregate"]["metrics"]["document_recall@5"]["value"] == 0
    assert report["cases"]["q2"]["metrics"]["no_answer_empty_success_rate"] == 0


def test_missing_records_unknown_source_and_changed_content_are_rejected(dataset):
    rows = records(dataset)
    with pytest.raises(EvaluationDataError, match="coverage"):
        score_run(dataset, rows[:1])
    rows[0]["hits"][0]["source_id"] = "unknown"
    with pytest.raises(EvaluationDataError, match="absent"):
        score_run(dataset, rows)
    rows = records(dataset)
    rows[0]["hits"][0]["content"] = "The threshold is 25%."
    with pytest.raises(EvaluationDataError, match="not in frozen"):
        score_run(dataset, rows)


def test_scope_violation_is_detected_and_gets_no_evidence_credit(dataset):
    case = dataset.cases[0]
    case["scope"] = {"kb_ids": ["kb-b"]}
    report = score_run(dataset, records(dataset))
    assert report["cases"]["q1"]["metrics"]["scope_violation_rate"] == 1
    assert report["cases"]["q1"]["metrics"]["evidence_group_recall@5"] == 0


def test_paired_comparison_rejects_coverage_and_undeclared_changes(dataset):
    baseline = score_run(dataset, records(dataset, ("unrelated",)))
    candidate = score_run(dataset, records(dataset))
    comparison = compare_runs(baseline, candidate, bootstrap_samples=100)
    assert comparison["metrics"]["evidence_group_recall@5"]["delta"] == 1
    assert comparison["metrics"]["evidence_group_recall@5"]["ci95"] == [1, 1]
    candidate["configuration"]["profile"] = "other"
    candidate["configuration_fingerprint"] = digest(candidate["configuration"])
    with pytest.raises(EvaluationDataError, match="undeclared"):
        compare_runs(baseline, candidate)
    compare_runs(baseline, candidate, allowed_changes=("profile",), bootstrap_samples=100)
    candidate["cases"]["q1"]["metrics"]["evidence_group_recall@5"] = None
    with pytest.raises(EvaluationDataError, match="coverage changed"):
        compare_runs(baseline, candidate, allowed_changes=("profile",), bootstrap_samples=100)


def test_dataset_hash_and_nonexistent_quote_validation(dataset, tmp_path):
    path = dataset.manifest_path.parent / "cases.jsonl"
    path.write_text(path.read_text() + "\n")
    with pytest.raises(EvaluationDataError, match="SHA-256"):
        RetrievalDataset.load(dataset.manifest_path)
    cases = deepcopy(list(dataset.cases))
    cases[0]["evidence_groups"][0]["alternatives"][0][0]["quote"] = "absent invented evidence"
    with pytest.raises(EvaluationDataError, match="quote missing"):
        create_dataset(tmp_path / "bad", name="bad", sources=list(dataset.sources.values()), cases=cases, provenance={})


@pytest.mark.asyncio
async def test_append_only_run_resume_does_not_repeat_calls(dataset, tmp_path):
    backend = BM25Retriever(dataset)
    output = tmp_path / "run"
    report = await run_retrieval(dataset, backend, output, progress=lambda _: None)
    assert report["aggregate"]["total_cases"] == 2
    before = (output / "predictions.jsonl").read_bytes()
    async def forbidden(*args):
        raise AssertionError("completed requests must never repeat")
    backend.search = forbidden
    await run_retrieval(dataset, backend, output, progress=lambda _: None)
    assert (output / "predictions.jsonl").read_bytes() == before


def test_live_run_lock_and_changed_protocol_are_rejected(tmp_path):
    path = tmp_path / "run"
    ledger = RunLedger(path, {"protocol": 1})
    try:
        with pytest.raises(ValueError, match="live process"):
            RunLedger(path, {"protocol": 1})
    finally:
        ledger.close()
    with pytest.raises(EvaluationDataError, match="protocol changed"):
        RunLedger(path, {"protocol": 2})


@pytest.mark.parametrize("field,value", [("content", ""), ("score", float("nan")), ("page", 99), ("start_seconds", 12)])
def test_forged_or_nonfinite_evidence_is_rejected(dataset, field, value):
    rows = records(dataset)
    rows[0]["hits"][0][field] = value
    with pytest.raises(EvaluationDataError):
        score_run(dataset, rows)


def test_quote_and_temporal_locator_must_be_in_same_observation():
    from evaluation.retrieval_metrics import anchor_hit
    anchor = {"source_id": "v", "source_sha256": "frozen", "quote": "answer", "start_seconds": 10, "end_seconds": 20}
    hits = [dict(source_id="v", source_sha256="frozen", content="answer", start_seconds=0, end_seconds=5),
            dict(source_id="v", source_sha256="frozen", content="unrelated", start_seconds=10, end_seconds=20)]
    assert not anchor_hit(anchor, hits)


def test_duplicate_evidence_and_unknown_usage_are_visible(dataset):
    rows = records(dataset)
    rows[0]["hits"].append(deepcopy(rows[0]["hits"][0]))
    with pytest.raises(EvaluationDataError, match="duplicate evidence"):
        score_run(dataset, rows)
    rows = records(dataset)
    for row in rows:
        row["usage"] = {"known_tokens": 0, "unknown_usage_calls": 0, "unreported_task_usage": True}
    assert score_run(dataset, rows)["usage"]["unreported_tasks"] == 2


@pytest.mark.asyncio
async def test_concurrent_paid_attempt_failures_preserve_partial_observations(dataset, tmp_path):
    from evaluation.retrieval_runner import RetrievalAttemptError
    backend = BM25Retriever(dataset)
    async def failed(case, top_k):
        raise RetrievalAttemptError("provider_timeout", {"hits": records(dataset)[0]["hits"], "usage": {"known_tokens": 17}})
    backend.search = failed
    report = await run_retrieval(dataset, backend, tmp_path / "concurrent", concurrency=2, progress=lambda _: None)
    assert report["aggregate"]["metrics"]["failure_rate"]["value"] == 1
    assert report["aggregate"]["metrics"]["evidence_group_recall@5"]["value"] == 0
    assert report["usage"]["known_tokens"] == 34
    rows = [json.loads(line) for line in (tmp_path / "concurrent/predictions.jsonl").read_text().splitlines()]
    assert all(row["hits"] and row["error"]["category"] == "provider_timeout" for row in rows)


@pytest.mark.asyncio
async def test_embedding_cache_reuses_paid_receipt_and_rejects_corruption(tmp_path):
    import numpy as np
    from types import SimpleNamespace
    from evaluation.retrieval_models import _embed_batch
    class Calls:
        stack = {"embedding": {"model": "fixed"}}
        models = {"embedding": "fixed"}
        count = 0
        async def invoke(self, method, **kwargs):
            self.count += 1
            return SimpleNamespace(success=True, data=[[1, 2], [3, 4]]), {"success": True, "error_category": None, "duration_seconds": .1, "usage": {"known_tokens": 4, "unknown_usage_calls": 0}}
    calls = Calls()
    first, receipt = await _embed_batch(calls, ["one", "two"], tmp_path)
    cached, _ = await _embed_batch(calls, ["one", "two"], tmp_path)
    assert calls.count == 1 and np.array_equal(first, cached)
    next(tmp_path.glob("*.npy")).write_bytes(b"damaged")
    with pytest.raises(EvaluationDataError, match="checksum"):
        await _embed_batch(calls, ["one", "two"], tmp_path)
    assert calls.count == 1


@pytest.mark.asyncio
async def test_embedding_observer_rejects_reordered_indices_without_recording_bodies():
    import httpx
    from evaluation.retrieval_models import ModelCalls, _observations
    receipts = []
    token = _observations.set(receipts)
    try:
        response = httpx.Response(200, request=httpx.Request("POST", "https://example.invalid/v1/embeddings", headers={"Authorization": "private"}),
                                  json={"data": [{"index": 1}, {"index": 0}], "usage": {"total_tokens": 5}, "secret": "private-body"})
        await ModelCalls._observe(response)
    finally:
        _observations.reset(token)
    assert receipts[0]["contract_error"] == "embedding_index_order"
    assert receipts[0]["usage"]["total_tokens"] == 5
    assert "private" not in json.dumps(receipts)


def test_frozen_point_identity_resolves_pdf_image_parent_alias_without_qrels():
    from types import SimpleNamespace
    from evaluation.source_resolution import FrozenEvidenceResolver
    source = {"id": "figure", "modality": "image", "text_sha256": "frozen", "metadata": {"kb_id": "kb", "file_id": "image-file"},
              "units": [{"id": "image:point", "original_point_id": "point", "text": "actual figure content", "start_char": 0,
                         "end_char": 21, "renderings": {"pi_gateway_v1": "索引画面描述：actual figure content"}}]}
    # Only sources are exposed: the resolver cannot inspect relevance labels.
    resolver = FrozenEvidenceResolver(SimpleNamespace(sources={"figure": source}))
    raw = {"id": "point", "modality": "image", "score": 0, "content": "索引画面描述：actual figure content",
           "source": {"file_id": "parent-pdf"}}
    hit = resolver.resolve(raw, canonical_kb_id="kb")
    assert hit["source_id"] == "figure" and hit["native_source_file_alias"] == "parent-pdf"
    with pytest.raises(EvaluationDataError):
        resolver.resolve(raw, canonical_kb_id="different-kb")
    with pytest.raises(EvaluationDataError):
        resolver.resolve({**raw, "content": "invented figure description"}, canonical_kb_id="kb")
