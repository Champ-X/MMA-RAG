"""Real local-Qdrant integration for the optional content-prototype lane.

No persistent collections or remote models are used. Legacy summaries must keep
their ranking while grouped prototypes preserve independently traceable sources.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import numpy as np
import pytest
from qdrant_client import QdrantClient, models

from app.core.llm.manager import LLMCallResult
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge.portraits import PortraitGenerator
from app.modules.knowledge.topic_prototypes import build_topic_prototypes


@pytest.fixture
def store():
    client = QdrantClient(location=":memory:")
    client.create_collection("kb_portraits", vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    storage = VectorStore.__new__(VectorStore)
    storage.client = client
    yield storage
    client.close()


def add_point(store, point_id, kb_id, vector, **payload):
    store.client.upsert("kb_portraits", points=[models.PointStruct(
        id=point_id, vector=vector, payload={"kb_id": kb_id, "cluster_size": 1, **payload},
    )])


def portrait(vector, *, topic=None):
    return {"topic_summary": "Existing broad summary", "cluster_size": 2, "cluster_id": 0,
            "vector": vector, **({"topic_prototypes": topic} if topic else {})}


def topic_with_rare_source():
    rows = [SimpleNamespace(id="central-source", vector=[1.0, 0.0], source_type="doc", source_file_id="document-a"),
            SimpleNamespace(id="rare-source", vector=[0.0, 1.0], source_type="image", source_file_id="image-b")]
    return build_topic_prototypes(rows, {"k": 1, "labels": [0, 0], "centers": [[1.0, 0.0]]})[0]


@pytest.mark.asyncio
async def test_prototype_lane_does_not_change_legacy_summary_ranking_or_listing(store):
    # Old records have no portrait_role. They must remain valid summary nodes.
    add_point(store, 1, "target", [1.0, 0.0], topic_summary="Old target")
    add_point(store, 2, "other", [.6, .8], topic_summary="Old other")
    before = await store.search_kb_portraits_topn([0.0, 1.0])

    await store.upsert_kb_portraits("target", [portrait([1.0, 0.0], topic=topic_with_rare_source())])
    after = await store.search_kb_portraits_topn([0.0, 1.0])
    listing = await store.search_kb_portraits("target")
    content = await store.search_kb_topic_prototypes([0.0, 1.0])

    assert [row["kb_id"] for row in before] == [row["kb_id"] for row in after]
    assert [row["score"] for row in before] == pytest.approx([row["score"] for row in after])
    assert len(listing) == 1
    assert listing[0]["payload"]["topic_summary"] == "Existing broad summary"
    assert [(row["kb_id"], row["score"]) for row in content] == [("target", pytest.approx(1.0))]
    assert content[0]["payload"]["source_id"] == "rare-source"


@pytest.mark.asyncio
async def test_grouped_prototypes_do_not_let_duplicates_crowd_other_kbs_out(store):
    for point_id, kb_id, score in [(1, "a", .95), (2, "b", 1.0), (3, "c", .8)]:
        add_point(store, point_id, kb_id, [float(np.sqrt(1 - score ** 2)), score],
                  portrait_role="topic_prototype", topic_id="0", prototype_role="medoid")
    before = await store.search_kb_topic_prototypes([0.0, 1.0], limit=3)

    for index in range(100):
        add_point(store, 1000 + index, "a", [float(np.sqrt(1 - .95 ** 2)), .95],
                  portrait_role="topic_prototype", topic_id=str(index), prototype_role="diverse")
    after = await store.search_kb_topic_prototypes([0.0, 1.0], limit=3)

    assert len(after) == 3
    assert {row["kb_id"]: row["score"] for row in after} == pytest.approx({row["kb_id"]: row["score"] for row in before})
    assert {row["kb_id"] for row in after} == {"a", "b", "c"}
    assert await store.search_kb_portraits_topn([0.0, 1.0]) == []


@pytest.mark.asyncio
async def test_upsert_deduplicates_vectors_but_preserves_retained_source_references(store):
    topic = topic_with_rare_source()
    receipt = await store.upsert_kb_portraits("target", [portrait([1.0, 0.0], topic=topic)])
    rows, _ = store.client.scroll("kb_portraits", limit=20, with_payload=True, with_vectors=True)

    assert receipt["points_inserted"] == 3  # One summary, center+medoid merged, one rare source.
    prototypes = [row for row in rows if row.payload["portrait_role"] == "topic_prototype"]
    assert len(prototypes) == 2
    rare, = [row for row in prototypes if row.payload["source_id"] == "rare-source"]
    assert rare.payload["source_file_id"] == "image-b"
    assert rare.payload["source_type"] == "image"
    assert rare.payload["embedding_space"] is None
    assert rare.payload["topic_id"] == "0"
    assert all(np.linalg.norm(row.vector) == pytest.approx(1.0) for row in prototypes)
    # Deduplicating a centroid/medoid vector must not discard the real source.
    source_refs = [ref for row in prototypes for ref in row.payload["source_refs"]]
    assert {ref["id"] for ref in source_refs} == {"central-source", "rare-source"}
    assert any(ref["id"] == "central-source" and ref["role"] == "medoid" for ref in source_refs)


@pytest.mark.asyncio
async def test_summary_only_old_index_and_old_upsert_contract_remain_usable(store):
    add_point(store, 1, "old", [0.0, 1.0], topic_summary="Legacy")
    assert await store.search_kb_topic_prototypes([0.0, 1.0]) == []
    assert len(await store.search_kb_portraits("old")) == 1

    receipt = await store.upsert_kb_portraits("old", [portrait([0.0, 1.0])])

    assert receipt["points_inserted"] == 1
    assert await store.search_kb_topic_prototypes([0.0, 1.0]) == []
    assert (await store.search_kb_portraits_topn([0.0, 1.0]))[0]["kb_id"] == "old"


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [[float("nan"), 1.0], [0.0, 0.0], [1.0, 0.0, 0.0]])
async def test_invalid_new_prototype_is_rejected_before_deleting_existing_summary(store, invalid):
    add_point(store, 1, "old", [0.0, 1.0], topic_summary="Keep me")
    topic = {"centroid_vector": invalid}

    with pytest.raises(ValueError, match="prototype"):
        await store.upsert_kb_portraits("old", [portrait([1.0, 0.0], topic=topic)])

    rows = await store.search_kb_portraits("old")
    assert len(rows) == 1
    assert rows[0]["payload"]["topic_summary"] == "Keep me"


@pytest.mark.asyncio
async def test_actual_portrait_builder_persists_queryable_real_content_prototypes(store):
    named = {
        "text_chunks_agentic": ["dense"], "image_vectors": ["text_vec"],
        "audio_vectors": ["text_vec"], "video_shot_vectors": ["caption_dense", "asr_dense"],
    }
    for collection, names in named.items():
        store.client.create_collection(collection, vectors_config={
            name: models.VectorParams(size=2, distance=models.Distance.COSINE) for name in names
        })
    ids = [str(uuid.UUID(int=index)) for index in (1, 2)]
    store.client.upsert("text_chunks_agentic", points=[models.PointStruct(
        id=point_id, vector={"dense": vector},
        payload={"kb_id": "target", "file_id": f"file-{index}", "text_content": text},
    ) for index, (point_id, vector, text) in enumerate(zip(ids, [[1.0, 0.0], [0.0, 1.0]], ["数据库系统", "植物生态"]))])
    generator = PortraitGenerator.__new__(PortraitGenerator)
    generator.vector_store = store
    generator.prompt_engine = SimpleNamespace(render_template=Mock(return_value="A broad source-grounded topic"))
    generator.llm_manager = SimpleNamespace(
        chat=AsyncMock(return_value=LLMCallResult(True, data={"choices": [{"message": {"content": "宽泛主题摘要"}}]})),
        embed=AsyncMock(return_value=LLMCallResult(True, data=[[1.0, 0.0]])),
    )

    result = await generator.update_kb_portrait("target", force_update=True)
    summary = await store.search_kb_portraits_topn([0.0, 1.0])
    prototype = await store.search_kb_topic_prototypes([0.0, 1.0])
    listing = await store.search_kb_portraits("target")

    assert result["status"] == "success"
    assert result["portraits"][0]["topic_prototypes"]["distinct_sample_count"] == 2
    assert summary[0]["score"] == pytest.approx(0.0)
    assert prototype[0]["score"] == pytest.approx(1.0)
    assert prototype[0]["payload"]["source_id"] == ids[1]
    assert len(listing) == 1
    assert "prototype_coverage" in listing[0]["payload"]
    assert "centroid_vector" not in listing[0]["payload"]["prototype_coverage"]
    assert {ref["id"] for ref in listing[0]["payload"]["prototype_source_refs"]} == set(ids)
    assert all("vector" not in ref for ref in listing[0]["payload"]["prototype_source_refs"])
    generator.llm_manager.chat.assert_awaited_once()
    generator.llm_manager.embed.assert_awaited_once()
