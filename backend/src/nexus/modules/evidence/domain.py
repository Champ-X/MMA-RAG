from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from nexus.shared.domain.enums import EvidenceStatus, Modality


@dataclass(frozen=True, slots=True)
class Locator:
    locator_type: str
    page_no: int | None = None
    bbox: tuple[float, float, float, float] | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    sheet: str | None = None
    cell_range: str | None = None
    char_start: int | None = None
    char_end: int | None = None
    extra: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class EvidenceDraft:
    unit_type: str
    native_anchor: str
    fingerprint: str
    modality: Modality
    evidence_type: str
    text_content: str
    searchable_text: str
    content_hash: str
    locator: Locator
    ordinal: int = 0
    parent_anchor: str | None = None
    quality_flags: tuple[str, ...] = ()
    provenance: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class EvidenceView:
    id: str
    source_id: str
    source_version_id: str
    source_name: str
    modality: Modality
    evidence_type: str
    text_content: str
    searchable_text: str
    status: EvidenceStatus
    locator: Locator
    quality_flags: tuple[str, ...]
    visible_from_sequence: int
    visible_until_sequence: int | None
    created_at: datetime
