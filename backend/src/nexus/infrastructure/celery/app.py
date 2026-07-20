from __future__ import annotations

import os
import socket
from datetime import UTC, datetime

from celery import Celery
from celery.schedules import crontab
from celery.signals import heartbeat_sent, worker_ready
from redis import Redis

from nexus.config import get_settings

settings = get_settings()
broker = settings.celery_broker_url or settings.redis_url or "redis://redis:6379/0"
result_backend = settings.celery_result_backend or settings.redis_url or broker

celery_app = Celery(
    "mma-rag-nexus",
    broker=broker,
    backend=result_backend,
    include=["nexus.infrastructure.celery.tasks"],
)
celery_app.conf.update(
    broker_connection_retry_on_startup=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_track_started=True,
    task_store_errors_even_if_ignored=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "nexus.ingestion.process": {"queue": "control"},
        "nexus.run.advance": {"queue": "control"},
        "nexus.index.project": {"queue": "index"},
        "nexus.index.rebuild": {"queue": "index"},
        "nexus.index.remove_source": {"queue": "index"},
        "nexus.index.remove_evidence": {"queue": "index"},
        "nexus.connectors.scheduled_news": {"queue": "control"},
        "nexus.connectors.sync_schedule": {"queue": "control"},
        "nexus.scheduler.dispatch": {"queue": "scheduler"},
    },
    beat_schedule={
        "dispatch-durable-nexus-work": {
            "task": "nexus.scheduler.dispatch",
            "schedule": settings.scheduler_interval_seconds,
        },
        "sync-scheduled-news": {
            "task": "nexus.connectors.scheduled_news",
            "schedule": crontab(
                hour=settings.scheduled_news_hour_utc,
                minute=settings.scheduled_news_minute_utc,
            ),
            "options": {"queue": "control"},
        },
    },
)


def _publish_process_heartbeat(**_: object) -> None:
    """Keep liveness separate from task traffic; PostgreSQL remains durable work truth."""

    if not settings.redis_url:
        return
    roles = [item.strip() for item in os.getenv("NEXUS_WORKER_ROLE", "").split(",")]
    for role in roles:
        if not role:
            continue
        worker_id = f"{role}:{socket.gethostname()}:{os.getpid()}"
        try:
            Redis.from_url(settings.redis_url).setex(
                f"nexus:worker:{worker_id}",
                30,
                datetime.now(UTC).isoformat(),
            )
        except Exception:
            # Redis liveness is already exposed by system health. A heartbeat
            # outage must not destabilize the Celery consumer signal loop.
            return


worker_ready.connect(_publish_process_heartbeat, weak=False)
heartbeat_sent.connect(_publish_process_heartbeat, weak=False)
