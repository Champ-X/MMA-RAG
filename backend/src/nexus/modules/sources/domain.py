from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from nexus.modules.evidence.domain import EvidenceDraft
from nexus.shared.domain.enums import CapabilityStatus, Modality, SourceStatus


@dataclass(frozen=True, slots=True)
class SourceIngestionSummaryView:
    id: str
    status: str
    stage: str
    error_code: str | None
    error_message: str | None
    attempt_count: int
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SourceProjectionView:
    state: str
    expected_evidence_count: int
    active_evidence_count: int
    release_id: str | None


@dataclass(frozen=True, slots=True)
class SourceSyncView:
    connector_kind: str
    refreshable: bool
    scope: str
    last_checked_at: datetime
    schedules: tuple[SourceSyncScheduleView, ...] = ()


@dataclass(frozen=True, slots=True)
class SourceSyncScheduleView:
    id: str
    space_id: str
    source_id: str
    interval_minutes: int
    enabled: bool
    next_run_at: datetime
    last_run_at: datetime | None
    last_status: str
    last_error: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class SourceSyncExecutionView:
    id: str
    schedule_id: str | None
    space_id: str
    source_id: str
    trigger: str
    status: str
    items_checked: int
    new_version_count: int
    job_ids: tuple[str, ...]
    source_version_ids: tuple[str, ...]
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class SourceHealthView:
    outcome: str
    severity: str
    summary: str
    searchable: bool
    blockers: tuple[str, ...]
    primary_action: str | None


@dataclass(frozen=True, slots=True)
class SourceVersionView:
    id: str
    source_id: str
    space_ids: tuple[str, ...]
    display_name: str
    version_no: int
    content_hash: str
    mime_type: str
    byte_size: int
    object_key: str
    connector_kind: str
    canonical_uri: str | None
    external_version: str | None
    modality: Modality
    status: SourceStatus
    capabilities: dict[str, CapabilityStatus]
    capability_details: dict[str, dict[str, object]]
    latest_job: SourceIngestionSummaryView | None
    projection: SourceProjectionView
    sync: SourceSyncView
    health: SourceHealthView
    created_at: datetime
    published_evidence_count: int = 0
    derived_image_count: int = 0
    cover_evidence_id: str | None = None


@dataclass(frozen=True, slots=True)
class IngestionJobEventView:
    sequence: int
    event_type: str
    payload: dict[str, object]
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class IngestionJobView:
    id: str
    source_version_id: str
    status: str
    stage: str
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    source_id: str | None = None
    display_name: str | None = None
    modality: Modality | None = None
    mime_type: str | None = None
    attempt_count: int = 0
    event_count: int = 0
    events: tuple[IngestionJobEventView, ...] = ()


@dataclass(frozen=True, slots=True)
class IngestionLease:
    """PostgreSQL fencing grant for one ingestion attempt."""

    job_id: str
    worker_id: str
    fencing_token: int
    lease_expires_at: datetime


@dataclass(frozen=True, slots=True)
class RawSourceCommand:
    space_id: str
    filename: str
    mime_type: str
    content_hash: str
    byte_size: int
    object_key: str
    modality: Modality
    source_id: str | None = None
    connector_kind: str = "upload"
    canonical_uri: str | None = None
    external_version: str | None = None
    idempotency_key: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class DerivedAsset:
    """Immutable parser output that must be persisted before evidence is published."""

    object_key: str
    data: bytes = field(repr=False)
    content_type: str = "application/octet-stream"
    content_hash: str = ""
    role: str = "derived"
    source_path: str | None = None


@dataclass(frozen=True, slots=True)
class ParseResult:
    drafts: tuple[EvidenceDraft, ...]
    manifest: dict[str, object]
    capabilities: dict[str, str]
    derived_assets: tuple[DerivedAsset, ...] = ()
