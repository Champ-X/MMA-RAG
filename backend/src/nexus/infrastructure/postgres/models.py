from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from nexus.shared.domain.ids import new_id


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Space(Base, TimestampMixin):
    __tablename__ = "spaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    knowledge_profile: Mapped[str] = mapped_column(String(32), default="searchable")
    default_quality: Mapped[str] = mapped_column(String(16), default="quality")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class Collection(Base, TimestampMixin):
    """A saved, human-named view over Sources in one Space.

    This is deliberately a PostgreSQL control-plane object, not a Qdrant
    collection.  Manual membership and dynamic rules are resolved to Source
    identifiers before a retrieval/run snapshot is created.
    """

    __tablename__ = "collections"
    __table_args__ = (UniqueConstraint("space_id", "name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(32), default="cobalt")
    view_kind: Mapped[str] = mapped_column(String(16), default="manual")
    rule_logic: Mapped[str] = mapped_column(String(8), default="all")
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class CollectionSourceLink(Base):
    __tablename__ = "collection_source_links"
    __table_args__ = (UniqueConstraint("collection_id", "source_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    collection_id: Mapped[str] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CollectionRule(Base):
    __tablename__ = "collection_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    collection_id: Mapped[str] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), index=True
    )
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    operator: Mapped[str] = mapped_column(String(16), nullable=False)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Source(Base, TimestampMixin):
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str] = mapped_column(String(512), nullable=False)
    canonical_uri: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="discovered", index=True)
    current_version_id: Mapped[str | None] = mapped_column(String(36), index=True)
    tombstoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, default=1)


class SourceSpaceLink(Base):
    __tablename__ = "source_space_links"
    __table_args__ = (UniqueConstraint("space_id", "source_id", "valid_to_sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    alias: Mapped[str | None] = mapped_column(String(255))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    knowledge_profile: Mapped[str] = mapped_column(String(32), default="searchable")
    valid_from_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_to_sequence: Mapped[int | None] = mapped_column(Integer)
    projection_state: Mapped[str] = mapped_column(String(32), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SourceSyncSchedule(Base, TimestampMixin):
    """Durable, user-owned refresh policy for one connected Source in a Space."""

    __tablename__ = "source_sync_schedules"
    __table_args__ = (UniqueConstraint("space_id", "source_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    space_id: Mapped[str] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    next_run_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str] = mapped_column(String(32), default="never")
    last_error: Mapped[str | None] = mapped_column(Text)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)


class SourceSyncExecution(Base, TimestampMixin):
    """Append-only operational history for manual and scheduled upstream checks."""

    __tablename__ = "source_sync_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    schedule_id: Mapped[str | None] = mapped_column(
        ForeignKey("source_sync_schedules.id", ondelete="SET NULL"), index=True
    )
    space_id: Mapped[str] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    items_checked: Mapped[int] = mapped_column(Integer, default=0)
    new_version_count: Mapped[int] = mapped_column(Integer, default=0)
    job_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_version_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    error_message: Mapped[str | None] = mapped_column(Text)


class SourceVersion(Base, TimestampMixin):
    __tablename__ = "source_versions"
    __table_args__ = (
        UniqueConstraint("source_id", "version_no"),
        UniqueConstraint("source_id", "content_hash"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="stored", index=True)
    modality: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    external_version: Mapped[str | None] = mapped_column(String(255))
    parser_manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    visible_from_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    visible_until_sequence: Mapped[int | None] = mapped_column(Integer)


class ObjectManifest(Base):
    __tablename__ = "object_manifests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CapabilityReadiness(Base, TimestampMixin):
    __tablename__ = "capability_readiness"
    __table_args__ = (UniqueConstraint("source_version_id", "capability"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id", ondelete="CASCADE"), index=True
    )
    capability: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ContentUnit(Base, TimestampMixin):
    __tablename__ = "content_units"
    __table_args__ = (UniqueConstraint("source_version_id", "native_anchor", "unit_type"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("content_units.id"), index=True)
    unit_type: Mapped[str] = mapped_column(String(64), nullable=False)
    native_anchor: Mapped[str] = mapped_column(String(512), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    lineage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class EvidenceRevision(Base, TimestampMixin):
    __tablename__ = "evidence_revisions"
    __table_args__ = (UniqueConstraint("content_unit_id", "revision_no"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    content_unit_id: Mapped[str] = mapped_column(
        ForeignKey("content_units.id", ondelete="CASCADE"), index=True
    )
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    modality: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    evidence_type: Mapped[str] = mapped_column(String(64), nullable=False)
    text_content: Mapped[str] = mapped_column(Text, default="")
    searchable_text: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    quality_flags: Mapped[list[str]] = mapped_column(JSON, default=list)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    visible_from_sequence: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    visible_until_sequence: Mapped[int | None] = mapped_column(Integer, index=True)
    supersedes_id: Mapped[str | None] = mapped_column(ForeignKey("evidence_revisions.id"))


Index("ix_evidence_search", EvidenceRevision.status, EvidenceRevision.modality)


class EvidenceLocator(Base):
    __tablename__ = "evidence_locators"

    evidence_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), primary_key=True
    )
    locator_type: Mapped[str] = mapped_column(String(32), nullable=False)
    page_no: Mapped[int | None] = mapped_column(Integer)
    bbox: Mapped[list[float] | None] = mapped_column(JSON)
    start_ms: Mapped[int | None] = mapped_column(Integer)
    end_ms: Mapped[int | None] = mapped_column(Integer)
    sheet: Mapped[str | None] = mapped_column(String(255))
    cell_range: Mapped[str | None] = mapped_column(String(64))
    char_start: Mapped[int | None] = mapped_column(Integer)
    char_end: Mapped[int | None] = mapped_column(Integer)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class EvidenceLink(Base):
    __tablename__ = "evidence_links"
    __table_args__ = (UniqueConstraint("from_revision_id", "to_revision_id", "relation"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    from_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), index=True
    )
    to_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), index=True
    )
    relation: Mapped[str] = mapped_column(String(32), nullable=False)


class EvidenceAsset(Base):
    __tablename__ = "evidence_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    evidence_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)


class IndexGeneration(Base, TimestampMixin):
    __tablename__ = "index_generations"
    __table_args__ = (UniqueConstraint("family", "epoch"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    physical_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(32), default="building")
    vector_schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    encoder_manifest: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    watermark: Mapped[int] = mapped_column(Integer, default=0)


class IndexRelease(Base, TimestampMixin):
    __tablename__ = "index_releases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    release_no: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="building", index=True)
    generation_map: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False)
    watermark: Mapped[int] = mapped_column(Integer, default=0)
    validation_report: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ProjectionItem(Base, TimestampMixin):
    __tablename__ = "projection_items"
    __table_args__ = (
        UniqueConstraint("evidence_revision_id", "index_generation_id", "vector_role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    evidence_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), index=True
    )
    index_generation_id: Mapped[str] = mapped_column(
        ForeignKey("index_generations.id", ondelete="CASCADE"), index=True
    )
    vector_role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    point_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


class IngestionJob(Base, TimestampMixin):
    __tablename__ = "ingestion_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_version_id: Mapped[str] = mapped_column(
        ForeignKey("source_versions.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    stage: Mapped[str] = mapped_column(String(64), default="raw_stored")
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), default="v1")
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_worker_id: Mapped[str | None] = mapped_column(String(255), index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    execution_epoch: Mapped[int] = mapped_column(Integer, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)


class UploadSession(Base, TimestampMixin):
    __tablename__ = "upload_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    space_id: Mapped[str] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"))
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    total_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    part_size: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_hash: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_job_id: Mapped[str | None] = mapped_column(String(36))


class UploadPart(Base):
    __tablename__ = "upload_parts"
    __table_args__ = (UniqueConstraint("upload_session_id", "part_no"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    upload_session_id: Mapped[str] = mapped_column(
        ForeignKey("upload_sessions.id", ondelete="CASCADE"), index=True
    )
    part_no: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobEvent(Base):
    __tablename__ = "job_events"
    __table_args__ = (UniqueConstraint("job_id", "sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("ingestion_jobs.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Conversation(Base, TimestampMixin):
    """Mutable product metadata around an immutable sequence of Runs."""

    __tablename__ = "conversations"
    __table_args__ = (
        Index(
            "ix_conversations_archive_order",
            "archived",
            "pinned",
            "last_activity_at",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class Run(Base, TimestampMixin):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(String(36), index=True, default=new_id)
    parent_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="created", index=True)
    quality_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    scope: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    request_context: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    selected_model_deployment_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_deployments.id", ondelete="SET NULL"), index=True
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    stop_reason: Mapped[str | None] = mapped_column(String(128))
    state_version: Mapped[int] = mapped_column(Integer, default=0)
    execution_epoch: Mapped[int] = mapped_column(Integer, default=0)
    owner_worker_id: Mapped[str | None] = mapped_column(String(255))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_checkpoint_id: Mapped[str | None] = mapped_column(String(36))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)


class RunSnapshot(Base):
    __tablename__ = "run_snapshots"

    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RunEvent(Base):
    __tablename__ = "run_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    producer: Mapped[str] = mapped_column(String(128), default="nexus")
    trace_id: Mapped[str] = mapped_column(String(36), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    public_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    artifact_refs: Mapped[list[str]] = mapped_column(JSON, default=list)
    supersedes: Mapped[str | None] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RuntimeCheckpoint(Base):
    __tablename__ = "runtime_checkpoints"
    __table_args__ = (UniqueConstraint("run_id", "revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="prepared")
    state_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    state_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    runtime_version: Mapped[str] = mapped_column(String(64), default="nexus-native-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvidenceLedgerItem(Base, TimestampMixin):
    __tablename__ = "evidence_ledger_items"
    __table_args__ = (UniqueConstraint("run_id", "evidence_revision_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    evidence_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="CASCADE"), index=True
    )
    discovered_by: Mapped[str] = mapped_column(String(128), nullable=False)
    disposition: Mapped[str] = mapped_column(String(32), default="candidate")
    relevance: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Claim(Base, TimestampMixin):
    __tablename__ = "claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    claim_type: Mapped[str] = mapped_column(String(32), default="fact")
    verification_level: Mapped[str] = mapped_column(String(8), default="T1")
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, default="")


class ClaimEvidenceLink(Base):
    __tablename__ = "claim_evidence_links"
    __table_args__ = (UniqueConstraint("claim_id", "evidence_revision_id", "relation"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    claim_id: Mapped[str] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), index=True)
    evidence_revision_id: Mapped[str] = mapped_column(
        ForeignKey("evidence_revisions.id", ondelete="RESTRICT"), index=True
    )
    relation: Mapped[str] = mapped_column(String(32), default="supports")
    support_score: Mapped[float] = mapped_column(Float, default=0.0)
    excerpt: Mapped[str] = mapped_column(Text, default="")


class Artifact(Base, TimestampMixin):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    artifact_type: Mapped[str] = mapped_column(String(64), default="report")
    status: Mapped[str] = mapped_column(String(32), default="candidate")
    current_revision_id: Mapped[str | None] = mapped_column(String(36))


class ArtifactRevision(Base, TimestampMixin):
    __tablename__ = "artifact_revisions"
    __table_args__ = (UniqueConstraint("artifact_id", "revision_no"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    canonical_document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    evidence_revision_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    author_type: Mapped[str] = mapped_column(String(16), default="system")


class ArtifactRefreshProposal(Base, TimestampMixin):
    __tablename__ = "artifact_refresh_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), index=True
    )
    base_revision_id: Mapped[str] = mapped_column(
        ForeignKey("artifact_revisions.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    impacted_evidence_revision_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    proposed_document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    proposed_evidence_revision_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    diff: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProviderConnection(Base, TimestampMixin):
    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    protocol_family: Mapped[str] = mapped_column(String(64), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    secret_ref: Mapped[str | None] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    health_status: Mapped[str] = mapped_column(String(32), default="unknown")


class ModelDeployment(Base, TimestampMixin):
    __tablename__ = "model_deployments"
    __table_args__ = (
        UniqueConstraint("provider_connection_id", "upstream_model_id", "protocol_family"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    provider_connection_id: Mapped[str] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="CASCADE"), index=True
    )
    protocol_family: Mapped[str] = mapped_column(String(64), nullable=False)
    upstream_model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    lifecycle: Mapped[str] = mapped_column(String(32), default="discovered")
    declared_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    verified_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    observation: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CapabilityObservation(Base):
    __tablename__ = "capability_observations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    model_deployment_id: Mapped[str] = mapped_column(
        ForeignKey("model_deployments.id", ondelete="CASCADE"), index=True
    )
    capability: Mapped[str] = mapped_column(String(128), nullable=False)
    supported: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    raw_hash: Mapped[str | None] = mapped_column(String(64))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProbeRun(Base, TimestampMixin):
    __tablename__ = "probe_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    model_deployment_id: Mapped[str] = mapped_column(
        ForeignKey("model_deployments.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="running")
    requested_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    results: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class ModelRoute(Base, TimestampMixin):
    __tablename__ = "model_routes"
    __table_args__ = (UniqueConstraint("role", "revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    deployment_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    required_capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)


class ToolDefinition(Base, TimestampMixin):
    __tablename__ = "tool_definitions"
    __table_args__ = (UniqueConstraint("name", "version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    output_schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(32), default="read")
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency: Mapped[str] = mapped_column(String(32), default="read_only")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ToolExecution(Base, TimestampMixin):
    __tablename__ = "tool_executions"
    __table_args__ = (UniqueConstraint("run_id", "idempotency_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    tool_definition_id: Mapped[str] = mapped_column(ForeignKey("tool_definitions.id"))
    status: Mapped[str] = mapped_column(String(32), default="prepared")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    output_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)


class StreamCounter(Base):
    __tablename__ = "stream_counters"

    stream_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class PublishCounter(Base):
    __tablename__ = "publish_counter"

    singleton: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    aggregate_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    aggregate_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("scope", "key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scope: Mapped[str] = mapped_column(String(128), nullable=False)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    response_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ConfigRevision(Base, TimestampMixin):
    __tablename__ = "config_revisions"
    __table_args__ = (UniqueConstraint("namespace", "revision"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    namespace: Mapped[str] = mapped_column(String(128), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class BackupManifest(Base, TimestampMixin):
    __tablename__ = "backup_manifests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    status: Mapped[str] = mapped_column(String(32), default="creating")
    destination: Mapped[str] = mapped_column(Text, nullable=False)
    database_watermark: Mapped[int] = mapped_column(Integer, default=0)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)


class ReconciliationIssue(Base, TimestampMixin):
    __tablename__ = "reconciliation_issues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    issue_type: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), default="warning")
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="open")


class BinaryState(Base):
    """Portable checkpoint/blob fallback for small infrastructure state only."""

    __tablename__ = "binary_state"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
