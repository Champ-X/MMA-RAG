from types import SimpleNamespace

import pytest

from app.modules.retrieval.reranker import Reranker
from app.modules.retrieval.search_engine import HybridSearchEngine


def _row(index: int, modality: str = "doc"):
    payload = {"text_content": f"doc {index}"}
    if modality == "audio":
        payload = {"transcript": "Red Right Hand", "file_path": "Red Right Hand.mp3"}
    return {
        "id": f"{modality}-{index}",
        "content_type": modality,
        "payload": payload,
        "final_score": 1.0 - index / 100,
    }


def _reranker() -> Reranker:
    reranker = Reranker.__new__(Reranker)
    reranker.top_k = 20
    reranker.final_top_k = 10
    return reranker


def test_explicit_audio_is_protected_before_and_after_reranking():
    reranker = _reranker()
    ranked = [_row(index) for index in range(24)] + [
        _row(24, "audio"),
        _row(25, "audio"),
    ]
    context = SimpleNamespace(
        visual_intent="unnecessary",
        audio_intent="explicit_demand",
        video_intent="unnecessary",
        selected_file_modalities=[],
    )

    candidates = reranker._select_candidates_for_reranking(ranked, context)
    final = reranker._apply_final_ranking_with_modality_protection(candidates, context)

    assert len(candidates) == 20
    assert sum(row["content_type"] == "audio" for row in candidates) == 2
    assert sum(row["content_type"] == "audio" for row in final) == 2


def test_implicit_video_is_preserved_when_agent_activates_non_text_kb_fallback():
    """A video-only routed KB must survive the text-heavy reranker stages."""
    reranker = _reranker()
    ranked = [_row(index) for index in range(24)] + [
        _row(24, "video"),
        _row(25, "video"),
    ]
    context = SimpleNamespace(
        visual_intent="implicit_enrichment",
        audio_intent="unnecessary",
        video_intent="implicit_enrichment",
        selected_file_modalities=[],
    )

    candidates = reranker._select_candidates_for_reranking(ranked, context)
    final = reranker._apply_final_ranking_with_modality_protection(candidates, context)

    assert len(candidates) == 20
    assert sum(row["content_type"] == "video" for row in candidates) == 2
    assert sum(row["content_type"] == "video" for row in final) == 2


@pytest.mark.asyncio
async def test_video_candidates_are_ignored_without_video_intent():
    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.rrf_weights = {
        "dense": 1.0,
        "sparse": 0.8,
        "visual": 1.2,
        "audio": 1.0,
        "video": 1.1,
    }
    engine.rrf_k = 60

    fused = await engine._fuse_results(
        {
            "dense": [{"id": "doc-1", "content_type": "doc", "payload": {}}],
            "video": [{"id": "video-1", "content_type": "video", "payload": {}}],
        },
        video_intent="unnecessary",
    )

    assert [row["id"] for row in fused] == ["doc-1"]


@pytest.mark.asyncio
async def test_audio_search_falls_back_when_sparse_encoder_is_unavailable():
    class _SparseStub:
        def encode_query(self, _query):
            raise TypeError("incompatible BGE-M3 runtime")

    class _LlmStub:
        async def embed(self, **_kwargs):
            return SimpleNamespace(success=True, data=[[0.1, 0.2]], error=None)

    class _IngestionStub:
        async def get_clap_text_vector_for_query(self, _query):
            return None

    class _VectorStoreStub:
        async def search_audio_vectors(self, **_kwargs):
            return [
                {
                    "id": "red-right-hand",
                    "score": 0.91,
                    "payload": {
                        "kb_id": "music",
                        "file_id": "audio-1",
                        "file_path": "Red Right Hand.mp3",
                        "transcript": "Red Right Hand",
                    },
                }
            ]

    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.sparse_encoder = _SparseStub()
    engine.llm_manager = _LlmStub()
    engine.ingestion_service = _IngestionStub()
    engine.vector_store = _VectorStoreStub()

    rows = await engine._audio_search(
        "Peaky Blinders Red Right Hand 主题曲 音频",
        ["music"],
        audio_intent="explicit_demand",
    )

    assert len(rows) == 1
    assert rows[0]["content_type"] == "audio"
    assert rows[0]["file_path"] == "Red Right Hand.mp3"
