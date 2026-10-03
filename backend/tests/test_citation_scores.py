"""Keep observed route scores through ranking, citation emission and history."""

import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.score_details import citation_score_fields
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.stream_manager import _reference_map_to_frontend_refs
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.retrieval.reranker import Reranker
from app.modules.agent.service import _merge_retrieval_results
from app.modules.retrieval.service import RetrievalResult
from app.modules.retrieval.search_engine import HybridSearchEngine


def _builder():
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_chunks = 15
    builder.max_images = 5
    builder.max_images_implicit = 6
    builder.minio_adapter = SimpleNamespace(
        get_bucket_for_kb=lambda kb: kb,
        get_presigned_url=AsyncMock(return_value="https://example.test/source"),
    )
    return builder


@pytest.mark.asyncio
async def test_raw_dense_sparse_scores_survive_dedup_rerank_and_both_serializers():
    payload = {"text_content": "Harness engineering", "file_path": "documents/survey.pdf", "kb_id": "kb"}
    raw = {
        "dense": [{"id": "chunk", "score": .78, "payload": payload}],
        "sparse": [{"id": "chunk", "score": 12.6, "payload": payload}],
    }
    before = copy.deepcopy(raw)
    ranker = Reranker()
    coarse = ranker._prepare_coarse_ranking(raw)
    assert len(coarse) == 1
    assert coarse[0]["total_score"] == .78  # Existing ranking is unchanged.
    ranked = ranker._merge_scores("Harness", coarse, [{"index": 0, "relevance_score": .9}])
    assert ranked[0]["final_score"] == pytest.approx(.7 * .9 + .3 * .78)
    builder = _builder()
    processed = await builder._process_retrieval_results(SimpleNamespace(reranked_results=ranked))
    reference_map = await builder._generate_reference_map(processed)
    streaming = _reference_map_to_frontend_refs(reference_map)[0]
    validated = builder.validate_references("结论 [1]。", reference_map)[0]
    assert streaming["score_version"] == validated["score_version"] == 2
    assert streaming["scores"] == validated["scores"] == {
        "dense": .78, "sparse": 12.6, "visual": None,
        "rerank": .9, "final": pytest.approx(.864),
    }
    assert raw == before


@pytest.mark.asyncio
@pytest.mark.parametrize("modality", ["doc", "image", "audio", "video"])
async def test_every_reference_modality_preserves_measured_zero_and_absent_channel(modality):
    row = {
        "id": "point", "content_type": modality, "final_score": .3,
        "cross_encoder_score": 0.0,
        "retrieval_scores": {"dense": 0.0, "visual": -.15},
        "payload": {"file_path": f"{modality}/source", "kb_id": "kb", "text_content": "text",
                    "caption": "picture", "transcript": "speech"},
    }
    builder = _builder()
    processed = await builder._process_retrieval_results(SimpleNamespace(reranked_results=[row]))
    references = await builder._generate_reference_map(processed)
    streaming = _reference_map_to_frontend_refs(references)[0]
    validated = builder.validate_references("证据 [1]。", references)[0]
    assert streaming["scores"] == validated["scores"] == {
        "dense": 0.0, "sparse": None, "visual": -.15, "rerank": 0.0, "final": .3,
    }


def test_missing_rerank_and_selected_file_priority_are_not_measurements():
    ranker = Reranker()
    coarse = ranker._prepare_coarse_ranking({
        "selected_file": [{"id": "selected", "score": 1.2, "payload": {"text_content": "selected"}}],
    })
    ranked = ranker._merge_scores("query", coarse, [])
    assert ranked[0]["retrieval_scores"] == {}
    assert ranked[0]["cross_encoder_score"] == 0.0  # Internal fallback remains compatible.
    assert ranked[0]["rerank_score"] is None


def test_public_reranker_measurement_keeps_explicit_zero_ahead_of_alternate_alias():
    ranker = Reranker()
    coarse = ranker._prepare_coarse_ranking({
        "dense": [{"id": "chunk", "score": .5, "payload": {}}],
    })
    ranked = ranker._merge_scores("query", coarse, [{
        "index": 0, "relevance_score": 0.0, "score": .8,
    }])
    assert ranked[0]["rerank_score"] == 0.0
    # Keep the legacy ranking behavior separate from displayed provenance.
    assert ranked[0]["final_score"] == pytest.approx(.7 * .8 + .3 * .5)


@pytest.mark.asyncio
async def test_agent_duplicates_combine_observed_channels_without_changing_ranking():
    def retrieval(scores):
        return RetrievalResult(
            context=SimpleNamespace(original_query="query", refined_query="query", is_complex=False),
            raw_results={}, processing_time=.01, debug_info={},
            reranked_results=[{
                "id": "chunk", "content_type": "doc", "final_score": .8,
                "cross_encoder_score": .9, "retrieval_scores": scores,
                "payload": {"text_content": "evidence", "file_path": "documents/source.pdf", "kb_id": "kb"},
            }],
        )

    runs = [retrieval({"dense": .7}), retrieval({"dense": .6, "sparse": 0.0})]
    before = copy.deepcopy(runs)
    merged = _merge_retrieval_results(
        original_query="query", retrieval_results=runs,
        trace=[], executed_queries=["query", "followup"], max_evidence=10,
    )
    assert merged.reranked_results[0]["retrieval_scores"] == {"dense": .7, "sparse": 0.0}
    assert merged.reranked_results[0]["final_score"] == pytest.approx(.8 + .04 + .02)
    assert runs == before
    builder = _builder()
    processed = await builder._process_retrieval_results(merged)
    references = await builder._generate_reference_map(processed)
    scores = _reference_map_to_frontend_refs(references)[0]["scores"]
    assert scores == {"dense": .7, "sparse": 0.0, "visual": None, "rerank": .9, "final": pytest.approx(.86)}


def test_legacy_reference_scalar_is_only_a_final_score_and_nonfinite_is_unavailable():
    assert citation_score_fields({"score": .856}) == {
        "score_version": 2,
        "scores": {"dense": None, "sparse": None, "visual": None, "rerank": None, "final": .856},
    }
    sanitized = citation_score_fields({"score_version": 2, "scores": {
        "dense": float("nan"), "sparse": float("inf"), "visual": True, "rerank": 0.0,
    }})
    assert sanitized["scores"] == {
        "dense": None, "sparse": None, "visual": None, "rerank": 0.0, "final": None,
    }


@pytest.mark.asyncio
async def test_image_rrf_keeps_measured_subscores_separate_from_fusion_and_missing_hits():
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points=lambda **kwargs: SimpleNamespace(points=[
        SimpleNamespace(id="image", score=.02, payload={"caption": "image"}),
    ]))
    store._query_single_vector = AsyncMock(side_effect=[
        [{"id": "image", "score": 0.0}], [],
    ])
    results = await store.search_image_vectors_dual_rrf([.1], [.2])
    assert results[0]["score"] == .02
    assert results[0]["retrieval_scores"] == {"dense": 0.0}
    # The legacy internal fields still feed the identical ranking expression.
    assert results[0]["scores"] == {"text_vec": 0.0, "clip_vec": 0.0, "rrf_fused": .02}


@pytest.mark.asyncio
async def test_image_rrf_fallback_retains_dense_score_without_inventing_clip_score():
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("offline")))
    store.search_image_vectors = AsyncMock(return_value=[{"id": "image", "score": .72, "payload": {}}])
    results = await store.search_image_vectors_dual_rrf([.1], [.2])
    assert results[0]["retrieval_scores"] == {"dense": .72}


@pytest.mark.asyncio
@pytest.mark.parametrize("sparse", [None, {1: .5}])
async def test_audio_reports_raw_dense_only_for_nonfused_query(sparse):
    store = VectorStore.__new__(VectorStore)
    store.client = SimpleNamespace(query_points=lambda **kwargs: SimpleNamespace(points=[
        SimpleNamespace(id="audio", score=.64, payload={"transcript": "speech"}),
    ]))
    results = await store.search_audio_vectors([.1], sparse_vector=sparse)
    assert results[0]["retrieval_scores"] == ({} if sparse else {"dense": .64})

    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.llm_manager = SimpleNamespace(embed=AsyncMock(return_value=SimpleNamespace(success=True, data=[[.1]])))
    engine.sparse_encoder = SimpleNamespace(encode_query=lambda query: {"sparse": sparse or {}})
    engine.ingestion_service = SimpleNamespace(get_clap_text_vector_for_query=AsyncMock(return_value=None))
    engine.vector_store = SimpleNamespace(search_audio_vectors=AsyncMock(return_value=results))
    formatted = await engine._audio_search("speech", ["kb"], audio_intent="explicit_demand")
    assert formatted[0]["retrieval_scores"] == results[0]["retrieval_scores"]
