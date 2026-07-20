from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from nexus.modules.retrieval.domain import ScopeCapsule
from nexus.shared.domain.enums import QualityMode, RunKind, RunStatus


@dataclass(frozen=True, slots=True)
class RunCommand:
    goal: str
    kind: RunKind
    quality_mode: QualityMode
    scope: ScopeCapsule
    idempotency_key: str | None = None
    conversation_id: str | None = None
    parent_run_id: str | None = None
    request_context: dict[str, object] | None = None
    selected_model_deployment_id: str | None = None


@dataclass(frozen=True, slots=True)
class RunView:
    id: str
    conversation_id: str
    parent_run_id: str | None
    goal: str
    kind: RunKind
    quality_mode: QualityMode
    scope: ScopeCapsule
    request_context: dict[str, object]
    selected_model_deployment_id: str | None
    status: RunStatus
    result: dict[str, object] | None
    stop_reason: str | None
    state_version: int
    execution_epoch: int
    cancel_requested: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class RunEventView:
    event_id: str
    stream_id: str
    sequence: int
    event_type: str
    occurred_at: datetime
    producer: str
    trace_id: str
    schema_version: int
    public_payload: dict[str, object]
    artifact_refs: tuple[str, ...]
    supersedes: str | None


@dataclass(frozen=True, slots=True)
class RunSnapshotView:
    run_id: str
    snapshot: dict[str, object]
    schema_version: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class EvidenceLedgerView:
    evidence_revision_id: str
    discovered_by: str
    disposition: str
    relevance: float


@dataclass(frozen=True, slots=True)
class DriverLease:
    run_id: str
    worker_id: str
    fencing_token: int
    state_version: int
    execution_epoch: int
