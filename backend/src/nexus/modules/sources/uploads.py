from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from nexus.modules.sources.application import IngestionResult, IngestionService
from nexus.modules.sources.ports import BlobStorePort
from nexus.shared.domain.errors import ConflictError, ValidationError


@dataclass(frozen=True, slots=True)
class UploadSessionView:
    id: str
    space_id: str
    source_id: str | None
    filename: str
    mime_type: str
    total_bytes: int
    part_size: int
    expected_hash: str | None
    expected_parts: int
    received_parts: tuple[int, ...]
    status: str
    expires_at: datetime
    completed_job_id: str | None


class UploadSessionRepositoryPort(Protocol):
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
    ) -> UploadSessionView: ...

    def get_upload_session(self, session_id: str) -> UploadSessionView: ...

    def record_upload_part(
        self,
        session_id: str,
        *,
        part_no: int,
        content_hash: str,
        byte_size: int,
        object_key: str,
    ) -> UploadSessionView: ...

    def complete_upload_session(self, session_id: str, *, job_id: str) -> UploadSessionView: ...

    def list_part_objects(self, session_id: str) -> list[tuple[int, str, str, int]]: ...


class UploadSessionService:
    def __init__(
        self,
        *,
        repository: UploadSessionRepositoryPort,
        blob_store: BlobStorePort,
        ingestion: IngestionService,
        process_inline: bool = True,
    ) -> None:
        self.repository = repository
        self.blob_store = blob_store
        self.ingestion = ingestion
        self.process_inline = process_inline

    def create(
        self,
        *,
        space_id: str,
        filename: str,
        mime_type: str,
        total_bytes: int,
        part_size: int = 8 * 1024 * 1024,
        expected_hash: str | None = None,
        source_id: str | None = None,
    ) -> UploadSessionView:
        if total_bytes <= 0 or total_bytes > self.ingestion.max_upload_bytes:
            raise ValidationError("Upload size is outside the configured limit")
        if part_size < 1024 * 1024 or part_size > 64 * 1024 * 1024:
            raise ValidationError("Part size must be between 1 MiB and 64 MiB")
        if expected_hash and not _valid_hash(expected_hash):
            raise ValidationError("expected_hash must be a SHA-256 hex digest")
        return self.repository.create_upload_session(
            space_id=space_id,
            source_id=source_id,
            filename=filename,
            mime_type=mime_type,
            total_bytes=total_bytes,
            part_size=part_size,
            expected_hash=expected_hash,
            ttl_seconds=24 * 60 * 60,
        )

    def put_part(
        self, session_id: str, *, part_no: int, content: bytes, expected_hash: str
    ) -> UploadSessionView:
        session = self.repository.get_upload_session(session_id)
        if session.status != "open":
            raise ConflictError("Upload session is not open")
        if part_no < 1 or part_no > session.expected_parts:
            raise ValidationError("Part number is outside the upload manifest")
        content_hash = hashlib.sha256(content).hexdigest()
        if content_hash != expected_hash:
            raise ConflictError(
                "Upload part hash mismatch",
                details={"expected": expected_hash, "actual": content_hash},
            )
        if len(content) > session.part_size:
            raise ValidationError("Upload part exceeds the negotiated part size")
        key = f"uploads/{session_id}/parts/{part_no:08d}-{content_hash}"
        self.blob_store.put(
            key,
            content,
            content_type="application/octet-stream",
            content_hash=content_hash,
        )
        return self.repository.record_upload_part(
            session_id,
            part_no=part_no,
            content_hash=content_hash,
            byte_size=len(content),
            object_key=key,
        )

    def complete(self, session_id: str, *, expected_hash: str | None = None) -> IngestionResult:
        session = self.repository.get_upload_session(session_id)
        if session.status == "completed" and session.completed_job_id:
            job = self.ingestion.repository.get_ingestion_job(session.completed_job_id)
            source = self.ingestion.repository.get_source_version(job.source_version_id)
            return IngestionResult(source_version=source, job=job)
        parts = self.repository.list_part_objects(session_id)
        if [part[0] for part in parts] != list(range(1, session.expected_parts + 1)):
            raise ConflictError(
                "Upload session is incomplete",
                details={"received_parts": [part[0] for part in parts]},
            )
        content = b"".join(self.blob_store.get(part[1]) for part in parts)
        if len(content) != session.total_bytes:
            raise ConflictError(
                "Completed upload size does not match manifest",
                details={"expected": session.total_bytes, "actual": len(content)},
            )
        content_hash = hashlib.sha256(content).hexdigest()
        declared_hash = expected_hash or session.expected_hash
        if declared_hash and content_hash != declared_hash:
            raise ConflictError("Completed upload hash does not match manifest")
        result = self.ingestion.ingest_bytes(
            space_id=session.space_id,
            filename=session.filename,
            content=content,
            mime_type=session.mime_type,
            source_id=session.source_id,
            idempotency_key=f"upload-session:{session.id}",
            process_inline=self.process_inline,
        )
        self.repository.complete_upload_session(session.id, job_id=result.job.id)
        return result


def expected_part_count(total_bytes: int, part_size: int) -> int:
    return math.ceil(total_bytes / part_size)


def _valid_hash(value: str) -> bool:
    return len(value) == 64 and all(char in "0123456789abcdefABCDEF" for char in value)
