from __future__ import annotations

import os
import socket
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from celery import shared_task
from redis import Redis
from sqlalchemy import or_, select

from nexus.bootstrap import build_container
from nexus.infrastructure.postgres.models import IngestionJob, OutboxEvent, Run


@lru_cache(maxsize=1)
def _container() -> Any:
    return build_container()


def _heartbeat(role: str) -> None:
    container = _container()
    if not container.settings.redis_url:
        return
    worker_id = f"{role}:{socket.gethostname()}:{os.getpid()}"
    Redis.from_url(container.settings.redis_url).setex(
        f"nexus:worker:{worker_id}",
        max(30, int(container.settings.scheduler_interval_seconds * 10)),
        datetime.now(UTC).isoformat(),
    )


@shared_task(
    bind=True,
    name="nexus.ingestion.process",
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_ingestion(self: Any, job_id: str) -> dict[str, object]:
    _heartbeat("control")
    container = _container()
    job = container.ingestion.process_job(
        job_id,
        worker_id=f"celery:{self.request.hostname}:{self.request.id}",
    )
    if job.status == "completed":
        project_index.apply_async(queue="index")
    return {"job_id": job.id, "status": job.status, "stage": job.stage}


@shared_task(
    bind=True,
    name="nexus.run.advance",
    acks_late=True,
    reject_on_worker_lost=True,
)
def advance_run(self: Any, run_id: str) -> dict[str, object]:
    _heartbeat("control")
    container = _container()
    run = container.agent_runtime.recover(run_id)
    return {"run_id": run.id, "status": run.status.value}


@shared_task(
    name="nexus.index.project",
    acks_late=True,
    reject_on_worker_lost=True,
)
def project_index() -> dict[str, object]:
    _heartbeat("index")
    container = _container()
    if container.index is None:
        return {"status": "not_configured", "projected": 0}
    return {"status": "completed", **container.index.project_pending()}


@shared_task(
    name="nexus.index.rebuild",
    acks_late=True,
    reject_on_worker_lost=True,
)
def rebuild_index() -> dict[str, object]:
    """Build a fresh generation on the index worker, even when the manifest is unchanged."""

    _heartbeat("index")
    container = _container()
    if container.index is None:
        return {"status": "not_configured", "projected": 0}
    return {
        "status": "completed",
        **container.index.project_pending(limit=100000, force_rebuild=True),
    }


@shared_task(
    name="nexus.index.remove_source",
    acks_late=True,
    reject_on_worker_lost=True,
)
def remove_source_index(source_id: str) -> dict[str, object]:
    """Idempotently propagate a PostgreSQL tombstone to every Qdrant generation."""

    _heartbeat("index")
    container = _container()
    if container.index is None:
        return {"status": "not_configured", "source_id": source_id, "removed": 0}
    removed = container.index.remove_source(source_id)
    return {"status": "completed", "source_id": source_id, "removed": removed}


@shared_task(
    name="nexus.index.remove_evidence",
    acks_late=True,
    reject_on_worker_lost=True,
)
def remove_evidence_index(evidence_revision_ids: list[str]) -> dict[str, object]:
    """Remove superseded/tombstoned Evidence projections without touching PG history."""

    _heartbeat("index")
    container = _container()
    if container.index is None:
        return {"status": "not_configured", "removed": 0}
    removed = container.index.remove_evidence(evidence_revision_ids)
    return {"status": "completed", "removed": removed}


def _sync_scheduled_news(container: Any) -> dict[str, object]:
    """Materialize the daily feed through the normal Raw-first boundary.

    Connector external versions and ingestion idempotency keys make repeated beat
    delivery harmless. The scheduler does not introduce a second Source or index path.
    """

    settings = container.settings
    space_id = settings.scheduled_news_space_id
    if not space_id:
        return {"status": "disabled", "reason": "scheduled_news_space_id_not_configured"}
    results = container.connectors.sync(
        kind="news",
        space_id=space_id,
        process_inline=False,
        query=settings.scheduled_news_query,
        topic=settings.scheduled_news_topic,
        time_range=settings.scheduled_news_time_range,
        search_depth="advanced",
        include_full_content=settings.scheduled_news_include_full_content,
        max_results=settings.scheduled_news_max_results,
    )
    return {
        "status": "scheduled",
        "space_id": space_id,
        "items": len(results),
        "job_ids": [result.job.id for result in results],
    }


@shared_task(name="nexus.connectors.scheduled_news")
def sync_scheduled_news() -> dict[str, object]:
    _heartbeat("control")
    return _sync_scheduled_news(_container())


@shared_task(
    name="nexus.connectors.sync_schedule",
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_source_sync_schedule(schedule_id: str) -> dict[str, object]:
    _heartbeat("control")
    result = _container().source_syncs.run_schedule(schedule_id)
    if result is None:
        return {"status": "skipped", "schedule_id": schedule_id}
    return {
        "status": result.execution.status,
        "schedule_id": schedule_id,
        "execution_id": result.execution.id,
        "items_checked": result.execution.items_checked,
        "new_version_count": result.execution.new_version_count,
    }


@shared_task(name="nexus.scheduler.dispatch")
def dispatch_durable_work() -> dict[str, object]:
    """Reconstruct delivery from PostgreSQL truth; Redis/Celery state is disposable."""

    _heartbeat("scheduler")
    container = _container()
    now = datetime.now(UTC)
    schedules = container.source_syncs.claim_due(now=now, limit=50)
    with container.database.transaction() as session:
        jobs = list(
            session.scalars(
                select(IngestionJob.id)
                .where(
                    or_(
                        IngestionJob.status == "pending",
                        (
                            (IngestionJob.status == "running")
                            & (IngestionJob.lease_expires_at.is_not(None))
                            & (IngestionJob.lease_expires_at <= now)
                        ),
                    )
                )
                .order_by(IngestionJob.created_at)
                .limit(100)
            )
        )
        runs = list(
            session.scalars(
                select(Run.id)
                .where(Run.status.in_(["created", "recovering"]))
                .order_by(Run.created_at)
                .limit(100)
            )
        )
        outbox = list(
            session.scalars(
                select(OutboxEvent)
                .where(OutboxEvent.dispatched_at.is_(None))
                .order_by(OutboxEvent.created_at)
                .limit(200)
                .with_for_update(skip_locked=True)
            )
        )
        tombstoned_source_ids = {
            str(event.payload.get("source_id") or event.aggregate_id)
            for event in outbox
            if event.event_type == "source.tombstoned"
        }
        superseded_evidence_batches = [
            [str(item) for item in event.payload.get("evidence_revision_ids", [])]
            for event in outbox
            if event.event_type == "evidence.superseded"
        ]
        for event in outbox:
            event.attempts += 1
            event.dispatched_at = now
            event.last_error = None
    for job_id in jobs:
        process_ingestion.apply_async(
            args=[job_id],
            queue="control",
            task_id=f"ingestion:{job_id}",
        )
    for run_id in runs:
        advance_run.apply_async(
            args=[run_id],
            queue="control",
            task_id=f"run:{run_id}",
        )
    for schedule in schedules:
        run_source_sync_schedule.apply_async(
            args=[schedule.id],
            queue="control",
            task_id=f"source-sync:{schedule.id}:{schedule.next_run_at.isoformat()}",
        )
    for source_id in tombstoned_source_ids:
        remove_source_index.apply_async(
            args=[source_id],
            queue="index",
            task_id=f"source-tombstone:{source_id}",
        )
    for evidence_revision_ids in superseded_evidence_batches:
        remove_evidence_index.apply_async(
            args=[evidence_revision_ids],
            queue="index",
        )
    if outbox or jobs:
        project_index.apply_async(queue="index")
    return {
        "status": "completed",
        "ingestion_jobs": len(jobs),
        "runs": len(runs),
        "outbox_events": len(outbox),
        "source_sync_schedules": len(schedules),
    }
