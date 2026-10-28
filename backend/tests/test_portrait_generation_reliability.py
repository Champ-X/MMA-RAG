"""Source coverage and failure isolation for offline portrait construction."""

from collections import Counter
import asyncio
import copy
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import numpy as np
import pytest

from app.core.llm.manager import LLMCallResult
from app.core.config import settings
from app.modules.knowledge.portraits import PortraitGenerator, VectorSample, SAMPLE_MAX
from app.modules.knowledge.router import KnowledgeRouter


def generator_without_services():
    return PortraitGenerator.__new__(PortraitGenerator)


@pytest.fixture(autouse=True)
def exercise_opt_in_summary_batch(monkeypatch):
    # Production defaults to one after the real-provider equivalence check;
    # these tests also exercise the optional multi-summary branch explicitly.
    monkeypatch.setattr(settings, "portrait_embedding_batch_size", 20)


class PagedVectors:
    """Generate pages on demand; no preloaded corpus masks reservoir memory use."""

    def __init__(self, text=0, image=0, audio=0, video=0, vector_factory=None, video_factory=None):
        self.counts = {"doc": text, "image": image, "audio": audio, "video": video}
        self.read = Counter()
        self.vector_factory = vector_factory or (lambda index: [1.0, 0.0])
        self.video_factory = video_factory

    async def count_kb_chunks(self, kb_id, **kwargs):
        return self.counts["doc"], self.counts["image"]

    async def count_kb_audio(self, kb_id, **kwargs):
        return self.counts["audio"]

    async def count_kb_video(self, kb_id, **kwargs):
        return self.counts["video"]

    async def page(self, kind, *, limit, offset, batch_size):
        start = offset or 0
        stop = min(self.counts[kind], start + min(limit, batch_size))
        self.read[kind] += stop - start
        if kind == "video":
            rows = [self.video_factory(index) for index in range(start, stop)]
        else:
            rows = [(f"{kind}-{index}", self.vector_factory(index)) for index in range(start, stop)]
        return rows, stop if stop < self.counts[kind] else None

    async def scroll_text_chunks_for_sampling(self, kb_id, **kwargs):
        return await self.page("doc", **kwargs)

    async def scroll_image_vectors_for_sampling(self, kb_id, **kwargs):
        return await self.page("image", **kwargs)

    async def scroll_audio_vectors_for_sampling(self, kb_id, **kwargs):
        return await self.page("audio", **kwargs)

    async def scroll_video_shot_samples_for_portrait(self, kb_id, **kwargs):
        return await self.page("video", **kwargs)


@pytest.mark.asyncio
async def test_large_corpus_samples_suffix_topics_and_is_reproducible():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=6000, vector_factory=lambda i: [1.0, 0.0] if i < 3000 else [0.0, 1.0])

    first = await generator._sample_vectors("suffix-topics")
    second = await generator._sample_vectors("suffix-topics")

    assert len(first) == SAMPLE_MAX
    assert generator.vector_store.read["doc"] == 12000
    assert [sample.id for sample in first] == [sample.id for sample in second]
    # The old prefix-only sampler never saw the second topic. Both halves
    # should have substantial coverage, rather than merely one lucky point.
    assert 400 <= sum(sample.vector[1] == 1.0 for sample in first) <= 600


@pytest.mark.asyncio
async def test_full_stream_sampling_keeps_memory_bounded_by_budget_and_pages():
    class TrackedVector(list):
        live = 0
        peak = 0

        def __init__(self, index):
            super().__init__([float(index), 1.0])
            type(self).live += 1
            type(self).peak = max(type(self).peak, type(self).live)

        def __del__(self):
            type(self).live -= 1

    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=50_000, vector_factory=TrackedVector)

    samples = await generator._sample_vectors("bounded-reservoir")

    assert generator.vector_store.read["doc"] == 50_000
    assert len(samples) == SAMPLE_MAX
    assert TrackedVector.peak <= SAMPLE_MAX + 2 * 500 + 2
    assert max(int(sample.id.split("-")[1]) for sample in samples) > 49_000


@pytest.mark.asyncio
async def test_small_corpus_preserves_all_points_and_their_order():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=4999)

    samples = await generator._sample_vectors("small")

    assert len(samples) == 4999
    assert [sample.id for sample in samples] == [f"doc-{index}" for index in range(4999)]


@pytest.mark.asyncio
async def test_small_modalities_get_a_sample_in_large_text_corpus():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=10_000, image=1, audio=1)

    samples = await generator._sample_vectors("rare-modalities")

    assert len(samples) == SAMPLE_MAX
    assert Counter(sample.source_type for sample in samples) == {"doc": 998, "image": 1, "audio": 1}
    assert generator.vector_store.read == {"doc": 10_000, "image": 1, "audio": 1}


@pytest.mark.asyncio
async def test_empty_filtered_page_does_not_hide_later_vectors():
    generator = generator_without_services()
    scroll = AsyncMock(side_effect=[([], "next-page"), ([("tail", [0.0, 1.0])], None)])

    selected = await generator._sample_vector_stream(scroll, "kb", 1, "doc")

    assert selected == [("tail", [0.0, 1.0])]
    assert scroll.await_count == 2


@pytest.mark.asyncio
async def test_small_corpus_continues_after_empty_filtered_page():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=2)
    generator._run_scroll_text = AsyncMock(side_effect=[([], "next-page"), ([("tail", [0.0, 1.0])], None)])

    selected = await generator._sample_vectors("small-filtered-page")

    assert [sample.id for sample in selected] == ["tail"]
    assert generator._run_scroll_text.await_count == 2


@pytest.mark.asyncio
async def test_nonempty_index_with_no_usable_vectors_does_not_delete_old_portrait():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=1)
    generator.vector_store.delete_kb_portraits = AsyncMock()
    generator._run_scroll_text = AsyncMock(return_value=([], None))

    with pytest.raises(ValueError, match="仍有索引数据"):
        await generator.update_kb_portrait("kb", force_update=True)

    generator.vector_store.delete_kb_portraits.assert_not_awaited()


@pytest.mark.asyncio
async def test_large_video_sampling_sees_late_files_and_complete_scenes():
    def video(index):
        return {
            "id": f"shot-{index}", "file_id": "long-film" if index < 5900 else "late-film",
            "scene_id": "scene", "shot_start_time": index,
            "caption_vector": ([1.0, 0.0, 0.0] if index < 3000 else [0.0, 1.0, 0.0])
            if index < 5900 else [0.0, 0.0, 1.0],
        }

    generator = generator_without_services()
    generator.vector_store = PagedVectors(video=6000, video_factory=video)

    samples = await generator._sample_vectors("late-video")

    by_file = {sample.source_file_id: sample for sample in samples}
    assert set(by_file) == {"long-film", "late-film"}
    expected = np.array([3000.0, 2900.0, 0.0])
    expected /= np.linalg.norm(expected)
    np.testing.assert_allclose(by_file["long-film"].vector, expected, atol=1e-6)
    assert by_file["late-film"].vector == [0.0, 0.0, 1.0]
    assert generator.vector_store.read["video"] == 12_000


@pytest.mark.asyncio
async def test_video_budget_preserves_files_without_retaining_every_scene():
    def video(index):
        return {"id": f"shot-{index}", "file_id": f"film-{index % 3}", "scene_id": f"scene-{index // 3}",
                "shot_start_time": index, "caption_vector": [1.0, 0.0]}

    generator = generator_without_services()
    generator.vector_store = PagedVectors(video=6000, video_factory=video)

    samples = await generator._sample_video_stream("scene-budget", 6)

    assert len(samples) == 6
    assert Counter(sample.source_file_id for sample in samples) == {"film-0": 2, "film-1": 2, "film-2": 2}
    assert any(int(sample.id.split("-")[1]) > 1000 for sample in samples)


def summary_generator(texts=None, chat=None, embedding=None):
    generator = generator_without_services()
    generator.vector_store = SimpleNamespace(fetch_texts_by_ids=AsyncMock(return_value=(texts or {}, {})))
    generator.prompt_engine = SimpleNamespace(render_template=Mock(return_value="source-grounded prompt"))
    generator.llm_manager = SimpleNamespace(
        chat=AsyncMock(return_value=chat or LLMCallResult(False, error="unavailable")),
        embed=AsyncMock(return_value=embedding or LLMCallResult(True, data=[[0.0, 1.0]])),
    )
    return generator


@pytest.mark.asyncio
@pytest.mark.parametrize("chat", [
    LLMCallResult(False, error="unavailable"),
    LLMCallResult(True, data={"choices": [{"message": {"content": "  "}}]}),
    LLMCallResult(True, data={"choices": [{"message": {"content": "基于1个内容片段的主题聚类"}}]}),
    LLMCallResult(True, data={"choices": [{"message": {"content": "主题聚类 (基于1个内容片段)"}}]}),
    LLMCallResult(True, data={"choices": []}),
])
async def test_unusable_summary_keeps_true_topic_without_embedding_placeholder(chat):
    generator = summary_generator({"doc": "青藏高原冻土与植被变化研究"}, chat=chat)

    portraits = await generator._generate_topic_summaries(
        [VectorSample("doc", [1.0, 0.0], "doc")], {"k": 1, "labels": [0], "centers": [[1.0, 0.0]]},
    )

    assert portraits[0]["vector"] == [1.0, 0.0]
    assert portraits[0]["metadata"]["summary_status"] == "summary_unavailable"
    generator.llm_manager.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_source_text_does_not_spend_summary_or_embedding_calls():
    generator = summary_generator()

    portraits = await generator._generate_topic_summaries(
        [VectorSample("missing", [1.0, 0.0], "doc")], {"k": 1, "labels": [0], "centers": [[1.0, 0.0]]},
    )

    assert portraits[0]["vector"] == [1.0, 0.0]
    assert portraits[0]["metadata"]["summary_status"] == "missing_source_text"
    generator.llm_manager.chat.assert_not_awaited()
    generator.llm_manager.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_valid_summaries_share_one_embedding_batch_and_keep_cluster_alignment():
    generator = summary_generator({f"doc-{i}": f"真实主题 {i}" for i in range(3)},
                                  embedding=LLMCallResult(True, data=[[0.1, 0.8, 0.1], [0.2, 0.2, 0.6]]))
    generator._generate_single_topic_summary = AsyncMock(side_effect=["", "植物生态", "数据库索引"])
    centers = np.eye(3).tolist()

    portraits = await generator._generate_topic_summaries(
        [VectorSample(f"doc-{i}", center, "doc") for i, center in enumerate(centers)],
        {"k": 3, "labels": [0, 1, 2], "centers": centers},
    )

    generator.llm_manager.embed.assert_awaited_once_with(texts=["植物生态", "数据库索引"], fallback=False)
    assert [p["vector"] for p in portraits] == [centers[0], [0.1, 0.8, 0.1], [0.2, 0.2, 0.6]]
    assert [p["metadata"]["summary_status"] for p in portraits] == ["summary_unavailable", "ready", "ready"]
    assert all("centroid_vector" not in p["metadata"] for p in portraits)


@pytest.mark.asyncio
async def test_embedding_batch_size_one_restores_request_shape_without_changing_vectors(monkeypatch):
    expected = {"植物生态": [0.2, 0.8], "数据库索引": [0.9, 0.1]}

    async def embed(*, texts, **kwargs):
        return LLMCallResult(True, data=[expected[text] for text in texts])

    results, calls = [], []
    for size in (20, 1):
        monkeypatch.setattr(settings, "portrait_embedding_batch_size", size)
        generator = summary_generator({"a": "植物", "b": "数据库"})
        generator._generate_single_topic_summary = AsyncMock(side_effect=list(expected))
        generator.llm_manager.embed.side_effect = embed
        results.append(await generator._generate_topic_summaries(
            [VectorSample("a", [1.0, 0.0], "doc"), VectorSample("b", [0.0, 1.0], "doc")],
            {"k": 2, "labels": [0, 1], "centers": [[1.0, 0.0], [0.0, 1.0]]},
        ))
        calls.append(generator.llm_manager.embed.await_count)
    assert results[0] == results[1]
    assert calls == [1, 2]


@pytest.mark.asyncio
async def test_one_embedding_batch_failure_does_not_discard_later_success(monkeypatch):
    monkeypatch.setattr(settings, "portrait_embedding_batch_size", 1)
    generator = summary_generator({"a": "植物", "b": "数据库"})
    generator._generate_single_topic_summary = AsyncMock(side_effect=["植物生态", "数据库索引"])
    generator.llm_manager.embed.side_effect = [ConnectionError("provider unavailable"), LLMCallResult(True, data=[[0.3, 0.7]])]

    portraits = await generator._generate_topic_summaries(
        [VectorSample("a", [1.0, 0.0], "doc"), VectorSample("b", [0.0, 1.0], "doc")],
        {"k": 2, "labels": [0, 1], "centers": [[1.0, 0.0], [0.0, 1.0]]},
    )

    assert portraits[0]["vector"] == [1.0, 0.0]
    assert portraits[1]["vector"] == [0.3, 0.7]
    assert generator.llm_manager.embed.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [
    LLMCallResult(False, error="unavailable"),
    LLMCallResult(True, data=[]),
    LLMCallResult(True, data=[[1.0, 0.0]]),  # Missing second response: alignment is unknown.
    LLMCallResult(True, data=[[float("nan"), 1.0], [0.0, 1.0]]),
    LLMCallResult(True, data=[[1.0, 0.0, 0.0], [0.0, 1.0]]),
    LLMCallResult(True, data=[[[1.0, 0.0]], [0.0, 1.0]]),
])
async def test_invalid_embedding_batch_preserves_content_and_does_not_add_retry_calls(result):
    generator = summary_generator({"a": "植物", "b": "数据库"}, embedding=result)
    generator._generate_single_topic_summary = AsyncMock(side_effect=["植物生态", "数据库索引"])

    portraits = await generator._generate_topic_summaries(
        [VectorSample("a", [1.0, 0.0], "doc"), VectorSample("b", [0.0, 1.0], "doc")],
        {"k": 2, "labels": [0, 1], "centers": [[1.0, 0.0], [0.0, 1.0]]},
    )

    assert portraits[0]["vector"] == [1.0, 0.0]
    assert portraits[0]["metadata"]["summary_status"] == "embedding_unavailable"
    assert portraits[1]["vector"] == [0.0, 1.0]
    generator.llm_manager.embed.assert_awaited_once()


@pytest.mark.asyncio
async def test_same_dimension_different_returned_model_is_not_published():
    generator = summary_generator({"a": "植物"}, embedding=LLMCallResult(True, data=[[0.0, 1.0]], model_used="wrong"))
    generator._generate_single_topic_summary = AsyncMock(return_value="植物生态")
    generator.llm_manager.registry = SimpleNamespace(get_task_model=Mock(return_value="expected"),
                                                     get_model_config=Mock(return_value={"embedding_space": "space-1"}))

    portraits = await generator._generate_topic_summaries(
        [VectorSample("a", [1.0, 0.0], "doc")], {"k": 1, "labels": [0], "centers": [[1.0, 0.0]]},
    )

    assert portraits[0]["vector"] == [1.0, 0.0]
    assert "embedding_model" not in portraits[0]["metadata"]
    assert portraits[0]["metadata"]["embedding_space"] is None
    assert portraits[0]["metadata"]["requested_summary_embedding_model"] == "expected"
    generator.llm_manager.embed.assert_awaited_once_with(texts=["植物生态"], fallback=False, model="expected")


@pytest.mark.asyncio
async def test_empty_kb_delete_failure_is_not_reported_as_completed():
    generator = generator_without_services()
    generator._sample_vectors = AsyncMock(return_value=[])
    generator.vector_store = SimpleNamespace(delete_kb_portraits=AsyncMock(return_value=False))

    with pytest.raises(RuntimeError, match="删除空知识库画像失败"):
        await generator.update_kb_portrait("kb", force_update=True)


@pytest.mark.asyncio
async def test_count_failure_cannot_become_empty_kb_or_replace_healthy_portraits():
    generator = generator_without_services()
    generator.vector_store = SimpleNamespace(
        count_kb_chunks=AsyncMock(side_effect=ConnectionError("Qdrant unavailable")),
        delete_kb_portraits=AsyncMock(), upsert_kb_portraits=AsyncMock(),
    )

    with pytest.raises(ConnectionError):
        await generator.update_kb_portrait("kb", force_update=False)

    assert generator.vector_store.count_kb_chunks.await_count == 2
    assert all(call.kwargs == {"strict": True} for call in generator.vector_store.count_kb_chunks.await_args_list)
    generator.vector_store.delete_kb_portraits.assert_not_awaited()
    generator.vector_store.upsert_kb_portraits.assert_not_awaited()


@pytest.mark.asyncio
async def test_mid_scan_failure_does_not_publish_partial_portraits():
    generator = generator_without_services()
    generator.vector_store = PagedVectors(text=6000)
    generator.vector_store.delete_kb_portraits = AsyncMock()
    generator.vector_store.upsert_kb_portraits = AsyncMock()
    generator._run_scroll_text = AsyncMock(side_effect=[([("first", [1.0, 0.0])], "page-2"),
                                                       ConnectionError("page lost")])

    with pytest.raises(ConnectionError):
        await generator.update_kb_portrait("kb", force_update=True)

    generator.vector_store.delete_kb_portraits.assert_not_awaited()
    generator.vector_store.upsert_kb_portraits.assert_not_awaited()


@pytest.mark.asyncio
async def test_count_failure_during_store_does_not_publish_false_zero_counts():
    generator = generator_without_services()
    generator.vector_store = SimpleNamespace(count_kb_chunks=AsyncMock(side_effect=ConnectionError("count failed")),
                                             upsert_kb_portraits=AsyncMock())

    with pytest.raises(ConnectionError):
        await generator._store_portraits("kb", [{"topic_summary": "healthy", "vector": [1.0, 0.0]}])

    generator.vector_store.count_kb_chunks.assert_awaited_once_with("kb", strict=True)
    generator.vector_store.upsert_kb_portraits.assert_not_awaited()


@pytest.mark.asyncio
async def test_summary_outage_preserves_separable_topics_for_routing():
    centers = np.eye(8).tolist()
    generator = summary_generator({f"doc-{i}": f"independent topic {i}" for i in range(8)})

    portraits = await generator._generate_topic_summaries(
        [VectorSample(f"doc-{i}", center, "doc") for i, center in enumerate(centers)],
        {"k": 8, "labels": list(range(8)), "centers": centers},
    )

    # With a generic placeholder embedding all eight topics became identical.
    # Real content vectors keep the corresponding source nearest for each query.
    similarities = np.asarray(centers) @ np.asarray([p["vector"] for p in portraits]).T
    assert similarities.argmax(axis=1).tolist() == list(range(8))
    generator.llm_manager.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_clustering_does_not_block_api_event_loop(monkeypatch):
    generator = generator_without_services()
    entered = threading.Event()
    heartbeat = threading.Event()

    def blocked_cpu(samples):
        entered.set()
        # Only the asyncio heartbeat releases computation. The timeout is a
        # deadlock guard, not a performance threshold; inline execution fails.
        assert heartbeat.wait(timeout=5), "CPU work blocked the event loop"
        return {"k": 1}

    monkeypatch.setattr(generator, "_perform_clustering_sync", blocked_cpu)

    async def tick():
        assert await asyncio.to_thread(entered.wait, 5)
        heartbeat.set()

    result, _ = await asyncio.gather(generator._perform_clustering([]), tick())
    assert result == {"k": 1}


@pytest.mark.asyncio
async def test_offloaded_clustering_preserves_labels_and_centers():
    generator = generator_without_services()
    rng = np.random.default_rng(42)
    vectors = np.vstack([rng.normal([1.0, 0.0], .03, size=(8, 2)), rng.normal([0.0, 1.0], .03, size=(8, 2))])
    samples = [VectorSample(str(index), vector.tolist(), "doc") for index, vector in enumerate(vectors)]

    expected = generator._perform_clustering_sync(copy.deepcopy(samples))
    actual = await generator._perform_clustering(copy.deepcopy(samples))

    assert actual["labels"] == expected["labels"]
    assert actual["k"] == expected["k"]
    np.testing.assert_allclose(actual["centers"], expected["centers"])
    assert actual["silhouette_score"] == pytest.approx(expected["silhouette_score"])


@pytest.mark.asyncio
async def test_suffix_topic_survives_sampling_summary_outage_and_real_legacy_routing(monkeypatch):
    """Synthetic stress regression, not a measured real-query quality score.

    The frozen old prefix represents only the first topic. Exercise the actual
    sampler, clustering, failed-summary fallback and router together to ensure
    the formerly invisible second topic reaches the correct source library.
    """
    monkeypatch.setattr(settings, "knowledge_routing_score_mode", "legacy")
    sampler = generator_without_services()
    sampler.vector_store = PagedVectors(text=6000, vector_factory=lambda i: [1.0, 0.0] if i < 3000 else [0.0, 1.0])
    samples = await sampler._sample_vectors("two-topic-library")
    clustering = await sampler._perform_clustering(samples)
    summaries = summary_generator({sample.id: "数据库系统" if sample.vector[0] else "植物生态" for sample in samples})
    portraits = await summaries._generate_topic_summaries(samples, clustering)

    assert clustering["k"] == 2
    assert all(p["metadata"]["portrait_vector_source"] == "centroid" for p in portraits)
    summaries.llm_manager.embed.assert_not_awaited()
    query = np.array([0.0, 1.0])
    distractor = np.array([np.sqrt(.96), .2])
    router = KnowledgeRouter.__new__(KnowledgeRouter)

    async def route(vectors):
        nodes = [{"kb_id": "target", "score": float(query @ vector / np.linalg.norm(vector))}
                 for vector in map(np.asarray, vectors)]
        nodes.append({"kb_id": "distractor", "score": float(query @ distractor)})
        nodes.sort(key=lambda node: node["score"], reverse=True)
        scores = router._calculate_multi_signal_scores([nodes])
        return await router._apply_routing_strategy(scores, max_targets=2)

    # Before the repair, reading only the prefix yields the first-topic vector.
    old = await route([[1.0, 0.0]])
    repaired = await route([portrait["vector"] for portrait in portraits])

    assert old.target_kb_ids == ["distractor"]
    assert repaired.target_kb_ids == ["target"]
