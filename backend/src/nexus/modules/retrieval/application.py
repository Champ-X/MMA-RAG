from __future__ import annotations

import hashlib
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from typing import Any

from nexus.modules.evidence.ports import EvidenceRepositoryPort
from nexus.modules.retrieval.domain import (
    ChannelQuery,
    ChannelResult,
    EvidencePack,
    SearchHit,
    SearchRequest,
)
from nexus.modules.retrieval.explanation import explain_search
from nexus.modules.retrieval.ports import RetrievalChannelPort
from nexus.shared.domain.enums import QualityMode
from nexus.shared.domain.errors import ValidationError


class RetrievalOrchestrator:
    """Observable parallel recall, RRF fusion, overlap dedup and source diversity."""

    def __init__(
        self,
        *,
        evidence_repository: EvidenceRepositoryPort,
        channels: list[RetrievalChannelPort],
        reranker: object | None = None,
        rrf_k: int = 60,
    ) -> None:
        self.evidence_repository = evidence_repository
        self.channels = {channel.name: channel for channel in channels}
        self.reranker = reranker
        self.rrf_k = rrf_k
        self._warmup_lock = Lock()
        self._warmed_query_encoders: set[tuple[int, str]] = set()

    def search(self, request: SearchRequest) -> EvidencePack:
        query = request.query.strip()
        if not query:
            raise ValidationError("Search query must not be empty")
        limit = max(1, min(request.limit, 100))
        selected = self._select_channels(request.quality_mode)
        channel_query = ChannelQuery(
            query=query,
            scope=request.scope,
            limit=max(limit * 5, 20),
            modalities=request.modalities,
        )
        results: list[ChannelResult] = []
        runnable = [self.channels[name] for name in selected if name in self.channels]
        missing = [name for name in selected if name not in self.channels]
        results.extend(
            ChannelResult(channel=name, status="unavailable", error="channel_not_configured")
            for name in missing
        )
        if runnable:
            self._warmup_query_encoders(runnable)
            with ThreadPoolExecutor(
                max_workers=len(runnable), thread_name_prefix="nexus-recall"
            ) as pool:
                futures = {
                    pool.submit(channel.search, channel_query): channel.name for channel in runnable
                }
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        results.append(future.result())
                    except Exception as exc:
                        results.append(
                            ChannelResult(
                                channel=name,
                                status="failed",
                                error=type(exc).__name__,
                            )
                        )
        result_order = {name: index for index, name in enumerate(selected)}
        results.sort(key=lambda result: result_order.get(result.channel, len(result_order)))

        fused: dict[str, float] = defaultdict(float)
        memberships: dict[str, list[str]] = defaultdict(list)
        for result in results:
            if result.status != "completed":
                continue
            for candidate in result.candidates:
                fused[candidate.evidence_revision_id] += 1.0 / (self.rrf_k + candidate.rank)
                memberships[candidate.evidence_revision_id].append(result.channel)
        ordered_ids = [
            identifier
            for identifier, _ in sorted(fused.items(), key=lambda item: (-item[1], item[0]))
        ]
        hydrated = self.evidence_repository.hydrate_evidence(
            ordered_ids,
            space_ids=request.scope.space_ids,
            source_ids=request.scope.source_ids,
            watermark=request.scope.publish_watermark,
        )
        if self.reranker is not None:
            started = time.perf_counter()
            rerank_ids = [identifier for identifier in ordered_ids if identifier in hydrated][:50]
            try:
                reranked = self.reranker.rerank(  # type: ignore[attr-defined]
                    query,
                    [hydrated[identifier].searchable_text for identifier in rerank_ids],
                )
                rerank_score = {
                    rerank_ids[int(item.index)]: float(item.score)
                    for item in reranked
                    if 0 <= int(item.index) < len(rerank_ids)
                }
                ordered_ids = sorted(
                    ordered_ids,
                    key=lambda identifier: (
                        identifier not in rerank_score,
                        -rerank_score.get(identifier, float("-inf")),
                        -fused.get(identifier, 0.0),
                    ),
                )
                for identifier in rerank_score:
                    memberships[identifier].append("reranker")
                results.append(
                    ChannelResult(
                        channel="reranker",
                        status="completed",
                        candidates=(),
                        latency_ms=(time.perf_counter() - started) * 1000,
                        model=str(getattr(self.reranker, "name", "reranker")),
                    )
                )
            except Exception as exc:
                results.append(
                    ChannelResult(
                        channel="reranker",
                        status="failed",
                        error=type(exc).__name__,
                        latency_ms=(time.perf_counter() - started) * 1000,
                        model=str(getattr(self.reranker, "name", "reranker")),
                    )
                )
        if request.priority_source_ids:
            priority = set(request.priority_source_ids)
            original_order = {identifier: index for index, identifier in enumerate(ordered_ids)}
            ordered_ids.sort(
                key=lambda identifier: (
                    hydrated.get(identifier) is None
                    or hydrated[identifier].source_id not in priority,
                    original_order[identifier],
                )
            )
        hits: list[SearchHit] = []
        per_source: dict[str, int] = defaultdict(int)
        seen_content: set[str] = set()
        single_source_scope = len(request.scope.source_ids) == 1
        for identifier in ordered_ids:
            evidence = hydrated.get(identifier)
            if evidence is None:
                continue
            overlap_key = hashlib.sha256(
                evidence.searchable_text.strip().lower().encode()
            ).hexdigest()
            if overlap_key in seen_content:
                continue
            source_cap = limit if single_source_scope else max(2, (limit + 1) // 2)
            if per_source[evidence.source_id] >= source_cap:
                continue
            seen_content.add(overlap_key)
            per_source[evidence.source_id] += 1
            hits.append(
                SearchHit(
                    evidence=evidence,
                    rank=len(hits) + 1,
                    fused_score=fused[identifier],
                    channels=tuple(memberships[identifier]),
                    selection_reason=(
                        "Explicit attachment boost after RRF/rerank with scope checks"
                        if evidence.source_id in set(request.priority_source_ids)
                        else "RRF fusion with publication, scope and diversity checks"
                    ),
                )
            )
            if len(hits) >= limit:
                break
        degraded_results = [result for result in results if result.status != "completed"]
        scope_evidence_count = self.evidence_repository.count_published_evidence(
            space_ids=request.scope.space_ids,
            source_ids=request.scope.source_ids,
            watermark=request.scope.publish_watermark,
        )
        explanation = explain_search(
            channels=tuple(results),
            hit_count=len(hits),
            scope_evidence_count=scope_evidence_count,
        )
        return EvidencePack(
            query=query,
            scope=request.scope,
            requested_quality=request.quality_mode,
            actual_quality=request.quality_mode,
            hits=tuple(hits),
            channels=tuple(results),
            degraded=bool(degraded_results),
            degradation_reasons=tuple(
                f"{result.channel}:{result.status}:{result.error or 'unknown'}"
                for result in degraded_results
            ),
            coverage={
                "evidence": len(hits),
                "sources": len({hit.evidence.source_id for hit in hits}),
                "modalities": len({hit.evidence.modality.value for hit in hits}),
                "scope_evidence": scope_evidence_count,
            },
            explanation=explanation,
        )

    def _warmup_query_encoders(self, channels: list[RetrievalChannelPort]) -> None:
        """Load heavyweight local query models serially once per API process.

        Recall remains parallel after initialization. Serial warmup prevents a
        cold Quality request from loading BGE, CLIP, and CLAP concurrently and
        exhausting CPU memory while an index worker is also rebuilding.
        """

        with self._warmup_lock:
            for channel in channels:
                vector_kind = str(getattr(channel, "vector_kind", ""))
                if vector_kind == "sparse":
                    encoder = getattr(channel, "sparse_encoder", None)
                    method_name = "encode_query"
                elif vector_kind == "visual":
                    encoder = getattr(channel, "feature_encoder", None)
                    method_name = "encode_visual_query"
                elif vector_kind == "acoustic":
                    encoder = getattr(channel, "feature_encoder", None)
                    method_name = "encode_acoustic_query"
                else:
                    continue
                if encoder is None:
                    continue
                key = (id(encoder), vector_kind)
                if key in self._warmed_query_encoders:
                    continue
                method = getattr(encoder, method_name, None)
                if method is None:
                    continue
                if self._bounded_warmup(method):
                    self._warmed_query_encoders.add(key)

    @staticmethod
    def _bounded_warmup(method: Any) -> bool:
        for attempt in range(2):
            try:
                method("Nexus query encoder warmup")
                return True
            except Exception:
                if attempt == 0:
                    time.sleep(1.0)
        return False

    @staticmethod
    def _select_channels(mode: QualityMode) -> tuple[str, ...]:
        if mode == QualityMode.FAST:
            return ("exact", "text_dense")
        if mode == QualityMode.QUALITY:
            return (
                "exact",
                "text_dense",
                "text_sparse",
                "image",
                "image_caption",
                "audio",
                "audio_text",
                "video",
                "video_text",
            )
        return (
            "exact",
            "text_dense",
            "text_sparse",
            "image",
            "image_caption",
            "audio",
            "audio_text",
            "video",
            "video_text",
        )
