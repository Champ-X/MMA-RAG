from __future__ import annotations

import hashlib
import mimetypes
import threading
from dataclasses import dataclass
from pathlib import Path

from nexus.modules.sources.domain import (
    IngestionJobView,
    IngestionLease,
    RawSourceCommand,
    SourceVersionView,
)
from nexus.modules.sources.ports import BlobStorePort, ParserPort, SourceRepositoryPort
from nexus.shared.domain.enums import Modality
from nexus.shared.domain.errors import ConflictError, DomainError, ValidationError
from nexus.shared.domain.ids import new_id


@dataclass(frozen=True, slots=True)
class IngestionResult:
    source_version: SourceVersionView
    job: IngestionJobView


class IngestionService:
    def __init__(
        self,
        *,
        repository: SourceRepositoryPort,
        blob_store: BlobStorePort,
        parser: ParserPort,
        max_upload_bytes: int,
        worker_lease_seconds: int = 120,
    ) -> None:
        self.repository = repository
        self.blob_store = blob_store
        self.parser = parser
        self.max_upload_bytes = max_upload_bytes
        self.worker_lease_seconds = worker_lease_seconds

    def ingest_bytes(
        self,
        *,
        space_id: str,
        filename: str,
        content: bytes,
        mime_type: str | None = None,
        source_id: str | None = None,
        connector_kind: str = "upload",
        canonical_uri: str | None = None,
        external_version: str | None = None,
        metadata: dict[str, object] | None = None,
        idempotency_key: str | None = None,
        process_inline: bool = True,
    ) -> IngestionResult:
        clean_filename = Path(filename).name.strip()
        if not clean_filename:
            raise ValidationError("Filename must not be empty")
        if not content:
            raise ValidationError("Uploaded source is empty")
        if len(content) > self.max_upload_bytes:
            raise ValidationError(
                "Uploaded source exceeds the configured limit",
                details={"byte_size": len(content), "limit": self.max_upload_bytes},
            )
        actual_mime = (
            mime_type or mimetypes.guess_type(clean_filename)[0] or "application/octet-stream"
        )
        content_hash = hashlib.sha256(content).hexdigest()
        object_key = f"raw/sha256/{content_hash[:2]}/{content_hash}"
        # Raw-first invariant: this write completes before any business version is parsed.
        self.blob_store.put(
            object_key,
            content,
            content_type=actual_mime,
            content_hash=content_hash,
        )
        command = RawSourceCommand(
            space_id=space_id,
            filename=clean_filename,
            mime_type=actual_mime,
            content_hash=content_hash,
            byte_size=len(content),
            object_key=object_key,
            modality=self.classify_modality(clean_filename, actual_mime),
            source_id=source_id,
            connector_kind=connector_kind,
            canonical_uri=canonical_uri,
            external_version=external_version,
            metadata=metadata or {},
            idempotency_key=idempotency_key,
        )
        version, job = self.repository.create_raw_source(command)
        if process_inline and job.status not in {"completed", "failed"}:
            self.process_job(job.id)
            version = self.repository.get_source_version(version.id)
            job = self.repository.get_ingestion_job(job.id)
        return IngestionResult(source_version=version, job=job)

    def process_job(
        self,
        job_id: str,
        *,
        lease: IngestionLease | None = None,
        worker_id: str | None = None,
    ) -> IngestionJobView:
        job = self.repository.get_ingestion_job(job_id)
        if job.status in {"completed", "failed", "cancelled"}:
            return job
        active_lease = lease or self.repository.acquire_ingestion(
            job_id,
            worker_id=worker_id or f"inline-ingestion-{new_id()}",
            lease_seconds=self.worker_lease_seconds,
        )
        try:
            with _LeaseHeartbeat(
                repository=self.repository,
                lease=active_lease,
                lease_seconds=self.worker_lease_seconds,
            ) as heartbeat:
                version = self.repository.start_ingestion(job_id, lease=active_lease)
                content = self.blob_store.get(version.object_key)
                parsed = self.parser.parse(
                    content=content,
                    filename=version.display_name,
                    mime_type=version.mime_type,
                    source_version=version,
                )
                asset_manifest: list[dict[str, object]] = []
                for asset in parsed.derived_assets:
                    self.blob_store.put(
                        asset.object_key,
                        asset.data,
                        content_type=asset.content_type,
                        content_hash=asset.content_hash,
                    )
                    asset_manifest.append(
                        {
                            "object_key": asset.object_key,
                            "content_hash": asset.content_hash,
                            "content_type": asset.content_type,
                            "byte_size": len(asset.data),
                            "role": asset.role,
                            "source_path": asset.source_path,
                        }
                    )
                if heartbeat.lost:
                    raise ConflictError(
                        "Ingestion lease was lost while the parser was running",
                        details={"job_id": job_id},
                    )
                manifest = dict(parsed.manifest)
                manifest["derived_assets"] = asset_manifest
                self.repository.publish_evidence(
                    job_id=job_id,
                    drafts=list(parsed.drafts),
                    parser_manifest=manifest,
                    capabilities=parsed.capabilities,
                    lease=active_lease,
                )
        except DomainError as exc:
            self._safe_fail(job_id, active_lease, code=exc.code, message=exc.message)
        except Exception as exc:
            self._safe_fail(
                job_id,
                active_lease,
                code="INGESTION_INTERNAL_ERROR",
                message=f"{type(exc).__name__}: {exc}",
            )
        return self.repository.get_ingestion_job(job_id)

    def retry(self, job_id: str, *, process_inline: bool = True) -> IngestionJobView:
        job = self.repository.retry_ingestion(job_id)
        return self.process_job(job.id) if process_inline else job

    def reprocess(self, source_id: str, *, process_inline: bool = True) -> IngestionJobView:
        job = self.repository.create_reprocess_job(source_id)
        return self.process_job(job.id) if process_inline else job

    def cancel(self, job_id: str) -> IngestionJobView:
        return self.repository.cancel_ingestion(job_id)

    def _safe_fail(
        self, job_id: str, lease: IngestionLease, *, code: str, message: str
    ) -> None:
        try:
            self.repository.fail_ingestion(
                job_id,
                code=code,
                message=message,
                lease=lease,
            )
        except ConflictError:
            # A newer fenced attempt owns the job; this worker must not overwrite it.
            return

    @staticmethod
    def classify_modality(filename: str, mime_type: str) -> Modality:
        extension = Path(filename).suffix.lower()
        if extension in {".csv", ".xlsx", ".xls", ".xlsm"}:
            return Modality.TABLE
        if mime_type.startswith("image/") or extension in {
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".gif",
            ".bmp",
            ".tif",
            ".tiff",
        }:
            return Modality.IMAGE
        if mime_type.startswith("audio/") or extension in {
            ".mp3",
            ".wav",
            ".m4a",
            ".flac",
            ".ogg",
            ".opus",
            ".aac",
            ".wma",
        }:
            return Modality.AUDIO
        if mime_type.startswith("video/") or extension in {
            ".mp4",
            ".mov",
            ".mkv",
            ".webm",
            ".avi",
            ".flv",
            ".wmv",
            ".m4v",
        }:
            return Modality.VIDEO
        return Modality.TEXT


class _LeaseHeartbeat:
    def __init__(
        self,
        *,
        repository: SourceRepositoryPort,
        lease: IngestionLease,
        lease_seconds: int,
    ) -> None:
        self.repository = repository
        self.lease = lease
        self.lease_seconds = lease_seconds
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def __enter__(self) -> _LeaseHeartbeat:
        self._thread = threading.Thread(
            target=self._run,
            name=f"ingestion-heartbeat-{self.lease.job_id[:8]}",
            daemon=True,
        )
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        interval = max(5.0, self.lease_seconds / 3)
        while not self._stop.wait(interval):
            try:
                self.lease = self.repository.renew_ingestion_lease(
                    self.lease,
                    lease_seconds=self.lease_seconds,
                )
            except Exception:
                self._lost.set()
                return
