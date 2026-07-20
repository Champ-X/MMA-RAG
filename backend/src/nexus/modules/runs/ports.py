from __future__ import annotations

from typing import Protocol

from nexus.modules.runs.domain import (
    DriverLease,
    EvidenceLedgerView,
    RunCommand,
    RunEventView,
    RunSnapshotView,
    RunView,
)
from nexus.shared.domain.enums import RunStatus


class RunRepositoryPort(Protocol):
    def create_run(self, command: RunCommand) -> RunView: ...

    def get_run(self, run_id: str) -> RunView: ...

    def list_conversation(self, conversation_id: str) -> list[RunView]: ...

    def list_runs(
        self, *, status: str | None, cursor: str | None, limit: int
    ) -> tuple[list[RunView], str | None]: ...

    def get_snapshot(self, run_id: str) -> RunSnapshotView: ...

    def append_event(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, object],
        *,
        producer: str,
        trace_id: str,
        artifact_refs: tuple[str, ...] = (),
    ) -> RunEventView: ...

    def list_events(
        self, run_id: str, *, after: int, limit: int
    ) -> tuple[list[RunEventView], int | None]: ...

    def acquire_driver(
        self, run_id: str, *, worker_id: str, lease_seconds: int = 60
    ) -> DriverLease: ...

    def transition(
        self,
        lease: DriverLease,
        *,
        status: RunStatus,
        stop_reason: str | None = None,
        result: dict[str, object] | None = None,
    ) -> RunView: ...

    def save_checkpoint(
        self, lease: DriverLease, *, state: dict[str, object], runtime_version: str
    ) -> str: ...

    def load_checkpoint(self, run_id: str) -> dict[str, object] | None: ...

    def add_ledger_items(
        self,
        run_id: str,
        evidence_revision_ids: list[str],
        *,
        discovered_by: str,
        relevance: dict[str, float],
    ) -> int: ...

    def list_ledger_items(self, run_id: str) -> list[EvidenceLedgerView]: ...

    def request_pause(self, run_id: str) -> RunView: ...

    def request_resume(self, run_id: str) -> RunView: ...

    def request_cancel(self, run_id: str) -> RunView: ...


class AgentRuntimePort(Protocol):
    def start(self, run_id: str) -> RunView: ...

    def advance(self, run_id: str) -> RunView: ...

    def resume(self, run_id: str) -> RunView: ...

    def cancel(self, run_id: str) -> RunView: ...

    def inspect(self, run_id: str) -> dict[str, object]: ...

    def recover(self, run_id: str) -> RunView: ...
