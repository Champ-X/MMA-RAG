from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tarfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.engine import make_url

from nexus import __version__
from nexus.config import NexusSettings
from nexus.infrastructure.mineru import MinerURemoteAdapter
from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import (
    BackupManifest,
    EvidenceLocator,
    EvidenceRevision,
    IngestionJob,
    ReconciliationIssue,
    Run,
)
from nexus.modules.retrieval.ports import ProjectionPublisherPort
from nexus.modules.sources.ports import BlobStorePort
from nexus.modules.tools.ports import SandboxRunnerPort
from nexus.shared.domain.enums import EvidenceStatus
from nexus.shared.domain.errors import CapabilityUnavailableError, ConflictError, ValidationError


class OperationsService:
    def __init__(
        self,
        *,
        settings: NexusSettings,
        database: Database,
        blob_store: BlobStorePort,
        index: ProjectionPublisherPort | None,
        mineru: MinerURemoteAdapter | None = None,
        sandbox: SandboxRunnerPort | None = None,
    ) -> None:
        self.settings = settings
        self.database = database
        self.blob_store = blob_store
        self.index = index
        self.mineru = mineru
        self.sandbox = sandbox

    def doctor(self) -> dict[str, object]:
        checks: dict[str, dict[str, object]] = {}
        try:
            with self.database.transaction() as session:
                session.execute(select(1))
                counts = {
                    "runs": session.scalar(select(func.count(Run.id))) or 0,
                    "evidence": session.scalar(select(func.count(EvidenceRevision.id))) or 0,
                    "pending_jobs": session.scalar(
                        select(func.count(IngestionJob.id)).where(
                            IngestionJob.status.in_(["pending", "running"])
                        )
                    )
                    or 0,
                }
            checks["database"] = {"status": "ready", **counts}
        except Exception as exc:
            checks["database"] = {
                "status": "unavailable",
                "error_type": type(exc).__name__,
            }
        if self.settings.blob_backend == "filesystem":
            root = self.settings.blob_root.resolve()
            root.mkdir(parents=True, exist_ok=True)
            usage = shutil.disk_usage(root)
            checks["blob"] = {
                "status": "ready",
                "backend": "filesystem",
                "free_bytes": usage.free,
                "total_bytes": usage.total,
            }
        else:
            try:
                probe_key = "operations/doctor-empty"
                empty_hash = hashlib.sha256(b"").hexdigest()
                self.blob_store.put(
                    probe_key, b"", content_type="application/octet-stream", content_hash=empty_hash
                )
                self.blob_store.delete(probe_key)
                checks["blob"] = {"status": "ready", "backend": "minio"}
            except Exception as exc:
                checks["blob"] = {
                    "status": "unavailable",
                    "error_type": type(exc).__name__,
                }
        checks["qdrant"] = self.index.health() if self.index else {"status": "not_configured"}
        credential = (
            self.mineru.credential_status()
            if self.mineru
            else {"status": "not_configured", "token_configured": False}
        )
        checks["mineru"] = {
            **credential,
            "adapter": "precision_api",
            "base_url": self.settings.mineru_base_url,
            "model": self.settings.mineru_model,
        }
        checks["ffmpeg"] = {
            "status": "ready"
            if shutil.which("ffmpeg") and shutil.which("ffprobe")
            else "unavailable",
            "ffmpeg": shutil.which("ffmpeg"),
            "ffprobe": shutil.which("ffprobe"),
        }
        checks["sandbox"] = (
            self.sandbox.health() if self.sandbox else {"status": "not_configured"}
        )
        control_ready = (
            checks["database"]["status"] == "ready" and checks["blob"]["status"] == "ready"
        )
        return {
            "status": "ready" if control_ready else "unavailable",
            "control_ready": control_ready,
            "checks": checks,
            "version": __version__,
        }

    def reconcile(self) -> dict[str, object]:
        found: list[dict[str, object]] = []
        with self.database.transaction() as session:
            rows = list(
                session.execute(
                    select(EvidenceRevision.id, EvidenceRevision.source_version_id)
                    .outerjoin(
                        EvidenceLocator,
                        EvidenceLocator.evidence_revision_id == EvidenceRevision.id,
                    )
                    .where(
                        EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                        EvidenceLocator.evidence_revision_id.is_(None),
                    )
                )
            )
            for revision_id, source_version_id in rows:
                detail = {"source_version_id": source_version_id}
                issue = session.scalar(
                    select(ReconciliationIssue).where(
                        ReconciliationIssue.issue_type == "published_evidence_missing_locator",
                        ReconciliationIssue.resource_id == revision_id,
                        ReconciliationIssue.status == "open",
                    )
                )
                if issue is None:
                    issue = ReconciliationIssue(
                        issue_type="published_evidence_missing_locator",
                        severity="error",
                        resource_type="evidence_revision",
                        resource_id=revision_id,
                        detail=detail,
                    )
                    session.add(issue)
                found.append(
                    {
                        "issue_type": issue.issue_type,
                        "resource_id": revision_id,
                        "severity": issue.severity,
                    }
                )
        index_health = self.index.health() if self.index else {"status": "not_configured"}
        return {
            "status": "issues_found" if found else "clean",
            "issues": found,
            "index": index_health,
        }

    def backup(self, destination: Path) -> dict[str, object]:
        destination = destination.expanduser().resolve()
        destination.mkdir(parents=True, exist_ok=True)
        backup_id: str
        with self.database.transaction() as session:
            row = BackupManifest(status="creating", destination=str(destination))
            session.add(row)
            session.flush()
            backup_id = row.id
        work = destination / backup_id
        work.mkdir(parents=True, exist_ok=False)
        try:
            database_file = work / "database.dump"
            database_kind = self._dump_database(database_file)
            blobs_file = work / "blobs.tar.gz"
            blob_manifest = self._dump_blobs(blobs_file)
            manifest = {
                "schema": "nexus.backup-manifest.v1",
                "backup_id": backup_id,
                "created_at": datetime.now(UTC).isoformat(),
                "app_version": __version__,
                "database": {
                    "kind": database_kind,
                    "file": database_file.name,
                    "sha256": _sha256_file(database_file),
                },
                "blobs": {
                    "file": blobs_file.name,
                    "sha256": _sha256_file(blobs_file),
                    "objects": blob_manifest,
                },
                "qdrant": {
                    "included": False,
                    "restore_strategy": "rebuild_from_authoritative_database_and_blobs",
                },
                "secrets_included": False,
            }
            manifest_path = work / "manifest.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            with self.database.transaction() as session:
                row = session.get(BackupManifest, backup_id)
                if row:
                    row.status = "completed"
                    row.manifest = manifest
                    row.verified = self.verify_backup(work)["status"] == "verified"
            return {"status": "completed", "path": str(work), "manifest": manifest}
        except Exception as exc:
            with self.database.transaction() as session:
                row = session.get(BackupManifest, backup_id)
                if row:
                    row.status = "failed"
                    row.error = type(exc).__name__
            raise

    def list_backups(self, *, limit: int = 50) -> list[dict[str, object]]:
        with self.database.transaction() as session:
            rows = session.scalars(
                select(BackupManifest).order_by(BackupManifest.created_at.desc()).limit(limit)
            )
            return [
                {
                    "id": row.id,
                    "status": row.status,
                    "destination": row.destination,
                    "verified": row.verified,
                    "manifest": row.manifest,
                    "error": row.error,
                    "created_at": row.created_at,
                    "updated_at": row.updated_at,
                }
                for row in rows
            ]

    def verify_backup(self, path: Path) -> dict[str, object]:
        path = path.expanduser().resolve()
        manifest_path = path / "manifest.json"
        if not manifest_path.is_file():
            raise ValidationError("Backup manifest is missing")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        errors: list[str] = []
        for section in ("database", "blobs"):
            item = manifest[section]
            file_path = path / item["file"]
            if not file_path.is_file():
                errors.append(f"{section}:missing")
            elif _sha256_file(file_path) != item["sha256"]:
                errors.append(f"{section}:hash_mismatch")
        return {"status": "verified" if not errors else "invalid", "errors": errors}

    def restore_backup(
        self,
        path: Path,
        *,
        target_database_url: str,
        target_blob_root: Path,
    ) -> dict[str, object]:
        """Restore a verified backup into an explicitly empty target.

        The running control plane is never overwritten. Qdrant is deliberately not
        restored here: it is a derived projection and must be rebuilt after the
        authoritative database and objects have passed reconciliation.
        """
        return restore_backup_to_empty(
            path,
            target_database_url=target_database_url,
            target_blob_root=target_blob_root,
        )

    def _dump_database(self, destination: Path) -> str:
        if self.settings.database_url.startswith("sqlite:///"):
            source = Path(self.settings.database_url.removeprefix("sqlite:///")).resolve()
            source_connection = sqlite3.connect(source)
            destination_connection = sqlite3.connect(destination)
            try:
                source_connection.backup(destination_connection)
            finally:
                destination_connection.close()
                source_connection.close()
            return "sqlite"
        pg_dump = shutil.which("pg_dump")
        if not pg_dump:
            raise CapabilityUnavailableError("pg_dump is required for PostgreSQL backup")
        url = make_url(self.settings.database_url)
        environment = {**os.environ, "PGPASSWORD": url.password or ""}
        subprocess.run(
            [
                pg_dump,
                "--format=custom",
                "--file",
                str(destination),
                "--host",
                url.host or "localhost",
                "--port",
                str(url.port or 5432),
                "--username",
                url.username or "",
                url.database or "",
            ],
            check=True,
            timeout=3600,
            env=environment,
        )
        return "postgresql_custom"

    def _dump_blobs(self, destination: Path) -> list[dict[str, object]]:
        objects: list[dict[str, object]] = []
        with tarfile.open(destination, "w:gz") as archive:
            for key in sorted(self.blob_store.list_keys()):
                data = self.blob_store.get(key)
                info = tarfile.TarInfo(name=key)
                info.size = len(data)
                info.mtime = int(datetime.now(UTC).timestamp())
                info.mode = 0o600
                archive.addfile(info, io.BytesIO(data))
                objects.append(
                    {
                        "key": key,
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
        return objects


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def restore_backup_to_empty(
    path: Path,
    *,
    target_database_url: str,
    target_blob_root: Path,
) -> dict[str, object]:
    path = path.expanduser().resolve()
    manifest_path = path / "manifest.json"
    if not manifest_path.is_file():
        raise ValidationError("Backup manifest is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "nexus.backup-manifest.v1":
        raise ValidationError("Unsupported backup manifest schema")
    for section in ("database", "blobs"):
        item = manifest.get(section, {})
        source = path / str(item.get("file", ""))
        if not source.is_file() or _sha256_file(source) != item.get("sha256"):
            raise ValidationError(
                "Backup verification failed before restore", details={"section": section}
            )

    target_blob_root = target_blob_root.expanduser().resolve()
    if target_blob_root.exists() and any(target_blob_root.iterdir()):
        raise ConflictError(
            "Restore target blob root must be empty",
            details={"target_blob_root": str(target_blob_root)},
        )
    target_blob_root.mkdir(parents=True, exist_ok=True)

    database_kind = str(manifest["database"].get("kind"))
    database_source = path / str(manifest["database"]["file"])
    _restore_database(database_source, database_kind, target_database_url)
    _restore_blobs(path / str(manifest["blobs"]["file"]), target_blob_root)

    object_errors: list[str] = []
    for item in manifest["blobs"].get("objects", []):
        key = str(item.get("key", ""))
        restored = _safe_restore_path(target_blob_root, key)
        if not restored.is_file():
            object_errors.append(f"{key}:missing")
        elif restored.stat().st_size != int(item.get("size", -1)):
            object_errors.append(f"{key}:size_mismatch")
        elif _sha256_file(restored) != item.get("sha256"):
            object_errors.append(f"{key}:hash_mismatch")
    if object_errors:
        raise ValidationError(
            "Restored object integrity check failed", details={"errors": object_errors}
        )
    return {
        "status": "restored",
        "backup_id": manifest.get("backup_id"),
        "readiness": {
            "control_plane": "restored",
            "media": "available",
            "search": "rebuild_required",
            "reconciliation": "pending",
        },
        "target_database_url": _redact_database_url(target_database_url),
        "target_blob_root": str(target_blob_root),
        "object_count": len(manifest["blobs"].get("objects", [])),
    }


def _restore_database(source: Path, kind: str, target_database_url: str) -> None:
    if kind == "sqlite":
        prefix = "sqlite:///"
        if not target_database_url.startswith(prefix):
            raise ValidationError("SQLite backup requires a sqlite:/// restore target")
        target = Path(target_database_url.removeprefix(prefix)).expanduser().resolve()
        if target.exists() and target.stat().st_size > 0:
            raise ConflictError(
                "Restore target database must be empty", details={"target": str(target)}
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return
    if kind != "postgresql_custom":
        raise ValidationError("Unsupported database backup kind", details={"kind": kind})
    engine = create_engine(target_database_url)
    try:
        if inspect(engine).get_table_names(schema="public"):
            raise ConflictError("Restore target PostgreSQL database must be empty")
    finally:
        engine.dispose()
    pg_restore = shutil.which("pg_restore")
    if not pg_restore:
        raise CapabilityUnavailableError("pg_restore is required for PostgreSQL restore")
    target = make_url(target_database_url)
    environment = {**os.environ, "PGPASSWORD": target.password or ""}
    subprocess.run(
        [
            pg_restore,
            "--exit-on-error",
            "--no-owner",
            "--host",
            target.host or "localhost",
            "--port",
            str(target.port or 5432),
            "--username",
            target.username or "",
            "--dbname",
            target.database or "",
            str(source),
        ],
        check=True,
        timeout=3600,
        env=environment,
    )


def _restore_blobs(source: Path, target_root: Path) -> None:
    with tarfile.open(source, "r:gz") as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            if not member.isfile():
                raise ValidationError(
                    "Backup contains an unsupported object type", details={"name": member.name}
                )
            destination = _safe_restore_path(target_root, member.name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source_handle = archive.extractfile(member)
            if source_handle is None:
                raise ValidationError(
                    "Backup object could not be read", details={"name": member.name}
                )
            with source_handle, destination.open("xb") as output:
                shutil.copyfileobj(source_handle, output)


def _safe_restore_path(root: Path, name: str) -> Path:
    if not name or Path(name).is_absolute():
        raise ValidationError("Backup object path is invalid", details={"name": name})
    destination = (root / name).resolve()
    if root != destination and root not in destination.parents:
        raise ValidationError("Backup object escapes target root", details={"name": name})
    return destination


def _redact_database_url(value: str) -> str:
    return re.sub(r"(?<=://)[^/@]+@", "***@", value)
