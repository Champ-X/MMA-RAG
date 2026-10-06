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
THINKING_MODEL = "aliyun_bailian:qwen3.5-plus"


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
        result = {"answer_id": review.RESPONSE_ANSWER_ID, "complete": True}
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
    manifest = review.prepare_calibration(cases, output, model=kwargs.pop("model", MODEL), **kwargs)
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
    output, _, manifest = freeze(tmp_path)
    _, private, jobs = review.load_sealed(output, MODEL)
    config = manifest["reviewer_config"]
    attempt = {"model": MODEL, "raw_model": "reviewer", "reviewer_config": config,
               "manifest_sha256": review.v1.sha(manifest)}
    review.v1.write_new(output / "review-attempt.json", attempt)
    (output / "reviews").mkdir()
    assessments, hashes = {}, {}
    for jid, value in jobs.items():
        correct = "为5" in value["answer"]
        receipt = receipt_for(value, entails=["yes" if correct else "no"], contradicts=["no" if correct else "yes"])
        add_wire_fields(value, receipt, config, "reviewer")
        review.v1.write_new(output / "reviews" / f"{jid}.json", receipt)
        hashes[jid] = review.v1.sha(receipt)
        assessments[value["answer_id"]] = review.validate_receipt(value, receipt)
    report = review.previous.calibration_report(private["gold"], assessments)
    report.update(model=MODEL, review_receipt_sha256=hashes, review_attempt_sha256=review.v1.sha(attempt))
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


def add_wire_fields(value, receipt, config, raw_model):
    receipt.update(input_sha256=review.v1.sha(value), reviewer_config_sha256=review.v1.sha(config))
    for stage, request in review.review_requests(value).items():
        saved = receipt["requests"][stage]
        body = review.request_body(request, raw_model, config)
        if config["thinking"]:
            add_thinking_usage(saved["response"])
        saved.update(request_body=body, request_body_sha256=review.v1.sha(body),
                     response_text=json.dumps(saved["response"]))


def add_thinking_usage(response):
    response["choices"][0]["message"]["reasoning_content"] = "private controlled response"
    response["usage"] = {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300,
                         "completion_tokens_details": {"reasoning_tokens": 150}}


def test_thinking_is_frozen_bounded_and_does_not_change_prompts_or_labels(tmp_path):
    plain, cases, plain_manifest = freeze(tmp_path, model=THINKING_MODEL)
    thinking = tmp_path / "thinking"
    manifest = review.prepare_calibration(cases, thinking, model=THINKING_MODEL, thinking=True)
    plain_jobs = review.load_sealed(plain, THINKING_MODEL)[2]
    thinking_jobs = review.load_sealed(thinking, THINKING_MODEL)[2]
    assert plain_jobs == thinking_jobs
    assert manifest["private_sha256"] == plain_manifest["private_sha256"]
    assert manifest["rubric_sha256"] == plain_manifest["rubric_sha256"]
    assert manifest["expected_requests"] == plain_manifest["expected_requests"] == 6
    default = plain_manifest["reviewer_config"]["request_options"]
    options = manifest["reviewer_config"]["request_options"]
    assert default == {"temperature": 0, "max_tokens": 8000, "response_format": {"type": "json_object"},
                       "stream": False, "enable_thinking": False}
    assert options == {"temperature": 0, "max_completion_tokens": 7990, "thinking_budget": 4000,
                       "response_format": {"type": "json_object"}, "stream": False, "enable_thinking": True}
    assert options["max_completion_tokens"] + 10 == manifest["reviewer_config"]["output_token_limit"] == 8000
    with pytest.raises(ValueError, match="configured"):
        review.prepare_calibration(cases, tmp_path / "unsupported", model=MODEL, thinking=True)
    assert not (tmp_path / "unsupported").exists()
    with pytest.raises(ValueError, match="configuration differs"):
        review.prepare_calibration(cases, tmp_path / "heldout", model=THINKING_MODEL,
            kind="heldout", development=plain, thinking=True)
    assert not (tmp_path / "heldout").exists()


def test_local_answer_alias_keeps_global_identity_in_host_and_raw_receipts():
    value = job(facts=["结果为5"])
    value["answer_id"] = "answer-opaque-long-identity"
    config = review.reviewer_config(THINKING_MODEL, thinking=True)
    requests = review.review_requests(value)
    for stage, request in requests.items():
        assert request["input"]["answer_id"] == review.RESPONSE_ANSWER_ID
        assert review.response_schema(value, stage)["properties"]["answer_id"]["const"] == review.RESPONSE_ANSWER_ID
        assert value["answer_id"] not in json.dumps(request)
        assert request["input"]["answer"] == value["answer"]
    receipt = receipt_for(value)
    add_wire_fields(value, receipt, config, "qwen3.5-plus")
    before = review.v1.encoded(receipt)
    assessed = review.validate_receipt(value, receipt, config=config, raw_model="qwen3.5-plus")
    assert assessed.answer_id == value["answer_id"]
    assert review.v1.encoded(receipt) == before
    other = {**value, "answer_id": "another-real-answer"}
    with pytest.raises(ValueError, match="receipt input"):
        review.validate_receipt(other, receipt, config=config, raw_model="qwen3.5-plus")
    other = {**value, "question": "另一个问题"}
    receipt["input_sha256"] = review.v1.sha(other)
    with pytest.raises(ValueError, match="input changed"):
        review.validate_receipt(other, receipt, config=config, raw_model="qwen3.5-plus")


def test_local_alias_does_not_accept_or_repair_wrong_provider_identity():
    value = job()
    receipt = receipt_for(value)
    mutate_body(receipt, "kind", lambda body: body.update(answer_id=value["answer_id"]))
    original = review.v1.encoded(receipt)
    with pytest.raises(ValueError, match="identity changed"):
        review.validate_receipt(value, receipt)
    assert review.v1.encoded(receipt) == original


@pytest.mark.parametrize("change", ["thinking", "limit", "options", "hash"])
def test_changed_frozen_request_configuration_fails_before_calls(tmp_path, change):
    output, _, manifest = freeze(tmp_path, model=THINKING_MODEL, thinking=True)
    config = manifest["reviewer_config"]
    if change == "thinking": config["thinking"] = False
    elif change == "limit": config["output_token_limit"] = 16000
    elif change == "options": config["request_options"]["max_completion_tokens"] = 16000
    else: manifest["reviewer_config_sha256"] = "other"
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="configuration changed"):
        asyncio.run(review.run_review(output, THINKING_MODEL))
    assert not (output / "review-attempt.json").exists()


@pytest.mark.parametrize("change", ["input", "config", "body", "body_hash", "raw_text", "budget"])
def test_receipt_binds_actual_wire_request_response_and_thinking_usage(change):
    value = job()
    config = review.reviewer_config(THINKING_MODEL, thinking=True)
    receipt = receipt_for(value)
    add_wire_fields(value, receipt, config, "qwen3.5-plus")
    review.validate_receipt(value, receipt, config=config, raw_model="qwen3.5-plus")
    saved = receipt["requests"]["kind"]
    if change == "input": receipt["input_sha256"] = "changed"
    elif change == "config": receipt["reviewer_config_sha256"] = "changed"
    elif change == "body": saved["request_body"]["enable_thinking"] = False
    elif change == "body_hash": saved["request_body_sha256"] = "changed"
    elif change == "raw_text": saved["response_text"] = "{}"
    else:
        saved["response"]["usage"].update(completion_tokens=8001, total_tokens=8101)
        saved["response_text"] = json.dumps(saved["response"])
    with pytest.raises(ValueError):
        review.validate_receipt(value, receipt, config=config, raw_model="qwen3.5-plus")


@pytest.mark.parametrize("change", ["missing_usage", "unknown_usage", "negative", "boolean", "sum", "over_budget",
                                   "missing_reasoning_usage", "no_thinking", "missing_reasoning", "inconsistent_reasoning",
                                   "non_json", "invalid_schema"])
def test_thinking_protocol_failure_stops_once_and_preserves_raw_receipt(tmp_path, monkeypatch, change):
    from app.modules.pi_agent import models
    output, _, _ = freeze(tmp_path, model=THINKING_MODEL, thinking=True)
    monkeypatch.setattr(models, "model_endpoint", lambda *args: {"provider": "aliyun_bailian", "model": "qwen3.5-plus",
        "key": "DO_NOT_SAVE_CREDENTIAL", "base_url": "https://example.test"})
    response = {"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]}
    add_thinking_usage(response)
    usage = response["usage"]
    if change == "missing_usage": response.pop("usage")
    elif change == "unknown_usage": usage["completion_tokens"] = None
    elif change == "negative": usage["prompt_tokens"] = -1
    elif change == "boolean": usage["completion_tokens"] = True
    elif change == "sum": usage["total_tokens"] += 1
    elif change == "over_budget": usage.update(completion_tokens=8001, total_tokens=8101)
    elif change == "missing_reasoning_usage": usage.pop("completion_tokens_details")
    elif change == "no_thinking": usage["completion_tokens_details"]["reasoning_tokens"] = 0
    elif change == "missing_reasoning": response["choices"][0]["message"].pop("reasoning_content")
    elif change == "inconsistent_reasoning": usage["completion_tokens_details"]["reasoning_tokens"] = 201
    elif change == "non_json": response["choices"][0]["message"]["content"] = "```json\n{}\n```"
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=response)
    client = httpx.AsyncClient
    monkeypatch.setattr(review.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))
    result = asyncio.run(review.run_review(output, THINKING_MODEL))
    assert len(calls) == 1 and not result["pass"] and result["validated_answers"] == 0
    receipts = list((output / "reviews").glob("*.json"))
    assert len(receipts) == 1
    saved = next(iter(json.loads(receipts[0].read_text())["requests"].values()))
    assert saved["request_body"] == calls[0] and saved["error_type"] in {"ValueError", "ValidationError"}
    assert json.loads(saved["response_text"]) == response
    assert all("DO_NOT_SAVE_CREDENTIAL" not in path.read_text() for path in output.rglob("*.json"))
    with pytest.raises(FileExistsError): asyncio.run(review.run_review(output, THINKING_MODEL))
    assert len(calls) == 1


@pytest.mark.parametrize("thinking", [False, True])
def test_heldout_requires_same_configuration_endpoint_and_reproducible_raw_receipts(tmp_path, monkeypatch, thinking):
    from app.modules.pi_agent import models
    output, cases, _ = freeze(tmp_path, model=THINKING_MODEL, thinking=thinking)
    _, _, jobs = review.load_sealed(output, THINKING_MODEL)
    expected = {}
    for value in jobs.values():
        correct = "为5" in value["answer"]
        receipt = receipt_for(value, entails=["yes" if correct else "no"], contradicts=["no" if correct else "yes"])
        for stage, request in review.review_requests(value).items():
            response = receipt["requests"][stage]["response"]
            if thinking: add_thinking_usage(response)
            expected[request["system"], review.v1.encoded(request["input"]) ] = response
    endpoint = {"provider": "aliyun_bailian", "model": "qwen3.5-plus", "key": "test", "base_url": "https://example.test"}
    monkeypatch.setattr(models, "model_endpoint", lambda *args: endpoint)
    calls = []
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        return httpx.Response(200, json=expected[tuple(message["content"] for message in body["messages"])])
    client = httpx.AsyncClient
    monkeypatch.setattr(review.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))
    assert asyncio.run(review.run_review(output, THINKING_MODEL))["pass"]
    assert len(calls) == 6
    assert review.check_development(output, THINKING_MODEL)
    with pytest.raises(ValueError, match="configuration differs"):
        review.check_development(output, THINKING_MODEL,
            expected_config=review.reviewer_config(THINKING_MODEL, thinking=not thinking))
    heldout = tmp_path / "heldout"
    review.prepare_calibration(cases, heldout, model=THINKING_MODEL, kind="heldout", development=output, thinking=thinking)
    endpoint["base_url"] = "https://changed.test"
    with pytest.raises(ValueError, match="endpoint differs"):
        asyncio.run(review.run_review(heldout, THINKING_MODEL))
    assert len(calls) == 6 and not (heldout / "review-attempt.json").exists()
    endpoint["base_url"] = "https://example.test"
    assert asyncio.run(review.run_review(heldout, THINKING_MODEL))["pass"]
    assert len(calls) == 12
    attempt = json.loads((output / "review-attempt.json").read_text())
    attempt["reviewer_config"]["thinking"] = not thinking
    (output / "review-attempt.json").write_text(json.dumps(attempt))
    with pytest.raises(ValueError, match="execution configuration changed"):
        review.check_development(output, THINKING_MODEL)
