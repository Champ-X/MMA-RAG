from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict

from nexus.infrastructure.postgres.repository import SqlControlPlaneRepository
from nexus.modules.spaces.application import SpaceService
from nexus.modules.spaces.policy import recommend_space_usage

_PORTRAIT_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "column",
    "columns",
    "class",
    "connector",
    "content",
    "document",
    "evidence",
    "examples",
    "elements",
    "for",
    "from",
    "had",
    "has",
    "have",
    "href",
    "html",
    "body",
    "head",
    "height",
    "div",
    "span",
    "img",
    "image",
    "in",
    "is",
    "it",
    "missing",
    "no",
    "non-empty",
    "of",
    "on",
    "or",
    "other",
    "page",
    "present",
    "profile",
    "role",
    "row",
    "rows",
    "sheet",
    "source",
    "style",
    "table",
    "text",
    "that",
    "the",
    "then",
    "this",
    "title",
    "td",
    "tr",
    "to",
    "type",
    "numeric",
    "categorical",
    "unique",
    "value",
    "values",
    "video",
    "was",
    "were",
    "width",
    "with",
    "一个",
    "以及",
    "使用",
    "内容",
    "可以",
    "图片",
    "数据",
    "文档",
    "没有",
    "进行",
    "这个",
    "通过",
    "音频",
}
_SOURCE_FILE_TOKEN = re.compile(
    r"\.(?:md|markdown|txt|pdf|docx?|pptx?|csv|xlsx?|xlsm|png|jpe?g|gif|webp|"
    r"wav|mp3|m4a|flac|mp4|mov|mkv|webm)$",
    re.IGNORECASE,
)


def _tokens(value: str) -> list[str]:
    lowered = value.lower()
    words = re.findall(r"[a-z0-9][a-z0-9_./+-]{1,}|[\u4e00-\u9fff]{2,}", lowered)
    output: list[str] = []
    for word in words:
        word = word.strip("._/+-")
        if not word:
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]+", word):
            output.extend(
                token
                for index in range(len(word) - 1)
                if (token := word[index : index + 2]) not in _PORTRAIT_STOPWORDS
            )
        elif word not in _PORTRAIT_STOPWORDS:
            output.append(word)
    return output


def _portrait_keyword(token: str) -> bool:
    return (
        token not in _PORTRAIT_STOPWORDS
        and not token.isdigit()
        and not _SOURCE_FILE_TOKEN.search(token)
        and "." not in token
        and "/" not in token
        and len(token) >= 2
    )


def _vector(tokens: list[str], dimensions: int = 96) -> list[float]:
    values = [0.0] * dimensions
    for token in tokens:
        digest = hashlib.sha256(token.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        values[index] += 1.0 if digest[4] & 1 else -1.0
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [value / norm for value in values]


def _cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


class SpaceIntelligenceService:
    """Current-evidence clustering and conservative automatic Space routing."""

    def __init__(self, spaces: SpaceService, evidence: SqlControlPlaneRepository) -> None:
        self.spaces = spaces
        self.evidence = evidence

    def portrait(self, space_id: str, *, limit: int = 600) -> dict[str, object]:
        space = self.spaces.get(space_id)
        items, cursor = self.evidence.list_evidence(
            space_id=space_id,
            source_id=None,
            modality=None,
            cursor=None,
            limit=limit,
        )
        vectors = [_vector(_tokens(item.searchable_text)) for item in items]
        all_counts: Counter[str] = Counter()
        for item in items:
            all_counts.update(set(_tokens(item.searchable_text)[:180]))
        cluster_count = min(6, max(1, round(math.sqrt(max(len(items), 1) / 3))))
        assignments, centroids = self._cluster(vectors, cluster_count)
        clusters: list[dict[str, object]] = []
        for cluster_id in range(len(centroids)):
            members = [item for index, item in enumerate(items) if assignments[index] == cluster_id]
            if not members:
                continue
            counts: Counter[str] = Counter()
            positions: dict[str, int] = {}
            position = 0
            for item in members:
                tokens = _tokens(item.searchable_text)[:180]
                counts.update(set(tokens))
                for token in tokens:
                    positions.setdefault(token, position)
                    position += 1
            keywords = sorted(
                (token for token in counts if _portrait_keyword(token)),
                key=lambda token: (
                    counts[token] / (1 + all_counts[token] - counts[token]),
                    counts[token],
                    -positions[token],
                    len(token),
                    token,
                ),
                reverse=True,
            )[:8]
            modalities = Counter(item.modality.value for item in members)
            angle = (2 * math.pi * cluster_id / max(len(centroids), 1)) - math.pi / 2
            clusters.append(
                {
                    "id": f"cluster-{cluster_id + 1}",
                    "label": " · ".join(keywords[:3]) or f"Topic {cluster_id + 1}",
                    "keywords": keywords,
                    "evidence_count": len(members),
                    "modalities": dict(modalities),
                    "x": round(50 + 36 * math.cos(angle), 2),
                    "y": round(50 + 36 * math.sin(angle), 2),
                    "samples": [
                        {
                            "evidence_revision_id": item.id,
                            "source_name": item.source_name,
                            "excerpt": item.text_content[:180],
                            "modality": item.modality.value,
                        }
                        for item in members[:4]
                    ],
                    "centroid": centroids[cluster_id],
                }
            )
        modality_counts = Counter(item.modality.value for item in items)
        return {
            "space_id": space.id,
            "space_name": space.name,
            "description": space.description,
            "evidence_count": len(items),
            "truncated": cursor is not None,
            "modalities": dict(modality_counts),
            "clusters": clusters,
            "profile_text": " · ".join(
                str(cluster["label"]) for cluster in clusters[:4]
            ) or space.description or space.name,
            "algorithm": (
                "stable-hash + deterministic cosine k-means + "
                "stopword-filtered discriminative labels v3"
            ),
        }

    def route(self, query: str, *, limit: int = 3) -> dict[str, object]:
        spaces, _ = self.spaces.list(limit=200)
        eligible_spaces = [space for space in spaces if space.policy.auto_route_eligible]
        query_vector = _vector(_tokens(query))
        normalized_query = query.casefold()
        media_intent = any(
            token in normalized_query
            for token in (
                "image",
                "figure",
                "photo",
                "audio",
                "sound",
                "video",
                "图片",
                "图像",
                "音频",
                "声音",
                "视频",
            )
        )
        research_intent = any(
            token in normalized_query
            for token in (
                "research",
                "compare",
                "analyze",
                "investigate",
                "研究",
                "比较",
                "分析",
                "调研",
            )
        )
        scores: dict[str, float] = {}
        portraits: dict[str, dict[str, object]] = {}
        for space in spaces:
            if not space.policy.auto_route_eligible:
                scores[space.id] = 0.0
                portraits[space.id] = {
                    "profile_text": space.description or space.name,
                }
                continue
            portrait = self.portrait(space.id)
            portraits[space.id] = portrait
            cluster_scores = sorted(
                (
                    max(0.0, _cosine(query_vector, list(cluster["centroid"])))
                    for cluster in portrait["clusters"]  # type: ignore[union-attr]
                ),
                reverse=True,
            )
            weighted = (
                sum(score * (0.85**index) for index, score in enumerate(cluster_scores[:5]))
                / sum(0.85**index for index in range(min(5, len(cluster_scores))))
                if cluster_scores
                else 0.0
            )
            metadata_score = max(
                0.0,
                _cosine(query_vector, _vector(_tokens(f"{space.name} {space.description}"))),
            )
            policy_boost = 0.0
            if media_intent and space.knowledge_profile.value == "multimodal":
                policy_boost += 0.08
            if research_intent and space.knowledge_profile.value == "research":
                policy_boost += 0.08
            scores[space.id] = min(1.0, 0.82 * weighted + 0.18 * metadata_score + policy_boost)
        ranked_eligible = sorted(
            eligible_spaces,
            key=lambda item: scores.get(item.id, 0.0),
            reverse=True,
        )
        ranked = ranked_eligible + [
            space for space in spaces if not space.policy.auto_route_eligible
        ]
        top = scores.get(ranked_eligible[0].id, 0.0) if ranked_eligible else 0.0
        second = scores.get(ranked_eligible[1].id, 0.0) if len(ranked_eligible) > 1 else 0.0
        if not spaces:
            selected = []
            method = "no_spaces"
        elif not ranked_eligible:
            selected = []
            method = "no_auto_route_spaces"
        elif top < 0.06:
            selected = ranked_eligible[: max(1, limit)]
            method = "all_low_safe_broadening"
        elif top - second >= 0.22:
            selected = ranked_eligible[:1]
            method = "dominant_cluster"
        else:
            selected = [
                space
                for space in ranked_eligible[:limit]
                if scores[space.id] >= top * 0.58
            ]
            method = "multi_space_cluster_match"
        usage = recommend_space_usage(selected)
        return {
            "query": query,
            "method": method,
            "selected_space_ids": [space.id for space in selected],
            "recommended_kind": usage["recommended_kind"],
            "recommended_quality": usage["recommended_quality"],
            "policy_reasons": usage["reasons"],
            "candidates": [
                {
                    "space_id": space.id,
                    "space_name": space.name,
                    "score": round(scores[space.id], 6),
                    "profile": portraits[space.id]["profile_text"],
                    "policy_label": space.policy.label,
                    "auto_route_eligible": space.policy.auto_route_eligible,
                    "routing_note": (
                        "eligible"
                        if space.policy.auto_route_eligible
                        else "manual_scope_only"
                    ),
                }
                for space in ranked
            ],
        }

    def suggested_questions(self, space_id: str, *, limit: int = 6) -> dict[str, object]:
        """Return explainable starter questions derived from the current portrait.

        Suggestions deliberately require no generation provider: they remain available
        in a fresh local installation, update with published Evidence, and expose the
        cluster that caused each suggestion instead of presenting opaque LLM guesses.
        """

        portrait = self.portrait(space_id)
        suggestions: list[dict[str, object]] = []
        clusters = portrait["clusters"]
        assert isinstance(clusters, list)
        for index, cluster in enumerate(clusters):
            label = str(cluster.get("label") or f"topic {index + 1}")
            modalities = set(cluster.get("modalities", {}))
            is_chinese = bool(re.search(r"[\u4e00-\u9fff]", label))
            if "image" in modalities:
                question = (
                    f"结合图示和文字，解释“{label}”的关键结构与结论。"
                    if is_chinese
                    else (
                        f"Explain the key structure and conclusions about {label}, "
                        "using both figures and text."
                    )
                )
            elif "audio" in modalities or "video" in modalities:
                question = (
                    f"“{label}”在音视频资料中有哪些关键观点和时间点？"
                    if is_chinese
                    else (
                        f"What are the key claims and timestamps about {label} "
                        "in the media evidence?"
                    )
                )
            else:
                question = (
                    f"关于“{label}”，当前资料支持哪些核心结论？"
                    if is_chinese
                    else (
                        f"What core conclusions about {label} are supported by "
                        "the current evidence?"
                    )
                )
            suggestions.append(
                {
                    "id": f"{space_id}:{cluster.get('id', index)}",
                    "question": question,
                    "cluster_id": cluster.get("id"),
                    "cluster_label": label,
                    "evidence_count": int(cluster.get("evidence_count") or 0),
                    "modalities": sorted(modalities),
                    "reason": "current_space_portrait",
                }
            )
            if len(suggestions) >= max(1, min(limit, 12)):
                break
        return {
            "space_id": space_id,
            "portrait_algorithm": portrait["algorithm"],
            "suggestions": suggestions,
        }

    @staticmethod
    def _cluster(vectors: list[list[float]], count: int) -> tuple[list[int], list[list[float]]]:
        if not vectors:
            return [], []
        count = min(max(count, 1), len(vectors))
        centroids = [vectors[0]]
        while len(centroids) < count:
            candidate = max(
                vectors,
                key=lambda vector: min(1 - _cosine(vector, center) for center in centroids),
            )
            centroids.append(candidate)
        assignments = [0] * len(vectors)
        for _iteration in range(8):
            assignments = [
                max(range(count), key=lambda index: _cosine(vector, centroids[index]))
                for vector in vectors
            ]
            grouped: dict[int, list[list[float]]] = defaultdict(list)
            for assignment, vector in zip(assignments, vectors, strict=True):
                grouped[assignment].append(vector)
            for index in range(count):
                if not grouped[index]:
                    continue
                mean = [
                    sum(vector[dimension] for vector in grouped[index]) / len(grouped[index])
                    for dimension in range(len(vectors[0]))
                ]
                norm = math.sqrt(sum(value * value for value in mean)) or 1.0
                centroids[index] = [value / norm for value in mean]
        return assignments, centroids
