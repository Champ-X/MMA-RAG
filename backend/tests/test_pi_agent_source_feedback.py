"""Expose selected generated descriptions without pretending to judge support."""
from copy import deepcopy
import json

import pytest

from app.modules.pi_agent.answers import assess_answer, compact_assessment, evidence_units, repair_feedback
from app.modules.pi_agent.tools import CheckedAnswer
from test_pi_agent_text_origins import observed
from test_pi_agent_tools import fixture_tools, source


def selection(item, text="生成图注描述了三层[1]。", *, generated=True, kind="fact", maximum=None):
    origin = "generated_caption" if generated else "unmarked_parsed_text"
    unit = next(u for u in evidence_units(item) if u.get("origin") == origin)
    return CheckedAnswer(answer=text, evidence_ids=[1], max_characters=maximum, statements=[
        {"unit_id": "a1", "kind": kind, "source_spans": [unit["id"]]}]).model_dump()


@pytest.mark.parametrize("kind", ["fact", "inference"])
def test_selected_generated_units_are_visible_without_being_a_semantic_rejection(kind):
    item = observed("作者正文。\n[图注：图中标了三层]\nFigure 1: Three levels.")
    args = selection(item, kind=kind)
    original, original_item = deepcopy(args), item.model_dump()
    report = assess_answer(args, {1: item})
    assert report["protocol_valid"] is True and report["errors"] == []
    notice, = report["source_notices"]
    assert notice["code"] == "generated_caption_selected"
    assert notice["unit_id"] == "a1" and notice["evidence_ids"] == [1]
    assert notice["source_spans"] == args["statements"][0]["source_spans"]
    assert "生成图注" in notice["message"] and "作者正文" in notice["message"]
    assert compact_assessment(report)["source_notices"] == [notice]
    assert "not independently verified" in report["semantic_support"]
    assert args == original and item.model_dump() == original_item


def test_unused_captions_unknown_origins_and_unavailable_sources_do_not_create_notices():
    item = observed("作者正文。\n[图注：图中标了三层]\nFigure 1: Three levels.")
    report = assess_answer(selection(item, generated=False), {1: item})
    assert "source_notices" not in report
    assert "source_notices" not in compact_assessment(report)
    historical = item.model_copy(update={"provenance": {}})
    args = CheckedAnswer(answer="图注描述了三层[1]。", evidence_ids=[1], statements=[
        {"unit_id": "a1", "kind": "fact", "source_spans": ["e1s2"]}]).model_dump()
    assert "source_notices" not in assess_answer(args, {1: historical})
    args["statements"][0]["source_spans"] = ["e99s1"]
    missing = assess_answer(args, {1: item})
    assert not missing["protocol_valid"] and "source_notices" not in missing


def test_length_rejection_keeps_origin_feedback_and_the_original_draft():
    item = observed("正文\n[图注：图中标了三层]")
    args = selection(item, maximum=4)
    original = deepcopy(args)
    report = assess_answer(args, {1: item})
    feedback = repair_feedback(report)
    assert not report["protocol_valid"]
    assert feedback["source_notices"] == report["source_notices"]
    assert feedback["source_notices_truncated"] is False
    assert any(e["code"] == "answer_too_long" for e in feedback["errors"])
    assert args == original


def test_repair_notice_preview_is_bounded_without_hiding_that_more_selections_exist():
    item = observed("[图注：三层]")
    args = CheckedAnswer(answer="\n".join("生成图注描述了三层[1]。" for _ in range(20)), evidence_ids=[1],
        max_characters=4, statements=[{"unit_id": f"a{i}", "kind": "fact", "source_spans": ["e1s1"]}
            for i in range(1, 21)]).model_dump()
    report = assess_answer(args, {1: item})
    feedback = repair_feedback(report)
    assert len(report["source_notices"]) == 20
    assert 0 < len(feedback["source_notices"]) < 20
    assert feedback["source_notices_truncated"] is True
    assert feedback["source_notice_count"] == 20
    assert len(json.dumps(feedback, ensure_ascii=False)) < 6000


def test_a_clipped_span_preview_preserves_the_full_selected_evidence_set():
    delivered = {i: observed(f"[图注：第{i}幅示意]").model_copy(update={"id": i}) for i in range(1, 11)}
    args = CheckedAnswer(answer="图注包含示意" + "".join(f"[{i}]" for i in delivered),
        evidence_ids=list(delivered), max_characters=4, statements=[
            {"unit_id": "a1", "kind": "fact", "source_spans": [f"e{i}s1" for i in delivered]}]).model_dump()
    report = assess_answer(args, delivered)
    preview = repair_feedback(report)["source_notices"][0]
    assert preview["source_spans_truncated"] is True and preview["source_span_count"] == 10
    assert set(preview["source_spans"]) < set(report["source_notices"][0]["source_spans"])
    assert preview["evidence_ids"] == list(delivered)


@pytest.mark.asyncio
async def test_real_tool_check_rejection_and_submission_keep_the_selected_source_notice(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, requirement_limit=6)
    tools.emit = lambda kind, data, **kw: store.append(run, kind, data, **kw)
    item = observed("作者正文。\n[图注：图中标了三层]")
    async def read(*_args, **_kwargs):
        return [item], {"status": "ok"}
    tools.gateway.read = read
    await tools.execute("read", "read_source", {"source_id": source().id})
    args = selection(store.evidence(run)[0])
    checked = await tools.execute("check", "check_answer", args)
    report = json.loads(checked["content"][0]["text"])
    notice, = report["source_notices"]
    assert report["protocol_valid"] is False and not tools.final_result
    assert store.artifact(run, checked["details"]["artifact_id"])["source_notices"] == [notice]
    rejected = await tools.execute("too-long", "submit_answer", args)
    assert rejected["isError"] and rejected["details"]["code"] == "answer_too_long"
    message = rejected["details"]["message"]
    feedback = json.loads(message[message.index("{"):])
    assert feedback["source_notices"] == [notice]
    revised = {**args, "answer": "图注述三层[1]。"}
    accepted = await tools.execute("revised", "submit_answer", revised)
    assert not accepted.get("isError"), accepted
    assert accepted["details"]["answer"] == revised["answer"]
    assert accepted["details"]["answer_checks"]["source_notices"] == [notice]
    events = store.events(run)
    assert any(e["type"] == "tool.failed" and e["data"]["code"] == "answer_too_long" for e in events)
    assert next(e for e in events if e["type"] == "answer.accepted")["data"]["answer_checks"]["source_notices"] == [notice]
    assert len(store.evidence(run)) == 1 and store.evidence(run)[0].content == item.content
