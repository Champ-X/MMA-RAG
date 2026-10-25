"""Research updates preserve user requirements without freezing Agent mistakes."""
import copy
import json

import pytest

from app.modules.pi_agent.answers import evidence_units
from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.plan import bind_plan, retained_evidence, validate_delivery
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.tools import UpdateAnswerPlan
from test_pi_agent_tools import request


def bind(items, previous=None, *, reason="", delivered=None):
    args = UpdateAnswerPlan(items=items, revision_reason=reason).model_dump()
    return bind_plan(args["items"], request(message="选一首歌和一张图").model_dump(), previous, delivered or {},
                     retained_spans=args["retained_spans"], revision_reason=args["revision_reason"])


def items():
    return [{"id": "song", "requirement": "推荐歌曲", "quote": "一首歌", "modality": "audio"},
            {"id": "image", "requirement": "推荐图片", "quote": "一张图", "modality": "image"}]


def test_partial_item_update_preserves_other_requirements_and_original_state():
    original = bind(items())
    snapshot = copy.deepcopy(original)
    changed = {**items()[0], "research_state": {"current_candidates": ["song-a"],
        "verified_conditions": ["器乐"], "open_questions": ["是否明快"], "next_observation": "核实候选的节奏"}}
    updated = bind([changed], original)
    assert original == snapshot
    assert [item["id"] for item in updated["items"]] == ["song", "image"]
    assert updated["items"][1] == original["items"][1]
    assert updated["items"][0]["research_state"]["open_questions"] == ["是否明快"]
    assert updated["items"][0]["gap"] == ""
    with pytest.raises(ToolError) as error:
        validate_delivery({"status": "completed", "limitations": [], "outcome": "answer"}, updated)
    assert error.value.code == "answer_delivery_incomplete"


def test_interpretation_revision_is_explicit_audited_and_cannot_rewrite_user_quote():
    original = bind(items())
    revised = {**items()[0], "requirement": "根据需要推荐音乐素材", "modality": "any"}
    with pytest.raises(ToolError) as error:
        bind([revised], original)
    assert error.value.code == "answer_plan_locked"
    updated = bind([revised], original, reason="用户未要求仅从音频文件取得判断依据")
    assert updated["items"][0]["modality"] == "any"
    assert updated["items"][1] == original["items"][1]
    revision = updated["interpretation_revisions"][0]
    assert revision["reason"] == "用户未要求仅从音频文件取得判断依据"
    assert {change["field"] for change in revision["changes"]} == {"requirement", "modality"}
    assert all(change["id"] == "song" for change in revision["changes"])
    assert bind([revised], updated)["interpretation_revisions"] == updated["interpretation_revisions"]
    with pytest.raises(ToolError) as error:
        bind([{**revised, "quote": "一张图"}], updated, reason="试图改写原要求")
    assert error.value.code == "answer_plan_locked"


def test_reordering_partial_items_cannot_reorder_or_remove_registered_requirements():
    original = bind(items())
    changed = bind(list(reversed(items())), original)
    assert changed == original
    renamed = bind([{**items()[0], "id": "new_song"}], original)
    assert [item["id"] for item in renamed["items"]] == ["song", "image", "new_song"]
    assert renamed["items"][:2] == original["items"]


def test_research_notes_do_not_become_limitations_or_evidence():
    original = bind([items()[0]])
    changed = {**items()[0], "status": "ready", "research_state": {"verified_conditions": ["已有足够依据"]}}
    with pytest.raises(ToolError) as error:
        bind([changed], original)
    assert error.value.code == "answer_plan_evidence_missing"


def test_modality_rejection_identifies_requirement_and_each_wrong_primary_evidence():
    delivered = {number: Evidence(id=number, source_id=f"source-{number}", modality=modality,
        file_name=f"file-{number}", content="实际证据", version="v1", observation="caption")
        for number, modality in [(1, "image"), (2, "video"), (3, "audio"), (4, "doc")]}
    selected = {**items()[0], "evidence_ids": [1, 2, 3], "supporting_evidence_ids": [4]}
    with pytest.raises(ToolError) as error:
        bind([selected], delivered=delivered)
    assert error.value.code == "answer_plan_modality"
    feedback = json.loads(str(error.value).split("错配：", 1)[1])
    assert feedback == {"item_id": "song", "expected_modality": "audio", "mismatched_evidence": [
        {"evidence_id": 1, "modality": "image"}, {"evidence_id": 2, "modality": "video"}]}
    corrected = {**selected, "evidence_ids": [3], "supporting_evidence_ids": [1, 2, 4]}
    assert bind([corrected], delivered=delivered)["items"][0]["evidence_ids"] == [3]


@pytest.mark.parametrize("checked", [False, True])
def test_retained_media_preserves_sampling_version_and_continuation_boundaries(checked):
    evidence = Evidence(id=7, source_id="video-a", modality="video", file_name="video.mp4",
        content="开头🔎观察结果。后半段待核实。", version="generated-observation-v2", observation="media_observation",
        locator={"start_sec": 30, "end_sec": 60, "duration_seconds": 180,
            "sampled_seconds": [30, 36, 42, 48, 54, 59], "view": "visual", "has_audio": True,
            "next_start_sec": 60, "observed_intervals": [{"start_sec": 30, "end_sec": 60}]},
        provenance={"source_version": "source-v1", "record_version": "record-v3", "truncated": True,
            "question": "该区间是否出现目标？", "observation_key": "observation-v1",
            "calls": [{"usage": {"total_tokens": 5000}}], "usage": {"total_tokens": 5000}},
        citation={"type": "video", "media_info": {"duration": 180}})
    original = evidence.model_dump()
    start, end = 3, len(evidence.content) - 2
    plan = {"items": [{"evidence_ids": [7], "supporting_evidence_ids": []}],
        "retained_spans": [{"evidence_id": 7, "start": start, "end": end}]}
    retained = retained_evidence(plan, {7: evidence}, checked=checked)[0]
    assert retained["locator"] == evidence.locator
    for key in ("source_version", "record_version", "truncated", "question", "observation_key"):
        assert retained["provenance"][key] == evidence.provenance[key]
    assert "citation" not in retained
    assert not {"calls", "usage"} & retained["provenance"].keys()
    if checked:
        assert {unit["id"] for unit in retained["content_units"]} <= {unit["id"] for unit in evidence_units(evidence)}
        assert "".join(unit["text"] for unit in retained["content_units"]) == evidence.content[start:end]
        for unit in retained["content_units"]:
            assert unit["text"] == evidence.content[unit["start"]:unit["end"]]
    else:
        assert retained["content"] == evidence.content[start:end]
    assert retained["retained_range"] == {"start": start, "end": end,
        "original_characters": len(evidence.content), "truncated": True}
    assert evidence.model_dump() == original


@pytest.mark.parametrize("checked", [False, True])
def test_retained_document_preserves_text_origin_and_source_continuation(checked):
    evidence = Evidence(id=1, source_id="doc-a", modality="doc", file_name="document.pdf",
        content="模型生成的图注。", version="evidence-v1", observation="parsed_text",
        locator={"chunk_index": 2, "page_number": 4, "text_start": 200, "text_end": 208,
            "returned_chars": 8, "total_chars": 800, "source_start": 1000, "source_end": 1800},
        provenance={"source_version": "source-v1", "record_version": "record-v1", "truncated": True,
            "text_origin": {"version": 1, "generated_spans": [{"start": 0, "end": 8}],
                "unmarked_text": "unclassified"}, "content_types": ["parsed_text"]})
    plan = {"items": [{"evidence_ids": [1], "supporting_evidence_ids": []}]}
    retained = retained_evidence(plan, {1: evidence}, checked=checked)[0]
    assert retained["locator"] == evidence.locator
    assert retained["provenance"] == evidence.provenance
    assert retained["retained_range"]["truncated"] is False
    assert retained["provenance"]["truncated"] is True
    if checked:
        assert retained["content_units"] == evidence_units(evidence)
        assert retained["content_units"][0]["origin"] == "generated_caption"
