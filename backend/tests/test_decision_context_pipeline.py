"""The paid evidence checkpoint belongs to the final visible context, once."""
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.decision_diagnostics import retrieval_diagnostics
from app.core.jev_settings import OFF_CONFIG
from app.core.llm.manager import LLMCallResult
from app.modules.agent.service import _merge_retrieval_results
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.retrieval.reranker import Reranker
from app.modules.retrieval.service import RetrievalResult


def doc(ident, text, score=.8, *, span=False):
    return {"id": ident, "content_type": "doc", "final_score": score,
            "payload": {"text_content": text, "file_path": ident + ".txt", "kb_id": "scope"},
            "metadata": {"decision_assist": {"policy_version": "context-evidence-v1"}} if span else {}}


def result(rows, candidates=None):
    return RetrievalResult(
        context=SimpleNamespace(original_query="问题", refined_query="问题", is_complex=False,
            visual_intent="unnecessary", audio_intent="unnecessary", video_intent="unnecessary",
            target_kb_ids=["scope"], target_kbs=[], selected_file_modalities=[], search_strategies={}),
        raw_results={"dense": rows}, reranked_results=rows, processing_time=0, debug_info={},
        decision_candidates=candidates,
    )


def builder():
    instance = ContextBuilder.__new__(ContextBuilder)
    instance.max_chunks, instance.max_images, instance.max_images_implicit = 15, 5, 6
    instance.max_context_length = 4000
    instance.formatter = MultiModalFormatter()
    instance.minio_adapter = SimpleNamespace(get_bucket_for_kb=lambda kb: kb,
        get_presigned_url=AsyncMock(return_value="https://example.test/media"))
    return instance


@pytest.mark.asyncio
async def test_assist_reranking_has_no_decision_call_and_retains_original_scores():
    ranker = Reranker()
    ranker.llm_manager = SimpleNamespace(rerank=AsyncMock(side_effect=lambda **kw: LLMCallResult(
        success=True, data=[{"index": i, "relevance_score": .9 - i * .02}
                            for i in range(len(kw["documents"]))])))
    ranker.jev_client = SimpleNamespace(decide=AsyncMock(side_effect=AssertionError("too early")))
    raw = {"dense": [doc(str(i), f"候选 {i} 正文") for i in range(13)]}
    ranker.jev_mode = "off"
    baseline = await ranker.rerank("问题", raw)
    ranker.jev_mode = "assist"
    assisted = await ranker.rerank("问题", raw)
    assert assisted["results"] == baseline["results"]
    assert assisted["scorer"]["status"] == "deferred"
    assert [r["id"] for r in assisted["decision_candidates"][:3]] == ["10", "11", "12"]
    ranker.jev_client.decide.assert_not_called()


@pytest.mark.asyncio
async def test_checkpoint_sees_only_rendered_context_and_can_append_same_source_tail(monkeypatch):
    from app.modules.retrieval import decision_evidence_checkpoint as checkpoint
    rows = [doc("source", "背景" * 300 + "\n实际限额为 600 次。")]
    baseline = await builder().build_context(result(rows), "限额？")
    assert "600" not in baseline.context_string
    extra = doc("source", "实际限额为 600 次。", span=True)
    choose = AsyncMock(return_value=([extra], {"mode": "assist", "status": "ok", "accepted_count": 1}))
    monkeypatch.setattr(checkpoint, "select_context_evidence", choose)
    monkeypatch.setattr("app.modules.generation.context_builder.get_jev_client", lambda: object())
    retrieval = result(copy.deepcopy(rows), copy.deepcopy(rows))
    assisted = await builder().build_context(retrieval, "限额？")
    assert choose.call_args.args[3] == baseline.context_string
    assert assisted.context_string.startswith(baseline.context_string)
    assert "实际限额为 600 次。" in assisted.context_string
    assert assisted.reference_map["1"] == baseline.reference_map["1"]
    assert assisted.reference_map["2"].metadata["chunk_id"] == "source"
    assert assisted.reference_map["2"].content == "实际限额为 600 次。"
    assert retrieval.reranked_results == rows
    repeated = await builder().build_context(retrieval, "限额？")
    assert repeated.context_string == assisted.context_string
    assert choose.await_count == 1
    diagnostics = retrieval_diagnostics(retrieval, OFF_CONFIG.model_copy(update={"rerank_mode": "assist"}))
    assert diagnostics["context_checkpoint"]["applied_count"] == 1
    assert diagnostics["final_added_ids"] == ["source"]
    assert "decision_candidates" not in diagnostics


@pytest.mark.asyncio
async def test_agent_final_merge_checks_once_without_changing_planner_evidence(monkeypatch):
    from app.modules.retrieval import decision_evidence_checkpoint as checkpoint
    first = result([doc("anchor", "原始来源")], [doc("a", "候选甲"), doc("b", "候选乙")])
    second = result([doc("child", "子问题来源")], [doc("c", "候选丙"), doc("a", "候选甲")])
    merged = _merge_retrieval_results(original_query="问题", retrieval_results=[first, second],
        trace=[], executed_queries=["问题", "子问题"], max_evidence=3, original_query_anchor_count=1)
    assert [r["id"] for r in merged.decision_candidates] == ["a", "c", "b"]
    before = copy.deepcopy(merged.reranked_results)
    choose = AsyncMock(return_value=([doc("extra", "补充内容", span=True)],
                                     {"mode": "assist", "status": "ok"}))
    monkeypatch.setattr(checkpoint, "select_context_evidence", choose)
    monkeypatch.setattr("app.modules.generation.context_builder.get_jev_client", lambda: object())
    await builder().build_context(merged, "问题")
    assert choose.await_count == 1
    assert merged.reranked_results == before
    assert first.debug_info == second.debug_info == {}


@pytest.mark.asyncio
async def test_checkpoint_exception_or_off_cannot_erase_baseline(monkeypatch):
    from app.modules.retrieval import decision_evidence_checkpoint as checkpoint
    choose = AsyncMock(side_effect=RuntimeError("failed"))
    monkeypatch.setattr(checkpoint, "select_context_evidence", choose)
    monkeypatch.setattr("app.modules.generation.context_builder.get_jev_client", lambda: object())
    rows = [doc("base", "可用来源")]
    baseline = await builder().build_context(result(rows), "问题")
    choose.assert_not_called()
    retrieval = result(rows, [doc("extra", "候选")])
    failed = await builder().build_context(retrieval, "问题")
    assert failed.context_string == baseline.context_string
    assert failed.reference_map == baseline.reference_map
    assert retrieval.debug_info["context_checkpoint"]["status"] == "fallback"
    assert retrieval.debug_info["context_checkpoint"]["added_ids"] == []


@pytest.mark.asyncio
async def test_checkpoint_selection_order_survives_context_formatting(monkeypatch):
    from app.modules.retrieval import decision_evidence_checkpoint as checkpoint
    selected = [doc("low", "低分但先选中的原文", .1, span=True),
                doc("high", "高分但后选中的原文", .9, span=True)]
    monkeypatch.setattr(checkpoint, "select_context_evidence", AsyncMock(return_value=(
        selected, {"mode": "assist", "status": "ok"})))
    monkeypatch.setattr("app.modules.generation.context_builder.get_jev_client", lambda: object())
    retrieval = result([doc("base", "原上下文")], selected)
    built = await builder().build_context(retrieval, "问题")
    assert retrieval.debug_info["context_checkpoint"]["added_ids"] == ["low", "high"]
    assert [ref.metadata["chunk_id"] for ref in built.reference_map.values()] == ["base", "low", "high"]
