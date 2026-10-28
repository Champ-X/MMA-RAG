"""Content preservation invariants for deterministic topic prototypes.

These are constructed coverage cases, not a real-query quality benchmark.
"""
import json
from types import SimpleNamespace

import numpy as np
import pytest

from app.modules.knowledge.topic_prototypes import build_topic_prototypes, topic_routing_vectors


def sample(point_id, vector, source=None, modality="doc"):
    return SimpleNamespace(id=point_id, vector=vector, source_file_id=source, source_type=modality, scene_id=None)


def cluster(samples, center):
    return {"k": 1, "labels": [0] * len(samples), "centers": [center]}


def test_rare_subdirection_survives_a_dominant_document():
    rows = [sample(f"dominant-{i:02d}", [1.0, 0.0], "long-document") for i in range(20)]
    rows.append(sample("rare", [0.0, 1.0], "rare-document", "image"))

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]), max_representatives=2)

    assert topic["representatives"][0]["id"] == "dominant-00"
    assert topic["representatives"][0]["role"] == "medoid"
    assert topic["representatives"][1]["id"] == "rare"
    assert topic["centroid_radius"] == pytest.approx(1.0)
    assert topic["coverage_radius"] == pytest.approx(0.0)
    assert topic["modalities"] == ["doc", "image"]
    # A coincident center and real medoid are traceable, but only one signal.
    assert topic["routing_vector_count"] == 2
    assert topic["representatives"][0]["redundant_with_centroid"]


def test_medoid_is_a_real_nearest_sample_not_an_invented_vector():
    rows = [sample("far", [0.0, 1.0]), sample("near", [0.8, 0.2]), sample("middle", [0.6, 0.4])]

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]), max_representatives=1)

    medoid, = topic["representatives"]
    assert medoid["id"] == "near"
    np.testing.assert_allclose(medoid["vector"], np.array([.8, .2]) / np.linalg.norm([.8, .2]))
    assert medoid["source_file_id"] is None
    assert topic["distinct_source_count"] == 0
    assert topic["unknown_source_sample_count"] == 3


def test_comparable_semantic_coverage_prefers_an_unseen_source():
    rows = [sample("a-center", [1.0, 0.0], "file-a"), sample("a-tail", [0.0, 1.0], "file-a"),
            sample("b-tail", [.1, np.sqrt(.99)], "file-b")]

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]), max_representatives=2)

    assert [r["source_file_id"] for r in topic["representatives"]] == ["file-a", "file-b"]
    assert topic["represented_source_count"] == 2
    assert topic["unrepresented_source_count"] == 0
    assert topic["coverage_radius"] < .01


def test_new_file_with_weak_novelty_cannot_displace_rare_content():
    rows = [sample("center", [1.0, 0.0], "file-a"), sample("rare", [0.0, 1.0], "file-a"),
            sample("new-but-similar", [.98, .2], "file-b")]

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]), max_representatives=2)

    assert topic["representatives"][1]["id"] == "rare"
    assert topic["unrepresented_source_count"] == 1


def test_duplicate_references_and_near_vectors_do_not_consume_more_routing_votes():
    rows = [sample("a", [1.0, 0.0], "file-a"), sample("a", [1.0, 0.0], "file-a"),
            sample("near-copy", [1.0, .001], "file-b"), sample("b", [0.0, 1.0], "file-c")]

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]), max_representatives=8)

    assert topic["duplicate_reference_count"] == 1
    assert topic["valid_sample_count"] == 4
    assert topic["distinct_sample_count"] == 3
    assert len(topic["representatives"]) == 2
    assert topic["routing_vector_count"] == 2
    assert topic["sample_support_count"] == 4  # Sample support, not corpus mass.


def test_invalid_vectors_and_minority_dimensions_do_not_poison_topics():
    rows = [sample("wrong-first-dimension", [1.0, 0.0, 0.0]),
            sample("a", [1.0, 0.0]), sample("b", [0.0, 1.0]), sample("c", [.5, .5]),
            sample("nan", [float("nan"), 1.0]), sample("zero", [0.0, 0.0]),
            sample("boolean", [True, False]), sample("nested", [[1.0, 0.0]]), sample("", [1.0, 0.0])]

    topic, = build_topic_prototypes(rows, cluster(rows, [1.0, 0.0]))

    assert topic["valid_sample_count"] == 3
    assert topic["discarded_sample_count"] == 6
    assert all(len(vector) == 2 for vector in topic_routing_vectors(topic))
    assert all(np.isfinite(vector).all() for vector in topic_routing_vectors(topic))
    assert topic["embedding_space"] is None
    assert "embedding_model" not in topic
    json.dumps(topic, allow_nan=False)


def test_empty_or_entirely_invalid_topics_do_not_publish_fake_representatives():
    assert build_topic_prototypes([], {"k": 0, "labels": [], "centers": []}) == []
    rows = [sample("bad", [float("inf"), 1.0])]
    assert build_topic_prototypes(rows, cluster(rows, [1.0, 0.0])) == []


def test_missing_or_degenerate_centers_fall_back_to_real_content():
    rows = [sample("a", [1.0, 0.0]), sample("b", [-1.0, 0.0])]

    topic, = build_topic_prototypes(rows, cluster(rows, [0.0, 0.0]), max_representatives=2)

    assert topic["centroid_source"] == "first_stable_sample"
    assert topic["centroid_vector"] == [1.0, 0.0]
    assert topic["representatives"][0]["id"] == "a"
    assert topic["coverage_radius"] == pytest.approx(0.0)


def test_permuted_samples_and_labels_produce_identical_json():
    rows = [sample("z", [0.0, 1.0], "file-z"), sample("a", [1.0, 0.0], "file-a"),
            sample("b", [.9, .1], "file-b"), sample("c", [.1, .9], "file-c")]
    clustering = {"k": 2, "labels": [1, 0, 0, 1], "centers": [[1.0, 0.0], [0.0, 1.0]]}

    forward = build_topic_prototypes(rows, clustering)
    backward = build_topic_prototypes(list(reversed(rows)), {**clustering, "labels": list(reversed(clustering["labels"]))})

    assert json.dumps(forward, sort_keys=True) == json.dumps(backward, sort_keys=True)
    assert [topic["cluster_id"] for topic in forward] == [0, 1]


def test_budget_is_bounded_and_more_representatives_do_not_reduce_sample_coverage():
    rng = np.random.default_rng(42)
    rows = [sample(str(i), vector.tolist(), f"source-{i % 3}") for i, vector in enumerate(rng.normal(size=(24, 8)))]
    radii = []
    for budget in (1, 2, 3, 8):
        topic, = build_topic_prototypes(rows, cluster(rows, np.mean([r.vector for r in rows], axis=0)),
                                        max_representatives=budget)
        assert 1 <= len(topic["representatives"]) <= budget
        assert topic["routing_vector_count"] <= budget + 1
        vectors = np.asarray(topic_routing_vectors(topic))
        np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-6)
        matrix = np.asarray([r.vector for r in rows])
        matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
        actual_radius = np.maximum(0, 1.0 - (matrix @ vectors.T).max(axis=1)).max()
        assert topic["coverage_radius"] == pytest.approx(actual_radius, abs=1e-6)
        radii.append(topic["coverage_radius"])
    assert all(after <= before + 1e-6 for before, after in zip(radii, radii[1:]))


@pytest.mark.parametrize("budget", [0, 17, True, 1.5])
def test_invalid_budget_is_rejected(budget):
    with pytest.raises(ValueError, match="max_representatives"):
        build_topic_prototypes([], {"k": 0, "labels": [], "centers": []}, max_representatives=budget)


@pytest.mark.parametrize("clustering", [
    {"k": 1, "labels": [], "centers": []},
    {"k": 1, "labels": [1], "centers": []},
    {"k": 1, "labels": [-1], "centers": []},
    {"k": 1, "labels": [True], "centers": []},
    {"k": 1, "labels": ["0"], "centers": []},
    {"k": True, "labels": [0], "centers": []},
])
def test_label_misalignment_is_rejected_instead_of_silently_truncating(clustering):
    with pytest.raises(ValueError):
        build_topic_prototypes([sample("a", [1.0, 0.0])], clustering)
