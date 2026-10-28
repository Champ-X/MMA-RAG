from types import SimpleNamespace
import json

import numpy as np
import pytest

from evaluation.knowledge_routing import assign_splits, coverage, load_snapshot, portrait_hits, relocate_cases, sha
from evaluation.knowledge_routing_live import evidence_coverage
from evaluation.knowledge_routing_prototypes import isolated_prototype_collection, prototype_points
from evaluation.knowledge_routing_excerpts import excerpt_cases
from evaluation.retrieval_systems import system_fingerprint


def anchor(*kb_ids, source="source"):
    return {"original_anchor": {"source_id": source}, "matches": [{"kb_id": kb} for kb in kb_ids]}


def case(groups, identifier="q", cluster="cluster"):
    return {"id": identifier, "cluster_id": cluster,
            "groups": [{"id": str(i), "alternatives": alternatives} for i, alternatives in enumerate(groups)]}


def test_alternative_sources_do_not_require_every_relevant_library():
    query = case([[[anchor("A")], [anchor("B")]]])
    assert coverage(query, ["A"])["all_groups"]
    assert coverage(query, ["B"])["all_groups"]
    assert not coverage(query, ["C"])["all_groups"]


def test_joint_evidence_in_alternative_requires_both_libraries():
    query = case([[[anchor("A"), anchor("B")], [anchor("C")]]])
    assert coverage(query, ["A", "B"])["all_groups"]
    assert coverage(query, ["C"])["all_groups"]
    assert not coverage(query, ["A"])["all_groups"]


def test_each_required_group_must_be_covered():
    query = case([[[anchor("A", "B")]], [[anchor("C")]]])
    value = coverage(query, ["B"])
    assert value["group_recall"] == .5
    assert not value["all_groups"]
    assert coverage(query, ["B", "C"])["all_groups"]


def test_source_connected_split_is_stable_and_does_not_leak():
    cases = [case([[[anchor("A", source="shared")]]], "a", "first"),
             case([[[anchor("A", source="shared")], [anchor("B", source="second")]]], "b", "second"),
             case([[[anchor("B", source="second")]]], "c", "third"),
             case([[[anchor("D", source="other")]]], "d", "other")]
    assign_splits(cases)
    assert len({row["split_group"] for row in cases[:3]}) == 1
    assert len({row["split"] for row in cases[:3]}) == 1
    expected = {row["id"]: (row["split"], row["split_group"]) for row in cases}
    cases.reverse()
    assign_splits(cases)
    assert expected == {row["id"]: (row["split"], row["split_group"]) for row in cases}


def test_relocation_requires_complete_evidence_and_matching_modality():
    a = {"source_id": "old", "quote": "稀有植物名称", "source_sha256": "original-hash"}
    queries = [{"id": "complete", "query": "它是什么", "cluster_id": "cluster", "split": "test",
                "scope": {"kb_ids": ["old-kb"]}, "evidence_groups": [{"id": "g", "alternatives": [[a]]}]},
               {"id": "partial", "query": "联合需求", "cluster_id": "cluster", "split": "test",
                "evidence_groups": [{"id": "g", "alternatives": [[a, {**a, "quote": "不存在的证据"}]]}]}]
    dataset = SimpleNamespace(cases=queries, sources={"old": {"modality": "doc"}})
    content = [{"collection": "image_vectors", "id": "wrong-modality", "payload": {"kb_id": "wrong", "caption": "稀有植物名称"}},
               {"collection": "text_chunks_agentic", "id": "right", "payload": {"kb_id": "new", "text_content": "稀有 植物名称"}}]
    kept, excluded = relocate_cases(dataset, content)
    assert [q["id"] for q in kept] == ["complete"]
    assert excluded[0]["case_id"] == "partial"
    assert kept[0]["original_scope"] == {"kb_ids": ["old-kb"]}
    assert kept[0]["groups"][0]["alternatives"][0][0]["matches"][0]["kb_id"] == "new"
    assert len(kept[0]["groups"][0]["alternatives"][0][0]["matches"]) == 1


def test_portrait_replay_uses_cosine_and_preserves_topn_identity():
    portraits = [{"id": str(i), "payload": {"kb_id": f"kb-{i}"}} for i in range(3)]
    hits = portrait_hits(np.array([[2., 0.]]), np.array([[0., 8.], [3., 0.], [-2., 0.]]), portraits, 2)
    assert [r["id"] for r in hits[0]] == ["1", "0"]
    assert hits[0][0]["score"] == pytest.approx(1.)


def test_retrieval_fingerprint_includes_routing_and_portrait_dependencies():
    paths = system_fingerprint()
    for path in ("backend/app/modules/knowledge/router.py", "backend/app/modules/knowledge/portraits.py",
                 "backend/app/core/portrait_trigger.py", "backend/app/modules/ingestion/storage/vector_store.py"):
        assert path in paths
        assert len(paths[path]) == 64


def test_live_evidence_requires_point_kb_and_visible_quote():
    query = case([[[{"original_anchor": {"source_id": "source", "quote": "真实台词"},
                     "matches": [{"kb_id": "film", "point_id": "shot-1"}]}]]])
    hit = {"id": "shot-1", "source": {"knowledge_base_id": "film"}, "content": "语音：真实 台词"}
    assert evidence_coverage(query, [hit])["all_groups"]
    assert not evidence_coverage(query, [{**hit, "id": "another-shot"}])["all_groups"]
    assert not evidence_coverage(query, [{**hit, "source": {"knowledge_base_id": "wrong"}}])["all_groups"]
    assert not evidence_coverage(query, [{**hit, "content": "同一人物的另一段台词"}])["all_groups"]


def test_snapshot_integrity_rejects_changed_labels(tmp_path):
    (tmp_path / "cases.json").write_text(json.dumps([{"id": "q"}]))
    (tmp_path / "portraits.json").write_text(json.dumps([{"id": "p", "vector": [1., 0.]}]))
    np.save(tmp_path / "queries.npy", np.array([[1., 0.]], dtype=np.float32))
    files = {name: sha(tmp_path / name) for name in ("cases.json", "portraits.json", "queries.npy")}
    (tmp_path / "manifest.json").write_text(json.dumps({"schema_version": "knowledge-routing-snapshot-1", "files": files}))
    assert load_snapshot(tmp_path)[3].shape == (1, 2)
    (tmp_path / "cases.json").write_text(json.dumps([{"id": "changed"}]))
    with pytest.raises(ValueError, match="snapshot checksum mismatch"):
        load_snapshot(tmp_path)


@pytest.mark.asyncio
async def test_mixed_snapshot_keeps_full_integrity_but_summary_replays_exclude_old_prototypes(tmp_path):
    from evaluation.knowledge_routing import replay
    from evaluation.knowledge_routing_prototypes import replay as replay_prototypes

    snapshot_path = tmp_path / "snapshot"
    snapshot_path.mkdir()
    portraits = [
        {"id": 1, "vector": [.6, .8], "payload": {"kb_id": "A"}},
        {"id": 2, "vector": [.1, .995], "payload": {"kb_id": "B", "portrait_role": "summary"}},
        {"id": 3, "vector": [1., 0.], "payload": {"kb_id": "old-prototype", "portrait_role": "topic_prototype"}},
    ]
    query = {**case([[[anchor("A")]]]), "query": "synthetic question", "split": "test"}
    (snapshot_path / "cases.json").write_text(json.dumps([query]))
    (snapshot_path / "portraits.json").write_text(json.dumps(portraits))
    np.save(snapshot_path / "queries.npy", np.array([[1., 0.]], dtype=np.float32))
    files = {name: sha(snapshot_path / name) for name in ("cases.json", "portraits.json", "queries.npy")}
    (snapshot_path / "manifest.json").write_text(json.dumps({
        "schema_version": "knowledge-routing-snapshot-1", "files": files,
        "dataset_fingerprint": "synthetic-mixed-portrait-fixture", "limits": [],
    }))

    # Full records and their vector alignment are still available to live checks.
    _, _, loaded, _, vectors = load_snapshot(snapshot_path)
    assert loaded == portraits
    assert vectors.shape == (3, 2)
    ordinary_output = tmp_path / "ordinary"
    await replay(snapshot_path, ordinary_output, modes=["legacy", "max"], top_n=30, max_targets=2, repeats=3)
    report = json.loads((ordinary_output / "report.json").read_text())
    for policy in report["policies"].values():
        result = policy["cases"][0]
        assert result["target_kb_ids"] == ["A"]
        assert result["candidate_kb_ids"] == ["A", "B"]

    samples = tmp_path / "samples"
    samples.mkdir()
    for kb_id, vector in (("A", [.6, .8]), ("B", [1., 0.])):
        (samples / f"{kb_id}.json").write_text(json.dumps({
            "kb_id": kb_id, "samples": [{"id": f"source-{kb_id}", "source_type": "doc"}],
            "clustering": {"k": 1, "labels": [0], "centers": [vector]},
        }))
        np.save(samples / f"{kb_id}.npy", np.array([vector], dtype=np.float32))
    prototype_output = tmp_path / "prototypes"
    await replay_prototypes(snapshot_path, samples, prototype_output)
    policies = json.loads((prototype_output / "report.json").read_text())["policies"]
    assert policies["summary_legacy"]["cases"][0]["target_kb_ids"] == ["A"]
    assert policies["summary_max"]["cases"][0]["target_kb_ids"] == ["A"]
    # Only new shadow prototypes participate, and their winning signal survives.
    for mode in ("prototype_max", "combined_max"):
        result = policies[mode]["cases"][0]
        assert result["target_kb_ids"] == ["B"]
        assert set(result["scores"]) == {"A", "B"}

    assert sha(snapshot_path / "portraits.json") == files["portraits.json"]
    portraits[-1]["vector"] = [0., 1.]
    (snapshot_path / "portraits.json").write_text(json.dumps(portraits))
    with pytest.raises(ValueError, match="snapshot checksum mismatch"):
        load_snapshot(snapshot_path)


def test_shadow_prototype_points_preserve_identity_and_remove_duplicate_vectors():
    topics = {"kb": [{"cluster_id": 2, "sample_support_count": 3, "centroid_vector": [1., 0.],
                       "representatives": [{"vector": [2., 0.]}, {"vector": [0., 1.]}]}]}
    points = prototype_points(topics)
    assert len(points) == 2
    assert points == prototype_points(topics)
    assert len({p["id"] for p in points}) == 2
    assert all(p["payload"]["portrait_role"] == "topic_prototype" and p["payload"]["kb_id"] == "kb" for p in points)


def test_shadow_collection_copies_only_summaries_from_mixed_fixture(tmp_path, monkeypatch):
    import qdrant_client
    from qdrant_client import QdrantClient, models

    topics = {"kb": [{"cluster_id": 0, "sample_support_count": 1, "centroid_vector": [1., 0.]}]}
    path = tmp_path / "topics.json"
    path.write_text(json.dumps(topics))
    expected = prototype_points(topics)
    # An existing prototype may even share the freshly generated point ID.
    mixed = [
        {"id": 1, "vector": [0., 1.], "payload": {"kb_id": "legacy"}},
        {"id": 2, "vector": [.6, .8], "payload": {"kb_id": "new", "portrait_role": "summary"}},
        *expected,
        {"id": 3, "vector": [1., 0.], "payload": {"kb_id": "old", "portrait_role": "topic_prototype"}},
    ]
    client = QdrantClient(location=":memory:")
    close = client.close
    monkeypatch.setattr(client, "close", lambda: None)
    monkeypatch.setattr(qdrant_client, "QdrantClient", lambda **kwargs: client)
    client.create_collection("kb_portraits", vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    client.upsert("kb_portraits", points=[models.PointStruct(**point) for point in mixed])
    try:
        with isolated_prototype_collection("unused", path, mixed) as fixture:
            rows, _ = client.scroll(fixture["collection"], with_payload=True, with_vectors=True)
            assert fixture["summary_points"] == 2
            assert fixture["prototype_points"] == 1
            assert {str(row.id) for row in rows} == {"1", "2", expected[0]["id"]}
        assert fixture["deleted_after_run"]
        assert client.count("kb_portraits", exact=True).count == len(mixed)
    finally:
        close()


def test_transport_benchmark_filters_prototypes_but_fingerprints_full_collection():
    from qdrant_client import QdrantClient, models
    from scripts.benchmark_portrait_transport import query_summaries, snapshot

    client = QdrantClient(location=":memory:")
    client.create_collection("kb_portraits", vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    client.upsert("kb_portraits", points=[
        models.PointStruct(id=1, vector=[.6, .8], payload={"kb_id": "legacy"}),
        models.PointStruct(id=2, vector=[0., 1.], payload={"kb_id": "new", "portrait_role": "summary"}),
        models.PointStruct(id=3, vector=[1., 0.], payload={"kb_id": "prototype", "portrait_role": "topic_prototype"}),
    ])
    try:
        before = snapshot(client)
        for payload in (True, ["kb_id", "cluster_size"]):
            result = query_summaries(client, [1., 0.], payload)
            assert [point.id for point in result.points] == [1, 2]
        client.set_payload("kb_portraits", payload={"revision": 2}, points=[3])
        assert snapshot(client) != before
    finally:
        client.close()


def test_shadow_collection_failure_cleans_only_its_new_uuid_collection(tmp_path, monkeypatch):
    from qdrant_client import QdrantClient

    topics = tmp_path / "topics.json"
    topics.write_text(json.dumps({"kb": [{"cluster_id": 0, "sample_support_count": 1, "centroid_vector": [1., 0.]}]}))
    mutations = []
    existing = {"kb_portraits", "text_chunks_agentic"}
    monkeypatch.setattr(QdrantClient, "collection_exists", lambda self, name: name in existing)

    def create(self, name, **kwargs):
        mutations.append(("create", name))
        existing.add(name)

    def fail_upsert(self, name, **kwargs):
        mutations.append(("upsert", name))
        raise RuntimeError("simulated index failure")

    def delete(self, name):
        mutations.append(("delete", name))
        existing.remove(name)

    monkeypatch.setattr(QdrantClient, "create_collection", create)
    monkeypatch.setattr(QdrantClient, "upsert", fail_upsert)
    monkeypatch.setattr(QdrantClient, "delete_collection", delete)
    with pytest.raises(RuntimeError, match="simulated"):
        with isolated_prototype_collection("http://127.0.0.1:6333", topics):
            pytest.fail("failed creation must not yield")
    names = {name for _, name in mutations}
    assert len(names) == 1 and next(iter(names)).startswith("eval_knowledge_routing_")
    assert [action for action, _ in mutations] == ["create", "upsert", "delete"]
    assert existing == {"kb_portraits", "text_chunks_agentic"}


def test_excerpt_attribution_is_deterministic_and_accepts_all_indexed_copies():
    quote = "This is an original indexed source excerpt with enough characters for deterministic attribution."
    content = [{"id": "p1", "collection": "text_chunks_agentic", "payload": {"kb_id": "A", "file_id": "one", "text_content": quote}},
               {"id": "p2", "collection": "image_vectors", "payload": {"kb_id": "B", "file_id": "two", "caption": quote}}]
    forward, backward = excerpt_cases(content, 1), excerpt_cases(list(reversed(content)), 1)
    assert len(forward) == len(backward) == 1
    assert forward[0]["query"] == backward[0]["query"] == quote
    assert forward[0]["split"] == "diagnostic"
    assert coverage(forward[0], ["A"])["all_groups"]
    assert coverage(forward[0], ["B"])["all_groups"]
    assert not coverage(forward[0], ["C"])["all_groups"]
