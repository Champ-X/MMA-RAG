"""Completion tracks requested results, independently of ordinary source notes."""
import copy
import json

import pytest

from test_pi_agent_tools import fixture_tools, request, source


async def ready_source(tools):
    item = {"id": "choice", "requirement": "挑选合适的场地", "quote": "挑选合适的场地"}
    assert not (await tools.execute("plan", "update_answer_plan", {"items": [item]})).get("isError")
    await tools.execute("read", "read_source", {"source_id": source().id})
    item.update(status="ready", evidence_ids=[1])
    assert not (await tools.execute("ready", "update_answer_plan", {"items": [item]})).get("isError")
    return item


@pytest.mark.asyncio
@pytest.mark.parametrize("checked", [False, True])
async def test_source_scope_note_cannot_downgrade_ready_results_and_agent_can_revise(tmp_path, checked):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=checked, answer_plan_enabled=True,
        req=request(message="依据当前记录挑选合适的场地"))
    await ready_source(tools)
    note = "建议基于当前记录，不代表实地认证。"
    answer = "推荐甲场地[1]。\n说明：" + note
    args = {"answer": answer, "evidence_ids": [1], "status": "partial", "limitations": [note]}
    if checked:
        args["statements"] = [{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]},
                              {"unit_id": "a2", "kind": "limitation"},
                              {"unit_id": "l1", "kind": "limitation"}]
        report = await tools.execute("check", "check_answer", args)
        assert "answer_status_mismatch" in {e["code"] for e in json.loads(report["content"][0]["text"])["errors"]}
    original = copy.deepcopy(args)
    rejected = await tools.execute("bad-status", "submit_answer", args)
    assert rejected["details"]["code"] == "answer_status_mismatch"
    assert not tools.final_result and args == original
    assert rejected["details"]["rejected_answer_span_id"] == "tool:bad-status"
    assert store.get(run)["state"]["answer_plan"]["items"][0]["status"] == "ready"
    revised = {**args, "status": "completed", "limitations": []}
    if checked:
        revised["statements"] = revised["statements"][:2]
    accepted = await tools.execute("revised", "submit_answer", revised)
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["answer"] == answer, "The host does not rewrite or filter the answer"
    assert accepted["details"]["limitations"] == []
    assert len(accepted["details"]["citations"]) == 1


@pytest.mark.asyncio
async def test_general_notes_cannot_be_attached_as_delivery_gaps_even_to_completed_results(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="挑选合适的场地"))
    await ready_source(tools)
    rejected = await tools.execute("bad-notes", "submit_answer", {"answer": "推荐甲[1]。", "evidence_ids": [1],
        "limitations": ["仅检查了现有资料。"]})
    assert rejected["details"]["code"] == "answer_delivery_gap"
    assert tools.final_result is None


@pytest.mark.asyncio
async def test_partially_delivered_requirement_keeps_evidence_and_cannot_claim_completed(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="依据原始记录给出甲乙丙三地的收入数值"))
    item = {"id": "figures", "requirement": "甲乙丙三地的收入数值", "quote": "甲乙丙三地的收入数值"}
    await tools.execute("plan", "update_answer_plan", {"items": [item]})
    await tools.execute("read", "read_source", {"source_id": source().id})
    gap = "本次未取得丙地的收入数值。"
    item.update(status="incomplete", evidence_ids=[1], gap=gap)
    update = await tools.execute("partly-covered", "update_answer_plan", {"items": [item]})
    assert not update.get("isError")
    assert json.loads(update["content"][0]["text"])["retained_evidence"][0]["id"] == 1
    assert store.get(run)["state"]["answer_plan"]["items"][0]["status"] == "incomplete"
    args = {"answer": "甲地120，乙地80[1]。", "evidence_ids": [1]}
    assert (await tools.execute("fake-complete", "submit_answer", args))["details"]["code"] == "answer_delivery_gap"
    for notes in [[], ["只读了部分资料。"], [gap, "没有覆盖全部原始记录。"]]:
        rejected = await tools.execute("wrong-gap-" + str(len(notes)), "submit_answer", {
            **args, "status": "partial", "limitations": notes})
        assert rejected["details"]["code"] == "answer_delivery_gap" and tools.final_result is None
    accepted = await tools.execute("honest-partial", "submit_answer", {**args, "status": "partial", "limitations": [gap]})
    assert accepted["details"]["terminal"] == "partial"
    assert accepted["details"]["limitations"] == [gap]
    assert len(accepted["details"]["citations"]) == 1


@pytest.mark.asyncio
async def test_missing_explicit_condition_is_not_downgraded_to_a_source_note(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="挑选合适的场地，并提供该场地的有效认证编号"))
    choice = await ready_source(tools)
    gap = "本次未取得所选场地的有效认证编号。"
    condition = {"id": "certification", "requirement": "有效认证编号", "quote": "有效认证编号",
                 "status": "unavailable", "gap": gap}
    assert not (await tools.execute("condition", "update_answer_plan", {"items": [choice, condition]})).get("isError")
    args = {"answer": "甲场地匹配需求[1]。", "evidence_ids": [1]}
    assert (await tools.execute("completed", "submit_answer", args))["details"]["code"] == "answer_delivery_gap"
    accepted = await tools.execute("partial", "submit_answer", {**args, "status": "partial", "limitations": [gap]})
    assert accepted["details"]["terminal"] == "partial"


@pytest.mark.asyncio
@pytest.mark.parametrize("change,code", [
    ({"gap": ""}, "invalid_answer_plan"),
    ({"evidence_ids": []}, "answer_plan_evidence_missing"),
    ({"status": "ready"}, "invalid_answer_plan"),
])
async def test_incomplete_requires_existing_results_and_a_specific_gap(tmp_path, change, code):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="挑选合适的场地"))
    item = await ready_source(tools)
    before = copy.deepcopy(tools.answer_plan)
    item.update(status="incomplete", gap="缺少用户要求的容量信息。")
    item.update(change)
    rejected = await tools.execute("invalid", "update_answer_plan", {"items": [item]})
    assert rejected["details"]["code"] == code
    assert tools.answer_plan == before
