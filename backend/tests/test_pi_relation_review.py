"""Verify review integrity with controlled judgments, not model accuracy."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/pi_relation_review.py"
spec = importlib.util.spec_from_file_location("pi_relation_review", SCRIPT)
review = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = review
spec.loader.exec_module(review)
MODEL = "test:reviewer"


def job(answer="结果为5[1]。", *, cited=True, facts=None):
    return review.previous.make_job("结果是什么？", facts or [], [], {
        "answer_id": "blind", "answer": answer,
        "citations": [{"id": 1, "content": "结果为5。\n该结果限于在线场景。"}] if cited else []})


def receipt_for(value, *, kinds=None, entails=None, contradicts=None):
    pieces = review.clauses(value)
    count = len(pieces)
    labels = {"kind": kinds or ["factual"] * count,
              "entails": entails or ["yes"] * count,
              "contradicts": contradicts or ["no"] * count}
    receipt = {"requests": {}}
    for stage, request in review.review_requests(value).items():
        result = {"answer_id": value["answer_id"], "complete": True}
        if stage == "facts":
            result["facts"] = [{"index": i + 1, "status": "covered", "answer_units": ["u1"], "reason": "test"}
                               for i in range(len(value["reference_facts"]))]
        else:
            result["items"] = [{"clause_id": piece["clause_id"], "reason": "test",
                **({"kind": label} if stage == "kind" else {
                    "verdict": label, "source_spans": ["c1s1"] if label == "yes" else []})}
                for piece, label in zip(pieces, labels[stage], strict=True)]
        receipt["requests"][stage] = {"http_status": 200, "request_sha256": review.v1.sha(request),
            "response": {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(result)}}]}}
    return receipt


def mutate_body(receipt, stage, change):
    message = receipt["requests"][stage]["response"]["choices"][0]["message"]
    body = json.loads(message["content"])
    change(body)
    message["content"] = json.dumps(body)


def score(value, receipt):
    return review.v1.answer_score(review.previous.score_view(review.validate_receipt(value, receipt)))


def test_literal_clauses_preserve_unicode_offsets_decimals_and_all_content():
    answer = "**观察🔎**\r\n\n尚未通读，结果为1.25%[1]。 A value of 0.12 fell to 0.08. Next fact! 中文e\u0301。\n"
    value = job(answer)
    pieces = review.clauses(value)
    covered = set()
    for piece in pieces:
        assert answer[piece["start"]:piece["end"]] == piece["text"]
        positions = set(range(piece["start"], piece["end"]))
        assert not positions & covered
        covered.update(positions)
    assert all(i in covered for i, char in enumerate(answer) if not char.isspace())
    assert any("1.25%[1]" in p["text"] for p in pieces)
    assert any("0.12 fell to 0.08." in p["text"] for p in pieces)
    assert len({p["clause_id"] for p in pieces}) == len(pieces)


def test_each_stage_gets_original_condition_context_without_other_judgments_or_gold():
    value = job("仅当双方在线，操作才会同步[1]。", facts=["PRIVATE GOLD"])
    value["reference_sources"] = [{"content": "PRIVATE REFERENCE"}]
    requests = review.review_requests(value)
    assert set(requests) == {"facts", "kind", "entails", "contradicts"}
    for stage in ("kind", "entails", "contradicts"):
        assert requests[stage]["input"]["answer"] == value["answer"]
        assert requests[stage]["input"]["answer_units"] == value["answer_units"]
        assert "PRIVATE" not in json.dumps(requests[stage])
        assert "judgments" not in requests[stage]["input"]
    assert "actual_citations" not in requests["kind"]["input"]
    assert "actual_citations" not in requests["facts"]["input"]
    schema = review.response_schema(value, "entails")
    assert schema["properties"]["items"]["minItems"] == schema["properties"]["items"]["maxItems"] == 2
    assert schema["$defs"]["RelationItem"]["properties"]["source_spans"]["items"]["enum"] == ["c1s1", "c1s2"]


def test_unbacked_fact_in_limitation_cannot_inherit_not_applicable():
    value = job("尚未通读资料，但所有地区均支持该功能。", cited=False)
    receipt = receipt_for(value, kinds=["limitation", "factual"])
    assessed = review.validate_receipt(value, receipt)
    assert assessed.units[0].kind == "factual"
    assert assessed.units[0].support == "unsupported"
    assert set(receipt["requests"]) == {"kind"}
    assert not score(value, receipt)["supported"]


@pytest.mark.parametrize("entail,opposite,expected", [
    ("yes", "no", "supported"), ("no", "no", "unsupported"), ("no", "yes", "contradicted"),
    ("uncertain", "no", "uncertain"), ("yes", "uncertain", "uncertain"), ("yes", "yes", "uncertain")])
def test_independent_relations_keep_support_absence_opposition_and_uncertainty_distinct(entail, opposite, expected):
    value = job(facts=["结果为5"])
    receipt = receipt_for(value, entails=[entail], contradicts=[opposite])
    assessed = review.validate_receipt(value, receipt)
    assert assessed.units[0].support == expected
    outcome = score(value, receipt)
    assert outcome["facts"] == ["covered"]
    assert outcome["supported"] == (expected == "supported")
    assert outcome["no_contradictions"] == (expected != "contradicted")
    assert outcome["uncertain"] == (expected == "uncertain")


def test_unit_requires_every_factual_clause_and_keeps_explicit_counterexample():
    value = job("结果为5，而且支持离线[1]。")
    receipt = receipt_for(value, entails=["yes", "no"])
    assert not score(value, receipt)["supported"]
    receipt = receipt_for(value, entails=["yes", "no"], contradicts=["no", "yes"])
    assert not score(value, receipt)["no_contradictions"]


@pytest.mark.parametrize("kind", ["limitation", "formatting", "uncertain"])
def test_inconsistent_or_unknown_classification_cannot_pass(kind):
    value = job()
    receipt = receipt_for(value, kinds=[kind])
    assert score(value, receipt)["uncertain"]
    assert not review.previous.calibration_report({"blind": {"case_id": "control", "supported": False, "facts": []}},
        {"blind": review.validate_receipt(value, receipt)})["pass"]


def test_incomplete_review_and_missing_reference_fact_do_not_pass():
    value = job(facts=["结果为5", "仅在线"])
    receipt = receipt_for(value)
    mutate_body(receipt, "facts", lambda body: body["facts"][1].update(status="missing", answer_units=[]))
    assert score(value, receipt)["facts"] == ["covered", "missing"]
    mutate_body(receipt, "kind", lambda body: body.update(complete=False))
    assert score(value, receipt)["uncertain"]


@pytest.mark.parametrize("change", ["missing_stage", "invented_stage", "changed_request", "failed_http", "empty_choices",
    "extra_choices", "truncated", "missing_content", "wrong_identity", "missing_clause", "duplicate_clause",
    "invented_clause", "foreign_span", "duplicate_span", "no_anchor", "cross_stage_fields", "missing_unit", "source_changed"])
def test_incomplete_forged_or_mixed_receipts_are_rejected(change):
    value = job()
    receipt = receipt_for(value)
    saved = receipt["requests"]["entails"]
    choices = saved["response"]["choices"]
    if change == "missing_stage": receipt["requests"].pop("contradicts")
    elif change == "invented_stage": receipt["requests"]["other"] = saved
    elif change == "changed_request": saved["request_sha256"] = "changed"
    elif change == "failed_http": saved["http_status"] = 503
    elif change == "empty_choices": choices.clear()
    elif change == "extra_choices": choices.append(choices[0])
    elif change == "truncated": choices[0]["finish_reason"] = "length"
    elif change == "missing_content": choices[0]["message"]["content"] = None
    elif change == "wrong_identity": mutate_body(receipt, "entails", lambda b: b.update(answer_id="other"))
    elif change == "missing_clause": mutate_body(receipt, "entails", lambda b: b["items"].clear())
    elif change == "duplicate_clause": mutate_body(receipt, "entails", lambda b: b["items"].append(b["items"][0]))
    elif change == "invented_clause": mutate_body(receipt, "entails", lambda b: b["items"][0].update(clause_id="u9p9"))
    elif change == "foreign_span": mutate_body(receipt, "entails", lambda b: b["items"][0].update(source_spans=["r1s1"]))
    elif change == "duplicate_span": mutate_body(receipt, "entails", lambda b: b["items"][0].update(source_spans=["c1s1", "c1s1"]))
    elif change == "no_anchor": mutate_body(receipt, "entails", lambda b: b["items"][0].update(source_spans=[]))
    elif change == "cross_stage_fields": mutate_body(receipt, "entails", lambda b: b.update(facts=[]))
    elif change == "missing_unit": value["answer"] += "\n未覆盖的主张。"
    elif change == "source_changed": value["actual_citations"][0]["content"] += "遗漏的原文"
    with pytest.raises(ValueError): review.validate_receipt(value, receipt)


def freeze(tmp_path, name="development", **kwargs):
    cases = tmp_path / f"{name}.json"
    cases.write_text(json.dumps({"cases": [
        {"id": "correct", "question": "结果？", "answer": "结果为5[1]。", "citations": [{"id": 1, "content": "结果为5。"}],
         "expected": {"supported": True, "facts": [], "unit_support": {"u1": "supported"}}},
        {"id": "wrong", "question": "结果？", "answer": "结果为6[1]。", "citations": [{"id": 1, "content": "结果为5。"}],
         "expected": {"supported": False, "facts": [], "unit_support": {"u1": "contradicted"}}}]}))
    output = tmp_path / name
    manifest = review.prepare_calibration(cases, output, model=MODEL, **kwargs)
    return output, cases, manifest


def test_frozen_plan_hides_gold_pins_model_counts_calls_and_refuses_overwrite(tmp_path):
    output, cases, manifest = freeze(tmp_path)
    assert manifest["expected_requests"] == 6
    _, _, jobs = review.load_sealed(output, MODEL)
    for value in jobs.values():
        assert "expected" not in value and "case_id" not in value
    with pytest.raises(ValueError, match="frozen model"): review.load_sealed(output, "other:model")
    with pytest.raises(FileExistsError): review.prepare_calibration(cases, output, model=MODEL)
    with pytest.raises(ValueError): review.prepare_calibration(cases, tmp_path / "product", model=MODEL, kind="answers")
    assert not (tmp_path / "product").exists()


@pytest.mark.parametrize("change", ["last_input", "gold", "fixture", "code", "count", "product"])
def test_all_frozen_inputs_are_checked_before_any_review_attempt(tmp_path, change):
    output, cases, manifest = freeze(tmp_path)
    if change == "last_input": (output / "inputs" / f"{manifest['jobs'][-1]}.json").write_text("{}")
    elif change == "gold": (output / "private.json").write_text("{}")
    elif change == "fixture": cases.write_text("{}")
    else:
        manifest.update({"code_sha256": {}} if change == "code" else {"expected_requests": 0} if change == "count" else {"kind": "answers"})
        (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError): asyncio.run(review.run_review(output, MODEL))
    assert not (output / "review-attempt.json").exists()


def test_heldout_cannot_run_without_development_evidence(tmp_path):
    development, _, _ = freeze(tmp_path)
    output, _, _ = freeze(tmp_path, "heldout", kind="heldout", development=development)
    with pytest.raises(FileNotFoundError): asyncio.run(review.run_review(output, MODEL))
    (development / "report.json").write_text(json.dumps({"model": MODEL, "pass": False}))
    with pytest.raises(ValueError, match="not passed"): asyncio.run(review.run_review(output, MODEL))
    assert not (output / "review-attempt.json").exists()


def test_development_gate_recomputes_gold_and_checks_raw_receipts(tmp_path):
    output, _, _ = freeze(tmp_path)
    _, private, jobs = review.load_sealed(output, MODEL)
    (output / "reviews").mkdir()
    assessments, hashes = {}, {}
    for jid, value in jobs.items():
        correct = "为5" in value["answer"]
        receipt = receipt_for(value, entails=["yes" if correct else "no"], contradicts=["no" if correct else "yes"])
        review.v1.write_new(output / "reviews" / f"{jid}.json", receipt)
        hashes[jid] = review.v1.sha(receipt)
        assessments[value["answer_id"]] = review.validate_receipt(value, receipt)
    report = review.previous.calibration_report(private["gold"], assessments)
    report.update(model=MODEL, review_receipt_sha256=hashes)
    review.v1.write_new(output / "report.json", report)
    assert review.check_development(output, MODEL)
    first = output / "reviews" / f"{next(iter(jobs))}.json"
    first.write_text("{}")
    with pytest.raises(ValueError, match="receipt changed"): review.check_development(output, MODEL)


@pytest.mark.parametrize("response,status", [({"choices": []}, 200), ({"choices": [{"finish_reason": "length"}]}, 200),
    ({"error": {"message": "test unavailable"}}, 503)])
def test_unavailable_or_incomplete_provider_stops_without_retry_and_preserves_response(tmp_path, monkeypatch, response, status):
    from app.modules.pi_agent import models
    output, _, _ = freeze(tmp_path)
    monkeypatch.setattr(models, "model_endpoint", lambda *args: {"provider": "test", "model": "reviewer", "key": "test", "base_url": "https://example.test"})
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json=response)
    client = httpx.AsyncClient
    monkeypatch.setattr(review.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))
    result = asyncio.run(review.run_review(output, MODEL))
    assert len(calls) == 1 and not result["pass"] and result["validated_answers"] == 0
    receipts = list((output / "reviews").glob("*.json"))
    assert len(receipts) == 1
    saved = next(iter(json.loads(receipts[0].read_text())["requests"].values()))
    assert json.loads(saved["response_text"]) == response
    with pytest.raises(FileExistsError): asyncio.run(review.run_review(output, MODEL))
    assert len(calls) == 1
