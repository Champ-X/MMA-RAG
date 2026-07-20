from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import BinaryIO, Protocol

from nexus.modules.evidence.domain import EvidenceDraft
from nexus.modules.sources.domain import (
    IngestionJobEventView,
    IngestionJobView,
    IngestionLease,
    ParseResult,
    RawSourceCommand,
    SourceSyncExecutionView,
    SourceSyncScheduleView,
    SourceVersionView,
)


class BlobStorePort(Protocol):
    def put(self, key: str, data: bytes, *, content_type: str, content_hash: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def open(self, key: str) -> BinaryIO: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...

    def list_keys(self) -> Iterable[str]: ...


class SourceRepositoryPort(Protocol):
    def create_raw_source(
        self, command: RawSourceCommand
    ) -> tuple[SourceVersionView, IngestionJobView]: ...

    def get_source_version(self, source_version_id: str) -> SourceVersionView: ...

    def get_source_sync_contract(self, *, space_id: str, source_id: str) -> dict[str, object]: ...

    def get_source_sync_schedule(
        self, *, space_id: str, source_id: str
    ) -> SourceSyncScheduleView | None: ...

    def get_source_sync_schedule_by_id(self, schedule_id: str) -> SourceSyncScheduleView: ...

    def upsert_source_sync_schedule(
        self,
        *,
        space_id: str,
        source_id: str,
        interval_minutes: int,
        enabled: bool,
        expected_revision: int | None,
    ) -> SourceSyncScheduleView: ...

    def list_source_sync_executions(
        self, *, space_id: str, source_id: str, limit: int
    ) -> list[SourceSyncExecutionView]: ...

    def current_source_version_ids(self, *, space_id: str) -> dict[str, str]: ...

    def start_source_sync_execution(
        self,
        *,
        space_id: str,
        source_id: str,
        trigger: str,
        schedule_id: str | None,
    ) -> SourceSyncExecutionView: ...

    def finish_source_sync_execution(
        self,
        execution_id: str,
        *,
        status: str,
        items_checked: int,
        new_version_count: int,
        job_ids: list[str],
        source_version_ids: list[str],
        error_message: str | None,
    ) -> SourceSyncExecutionView: ...

    def claim_due_source_sync_schedules(
        self, *, now: datetime, limit: int, lease_seconds: int
    ) -> list[SourceSyncScheduleView]: ...

    def begin_source_sync_schedule(
        self, schedule_id: str, *, now: datetime, lease_seconds: int
    ) -> SourceSyncScheduleView | None: ...

    def finish_source_sync_schedule(
        self,
        schedule_id: str,
        *,
        status: str,
        error_message: str | None,
        now: datetime,
    ) -> SourceSyncScheduleView: ...

    def get_ingestion_job(self, job_id: str) -> IngestionJobView: ...

    def list_ingestion_jobs(
        self,
        *,
        status: str | None,
        space_id: str | None,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[IngestionJobView], str | None]: ...

    def retry_ingestion(self, job_id: str) -> IngestionJobView: ...

    def create_reprocess_job(self, source_id: str) -> IngestionJobView: ...

    def cancel_ingestion(self, job_id: str) -> IngestionJobView: ...

    def list_ingestion_events(
        self, job_id: str, *, after: int, limit: int
    ) -> tuple[list[IngestionJobEventView], int | None]: ...

    def acquire_ingestion(
        self, job_id: str, *, worker_id: str, lease_seconds: int
    ) -> IngestionLease: ...

    def claim_ingestion_jobs(
        self, *, worker_id: str, limit: int, lease_seconds: int
    ) -> list[IngestionLease]: ...

    def renew_ingestion_lease(
        self, lease: IngestionLease, *, lease_seconds: int
    ) -> IngestionLease: ...

    def list_sources(
        self, *, space_id: str, cursor: str | None, limit: int
    ) -> tuple[list[SourceVersionView], str | None]: ...

    def start_ingestion(self, job_id: str, *, lease: IngestionLease) -> SourceVersionView: ...

    def publish_evidence(
        self,
        *,
        job_id: str,
        drafts: list[EvidenceDraft],
        parser_manifest: dict[str, object],
        capabilities: dict[str, str],
        lease: IngestionLease,
    ) -> list[str]: ...

    def fail_ingestion(
        self, job_id: str, *, code: str, message: str, lease: IngestionLease
    ) -> None: ...

    def tombstone_source(self, source_id: str) -> None: ...


class ParserPort(Protocol):
    def parse(
        self,
        *,
        content: bytes,
        filename: str,
        mime_type: str,
        source_version: SourceVersionView,
    ) -> ParseResult: ...
