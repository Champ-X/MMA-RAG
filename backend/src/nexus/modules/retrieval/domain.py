from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from nexus.modules.evidence.domain import EvidenceView
from nexus.shared.domain.enums import Modality, QualityMode

if TYPE_CHECKING:
    from nexus.modules.retrieval.explanation import SearchExplanation


@dataclass(frozen=True, slots=True)
class ScopeCapsule:
    space_ids: tuple[str, ...] = ()
    collection_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
    global_search: bool = False
    publish_watermark: int | None = None

    def __post_init__(self) -> None:
        if (
            not self.global_search
            and not self.space_ids
            and not self.collection_ids
            and not self.source_ids
        ):
            raise ValueError("A retrieval scope must be explicit")


@dataclass(frozen=True, slots=True)
class SearchRequest:
    query: str
    scope: ScopeCapsule
    quality_mode: QualityMode = QualityMode.QUALITY
    modalities: tuple[Modality, ...] = ()
    limit: int = 10
    expand_context: bool = True
    priority_source_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ChannelCandidate:
    evidence_revision_id: str
    rank: int
    score: float
    reason: str


@dataclass(frozen=True, slots=True)
class ChannelResult:
    channel: str
    status: str
    candidates: tuple[ChannelCandidate, ...] = ()
    latency_ms: float = 0.0
    error: str | None = None
    model: str | None = None
    generation: str | None = None
    native_modality: bool = True


@dataclass(frozen=True, slots=True)
class SearchHit:
    evidence: EvidenceView
    rank: int
    fused_score: float
    channels: tuple[str, ...]
    selection_reason: str


@dataclass(frozen=True, slots=True)
class EvidencePack:
    query: str
    scope: ScopeCapsule
    requested_quality: QualityMode
    actual_quality: QualityMode
    hits: tuple[SearchHit, ...]
    channels: tuple[ChannelResult, ...]
    degraded: bool
    degradation_reasons: tuple[str, ...] = ()
    coverage: dict[str, int] = field(default_factory=dict)
    explanation: SearchExplanation | None = None


@dataclass(frozen=True, slots=True)
class ChannelQuery:
    query: str
    scope: ScopeCapsule
    limit: int
    modalities: tuple[Modality, ...] = ()
