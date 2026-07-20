from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from nexus.bootstrap import NexusContainer
from nexus.infrastructure.postgres.models import EvidenceRevision, IngestionJob, SourceVersion
from nexus.modules.retrieval.domain import ScopeCapsule
from nexus.shared.domain.enums import RunKind
from nexus.shared.domain.errors import ConflictError


def test_pdf_failure_is_explicit_and_raw_is_retained(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="MinerU Contract", slug="mineru-contract")
    raw = b"%PDF-1.7\nnot-a-real-document"
    result = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="layout.pdf",
        content=raw,
        mime_type="application/pdf",
    )
    assert result.job.status == "failed"
    assert result.job.error_code == "CAPABILITY_UNAVAILABLE"
    assert result.source_version.status.value == "failed"
    assert nexus.blob_store.get(result.source_version.object_key) == raw


def test_ingestion_replay_is_idempotent(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Replay", slug="replay")
    content = b"# Stable\n\nA replay must not duplicate immutable evidence."
    first = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="stable.md",
        content=content,
        mime_type="text/markdown",
        idempotency_key="source-stable-v1",
    )
    second = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="stable.md",
        content=content,
        mime_type="text/markdown",
        idempotency_key="source-stable-v1",
    )
    assert first.source_version.id == second.source_version.id
    assert first.job.id == second.job.id
    with nexus.database.transaction() as session:
        assert session.scalar(select(func.count(SourceVersion.id))) == 1
        assert session.scalar(select(func.count(EvidenceRevision.id))) == 1


def test_driver_fencing_rejects_concurrent_owner(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Fencing", slug="fencing")
    run = nexus.run_service.create(
        goal="Hold this run",
        kind=RunKind.QUICK,
        scope=ScopeCapsule(space_ids=(space.id,)),
        execute=False,
    )
    nexus.runs_repository.acquire_driver(run.id, worker_id="worker-a", lease_seconds=60)
    with pytest.raises(ConflictError):
        nexus.runs_repository.acquire_driver(run.id, worker_id="worker-b", lease_seconds=60)


def test_ingestion_fencing_rejects_stale_worker(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Ingestion Fencing", slug="ingestion-fencing")
    pending = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="fenced.md",
        content=b"# Fenced\n\nOnly the current database lease may publish.",
        mime_type="text/markdown",
        process_inline=False,
    )
    first = nexus.control_plane.acquire_ingestion(
        pending.job.id, worker_id="ingestion-a", lease_seconds=60
    )
    with nexus.database.transaction() as session:
        row = session.get(IngestionJob, pending.job.id, with_for_update=True)
        assert row is not None
        row.status = "running"
        row.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    second = nexus.control_plane.claim_ingestion_jobs(
        worker_id="ingestion-b", limit=1, lease_seconds=60
    )[0]
    assert second.fencing_token > first.fencing_token
    with pytest.raises(ConflictError):
        nexus.control_plane.start_ingestion(pending.job.id, lease=first)


def test_raw_object_hash_is_content_addressed(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Raw Hash", slug="raw-hash")
    content = b"raw-first-content"
    result = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="raw.txt",
        content=content,
        mime_type="text/plain",
    )
    digest = hashlib.sha256(content).hexdigest()
    assert result.source_version.content_hash == digest
    assert result.source_version.object_key.endswith(digest)
    assert nexus.blob_store.get(result.source_version.object_key) == content


def test_pause_resume_cancel_and_worker_recovery_are_durable(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Recovery", slug="recovery")
    nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="recovery.md",
        content=b"# Recovery\n\nDurable drivers resume from authoritative state.",
        mime_type="text/markdown",
    )
    paused = nexus.run_service.create(
        goal="Explain durable drivers",
        kind=RunKind.QUICK,
        scope=ScopeCapsule(space_ids=(space.id,)),
        execute=False,
    )
    assert nexus.run_service.pause(paused.id).status.value == "paused"
    resumed = nexus.run_service.resume(paused.id)
    assert resumed.status.value == "completed"

    cancellable = nexus.run_service.create(
        goal="Cancel before dispatch",
        kind=RunKind.RESEARCH,
        scope=ScopeCapsule(space_ids=(space.id,)),
        execute=False,
    )
    cancelled = nexus.run_service.cancel(cancellable.id)
    assert cancelled.status.value == "cancelled"
    assert cancelled.stop_reason == "user_cancelled"

    recovering = nexus.run_service.create(
        goal="Explain durable drivers",
        kind=RunKind.QUICK,
        scope=ScopeCapsule(space_ids=(space.id,)),
        execute=False,
    )
    recovered = nexus.agent_runtime.recover(recovering.id)  # type: ignore[attr-defined]
    assert recovered.status.value == "completed"
