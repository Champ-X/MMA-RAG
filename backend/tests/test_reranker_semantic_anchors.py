"""Video evidence must survive candidate gates without bypassing the scorer."""

from collections import Counter
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.modules.retrieval.reranker import Reranker


def candidate(identifier, rank, modality="doc", anchor_score=None):
    row = {
        "id": identifier, "content_type": modality, "content": identifier,
        "score": 1 / (rank + 1), "total_score": 1 / (rank + 1),
        "payload": {"text_content": identifier, "description": identifier}, "metadata": {},
    }
    if anchor_score is not None:
        row["metadata"]["semantic_evidence_anchor"] = {
            "views": ["asr_dense"], "scores": {"asr_dense": anchor_score},
        }
    return row


@pytest.fixture
def ranker(monkeypatch):
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", True)
    return Reranker()


def test_anchor_survives_both_coarse50_and_scorer20_with_same_budget_and_scores(ranker, monkeypatch):
    raw = {"dense": [candidate(f"doc-{i}", i) for i in range(60)],
           "video": [candidate("spoken-answer", 61, "video", .9)]}
    original = deepcopy(raw)
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", False)
    baseline = ranker._prepare_coarse_ranking(raw)
    assert len(baseline) == 50
    assert "spoken-answer" not in {row["id"] for row in baseline}
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", True)

    coarse = ranker._prepare_coarse_ranking(raw)
    selected = ranker._select_candidates_for_reranking(coarse, None)

    assert len(coarse) == 50
    assert len(selected) == 20
    assert [row["id"] for row in selected] == [f"doc-{i}" for i in range(19)] + ["spoken-answer"]
    assert selected[-1]["total_score"] == raw["video"][0]["total_score"]
    assert raw == original


def test_video_for_video_replacement_precedes_lower_ranked_other_modality(ranker):
    ranker.top_k = 3
    rows = [candidate("video", 0, "video"), candidate("doc-a", 1), candidate("doc-b", 2), candidate("answer", 3, "video", .8)]
    selected = ranker._select_candidates_for_reranking(rows, None)
    assert [row["id"] for row in selected] == ["doc-a", "doc-b", "answer"]


def test_coarse50_anchor_cannot_evict_required_modality_at_boundary(ranker):
    raw = {
        "dense": [candidate(f"doc-{i}", i) for i in range(48)],
        "visual": [candidate("image1", 48, "image"), candidate("image2", 49, "image")],
        "video": [candidate("answer", 50, "video", .9)],
    }
    context = SimpleNamespace(visual_intent="explicit_demand")
    coarse = ranker._prepare_coarse_ranking(raw, context=context)
    assert len(coarse) == 50
    assert [row["id"] for row in coarse[-3:]] == ["image1", "image2", "answer"]
    assert "doc-47" not in {row["id"] for row in coarse}


def test_two_strongest_anchors_are_reserved_and_output_restores_coarse_order(ranker):
    ranker.top_k = 3
    rows = [candidate("doc-a", 0), candidate("doc-b", 1), candidate("doc-c", 2),
            candidate("weaker", 3, "video", .7), candidate("strong", 4, "video", .9),
            candidate("strongest", 5, "video", .95)]
    selected = ranker._select_candidates_for_reranking(rows, None)
    assert [row["id"] for row in selected] == ["doc-a", "strong", "strongest"]


def test_caption_and_asr_strengths_are_compared_only_for_declared_dense_views(ranker):
    ranker.top_k = 2
    rows = [candidate("doc-a", 0), candidate("doc-b", 1), candidate("speech", 2, "video", .8), candidate("picture", 3, "video", .6)]
    rows[-1]["metadata"]["semantic_evidence_anchor"] = {
        "views": ["caption_dense", "asr_dense"], "scores": {"caption_dense": .9, "asr_dense": .6, "asr_sparse": 99},
    }
    selected = ranker._select_candidates_for_reranking(rows, None)
    assert [row["id"] for row in selected] == ["speech", "picture"]
    ranker.top_k = 1
    assert ranker._select_candidates_for_reranking(rows, None)[0]["id"] == "picture"


@pytest.mark.parametrize("anchor", [
    {"views": ["asr_dense"], "scores": {"asr_dense": .49}},
    {"views": ["asr_dense"], "scores": {"asr_dense": float("nan")}},
    {"views": ["asr_dense"], "scores": {"asr_dense": float("inf")}},
    {"views": ["asr_dense"], "scores": {"asr_dense": True}},
    {"views": ["asr_dense"], "scores": {"asr_dense": "0.9"}},
    {"views": ["asr_sparse"], "scores": {"asr_sparse": 99}},
    {"views": ["clip"], "scores": {"clip": .9}},
    {"views": ["caption_dense"], "scores": {"asr_dense": .9}},
    {"views": "asr_dense", "scores": {"asr_dense": .9}},
    None, [], "invalid",
])
def test_invalid_weak_or_wrong_view_metadata_does_not_change_selection(ranker, anchor):
    ranker.top_k = 1
    rows = [candidate("doc", 0), candidate("noise", 1, "video")]
    rows[-1]["metadata"]["semantic_evidence_anchor"] = anchor
    assert ranker._select_candidates_for_reranking(rows, None) == rows[:1]


def test_nonvideo_cannot_claim_semantic_video_protection(ranker):
    ranker.top_k = 1
    rows = [candidate("doc", 0), candidate("fake", 1, "image", .99)]
    assert ranker._select_candidates_for_reranking(rows, None) == rows[:1]


def test_anchor_replacement_preserves_explicit_image_and_audio_quotas(ranker):
    ranker.top_k = 5
    rows = [candidate("doc", 0), candidate("image1", 1, "image"), candidate("image2", 2, "image"),
            candidate("audio1", 3, "audio"), candidate("audio2", 4, "audio"), candidate("answer", 5, "video", .9)]
    context = SimpleNamespace(visual_intent="explicit_demand", audio_intent="explicit_demand")
    selected = ranker._select_candidates_for_reranking(rows, context)
    assert len(selected) == 5
    assert Counter(ranker._result_modality(row) for row in selected) == {"image": 2, "audio": 2, "video": 1}
    assert [row["id"] for row in selected] == ["image1", "image2", "audio1", "audio2", "answer"]


def test_fully_reserved_modality_budget_takes_precedence_over_anchor(ranker):
    ranker.top_k = 4
    rows = [candidate("image1", 0, "image"), candidate("image2", 1, "image"),
            candidate("audio1", 2, "audio"), candidate("audio2", 3, "audio"), candidate("answer", 4, "video", .9)]
    context = SimpleNamespace(visual_intent="explicit_demand", audio_intent="explicit_demand")
    assert ranker._select_candidates_for_reranking(rows, context) == rows[:4]


def test_same_video_replacement_preserves_video_minimum(ranker):
    ranker.top_k = 3
    rows = [candidate("doc", 0), candidate("video1", 1, "video"), candidate("video2", 2, "video"), candidate("answer", 3, "video", .9)]
    context = SimpleNamespace(video_intent="explicit_demand")
    selected = ranker._select_candidates_for_reranking(rows, context)
    assert [row["id"] for row in selected] == ["doc", "video1", "answer"]


def test_disabling_feature_exactly_restores_existing_modality_selection(ranker, monkeypatch):
    ranker.top_k = 3
    rows = [candidate("doc-a", 0), candidate("doc-b", 1), candidate("doc-c", 2), candidate("answer", 3, "video", .9)]
    monkeypatch.setattr(settings, "video_semantic_anchors_enabled", False)
    assert ranker._select_candidates_for_reranking(rows, None) == rows[:3]
    context = SimpleNamespace(video_intent="explicit_demand")
    expected = ranker._ensure_modality_minimums(rows, limit=3, requirements={"video": 2})
    assert ranker._select_candidates_for_reranking(rows, context) == expected


@pytest.mark.asyncio
async def test_provider_sees_anchor_with_same20_documents_but_final10_is_not_forced(ranker):
    rows = [candidate(f"doc-{i}", i) for i in range(30)] + [candidate("spoken-answer", 31, "video", .9)]
    ranker.llm_manager = SimpleNamespace(rerank=AsyncMock(return_value=SimpleNamespace(
        success=True, data=[{"index": i, "relevance_score": .9 if i < 19 else 0.0} for i in range(20)],
    )))
    ranked = await ranker._apply_cross_encoder_reranking("unrelated request", rows)
    ranker.llm_manager.rerank.assert_awaited_once()
    documents = ranker.llm_manager.rerank.call_args.kwargs["documents"]
    assert len(documents) == 20
    assert "spoken-answer" in documents[-1]
    assert len(ranked) == 20
    final = ranker._apply_final_ranking_with_modality_protection(ranked, None)
    assert len(final) == 10
    assert "spoken-answer" not in {row["id"] for row in final}
