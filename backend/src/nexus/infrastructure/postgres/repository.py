from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import (
    Artifact,
    ArtifactRefreshProposal,
    ArtifactRevision,
    CapabilityReadiness,
    Claim,
    ClaimEvidenceLink,
    Collection,
    CollectionRule,
    CollectionSourceLink,
    ContentUnit,
    EvidenceAsset,
    EvidenceLocator,
    EvidenceRevision,
    IdempotencyRecord,
    IndexRelease,
    IngestionJob,
    JobEvent,
    ObjectManifest,
    OutboxEvent,
    ProjectionItem,
    PublishCounter,
    Source,
    SourceSpaceLink,
    SourceSyncExecution,
    SourceSyncSchedule,
    SourceVersion,
    Space,
    StreamCounter,
)
from nexus.modules.evidence.domain import EvidenceDraft, EvidenceView, Locator
from nexus.modules.sources.domain import (
    IngestionJobEventView,
    IngestionJobView,
    IngestionLease,
    RawSourceCommand,
    SourceIngestionSummaryView,
    SourceProjectionView,
    SourceSyncExecutionView,
    SourceSyncScheduleView,
    SourceSyncView,
    SourceVersionView,
)
from nexus.modules.sources.health import assess_source_health
from nexus.modules.spaces.domain import CollectionRuleView, CollectionView, SpaceView
from nexus.modules.spaces.policy import policy_for
from nexus.shared.domain.enums import (
    CapabilityStatus,
    EvidenceStatus,
    KnowledgeProfile,
    Modality,
    QualityMode,
    SourceStatus,
)
from nexus.shared.domain.errors import ConflictError, NotFoundError


def _stable_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class _SourceViewContext:
    links_by_source: dict[str, tuple[str, ...]]
    capabilities_by_version: dict[str, tuple[CapabilityReadiness, ...]]
    sources_by_id: dict[str, Source]
    evidence_counts: dict[str, int]
    derived_image_counts: dict[str, int]
    cover_evidence_ids: dict[str, str]
    latest_jobs: dict[str, IngestionJob]
    schedules_by_source: dict[str, tuple[SourceSyncSchedule, ...]]
    active_release: IndexRelease | None
    latest_release: IndexRelease | None
    active_projection_counts: dict[str, int]


class SqlControlPlaneRepository:
    """PostgreSQL is authoritative; this adapter also supports SQLite contract tests."""

    def __init__(self, database: Database) -> None:
        self.database = database

    # ----- shared transaction helpers -------------------------------------------------

    @staticmethod
    def _allocate_publish_sequence(session: Session) -> int:
        counter = session.get(PublishCounter, 1, with_for_update=True)
        if counter is None:
            counter = PublishCounter(singleton=1, sequence=0)
            session.add(counter)
            session.flush()
        counter.sequence += 1
        session.flush()
        return counter.sequence

    @staticmethod
    def _allocate_stream_sequence(session: Session, stream_id: str) -> int:
        counter = session.get(StreamCounter, stream_id, with_for_update=True)
        if counter is None:
            counter = StreamCounter(stream_id=stream_id, sequence=0)
            session.add(counter)
            session.flush()
        counter.sequence += 1
        session.flush()
        return counter.sequence

    @staticmethod
    def _outbox(
        session: Session,
        *,
        aggregate_type: str,
        aggregate_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        session.add(
            OutboxEvent(
                aggregate_type=aggregate_type,
                aggregate_id=aggregate_id,
                event_type=event_type,
                payload=payload,
            )
        )

    @classmethod
    def _job_event(
        cls, session: Session, job_id: str, event_type: str, payload: dict[str, Any]
    ) -> None:
        sequence = cls._allocate_stream_sequence(session, job_id)
        session.add(
            JobEvent(job_id=job_id, sequence=sequence, event_type=event_type, payload=payload)
        )

    @staticmethod
    def _lookup_idempotency(
        session: Session, *, scope: str, key: str | None, request_hash: str
    ) -> IdempotencyRecord | None:
        if not key:
            return None
        record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.scope == scope, IdempotencyRecord.key == key
            )
        )
        if record and record.request_hash != request_hash:
            raise ConflictError(
                "Idempotency key was already used with a different payload",
                details={"scope": scope, "key": key},
            )
        return record

    # ----- spaces --------------------------------------------------------------------

    def create_space(
        self,
        *,
        name: str,
        slug: str,
        description: str,
        knowledge_profile: KnowledgeProfile,
        default_quality: QualityMode,
        idempotency_key: str | None,
    ) -> SpaceView:
        request_hash = _stable_hash(
            {
                "name": name,
                "slug": slug,
                "description": description,
                "knowledge_profile": knowledge_profile.value,
                "default_quality": default_quality.value,
            }
        )
        try:
            with self.database.transaction() as session:
                existing = self._lookup_idempotency(
                    session,
                    scope="spaces.create",
                    key=idempotency_key,
                    request_hash=request_hash,
                )
                if existing:
                    row = session.get(Space, existing.resource_id)
                    if row is None:
                        raise ConflictError("Idempotency record points to a missing Space")
                    return self._space_view(session, row)
                row = Space(
                    name=name,
                    slug=slug,
                    description=description,
                    knowledge_profile=knowledge_profile.value,
                    default_quality=default_quality.value,
                )
                session.add(row)
                session.flush()
                self._outbox(
                    session,
                    aggregate_type="space",
                    aggregate_id=row.id,
                    event_type="space.created",
                    payload={"space_id": row.id},
                )
                if idempotency_key:
                    session.add(
                        IdempotencyRecord(
                            scope="spaces.create",
                            key=idempotency_key,
                            request_hash=request_hash,
                            resource_type="space",
                            resource_id=row.id,
                            response_payload={"space_id": row.id},
                        )
                    )
                return self._space_view(session, row)
        except IntegrityError as exc:
            raise ConflictError("A Space with this slug already exists") from exc

    def list_spaces(self, *, cursor: str | None, limit: int) -> tuple[list[SpaceView], str | None]:
        with self.database.transaction() as session:
            statement = (
                select(Space).where(Space.archived.is_(False)).order_by(Space.id).limit(limit + 1)
            )
            if cursor:
                statement = statement.where(Space.id > cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            views = [self._space_view(session, row) for row in rows]
            return views, rows[-1].id if has_more and rows else None

    def get_space(self, space_id: str) -> SpaceView:
        with self.database.transaction() as session:
            row = session.get(Space, space_id)
            if row is None or row.archived:
                raise NotFoundError("Space not found", details={"space_id": space_id})
            return self._space_view(session, row)

    def archive_space(self, space_id: str) -> SpaceView:
        with self.database.transaction() as session:
            row = session.get(Space, space_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Space not found", details={"space_id": space_id})
            if row.archived:
                return self._space_view(session, row)
            sequence = self._allocate_publish_sequence(session)
            row.archived = True
            row.revision += 1
            links = session.scalars(
                select(SourceSpaceLink).where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            )
            for link in links:
                link.valid_to_sequence = sequence
            self._outbox(
                session,
                aggregate_type="space",
                aggregate_id=space_id,
                event_type="space.archived",
                payload={"space_id": space_id, "sequence": sequence},
            )
            session.flush()
            return self._space_view(session, row)

    @staticmethod
    def _space_view(session: Session, row: Space) -> SpaceView:
        source_count = (
            session.scalar(
                select(func.count(SourceSpaceLink.id)).where(
                    SourceSpaceLink.space_id == row.id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            )
            or 0
        )
        cover = session.execute(
            select(SourceVersion.id, Source.display_name)
            .select_from(SourceSpaceLink)
            .join(Source, Source.id == SourceSpaceLink.source_id)
            .join(SourceVersion, SourceVersion.id == Source.current_version_id)
            .where(
                SourceSpaceLink.space_id == row.id,
                SourceSpaceLink.valid_to_sequence.is_(None),
                Source.tombstoned_at.is_(None),
                SourceVersion.visible_until_sequence.is_(None),
                SourceVersion.modality == Modality.IMAGE.value,
            )
            .order_by(SourceVersion.created_at.desc())
            .limit(1)
        ).first()
        evidence_cover = session.execute(
            select(EvidenceRevision.id, Source.display_name)
            .select_from(SourceSpaceLink)
            .join(Source, Source.id == SourceSpaceLink.source_id)
            .join(SourceVersion, SourceVersion.id == Source.current_version_id)
            .join(
                EvidenceRevision,
                EvidenceRevision.source_version_id == SourceVersion.id,
            )
            .where(
                SourceSpaceLink.space_id == row.id,
                SourceSpaceLink.valid_to_sequence.is_(None),
                Source.tombstoned_at.is_(None),
                SourceVersion.visible_until_sequence.is_(None),
                EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                EvidenceRevision.modality == Modality.IMAGE.value,
            )
            .order_by(SourceVersion.created_at.desc(), EvidenceRevision.id)
            .limit(1)
        ).first()
        distribution = session.execute(
            select(
                SourceVersion.modality,
                SourceVersion.status,
                func.count(SourceVersion.id),
            )
            .select_from(SourceSpaceLink)
            .join(Source, Source.id == SourceSpaceLink.source_id)
            .join(SourceVersion, SourceVersion.id == Source.current_version_id)
            .where(
                SourceSpaceLink.space_id == row.id,
                SourceSpaceLink.valid_to_sequence.is_(None),
                Source.tombstoned_at.is_(None),
                SourceVersion.visible_until_sequence.is_(None),
            )
            .group_by(SourceVersion.modality, SourceVersion.status)
        ).all()
        modality_counts: dict[str, int] = {}
        status_counts: dict[str, int] = {}
        for modality, status, count in distribution:
            modality_counts[str(modality)] = modality_counts.get(str(modality), 0) + int(count)
            status_counts[str(status)] = status_counts.get(str(status), 0) + int(count)
        evidence_distribution = session.execute(
            select(EvidenceRevision.modality, func.count(EvidenceRevision.id))
            .select_from(SourceSpaceLink)
            .join(Source, Source.id == SourceSpaceLink.source_id)
            .join(SourceVersion, SourceVersion.id == Source.current_version_id)
            .join(
                EvidenceRevision,
                EvidenceRevision.source_version_id == SourceVersion.id,
            )
            .where(
                SourceSpaceLink.space_id == row.id,
                SourceSpaceLink.valid_to_sequence.is_(None),
                Source.tombstoned_at.is_(None),
                SourceVersion.visible_until_sequence.is_(None),
                EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
            )
            .group_by(EvidenceRevision.modality)
        ).all()
        return SpaceView(
            id=row.id,
            slug=row.slug,
            name=row.name,
            description=row.description,
            knowledge_profile=KnowledgeProfile(row.knowledge_profile),
            default_quality=QualityMode(row.default_quality),
            policy=policy_for(
                KnowledgeProfile(row.knowledge_profile),
                default_quality=QualityMode(row.default_quality),
            ),
            archived=row.archived,
            revision=row.revision,
            created_at=row.created_at,
            updated_at=row.updated_at,
            source_count=source_count,
            modality_counts=modality_counts,
            evidence_modality_counts={
                str(modality): int(count) for modality, count in evidence_distribution
            },
            status_counts=status_counts,
            cover_source_version_id=cover[0] if cover else None,
            cover_evidence_id=evidence_cover[0] if evidence_cover else None,
            cover_source_name=(
                evidence_cover[1]
                if evidence_cover
                else cover[1]
                if cover
                else None
            ),
        )

    # ----- saved Collections / Views -------------------------------------------------

    def create_collection(
        self,
        *,
        space_id: str,
        name: str,
        description: str,
        color: str,
        view_kind: str,
        rule_logic: str,
        source_ids: tuple[str, ...],
        rules: tuple[dict[str, object], ...],
    ) -> CollectionView:
        try:
            with self.database.transaction() as session:
                space = session.get(Space, space_id)
                if space is None or space.archived:
                    raise NotFoundError("Space not found", details={"space_id": space_id})
                self._assert_sources_in_space(session, space_id, source_ids)
                row = Collection(
                    space_id=space_id,
                    name=name,
                    description=description,
                    color=color,
                    view_kind=view_kind,
                    rule_logic=rule_logic,
                )
                session.add(row)
                session.flush()
                self._replace_collection_membership(session, row, source_ids, rules)
                self._outbox(
                    session,
                    aggregate_type="collection",
                    aggregate_id=row.id,
                    event_type="collection.created",
                    payload={"collection_id": row.id, "space_id": space_id},
                )
                return self._collection_view(session, row)
        except IntegrityError as exc:
            raise ConflictError("A Collection with this name already exists in the Space") from exc

    def list_collections(self, *, space_id: str) -> list[CollectionView]:
        with self.database.transaction() as session:
            space = session.get(Space, space_id)
            if space is None or space.archived:
                raise NotFoundError("Space not found", details={"space_id": space_id})
            rows = list(
                session.scalars(
                    select(Collection)
                    .where(Collection.space_id == space_id, Collection.archived.is_(False))
                    .order_by(Collection.updated_at.desc(), Collection.id)
                )
            )
            return [self._collection_view(session, row) for row in rows]

    def get_collection(self, collection_id: str) -> CollectionView:
        with self.database.transaction() as session:
            row = session.get(Collection, collection_id)
            if row is None or row.archived:
                raise NotFoundError(
                    "Collection not found", details={"collection_id": collection_id}
                )
            return self._collection_view(session, row)

    def update_collection(
        self,
        collection_id: str,
        *,
        name: str | None,
        description: str | None,
        color: str | None,
        rule_logic: str | None,
        source_ids: tuple[str, ...] | None,
        rules: tuple[dict[str, object], ...] | None,
        expected_revision: int | None,
    ) -> CollectionView:
        try:
            with self.database.transaction() as session:
                row = session.get(Collection, collection_id, with_for_update=True)
                if row is None or row.archived:
                    raise NotFoundError(
                        "Collection not found", details={"collection_id": collection_id}
                    )
                if expected_revision is not None and expected_revision != row.revision:
                    raise ConflictError(
                        "Collection was changed by another request",
                        details={"expected": expected_revision, "actual": row.revision},
                    )
                if name is not None:
                    row.name = name
                if description is not None:
                    row.description = description
                if color is not None:
                    row.color = color
                if rule_logic is not None:
                    row.rule_logic = rule_logic
                if source_ids is not None:
                    self._assert_sources_in_space(session, row.space_id, source_ids)
                if source_ids is not None or rules is not None:
                    current_source_ids = self._manual_collection_source_ids(session, row)
                    current_rules = tuple(
                        {
                            "field": item.field,
                            "operator": item.operator,
                            "value": item.value,
                        }
                        for item in session.scalars(
                            select(CollectionRule)
                            .where(CollectionRule.collection_id == row.id)
                            .order_by(CollectionRule.position, CollectionRule.id)
                        )
                    )
                    self._replace_collection_membership(
                        session,
                        row,
                        source_ids if source_ids is not None else current_source_ids,
                        rules if rules is not None else current_rules,
                    )
                row.revision += 1
                self._outbox(
                    session,
                    aggregate_type="collection",
                    aggregate_id=row.id,
                    event_type="collection.updated",
                    payload={"collection_id": row.id, "revision": row.revision},
                )
                session.flush()
                return self._collection_view(session, row)
        except IntegrityError as exc:
            raise ConflictError("A Collection with this name already exists in the Space") from exc

    def archive_collection(self, collection_id: str) -> CollectionView:
        with self.database.transaction() as session:
            row = session.get(Collection, collection_id, with_for_update=True)
            if row is None:
                raise NotFoundError(
                    "Collection not found", details={"collection_id": collection_id}
                )
            if not row.archived:
                row.archived = True
                row.revision += 1
                self._outbox(
                    session,
                    aggregate_type="collection",
                    aggregate_id=row.id,
                    event_type="collection.archived",
                    payload={"collection_id": row.id},
                )
                session.flush()
            return self._collection_view(session, row)

    def resolve_collection_source_ids(self, collection_ids: tuple[str, ...]) -> tuple[str, ...]:
        with self.database.transaction() as session:
            resolved: set[str] = set()
            for collection_id in collection_ids:
                row = session.get(Collection, collection_id)
                if row is None or row.archived:
                    raise NotFoundError(
                        "Collection not found", details={"collection_id": collection_id}
                    )
                resolved.update(self._collection_source_ids(session, row))
            return tuple(sorted(resolved))

    @staticmethod
    def _assert_sources_in_space(
        session: Session, space_id: str, source_ids: tuple[str, ...]
    ) -> None:
        if not source_ids:
            return
        available = set(
            session.scalars(
                select(SourceSpaceLink.source_id).where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.source_id.in_(source_ids),
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            )
        )
        missing = sorted(set(source_ids) - available)
        if missing:
            raise NotFoundError(
                "Collection Sources must belong to its Space",
                details={"space_id": space_id, "source_ids": missing},
            )

    @staticmethod
    def _replace_collection_membership(
        session: Session,
        row: Collection,
        source_ids: tuple[str, ...],
        rules: tuple[dict[str, object], ...],
    ) -> None:
        for link in list(
            session.scalars(
                select(CollectionSourceLink).where(
                    CollectionSourceLink.collection_id == row.id
                )
            )
        ):
            session.delete(link)
        for rule_row in list(
            session.scalars(
                select(CollectionRule).where(CollectionRule.collection_id == row.id)
            )
        ):
            session.delete(rule_row)
        session.flush()
        for source_id in source_ids:
            session.add(CollectionSourceLink(collection_id=row.id, source_id=source_id))
        for position, rule in enumerate(rules):
            session.add(
                CollectionRule(
                    collection_id=row.id,
                    field=str(rule["field"]),
                    operator=str(rule["operator"]),
                    value=rule.get("value"),
                    position=position,
                )
            )
        session.flush()

    @classmethod
    def _manual_collection_source_ids(
        cls, session: Session, row: Collection
    ) -> tuple[str, ...]:
        manual_ids = set(
            session.scalars(
                select(CollectionSourceLink.source_id)
                .join(Source, Source.id == CollectionSourceLink.source_id)
                .join(
                    SourceSpaceLink,
                    (SourceSpaceLink.source_id == CollectionSourceLink.source_id)
                    & (SourceSpaceLink.space_id == row.space_id),
                )
                .where(
                    CollectionSourceLink.collection_id == row.id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                    Source.tombstoned_at.is_(None),
                )
                .distinct()
            )
        )
        return tuple(sorted(manual_ids))

    @classmethod
    def _collection_source_ids(cls, session: Session, row: Collection) -> tuple[str, ...]:
        manual_ids = set(cls._manual_collection_source_ids(session, row))
        if row.view_kind == "manual":
            return tuple(sorted(manual_ids))
        rules = list(
            session.scalars(
                select(CollectionRule)
                .where(CollectionRule.collection_id == row.id)
                .order_by(CollectionRule.position, CollectionRule.id)
            )
        )
        if not rules:
            return tuple(sorted(manual_ids))
        candidates = session.execute(
            select(Source, SourceVersion)
            .select_from(SourceSpaceLink)
            .join(Source, Source.id == SourceSpaceLink.source_id)
            .join(SourceVersion, SourceVersion.id == Source.current_version_id)
            .where(
                SourceSpaceLink.space_id == row.space_id,
                SourceSpaceLink.valid_to_sequence.is_(None),
                Source.tombstoned_at.is_(None),
                SourceVersion.visible_until_sequence.is_(None),
            )
        ).all()

        def matches(source: Source, version: SourceVersion, rule: CollectionRule) -> bool:
            values: dict[str, object] = {
                "display_name": source.display_name,
                "modality": version.modality,
                "mime_type": version.mime_type,
                "connector_kind": source.kind,
                "status": version.status,
            }
            actual = str(values[rule.field]).casefold()
            expected = rule.value
            if rule.operator == "contains":
                return str(expected).casefold() in actual
            if rule.operator == "in":
                candidates_value = expected if isinstance(expected, list) else [expected]
                return actual in {str(item).casefold() for item in candidates_value}
            return actual == str(expected).casefold()

        dynamic_ids = {
            source.id
            for source, version in candidates
            if (all(matches(source, version, rule) for rule in rules)
                if row.rule_logic == "all"
                else any(matches(source, version, rule) for rule in rules))
        }
        return tuple(sorted(manual_ids | dynamic_ids))

    @classmethod
    def _collection_view(cls, session: Session, row: Collection) -> CollectionView:
        source_ids = cls._collection_source_ids(session, row)
        rules = tuple(
            CollectionRuleView(
                id=item.id,
                field=item.field,
                operator=item.operator,
                value=item.value,
                position=item.position,
            )
            for item in session.scalars(
                select(CollectionRule)
                .where(CollectionRule.collection_id == row.id)
                .order_by(CollectionRule.position, CollectionRule.id)
            )
        )
        modality_counts: dict[str, int] = {}
        cover = None
        evidence_cover = None
        if source_ids:
            distribution = session.execute(
                select(SourceVersion.modality, func.count(SourceVersion.id))
                .join(Source, Source.id == SourceVersion.source_id)
                .where(
                    Source.id.in_(source_ids),
                    Source.current_version_id == SourceVersion.id,
                    Source.tombstoned_at.is_(None),
                )
                .group_by(SourceVersion.modality)
            ).all()
            modality_counts = {str(modality): int(count) for modality, count in distribution}
            cover = session.execute(
                select(SourceVersion.id, Source.display_name)
                .join(Source, Source.id == SourceVersion.source_id)
                .where(
                    Source.id.in_(source_ids),
                    Source.current_version_id == SourceVersion.id,
                    SourceVersion.modality == Modality.IMAGE.value,
                )
                .order_by(SourceVersion.created_at.desc())
                .limit(1)
            ).first()
            evidence_cover = session.execute(
                select(EvidenceRevision.id, Source.display_name)
                .join(Source, Source.id == EvidenceRevision.source_id)
                .where(
                    EvidenceRevision.source_id.in_(source_ids),
                    EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    EvidenceRevision.modality == Modality.IMAGE.value,
                )
                .order_by(EvidenceRevision.created_at.desc())
                .limit(1)
            ).first()
        return CollectionView(
            id=row.id,
            space_id=row.space_id,
            name=row.name,
            description=row.description,
            color=row.color,
            view_kind=row.view_kind,
            rule_logic=row.rule_logic,
            archived=row.archived,
            revision=row.revision,
            source_ids=source_ids,
            source_count=len(source_ids),
            rules=rules,
            modality_counts=modality_counts,
            cover_source_version_id=cover[0] if cover else None,
            cover_evidence_id=evidence_cover[0] if evidence_cover else None,
            cover_source_name=(
                evidence_cover[1] if evidence_cover else cover[1] if cover else None
            ),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    # ----- source/evidence ingestion --------------------------------------------------

    def create_raw_source(
        self, command: RawSourceCommand
    ) -> tuple[SourceVersionView, IngestionJobView]:
        request_hash = _stable_hash(
            {
                "space_id": command.space_id,
                "filename": command.filename,
                "content_hash": command.content_hash,
                "mime_type": command.mime_type,
                "source_id": command.source_id,
                "connector_kind": command.connector_kind,
                "canonical_uri": command.canonical_uri,
                "external_version": command.external_version,
            }
        )
        with self.database.transaction() as session:
            space = session.get(Space, command.space_id)
            if space is None or space.archived:
                raise NotFoundError("Space not found", details={"space_id": command.space_id})
            existing = self._lookup_idempotency(
                session,
                scope="sources.upload",
                key=command.idempotency_key,
                request_hash=request_hash,
            )
            if existing:
                job = session.get(IngestionJob, existing.resource_id)
                if job is None:
                    raise ConflictError("Idempotency record points to a missing ingestion job")
                version = session.get(SourceVersion, job.source_version_id)
                if version is None:
                    raise ConflictError("Ingestion job points to a missing source version")
                return self._source_view(session, version), self._job_view(session, job)

            source = session.get(Source, command.source_id) if command.source_id else None
            if command.source_id and source is None:
                raise NotFoundError("Source not found", details={"source_id": command.source_id})
            if source is None and command.canonical_uri:
                source = session.scalar(
                    select(Source).where(
                        Source.kind == command.connector_kind,
                        Source.canonical_uri == command.canonical_uri,
                        Source.tombstoned_at.is_(None),
                    )
                )
            if source is None:
                source = Source(
                    kind=command.connector_kind,
                    display_name=command.filename,
                    canonical_uri=command.canonical_uri,
                    status=SourceStatus.DISCOVERED.value,
                )
                session.add(source)
                session.flush()

            duplicate = session.scalar(
                select(SourceVersion).where(
                    SourceVersion.source_id == source.id,
                    SourceVersion.content_hash == command.content_hash,
                )
            )
            if duplicate is not None:
                existing_job = session.scalar(
                    select(IngestionJob).where(IngestionJob.source_version_id == duplicate.id)
                )
                if existing_job is None:
                    raise ConflictError("Duplicate source version has no ingestion job")
                self._ensure_space_link(session, command.space_id, source.id)
                return self._source_view(session, duplicate), self._job_view(session, existing_job)

            version_no = (
                session.scalar(
                    select(func.max(SourceVersion.version_no)).where(
                        SourceVersion.source_id == source.id
                    )
                )
                or 0
            ) + 1
            sequence = self._allocate_publish_sequence(session)
            version = SourceVersion(
                source_id=source.id,
                version_no=version_no,
                content_hash=command.content_hash,
                mime_type=command.mime_type,
                byte_size=command.byte_size,
                object_key=command.object_key,
                status=SourceStatus.STORED.value,
                modality=command.modality.value,
                external_version=command.external_version,
                parser_manifest={"connector": command.metadata},
                visible_from_sequence=sequence,
            )
            session.add(version)
            session.flush()
            source.status = SourceStatus.STORED.value
            source.current_version_id = version.id
            source.revision += 1
            session.add(
                ObjectManifest(
                    source_version_id=version.id,
                    role="raw",
                    object_key=command.object_key,
                    content_hash=command.content_hash,
                    mime_type=command.mime_type,
                    byte_size=command.byte_size,
                )
            )
            self._ensure_space_link(session, command.space_id, source.id, sequence=sequence)
            job = IngestionJob(
                source_version_id=version.id,
                status="pending",
                stage="raw_stored",
                input_hash=command.content_hash,
            )
            session.add(job)
            session.flush()
            self._job_event(
                session,
                job.id,
                "ingestion.raw.stored",
                {"source_id": source.id, "source_version_id": version.id},
            )
            self._outbox(
                session,
                aggregate_type="ingestion_job",
                aggregate_id=job.id,
                event_type="ingestion.requested",
                payload={"job_id": job.id, "source_version_id": version.id},
            )
            if command.idempotency_key:
                session.add(
                    IdempotencyRecord(
                        scope="sources.upload",
                        key=command.idempotency_key,
                        request_hash=request_hash,
                        resource_type="ingestion_job",
                        resource_id=job.id,
                        response_payload={"source_version_id": version.id},
                    )
                )
            session.flush()
            return self._source_view(session, version), self._job_view(session, job)

    def _ensure_space_link(
        self, session: Session, space_id: str, source_id: str, *, sequence: int | None = None
    ) -> None:
        existing = session.scalar(
            select(SourceSpaceLink).where(
                SourceSpaceLink.space_id == space_id,
                SourceSpaceLink.source_id == source_id,
                SourceSpaceLink.valid_to_sequence.is_(None),
            )
        )
        if existing is None:
            session.add(
                SourceSpaceLink(
                    space_id=space_id,
                    source_id=source_id,
                    valid_from_sequence=sequence or self._allocate_publish_sequence(session),
                )
            )
            session.flush()

    def get_source_version(self, source_version_id: str) -> SourceVersionView:
        with self.database.transaction() as session:
            row = session.get(SourceVersion, source_version_id)
            if row is None:
                raise NotFoundError(
                    "Source version not found", details={"source_version_id": source_version_id}
                )
            return self._source_view(session, row)

    def get_source_sync_contract(
        self,
        *,
        space_id: str,
        source_id: str,
    ) -> dict[str, object]:
        with self.database.transaction() as session:
            source = session.get(Source, source_id)
            link = session.scalar(
                select(SourceSpaceLink).where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.source_id == source_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            )
            if source is None or link is None or not source.current_version_id:
                raise NotFoundError(
                    "Source is not linked to this Space",
                    details={"space_id": space_id, "source_id": source_id},
                )
            version = session.get(SourceVersion, source.current_version_id)
            connector = (version.parser_manifest or {}).get("connector", {}) if version else {}
            contract = connector.get("sync_contract") if isinstance(connector, dict) else None
            refreshable = {"url", "rss", "folder", "git", "news", "image_search"}
            if (
                not isinstance(contract, dict)
                or str(contract.get("kind") or "") not in refreshable
            ):
                raise ConflictError(
                    "This material is an immutable snapshot without a reusable sync contract",
                    details={"space_id": space_id, "source_id": source_id},
                )
            return copy.deepcopy(contract)

    def get_source_sync_schedule(
        self, *, space_id: str, source_id: str
    ) -> SourceSyncScheduleView | None:
        with self.database.transaction() as session:
            row = session.scalar(
                select(SourceSyncSchedule).where(
                    SourceSyncSchedule.space_id == space_id,
                    SourceSyncSchedule.source_id == source_id,
                )
            )
            return self._sync_schedule_view(row) if row else None

    def get_source_sync_schedule_by_id(
        self, schedule_id: str
    ) -> SourceSyncScheduleView:
        with self.database.transaction() as session:
            row = session.get(SourceSyncSchedule, schedule_id)
            if row is None:
                raise NotFoundError(
                    "Source sync schedule not found", details={"schedule_id": schedule_id}
                )
            return self._sync_schedule_view(row)

    def upsert_source_sync_schedule(
        self,
        *,
        space_id: str,
        source_id: str,
        interval_minutes: int,
        enabled: bool,
        expected_revision: int | None,
    ) -> SourceSyncScheduleView:
        # This verifies the active Space link and reusable, credential-free contract.
        self.get_source_sync_contract(space_id=space_id, source_id=source_id)
        now = datetime.now(UTC)
        with self.database.transaction() as session:
            row = session.scalar(
                select(SourceSyncSchedule)
                .where(
                    SourceSyncSchedule.space_id == space_id,
                    SourceSyncSchedule.source_id == source_id,
                )
                .with_for_update()
            )
            if row is None:
                if expected_revision is not None:
                    raise ConflictError(
                        "Source sync schedule does not exist at the expected revision",
                        details={"expected_revision": expected_revision},
                    )
                row = SourceSyncSchedule(
                    space_id=space_id,
                    source_id=source_id,
                    interval_minutes=interval_minutes,
                    enabled=enabled,
                    next_run_at=now + timedelta(minutes=interval_minutes),
                    last_status="never" if enabled else "disabled",
                )
                session.add(row)
            else:
                if expected_revision is None or row.revision != expected_revision:
                    raise ConflictError(
                        "Source sync schedule changed concurrently",
                        details={
                            "expected_revision": expected_revision,
                            "actual_revision": row.revision,
                        },
                    )
                interval_changed = row.interval_minutes != interval_minutes
                was_enabled = row.enabled
                row.interval_minutes = interval_minutes
                row.enabled = enabled
                row.revision += 1
                if enabled and (interval_changed or not was_enabled):
                    row.next_run_at = now + timedelta(minutes=interval_minutes)
                    row.last_status = "scheduled"
                    row.last_error = None
                    row.lease_expires_at = None
                elif not enabled:
                    row.last_status = "disabled"
                    row.lease_expires_at = None
            session.flush()
            return self._sync_schedule_view(row)

    def list_source_sync_executions(
        self, *, space_id: str, source_id: str, limit: int
    ) -> list[SourceSyncExecutionView]:
        with self.database.transaction() as session:
            rows = list(
                session.scalars(
                    select(SourceSyncExecution)
                    .where(
                        SourceSyncExecution.space_id == space_id,
                        SourceSyncExecution.source_id == source_id,
                    )
                    .order_by(SourceSyncExecution.id.desc())
                    .limit(limit)
                )
            )
            return [self._sync_execution_view(row) for row in rows]

    def current_source_version_ids(self, *, space_id: str) -> dict[str, str]:
        with self.database.transaction() as session:
            return {
                str(source_id): str(version_id)
                for source_id, version_id in session.execute(
                    select(Source.id, Source.current_version_id)
                    .join(SourceSpaceLink, SourceSpaceLink.source_id == Source.id)
                    .where(
                        SourceSpaceLink.space_id == space_id,
                        SourceSpaceLink.valid_to_sequence.is_(None),
                        Source.current_version_id.is_not(None),
                    )
                )
                if version_id
            }

    def start_source_sync_execution(
        self,
        *,
        space_id: str,
        source_id: str,
        trigger: str,
        schedule_id: str | None,
    ) -> SourceSyncExecutionView:
        with self.database.transaction() as session:
            row = SourceSyncExecution(
                schedule_id=schedule_id,
                space_id=space_id,
                source_id=source_id,
                trigger=trigger,
                status="running",
            )
            session.add(row)
            session.flush()
            return self._sync_execution_view(row)

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
    ) -> SourceSyncExecutionView:
        with self.database.transaction() as session:
            row = session.get(SourceSyncExecution, execution_id, with_for_update=True)
            if row is None:
                raise NotFoundError(
                    "Source sync execution not found",
                    details={"execution_id": execution_id},
                )
            row.status = status
            row.items_checked = items_checked
            row.new_version_count = new_version_count
            row.job_ids = job_ids
            row.source_version_ids = source_version_ids
            row.error_message = error_message
            row.completed_at = datetime.now(UTC)
            session.flush()
            return self._sync_execution_view(row)

    def claim_due_source_sync_schedules(
        self, *, now: datetime, limit: int, lease_seconds: int
    ) -> list[SourceSyncScheduleView]:
        with self.database.transaction() as session:
            rows = list(
                session.scalars(
                    select(SourceSyncSchedule)
                    .where(
                        SourceSyncSchedule.enabled.is_(True),
                        SourceSyncSchedule.next_run_at <= now,
                        or_(
                            SourceSyncSchedule.lease_expires_at.is_(None),
                            SourceSyncSchedule.lease_expires_at <= now,
                        ),
                    )
                    .order_by(SourceSyncSchedule.next_run_at, SourceSyncSchedule.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            for row in rows:
                row.last_status = "queued"
                row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            session.flush()
            return [self._sync_schedule_view(row) for row in rows]

    def begin_source_sync_schedule(
        self, schedule_id: str, *, now: datetime, lease_seconds: int
    ) -> SourceSyncScheduleView | None:
        with self.database.transaction() as session:
            row = session.get(SourceSyncSchedule, schedule_id, with_for_update=True)
            if (
                row is None
                or not row.enabled
                or row.last_status != "queued"
                or (_aware(row.next_run_at) or now) > now
            ):
                return None
            if row.lease_expires_at is not None and _aware(row.lease_expires_at) < now:
                row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.last_status = "running"
            row.last_run_at = now
            session.flush()
            return self._sync_schedule_view(row)

    def finish_source_sync_schedule(
        self,
        schedule_id: str,
        *,
        status: str,
        error_message: str | None,
        now: datetime,
    ) -> SourceSyncScheduleView:
        with self.database.transaction() as session:
            row = session.get(SourceSyncSchedule, schedule_id, with_for_update=True)
            if row is None:
                raise NotFoundError(
                    "Source sync schedule not found", details={"schedule_id": schedule_id}
                )
            next_run = _aware(row.next_run_at) or now
            interval = timedelta(minutes=row.interval_minutes)
            while next_run <= now:
                next_run += interval
            row.next_run_at = next_run
            row.last_status = status
            row.last_error = error_message
            row.last_run_at = now
            row.lease_expires_at = None
            session.flush()
            return self._sync_schedule_view(row)

    def get_ingestion_job(self, job_id: str) -> IngestionJobView:
        with self.database.transaction() as session:
            row = session.get(IngestionJob, job_id)
            if row is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            return self._job_view(session, row, include_events=True)

    def list_ingestion_jobs(
        self,
        *,
        status: str | None,
        space_id: str | None,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[IngestionJobView], str | None]:
        with self.database.transaction() as session:
            statement = select(IngestionJob).order_by(IngestionJob.id.desc()).limit(limit + 1)
            if status:
                statement = statement.where(IngestionJob.status == status)
            if space_id:
                statement = (
                    statement.join(
                        SourceVersion,
                        SourceVersion.id == IngestionJob.source_version_id,
                    )
                    .join(SourceSpaceLink, SourceSpaceLink.source_id == SourceVersion.source_id)
                    .where(
                        SourceSpaceLink.space_id == space_id,
                        SourceSpaceLink.valid_to_sequence.is_(None),
                    )
                )
            if cursor:
                statement = statement.where(IngestionJob.id < cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            return [self._job_view(session, row) for row in rows], (
                rows[-1].id if has_more and rows else None
            )

    def retry_ingestion(self, job_id: str) -> IngestionJobView:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            if job.status not in {"failed", "cancelled"}:
                raise ConflictError(
                    "Only failed or cancelled ingestion jobs can be retried",
                    details={"job_id": job_id, "status": job.status},
                )
            job.status = "pending"
            job.stage = "raw_stored"
            job.error_code = None
            job.error_message = None
            job.cancel_requested = False
            job.owner_worker_id = None
            job.lease_expires_at = None
            version = session.get(SourceVersion, job.source_version_id)
            if version is not None:
                version.status = SourceStatus.STORED.value
                source = session.get(Source, version.source_id)
                if source is not None:
                    source.status = SourceStatus.DISCOVERED.value
            self._job_event(
                session,
                job.id,
                "ingestion.retry.requested",
                {"previous_attempts": job.attempt_count},
            )
            self._outbox(
                session,
                aggregate_type="ingestion_job",
                aggregate_id=job.id,
                event_type="ingestion.requested",
                payload={"job_id": job.id, "source_version_id": job.source_version_id},
            )
            session.flush()
            return self._job_view(session, job, include_events=True)

    def create_reprocess_job(self, source_id: str) -> IngestionJobView:
        with self.database.transaction() as session:
            source = session.get(Source, source_id, with_for_update=True)
            if source is None or source.tombstoned_at is not None or not source.current_version_id:
                raise NotFoundError("Source not found", details={"source_id": source_id})
            active = session.scalar(
                select(IngestionJob).where(
                    IngestionJob.source_version_id == source.current_version_id,
                    IngestionJob.status.in_(("pending", "running")),
                )
            )
            if active is not None:
                raise ConflictError(
                    "Source already has an active ingestion job",
                    details={"source_id": source_id, "job_id": active.id},
                )
            version = session.get(SourceVersion, source.current_version_id)
            if version is None:
                raise NotFoundError("Current Source version not found")
            job = IngestionJob(
                source_version_id=version.id,
                input_hash=version.content_hash,
                policy_version="reprocess-v1",
                status="pending",
                stage="raw_stored",
            )
            session.add(job)
            session.flush()
            self._job_event(
                session,
                job.id,
                "ingestion.reprocess.requested",
                {"source_id": source.id, "source_version_id": version.id},
            )
            self._outbox(
                session,
                aggregate_type="ingestion_job",
                aggregate_id=job.id,
                event_type="ingestion.requested",
                payload={"job_id": job.id, "source_version_id": version.id},
            )
            return self._job_view(session, job, include_events=True)

    def cancel_ingestion(self, job_id: str) -> IngestionJobView:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            if job.status in {"completed", "failed", "cancelled"}:
                return self._job_view(session, job, include_events=True)
            job.cancel_requested = True
            job.status = "cancelled"
            job.stage = "cancelled"
            job.owner_worker_id = None
            job.lease_expires_at = None
            self._job_event(session, job.id, "ingestion.cancelled", {"reason": "user"})
            session.flush()
            return self._job_view(session, job, include_events=True)

    def list_ingestion_events(
        self, job_id: str, *, after: int, limit: int
    ) -> tuple[list[IngestionJobEventView], int | None]:
        with self.database.transaction() as session:
            if session.get(IngestionJob, job_id) is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            rows = list(
                session.scalars(
                    select(JobEvent)
                    .where(JobEvent.job_id == job_id, JobEvent.sequence > after)
                    .order_by(JobEvent.sequence)
                    .limit(limit + 1)
                )
            )
            has_more = len(rows) > limit
            rows = rows[:limit]
            events = [
                IngestionJobEventView(
                    sequence=item.sequence,
                    event_type=item.event_type,
                    payload=item.payload,
                    occurred_at=item.occurred_at,
                )
                for item in rows
            ]
            return events, rows[-1].sequence if has_more and rows else None

    def acquire_ingestion(
        self, job_id: str, *, worker_id: str, lease_seconds: int
    ) -> IngestionLease:
        now = datetime.now(UTC)
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            if job.status in {"completed", "failed", "cancelled"}:
                raise ConflictError(
                    "Terminal ingestion jobs cannot be acquired",
                    details={"job_id": job_id, "status": job.status},
                )
            current_expiry = _aware(job.lease_expires_at)
            if (
                job.owner_worker_id
                and job.owner_worker_id != worker_id
                and current_expiry
                and current_expiry > now
            ):
                raise ConflictError(
                    "Ingestion job is already owned by an active worker",
                    details={"job_id": job_id, "owner_worker_id": job.owner_worker_id},
                )
            recovered = job.status == "running" and current_expiry is not None
            if job.owner_worker_id != worker_id or not current_expiry or current_expiry <= now:
                job.execution_epoch += 1
                job.attempt_count += 1
            job.owner_worker_id = worker_id
            job.lease_expires_at = now + timedelta(seconds=lease_seconds)
            job.status = "running"
            job.stage = "claimed"
            self._job_event(
                session,
                job.id,
                "ingestion.lease.recovered" if recovered else "ingestion.lease.acquired",
                {
                    "worker_id": worker_id,
                    "fencing_token": job.execution_epoch,
                    "attempt": job.attempt_count,
                },
            )
            session.flush()
            return self._ingestion_lease(job)

    def claim_ingestion_jobs(
        self, *, worker_id: str, limit: int, lease_seconds: int
    ) -> list[IngestionLease]:
        now = datetime.now(UTC)
        with self.database.transaction() as session:
            statement = (
                select(IngestionJob)
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
                .order_by(IngestionJob.created_at, IngestionJob.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            jobs = list(session.scalars(statement))
            leases: list[IngestionLease] = []
            for job in jobs:
                recovered = job.status == "running"
                job.status = "running"
                job.stage = "claimed"
                job.owner_worker_id = worker_id
                job.lease_expires_at = now + timedelta(seconds=lease_seconds)
                job.execution_epoch += 1
                job.attempt_count += 1
                self._job_event(
                    session,
                    job.id,
                    "ingestion.lease.recovered" if recovered else "ingestion.lease.acquired",
                    {
                        "worker_id": worker_id,
                        "fencing_token": job.execution_epoch,
                        "attempt": job.attempt_count,
                    },
                )
                leases.append(self._ingestion_lease(job))
            session.flush()
            return leases

    def renew_ingestion_lease(self, lease: IngestionLease, *, lease_seconds: int) -> IngestionLease:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, lease.job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": lease.job_id})
            self._assert_ingestion_fence(job, lease)
            job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=lease_seconds)
            session.flush()
            return self._ingestion_lease(job)

    def list_sources(
        self, *, space_id: str, cursor: str | None, limit: int
    ) -> tuple[list[SourceVersionView], str | None]:
        with self.database.transaction() as session:
            statement = (
                select(SourceVersion)
                .join(Source, SourceVersion.source_id == Source.id)
                .join(SourceSpaceLink, SourceSpaceLink.source_id == Source.id)
                .where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                    Source.current_version_id == SourceVersion.id,
                    Source.status != SourceStatus.TOMBSTONED.value,
                )
                .order_by(SourceVersion.id)
                .limit(limit + 1)
            )
            if cursor:
                statement = statement.where(SourceVersion.id > cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            context = self._source_view_context(session, rows)
            return [self._source_view(session, row, context=context) for row in rows], (
                rows[-1].id if has_more and rows else None
            )

    def start_ingestion(self, job_id: str, *, lease: IngestionLease) -> SourceVersionView:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            self._assert_ingestion_fence(job, lease)
            version = session.get(SourceVersion, job.source_version_id)
            if version is None:
                raise NotFoundError("Source version not found")
            if job.status == "completed":
                return self._source_view(session, version)
            job.status = "running"
            job.stage = "parsing"
            version.status = SourceStatus.PROCESSING.value
            source = session.get(Source, version.source_id)
            if source:
                source.status = SourceStatus.PROCESSING.value
            self._job_event(session, job.id, "ingestion.parsing.started", {})
            return self._source_view(session, version)

    def publish_evidence(
        self,
        *,
        job_id: str,
        drafts: list[EvidenceDraft],
        parser_manifest: dict[str, object],
        capabilities: dict[str, str],
        lease: IngestionLease,
    ) -> list[str]:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            self._assert_ingestion_fence(job, lease)
            version = session.get(SourceVersion, job.source_version_id, with_for_update=True)
            if version is None:
                raise NotFoundError("Source version not found")
            if job.status == "completed":
                existing = session.scalars(
                    select(EvidenceRevision.id).where(
                        EvidenceRevision.source_version_id == version.id,
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                )
                return list(existing)
            sequence = self._allocate_publish_sequence(session)
            derived_assets = {
                str(item.get("object_key")): item
                for item in parser_manifest.get("derived_assets", [])
                if isinstance(item, dict) and item.get("object_key")
            }
            existing_asset_keys = (
                set(
                    session.scalars(
                        select(ObjectManifest.object_key).where(
                            ObjectManifest.source_version_id == version.id,
                            ObjectManifest.object_key.in_(tuple(derived_assets)),
                        )
                    )
                )
                if derived_assets
                else set()
            )
            for object_key, asset in derived_assets.items():
                if object_key in existing_asset_keys:
                    continue
                session.add(
                    ObjectManifest(
                        source_version_id=version.id,
                        role=str(asset.get("role") or "derived"),
                        object_key=str(asset["object_key"]),
                        content_hash=str(asset.get("content_hash") or ""),
                        mime_type=str(asset.get("content_type") or "application/octet-stream"),
                        byte_size=int(asset.get("byte_size") or 0),
                    )
                )
            anchor_to_unit: dict[str, ContentUnit] = {}
            evidence_ids: list[str] = []
            reprocessed_evidence_ids: set[str] = set()
            for draft in sorted(drafts, key=lambda item: item.ordinal):
                unit = session.scalar(
                    select(ContentUnit).where(
                        ContentUnit.source_version_id == version.id,
                        ContentUnit.native_anchor == draft.native_anchor,
                        ContentUnit.unit_type == draft.unit_type,
                    )
                )
                if unit is None:
                    parent = anchor_to_unit.get(draft.parent_anchor or "")
                    unit = ContentUnit(
                        source_version_id=version.id,
                        parent_id=parent.id if parent else None,
                        unit_type=draft.unit_type,
                        native_anchor=draft.native_anchor,
                        fingerprint=draft.fingerprint,
                        ordinal=draft.ordinal,
                    )
                    session.add(unit)
                    session.flush()
                anchor_to_unit[draft.native_anchor] = unit
                prior = session.scalar(
                    select(EvidenceRevision).where(
                        EvidenceRevision.content_unit_id == unit.id,
                        EvidenceRevision.content_hash == draft.content_hash,
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                )
                if prior:
                    evidence_ids.append(prior.id)
                    continue
                revision_no = (
                    session.scalar(
                        select(func.max(EvidenceRevision.revision_no)).where(
                            EvidenceRevision.content_unit_id == unit.id
                        )
                    )
                    or 0
                ) + 1
                superseded = session.scalar(
                    select(EvidenceRevision)
                    .where(
                        EvidenceRevision.content_unit_id == unit.id,
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                    .order_by(EvidenceRevision.revision_no.desc())
                )
                if superseded is not None:
                    superseded.status = EvidenceStatus.SUPERSEDED.value
                    superseded.visible_until_sequence = sequence
                    reprocessed_evidence_ids.add(superseded.id)
                evidence = EvidenceRevision(
                    content_unit_id=unit.id,
                    source_version_id=version.id,
                    source_id=version.source_id,
                    revision_no=revision_no,
                    modality=draft.modality.value,
                    evidence_type=draft.evidence_type,
                    text_content=draft.text_content,
                    searchable_text=draft.searchable_text,
                    content_hash=draft.content_hash,
                    status=EvidenceStatus.PUBLISHED.value,
                    quality_flags=list(draft.quality_flags),
                    provenance=draft.provenance,
                    visible_from_sequence=sequence,
                    supersedes_id=superseded.id if superseded is not None else None,
                )
                session.add(evidence)
                session.flush()
                session.add(
                    EvidenceLocator(
                        evidence_revision_id=evidence.id,
                        locator_type=draft.locator.locator_type,
                        page_no=draft.locator.page_no,
                        bbox=list(draft.locator.bbox) if draft.locator.bbox else None,
                        start_ms=draft.locator.start_ms,
                        end_ms=draft.locator.end_ms,
                        sheet=draft.locator.sheet,
                        cell_range=draft.locator.cell_range,
                        char_start=draft.locator.char_start,
                        char_end=draft.locator.char_end,
                        extra=draft.locator.extra,
                    )
                )
                asset_key = draft.locator.extra.get("object_key")
                asset = derived_assets.get(str(asset_key)) if asset_key else None
                if asset is not None:
                    session.add(
                        EvidenceAsset(
                            evidence_revision_id=evidence.id,
                            role=str(asset.get("role") or "derived"),
                            object_key=str(asset["object_key"]),
                            mime_type=str(asset.get("content_type") or "application/octet-stream"),
                            content_hash=str(asset.get("content_hash") or ""),
                            byte_size=int(asset.get("byte_size") or 0),
                        )
                    )
                evidence_ids.append(evidence.id)

            existing_capabilities = {
                row.capability: row
                for row in session.scalars(
                    select(CapabilityReadiness).where(
                        CapabilityReadiness.source_version_id == version.id
                    )
                )
            }
            for name, status in capabilities.items():
                row = existing_capabilities.get(name)
                if row is None:
                    session.add(
                        CapabilityReadiness(
                            source_version_id=version.id,
                            capability=name,
                            status=status,
                        )
                    )
                else:
                    row.status = status
            has_failure = any(
                status in {CapabilityStatus.FAILED.value, CapabilityStatus.PARTIAL.value}
                for status in capabilities.values()
            )
            version.status = SourceStatus.PARTIAL.value if has_failure else SourceStatus.READY.value
            connector_manifest = version.parser_manifest.get("connector", {})
            version.parser_manifest = {
                **parser_manifest,
                "connector": connector_manifest,
            }
            source = session.get(Source, version.source_id)
            if source:
                source.status = version.status
            old_versions = list(
                session.scalars(
                    select(SourceVersion).where(
                        SourceVersion.source_id == version.source_id,
                        SourceVersion.id != version.id,
                        SourceVersion.status.notin_(
                            [SourceStatus.SUPERSEDED.value, SourceStatus.TOMBSTONED.value]
                        ),
                    )
                )
            )
            old_version_ids = [item.id for item in old_versions]
            superseded_evidence = (
                list(
                    session.scalars(
                        select(EvidenceRevision).where(
                            EvidenceRevision.source_version_id.in_(old_version_ids),
                            EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                        )
                    )
                )
                if old_version_ids
                else []
            )
            superseded_evidence_ids = {item.id for item in superseded_evidence}
            for old_version in old_versions:
                old_version.status = SourceStatus.SUPERSEDED.value
                old_version.visible_until_sequence = sequence
            for old_evidence in superseded_evidence:
                old_evidence.status = EvidenceStatus.SUPERSEDED.value
                old_evidence.visible_until_sequence = sequence
            superseded_evidence_ids.update(reprocessed_evidence_ids)
            if superseded_evidence_ids:
                self._propose_artifact_refreshes(
                    session,
                    evidence_ids=superseded_evidence_ids,
                    reason="source_updated",
                    replacement_evidence_ids=tuple(evidence_ids),
                )
                self._outbox(
                    session,
                    aggregate_type="source_version",
                    aggregate_id=version.id,
                    event_type="evidence.superseded",
                    payload={
                        "source_version_id": version.id,
                        "evidence_revision_ids": sorted(superseded_evidence_ids),
                    },
                )
            job.status = "completed"
            job.stage = "published"
            job.owner_worker_id = None
            job.lease_expires_at = None
            self._job_event(
                session,
                job.id,
                "ingestion.evidence.published",
                {
                    "source_version_id": version.id,
                    "evidence_count": len(evidence_ids),
                    "capabilities": capabilities,
                },
            )
            self._outbox(
                session,
                aggregate_type="source_version",
                aggregate_id=version.id,
                event_type="evidence.published",
                payload={
                    "source_version_id": version.id,
                    "evidence_revision_ids": evidence_ids,
                    "publish_sequence": sequence,
                },
            )
            return evidence_ids

    def fail_ingestion(
        self, job_id: str, *, code: str, message: str, lease: IngestionLease
    ) -> None:
        with self.database.transaction() as session:
            job = session.get(IngestionJob, job_id, with_for_update=True)
            if job is None:
                raise NotFoundError("Ingestion job not found", details={"job_id": job_id})
            self._assert_ingestion_fence(job, lease)
            job.status = "failed"
            job.error_code = code
            job.error_message = message
            job.owner_worker_id = None
            job.lease_expires_at = None
            version = session.get(SourceVersion, job.source_version_id)
            if version:
                version.status = SourceStatus.FAILED.value
                source = session.get(Source, version.source_id)
                if source:
                    source.status = SourceStatus.FAILED.value
            self._job_event(
                session,
                job.id,
                "ingestion.failed",
                {"code": code, "message": message},
            )

    def tombstone_source(self, source_id: str) -> None:
        with self.database.transaction() as session:
            source = session.get(Source, source_id, with_for_update=True)
            if source is None:
                raise NotFoundError("Source not found", details={"source_id": source_id})
            if source.status == SourceStatus.TOMBSTONED.value:
                return
            sequence = self._allocate_publish_sequence(session)
            source.status = SourceStatus.TOMBSTONED.value
            source.tombstoned_at = datetime.now().astimezone()
            versions = session.scalars(
                select(SourceVersion).where(SourceVersion.source_id == source_id)
            )
            for version in versions:
                version.status = SourceStatus.TOMBSTONED.value
                version.visible_until_sequence = sequence
            evidence = session.scalars(
                select(EvidenceRevision).where(EvidenceRevision.source_id == source_id)
            )
            evidence_ids: set[str] = set()
            for item in evidence:
                evidence_ids.add(item.id)
                item.status = EvidenceStatus.TOMBSTONED.value
                item.visible_until_sequence = sequence
            links = session.scalars(
                select(SourceSpaceLink).where(
                    SourceSpaceLink.source_id == source_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            )
            for link in links:
                link.valid_to_sequence = sequence
            jobs = session.scalars(
                select(IngestionJob)
                .join(SourceVersion, SourceVersion.id == IngestionJob.source_version_id)
                .where(
                    SourceVersion.source_id == source_id,
                    IngestionJob.status.in_(["pending", "running"]),
                )
            )
            for job in jobs:
                job.cancel_requested = True
                job.status = "cancelled"
                job.owner_worker_id = None
                job.lease_expires_at = None
                self._job_event(
                    session,
                    job.id,
                    "ingestion.cancelled",
                    {"reason": "source_tombstoned", "source_id": source_id},
                )
            if evidence_ids:
                impacted_claim_ids = set(
                    session.scalars(
                        select(ClaimEvidenceLink.claim_id).where(
                            ClaimEvidenceLink.evidence_revision_id.in_(evidence_ids)
                        )
                    )
                )
                for claim_id in impacted_claim_ids:
                    claim = session.get(Claim, claim_id)
                    if claim:
                        claim.status = "stale"
                        claim.explanation = "Supporting source was tombstoned"
                self._propose_artifact_refreshes(
                    session,
                    evidence_ids=evidence_ids,
                    reason="source_tombstoned",
                )
            self._outbox(
                session,
                aggregate_type="source",
                aggregate_id=source_id,
                event_type="source.tombstoned",
                payload={"source_id": source_id, "sequence": sequence},
            )

    @staticmethod
    def _propose_artifact_refreshes(
        session: Session,
        *,
        evidence_ids: set[str],
        reason: str,
        replacement_evidence_ids: tuple[str, ...] = (),
    ) -> None:
        current_revisions = list(
            session.scalars(
                select(ArtifactRevision).join(
                    Artifact, Artifact.current_revision_id == ArtifactRevision.id
                )
            )
        )
        for revision in current_revisions:
            impacted = evidence_ids.intersection(revision.evidence_revision_ids)
            if not impacted:
                continue
            artifact = session.get(Artifact, revision.artifact_id)
            if artifact is None:
                continue
            existing = session.scalar(
                select(ArtifactRefreshProposal).where(
                    ArtifactRefreshProposal.artifact_id == artifact.id,
                    ArtifactRefreshProposal.base_revision_id == revision.id,
                    ArtifactRefreshProposal.status == "pending",
                )
            )
            if existing:
                artifact.status = "refresh_proposed"
                continue
            proposed = copy.deepcopy(revision.canonical_document)
            changed_blocks = 0
            preserved_user_blocks = 0
            blocks = proposed.get("blocks")
            if isinstance(blocks, list):
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    if block.get("origin") == "user":
                        preserved_user_blocks += 1
                        continue
                    bindings = block.get("evidence_revision_ids")
                    if isinstance(bindings, list) and impacted.intersection(bindings):
                        block["evidence_revision_ids"] = [
                            item for item in bindings if item not in impacted
                        ] + list(replacement_evidence_ids)
                        changed_blocks += 1
                    items = block.get("items")
                    if isinstance(items, list):
                        retained = [
                            item
                            for item in items
                            if not isinstance(item, dict)
                            or item.get("evidence_revision_id") not in impacted
                        ]
                        if len(retained) != len(items):
                            retained.extend(
                                {
                                    "source": "Updated source evidence",
                                    "evidence_revision_id": evidence_id,
                                }
                                for evidence_id in replacement_evidence_ids
                            )
                            block["items"] = retained
                            changed_blocks += 1
            proposed_evidence = [
                item for item in revision.evidence_revision_ids if item not in impacted
            ] + [
                item
                for item in replacement_evidence_ids
                if item not in revision.evidence_revision_ids
            ]
            session.add(
                ArtifactRefreshProposal(
                    artifact_id=artifact.id,
                    base_revision_id=revision.id,
                    status="pending",
                    reason=reason,
                    impacted_evidence_revision_ids=sorted(impacted),
                    proposed_document=proposed,
                    proposed_evidence_revision_ids=proposed_evidence,
                    diff={
                        "removed_evidence_revision_ids": sorted(impacted),
                        "added_evidence_revision_ids": list(replacement_evidence_ids),
                        "changed_generated_blocks": changed_blocks,
                        "preserved_user_blocks": preserved_user_blocks,
                    },
                )
            )
            artifact.status = "refresh_proposed"

    @staticmethod
    def _job_view(
        session: Session, row: IngestionJob, *, include_events: bool = False
    ) -> IngestionJobView:
        source_row = session.execute(
            select(Source, SourceVersion)
            .join(SourceVersion, SourceVersion.source_id == Source.id)
            .where(SourceVersion.id == row.source_version_id)
        ).first()
        events = tuple(
            IngestionJobEventView(
                sequence=item.sequence,
                event_type=item.event_type,
                payload=item.payload,
                occurred_at=item.occurred_at,
            )
            for item in (
                session.scalars(
                    select(JobEvent)
                    .where(JobEvent.job_id == row.id)
                    .order_by(JobEvent.sequence)
                )
                if include_events
                else ()
            )
        )
        event_count = (
            len(events)
            if include_events
            else int(
                session.scalar(
                    select(func.count(JobEvent.id)).where(JobEvent.job_id == row.id)
                )
                or 0
            )
        )
        source = source_row[0] if source_row else None
        version = source_row[1] if source_row else None
        return IngestionJobView(
            id=row.id,
            source_version_id=row.source_version_id,
            status=row.status,
            stage=row.stage,
            error_code=row.error_code,
            error_message=row.error_message,
            created_at=row.created_at,
            updated_at=row.updated_at,
            source_id=source.id if source else None,
            display_name=source.display_name if source else None,
            modality=Modality(version.modality) if version else None,
            mime_type=version.mime_type if version else None,
            attempt_count=row.attempt_count,
            event_count=event_count,
            events=events,
        )

    @staticmethod
    def _ingestion_lease(row: IngestionJob) -> IngestionLease:
        expires_at = _aware(row.lease_expires_at)
        if row.owner_worker_id is None or expires_at is None:
            raise RuntimeError("Ingestion lease row is incomplete")
        return IngestionLease(
            job_id=row.id,
            worker_id=row.owner_worker_id,
            fencing_token=row.execution_epoch,
            lease_expires_at=expires_at,
        )

    @staticmethod
    def _assert_ingestion_fence(row: IngestionJob, lease: IngestionLease) -> None:
        expires_at = _aware(row.lease_expires_at)
        if (
            row.id != lease.job_id
            or row.owner_worker_id != lease.worker_id
            or row.execution_epoch != lease.fencing_token
            or expires_at is None
            or expires_at <= datetime.now(UTC)
        ):
            raise ConflictError(
                "Ingestion lease is stale or no longer owned by this worker",
                details={"job_id": lease.job_id, "fencing_token": lease.fencing_token},
            )

    @staticmethod
    def _source_view_context(
        session: Session,
        rows: list[SourceVersion],
    ) -> _SourceViewContext:
        version_ids = tuple(row.id for row in rows)
        source_ids = tuple({row.source_id for row in rows})
        links_by_source: dict[str, list[str]] = {}
        capabilities_by_version: dict[str, list[CapabilityReadiness]] = {}
        sources_by_id: dict[str, Source] = {}
        evidence_counts: dict[str, int] = {}
        derived_image_counts: dict[str, int] = {}
        cover_evidence_ids: dict[str, str] = {}
        latest_jobs: dict[str, IngestionJob] = {}
        schedules_by_source: dict[str, list[SourceSyncSchedule]] = {}

        if rows:
            for source_id, space_id in session.execute(
                select(SourceSpaceLink.source_id, SourceSpaceLink.space_id).where(
                    SourceSpaceLink.source_id.in_(source_ids),
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            ):
                links_by_source.setdefault(str(source_id), []).append(str(space_id))
            for capability in session.scalars(
                select(CapabilityReadiness).where(
                    CapabilityReadiness.source_version_id.in_(version_ids)
                )
            ):
                capabilities_by_version.setdefault(capability.source_version_id, []).append(
                    capability
                )
            sources_by_id = {
                source.id: source
                for source in session.scalars(select(Source).where(Source.id.in_(source_ids)))
            }
            evidence_counts = {
                str(source_version_id): int(count)
                for source_version_id, count in session.execute(
                    select(
                        EvidenceRevision.source_version_id,
                        func.count(EvidenceRevision.id),
                    )
                    .where(
                        EvidenceRevision.source_version_id.in_(version_ids),
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                    .group_by(EvidenceRevision.source_version_id)
                )
            }
            derived_image_counts = {
                str(source_version_id): int(count)
                for source_version_id, count in session.execute(
                    select(
                        ObjectManifest.source_version_id,
                        func.count(func.distinct(ObjectManifest.object_key)),
                    )
                    .where(
                        ObjectManifest.source_version_id.in_(version_ids),
                        ObjectManifest.role == "document_image",
                    )
                    .group_by(ObjectManifest.source_version_id)
                )
            }
            cover_evidence_ids = {
                str(source_version_id): str(evidence_id)
                for source_version_id, evidence_id in session.execute(
                    select(
                        EvidenceRevision.source_version_id,
                        func.min(EvidenceRevision.id),
                    )
                    .where(
                        EvidenceRevision.source_version_id.in_(version_ids),
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                        EvidenceRevision.modality == Modality.IMAGE.value,
                    )
                    .group_by(EvidenceRevision.source_version_id)
                )
            }
            for job in session.scalars(
                select(IngestionJob)
                .where(IngestionJob.source_version_id.in_(version_ids))
                .order_by(IngestionJob.source_version_id, IngestionJob.id.desc())
            ):
                latest_jobs.setdefault(job.source_version_id, job)
            for schedule in session.scalars(
                select(SourceSyncSchedule).where(
                    SourceSyncSchedule.source_id.in_(source_ids)
                )
            ):
                schedules_by_source.setdefault(schedule.source_id, []).append(schedule)

        active_release = session.scalar(
            select(IndexRelease)
            .where(IndexRelease.status == "active")
            .order_by(IndexRelease.release_no.desc())
            .limit(1)
        )
        latest_release = active_release or session.scalar(
            select(IndexRelease).order_by(IndexRelease.release_no.desc()).limit(1)
        )
        active_projection_counts: dict[str, int] = {}
        if rows and active_release is not None and active_release.generation_map:
            generation_ids = tuple(
                str(value) for value in active_release.generation_map.values()
            )
            active_projection_counts = {
                str(source_version_id): int(count)
                for source_version_id, count in session.execute(
                    select(
                        EvidenceRevision.source_version_id,
                        func.count(func.distinct(EvidenceRevision.id)),
                    )
                    .join(
                        ProjectionItem,
                        ProjectionItem.evidence_revision_id == EvidenceRevision.id,
                    )
                    .where(
                        EvidenceRevision.source_version_id.in_(version_ids),
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                        ProjectionItem.index_generation_id.in_(generation_ids),
                        ProjectionItem.status == "active",
                    )
                    .group_by(EvidenceRevision.source_version_id)
                )
            }
        return _SourceViewContext(
            links_by_source={
                source_id: tuple(space_ids)
                for source_id, space_ids in links_by_source.items()
            },
            capabilities_by_version={
                version_id: tuple(capabilities)
                for version_id, capabilities in capabilities_by_version.items()
            },
            sources_by_id=sources_by_id,
            evidence_counts=evidence_counts,
            derived_image_counts=derived_image_counts,
            cover_evidence_ids=cover_evidence_ids,
            latest_jobs=latest_jobs,
            schedules_by_source={
                source_id: tuple(schedules)
                for source_id, schedules in schedules_by_source.items()
            },
            active_release=active_release,
            latest_release=latest_release,
            active_projection_counts=active_projection_counts,
        )

    @staticmethod
    def _source_view(
        session: Session,
        row: SourceVersion,
        *,
        context: _SourceViewContext | None = None,
    ) -> SourceVersionView:
        context = context or SqlControlPlaneRepository._source_view_context(session, [row])
        links = context.links_by_source.get(row.source_id, ())
        capability_rows = context.capabilities_by_version.get(row.id, ())
        source = context.sources_by_id.get(row.source_id)
        if source is None:
            raise NotFoundError("Source not found", details={"source_id": row.source_id})
        published_evidence_count = context.evidence_counts.get(row.id, 0)
        derived_image_count = context.derived_image_counts.get(row.id, 0)
        cover_evidence_id = context.cover_evidence_ids.get(row.id)
        latest_job_row = context.latest_jobs.get(row.id)
        latest_job = (
            SourceIngestionSummaryView(
                id=latest_job_row.id,
                status=latest_job_row.status,
                stage=latest_job_row.stage,
                error_code=latest_job_row.error_code,
                error_message=latest_job_row.error_message,
                attempt_count=latest_job_row.attempt_count,
                updated_at=latest_job_row.updated_at,
            )
            if latest_job_row is not None
            else None
        )
        active_release = context.active_release
        latest_release = context.latest_release
        active_projection_count = context.active_projection_counts.get(row.id, 0)
        expected_count = int(published_evidence_count)
        if expected_count == 0:
            projection_state = "not_applicable"
        elif active_release is None:
            projection_state = "pending" if latest_release is not None else "not_configured"
        elif active_projection_count >= expected_count:
            projection_state = "active"
        elif active_projection_count > 0:
            projection_state = "partial"
        else:
            projection_state = "pending"
        projection = SourceProjectionView(
            state=projection_state,
            expected_evidence_count=expected_count,
            active_evidence_count=active_projection_count,
            release_id=latest_release.id if latest_release is not None else None,
        )
        connector_metadata = (row.parser_manifest or {}).get("connector", {})
        sync_contract = (
            connector_metadata.get("sync_contract")
            if isinstance(connector_metadata, dict)
            else None
        )
        refreshable_kinds = {"url", "rss", "folder", "git", "news", "image_search"}
        sync_available = (
            isinstance(sync_contract, dict)
            and str(sync_contract.get("kind") or "") in refreshable_kinds
        )
        sync = SourceSyncView(
            connector_kind=source.kind,
            refreshable=sync_available,
            scope=(
                "single_source"
                if source.kind == "url"
                else "source_set"
                if sync_available
                else "snapshot"
            ),
            last_checked_at=latest_job.updated_at if latest_job else row.created_at,
            schedules=tuple(
                SqlControlPlaneRepository._sync_schedule_view(schedule)
                for schedule in context.schedules_by_source.get(row.source_id, ())
            ),
        )
        capability_values = {
            capability.capability: CapabilityStatus(capability.status)
            for capability in capability_rows
        }
        health = assess_source_health(
            source_status=row.status,
            evidence_count=expected_count,
            capabilities={name: status.value for name, status in capability_values.items()},
            latest_job=latest_job,
            projection=projection,
        )
        return SourceVersionView(
            id=row.id,
            source_id=row.source_id,
            space_ids=tuple(links),
            display_name=source.display_name if source else row.id,
            version_no=row.version_no,
            content_hash=row.content_hash,
            mime_type=row.mime_type,
            byte_size=row.byte_size,
            object_key=row.object_key,
            connector_kind=source.kind,
            canonical_uri=source.canonical_uri,
            external_version=row.external_version,
            modality=Modality(row.modality),
            status=SourceStatus(row.status),
            capabilities=capability_values,
            capability_details={
                capability.capability: capability.detail or {}
                for capability in capability_rows
            },
            latest_job=latest_job,
            projection=projection,
            sync=sync,
            health=health,
            created_at=row.created_at,
            published_evidence_count=int(published_evidence_count),
            derived_image_count=int(derived_image_count),
            cover_evidence_id=cover_evidence_id,
        )

    @staticmethod
    def _sync_schedule_view(row: SourceSyncSchedule) -> SourceSyncScheduleView:
        return SourceSyncScheduleView(
            id=row.id,
            space_id=row.space_id,
            source_id=row.source_id,
            interval_minutes=row.interval_minutes,
            enabled=row.enabled,
            next_run_at=row.next_run_at,
            last_run_at=row.last_run_at,
            last_status=row.last_status,
            last_error=row.last_error,
            revision=row.revision,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _sync_execution_view(row: SourceSyncExecution) -> SourceSyncExecutionView:
        return SourceSyncExecutionView(
            id=row.id,
            schedule_id=row.schedule_id,
            space_id=row.space_id,
            source_id=row.source_id,
            trigger=row.trigger,
            status=row.status,
            items_checked=row.items_checked,
            new_version_count=row.new_version_count,
            job_ids=tuple(row.job_ids or ()),
            source_version_ids=tuple(row.source_version_ids or ()),
            error_message=row.error_message,
            created_at=row.created_at,
            completed_at=row.completed_at,
        )

    # ----- evidence queries -----------------------------------------------------------

    def get_evidence(self, revision_id: str) -> EvidenceView:
        with self.database.transaction() as session:
            row = session.get(EvidenceRevision, revision_id)
            if row is None or row.status in {
                EvidenceStatus.TOMBSTONED.value,
                EvidenceStatus.PURGED.value,
            }:
                raise NotFoundError(
                    "Evidence revision not found", details={"revision_id": revision_id}
                )
            return self._evidence_view(session, row)

    def list_evidence(
        self,
        *,
        space_id: str | None,
        source_id: str | None,
        modality: str | None,
        cursor: str | None,
        limit: int,
        query: str | None = None,
    ) -> tuple[list[EvidenceView], str | None]:
        with self.database.transaction() as session:
            statement = (
                select(EvidenceRevision)
                .where(EvidenceRevision.status == EvidenceStatus.PUBLISHED.value)
                .order_by(EvidenceRevision.id)
                .limit(limit + 1)
            )
            if space_id:
                statement = statement.join(
                    SourceSpaceLink, SourceSpaceLink.source_id == EvidenceRevision.source_id
                ).where(
                    SourceSpaceLink.space_id == space_id,
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            if source_id:
                statement = statement.where(EvidenceRevision.source_id == source_id)
            if modality:
                statement = statement.where(EvidenceRevision.modality == modality)
            normalized_query = query.strip() if query else ""
            if normalized_query:
                escaped_query = (
                    normalized_query.replace("\\", "\\\\")
                    .replace("%", "\\%")
                    .replace("_", "\\_")
                )
                pattern = f"%{escaped_query}%"
                statement = statement.join(
                    Source, Source.id == EvidenceRevision.source_id
                ).where(
                    or_(
                        EvidenceRevision.text_content.ilike(pattern, escape="\\"),
                        EvidenceRevision.searchable_text.ilike(pattern, escape="\\"),
                        Source.display_name.ilike(pattern, escape="\\"),
                    )
                )
            if cursor:
                statement = statement.where(EvidenceRevision.id > cursor)
            rows = list(session.scalars(statement))
            has_more = len(rows) > limit
            rows = rows[:limit]
            return [self._evidence_view(session, row) for row in rows], (
                rows[-1].id if has_more and rows else None
            )

    def expand_evidence(self, revision_id: str, *, before: int, after: int) -> list[EvidenceView]:
        with self.database.transaction() as session:
            anchor = session.get(EvidenceRevision, revision_id)
            if anchor is None:
                raise NotFoundError("Evidence revision not found")
            unit = session.get(ContentUnit, anchor.content_unit_id)
            if unit is None:
                raise NotFoundError("Evidence content unit not found")
            min_ordinal = max(0, unit.ordinal - before)
            max_ordinal = unit.ordinal + after
            statement = (
                select(EvidenceRevision)
                .join(ContentUnit, ContentUnit.id == EvidenceRevision.content_unit_id)
                .where(
                    EvidenceRevision.source_version_id == anchor.source_version_id,
                    EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    ContentUnit.ordinal >= min_ordinal,
                    ContentUnit.ordinal <= max_ordinal,
                )
                .order_by(ContentUnit.ordinal)
            )
            return [self._evidence_view(session, row) for row in session.scalars(statement)]

    def compare_source_versions(self, left_id: str, right_id: str) -> dict[str, object]:
        with self.database.transaction() as session:
            for identifier in (left_id, right_id):
                if session.get(SourceVersion, identifier) is None:
                    raise NotFoundError(
                        "Source version not found", details={"source_version_id": identifier}
                    )
            left_rows = list(
                session.scalars(
                    select(EvidenceRevision).where(
                        EvidenceRevision.source_version_id == left_id,
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                )
            )
            right_rows = list(
                session.scalars(
                    select(EvidenceRevision).where(
                        EvidenceRevision.source_version_id == right_id,
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    )
                )
            )
            left_hashes = {row.content_hash: row.id for row in left_rows}
            right_hashes = {row.content_hash: row.id for row in right_rows}
            return {
                "left_source_version_id": left_id,
                "right_source_version_id": right_id,
                "unchanged": [
                    {"left": left_hashes[value], "right": right_hashes[value]}
                    for value in sorted(left_hashes.keys() & right_hashes.keys())
                ],
                "removed": [
                    left_hashes[value] for value in sorted(left_hashes.keys() - right_hashes.keys())
                ],
                "added": [
                    right_hashes[value]
                    for value in sorted(right_hashes.keys() - left_hashes.keys())
                ],
            }

    def hydrate_evidence(
        self,
        revision_ids: list[str],
        *,
        space_ids: tuple[str, ...],
        source_ids: tuple[str, ...],
        watermark: int | None,
    ) -> dict[str, EvidenceView]:
        if not revision_ids:
            return {}
        with self.database.transaction() as session:
            statement = select(EvidenceRevision).where(
                EvidenceRevision.id.in_(revision_ids),
                EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
            )
            if source_ids:
                statement = statement.where(EvidenceRevision.source_id.in_(source_ids))
            if watermark is not None:
                statement = statement.where(
                    EvidenceRevision.visible_from_sequence <= watermark,
                    or_(
                        EvidenceRevision.visible_until_sequence.is_(None),
                        EvidenceRevision.visible_until_sequence > watermark,
                    ),
                )
            rows = list(session.scalars(statement))
            if space_ids:
                allowed_sources = set(
                    session.scalars(
                        select(SourceSpaceLink.source_id).where(
                            SourceSpaceLink.space_id.in_(space_ids),
                            SourceSpaceLink.valid_to_sequence.is_(None),
                        )
                    )
                )
                rows = [row for row in rows if row.source_id in allowed_sources]
            source_map = {
                row.id: row
                for row in session.scalars(
                    select(Source).where(
                        Source.id.in_({item.source_id for item in rows}),
                        Source.status != SourceStatus.TOMBSTONED.value,
                    )
                )
            }
            locator_map = {
                row.evidence_revision_id: row
                for row in session.scalars(
                    select(EvidenceLocator).where(
                        EvidenceLocator.evidence_revision_id.in_([item.id for item in rows])
                    )
                )
            }
            result: dict[str, EvidenceView] = {}
            for row in rows:
                source = source_map.get(row.source_id)
                locator = locator_map.get(row.id)
                if source is None or locator is None:
                    continue
                result[row.id] = self._evidence_view_from_rows(row, source, locator)
            return result

    def count_published_evidence(
        self,
        *,
        space_ids: tuple[str, ...],
        source_ids: tuple[str, ...],
        watermark: int | None,
    ) -> int:
        with self.database.transaction() as session:
            statement = select(func.count(func.distinct(EvidenceRevision.id))).where(
                EvidenceRevision.status == EvidenceStatus.PUBLISHED.value
            )
            if source_ids:
                statement = statement.where(EvidenceRevision.source_id.in_(source_ids))
            if space_ids:
                statement = statement.join(
                    SourceSpaceLink,
                    SourceSpaceLink.source_id == EvidenceRevision.source_id,
                ).where(
                    SourceSpaceLink.space_id.in_(space_ids),
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            if watermark is not None:
                statement = statement.where(
                    EvidenceRevision.visible_from_sequence <= watermark,
                    or_(
                        EvidenceRevision.visible_until_sequence.is_(None),
                        EvidenceRevision.visible_until_sequence > watermark,
                    ),
                )
            return int(session.scalar(statement) or 0)

    @staticmethod
    def _evidence_view(session: Session, row: EvidenceRevision) -> EvidenceView:
        source = session.get(Source, row.source_id)
        locator = session.get(EvidenceLocator, row.id)
        if locator is None:
            raise ConflictError(
                "Published Evidence has no Locator", details={"revision_id": row.id}
            )
        return SqlControlPlaneRepository._evidence_view_from_rows(row, source, locator)

    @staticmethod
    def _evidence_view_from_rows(
        row: EvidenceRevision, source: Source, locator: EvidenceLocator
    ) -> EvidenceView:
        return EvidenceView(
            id=row.id,
            source_id=row.source_id,
            source_version_id=row.source_version_id,
            source_name=source.display_name,
            modality=Modality(row.modality),
            evidence_type=row.evidence_type,
            text_content=row.text_content,
            searchable_text=row.searchable_text,
            status=EvidenceStatus(row.status),
            locator=Locator(
                locator_type=locator.locator_type,
                page_no=locator.page_no,
                bbox=tuple(locator.bbox) if locator.bbox else None,  # type: ignore[arg-type]
                start_ms=locator.start_ms,
                end_ms=locator.end_ms,
                sheet=locator.sheet,
                cell_range=locator.cell_range,
                char_start=locator.char_start,
                char_end=locator.char_end,
                extra=locator.extra,
            ),
            quality_flags=tuple(row.quality_flags),
            visible_from_sequence=row.visible_from_sequence,
            visible_until_sequence=row.visible_until_sequence,
            created_at=row.created_at,
        )
