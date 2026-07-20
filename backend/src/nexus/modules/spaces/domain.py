from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from nexus.shared.domain.enums import KnowledgeProfile, QualityMode, RunKind


@dataclass(frozen=True, slots=True)
class SpacePolicy:
    profile: KnowledgeProfile
    label: str
    summary: str
    default_quality: QualityMode
    recommended_run_kind: RunKind
    auto_route_eligible: bool
    behaviors: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SpaceView:
    id: str
    slug: str
    name: str
    description: str
    knowledge_profile: KnowledgeProfile
    default_quality: QualityMode
    policy: SpacePolicy
    archived: bool
    revision: int
    created_at: datetime
    updated_at: datetime
    source_count: int = 0
    modality_counts: dict[str, int] = field(default_factory=dict)
    evidence_modality_counts: dict[str, int] = field(default_factory=dict)
    status_counts: dict[str, int] = field(default_factory=dict)
    cover_source_version_id: str | None = None
    cover_evidence_id: str | None = None
    cover_source_name: str | None = None


@dataclass(frozen=True, slots=True)
class CollectionRuleView:
    id: str
    field: str
    operator: str
    value: object
    position: int


@dataclass(frozen=True, slots=True)
class CollectionView:
    id: str
    space_id: str
    name: str
    description: str
    color: str
    view_kind: str
    rule_logic: str
    archived: bool
    revision: int
    source_ids: tuple[str, ...]
    source_count: int
    rules: tuple[CollectionRuleView, ...]
    modality_counts: dict[str, int]
    cover_source_version_id: str | None
    cover_evidence_id: str | None
    cover_source_name: str | None
    created_at: datetime
    updated_at: datetime
