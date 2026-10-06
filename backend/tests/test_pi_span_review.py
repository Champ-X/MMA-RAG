import importlib.util
import json
from pathlib import Path
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/pi_span_review.py"
spec = importlib.util.spec_from_file_location("pi_span_review", SCRIPT)
review = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = review
spec.loader.exec_module(review)


def sample():
    job = review.make_job("增加多少？", ["7.3个百分点"], [], {"answer_id": "blind", "answer": "**结果**\n增加7.3个百分点[1]。",
        "citations": [{"id": 1, "content": "Pass@1: 69.7% → 77.0%."}]})
    value = {"answer_id": "blind", "facts": [{"index": 1, "status": "covered", "answer_units": ["u2"], "reason": "数值一致"}],
        "units": [{"unit_id": "u1", "kind": "formatting", "support": "not_applicable", "source_spans": [], "reason": "标题"},
                  {"unit_id": "u2", "kind": "factual", "support": "supported", "source_spans": ["c1s1"], "reason": "算术差值"}], "complete": True}
    return job, value


def test_unicode_and_markdown_spans_preserve_original_content():
    body = "**观察🔎**\r\n\n你好\u0301。  后文\n"
    spans = review.spans(body, "s", maximum=5)
    covered = set()
    for span in spans:
        assert body[span["start"]:span["end"]] == span["text"]
        assert not covered.intersection(range(span["start"], span["end"]))
        covered.update(range(span["start"], span["end"]))
    assert all(index in covered for index, character in enumerate(body) if not character.isspace())


@pytest.mark.parametrize("change", ["identity", "missing_unit", "duplicate_unit", "missing_fact", "invented_answer_span", "reference_not_citation", "missing_support", "factual_not_applicable"])
def test_reviewer_cannot_skip_units_or_borrow_uncited_reference_text(change):
    job, value = sample()
    if change == "identity": value["answer_id"] = "other"
    elif change == "missing_unit": value["units"].pop()
    elif change == "duplicate_unit": value["units"].append(value["units"][0])
    elif change == "missing_fact": value["facts"] = []
    elif change == "invented_answer_span": value["facts"][0]["answer_units"] = ["u99"]
    elif change == "reference_not_citation": value["units"][1]["source_spans"] = ["r1s1"]
    elif change == "missing_support": value["units"][1]["source_spans"] = []
    else: value["units"][1]["support"] = "not_applicable"
    with pytest.raises(ValueError): review.validate(job, value)


def test_score_keeps_negative_and_uncertain_findings_and_missing_facts():
    job, value = sample()
    assert review.v1.answer_score(review.score_view(review.validate(job, value)))["supported"]
    value["units"][1].update(support="unsupported", source_spans=[])
    value["facts"][0].update(status="missing", answer_units=[])
    score = review.v1.answer_score(review.score_view(review.validate(job, value)))
    assert not score["supported"] and score["facts"] == ["missing"] and not score["uncertain"]
    value["units"][1]["support"] = "uncertain"
    assert review.v1.answer_score(review.score_view(review.validate(job, value)))["uncertain"]


def test_response_schema_is_bound_to_actual_fact_count_and_available_ids():
    job, _ = sample()
    schema = review.response_schema(job)
    assert schema["properties"]["answer_id"]["const"] == "blind"
    assert schema["properties"]["facts"]["minItems"] == schema["properties"]["facts"]["maxItems"] == 1
    assert schema["$defs"]["FactAssessment"]["properties"]["index"]["enum"] == [1]
    assert schema["$defs"]["UnitAssessment"]["properties"]["unit_id"]["enum"] == ["u1", "u2"]
    assert schema["$defs"]["UnitAssessment"]["properties"]["source_spans"]["items"]["enum"] == ["c1s1"]
    job.update(reference_facts=[], actual_citations=[])
    schema = review.response_schema(job)
    assert schema["properties"]["facts"]["maxItems"] == 0
    assert schema["$defs"]["UnitAssessment"]["properties"]["source_spans"]["maxItems"] == 0


def split_receipt(job, value):
    return {"requests": {stage: {"http_status": 200, "request_sha256": review.v1.sha(request),
        "response": {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "answer_id": value["answer_id"], "complete": value["complete"],
            **({"facts": value["facts"]} if stage == "facts" else {"units": value["units"]})})}}]}}
        for stage, request in review.review_requests(job).items()}}


def test_fact_and_citation_review_have_independent_context_and_schema():
    job, value = sample()
    job["reference_sources"] = [{"content": "PRIVATE REFERENCE ONLY"}]
    requests = review.review_requests(job)
    assert "actual_citations" not in requests["facts"]["input"]
    assert "reference_facts" not in requests["support"]["input"]
    assert "PRIVATE REFERENCE ONLY" not in json.dumps(requests["support"])
    assert "UnitAssessment" not in review.response_schema(job, "facts")["$defs"]
    assert "FactAssessment" not in review.response_schema(job, "support")["$defs"]
    value["units"][1].update(support="unsupported", source_spans=[])
    result = review.validate_receipt(job, split_receipt(job, value))
    # The answer can cover the reference fact while lacking citation support.
    score = review.v1.answer_score(review.score_view(result))
    assert score["facts"] == ["covered"] and not score["supported"]
    job["reference_facts"] = []
    assert set(review.review_requests(job)) == {"support"}


@pytest.mark.parametrize("change", ["missing_stage", "changed_input", "wrong_identity", "truncated", "failed_http", "cross_stage_fields"])
def test_split_review_cannot_use_partial_or_mixed_judgments(change):
    job, value = sample()
    receipt = split_receipt(job, value)
    saved = receipt["requests"]["support"]
    choice = saved["response"]["choices"][0]
    if change == "missing_stage": receipt["requests"].pop("facts")
    elif change == "changed_input": saved["request_sha256"] = "wrong"
    elif change == "wrong_identity":
        body = json.loads(choice["message"]["content"])
        body["answer_id"] = "another"
        choice["message"]["content"] = json.dumps(body)
    elif change == "truncated": choice["finish_reason"] = "length"
    elif change == "failed_http": saved["http_status"] = 503
    else:
        body = json.loads(choice["message"]["content"])
        body["facts"] = value["facts"]
        choice["message"]["content"] = json.dumps(body)
    with pytest.raises(ValueError): review.validate_receipt(job, receipt)


def test_calibration_hides_gold_and_refuses_overwrite_or_failed_gate(tmp_path):
    fixture = Path(__file__).parent / "fixtures/pi_span_review_calibration.json"
    out = tmp_path / "calibration"
    manifest = review.prepare_calibration(fixture, out)
    assert len(manifest["jobs"]) == 16
    for jid in manifest["jobs"]:
        job = json.loads((out / "inputs" / f"{jid}.json").read_text())
        assert "expected" not in job and "case_id" not in job
        assert all(job["answer"][s["start"]:s["end"]] == s["text"] for s in job["answer_units"])
    with pytest.raises(FileExistsError): review.prepare_calibration(fixture, out)
    (out / "report.json").write_text(json.dumps({"pass": False}))
    with pytest.raises(ValueError, match="not passed"): review.check_calibration(out)


def test_calibration_requires_semantic_expectation_and_kind_not_just_valid_schema():
    job, value = sample()
    assessed = review.validate(job, value)
    expected = {"blind": {"case_id": "negative", "supported": False, "facts": ["covered"], "unit_kinds": {"u2": "factual"}}}
    assert not review.calibration_report(expected, {"blind": assessed})["pass"]
    expected["blind"]["supported"] = True
    assert review.calibration_report(expected, {"blind": assessed})["pass"]
    expected["blind"]["unit_support"] = {"u2": "unsupported"}
    assert not review.calibration_report(expected, {"blind": assessed})["pass"]
    assert not review.calibration_report(expected, {})["pass"]
