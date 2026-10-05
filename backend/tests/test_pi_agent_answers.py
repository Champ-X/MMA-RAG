import copy
import json

import pytest
from pydantic import ValidationError

from app.modules.pi_agent.answers import answer_units, assess_answer, character_count, evidence_payload, evidence_units
from app.modules.pi_agent.contracts import Evidence, RunBudget
from app.modules.pi_agent.config import PiSettings
from app.modules.pi_agent.tools import CheckedAnswer, definitions
from test_pi_agent_tools import fixture_tools, source


def evidence(number=1, text="记录包含17项。\n随后增加3项。\n"):
    return Evidence(id=number, source_id=f"source-{number}", modality="doc", file_name="记录.txt",
                    content=text, version="v1", observation="parsed_text")


def draft():
    return CheckedAnswer(answer="**结果**\n原有17项[1]。\n新增3项[1]。", evidence_ids=[1],
        statements=[{"unit_id": "a1", "kind": "formatting"},
                    {"unit_id": "a2", "kind": "fact", "source_spans": ["e1s1"]},
                    {"unit_id": "a3", "kind": "fact", "source_spans": ["e1s2"]}]).model_dump()


def test_delivered_units_preserve_original_unicode_text_and_stable_source_identity():
    original = "第一行🔎\r\n\nCafe\u0301 " + "文本" * 700 + "\n"
    item = evidence(text=original)
    payload = evidence_payload(item)
    assert "content" not in payload and item.content == original
    covered = set()
    for unit in payload["content_units"]:
        assert original[unit["start"]:unit["end"]] == unit["text"]
        assert not covered.intersection(range(unit["start"], unit["end"]))
        covered.update(range(unit["start"], unit["end"]))
    assert all(index in covered for index, char in enumerate(original) if not char.isspace())
    assert evidence_units(item) == payload["content_units"]


@pytest.mark.parametrize("change,code", [
    ("missing", "incomplete_statements"), ("duplicate", "incomplete_statements"),
    ("invented", "incomplete_statements"), ("unread", "unavailable_support"),
    ("wrong_span", "unavailable_support"), ("no_support", "missing_support"),
    ("relabel_fact", "nonfactual_citations"), ("declaration", "citation_mismatch"),
])
def test_answer_cannot_omit_statements_or_invent_source_anchors(change, code):
    args = draft()
    if change == "missing": args["statements"].pop()
    elif change == "duplicate": args["statements"].append(copy.deepcopy(args["statements"][-1]))
    elif change == "invented": args["statements"][-1]["unit_id"] = "a99"
    elif change == "unread": args["statements"][-1]["source_spans"] = ["e9s1"]
    elif change == "wrong_span": args["statements"][-1]["source_spans"] = ["e1s99"]
    elif change == "no_support": args["statements"][-1]["source_spans"] = []
    elif change == "relabel_fact": args["statements"][-1]["kind"] = "limitation"
    else: args["evidence_ids"] = [1, 2]
    result = assess_answer(args, {1: evidence()})
    assert not result["protocol_valid"]
    assert code in {error["code"] for error in result["errors"]}


def test_global_citation_identity_does_not_allow_crossed_statement_sources():
    args = CheckedAnswer(answer="甲有17项[1]。\n乙有3项[2]。", evidence_ids=[1, 2], statements=[
        {"unit_id": "a1", "kind": "fact", "source_spans": ["e2s1"]},
        {"unit_id": "a2", "kind": "fact", "source_spans": ["e1s1"]}]).model_dump()
    result = assess_answer(args, {1: evidence(1), 2: evidence(2)})
    assert not result["protocol_valid"]
    assert {error["code"] for error in result["errors"]} == {"statement_citation_mismatch"}


@pytest.mark.parametrize("markers,recognized,unavailable", [
    ("[1,2]", [], []), ("[e1s1,e2s1]", [], []), ("[1][9]", [1, 9], [9]),
])
def test_rejected_citations_explain_syntax_and_actual_identity_without_rewriting(markers, recognized, unavailable):
    args = CheckedAnswer(answer=f"两条记录{markers}。", evidence_ids=[1, 2], statements=[
        {"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1", "e2s1"]}]).model_dump()
    original = copy.deepcopy(args)
    delivered = {1: evidence(1), 2: evidence(2)}
    report = assess_answer(args, delivered)
    assert not report["protocol_valid"] and args == original
    mismatch = next(error for error in report["errors"] if error["code"] == "citation_mismatch")
    assert mismatch["recognized_evidence_ids"] == recognized
    assert mismatch["declared_evidence_ids"] == [1, 2]
    assert mismatch["unavailable_evidence_ids"] == unavailable
    assert "[1][2]" in mismatch["message"] and "[1,2]" in mismatch["message"]
    unit = next(error for error in report["errors"] if error["code"] == "statement_citation_mismatch")
    assert unit["unit_id"] == "a1"
    assert unit["recognized_evidence_ids"] == recognized
    assert unit["selected_source_evidence_ids"] == [1, 2]
    assert unit["citation_format_example"] == "[1][2]"
    # Only the Agent's new submission changes the prose. Identity acceptance
    # still does not establish semantic support for the selected sources.
    revised = {**args, "answer": "两条记录[1][2]。"}
    accepted = assess_answer(revised, delivered)
    assert accepted["protocol_valid"] and args == original
    assert "not independently verified" in accepted["semantic_support"]


@pytest.mark.asyncio
async def test_check_and_submit_return_actionable_citation_feedback_then_accept_agent_revision(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path)
    await tools.execute("read", "read_source", {"source_id": source().id})
    args = {"answer": "实际原文[e1s1]", "evidence_ids": [1], "statements": [
        {"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]}
    original = copy.deepcopy(args)
    checked = await tools.execute("check", "check_answer", args)
    check_report = json.loads(checked["content"][0]["text"])
    assert check_report["status"] == "needs_revision"
    rejected = await tools.execute("submit-bad", "submit_answer", args)
    assert rejected["isError"] and not tools.final_result
    message = rejected["details"]["message"]
    submit_report = json.loads(message[message.index("{"):])
    assert submit_report["errors"] == check_report["errors"]
    assert submit_report["errors"][0]["recognized_evidence_ids"] == []
    assert submit_report["errors"][0]["declared_evidence_ids"] == [1]
    assert "[1][2]" in submit_report["errors"][0]["message"]
    final = await tools.execute("submit-revised", "submit_answer", {**args, "answer": "实际原文[1]"})
    assert final["details"]["terminal"] == "completed"
    assert final["details"]["answer"] == "实际原文[1]"
    assert final["details"]["citations"][0]["content"] == "实际原文"
    assert args == original and len(store.evidence(run)) == 1
    assert any(kind == "tool.failed" and data["code"] == "citation_mismatch" for kind, data in events)


def test_not_found_does_not_accept_unbacked_facts_or_hide_them_in_limitations():
    args = CheckedAnswer(answer="所有资料都不含公司财务信息。", outcome="not_found", status="partial",
        limitations=["所有资料都不含公司财务信息。"], statements=[
            {"unit_id": "a1", "kind": "fact"}, {"unit_id": "l1", "kind": "fact"}]).model_dump()
    result = assess_answer(args, {})
    assert not result["protocol_valid"]
    assert {"missing_support", "not_found_factual_assertion", "fact_in_limitations"} <= {e["code"] for e in result["errors"]}
    args.update(answer="本次未找到支持该结论的依据。", limitations=["尚未逐页通读原文。"], statements=[
        {"unit_id": "a1", "kind": "abstention", "source_spans": []},
        {"unit_id": "l1", "kind": "limitation", "source_spans": []}])
    assert assess_answer(args, {})["protocol_valid"]


def test_declared_length_is_measured_without_rewriting_or_truncating_the_answer():
    args = draft()
    original = args["answer"]
    args["max_characters"] = character_count(original) - 1
    result = assess_answer(args, {1: evidence()})
    assert result["errors"][-1]["code"] == "answer_too_long"
    assert args["answer"] == original
    args["max_characters"] += 1
    assert assess_answer(args, {1: evidence()})["protocol_valid"]
    assert character_count("**中a🔎** [12]\n") == 3


def test_identity_validation_does_not_claim_semantic_entailment():
    args = draft()
    args["answer"] = args["answer"].replace("17", "99")
    result = assess_answer(args, {1: evidence()})
    assert result["protocol_valid"]
    assert "not independently verified" in result["semantic_support"]
    # The contract does not pretend that a valid source pointer proves 99.
    assert "17" in result["statements"][1]["source_spans"][0]["text"]


@pytest.mark.parametrize("anchor", ["e0s1", "e1s0", "e1s1\n", "e1s1 extra", "e" + "1" * 30 + "s1"])
def test_source_anchor_schema_rejects_malformed_or_unbounded_identifiers(anchor):
    args = draft()
    args["statements"][1]["source_spans"] = [anchor]
    with pytest.raises(ValidationError):
        CheckedAnswer.model_validate(args)


@pytest.mark.asyncio
async def test_draft_check_is_nonterminal_and_submission_persists_exact_bindings(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path, requirement_limit=4)
    read = await tools.execute("read", "read_source", {"source_id": source().id})
    body = json.loads(read["content"][0]["text"])
    unit = body["evidence"][0]["content_units"][0]
    args = {"answer": "实际原文[1]", "evidence_ids": [1]}
    checked = await tools.execute("check", "check_answer", args)
    report = json.loads(checked["content"][0]["text"])
    assert report["status"] == "needs_revision" and report["answer_units"][0]["id"] == "a1"
    assert not tools.final_result and len(store.evidence(run)) == 1
    args["statements"] = [{"unit_id": "a1", "kind": "fact", "source_spans": [unit["id"]]}]
    args["max_characters"] = 4
    final = await tools.execute("submit", "submit_answer", args)
    assert final["details"]["terminal"] == "completed"
    assert final["details"]["answer"] == args["answer"]
    support = final["details"]["answer_checks"]["statements"][0]["source_spans"][0]
    assert support["evidence_id"] == 1 and support["version"] == "v1"
    assert store.evidence(run)[0].content[support["start"]:support["end"]] == "实际原文"
    assert final["details"]["citations"][0]["content"] == "实际原文"
    assert any(kind == "tool.completed" and data["name"] == "check_answer" for kind, data in events)


@pytest.mark.asyncio
async def test_numbered_source_units_cannot_exceed_the_charged_output_size(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, RunBudget(tool_output_chars=100000))
    for index in range(99):
        store.add_evidence(run, evidence(text=f"earlier observation {index}"))
    async def many_lines(s, **kwargs):
        return [evidence(text="短行\n" * 400).model_copy(update={"source_id": s.id})], {"status": "ok"}
    tools.gateway.read = many_lines
    result = await tools.execute("many-lines", "read_source", {"source_id": source().id})
    assert not result.get("isError")
    assert result["details"]["evidence_ids"] == [100]
    assert tools.ledger.tool_output_chars >= len(result["content"][0]["text"])


@pytest.mark.asyncio
async def test_rejected_submission_returns_measured_units_and_rewrite_target(tmp_path):
    tools, *_ = fixture_tools(tmp_path, requirement_limit=10)
    await tools.execute("read", "read_source", {"source_id": source().id})
    answer = "一段中的第一句。第二句仍在同一行[1]。\n\n另一段[1]。"
    args = {"answer": answer, "evidence_ids": [1], "max_characters": 10, "statements": []}
    result = await tools.execute("too-long", "submit_answer", args)
    assert result["isError"] and not tools.final_result
    message = result["details"]["message"]
    report = json.loads(message[message.index("{"):])
    assert [unit["unit_id"] for unit in report["units"]] == ["a1", "a2"]
    assert sum(unit["characters"] for unit in report["units"]) == character_count(answer)
    assert report["over_by"] == character_count(answer) - 10
    assert report["suggested_body_characters"] < report["declared_max_characters"] == 10
    assert args["answer"] == answer and args["max_characters"] == 10


@pytest.mark.asyncio
async def test_rejected_experimental_contract_is_disabled_on_the_normal_pi_path(tmp_path, monkeypatch):
    monkeypatch.delenv("PI_AGENT_ANSWER_CHECKS_ENABLED", raising=False)
    assert PiSettings(_env_file=None).answer_checks_enabled is False
    normal = {tool["name"]: tool for tool in definitions()}
    candidate = {tool["name"]: tool for tool in definitions(True)}
    assert "check_answer" not in normal and "check_answer" in candidate
    assert "set_answer_requirements" not in normal and "set_answer_requirements" in candidate
    assert len(normal) == 9
    assert "statements" not in normal["submit_answer"]["parameters"]["properties"]
    assert "statements" in candidate["submit_answer"]["parameters"]["properties"]
    tools, *_ = fixture_tools(tmp_path, answer_checks_enabled=False)
    read = await tools.execute("read", "read_source", {"source_id": source().id})
    item = json.loads(read["content"][0]["text"])["evidence"][0]
    assert item["content"] == "实际原文" and "content_units" not in item
    blocked = await tools.execute("check", "check_answer", {"answer": "实际原文[1]", "evidence_ids": [1]})
    assert blocked["isError"] and blocked["details"]["code"] == "invalid_tool"
    final = await tools.execute("submit", "submit_answer", {"answer": "实际原文[1]", "evidence_ids": [1]})
    assert final["details"]["terminal"] == "completed" and "answer_checks" not in final["details"]
