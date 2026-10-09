"""Execution contracts, not claims about native model semantic accuracy."""
import asyncio
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.jev import JevError
from app.modules.retrieval.processors import intent as intent_module
from app.modules.retrieval.processors import decision_plan as plan_module
from app.modules.retrieval.processors.decision_plan import (
    PROPOSAL_INSTRUCTION, prepare_verification, verify_plan,
)


@pytest.fixture(autouse=True)
def admitted_test_profile(monkeypatch):
    # Execution mechanics use an explicit fixture; real admission/identity
    # boundaries are tested independently in test_decision_profiles.py.
    monkeypatch.setattr(plan_module, "decision_profile", lambda metadata, action: {
        "id": "test-only", "purpose": "source_" + action, "threshold": .85,
        "execution": "apply", "status": "admitted",
    })


def proposal(kind="image", action="forbid", span="不要图片", *, identifier="p1", scope="global", provenance="current_user"):
    return {"id": identifier, "target": {"modality": kind, "scope": scope, "description": "现有媒体来源"},
            "action": action, "source_span": span, "provenance": provenance}


def baseline(*proposals):
    return {"intent_type": "comparison", "is_complex": True, "visual_intent": "explicit_demand",
            "audio_intent": "unnecessary", "video_intent": "unnecessary", "sub_queries": ["A", "B"],
            "search_strategies": {"dense_query": "resolved", "multi_view_queries": ["q1", "q2"]},
            "source_proposals": list(proposals)}


def response(questions, decisions=None):
    decisions = decisions or {}
    answers = {}
    for key in questions:
        choice, probability = decisions.get(key, ("verified", .95))
        answers[key] = {"type": "choice", "choice": choice, "confidence": .01,
                        "probabilities": {name: probability if name == choice else (1 - probability) / 2
                                          for name in ("verified", "contradicted", "unresolved")}}
    return SimpleNamespace(answers=answers, metadata=lambda: {"model": "test", "route": "typesafe", "duration_s": .1})


def client(decisions=None):
    async def evaluate(state, questions, **kwargs):
        return response(questions, decisions)
    return SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate))


@pytest.mark.asyncio
async def test_one_request_applies_independent_actions_after_preserving_the_plan():
    original = baseline(proposal(), proposal("audio", "require", "找会议录音", identifier="p2"))
    frozen = deepcopy(original)
    evaluator = client()
    result = await verify_plan("不要图片；找会议录音并比较 A 和 B", original, client_factory=lambda: evaluator)
    assert original == frozen
    assert result["visual_intent"] == "unnecessary" and result["audio_intent"] == "explicit_demand"
    assert result["search_strategies"] == frozen["search_strategies"]
    assert result["sub_queries"] == frozen["sub_queries"]
    assert result["decision_plan"]["baseline_snapshot"]["visual_intent"] == "explicit_demand"
    assert result["decision_plan"]["applied_ids"] == ["p1", "p2"]
    assert not result["jev_decision"]["accepted"]
    assert result["jev_decision"]["partially_applied"]
    assert "planning" not in result["decision_requirements"]
    assert all(row["action"] == "adopted" for row in result["decision_requirements"]["modalities"].values())
    evaluator.evaluate.assert_awaited_once()
    assert set(evaluator.evaluate.call_args.args[1]) == {"p0", "p1"}


@pytest.mark.asyncio
async def test_unchanged_forbid_still_becomes_an_enforced_constraint():
    original = baseline(proposal())
    original["visual_intent"] = "unnecessary"
    result = await verify_plan("不要图片", original, client_factory=client)
    action = result["decision_plan"]["actions"][0]
    assert action["applied"] and not action["changed"]
    assert result["decision_requirements"]["modalities"]["image"]["status"] == "forbidden"


@pytest.mark.asyncio
@pytest.mark.parametrize("proposals,query,reason", [
    ([], "q", "no_proposals"),
    ([proposal(span="来自历史的排除")], "继续", "ungrounded_source_span"),
    ([proposal(provenance="history")], "不要图片", "non_current_user_provenance"),
    ([proposal(provenance="attachment")], "不要图片", "non_current_user_provenance"),
    ([proposal(scope="object")], "不要图片中的水印", "object_scope_not_executable"),
    ([proposal(), proposal(identifier="p1")], "不要图片", "duplicate_proposal_id"),
    ([proposal(), proposal(action="require", identifier="p2")], "不要图片", "conflicting_global_proposals"),
    ([{"bad": True}], "q", "invalid_target"),
])
async def test_invalid_or_non_executable_proposals_do_not_create_client(proposals, query, reason):
    original = baseline(*proposals)
    result = await verify_plan(query, original, client_factory=lambda: pytest.fail("unnecessary request"))
    assert result["visual_intent"] == original["visual_intent"]
    assert "decision_requirements" not in result
    receipt = result["decision_plan"]
    assert receipt["request_count"] == 0
    assert reason == (receipt["actions"][0]["reason"] if receipt["actions"] else receipt["reason"])


@pytest.mark.asyncio
@pytest.mark.parametrize("choice,probability", [("contradicted", .99), ("unresolved", .99), ("verified", .849)])
async def test_each_uncertain_or_rejected_action_keeps_baseline_without_blocking_other_actions(choice, probability):
    result = await verify_plan("不要图片，找会议录音", baseline(proposal(), proposal("audio", "require", "找会议录音", identifier="p2")),
                               client_factory=lambda: client({"p0": (choice, probability)}))
    assert result["visual_intent"] == "explicit_demand"
    assert result["audio_intent"] == "explicit_demand"
    assert result["decision_plan"]["applied_ids"] == ["p2"]


@pytest.mark.asyncio
async def test_quoted_literal_is_not_authority_even_when_span_is_exact():
    query = '解释代码字符串 "不要图片" 的作用'
    evaluator = client({"p0": ("contradicted", .99)})
    result = await verify_plan(query, baseline(proposal()), client_factory=lambda: evaluator)
    assert not result["decision_plan"]["actions"][0]["applied"]
    rule = evaluator.evaluate.call_args.args[1]["p0"]["instructions"]["rule"]
    assert "literal span proves location only" in rule and "whole current_query" in rule


@pytest.mark.asyncio
async def test_complete_batch_validation_precedes_any_effect():
    async def incomplete(state, questions, **kwargs):
        result = response(questions)
        del result.answers["p1"]
        return result
    original = baseline(proposal(), proposal("audio", "require", "找录音", identifier="p2"))
    result = await verify_plan("不要图片，找录音", original,
                               client_factory=lambda: SimpleNamespace(evaluate=AsyncMock(side_effect=incomplete)))
    assert result["visual_intent"] == "explicit_demand"
    assert result["audio_intent"] == "unnecessary"
    assert result["decision_plan"]["applied_ids"] == []
    assert result["jev_decision"]["reason"] == "incomplete_answers"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,reason", [(JevError("timeout"), "timeout"), (RuntimeError("private text"), "unexpected_error")])
async def test_failure_retains_plan_with_sanitized_receipt(failure, reason):
    original = baseline(proposal())
    evaluator = SimpleNamespace(evaluate=AsyncMock(side_effect=failure))
    result = await verify_plan("不要图片", original, client_factory=lambda: evaluator)
    assert result["visual_intent"] == original["visual_intent"]
    assert result["jev_decision"]["reason"] == reason
    assert "private text" not in json.dumps(result)
    evaluator.evaluate.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_propagates_after_single_planner_without_replanning(monkeypatch):
    processor = intent_module.IntentProcessor()
    processor.jev_mode = "adaptive"
    processor._process_generative = AsyncMock(return_value=baseline(proposal()))
    evaluator = SimpleNamespace(evaluate=AsyncMock(side_effect=asyncio.CancelledError()))
    monkeypatch.setattr(intent_module, "get_jev_client", lambda: evaluator)
    with pytest.raises(asyncio.CancelledError):
        await processor.process("不要图片")
    processor._process_generative.assert_awaited_once()


@pytest.mark.asyncio
async def test_stage_deadline_cancels_and_joins_the_only_request():
    cancelled = asyncio.Event()
    async def wait_forever(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    evaluator = SimpleNamespace(timeout_s=.01, evaluate=AsyncMock(side_effect=wait_forever))
    result = await verify_plan("不要图片", baseline(proposal()), client_factory=lambda: evaluator)
    assert result["jev_decision"]["reason"] == "timeout"
    assert result["decision_plan"]["deadline_s"] == .01
    assert cancelled.is_set()
    evaluator.evaluate.assert_awaited_once()


@pytest.mark.asyncio
async def test_history_and_attachments_cannot_supply_decision_instructions(monkeypatch):
    processor = intent_module.IntentProcessor()
    processor.jev_mode = "adaptive"
    evaluator = client()
    monkeypatch.setattr(intent_module, "get_jev_client", lambda: evaluator)
    processor._process_generative = AsyncMock(return_value=baseline(proposal()))
    history = [{"role": "user", "content": "不要音频"}]
    result = await processor.process("不要图片", history, "禁止视频")
    assert evaluator.evaluate.call_args.args[0] == {"current_query": "不要图片"}
    assert set(result["decision_requirements"]["modalities"]) == {"image"}
    processor._process_generative.assert_awaited_once_with("不要图片", history, "禁止视频", include_source_proposals=True)


@pytest.mark.asyncio
async def test_proposal_schema_is_only_added_to_adaptive_planner_and_preserved_separately():
    processor = intent_module.IntentProcessor()
    processor.prompt_engine = SimpleNamespace(render_template=lambda *args, **kwargs: "original prompt")
    raw = baseline(proposal())
    processor.llm_manager = SimpleNamespace(chat=AsyncMock(return_value=SimpleNamespace(
        success=True, data={"choices": [{"message": {"content": json.dumps(raw)}}]})))
    plain = await processor._process_generative("不要图片")
    assert processor.llm_manager.chat.call_args.kwargs["messages"][1]["content"] == "original prompt"
    assert "source_proposals" not in plain
    proposed = await processor._process_generative("不要图片", include_source_proposals=True)
    assert processor.llm_manager.chat.call_args.kwargs["messages"][1]["content"] == "original prompt\n\n" + PROPOSAL_INSTRUCTION
    assert proposed["source_proposals"] == raw["source_proposals"]
    for field in ("intent_type", "is_complex", "search_strategies", "sub_queries", "visual_intent", "audio_intent", "video_intent"):
        assert proposed[field] == plain[field]


@pytest.mark.asyncio
async def test_adaptive_keeps_valid_semantic_enums_but_off_retains_keyword_behavior():
    processor = intent_module.IntentProcessor()
    processor.prompt_engine = SimpleNamespace(render_template=lambda *args, **kwargs: "original")
    raw = {"visual_intent": "unnecessary", "visual_reasoning": "MIME字面量不是图片来源需求",
           "audio_intent": "invalid", "video_intent": "unnecessary"}
    processor.llm_manager = SimpleNamespace(chat=AsyncMock(return_value=SimpleNamespace(
        success=True, data={"choices": [{"message": {"content": json.dumps(raw)}}]})))
    query = "用文字解释 image/png 和 audio 参数"
    off = await processor._process_generative(query)
    adaptive = await processor._process_generative(query, include_source_proposals=True)
    assert off["visual_intent"] == "explicit_demand"
    assert adaptive["visual_intent"] == "unnecessary"
    assert adaptive["visual_reasoning"] == raw["visual_reasoning"]
    assert adaptive["audio_intent"] == off["audio_intent"] == "explicit_demand"


@pytest.mark.parametrize("query,proposals,reason", [("q" * 4001, [], "query_outside_bounds"), ("q", [proposal()] * 7, "proposals_outside_bounds")])
def test_no_silent_truncation_of_scope_or_proposal_set(query, proposals, reason):
    _, questions, receipt = prepare_verification(query, baseline(*proposals))
    assert questions == {} and receipt["reason"] == reason
