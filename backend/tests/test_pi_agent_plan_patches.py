"""Sparse progress edits preserve requirements and all unspecified evidence."""
import copy

import pytest

from test_pi_agent_plan import make_tools, select


@pytest.mark.asyncio
async def test_sparse_item_updates_keep_other_items_evidence_and_nested_state(tmp_path):
    tools, store, rid, _, sources = make_tools(tmp_path)
    await select(tools, sources)
    before = copy.deepcopy(tools.answer_plan)
    result = await tools.execute("state", "update_answer_plan", {"items": [{"id": "cover",
        "research_state": {"current_candidates": [sources[0].id], "open_questions": ["细节待核实"]}}]})
    assert not result.get("isError"), result
    current = tools.answer_plan["items"][0]
    for field in ("requirement", "quote", "modality", "status", "evidence_ids", "supporting_evidence_ids"):
        assert current[field] == before["items"][0][field]
    assert tools.answer_plan["items"][1] == before["items"][1]
    result = await tools.execute("progress", "update_answer_plan", {"items": [{"id": "cover",
        "research_state": {"next_observation": "检查候选画面", "open_questions": []}}]})
    assert not result.get("isError"), result
    state = tools.answer_plan["items"][0]["research_state"]
    assert state["current_candidates"] == [sources[0].id] and not state["open_questions"]
    assert state["next_observation"] == "检查候选画面"
    assert store.get(rid)["state"]["answer_plan"] == tools.answer_plan


@pytest.mark.asyncio
async def test_sparse_interpretation_changes_need_reason_and_keep_quote_immutable(tmp_path):
    tools, _, _, _, sources = make_tools(tmp_path)
    await select(tools, sources)
    bad = await tools.execute("bad", "update_answer_plan", {"items": [{"id": "cover", "modality": "any"}]})
    assert bad["details"]["code"] == "answer_plan_locked"
    fixed = await tools.execute("fixed", "update_answer_plan", {"items": [{"id": "cover", "modality": "any"}],
        "revision_reason": "纠正来源类型解释"})
    assert not fixed.get("isError"), fixed
    assert tools.answer_plan["interpretation_revisions"][-1]["changes"][0]["field"] == "modality"
    bad = await tools.execute("quote", "update_answer_plan", {"items": [{"id": "cover", "quote": "主题曲"}],
        "revision_reason": "不可替换用户要求"})
    assert bad["details"]["code"] == "answer_plan_locked"


@pytest.mark.asyncio
async def test_new_item_requires_original_text_and_sparse_edits_cannot_hide_missing_evidence(tmp_path):
    tools, _, _, _, sources = make_tools(tmp_path)
    bad = await tools.execute("new", "update_answer_plan", {"items": [{"id": "unknown"}]})
    assert bad["details"]["code"] == "invalid_answer_plan" and tools.answer_plan is None
    await select(tools, sources)
    original = copy.deepcopy(tools.answer_plan)
    bad = await tools.execute("empty", "update_answer_plan", {"items": [{"id": "cover", "evidence_ids": []}]})
    assert bad["details"]["code"] == "answer_plan_evidence_missing" and tools.answer_plan == original
    bad = await tools.execute("scope", "update_answer_plan", {"items": [{"id": "cover",
        "research_state": {"current_candidates": ["outside-scope"]}}]})
    assert bad["details"]["code"] == "source_unavailable" and tools.answer_plan == original
    good = await tools.execute("clear", "update_answer_plan", {"items": [{"id": "cover", "supporting_evidence_ids": []}]})
    assert not good.get("isError")
    assert tools.answer_plan["items"][0]["supporting_evidence_ids"] == []
    assert tools.answer_plan["items"][1] == original["items"][1]
