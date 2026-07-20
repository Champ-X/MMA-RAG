from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from nexus.modules.sources.application import IngestionResult
from nexus.modules.sources.domain import (
    SourceSyncExecutionView,
    SourceSyncScheduleView,
)
from nexus.modules.sources.ports import SourceRepositoryPort


@dataclass(frozen=True, slots=True)
class SourceSyncRunResult:
    connector_kind: str
    location: str | None
    items: tuple[IngestionResult, ...]
    execution: SourceSyncExecutionView


class SourceSyncSchedulerService:
    """Runs reusable connector contracts while PostgreSQL owns timing and history."""

    def __init__(
        self,
        *,
        repository: SourceRepositoryPort,
        connectors: Any,
        process_inline: bool,
        lease_seconds: int,
        index: Any | None,
    ) -> None:
        self.repository = repository
        self.connectors = connectors
        self.process_inline = process_inline
        self.lease_seconds = lease_seconds
        self.index = index

    def get(
        self, *, space_id: str, source_id: str
    ) -> SourceSyncScheduleView | None:
        return self.repository.get_source_sync_schedule(
            space_id=space_id, source_id=source_id
        )

    def configure(
        self,
        *,
        space_id: str,
        source_id: str,
        interval_minutes: int,
        enabled: bool,
        expected_revision: int | None,
    ) -> SourceSyncScheduleView:
        return self.repository.upsert_source_sync_schedule(
            space_id=space_id,
            source_id=source_id,
            interval_minutes=interval_minutes,
            enabled=enabled,
            expected_revision=expected_revision,
        )

    def history(
        self, *, space_id: str, source_id: str, limit: int = 20
    ) -> list[SourceSyncExecutionView]:
        return self.repository.list_source_sync_executions(
            space_id=space_id, source_id=source_id, limit=limit
        )

    def claim_due(
        self, *, now: datetime | None = None, limit: int = 50
    ) -> list[SourceSyncScheduleView]:
        return self.repository.claim_due_source_sync_schedules(
            now=now or datetime.now(UTC),
            limit=limit,
            lease_seconds=self.lease_seconds,
        )

    def run_now(self, *, space_id: str, source_id: str) -> SourceSyncRunResult:
        schedule = self.get(space_id=space_id, source_id=source_id)
        return self._execute(
            space_id=space_id,
            source_id=source_id,
            trigger="manual",
            schedule_id=schedule.id if schedule else None,
        )

    def run_schedule(
        self, schedule_id: str, *, now: datetime | None = None
    ) -> SourceSyncRunResult | None:
        effective_now = now or datetime.now(UTC)
        if effective_now.tzinfo is None:
            effective_now = effective_now.replace(tzinfo=UTC)
        schedule = self.repository.begin_source_sync_schedule(
            schedule_id,
            now=effective_now,
            lease_seconds=self.lease_seconds,
        )
        if schedule is None:
            return None
        try:
            result = self._execute(
                space_id=schedule.space_id,
                source_id=schedule.source_id,
                trigger="scheduled",
                schedule_id=schedule.id,
            )
        except Exception as exc:
            self.repository.finish_source_sync_schedule(
                schedule_id,
                status="failed",
                error_message=str(exc)[:2000],
                now=effective_now,
            )
            raise
        self.repository.finish_source_sync_schedule(
            schedule_id,
            status=result.execution.status,
            error_message=None,
            now=effective_now,
        )
        return result

    def _execute(
        self,
        *,
        space_id: str,
        source_id: str,
        trigger: str,
        schedule_id: str | None,
    ) -> SourceSyncRunResult:
        before = self.repository.current_source_version_ids(space_id=space_id)
        execution = self.repository.start_source_sync_execution(
            space_id=space_id,
            source_id=source_id,
            trigger=trigger,
            schedule_id=schedule_id,
        )
        kind = "unknown"
        try:
            contract = self.repository.get_source_sync_contract(
                space_id=space_id, source_id=source_id
            )
            kind = str(contract.pop("kind"))
            items = self.connectors.sync(
                kind=kind,
                space_id=space_id,
                process_inline=self.process_inline,
                **contract,
            )
            changed = [
                item
                for item in items
                if before.get(item.source_version.source_id) != item.source_version.id
            ]
            status = "changed" if changed else "no_change"
            completed = self.repository.finish_source_sync_execution(
                execution.id,
                status=status,
                items_checked=len(items),
                new_version_count=len(changed),
                job_ids=[item.job.id for item in items],
                source_version_ids=[item.source_version.id for item in changed],
                error_message=None,
            )
            if self.index and any(item.job.status == "completed" for item in items):
                self.index.project_pending()
            return SourceSyncRunResult(
                connector_kind=kind,
                location=self.connectors.describe_origin(kind=kind, parameters=contract),
                items=tuple(items),
                execution=completed,
            )
        except Exception as exc:
            self.repository.finish_source_sync_execution(
                execution.id,
                status="failed",
                items_checked=0,
                new_version_count=0,
                job_ids=[],
                source_version_ids=[],
                error_message=str(exc)[:2000],
            )
            raise
