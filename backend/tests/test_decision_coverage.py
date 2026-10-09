from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.retrieval.decision_coverage import coverage_receipt, finalize_coverage, apply_grounding_fallback
from app.modules.knowledge.router import KnowledgeRouter, RoutingResult
from app.modules.retrieval.service import RetrievalService
from app.core.decision_diagnostics import failure_diagnostics, retrieval_diagnostics
from app.core.jev_settings import JevConfig
from app.core.llm.jev import JevRequiredError


def policy():
    return {"policy_version": "decision-intent-v3", "planning": {"grounding_state": "positive", "context_signal": .01},
            "modalities": {m: {"status": "required" if m == "image" else "not_needed",
                               "signal_states": {"forbidden": "negative"}}
                           for m in ("image", "audio", "video")}}


def context():
    return SimpleNamespace(decision_requirements=policy(), target_kb_ids=["chosen"], target_file_ids=[],
                           visual_intent="explicit_demand", audio_intent="unnecessary", video_intent="implicit_enrichment")


def test_stage_coverage_distinguishes_not_searched_empty_filtered_and_context():
    ctx = context()
    raw = {"dense": [], "visual": [{"id": "i", "content_type": "image"}], "video": []}
    receipt = coverage_receipt(ctx, raw, [])
    assert receipt["modalities"]["audio"]["status"] == "not_searched"
    assert receipt["modalities"]["video"]["status"] == "no_candidates"
    assert receipt["modalities"]["image"]["status"] == "filtered"
    result = SimpleNamespace(debug_info={"decision_coverage": receipt})
    prompt = finalize_coverage(result, {"1": SimpleNamespace(content_type="image")})
    assert result.debug_info["decision_coverage"]["modalities"]["image"]["context_count"] == 1
    assert "不能推断整个知识库没有资料" in prompt
    assert receipt["modalities"]["image"]["context_count"] is None


def test_actual_retained_and_context_counts_are_deduplicated_and_not_support_claims():
    rows = [{"id": "shot", "payload": {"shot_id": "s", "caption": "keyframe"}}]
    receipt = coverage_receipt(context(), {"video": rows, "dense": rows}, rows)
    assert receipt["modalities"]["video"]["candidate_count"] == 1
    assert receipt["modalities"]["video"]["status"] == "retained"
    result = SimpleNamespace(debug_info={"decision_coverage": receipt})
    finalize_coverage(result, {})
    assert result.debug_info["decision_coverage"]["modalities"]["video"]["status"] == "not_in_context"
    assert "availability_not_sufficiency" in receipt["limitations"]


def test_off_has_no_receipt_or_prompt_mutation():
    assert coverage_receipt(SimpleNamespace(), {"audio": []}, []) == {}
    result = SimpleNamespace(debug_info={})
    assert finalize_coverage(result, {}) == ""
    assert result.debug_info == {}


def test_grounding_uses_selected_source_independently_of_output_request():
    before = {"visual_intent": "explicit_demand", "audio_intent": "unnecessary", "video_intent": "unnecessary",
              "decision_requirements": policy()}
    original = deepcopy(before)
    updated, info = apply_grounding_fallback(before, target_kb_ids=["chosen"],
        inventory={"chosen": {"text": 0, "video": 4}, "outside": {"audio": 999}})
    assert updated["visual_intent"] == "explicit_demand"
    assert updated["video_intent"] == "implicit_enrichment"
    assert updated["audio_intent"] == "unnecessary"
    assert info["additions"] == [{"kb_id": "chosen", "modality": "video", "available_count": 4}]
    assert before == original


@pytest.mark.parametrize("change", ["forbidden", "uncertain_exclusion", "unresolved_context", "no_grounding", "has_text"])
def test_grounding_abstains_when_not_justified(change):
    before = {"video_intent": "unnecessary", "decision_requirements": policy()}
    inventory = {"chosen": {"text": 0, "video": 4}}
    if change == "forbidden":
        before["decision_requirements"]["modalities"]["video"]["status"] = "forbidden"
    elif change == "uncertain_exclusion":
        before["decision_requirements"]["modalities"]["video"]["signal_states"]["forbidden"] = "uncertain"
    elif change == "unresolved_context":
        before["decision_requirements"]["planning"]["context_signal"] = .5
    elif change == "no_grounding":
        before["decision_requirements"]["planning"]["grounding_state"] = "uncertain"
    else:
        inventory["chosen"]["text"] = 4
    assert apply_grounding_fallback(before, target_kb_ids=["chosen"], inventory=inventory) == (before, {})


@pytest.mark.asyncio
async def test_explicit_files_never_receive_inventory_expansion():
    service = RetrievalService.__new__(RetrievalService)
    service.kb_router = SimpleNamespace(get_modality_inventory=AsyncMock())
    before = {"decision_requirements": policy()}
    updated, receipt = await service._prepare_target_modality(before, SimpleNamespace(target_kb_ids=["chosen"]),
                                                            selected_files=[{"file_id": "f"}])
    assert receipt == {}
    assert not any(key in updated for key in ("visual_intent", "audio_intent", "video_intent"))
    service.kb_router.get_modality_inventory.assert_not_awaited()


def test_decision_routes_append_with_bound_and_preserve_semantic_routes():
    router = KnowledgeRouter.__new__(KnowledgeRouter)
    base = RoutingResult(["anchor", "plot"], {"anchor": 1., "plot": .9}, "dual_kb", 4, 0)
    scores = {"anchor": .7, "plot": .6, "music": .5, "irrelevant": .01}
    inventory = {"anchor": {"image": 5}, "plot": {"video": 7}, "music": {"audio": 6}, "irrelevant": {"audio": 99}}
    result = router._cover_requested_modalities(base, scores, max_targets=2,
        modality_intents={"image": "explicit_demand", "audio": "explicit_demand"}, inventory=inventory, append_only=True)
    assert result.target_kb_ids == ["anchor", "plot", "music"]
    assert base.target_kb_ids == ["anchor", "plot"]
    assert result.routing_details["append_only"]
    full = RoutingResult(["anchor", "plot", "irrelevant"], {}, "multi_kb", 4, 0)
    result = router._cover_requested_modalities(full, scores, max_targets=3,
        modality_intents={"audio": "explicit_demand"}, inventory={"music": {"audio": 5}}, append_only=True)
    assert result is full


def test_strict_uncertainty_preserves_sanitized_decision_observations():
    cfg = JevConfig(intent_mode="force", rerank_mode="off", citation_mode="off", citation_strategy="per_unit")
    error = JevRequiredError("intent", "uncertain_decision")
    error.decision_info = {"requirements": policy(), "accepted": False}
    receipt = retrieval_diagnostics(None, cfg)
    result = failure_diagnostics(receipt, cfg, required_failure=error)
    stage = result["retrieval"]["runs"][0]["jev_decision"]
    assert stage["requirements"] == policy()
    assert stage["status"] == "failed" and stage["fallback_used"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_requirements_survive_retrieval_routing_and_results(stream):
    from test_routed_modality_fallback import service_fixture, prepared
    service = service_fixture({"tea": {"text": 0, "video": 4}})
    service._preprocess_query.return_value = {**prepared(), "visual_intent": "explicit_demand",
                                             "decision_requirements": policy()}
    if stream:
        events = [event async for event in service.search_stream("request")]
        result = events[-1][1]
    else:
        result = await service.search("request")
    assert service.kb_router.route_query.await_args.kwargs["routing_hints"]["decision_requirements"] == policy()
    assert result.context.decision_requirements["modalities"]["video"]["action"] == "source_grounding"
    assert result.context.decision_requirements["modalities"]["video"]["effective_intent"] == "implicit_enrichment"
    assert result.debug_info["decision_coverage"]["modalities"]["video"]["retained_count"] == 1
    assert result.debug_info["target_modality_fallback"]["reason"] == "source_grounding"


@pytest.mark.asyncio
async def test_abstention_retains_existing_media_fallback():
    from test_routed_modality_fallback import service_fixture, prepared
    service = service_fixture({"tea": {"text": 0, "video": 4}})
    requirements = policy()
    requirements["planning"]["context_signal"] = .5
    requirements["planning"]["grounding_state"] = "uncertain"
    before = {**prepared(), "decision_requirements": requirements,
              "jev_decision": {"requirements": deepcopy(requirements)}}
    updated, receipt = await service._prepare_target_modality(before,
        SimpleNamespace(target_kb_ids=["tea"]), selected_files=[])
    assert updated["video_intent"] == "implicit_enrichment"
    assert receipt["modality"] == "video"
    record = updated["jev_decision"]["requirements"]["modalities"]["video"]
    assert record["effective_intent"] == "implicit_enrichment" and record["action"] == "source_grounding"


def test_unapplied_requirement_does_not_become_generator_instruction():
    ctx = context()
    ctx.visual_intent = "unnecessary"
    receipt = coverage_receipt(ctx, {}, [])
    result = SimpleNamespace(debug_info={"decision_coverage": receipt})
    assert finalize_coverage(result, {}) == ""


def test_reference_map_alone_does_not_prove_context_was_formatted():
    ctx = context()
    image = {"id": "image", "content_type": "image"}
    receipt = coverage_receipt(ctx, {"visual": [image]}, [image], embedding_failures=["query_timeout"])
    result = SimpleNamespace(debug_info={"decision_coverage": receipt})
    prompt = finalize_coverage(result, {"1": SimpleNamespace(content_type="image")}, context_string="参考材料构建失败")
    assert result.debug_info["decision_coverage"]["modalities"]["image"]["context_count"] == 0
    assert "上下文包含 1" not in prompt and "查询向量化失败" in prompt


@pytest.mark.asyncio
async def test_adopted_source_prohibition_survives_selected_file_binding():
    from test_routed_modality_fallback import service_fixture, prepared
    from app.modules.retrieval.service import _override_intents_for_selected_files
    service = service_fixture({"tea": {"image": 4}})
    requirements = policy()
    requirements["modalities"]["image"].update(status="forbidden", action="adopted", effective_intent="unnecessary")
    before = {**prepared(), "decision_requirements": requirements}
    files = [{"file_id": "img", "name": "x.png", "type": "png"}]
    updated, _ = _override_intents_for_selected_files("查看所选材料", before, files)
    assert updated["visual_intent"] == "unnecessary"
    ctx = SimpleNamespace(**updated, target_kb_ids=["tea"], target_file_ids=["img"], selected_files=files)
    service.search_engine = SimpleNamespace(search=AsyncMock(return_value={"raw_results": {"dense": [
        {"id": "img", "content_type": "image"}]}, "fused_results": [{"id": "img", "content_type": "image"}]}))
    result = await service._perform_hybrid_search(ctx)
    assert service.search_engine.search.await_args.kwargs["target_file_ids"] == ["img"]
    assert service.search_engine.search.await_args.kwargs["selected_files"] == []
    assert result["raw_results"]["dense"] == [] and result["fused_results"] == []
