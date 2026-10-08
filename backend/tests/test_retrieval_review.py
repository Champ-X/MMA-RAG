"""Offline review must not turn unknown evidence or failed delivery into wins."""
import hashlib
import json
from copy import deepcopy

import pytest

from evaluation.retrieval_cli import main
from evaluation.retrieval_metrics import score_run
from evaluation.retrieval_review import comparison_readiness, replay_labels, revise_labels, sha, write_json
from evaluation.retrieval_schema import create_dataset, digest, read_jsonl, write_jsonl
from evaluation.retrieval_stages import audit_pi_stages, load_native_receipts
from evaluation.schema import EvaluationDataError
from evaluation.source_resolution import resolve_pi_evidence


REVIEWER = {"identity": "fixture reviewer", "method": "source review", "reviewed_at": "2026-10-08", "blind": False}


@pytest.fixture
def sample(tmp_path):
    def source(sid, modality, texts):
        body = "\n".join(texts)
        offset, units = 0, []
        for i, value in enumerate(texts):
            units.append({"id": f"{sid}-{i}", "original_point_id": f"{sid}-{i}", "text": value,
                          "start_char": offset, "end_char": offset + len(value)})
            offset += len(value) + 1
        return {"id": sid, "text": body, "text_sha256": hashlib.sha256(body.encode()).hexdigest(),
                "metadata": {"kb_id": "kb", "file_id": sid}, "modality": modality, "units": units}

    sources = [source("ops", "doc", ["The alert threshold is 2%.", "Rollback takes 10 minutes.",
               "The alarm limit is two percent and starts rollback.", "The cafeteria opens at noon."]),
               source("poster", "image", ["Several tall industrial chimneys."]),
               source("indoor", "image", ["An indoor group photograph."])]

    def anchor(sid, quote):
        s = next(s for s in sources if s["id"] == sid)
        return {"source_id": sid, "source_sha256": s["text_sha256"], "quote": quote}

    common = {"split": "test", "tags": ["fixture"], "answerability": "answerable", "qrels_complete": False,
              "scope": {"kb_ids": ["kb"]}, "annotation": {"origin": "synthetic regression"}}
    cases = [{**common, "id": "q1", "query": "What alert threshold and rollback duration?", "cluster_id": "ops",
              "qrels": {"ops": 3}, "evidence_groups": [
                  {"id": "trigger", "alternatives": [[anchor("ops", "threshold is 2%")]]},
                  {"id": "duration", "alternatives": [[anchor("ops", "10 minutes")]]}]},
             {**common, "id": "q2", "query": "Find a poster with industrial chimneys.", "cluster_id": "poster",
              "qrels": {"poster": 3}, "evidence_groups": [
                  {"id": "image", "alternatives": [[anchor("poster", "tall industrial chimneys")]]}]},
             {**common, "id": "q3", "query": "Where is the service hosted?", "cluster_id": "missing",
              "answerability": "unanswerable", "qrels_complete": True, "qrels": {}, "evidence_groups": []}]
    ds = create_dataset(tmp_path / "dataset", name="review-fixture", sources=sources, cases=cases, provenance={})

    def observation(number, sid, unit=0, media=False):
        s = ds.sources[sid]
        return {"id": number, "source": "knowledge", "source_id": "src_" + hashlib.sha256(f"kb\0{sid}".encode()).hexdigest()[:24],
                "modality": s["modality"], "observation": "media_observation" if media else "text",
                "content": s["units"][unit]["text"], "locator": {"point_id": s["units"][unit]["original_point_id"]},
                "provenance": {"kb_id": "kb", "file_id": sid,
                               "source_version": hashlib.md5(b"original asset").hexdigest()}}

    def payload(case, evidence, answer, status="completed"):
        rid = "run-" + case["id"]
        return {"run": {"id": rid, "status": status, "request": {"message": case["query"]},
                        "state": {"answer": answer, "citations": [
                            {"id": e["id"], "source_id": e["source_id"], "content": e["content"], "pi_run_id": rid} for e in evidence]}},
                "evidence": evidence}

    native = {"q1": payload(cases[0], [observation(1, "ops"), observation(2, "ops", 1)], "Duration [2]; threshold [1]."),
              "q2": payload(cases[1], [observation(1, "poster", media=True)], "The poster [1]."),
              "q3": payload(cases[2], [], "No supporting information found.")}
    return ds, native, observation, payload


def records(ds, native, profile="pi"):
    configuration = {"profile": profile, "top_k": 50}
    result = []
    for cid, value in native.items():
        row = {"case_id": cid, "dataset_fingerprint": ds.fingerprint, "configuration": configuration,
               "configuration_fingerprint": digest(configuration), "status": "success", "duration_seconds": .1,
               "hits": resolve_pi_evidence(ds, value["evidence"])[0],
               "diagnostics": {"run_id": value["run"]["id"], "native_status": value["run"]["status"]}}
        if value["run"]["status"] == "cancelled":
            row.update(status="timeout", error={"category": "deadline_cancelled"})
        result.append(row)
    return result


def amendment(ds):
    anchor = ds.cases[0]["evidence_groups"][0]["alternatives"][0][0]
    return {"schema_version": "retrieval-label-review-1", "parent_fingerprint": ds.fingerprint, "reviewer": REVIEWER,
            "rationale": "Accept independently source-bound equivalent passages for every mode.", "changes": [
                {"case_id": "q1", "group_id": "trigger", "reason": "The alternate sentence states the same threshold and action.",
                 "add_alternatives": [[{**anchor, "quote": "limit is two percent"}, {**anchor, "quote": "starts rollback"}]]}]}


def media_review(ds, native, root, *, sid="poster", verdict="supports"):
    (root / "asset.bin").write_bytes(b"original asset")
    item = native["q2"]["evidence"][0]
    version = item["provenance"]["source_version"]
    checksum = sha(root / "asset.bin")
    return {"schema_version": "retrieval-media-review-1", "dataset_fingerprint": ds.fingerprint, "reviewer": REVIEWER,
            "observations": [{"case_id": "q2", "evidence_id": item["id"], "native_receipt_sha256": digest(native["q2"]),
                "observation_sha256": digest(item), "source_id": sid, "asset_path": "asset.bin", "asset_sha256": checksum,
                "source_version": version, "asset_receipt": {"native_source_id": item["source_id"], "source_version": version, "sha256": checksum},
                "anchor_sha256": digest(ds.cases[1]["evidence_groups"][0]["alternatives"][0][0]), "verdict": verdict,
                "reason": "Synthetic asset verification fixture; credit only this anchor."}]}


@pytest.mark.parametrize("profile", ["direct", "legacy-agent", "pi"])
def test_append_only_review_replays_identically_and_preserves_failures(sample, tmp_path, profile):
    ds, native, observation, payload = sample
    native["q1"] = payload(ds.cases[0], [observation(1, "ops", 2), observation(2, "ops", 1)], "[1] [2]")
    native["q3"]["run"]["status"] = "cancelled"
    old = records(ds, native, profile)
    original = tmp_path / "old"
    write_jsonl(original / "predictions.jsonl", old)
    write_json(original / "report.json", score_run(ds, old))
    protected = {p: sha(p) for p in [*original.iterdir(), *ds.manifest_path.parent.iterdir()]}
    review = amendment(ds)
    revised = revise_labels(ds, review, tmp_path / "revised")
    audit = replay_labels(ds, revised, original, tmp_path / "replay")
    assert audit["changed_metric_cases"] == ["q1"]
    new = read_jsonl(tmp_path / "replay/predictions.jsonl")
    for a, b in zip(old, new):
        for key in ("status", "hits", "duration_seconds", "diagnostics", "error"):
            assert a.get(key) == b.get(key)
    assert score_run(revised, new)["cases"]["q1"]["metrics"]["all_evidence_groups_hit@5"] == 1
    assert new[2]["status"] == "timeout"
    assert protected == {p: sha(p) for p in protected}
    with pytest.raises((FileExistsError, EvaluationDataError)):
        replay_labels(ds, revised, original, tmp_path / "replay")
    with pytest.raises(FileExistsError):
        revise_labels(ds, review, tmp_path / "revised")
    assert not revised.manifest["provenance"]["annotation_revision"]["eligible_as_untouched_holdout"]
    # Both parts of the alternate statement remain mandatory.
    incomplete = deepcopy(new)
    incomplete[0]["hits"][0]["content"] = "The alarm limit is two percent"
    incomplete[0]["hits"][0].pop("start_char")
    incomplete[0]["hits"][0].pop("end_char")
    assert score_run(revised, incomplete)["cases"]["q1"]["metrics"]["all_evidence_groups_hit@5"] == 0


@pytest.mark.parametrize("tamper", ["quote", "source_sha256", "scope", "reviewer", "parent"])
def test_annotation_review_rejects_unsupported_amendments(sample, tmp_path, tamper):
    ds, _, _, _ = sample
    review = amendment(ds)
    alt = review["changes"][0]["add_alternatives"][0][0]
    if tamper in {"quote", "source_sha256"}:
        alt[tamper] = "invented"
    elif tamper == "scope":
        alt.update(source_id="poster", source_sha256=ds.sources["poster"]["text_sha256"], quote="chimneys")
    elif tamper == "reviewer":
        review.pop("reviewer")
    else:
        review["parent_fingerprint"] = "wrong"
    with pytest.raises(EvaluationDataError):
        revise_labels(ds, review, tmp_path / "bad")


def test_replay_refuses_tampered_original_and_unreviewed_additions(sample, tmp_path):
    ds, native, _, _ = sample
    original = tmp_path / "old"
    rows = records(ds, native)
    write_jsonl(original / "predictions.jsonl", rows)
    report = score_run(ds, rows)
    report["cases"]["q1"]["metrics"]["all_evidence_groups_hit@5"] = 0
    write_json(original / "report.json", report)
    revised = revise_labels(ds, amendment(ds), tmp_path / "revised")
    with pytest.raises(EvaluationDataError, match="original report"):
        replay_labels(ds, revised, original, tmp_path / "bad")
    revised.cases[0]["evidence_groups"][0]["alternatives"].append([{
        **ds.cases[0]["evidence_groups"][0]["alternatives"][0][0], "quote": "cafeteria"}])
    with pytest.raises(EvaluationDataError, match="reviewed amendments"):
        replay_labels(ds, revised, original, tmp_path / "bad")


def test_research_order_cannot_substitute_for_final_citation_order(sample):
    ds, native, observation, payload = sample
    evidence = [observation(i, "indoor", media=True) for i in range(1, 6)]
    evidence += [observation(6, "ops"), observation(7, "ops", 1)]
    native["q1"] = payload(ds.cases[0], evidence, "Duration [7], threshold [6]; again [7].")
    report, packets = audit_pi_stages(ds, records(ds, native), native)
    row = report["cases"]["q1"]
    assert row["stages"]["research_observations"]["5"]["all_required_evidence"] == 0
    assert row["stages"]["research_observations"]["5"]["unjudged_observations"] == 5
    assert row["stages"]["final_answer_citations"]["5"]["all_required_evidence"] == 1
    assert row["citation_markers"] == 2
    assert row["uncited_attached_evidence"] == 5
    assert packets[0]["judgments"]["answer_correctness"] is None
    # Marker order, not attached citation-array order, controls the cutoff.
    native["q1"]["run"]["state"]["answer"] = "[99] [98] [97] [96] [7] [6]"
    report, _ = audit_pi_stages(ds, records(ds, native), native)
    assert report["cases"]["q1"]["stages"]["final_answer_citations"]["5"]["evidence_group_recall"] == .5
    assert report["cases"]["q1"]["invalid_citation_markers"] == 4


@pytest.mark.parametrize("verdict,credit,unknown", [("supports", 1, 0), ("does_not_support", 0, 0), ("unknown", 0, 1)])
def test_media_credit_requires_an_original_bound_anchor_review(sample, tmp_path, verdict, credit, unknown):
    ds, native, _, _ = sample
    review = media_review(ds, native, tmp_path, verdict=verdict)
    report, _ = audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)
    stage = report["cases"]["q2"]["stages"]["final_answer_citations"]["5"]
    assert stage["all_required_evidence"] == credit
    assert stage["unjudged_observations"] == unknown
    assert report["semantic_quality"]["answer_correctness"]["value"] is None


@pytest.mark.parametrize("tamper", ["bytes", "observation", "receipt", "source", "anchor", "escape", "version"])
def test_media_review_rejects_tampering(sample, tmp_path, tamper):
    ds, native, _, _ = sample
    review = media_review(ds, native, tmp_path)
    item = review["observations"][0]
    if tamper == "bytes":
        (tmp_path / "asset.bin").write_bytes(b"changed")
    elif tamper == "observation":
        item["observation_sha256"] = "wrong"
    elif tamper == "receipt":
        item["native_receipt_sha256"] = "wrong"
    elif tamper == "source":
        item["source_id"] = "indoor"
    elif tamper == "anchor":
        item["anchor_sha256"] = "invented"
    elif tamper == "escape":
        item["asset_path"] = "../asset.bin"
    else:
        item["source_version"] = "wrong"
    with pytest.raises(EvaluationDataError):
        audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)


def test_wrong_media_cannot_borrow_positive_source_credit(sample, tmp_path):
    ds, native, observation, payload = sample
    native["q2"] = payload(ds.cases[1], [observation(1, "indoor", media=True)], "[1]")
    review = media_review(ds, native, tmp_path, sid="indoor")
    with pytest.raises(EvaluationDataError, match="transfer credit"):
        audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)
    review["observations"][0]["verdict"] = "does_not_support"
    report, _ = audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)
    assert report["cases"]["q2"]["stages"]["research_observations"]["all"]["all_required_evidence"] == 0


def test_opaque_original_version_cannot_grant_media_credit(sample, tmp_path):
    ds, native, _, _ = sample
    native["q2"]["evidence"][0]["provenance"]["source_version"] = "opaque-version"
    review = media_review(ds, native, tmp_path)
    with pytest.raises(EvaluationDataError, match="verifiable content version"):
        audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)


def test_invalid_final_media_reference_cannot_reuse_reviewed_research_credit(sample, tmp_path):
    ds, native, _, _ = sample
    native["q2"]["run"]["state"]["citations"][0]["source_id"] = "wrong"
    review = media_review(ds, native, tmp_path)
    report, _ = audit_pi_stages(ds, records(ds, native), native, media_review=review, media_root=tmp_path)
    stages = report["cases"]["q2"]["stages"]
    assert stages["research_observations"]["all"]["all_required_evidence"] == 1
    assert stages["final_answer_citations"]["all"]["all_required_evidence"] == 0


def test_timeout_and_missing_semantic_review_do_not_become_success(sample):
    ds, native, _, _ = sample
    native["q1"]["run"]["status"] = "cancelled"
    native["q1"]["run"]["state"] = {"answer": None, "citations": None}
    rows = records(ds, native)
    report, _ = audit_pi_stages(ds, rows, native)
    assert report["cases"]["q1"]["stages"]["research_observations"]["all"]["all_required_evidence"] == 0
    quality = report["semantic_quality"]["answer_correctness"]
    assert quality["value"] is None and quality["unknown_cases"] == 2 and quality["failed_cases"] == 1
    row = report["cases"]["q2"]
    judgment = {"schema_version": "retrieval-answer-review-1", "dataset_fingerprint": ds.fingerprint,
                "reviewer": REVIEWER, "rubric_version": "fixture-1", "judgments": [{
                    "case_id": "q2", "answer_sha256": row["answer_sha256"], "native_receipt_sha256": row["native_receipt_sha256"],
                    "reason": "Fixture adjudication", "answer_correctness": 1, "citation_support": 1}]}
    revised, _ = audit_pi_stages(ds, rows, native, answer_review=judgment)
    assert revised["semantic_quality"]["answer_correctness"]["value"] is None
    assert revised["semantic_quality"]["answer_correctness"]["reviewed_plus_failure_mean"] == .5
    judgment["judgments"][0]["answer_sha256"] = "wrong"
    with pytest.raises(EvaluationDataError, match="receipt mismatch"):
        audit_pi_stages(ds, rows, native, answer_review=judgment)


def test_receipt_and_indexed_evidence_must_match_measured_records(sample, tmp_path):
    ds, native, _, _ = sample
    rows = records(ds, native)
    journal = tmp_path / "native"
    for row in rows:
        path = journal / (digest(row["case_id"]) + ".evidence.json")
        write_json(path, native[row["case_id"]])
        row["native_observation_sha256"] = sha(path)
    assert load_native_receipts(rows, journal) == native
    path.write_text(path.read_text() + " ")
    with pytest.raises(EvaluationDataError, match="checksum"):
        load_native_receipts(rows, journal)
    rows[0]["hits"] = rows[0]["hits"][:1]
    with pytest.raises(EvaluationDataError, match="differs from measured"):
        audit_pi_stages(ds, rows, native)


def controlled_records(ds, native):
    rows = deepcopy(records(ds, native))
    contract = {"stage": "research_observations", "ordering": "first_observed", "retrieval_tools_sha256": "a" * 64,
                "model_stack": {"llm": "fixed", "embedding": "fixed"}, "concurrency": 1,
                "budget": {"wall_seconds": 60, "model_tokens": 1000, "tool_calls": 10, "evidence_units": 20}}
    for row in rows:
        row["configuration"]["comparison_contract"] = contract
        row["configuration_fingerprint"] = digest(row["configuration"])
        row["budget_receipt"] = {"case_id": row["case_id"], "dataset_fingerprint": ds.fingerprint,
            "enforced": True, "contract_sha256": digest(contract),
            "wall_seconds": .1, "model_tokens": 100, "tool_calls": 2, "evidence_units": 2}
    return rows


def test_matched_comparison_requires_enforced_per_case_controls(sample):
    ds, native, _, _ = sample
    historic = score_run(ds, records(ds, native))
    assert not comparison_readiness(historic, historic)["matched_comparison_ready"]
    measured = score_run(ds, controlled_records(ds, native))
    assert comparison_readiness(measured, measured)["matched_comparison_ready"]
    candidate = deepcopy(measured)
    candidate["configuration"]["comparison_contract"]["ordering"] = "final_citations"
    candidate["configuration_fingerprint"] = digest(candidate["configuration"])
    assert "different_ordering" in comparison_readiness(measured, candidate)["reasons"]


@pytest.mark.parametrize("tamper", ["enforced", "contract_sha256", "case_id", "dataset_fingerprint", "nan", "over_budget", "null_budget"])
def test_bogus_budget_receipts_cannot_pass_comparison_gate(sample, tamper):
    ds, native, _, _ = sample
    report = score_run(ds, controlled_records(ds, native))
    receipt = report["cases"]["q1"]["budget_receipt"]
    if tamper == "nan":
        receipt["model_tokens"] = float("nan")
    elif tamper == "over_budget":
        receipt["tool_calls"] = 100
    elif tamper == "null_budget":
        report["configuration"]["comparison_contract"]["budget"] = None
        report["configuration_fingerprint"] = digest(report["configuration"])
    else:
        receipt[tamper] = False if tamper == "enforced" else "wrong"
    assert not comparison_readiness(report, report)["matched_comparison_ready"]


def test_cli_stage_export_is_private_by_default_and_aggregate_has_no_bodies(sample, tmp_path):
    ds, native, _, _ = sample
    rows = records(ds, native)
    journal = tmp_path / "native"
    for row in rows:
        path = journal / (digest(row["case_id"]) + ".evidence.json")
        write_json(path, native[row["case_id"]])
        row["native_observation_sha256"] = sha(path)
    predictions = tmp_path / "predictions.jsonl"
    write_jsonl(predictions, rows)
    output = tmp_path / "audit"
    args = ["audit-pi", "--dataset", str(ds.manifest_path), "--predictions", str(predictions), "--native", str(journal), "--output", str(output)]
    assert main(args) == 0
    public = (output / "aggregate.json").read_text()
    assert "cases" not in json.loads(public)
    for case in ds.cases:
        assert case["query"] not in public
        assert case["id"] not in public
    assert len(read_jsonl(output / "answer-review-packets.jsonl")) == 3
    assert main(args) == 2
    report = tmp_path / "report.json"
    write_json(report, score_run(ds, rows))
    args = ["compare", "--baseline", str(report), "--candidate", str(report), "--require-matched", "--output", str(tmp_path / "comparison.json")]
    assert main(args) == 2
    assert not (tmp_path / "comparison.json").exists()
