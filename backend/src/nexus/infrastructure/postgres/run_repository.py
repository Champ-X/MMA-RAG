from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, exists, func, or_, select

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import (
    Artifact,
    ArtifactRefreshProposal,
    ArtifactRevision,
    Claim,
    ClaimEvidenceLink,
    Collection,
    Conversation,
    EvidenceLedgerItem,
    EvidenceLocator,
    EvidenceRevision,
    IdempotencyRecord,
    IndexRelease,
    PublishCounter,
    Run,
    RunEvent,
    RunSnapshot,
    RuntimeCheckpoint,
    Source,
    SourceSpaceLink,
    SourceVersion,
    StreamCounter,
)
from nexus.modules.artifacts.domain import (
    ArtifactRefreshProposalView,
    ArtifactView,
    apply_artifact_template,
    get_artifact_template,
    summarize_artifact_coverage,
)
from nexus.modules.claims.domain import (
    ClaimView,
    KnowledgeEvidenceReferenceView,
    SpaceKnowledgeClaimView,
)
from nexus.modules.conversations.domain import ConversationView
from nexus.modules.retrieval.domain import ScopeCapsule
from nexus.modules.runs.domain import (
    DriverLease,
    EvidenceLedgerView,
    RunCommand,
    RunEventView,
    RunSnapshotView,
    RunView,
)
from nexus.shared.domain.enums import (
    TERMINAL_RUN_STATUSES,
    ClaimStatus,
    QualityMode,
    RunKind,
    RunStatus,
)
from nexus.shared.domain.errors import ConflictError, NotFoundError, ValidationError
from nexus.shared.domain.ids import new_id


def _hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _encode_conversation_cursor(row: Conversation) -> str:
    payload = json.dumps(
        {
            "pinned": row.pinned,
            "last_activity_at": row.last_activity_at.isoformat(),
            "id": row.id,
        },
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_conversation_cursor(value: str) -> tuple[bool, datetime, str]:
    try:
        padded = value + "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        return (
            bool(payload["pinned"]),
            datetime.fromisoformat(str(payload["last_activity_at"])),
            str(payload["id"]),
        )
    except (binascii.Error, KeyError, TypeError, UnicodeDecodeError, ValueError) as exc:
        raise ValidationError("Invalid conversation cursor") from exc


class SqlRunRepository:
    def __init__(
        self,
        database: Database,
        *,
        model_snapshot_provider: Callable[[], dict[str, object]] | None = None,
    ) -> None:
        self.database = database
        self.model_snapshot_provider = model_snapshot_provider

    @staticmethod
    def _sequence(session: Any, stream_id: str) -> int:
        counter = session.get(StreamCounter, stream_id, with_for_update=True)
        if counter is None:
            counter = StreamCounter(stream_id=stream_id, sequence=0)
            session.add(counter)
            session.flush()
        counter.sequence += 1
        session.flush()
        return counter.sequence

    @classmethod
    def _event(
        cls,
        session: Any,
        run_id: str,
        event_type: str,
        payload: dict[str, object],
        *,
        producer: str,
        trace_id: str,
        artifact_refs: tuple[str, ...] = (),
    ) -> RunEvent:
        event = RunEvent(
            run_id=run_id,
            sequence=cls._sequence(session, run_id),
            event_type=event_type,
            producer=producer,
            trace_id=trace_id,
            public_payload=payload,
            artifact_refs=list(artifact_refs),
        )
        session.add(event)
        session.flush()
        return event

    def create_run(self, command: RunCommand) -> RunView:
        payload = {
            "goal": command.goal,
            "kind": command.kind.value,
            "quality_mode": command.quality_mode.value,
            "scope": {
                "space_ids": command.scope.space_ids,
                "collection_ids": command.scope.collection_ids,
                "source_ids": command.scope.source_ids,
                "global_search": command.scope.global_search,
                "publish_watermark": command.scope.publish_watermark,
            },
            "conversation_id": command.conversation_id,
            "parent_run_id": command.parent_run_id,
            "request_context": command.request_context or {},
            "selected_model_deployment_id": command.selected_model_deployment_id,
        }
        request_hash = _hash(payload)
        with self.database.transaction() as session:
            if command.idempotency_key:
                existing = session.scalar(
                    select(IdempotencyRecord).where(
                        IdempotencyRecord.scope == "runs.create",
                        IdempotencyRecord.key == command.idempotency_key,
                    )
                )
                if existing:
                    if existing.request_hash != request_hash:
                        raise ConflictError("Idempotency key was used with a different Run payload")
                    run = session.get(Run, existing.resource_id)
                    if run is None:
                        raise ConflictError("Idempotency record points to a missing Run")
                    return self._view(run)
            current_watermark = (
                session.scalar(select(PublishCounter.sequence).where(PublishCounter.singleton == 1))
                or 0
            )
            watermark = command.scope.publish_watermark
            if watermark is None:
                watermark = current_watermark
            source_ids = set(command.scope.source_ids)
            if command.scope.space_ids:
                source_ids.update(
                    session.scalars(
                        select(SourceSpaceLink.source_id).where(
                            SourceSpaceLink.space_id.in_(command.scope.space_ids),
                            SourceSpaceLink.valid_to_sequence.is_(None),
                        )
                    )
                )
            frozen_scope = ScopeCapsule(
                space_ids=command.scope.space_ids,
                collection_ids=command.scope.collection_ids,
                source_ids=tuple(sorted(source_ids)),
                global_search=command.scope.global_search,
                publish_watermark=watermark,
            )
            scope_payload = self._scope_payload(frozen_scope)
            parent = session.get(Run, command.parent_run_id) if command.parent_run_id else None
            if command.parent_run_id and parent is None:
                raise NotFoundError(
                    "Parent conversation Run not found",
                    details={"parent_run_id": command.parent_run_id},
                )
            conversation_id = (
                parent.conversation_id
                if parent is not None
                else command.conversation_id or new_id()
            )
            conversation = self._ensure_conversation(
                session,
                conversation_id,
                fallback_title=command.goal,
            )
            run = Run(
                conversation_id=conversation_id,
                parent_run_id=parent.id if parent is not None else None,
                kind=command.kind.value,
                goal=command.goal,
                status=RunStatus.CREATED.value,
                quality_mode=command.quality_mode.value,
                scope=scope_payload,
                request_context=command.request_context or {},
                selected_model_deployment_id=command.selected_model_deployment_id,
            )
            session.add(run)
            session.flush()
            conversation.last_activity_at = run.created_at
            if conversation.archived:
                conversation.archived = False
                conversation.revision += 1
                conversation.updated_at = run.created_at
            active_release = session.scalar(
                select(IndexRelease)
                .where(IndexRelease.status == "active")
                .order_by(IndexRelease.release_no.desc())
            )
            model_snapshot = (
                self.model_snapshot_provider() if self.model_snapshot_provider is not None else {}
            )
            source_version_ids = list(
                session.scalars(
                    select(SourceVersion.id).where(
                        SourceVersion.source_id.in_(source_ids),
                        SourceVersion.visible_from_sequence <= watermark,
                        (SourceVersion.visible_until_sequence.is_(None))
                        | (SourceVersion.visible_until_sequence > watermark),
                    )
                )
            ) if source_ids else []
            collection_revisions = [
                {
                    "collection_id": item.id,
                    "space_id": item.space_id,
                    "revision": item.revision,
                }
                for item in session.scalars(
                    select(Collection).where(Collection.id.in_(command.scope.collection_ids))
                )
            ] if command.scope.collection_ids else []
            snapshot = {
                "goal": command.goal,
                "scope": scope_payload,
                "knowledge_snapshot": {
                    "publish_watermark": watermark,
                    "source_ids": sorted(source_ids),
                    "source_version_ids": sorted(source_version_ids),
                    "collection_revisions": collection_revisions,
                    "index_release_id": active_release.id if active_release else None,
                    "index_generations": active_release.generation_map if active_release else {},
                },
                "execution": {
                    "kind": command.kind.value,
                    "quality_mode": command.quality_mode.value,
                    "runtime": "nexus-native-v1",
                    "app_version": "2.0.0",
                },
                "models": model_snapshot,
                "conversation": {
                    "conversation_id": conversation_id,
                    "parent_run_id": parent.id if parent is not None else None,
                    "history": (command.request_context or {}).get(
                        "conversation_history", []
                    ),
                    "selected_model_deployment_id": command.selected_model_deployment_id,
                    "attachment_source_ids": (command.request_context or {}).get(
                        "attachment_source_ids", []
                    ),
                },
                "policy": {
                    "scope_expansion": False,
                    "external_tools": False,
                    "hidden_chain_of_thought": False,
                },
            }
            session.add(RunSnapshot(run_id=run.id, snapshot=snapshot))
            self._event(
                session,
                run.id,
                "run.created",
                {"kind": command.kind.value, "quality_mode": command.quality_mode.value},
                producer="api",
                trace_id=new_id(),
            )
            if command.idempotency_key:
                session.add(
                    IdempotencyRecord(
                        scope="runs.create",
                        key=command.idempotency_key,
                        request_hash=request_hash,
                        resource_type="run",
                        resource_id=run.id,
                        response_payload={"run_id": run.id},
                    )
                )
            return self._view(run)

    def get_run(self, run_id: str) -> RunView:
        with self.database.transaction() as session:
            run = session.get(Run, run_id)
            if run is None:
                raise NotFoundError("Run not found", details={"run_id": run_id})
            return self._view(run)

    def list_conversation(self, conversation_id: str) -> list[RunView]:
        with self.database.transaction() as session:
            rows = session.scalars(
                select(Run)
                .where(Run.conversation_id == conversation_id)
                .order_by(Run.created_at, Run.id)
            )
            return [self._view(row) for row in rows]

    def get_conversation(self, conversation_id: str) -> ConversationView:
        with self.database.transaction() as session:
            row = session.get(Conversation, conversation_id)
            if row is None:
                self._backfill_missing_conversations(session, conversation_id=conversation_id)
                row = session.get(Conversation, conversation_id)
            if row is None:
                raise NotFoundError(
                    "Conversation not found",
                    details={"conversation_id": conversation_id},
                )
            views = self._conversation_views(session, [row])
            if not views:
                raise NotFoundError(
                    "Conversation has no Runs",
                    details={"conversation_id": conversation_id},
                )
            return views[0]

    def list_conversations(
        self,
        *,
        query: str | None,
        archived: bool,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[ConversationView], str | None]:
        with self.database.transaction() as session:
            self._backfill_missing_conversations(session)
            has_run = exists(select(Run.id).where(Run.conversation_id == Conversation.id))
            statement = (
                select(Conversation)
                .where(Conversation.archived.is_(archived), has_run)
                .order_by(
                    Conversation.pinned.desc(),
                    Conversation.last_activity_at.desc(),
                    Conversation.id.desc(),
                )
                .limit(limit + 1)
            )
            if query:
                goal_match = exists(
                    select(Run.id).where(
                        Run.conversation_id == Conversation.id,
                        func.lower(Run.goal).contains(query.lower(), autoescape=True),
                    )
                )
                statement = statement.where(
                    or_(
                        func.lower(Conversation.title).contains(query.lower(), autoescape=True),
                        goal_match,
                    )
                )
            if cursor:
                pinned, last_activity_at, conversation_id = _decode_conversation_cursor(cursor)
                same_pin_older = and_(
                    Conversation.pinned.is_(pinned),
                    or_(
                        Conversation.last_activity_at < last_activity_at,
                        and_(
                            Conversation.last_activity_at == last_activity_at,
                            Conversation.id < conversation_id,
                        ),
                    ),
                )
                statement = statement.where(
                    or_(same_pin_older, Conversation.pinned.is_(False))
                    if pinned
                    else same_pin_older
                )
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            views = self._conversation_views(session, rows)
            next_cursor = _encode_conversation_cursor(rows[-1]) if has_more and rows else None
            return views, next_cursor

    def update_conversation(
        self,
        conversation_id: str,
        *,
        expected_revision: int,
        title: str | None,
        pinned: bool | None,
        archived: bool | None,
    ) -> ConversationView:
        with self.database.transaction() as session:
            row = session.get(Conversation, conversation_id, with_for_update=True)
            if row is None:
                self._backfill_missing_conversations(session, conversation_id=conversation_id)
                row = session.get(Conversation, conversation_id, with_for_update=True)
            if row is None:
                raise NotFoundError(
                    "Conversation not found",
                    details={"conversation_id": conversation_id},
                )
            if row.revision != expected_revision:
                raise ConflictError(
                    "Conversation changed since it was loaded",
                    details={
                        "conversation_id": conversation_id,
                        "expected_revision": expected_revision,
                        "actual_revision": row.revision,
                    },
                )
            if title is not None:
                row.title = title
            if pinned is not None:
                row.pinned = pinned
            if archived is not None:
                row.archived = archived
            row.revision += 1
            row.updated_at = datetime.now(UTC)
            session.flush()
            return self._conversation_views(session, [row])[0]

    def list_runs(
        self, *, status: str | None, cursor: str | None, limit: int
    ) -> tuple[list[RunView], str | None]:
        with self.database.transaction() as session:
            statement = select(Run).order_by(Run.id.desc()).limit(limit + 1)
            if status:
                statement = statement.where(Run.status == status)
            if cursor:
                statement = statement.where(Run.id < cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            return [self._view(row) for row in rows], rows[-1].id if has_more and rows else None

    def get_snapshot(self, run_id: str) -> RunSnapshotView:
        with self.database.transaction() as session:
            row = session.get(RunSnapshot, run_id)
            if row is None:
                raise NotFoundError("Run snapshot not found", details={"run_id": run_id})
            return RunSnapshotView(
                run_id=row.run_id,
                snapshot=row.snapshot,
                schema_version=row.schema_version,
                created_at=row.created_at,
            )

    def append_event(
        self,
        run_id: str,
        event_type: str,
        payload: dict[str, object],
        *,
        producer: str,
        trace_id: str,
        artifact_refs: tuple[str, ...] = (),
    ) -> RunEventView:
        with self.database.transaction() as session:
            if session.get(Run, run_id) is None:
                raise NotFoundError("Run not found", details={"run_id": run_id})
            return self._event_view(
                self._event(
                    session,
                    run_id,
                    event_type,
                    payload,
                    producer=producer,
                    trace_id=trace_id,
                    artifact_refs=artifact_refs,
                )
            )

    def list_events(
        self, run_id: str, *, after: int, limit: int
    ) -> tuple[list[RunEventView], int | None]:
        with self.database.transaction() as session:
            if session.get(Run, run_id) is None:
                raise NotFoundError("Run not found", details={"run_id": run_id})
            rows = list(
                session.scalars(
                    select(RunEvent)
                    .where(RunEvent.run_id == run_id, RunEvent.sequence > after)
                    .order_by(RunEvent.sequence)
                    .limit(limit + 1)
                )
            )
            has_more = len(rows) > limit
            rows = rows[:limit]
            return [self._event_view(row) for row in rows], (
                rows[-1].sequence if has_more and rows else None
            )

    def acquire_driver(
        self, run_id: str, *, worker_id: str, lease_seconds: int = 60
    ) -> DriverLease:
        now = datetime.now(UTC)
        with self.database.transaction() as session:
            run = session.get(Run, run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found", details={"run_id": run_id})
            if run.status in TERMINAL_RUN_STATUSES:
                return DriverLease(
                    run_id=run.id,
                    worker_id=worker_id,
                    fencing_token=run.execution_epoch,
                    state_version=run.state_version,
                    execution_epoch=run.execution_epoch,
                )
            lease_expires = _aware(run.lease_expires_at)
            if (
                run.owner_worker_id
                and run.owner_worker_id != worker_id
                and lease_expires
                and lease_expires > now
            ):
                raise ConflictError(
                    "Run is already owned by an active worker",
                    details={"owner_worker_id": run.owner_worker_id},
                )
            if run.owner_worker_id != worker_id or not lease_expires or lease_expires <= now:
                run.execution_epoch += 1
            run.owner_worker_id = worker_id
            run.lease_expires_at = now + timedelta(seconds=lease_seconds)
            return DriverLease(
                run_id=run.id,
                worker_id=worker_id,
                fencing_token=run.execution_epoch,
                state_version=run.state_version,
                execution_epoch=run.execution_epoch,
            )

    def transition(
        self,
        lease: DriverLease,
        *,
        status: RunStatus,
        stop_reason: str | None = None,
        result: dict[str, object] | None = None,
    ) -> RunView:
        with self.database.transaction() as session:
            run = session.get(Run, lease.run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found")
            self._assert_fence(run, lease)
            if run.status in TERMINAL_RUN_STATUSES and run.status != status.value:
                raise ConflictError("Terminal Run state is immutable")
            run.status = status.value
            run.stop_reason = stop_reason
            if result is not None:
                run.result = result
            run.state_version += 1
            self._touch_conversation(session, run.conversation_id)
            self._event(
                session,
                run.id,
                f"run.{status.value}",
                {"status": status.value, "stop_reason": stop_reason},
                producer=lease.worker_id,
                trace_id=new_id(),
            )
            return self._view(run)

    def save_checkpoint(
        self, lease: DriverLease, *, state: dict[str, object], runtime_version: str
    ) -> str:
        with self.database.transaction() as session:
            run = session.get(Run, lease.run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found")
            self._assert_fence(run, lease)
            revision = (
                session.scalar(
                    select(func.max(RuntimeCheckpoint.revision)).where(
                        RuntimeCheckpoint.run_id == run.id
                    )
                )
                or 0
            ) + 1
            checkpoint = RuntimeCheckpoint(
                run_id=run.id,
                revision=revision,
                status="committed",
                state_payload=state,
                state_digest=_hash(state),
                runtime_version=runtime_version,
            )
            session.add(checkpoint)
            session.flush()
            run.current_checkpoint_id = checkpoint.id
            self._event(
                session,
                run.id,
                "runtime.checkpoint.committed",
                {"checkpoint_id": checkpoint.id, "revision": revision},
                producer=lease.worker_id,
                trace_id=new_id(),
            )
            return checkpoint.id

    def load_checkpoint(self, run_id: str) -> dict[str, object] | None:
        with self.database.transaction() as session:
            checkpoint = session.scalar(
                select(RuntimeCheckpoint)
                .where(
                    RuntimeCheckpoint.run_id == run_id,
                    RuntimeCheckpoint.status == "committed",
                )
                .order_by(RuntimeCheckpoint.revision.desc())
            )
            return checkpoint.state_payload if checkpoint else None

    def add_ledger_items(
        self,
        run_id: str,
        evidence_revision_ids: list[str],
        *,
        discovered_by: str,
        relevance: dict[str, float],
    ) -> int:
        added = 0
        with self.database.transaction() as session:
            for revision_id in evidence_revision_ids:
                existing = session.scalar(
                    select(EvidenceLedgerItem).where(
                        EvidenceLedgerItem.run_id == run_id,
                        EvidenceLedgerItem.evidence_revision_id == revision_id,
                    )
                )
                if existing:
                    existing.relevance = max(existing.relevance, relevance.get(revision_id, 0.0))
                    continue
                session.add(
                    EvidenceLedgerItem(
                        run_id=run_id,
                        evidence_revision_id=revision_id,
                        discovered_by=discovered_by,
                        relevance=relevance.get(revision_id, 0.0),
                    )
                )
                added += 1
        return added

    def list_ledger_items(self, run_id: str) -> list[EvidenceLedgerView]:
        with self.database.transaction() as session:
            if session.get(Run, run_id) is None:
                raise NotFoundError("Run not found", details={"run_id": run_id})
            rows = list(
                session.scalars(
                    select(EvidenceLedgerItem)
                    .where(EvidenceLedgerItem.run_id == run_id)
                    .order_by(
                        EvidenceLedgerItem.relevance.desc(),
                        EvidenceLedgerItem.created_at,
                        EvidenceLedgerItem.id,
                    )
                )
            )
            return [
                EvidenceLedgerView(
                    evidence_revision_id=row.evidence_revision_id,
                    discovered_by=row.discovered_by,
                    disposition=row.disposition,
                    relevance=row.relevance,
                )
                for row in rows
            ]

    def request_pause(self, run_id: str) -> RunView:
        with self.database.transaction() as session:
            run = session.get(Run, run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found")
            if run.status in TERMINAL_RUN_STATUSES:
                return self._view(run)
            run.status = RunStatus.PAUSED.value
            run.state_version += 1
            self._touch_conversation(session, run.conversation_id)
            self._event(
                session,
                run.id,
                "run.paused",
                {"reason": "user_requested"},
                producer="api",
                trace_id=new_id(),
            )
            return self._view(run)

    def request_resume(self, run_id: str) -> RunView:
        with self.database.transaction() as session:
            run = session.get(Run, run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found")
            if run.status in TERMINAL_RUN_STATUSES:
                raise ConflictError("A terminal Run cannot be resumed")
            if run.status == RunStatus.PAUSED.value:
                run.status = RunStatus.RECOVERING.value
                run.owner_worker_id = None
                run.lease_expires_at = None
                run.state_version += 1
                self._touch_conversation(session, run.conversation_id)
                self._event(
                    session,
                    run.id,
                    "run.resume_requested",
                    {},
                    producer="api",
                    trace_id=new_id(),
                )
            return self._view(run)

    def request_cancel(self, run_id: str) -> RunView:
        with self.database.transaction() as session:
            run = session.get(Run, run_id, with_for_update=True)
            if run is None:
                raise NotFoundError("Run not found")
            if run.status in TERMINAL_RUN_STATUSES:
                return self._view(run)
            run.cancel_requested = True
            self._touch_conversation(session, run.conversation_id)
            self._event(
                session,
                run.id,
                "run.cancel_requested",
                {},
                producer="api",
                trace_id=new_id(),
            )
            return self._view(run)

    @staticmethod
    def _ensure_conversation(
        session: Any,
        conversation_id: str,
        *,
        fallback_title: str,
    ) -> Conversation:
        row = session.get(Conversation, conversation_id)
        if row is not None:
            return row
        first_run = session.scalar(
            select(Run)
            .where(Run.conversation_id == conversation_id)
            .order_by(Run.created_at, Run.id)
            .limit(1)
        )
        created_at = first_run.created_at if first_run is not None else datetime.now(UTC)
        last_activity_at = session.scalar(
            select(func.max(Run.updated_at)).where(Run.conversation_id == conversation_id)
        ) or created_at
        row = Conversation(
            id=conversation_id,
            title=(first_run.goal if first_run is not None else fallback_title)[:160],
            created_at=created_at,
            updated_at=created_at,
            last_activity_at=last_activity_at,
        )
        session.add(row)
        session.flush()
        return row

    @classmethod
    def _backfill_missing_conversations(
        cls,
        session: Any,
        *,
        conversation_id: str | None = None,
    ) -> None:
        conversation_exists = exists(
            select(Conversation.id).where(Conversation.id == Run.conversation_id)
        )
        statement = (
            select(Run)
            .where(~conversation_exists)
            .order_by(Run.conversation_id, Run.created_at, Run.id)
        )
        if conversation_id is not None:
            statement = statement.where(Run.conversation_id == conversation_id)
        missing_runs = list(session.scalars(statement))
        grouped: dict[str, list[Run]] = {}
        for run in missing_runs:
            grouped.setdefault(run.conversation_id, []).append(run)
        for identifier, runs in grouped.items():
            first = runs[0]
            last_activity_at = max(run.updated_at for run in runs)
            session.add(
                Conversation(
                    id=identifier,
                    title=first.goal[:160],
                    created_at=first.created_at,
                    updated_at=first.created_at,
                    last_activity_at=last_activity_at,
                )
            )
        if grouped:
            session.flush()

    @staticmethod
    def _touch_conversation(session: Any, conversation_id: str) -> None:
        row = session.get(Conversation, conversation_id)
        if row is not None:
            row.last_activity_at = datetime.now(UTC)

    @staticmethod
    def _conversation_views(
        session: Any,
        conversations: list[Conversation],
    ) -> list[ConversationView]:
        if not conversations:
            return []
        rows = list(
            session.scalars(
                select(Run)
                .where(Run.conversation_id.in_([row.id for row in conversations]))
                .order_by(Run.created_at, Run.id)
            )
        )
        grouped: dict[str, list[Run]] = {}
        for run in rows:
            grouped.setdefault(run.conversation_id, []).append(run)
        views: list[ConversationView] = []
        for conversation in conversations:
            runs = grouped.get(conversation.id, [])
            if not runs:
                continue
            latest = runs[-1]
            kinds = tuple(dict.fromkeys(run.kind for run in runs))
            space_ids = tuple(
                dict.fromkeys(
                    str(space_id)
                    for run in runs
                    for space_id in (run.scope or {}).get("space_ids", [])
                )
            )
            citation_count = sum(
                len(citations)
                for run in runs
                if run.result
                for citations in [run.result.get("citations", [])]
                if isinstance(citations, list)
            )
            views.append(
                ConversationView(
                    id=conversation.id,
                    title=conversation.title,
                    pinned=conversation.pinned,
                    archived=conversation.archived,
                    revision=conversation.revision,
                    run_count=len(runs),
                    latest_run_id=latest.id,
                    latest_goal=latest.goal,
                    latest_status=latest.status,
                    kinds=kinds,
                    space_ids=space_ids,
                    citation_count=citation_count,
                    created_at=conversation.created_at,
                    updated_at=conversation.updated_at,
                    last_activity_at=conversation.last_activity_at,
                )
            )
        return views

    @staticmethod
    def _assert_fence(run: Run, lease: DriverLease) -> None:
        if run.owner_worker_id != lease.worker_id or run.execution_epoch != lease.fencing_token:
            raise ConflictError("Stale Run driver fencing token")

    @staticmethod
    def _scope_payload(scope: ScopeCapsule) -> dict[str, object]:
        return {
            "space_ids": list(scope.space_ids),
            "collection_ids": list(scope.collection_ids),
            "source_ids": list(scope.source_ids),
            "global_search": scope.global_search,
            "publish_watermark": scope.publish_watermark,
        }

    @staticmethod
    def _view(row: Run) -> RunView:
        scope = row.scope
        return RunView(
            id=row.id,
            conversation_id=row.conversation_id,
            parent_run_id=row.parent_run_id,
            goal=row.goal,
            kind=RunKind(row.kind),
            quality_mode=QualityMode(row.quality_mode),
            scope=ScopeCapsule(
                space_ids=tuple(scope.get("space_ids", [])),
                collection_ids=tuple(scope.get("collection_ids", [])),
                source_ids=tuple(scope.get("source_ids", [])),
                global_search=bool(scope.get("global_search", False)),
                publish_watermark=scope.get("publish_watermark"),
            ),
            request_context=row.request_context or {},
            selected_model_deployment_id=row.selected_model_deployment_id,
            status=RunStatus(row.status),
            result=row.result,
            stop_reason=row.stop_reason,
            state_version=row.state_version,
            execution_epoch=row.execution_epoch,
            cancel_requested=row.cancel_requested,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _event_view(row: RunEvent) -> RunEventView:
        return RunEventView(
            event_id=row.id,
            stream_id=row.run_id,
            sequence=row.sequence,
            event_type=row.event_type,
            occurred_at=row.occurred_at,
            producer=row.producer,
            trace_id=row.trace_id,
            schema_version=row.schema_version,
            public_payload=row.public_payload,
            artifact_refs=tuple(row.artifact_refs),
            supersedes=row.supersedes,
        )

    # ----- Claims ---------------------------------------------------------------------

    def create_claim(
        self,
        *,
        run_id: str,
        text: str,
        claim_type: str,
        verification_level: str,
        status: str,
        explanation: str,
        evidence_links: list[dict[str, object]],
    ) -> ClaimView:
        with self.database.transaction() as session:
            existing = session.scalar(
                select(Claim).where(Claim.run_id == run_id, Claim.text == text)
            )
            if existing:
                ids = list(
                    session.scalars(
                        select(ClaimEvidenceLink.evidence_revision_id).where(
                            ClaimEvidenceLink.claim_id == existing.id
                        )
                    )
                )
                return ClaimView(
                    id=existing.id,
                    run_id=existing.run_id,
                    text=existing.text,
                    claim_type=existing.claim_type,
                    verification_level=existing.verification_level,
                    status=ClaimStatus(existing.status),
                    explanation=existing.explanation,
                    evidence_revision_ids=tuple(ids),
                )
            claim = Claim(
                run_id=run_id,
                text=text,
                claim_type=claim_type,
                verification_level=verification_level,
                status=status,
                explanation=explanation,
            )
            session.add(claim)
            session.flush()
            ids: list[str] = []
            for link in evidence_links:
                revision_id = str(link["evidence_revision_id"])
                ids.append(revision_id)
                session.add(
                    ClaimEvidenceLink(
                        claim_id=claim.id,
                        evidence_revision_id=revision_id,
                        relation=str(link.get("relation", "supports")),
                        support_score=float(link.get("support_score", 0.0)),
                        excerpt=str(link.get("excerpt", "")),
                    )
                )
            return ClaimView(
                id=claim.id,
                run_id=run_id,
                text=text,
                claim_type=claim_type,
                verification_level=verification_level,
                status=ClaimStatus(status),
                explanation=explanation,
                evidence_revision_ids=tuple(ids),
            )

    def list_claims(self, run_id: str) -> list[ClaimView]:
        with self.database.transaction() as session:
            claims = list(
                session.scalars(select(Claim).where(Claim.run_id == run_id).order_by(Claim.id))
            )
            links = list(
                session.scalars(
                    select(ClaimEvidenceLink).where(
                        ClaimEvidenceLink.claim_id.in_([claim.id for claim in claims])
                    )
                )
            )
            by_claim: dict[str, list[str]] = {}
            for link in links:
                by_claim.setdefault(link.claim_id, []).append(link.evidence_revision_id)
            return [
                ClaimView(
                    id=claim.id,
                    run_id=claim.run_id,
                    text=claim.text,
                    claim_type=claim.claim_type,
                    verification_level=claim.verification_level,
                    status=ClaimStatus(claim.status),
                    explanation=claim.explanation,
                    evidence_revision_ids=tuple(by_claim.get(claim.id, [])),
                )
                for claim in claims
            ]

    def list_space_knowledge_claims(
        self,
        space_id: str,
        *,
        status_filter: str,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[SpaceKnowledgeClaimView], str | None]:
        visible_statuses = {
            "all": (
                ClaimStatus.SUPPORTED.value,
                ClaimStatus.PARTIALLY_SUPPORTED.value,
                ClaimStatus.CONFLICTED.value,
                ClaimStatus.STALE.value,
            ),
            "supported": (ClaimStatus.SUPPORTED.value,),
            "attention": (
                ClaimStatus.PARTIALLY_SUPPORTED.value,
                ClaimStatus.CONFLICTED.value,
                ClaimStatus.STALE.value,
            ),
        }
        if status_filter not in visible_statuses:
            raise ValidationError(
                "Knowledge status filter must be all, supported, or attention"
            )
        with self.database.transaction() as session:
            statement = (
                select(Claim)
                .join(ClaimEvidenceLink, ClaimEvidenceLink.claim_id == Claim.id)
                .join(
                    EvidenceRevision,
                    EvidenceRevision.id == ClaimEvidenceLink.evidence_revision_id,
                )
                .join(
                    SourceSpaceLink,
                    SourceSpaceLink.source_id == EvidenceRevision.source_id,
                )
                .where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                    Claim.run_id.is_not(None),
                    Claim.verification_level.in_(("T2", "T3")),
                    Claim.status.in_(visible_statuses[status_filter]),
                )
                .distinct()
                .order_by(Claim.id.desc())
                .limit(limit + 1)
            )
            if cursor:
                statement = statement.where(Claim.id < cursor)
            claims = list(session.scalars(statement))
            has_more = len(claims) > limit
            claims = claims[:limit]
            claim_ids = [claim.id for claim in claims]
            references: dict[str, list[KnowledgeEvidenceReferenceView]] = {}
            if claim_ids:
                reference_rows = session.execute(
                    select(
                        ClaimEvidenceLink.claim_id,
                        ClaimEvidenceLink.relation,
                        ClaimEvidenceLink.support_score,
                        EvidenceRevision,
                        EvidenceLocator,
                        Source.display_name,
                    )
                    .join(
                        EvidenceRevision,
                        EvidenceRevision.id == ClaimEvidenceLink.evidence_revision_id,
                    )
                    .join(
                        EvidenceLocator,
                        EvidenceLocator.evidence_revision_id == EvidenceRevision.id,
                    )
                    .join(Source, Source.id == EvidenceRevision.source_id)
                    .where(ClaimEvidenceLink.claim_id.in_(claim_ids))
                    .order_by(ClaimEvidenceLink.claim_id, ClaimEvidenceLink.id)
                ).all()
                for claim_id, relation, score, evidence, locator, source_name in reference_rows:
                    references.setdefault(claim_id, []).append(
                        KnowledgeEvidenceReferenceView(
                            evidence_revision_id=evidence.id,
                            source_name=source_name,
                            modality=evidence.modality,
                            evidence_type=evidence.evidence_type,
                            locator_type=locator.locator_type,
                            relation=relation,
                            support_score=score,
                        )
                    )
            return [
                SpaceKnowledgeClaimView(
                    id=claim.id,
                    run_id=str(claim.run_id),
                    text=claim.text,
                    claim_type=claim.claim_type,
                    verification_level=claim.verification_level,
                    status=ClaimStatus(claim.status),
                    explanation=claim.explanation,
                    evidence=tuple(references.get(claim.id, [])),
                    created_at=claim.created_at,
                )
                for claim in claims
            ], (claims[-1].id if has_more and claims else None)

    # ----- Artifacts ------------------------------------------------------------------

    def create_artifact(
        self,
        *,
        run_id: str | None,
        title: str,
        artifact_type: str,
        canonical_document: dict[str, object],
        evidence_revision_ids: list[str],
    ) -> ArtifactView:
        with self.database.transaction() as session:
            if run_id:
                existing = session.scalar(
                    select(Artifact).where(
                        Artifact.run_id == run_id,
                        Artifact.artifact_type == artifact_type,
                    )
                )
                if existing and existing.current_revision_id:
                    existing_revision = session.get(ArtifactRevision, existing.current_revision_id)
                    if existing_revision:
                        return self._artifact_view(existing, existing_revision)
            artifact = Artifact(
                run_id=run_id,
                title=title,
                artifact_type=artifact_type,
                status="candidate",
            )
            session.add(artifact)
            session.flush()
            revision = ArtifactRevision(
                artifact_id=artifact.id,
                revision_no=1,
                canonical_document=canonical_document,
                evidence_revision_ids=evidence_revision_ids,
            )
            session.add(revision)
            session.flush()
            artifact.current_revision_id = revision.id
            return self._artifact_view(artifact, revision)

    def create_artifact_from_template(
        self,
        *,
        source_artifact_id: str,
        template_id: str,
        title: str,
        review_text: str | None = None,
    ) -> ArtifactView:
        template = get_artifact_template(template_id)
        if template is None:
            raise ValidationError(
                "Unknown Artifact template", details={"template_id": template_id}
            )
        normalized_title = title.strip()
        if not normalized_title:
            raise ValidationError("Artifact title is required")
        normalized_review = review_text.strip() if review_text else None
        if template.review_prompt and not normalized_review:
            raise ValidationError(
                "This Artifact template requires human review text",
                details={"template_id": template.id},
            )
        with self.database.transaction() as session:
            source = session.get(Artifact, source_artifact_id)
            if source is None or source.current_revision_id is None:
                raise NotFoundError(
                    "Source Artifact not found",
                    details={"source_artifact_id": source_artifact_id},
                )
            source_revision = session.get(ArtifactRevision, source.current_revision_id)
            if source_revision is None:
                raise ConflictError("Source Artifact current revision is missing")
            if source_revision.canonical_document.get("template"):
                raise ConflictError(
                    "Apply templates to the original source Artifact, not a derived layout"
                )
            pending_refresh_count = session.scalar(
                select(func.count(ArtifactRefreshProposal.id)).where(
                    ArtifactRefreshProposal.artifact_id == source.id,
                    ArtifactRefreshProposal.status == "pending",
                )
            ) or 0
            source_coverage = summarize_artifact_coverage(
                source_revision.canonical_document, source_revision.evidence_revision_ids
            )
            if pending_refresh_count:
                raise ConflictError(
                    "Resolve the source Artifact refresh before applying a template",
                    details={"pending_refresh_count": pending_refresh_count},
                )
            if (
                not source_revision.evidence_revision_ids
                or source_coverage.supported_block_count == 0
            ):
                raise ConflictError(
                    "Artifact templates require evidence-supported source content"
                )
            canonical_document = apply_artifact_template(
                template,
                source_artifact_id=source.id,
                source_document=source_revision.canonical_document,
                title=normalized_title,
                review_text=normalized_review,
            )
            artifact = Artifact(
                run_id=source.run_id,
                title=normalized_title[:512],
                artifact_type=template.artifact_type,
                status="candidate",
            )
            session.add(artifact)
            session.flush()
            revision = ArtifactRevision(
                artifact_id=artifact.id,
                revision_no=1,
                canonical_document=canonical_document,
                evidence_revision_ids=list(source_revision.evidence_revision_ids),
            )
            session.add(revision)
            session.flush()
            artifact.current_revision_id = revision.id
            return self._artifact_view(artifact, revision)

    def get_artifact(self, artifact_id: str) -> ArtifactView:
        with self.database.transaction() as session:
            artifact = session.get(Artifact, artifact_id)
            if artifact is None or artifact.current_revision_id is None:
                raise NotFoundError("Artifact not found", details={"artifact_id": artifact_id})
            revision = session.get(ArtifactRevision, artifact.current_revision_id)
            if revision is None:
                raise ConflictError("Artifact current revision is missing")
            pending_refresh_count = session.scalar(
                select(func.count(ArtifactRefreshProposal.id)).where(
                    ArtifactRefreshProposal.artifact_id == artifact.id,
                    ArtifactRefreshProposal.status == "pending",
                )
            ) or 0
            return self._artifact_view(
                artifact, revision, pending_refresh_count=pending_refresh_count
            )

    def set_artifact_status(
        self, artifact_id: str, *, status: str, expected_revision_no: int
    ) -> ArtifactView:
        if status not in {"candidate", "published"}:
            raise ValidationError("Artifact status must be candidate or published")
        with self.database.transaction() as session:
            artifact = session.get(Artifact, artifact_id, with_for_update=True)
            if artifact is None or artifact.current_revision_id is None:
                raise NotFoundError("Artifact not found", details={"artifact_id": artifact_id})
            revision = session.get(ArtifactRevision, artifact.current_revision_id)
            if revision is None:
                raise ConflictError("Artifact current revision is missing")
            if revision.revision_no != expected_revision_no:
                raise ConflictError(
                    "Artifact revision changed before its publication status was updated",
                    details={
                        "expected_revision_no": expected_revision_no,
                        "current_revision_no": revision.revision_no,
                    },
                )
            pending_refresh_count = session.scalar(
                select(func.count(ArtifactRefreshProposal.id)).where(
                    ArtifactRefreshProposal.artifact_id == artifact.id,
                    ArtifactRefreshProposal.status == "pending",
                )
            ) or 0
            if status == "published":
                coverage = summarize_artifact_coverage(
                    revision.canonical_document, revision.evidence_revision_ids
                )
                if pending_refresh_count:
                    raise ConflictError(
                        "Resolve pending source refreshes before publishing",
                        details={"pending_refresh_count": pending_refresh_count},
                    )
                if not revision.evidence_revision_ids or coverage.supported_block_count == 0:
                    raise ConflictError(
                        "Artifact publication requires at least one "
                        "evidence-supported content block",
                        details={"coverage_percent": coverage.coverage_percent},
                    )
            artifact.status = status
            session.flush()
            return self._artifact_view(
                artifact, revision, pending_refresh_count=pending_refresh_count
            )

    def revise_artifact(
        self,
        artifact_id: str,
        *,
        canonical_document: dict[str, object],
        expected_revision_no: int,
    ) -> ArtifactView:
        if canonical_document.get("schema") != "nexus.block-document.v1":
            raise ConflictError("Artifact revision must preserve the canonical document schema")
        with self.database.transaction() as session:
            artifact = session.get(Artifact, artifact_id, with_for_update=True)
            if artifact is None or artifact.current_revision_id is None:
                raise NotFoundError("Artifact not found", details={"artifact_id": artifact_id})
            current = session.get(ArtifactRevision, artifact.current_revision_id)
            if current is None:
                raise ConflictError("Artifact current revision is missing")
            if current.revision_no != expected_revision_no:
                raise ConflictError(
                    "Artifact revision changed while it was being edited",
                    details={
                        "expected_revision_no": expected_revision_no,
                        "current_revision_no": current.revision_no,
                    },
                )
            revision = ArtifactRevision(
                artifact_id=artifact.id,
                revision_no=current.revision_no + 1,
                canonical_document=canonical_document,
                # User edits cannot silently rebind citations to newer Evidence.
                evidence_revision_ids=list(current.evidence_revision_ids),
                author_type="user",
            )
            session.add(revision)
            session.flush()
            artifact.current_revision_id = revision.id
            artifact.title = str(canonical_document.get("title") or artifact.title)[:512]
            artifact.status = "candidate"
            return self._artifact_view(artifact, revision)

    def list_artifacts(
        self, *, cursor: str | None, limit: int
    ) -> tuple[list[ArtifactView], str | None]:
        with self.database.transaction() as session:
            statement = select(Artifact).order_by(Artifact.id.desc()).limit(limit + 1)
            if cursor:
                statement = statement.where(Artifact.id < cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            revision_ids = [
                artifact.current_revision_id for artifact in rows if artifact.current_revision_id
            ]
            revisions = {
                revision.id: revision
                for revision in session.scalars(
                    select(ArtifactRevision).where(ArtifactRevision.id.in_(revision_ids))
                )
            }
            pending_by_artifact = dict(
                session.execute(
                    select(
                        ArtifactRefreshProposal.artifact_id,
                        func.count(ArtifactRefreshProposal.id),
                    )
                    .where(
                        ArtifactRefreshProposal.artifact_id.in_([item.id for item in rows]),
                        ArtifactRefreshProposal.status == "pending",
                    )
                    .group_by(ArtifactRefreshProposal.artifact_id)
                ).all()
            )
            result = [
                self._artifact_view(
                    artifact,
                    revisions[artifact.current_revision_id],
                    pending_refresh_count=int(pending_by_artifact.get(artifact.id, 0)),
                )
                for artifact in rows
                if artifact.current_revision_id in revisions
            ]
            return result, rows[-1].id if has_more and rows else None

    def list_artifact_refresh_proposals(
        self, artifact_id: str
    ) -> list[ArtifactRefreshProposalView]:
        with self.database.transaction() as session:
            if session.get(Artifact, artifact_id) is None:
                raise NotFoundError("Artifact not found", details={"artifact_id": artifact_id})
            rows = list(
                session.scalars(
                    select(ArtifactRefreshProposal)
                    .where(ArtifactRefreshProposal.artifact_id == artifact_id)
                    .order_by(ArtifactRefreshProposal.created_at.desc())
                )
            )
            return [self._refresh_proposal_view(row) for row in rows]

    def resolve_artifact_refresh_proposal(
        self, proposal_id: str, *, accept: bool
    ) -> ArtifactRefreshProposalView:
        with self.database.transaction() as session:
            proposal = session.get(ArtifactRefreshProposal, proposal_id, with_for_update=True)
            if proposal is None:
                raise NotFoundError(
                    "Artifact refresh proposal not found", details={"proposal_id": proposal_id}
                )
            if proposal.status != "pending":
                return self._refresh_proposal_view(proposal)
            artifact = session.get(Artifact, proposal.artifact_id, with_for_update=True)
            if artifact is None or artifact.current_revision_id is None:
                raise ConflictError("Artifact refresh target is unavailable")
            if artifact.current_revision_id != proposal.base_revision_id:
                proposal.status = "superseded"
                proposal.resolved_at = datetime.now(UTC)
                raise ConflictError(
                    "Artifact changed after this refresh proposal was generated",
                    details={
                        "base_revision_id": proposal.base_revision_id,
                        "current_revision_id": artifact.current_revision_id,
                    },
                )
            if accept:
                current = session.get(ArtifactRevision, artifact.current_revision_id)
                if current is None:
                    raise ConflictError("Artifact current revision is missing")
                revision = ArtifactRevision(
                    artifact_id=artifact.id,
                    revision_no=current.revision_no + 1,
                    canonical_document=proposal.proposed_document,
                    evidence_revision_ids=proposal.proposed_evidence_revision_ids,
                    author_type="refresh",
                )
                session.add(revision)
                session.flush()
                artifact.current_revision_id = revision.id
                artifact.status = "candidate"
                proposal.status = "accepted"
            else:
                artifact.status = "candidate"
                proposal.status = "rejected"
            proposal.resolved_at = datetime.now(UTC)
            session.flush()
            return self._refresh_proposal_view(proposal)

    @staticmethod
    def _artifact_view(
        artifact: Artifact,
        revision: ArtifactRevision,
        *,
        pending_refresh_count: int = 0,
    ) -> ArtifactView:
        return ArtifactView(
            id=artifact.id,
            run_id=artifact.run_id,
            title=artifact.title,
            artifact_type=artifact.artifact_type,
            status=artifact.status,
            revision_id=revision.id,
            revision_no=revision.revision_no,
            canonical_document=revision.canonical_document,
            evidence_revision_ids=tuple(revision.evidence_revision_ids),
            coverage=summarize_artifact_coverage(
                revision.canonical_document, revision.evidence_revision_ids
            ),
            pending_refresh_count=pending_refresh_count,
            created_at=artifact.created_at,
            updated_at=artifact.updated_at,
        )

    @staticmethod
    def _refresh_proposal_view(
        proposal: ArtifactRefreshProposal,
    ) -> ArtifactRefreshProposalView:
        return ArtifactRefreshProposalView(
            id=proposal.id,
            artifact_id=proposal.artifact_id,
            base_revision_id=proposal.base_revision_id,
            status=proposal.status,
            reason=proposal.reason,
            impacted_evidence_revision_ids=tuple(proposal.impacted_evidence_revision_ids),
            proposed_document=proposal.proposed_document,
            proposed_evidence_revision_ids=tuple(proposal.proposed_evidence_revision_ids),
            diff=proposal.diff,
            created_at=proposal.created_at,
            resolved_at=proposal.resolved_at,
        )
