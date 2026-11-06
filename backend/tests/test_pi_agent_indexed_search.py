"""Search the real local Qdrant adapter with controlled, free query vectors."""
import asyncio
from dataclasses import replace
from types import SimpleNamespace

import pytest
import pytest_asyncio
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.policy import AccessScope
from app.modules.pi_agent.query_vectors import QueryVectorUnavailable
from test_pi_agent_tools import request, source


class QueryVectors:
    def __init__(self, failure=None, native=None):
        self.calls = []
        self.failure = failure
        self.native = native if native is not None else [1., 0., 0.]

    async def encode(self, kind, text):
        self.calls.append((kind, text))
        if self.failure:
            raise QueryVectorUnavailable(self.failure)
        return {7: 1.} if kind == "sparse" else self.native


class Models:
    settings = SimpleNamespace(yield_to_legacy=False, max_concurrent_search_channels=2)

    async def embed(self, query, span):
        return [1., 0., 0.]


class RecordingIndex:
    def __init__(self, client):
        self.client, self.calls = client, []
        self.fail = set()
        self.active = self.maximum = 0

    async def _call(self, operation, *args, **kwargs):
        self.calls.append((operation, args, kwargs))
        self.active += 1
        self.maximum = max(self.maximum, self.active)
        try:
            await asyncio.sleep(.001)
            if operation in self.fail or kwargs.get("using") in self.fail:
                raise ConnectionError("private connection details must never appear")
            return await getattr(self.client, operation)(*args, **kwargs)
        finally:
            self.active -= 1

    async def get_collection(self, *args, **kwargs):
        return await self._call("get_collection", *args, **kwargs)

    async def query_points(self, *args, **kwargs):
        return await self._call("query_points", *args, **kwargs)

    async def query_points_groups(self, *args, **kwargs):
        return await self._call("query_points_groups", *args, **kwargs)

    async def count(self, *args, **kwargs):
        return await self._call("count", *args, **kwargs)

    async def scroll(self, *args, **kwargs):
        return await self._call("scroll", *args, **kwargs)


@pytest_asyncio.fixture
async def index():
    client = AsyncQdrantClient(location=":memory:")
    await client.create_collection("text_chunks_agentic",
        vectors_config={"dense": qm.VectorParams(size=3, distance=qm.Distance.COSINE)},
        sparse_vectors_config={"sparse": qm.SparseVectorParams()})
    await client.create_collection("image_vectors", vectors_config={
        name: qm.VectorParams(size=3, distance=qm.Distance.COSINE) for name in ("text_vec", "clip_vec")})
    await client.create_collection("audio_vectors", vectors_config={
        name: qm.VectorParams(size=3, distance=qm.Distance.COSINE) for name in ("text_vec", "clap_vec")},
        sparse_vectors_config={"sparse": qm.SparseVectorParams()})
    yield RecordingIndex(client)
    await client.close()


def document(identity, item, text="needle evidence", *, sparse=True, token=7):
    return qm.PointStruct(id=identity, vector={"dense": [1., 0., 0.], **({
        "sparse": qm.SparseVector(indices=[token], values=[1.])} if sparse else {})},
        payload={"file_id": item.file_id, "kb_id": item.kb_id, "text_content": text, "chunk_index": identity})


def gateway(index, items, vectors=None):
    scope = AccessScope.from_request(request(knowledge_base_ids=["a"]), {"a", "b"})
    return KnowledgeGateway(SourceCatalog(items, {"a": "A", "b": "B"}), scope, index,
        Models(), asyncio.Semaphore(1), local_vectors=vectors or QueryVectors())


def query(**changes):
    return {"query": "needle", "mode": "hybrid", "modalities": ["doc"], "knowledge_base_ids": [],
            "limit": 8, "span_id": "test", **changes}


@pytest.mark.asyncio
async def test_complete_sparse_index_skips_repeated_full_scans_without_caching_stale_source_text(index):
    item, private = source(), source("b", "private")
    await index.client.upsert("text_chunks_agentic", [document(n, item) for n in range(1, 141)]
        + [document(999, private, "private needle")])
    search = gateway(index, [item, private])
    for _ in range(2):
        found, report = await search.search(**query())
        assert found and all(e.source_id == item.id for e in found)
        assert report["methods"] == ["sparse", "dense"]
        assert report["performance"]["scanned_points"] == report["performance"]["scroll_requests"] == 0
        assert report["performance"]["count_requests"] == 1
        assert report["fallbacks"] == []
    await index.client.upsert("text_chunks_agentic", [document(1, item, "needle changed index content")])
    found, _ = await search.search(**query(limit=150))
    assert any("changed index content" in item.content for item in found)
    assert not any(call[0] == "scroll" for call in index.calls)


@pytest.mark.asyncio
async def test_missing_sparse_subset_and_filename_matches_are_scanned_without_widening_scope(index):
    complete, missing, named, private = source(), source(fid="missing"), replace(source(fid="named"), name="needle.pdf"), source("b", "private")
    await index.client.upsert("text_chunks_agentic", [document(n, complete) for n in range(1, 101)] + [
        document(101, missing, sparse=False), document(102, named, text="unrelated body", token=9),
        document(103, private, sparse=False)])
    search = gateway(index, [complete, missing, named, private])
    found, report = await search.search(**query(result_unit="source"))
    assert {e.source_id for e in found} == {complete.id, missing.id, named.id}
    assert report["performance"]["scanned_points"] == 2
    assert report["fallbacks"] == [{"method": "sparse", "modality": "doc", "code": "sparse_coverage_incomplete",
        "fallback": "lexical_missing_vectors", "uncovered_points": 1}]


@pytest.mark.asyncio
async def test_source_results_do_not_lose_other_sources_behind_one_long_document(index):
    a, b, c = source(), source(fid="second"), source(fid="third")
    await index.client.upsert("text_chunks_agentic", [document(n, a) for n in range(1, 101)] +
        [document(101, b), document(102, c)])
    found, report = await gateway(index, [a, b, c]).search(**query(result_unit="source", limit=3))
    assert {item.source_id for item in found} == {a.id, b.id, c.id}
    assert report["returned_source_count"] == 3 and report["performance"]["scanned_points"] == 0
    assert len([call for call in index.calls if call[0] == "query_points_groups"]) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,reason", [("count", "sparse_coverage_unverified"), ("sparse", "sparse_query_failed"),
                                            ("get_collection", "sparse_index_unavailable")])
async def test_unavailable_index_capabilities_or_sparse_channel_fall_back_to_complete_lexical(index, failure, reason):
    item = source()
    await index.client.upsert("text_chunks_agentic", [document(1, item)])
    index.fail.add(failure)
    found, report = await gateway(index, [item]).search(**query())
    assert [e.source_id for e in found] == [item.id]
    assert report["performance"]["scanned_points"] == 1
    assert any(item["code"] == reason for item in report["fallbacks"])
    assert "private connection" not in str(report)
    if failure == "sparse":
        assert report["status"] == "partial"


@pytest.mark.asyncio
async def test_unready_sparse_encoder_falls_back_without_claiming_sparse_search(index):
    item = source()
    await index.client.upsert("text_chunks_agentic", [document(1, item)])
    vectors = QueryVectors(failure="local_model_not_ready")
    found, report = await gateway(index, [item], vectors).search(**query())
    assert found and report["methods"] == ["lexical", "dense"]
    assert report["fallbacks"][0]["code"] == "local_model_not_ready"
    assert not any(call[2].get("using") == "sparse" for call in index.calls)


@pytest.mark.asyncio
async def test_exact_remains_casefolded_substring_search_without_sparse_or_native_calls(index):
    item = source()
    await index.client.upsert("text_chunks_agentic", [document(1, item, "uninterrupted NeedleSuffix 中文原短语"),
        document(2, item, "the terms need le are separate")])
    vectors = QueryVectors()
    found, report = await gateway(index, [item], vectors).search(**query(mode="exact", retrieval_strategy="native"))
    assert [e.locator["point_id"] for e in found] == ["1"]
    assert not vectors.calls
    assert {call[0] for call in index.calls} == {"scroll"}
    assert report["methods"] == ["exact"]


@pytest.mark.asyncio
@pytest.mark.parametrize("modality,kind,name,collection,body", [
    ("image", "clip", "clip_vec", "image_vectors", {"caption": "indexed visual description"}),
    ("audio", "clap", "clap_vec", "audio_vectors", {"description": "indexed audio description"}),
])
async def test_native_strategy_adds_verified_native_channel_and_keeps_caption_as_index_evidence(index, modality, kind, name, collection, body):
    item, private = replace(source(), modality=modality), replace(source("b", "private"), modality=modality)
    await index.client.upsert(collection, [qm.PointStruct(id=n, vector={"text_vec": [0., 1., 0.], name: [1., 0., 0.]},
        payload={"file_id": s.file_id, "kb_id": s.kb_id, **body}) for n, s in [(1, item), (2, private)]])
    vectors = QueryVectors()
    search = gateway(index, [item, private], vectors)
    found, report = await search.search(**query(modalities=[modality], retrieval_strategy="native"))
    assert [e.source_id for e in found] == [item.id]
    assert found[0].observation != "media_observation"
    assert kind in report["methods"] and "dense" in report["methods"]
    assert (kind, "needle") in vectors.calls
    assert any(call[2].get("using") == name for call in index.calls)


@pytest.mark.asyncio
async def test_default_text_strategy_does_not_invoke_native_model(index):
    item = replace(source(), modality="image")
    vectors = QueryVectors()
    _, report = await gateway(index, [item], vectors).search(**query(modalities=["image"]))
    assert not vectors.calls
    assert "clip" not in report["methods"]


@pytest.mark.asyncio
@pytest.mark.parametrize("condition,reason", [("absent", "native_index_unavailable"),
    ("dimension", "native_vector_dimension_mismatch"), ("unready", "local_model_not_ready")])
async def test_native_capability_failure_reports_text_fallback_without_guessing_vector_name(index, condition, reason):
    item = replace(source(), modality="image")
    if condition == "absent":
        index.fail.add("get_collection")
    vectors = QueryVectors(native=[1., 0.] if condition == "dimension" else None,
                           failure="local_model_not_ready" if condition == "unready" else None)
    _, report = await gateway(index, [item], vectors).search(**query(modalities=["image"], retrieval_strategy="native"))
    assert report["status"] == "partial"
    assert report["fallbacks"] == [{"method": "clip", "modality": "image", "code": reason, "fallback": "text"}]
    assert not any(call[2].get("using") == "clip_vec" for call in index.calls)
    if condition == "absent":
        assert not vectors.calls


@pytest.mark.asyncio
async def test_independent_search_channels_overlap_but_never_exceed_capacity_and_cancel_cleanly(index):
    items = [source(), replace(source(fid="song"), modality="audio"), replace(source(fid="picture"), modality="image")]
    search = gateway(index, items)
    await search.search(**query(modalities=["doc", "audio", "image"], retrieval_strategy="native"))
    assert index.maximum == 2
    assert index.active == 0
    task = asyncio.create_task(search.search(**query(modalities=["doc", "audio", "image"])))
    while not index.active:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert index.active == 0
    assert search.channel_gate._value == 2
    assert search.search_gate._value == 1
