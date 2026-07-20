from __future__ import annotations

from enum import StrEnum


class KnowledgeProfile(StrEnum):
    SEARCHABLE = "searchable"
    MULTIMODAL = "multimodal"
    RESEARCH = "research"
    ARCHIVE = "archive"


class QualityMode(StrEnum):
    FAST = "fast"
    QUALITY = "quality"
    DEEP = "deep"


class SourceStatus(StrEnum):
    DISCOVERED = "discovered"
    STORED = "stored"
    PROCESSING = "processing"
    READY = "ready"
    PARTIAL = "partial"
    FAILED = "failed"
    SUPERSEDED = "superseded"
    TOMBSTONED = "tombstoned"
    PURGED = "purged"


class CapabilityStatus(StrEnum):
    NOT_CONFIGURED = "not_configured"
    DISABLED = "disabled"
    PENDING = "pending"
    RUNNING = "running"
    READY = "ready"
    PARTIAL = "partial"
    FAILED = "failed"
    STALE = "stale"


class EvidenceStatus(StrEnum):
    DRAFT = "draft"
    VALIDATING = "validating"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"
    TOMBSTONED = "tombstoned"
    PURGED = "purged"


class ProjectionStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    RETIRING = "retiring"
    FAILED = "failed"
    DELETED = "deleted"


class RunKind(StrEnum):
    QUICK = "quick"
    RESEARCH = "research"


class RunStatus(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    RUNNING = "running"
    WAITING_TOOL = "waiting_tool"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_INPUT = "waiting_input"
    PAUSED = "paused"
    RECOVERING = "recovering"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class ClaimStatus(StrEnum):
    SUPPORTED = "supported"
    PARTIALLY_SUPPORTED = "partially_supported"
    CONFLICTED = "conflicted"
    STALE = "stale"
    INSUFFICIENT = "insufficient"
    UNVERIFIABLE = "unverifiable"


class Modality(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    TABLE = "table"


TERMINAL_RUN_STATUSES = {
    RunStatus.PARTIAL.value,
    RunStatus.FAILED.value,
    RunStatus.CANCELLED.value,
    RunStatus.COMPLETED.value,
}
