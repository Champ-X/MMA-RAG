from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import Space, UploadPart, UploadSession
from nexus.modules.sources.uploads import UploadSessionView, expected_part_count
from nexus.shared.domain.errors import ConflictError, NotFoundError


class SqlUploadSessionRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create_upload_session(
        self,
        *,
        space_id: str,
        source_id: str | None,
        filename: str,
        mime_type: str,
        total_bytes: int,
        part_size: int,
        expected_hash: str | None,
        ttl_seconds: int,
    ) -> UploadSessionView:
        with self.database.transaction() as session:
            if session.get(Space, space_id) is None:
                raise NotFoundError("Space not found", details={"space_id": space_id})
            row = UploadSession(
                space_id=space_id,
                source_id=source_id,
                filename=filename,
                mime_type=mime_type,
                total_bytes=total_bytes,
                part_size=part_size,
                expected_hash=expected_hash,
                expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
            )
            session.add(row)
            session.flush()
            return self._view(session, row)

    def get_upload_session(self, session_id: str) -> UploadSessionView:
        with self.database.transaction() as session:
            row = session.get(UploadSession, session_id)
            if row is None:
                raise NotFoundError("Upload session not found", details={"session_id": session_id})
            expires_at = (
                row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
            )
            if row.status == "open" and expires_at <= datetime.now(UTC):
                row.status = "expired"
            return self._view(session, row)

    def record_upload_part(
        self,
        session_id: str,
        *,
        part_no: int,
        content_hash: str,
        byte_size: int,
        object_key: str,
    ) -> UploadSessionView:
        with self.database.transaction() as session:
            upload = session.get(UploadSession, session_id, with_for_update=True)
            if upload is None:
                raise NotFoundError("Upload session not found")
            if upload.status != "open":
                raise ConflictError("Upload session is not open")
            existing = session.scalar(
                select(UploadPart).where(
                    UploadPart.upload_session_id == session_id,
                    UploadPart.part_no == part_no,
                )
            )
            if existing:
                if existing.content_hash != content_hash or existing.byte_size != byte_size:
                    raise ConflictError("Upload part number already has different content")
            else:
                session.add(
                    UploadPart(
                        upload_session_id=session_id,
                        part_no=part_no,
                        content_hash=content_hash,
                        byte_size=byte_size,
                        object_key=object_key,
                    )
                )
                session.flush()
            return self._view(session, upload)

    def complete_upload_session(self, session_id: str, *, job_id: str) -> UploadSessionView:
        with self.database.transaction() as session:
            row = session.get(UploadSession, session_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Upload session not found")
            if row.status == "completed" and row.completed_job_id != job_id:
                raise ConflictError("Upload session already completed with another job")
            row.status = "completed"
            row.completed_job_id = job_id
            return self._view(session, row)

    def list_part_objects(self, session_id: str) -> list[tuple[int, str, str, int]]:
        with self.database.transaction() as session:
            if session.get(UploadSession, session_id) is None:
                raise NotFoundError("Upload session not found")
            parts = session.scalars(
                select(UploadPart)
                .where(UploadPart.upload_session_id == session_id)
                .order_by(UploadPart.part_no)
            )
            return [
                (part.part_no, part.object_key, part.content_hash, part.byte_size) for part in parts
            ]

    @staticmethod
    def _view(session: object, row: UploadSession) -> UploadSessionView:
        parts = list(
            session.scalars(  # type: ignore[attr-defined]
                select(UploadPart.part_no)
                .where(UploadPart.upload_session_id == row.id)
                .order_by(UploadPart.part_no)
            )
        )
        return UploadSessionView(
            id=row.id,
            space_id=row.space_id,
            source_id=row.source_id,
            filename=row.filename,
            mime_type=row.mime_type,
            total_bytes=row.total_bytes,
            part_size=row.part_size,
            expected_hash=row.expected_hash,
            expected_parts=expected_part_count(row.total_bytes, row.part_size),
            received_parts=tuple(parts),
            status=row.status,
            expires_at=row.expires_at,
            completed_job_id=row.completed_job_id,
        )
