"""Deterministic, source-grounded representations of existing topic clusters.

This module does not choose K, generate summaries, or infer embedding provenance.
One topic is one routing signal: centroid/medoid/diverse exemplars are alternative
representations, not independent votes. Call ``topic_routing_vectors`` to obtain
the deduplicated vectors for max-within-topic matching.

The duplicate threshold and diversity tolerance are experimental policy values,
not calibrated relevance probabilities. Coverage describes only supplied samples,
not the full corpus or the probability that a query can be answered.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
import hashlib
import numbers
from typing import Any

import numpy as np

SCHEMA_VERSION = "topic-prototypes-1"
NEAR_DUPLICATE_COSINE = 0.995
SOURCE_DIVERSITY_RELATIVE_FLOOR = 0.8
MAX_REPRESENTATIVES = 16


def _field(sample: Any, name: str, default=None):
    return sample.get(name, default) if isinstance(sample, Mapping) else getattr(sample, name, default)


def _unit_vector(value: Any) -> np.ndarray | None:
    """Accept finite real one-dimensional vectors; never flatten corrupt input."""
    try:
        array = np.asarray(value)
        if array.ndim != 1 or not array.size or array.dtype.kind not in "fiu":
            return None
        array = array.astype(np.float64)
        if not np.isfinite(array).all():
            return None
        scale = float(np.max(np.abs(array)))
        if scale == 0:
            return None
        scaled = array / scale
        return (scaled / np.linalg.norm(scaled)).astype(np.float32)
    except (TypeError, ValueError, OverflowError):
        return None


def _reference(sample: Any) -> dict:
    return {
        "id": str(_field(sample, "id") or ""),
        "source_type": str(_field(sample, "source_type") or "unknown"),
        "source_file_id": str(_field(sample, "source_file_id") or "") or None,
        "scene_id": str(_field(sample, "scene_id") or "") or None,
    }


def _stable_key(row: dict) -> tuple:
    ref = row["ref"]
    return (ref["id"], ref["source_file_id"] or "", ref["source_type"], ref["scene_id"] or "",
            hashlib.sha256(row["vector"].astype("<f4").tobytes()).hexdigest())


def topic_routing_vectors(topic: Mapping) -> list[list[float]]:
    """Return unique alternative vectors, never a set of additive topic votes.

    The real medoid reference remains available even when it coincides with the
    centroid; this helper prevents that duplicate from consuming routing slots.
    """
    kept = []
    for value in [topic.get("centroid_vector"), *(r.get("vector") for r in topic.get("representatives", []))]:
        vector = _unit_vector(value)
        if vector is None or kept and vector.shape != kept[0].shape:
            continue
        if kept and max(float(vector @ other) for other in kept) >= NEAR_DUPLICATE_COSINE:
            continue
        kept.append(vector)
    return [vector.tolist() for vector in kept]


def build_topic_prototypes(
    samples: Sequence[Any], clustering: Mapping, *, max_representatives: int = 3,
) -> list[dict]:
    """Build a centroid plus bounded real exemplars for each existing cluster.

    ``max_representatives`` includes the mandatory medoid. Diversity selection
    first finds the largest remaining semantic gap. Among candidates retaining
    at least 80% of that gap, an unseen known source is preferred. Thus a new
    file with a near-duplicate fragment cannot displace a meaningful rare topic.
    Missing source IDs fall back to stable point identity, not invented files.

    Invalid vectors and minority dimensions are excluded and counted. Dimension
    is inferred from the modal valid sample dimension (centers break ties), not
    from whichever point arrived first. This cannot prove model-space identity.
    The function is CPU work and should run off the API event loop.
    """
    if (isinstance(max_representatives, bool) or not isinstance(max_representatives, numbers.Integral)
            or not 1 <= max_representatives <= MAX_REPRESENTATIVES):
        raise ValueError(f"max_representatives must be between 1 and {MAX_REPRESENTATIVES}")
    labels = clustering.get("labels", [])
    k = clustering.get("k")
    if isinstance(k, bool) or not isinstance(k, numbers.Integral) or k < 0:
        raise ValueError("clustering.k must be a nonnegative integer")
    if len(labels) != len(samples):
        raise ValueError("clustering.labels must align with every sample")
    if any(isinstance(label, bool) or not isinstance(label, numbers.Integral) or not 0 <= label < k for label in labels):
        raise ValueError("clustering.labels contain an invalid cluster ID")

    centers = [_unit_vector(value) for value in clustering.get("centers", [])]
    rows = [{"ref": _reference(sample), "vector": _unit_vector(_field(sample, "vector")), "label": int(label)}
            for sample, label in zip(samples, labels)]
    dimensions = Counter(row["vector"].size for row in rows if row["vector"] is not None and row["ref"]["id"])
    if not dimensions:
        return []
    center_dimensions = Counter(center.size for center in centers if center is not None)
    dimension = max(dimensions, key=lambda dim: (dimensions[dim], center_dimensions[dim], -dim))
    topics = []
    for cluster_id in sorted(set(labels)):
        cluster = [row for row in rows if row["label"] == cluster_id]
        valid = [row for row in cluster if row["vector"] is not None and row["vector"].size == dimension and row["ref"]["id"]]
        if not valid:
            continue
        valid.sort(key=_stable_key)
        # Repeated source references cannot create additional representatives.
        unique = {}
        for row in valid:
            ref = row["ref"]
            unique.setdefault((ref["id"], ref["source_type"], ref["source_file_id"], ref["scene_id"]), row)
        candidates = list(unique.values())
        matrix = np.stack([row["vector"] for row in candidates])
        center = centers[cluster_id] if cluster_id < len(centers) else None
        center_source = "clustering_center"
        if center is None or center.size != dimension:
            center = _unit_vector(np.mean(matrix, axis=0, dtype=np.float64))
            center_source = "sample_mean"
        if center is None:
            center = matrix[0].copy()
            center_source = "first_stable_sample"
        center_similarities = np.clip(matrix @ center, -1.0, 1.0)
        # Candidates are stably sorted, making equal-distance medoids stable.
        medoid_index = int(np.argmax(center_similarities))
        selected = [medoid_index]
        known_selected_sources = {candidates[medoid_index]["ref"]["source_file_id"]} - {None}
        nearest_similarity = center_similarities.copy()
        if center_similarities[medoid_index] < NEAR_DUPLICATE_COSINE:
            nearest_similarity = np.maximum(nearest_similarity, matrix @ matrix[medoid_index])

        while len(selected) < max_representatives:
            eligible = [index for index in range(len(candidates)) if index not in selected
                        and nearest_similarity[index] < NEAR_DUPLICATE_COSINE]
            if not eligible:
                break
            gaps = {index: 1.0 - float(nearest_similarity[index]) for index in eligible}
            largest_gap = max(gaps.values())
            comparable = [index for index in eligible if gaps[index] >= largest_gap * SOURCE_DIVERSITY_RELATIVE_FLOOR]
            diverse_sources = [index for index in comparable if candidates[index]["ref"]["source_file_id"]
                               and candidates[index]["ref"]["source_file_id"] not in known_selected_sources]
            pool = diverse_sources or eligible
            selected_index = max(pool, key=lambda index: (gaps[index], -index))
            selected.append(selected_index)
            known_selected_sources.update({candidates[selected_index]["ref"]["source_file_id"]} - {None})
            nearest_similarity = np.maximum(nearest_similarity, matrix @ matrix[selected_index])

        representatives = [{**candidates[index]["ref"], "vector": matrix[index].tolist(),
                            "role": "medoid" if rank == 0 else "diverse",
                            "redundant_with_centroid": bool(center_similarities[index] >= NEAR_DUPLICATE_COSINE)}
                           for rank, index in enumerate(selected)]
        all_vectors = np.stack([row["vector"] for row in valid])
        routing_vectors = topic_routing_vectors({"centroid_vector": center.tolist(), "representatives": representatives})
        retained = np.asarray(routing_vectors, dtype=np.float32)
        distances = np.clip(1.0 - np.max(all_vectors @ retained.T, axis=1), 0.0, 2.0)
        sources = {row["ref"]["source_file_id"] for row in candidates} - {None}
        topic = {
            "schema_version": SCHEMA_VERSION, "cluster_id": int(cluster_id), "embedding_space": None,
            "centroid_vector": center.tolist(), "centroid_source": center_source, "representatives": representatives,
            "sample_support_count": len(cluster), "valid_sample_count": len(valid),
            "distinct_sample_count": len(candidates), "discarded_sample_count": len(cluster) - len(valid),
            "duplicate_reference_count": len(valid) - len(candidates),
            "distinct_source_count": len(sources), "represented_source_count": len(known_selected_sources),
            "unrepresented_source_count": len(sources - known_selected_sources),
            "unknown_source_sample_count": sum(row["ref"]["source_file_id"] is None for row in candidates),
            "modalities": sorted({row["ref"]["source_type"] for row in candidates}),
            "coverage_radius": float(distances.max()), "coverage_radius_p95": float(np.quantile(distances, .95)),
            "centroid_radius": float(np.clip(1.0 - all_vectors @ center, 0.0, 2.0).max()),
            "parameters": {"max_representatives": int(max_representatives),
                           "near_duplicate_cosine": NEAR_DUPLICATE_COSINE,
                           "source_diversity_relative_floor": SOURCE_DIVERSITY_RELATIVE_FLOOR},
        }
        topic["routing_vector_count"] = len(routing_vectors)
        topics.append(topic)
    return topics
