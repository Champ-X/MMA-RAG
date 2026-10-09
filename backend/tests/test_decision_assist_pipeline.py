"""Supplemental evidence cannot evict the original Agent/context evidence."""
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.agent.service import (
    _merge_retrieval_results, _seed_evidence_from_original_query_anchor,
    _is_focused_original_query_anchor,
)
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.retrieval.service import RetrievalResult
from app.modules.retrieval.reference_materials import include_reference_materials


def document(ident, score, *, assist=False, anchor=False):
    return {
        "id": ident, "content_type": "doc", "final_score": score,
        "payload": {"text_content": f"Evidence {ident}", "file_path": f"{ident}.txt", "kb_id": "scope"},
        "metadata": {
            **({"decision_assist": {"probability": .99}} if assist else {}),
            **({"agent_original_query_anchor": True} if anchor else {}),
        },
    }


def retrieval(rows):
    return RetrievalResult(
        context=SimpleNamespace(
            original_query="question", refined_query="question", is_complex=False,
            visual_intent="unnecessary", audio_intent="unnecessary", video_intent="unnecessary",
            target_kb_ids=["scope"], target_kbs=[], selected_file_modalities=[], search_strategies={},
        ),
        raw_results={"dense": rows}, reranked_results=rows, processing_time=0,
        debug_info={},
    )


def merge(results):
    return _merge_retrieval_results(original_query="question", retrieval_results=results,
        trace=[], executed_queries=["question", "followup"], max_evidence=3,
        original_query_anchor_count=1)


def test_agent_supplements_do_not_change_baseline_hits_scores_anchors_or_slots():
    first = [document("anchor", .01), document("shared", .7)]
    second = [document("shared", .9), document("other", .8), document("tail", .1)]
    baseline = merge([retrieval(first), retrieval(second)])
    inputs = [retrieval([document("extra", 100, assist=True), *first]),
              retrieval([*second, document("extra", 100, assist=True),
                         document("shared", 100, assist=True), document("extra2", 100, assist=True),
                         document("extra3", 100, assist=True)])]
    before = copy.deepcopy(inputs)
    assisted = merge(inputs)
    assert assisted.reranked_results[:3] == baseline.reranked_results
    assert [r["id"] for r in assisted.reranked_results[3:]] == ["extra", "extra2"]
    assert assisted.debug_info["decision_assist"]["baseline_preserved"]
    assert [r.reranked_results for r in inputs] == [r.reranked_results for r in before]


def test_agent_does_not_turn_supplements_into_a_successful_empty_baseline():
    assert merge([retrieval([document("extra", 100, assist=True)])]).reranked_results == []


def builder():
    result = ContextBuilder.__new__(ContextBuilder)
    result.max_chunks = 3
    result.max_images = 5
    result.max_images_implicit = 6
    return result


@pytest.mark.asyncio
async def test_context_preserves_original_budget_and_anchor_before_bounded_supplements():
    rows = [document("anchor", .01, anchor=True), document("a", .8), document("b", .7), document("cut", .6)]
    base = await builder()._process_retrieval_results(retrieval(rows))
    extra = [document(f"extra{i}", 100, assist=True) for i in range(4)]
    combined = await builder()._process_retrieval_results(retrieval([*extra, *rows]))
    assert combined[:3] == base
    assert [r["id"] for r in combined] == ["anchor", "a", "b", "extra0", "extra1"]
    assert combined[-1]["metadata"]["decision_assist"]["probability"] == .99


@pytest.mark.asyncio
async def test_context_off_retains_original_source_and_score_order():
    rows = [document("a", .2), document("b", .8), document("c", .6), document("d", .1)]
    result = await builder()._process_retrieval_results(retrieval(rows))
    assert [r["id"] for r in result] == ["b", "c", "a"]
    assert all("decision_assist" not in r["metadata"] for r in result)


def test_supplements_do_not_reduce_agent_fanout_or_inflate_planner_seed():
    baseline = retrieval([document("anchor", .01)])
    assisted = retrieval([document("extra1", 1, assist=True), *baseline.reranked_results,
                          document("extra2", 1, assist=True)])
    assert _is_focused_original_query_anchor(baseline) is False
    assert _is_focused_original_query_anchor(assisted) is False
    original_seed, assisted_seed = {}, {}
    assert _seed_evidence_from_original_query_anchor(original_seed, baseline) == 1
    assert _seed_evidence_from_original_query_anchor(assisted_seed, assisted) == 1
    assert assisted_seed == original_seed


def complete_builder():
    result = builder()
    result.max_chunks = 15
    result.max_context_length = 4000
    result.formatter = MultiModalFormatter()
    result.minio_adapter = SimpleNamespace(get_bucket_for_kb=lambda kb: kb,
        get_presigned_url=AsyncMock(return_value="https://example.test/image"))
    return result


@pytest.mark.asyncio
async def test_supplement_cannot_trigger_recompression_of_original_context():
    rows = [document(f"base{i}", 1-i/100) for i in range(15)]
    for i, row in enumerate(rows):
        row["payload"]["text_content"] = "x " * 225 + f"BASELINETAIL{i}"
    extras = [document(f"extra{i}", 100, assist=True) for i in range(2)]
    for row in extras:
        row["payload"]["text_content"] = "y " * 245
    baseline = await complete_builder().build_context(retrieval(rows), "query")
    assisted = await complete_builder().build_context(retrieval([*rows, *extras]), "query")
    assert len(baseline.context_string.split()) < 4000
    assert assisted.context_string.startswith(baseline.context_string)
    assert all(f"BASELINETAIL{i}" in assisted.context_string for i in range(15))
    assert len(assisted.reference_map) == 17
    assert {k: assisted.reference_map[k] for k in baseline.reference_map} == baseline.reference_map


@pytest.mark.asyncio
async def test_full_content_only_supplement_keeps_media_and_attachment_reference_numbers():
    rows = [document("original", .8), {"id": "image", "content_type": "image", "final_score": .7,
            "payload": {"caption": "original image", "file_path": "image.png", "kb_id": "scope"}}]
    attachment = {"id": "uploaded", "status": "ready", "summary": "local audio evidence",
                  "kind": "audio", "name": "upload.wav", "index": 1}
    extra = document("content-only", 10, assist=True)
    extra["content"] = "背景。" * 250 + "补充答案位于五百字之后。"
    del extra["payload"]["text_content"]
    baseline = await complete_builder().build_context(retrieval(rows), "query", attachment_files=[attachment])
    assisted = await complete_builder().build_context(retrieval([*rows, extra]), "query", attachment_files=[attachment])
    assert assisted.context_string.startswith(baseline.context_string)
    assert extra["content"] in assisted.context_string
    assert {k: assisted.reference_map[k] for k in baseline.reference_map} == baseline.reference_map
    assert assisted.reference_map["4"].metadata["chunk_id"] == "content-only"
    assert assisted.reference_map["4"].content == extra["content"]


@pytest.mark.asyncio
async def test_explicit_reference_to_same_supplement_becomes_original_bound_input():
    rows = [document("original", .8)]
    source = document("bound", .1)
    baseline = include_reference_materials(retrieval(rows), [source])
    supplement = document("bound", .1, assist=True)
    assisted = include_reference_materials(retrieval([*rows, supplement]), [source])
    assert assisted.reranked_results == baseline.reranked_results
    before = await complete_builder().build_context(baseline, "compare @bound")
    after = await complete_builder().build_context(assisted, "compare @bound")
    assert after.context_string == before.context_string
    assert after.reference_map == before.reference_map
