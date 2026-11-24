from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import sys
from uuid import UUID
import zipfile

from app.core.file_lock import lock_file, unlock_file

FORMAT = "tessmora-workspace-backup"
EXCLUDED_COMPONENTS = {"logs", "cache", "models", "credentials", ".staging", "__pycache__"}
EXCLUDED_FILES = {"runtime.env", ".env", ".workspace.lock", "supervisor.lock", "runtime.json", "runtime-state.json"}
SECRET_CONFIG_FIELDS = {"credentials", "credential_ref", "credential_store_locked", "api_key", "api_token", "access_token", "secret_key", "password"}


class TransferError(ValueError):
    pass


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def workspace_identity(root: Path) -> dict:
    try:
        value = json.loads((root / "workspace.json").read_text())
        if value.get("format") != 1 or str(UUID(value["id"])) != value["id"]:
            raise ValueError()
        return value
    except (OSError, ValueError, KeyError, TypeError):
        raise TransferError("Workspace identity is missing or unsupported") from None


@contextmanager
def workspace_lock(root: Path):
    if not root.is_dir() or root.is_symlink():
        raise TransferError("Workspace must be an existing real directory")
    path = root / ".workspace.lock"
    if path.is_symlink():
        raise TransferError("Workspace lock must not be a symbolic link")
    with path.open("a+b") as stream:
        try:
            lock_file(stream, wait=False)
        except OSError:
            raise TransferError("Workspace is running; stop its local runtime before transferring data") from None
        try:
            yield
        finally:
            unlock_file(stream)


def _excluded(relative: Path) -> bool:
    return (bool(relative.parts) and relative.parts[0] in EXCLUDED_COMPONENTS) or any(
        part in {".staging", "__pycache__"} for part in relative.parts) or (
        relative.name in EXCLUDED_FILES or relative.name.endswith((".lock", "-wal", "-shm", "-journal", ".part")))


def _sanitize_config(value):
    if isinstance(value, dict):
        return {key: _sanitize_config(item) for key, item in value.items() if key.lower() not in SECRET_CONFIG_FIELDS}
    if isinstance(value, list):
        return [_sanitize_config(item) for item in value]
    return value


def _sqlite_backup(source: Path, destination: Path):
    # SQLite backup includes committed WAL pages without copying lock/SHM files.
    original = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
    copied = sqlite3.connect(destination)
    try:
        original.backup(copied)
        if copied.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise TransferError(f"SQLite integrity check failed: {source.name}")
    finally:
        copied.close()
        original.close()


def copy_data_tree(source: Path, destination: Path, *, excluded=True):
    """Copy owned data only, rejecting links and devices instead of following them."""
    if not source.exists():
        return
    if source.is_symlink() or not source.is_dir():
        raise TransferError("Data root must be a real directory")
    for directory, directories, files in os.walk(source, followlinks=False):
        relative = Path(directory).relative_to(source)
        for name in list(directories):
            child = Path(directory) / name
            if child.is_symlink():
                raise TransferError(f"Symbolic links are not supported in workspace data: {relative / name}")
            if excluded and _excluded(relative / name):
                directories.remove(name)
        (destination / relative).mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in files:
            child, rel = Path(directory) / name, relative / name
            if excluded and _excluded(rel):
                continue
            if child.is_symlink() or not stat.S_ISREG(child.stat(follow_symlinks=False).st_mode):
                raise TransferError(f"Only ordinary files can be transferred: {rel}")
            target = destination / rel
            if target.exists():
                if target.is_file() and sha256(target) == sha256(child):
                    continue
                raise TransferError(f"Conflicting migration data: {rel}")
            with child.open("rb") as stream:
                signature = stream.read(16)
            if signature == b"SQLite format 3\x00":
                _sqlite_backup(child.resolve(), target)
            elif name == "setup.json":
                target.write_bytes(json_bytes(_sanitize_config(json.loads(child.read_text()))))
            else:
                shutil.copyfile(child, target)
            target.chmod(0o600)
            with target.open("rb") as committed:
                os.fsync(committed.fileno())


def _publish_directory(staging: Path, destination: Path):
    """Atomic no-replace rename, including a concurrently created empty directory."""
    if os.name == "nt":
        os.rename(staging, destination)  # Windows refuses an existing destination.
        return
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        operation = libc.renamex_np
        operation.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = operation(os.fsencode(staging), os.fsencode(destination), 4)  # RENAME_EXCL
    elif hasattr(libc, "renameat2"):
        operation = libc.renameat2
        operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        result = operation(-100, os.fsencode(staging), -100, os.fsencode(destination), 1)  # RENAME_NOREPLACE
    else:
        raise TransferError("This platform has no supported atomic workspace publication")
    if result:
        import errno
        number = ctypes.get_errno()
        if number in {errno.EEXIST, errno.ENOTEMPTY}:
            raise TransferError("Destination appeared during transfer; no data was replaced")
        raise OSError(number, "Could not publish the transferred workspace")
    descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def rewrite_owned_paths(workspace: Path, mappings: list[tuple[str, str]], destination: Path | None):
    """Only host-owned attachment/payload fields are relocatable, never user text."""
    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {}
        for key, item in value.items():
            if key in {"local_path", "_payload"} and isinstance(item, str) and item:
                if item.startswith("workspace://"):
                    relative = item[len("workspace://"):]
                else:
                    match = next(((prefix, relative) for prefix, relative in mappings if item.startswith(prefix)), None)
                    if match is None:
                        raise TransferError("A saved attachment points outside the transferred workspace")
                    relative = match[1] + item[len(match[0]):]
                relative = relative.replace("\\", "/")
                if not _safe_member(relative) or not (workspace / relative).is_file():
                    raise TransferError(f"Missing transferred attachment or collection payload: {relative}")
                if key == "local_path" and value.get("attachment_id"):
                    path = workspace / relative
                    if path.stat().st_size != value.get("size") or sha256(path) != value.get("version"):
                        raise TransferError(f"Attachment integrity check failed: {relative}")
                result[key] = str(destination / relative) if destination else "workspace://" + relative
            else:
                result[key] = rewrite(item)
        return result
    for relative, table, column, identity in (
        ("state/pi-agent/runs.sqlite3", "pi_artifacts", "artifact_json", "rowid"),
        ("state/data/collection/runs.sqlite3", "collection_runs", "state_json", "rowid"),
    ):
        database = workspace / relative
        if not database.is_file():
            continue
        with sqlite3.connect(database) as db:
            for row_id, encoded in db.execute(f"SELECT {identity},{column} FROM {table}").fetchall():
                updated = rewrite(json.loads(encoded))
                db.execute(f"UPDATE {table} SET {column}=? WHERE {identity}=?", (json.dumps(updated, ensure_ascii=False), row_id))


@contextmanager
def new_workspace(destination: Path):
    """A failure leaves the source intact and no partially imported destination."""
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise TransferError("Destination already exists; choose a new workspace directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.transfer-", dir=destination.parent))
    try:
        with workspace_lock(staging):
            yield staging
            # Never replace existing data, including a directory created during transfer.
            if destination.exists() or destination.is_symlink():
                raise TransferError("Destination appeared during transfer; no data was replaced")
        # Windows cannot rename an open lock handle. The destination is still
        # unpublished until this operation; the host knows only its final path.
        _publish_directory(staging, destination)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def backup(workspace: Path, output: Path, *, client_history: Path | None = None) -> dict:
    workspace, output = workspace.absolute(), output.absolute()
    if output.exists() or output.is_symlink():
        raise TransferError("Backup output already exists")
    if output.is_relative_to(workspace):
        raise TransferError("Backup must be outside the workspace")
    output.parent.mkdir(parents=True, exist_ok=True)
    with workspace_lock(workspace), tempfile.TemporaryDirectory(prefix="tessmora-backup-") as scratch:
        identity = workspace_identity(workspace)
        stage = Path(scratch)
        (stage / "workspace.json").write_bytes(json_bytes(identity))
        for directory in ("state", "qdrant"):
            copy_data_tree(workspace / directory, stage / directory, excluded=directory == "state")
        rewrite_owned_paths(stage, [(str(workspace) + os.sep, "")], None)
        validate_objects(stage)
        if client_history is not None:
            if client_history.is_symlink() or not client_history.is_file():
                raise TransferError("Client history export must be an ordinary file")
            (stage / "client").mkdir()
            shutil.copyfile(client_history, stage / "client" / "history-export")
        entries = []
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                entries.append({"path": path.relative_to(stage).as_posix(), "size": path.stat().st_size, "sha256": sha256(path)})
        manifest = {"format": FORMAT, "version": 1, "workspace_id": identity["id"],
                    "created_at": datetime.now(timezone.utc).isoformat(), "files": entries,
                    "credentials_included": False, "client_history_included": client_history is not None,
                    "client_history_name": client_history.name if client_history else None,
                    "required_qdrant_version": identity.get("qdrant_version")}
        descriptor, temporary = tempfile.mkstemp(prefix=".backup-", suffix=".zip", dir=output.parent)
        os.close(descriptor)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                archive.writestr("manifest.json", json_bytes(manifest))
                for entry in entries:
                    archive.write(stage / entry["path"], entry["path"])
            verify(Path(temporary))
            with open(temporary, "rb") as completed:
                os.fsync(completed.fileno())
            # Hard-link publication is exclusive; an existing backup is never replaced.
            os.link(temporary, output)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return {"archive": str(output), "workspace_id": identity["id"], "files": len(entries),
            "sha256": sha256(output), "credentials_included": False,
            "client_history_included": client_history is not None}


def _safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    return (bool(name) and not path.is_absolute() and "\\" not in name and ":" not in name
            and all(part not in {"", ".", ".."} for part in name.split("/"))
            and path.parts[0] in {"workspace.json", "state", "qdrant", "client"})


def _validated_manifest(archive):
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(set(names)) or names.count("manifest.json") != 1:
        raise TransferError("Backup contains duplicate entries or no manifest")
    metadata = archive.getinfo("manifest.json")
    if metadata.file_size > 16 * 1024 * 1024:
        raise TransferError("Backup manifest is too large")
    manifest = json.loads(archive.read(metadata))
    if manifest.get("format") != FORMAT or manifest.get("version") != 1 or manifest.get("credentials_included") is not False:
        raise TransferError("Unsupported backup format or credential policy")
    UUID(manifest["workspace_id"])
    records = manifest.get("files")
    if not isinstance(records, list) or len(records) > 1_000_000:
        raise TransferError("Invalid backup file manifest")
    entries = {}
    for entry in records:
        name = entry.get("path", "")
        parts = PurePosixPath(name).parts
        excluded = bool(parts) and parts[0] == "state" and _excluded(Path(*parts[1:]))
        if not _safe_member(name) or name in entries or excluded:
            raise TransferError("Backup contains an unsafe or excluded path")
        if not isinstance(entry.get("size"), int) or entry["size"] < 0 or not re.fullmatch(r"[a-f0-9]{64}", entry.get("sha256", "")):
            raise TransferError("Backup file checksum record is invalid")
        entries[name] = entry
    if set(names) != {"manifest.json", *entries} or "workspace.json" not in entries:
        raise TransferError("Backup files do not match the manifest")
    for info in infos:
        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode) or info.is_dir() or info.flag_bits & 1:
            raise TransferError("Backup contains a link, directory or encrypted entry")
        if info.filename != "manifest.json" and info.file_size != entries[info.filename]["size"]:
            raise TransferError("Backup file size does not match the manifest")
    return manifest, entries


def verify(archive_path: Path) -> dict:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            manifest, entries = _validated_manifest(archive)
            for name, entry in entries.items():
                digest = hashlib.sha256()
                with archive.open(name) as source:
                    while block := source.read(1024 * 1024):
                        digest.update(block)
                if digest.hexdigest() != entry["sha256"]:
                    raise TransferError(f"Backup checksum mismatch: {name}")
            identity = json.loads(archive.read("workspace.json"))
            if identity.get("format") != 1 or identity.get("id") != manifest["workspace_id"]:
                raise TransferError("Backup workspace identity does not match its manifest")
            for name in entries:
                if PurePosixPath(name).name == "setup.json":
                    value = json.loads(archive.read(name))
                    if _sanitize_config(value) != value:
                        raise TransferError("Backup contains application credentials")
            catalog = "state/objects-metadata/catalog.sqlite3"
            if catalog in entries:
                with tempfile.TemporaryDirectory(prefix="tessmora-verify-") as scratch:
                    database = Path(scratch) / "objects.sqlite3"
                    with archive.open(catalog) as source, database.open("wb") as target:
                        shutil.copyfileobj(source, target)
                    db = sqlite3.connect(database)
                    try:
                        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                            raise TransferError("Backup object catalog is damaged")
                        for bucket, key, blob, size in db.execute("SELECT bucket,key,blob,size FROM objects"):
                            entry = entries.get(f"state/objects/{bucket}/{blob}")
                            if not entry or entry["size"] != size or entry["sha256"] != blob:
                                raise TransferError(f"Backup is missing original object bytes: {bucket}/{key}")
                    finally:
                        db.close()
            return manifest
    except (zipfile.BadZipFile, KeyError, TypeError, json.JSONDecodeError, UnicodeError) as error:
        raise TransferError("Backup archive is invalid or incomplete") from error


def validate_objects(workspace: Path) -> dict:
    """Validate the catalog, immutable bytes and stable object identities."""
    database = workspace / "state" / "objects-metadata" / "catalog.sqlite3"
    if not database.exists():
        return {"objects": 0, "bytes": 0}
    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    total, count = 0, 0
    try:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise TransferError("Object catalog integrity check failed")
        for bucket, key, blob, size in db.execute("SELECT bucket,key,blob,size FROM objects"):
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or ".." in bucket or not re.fullmatch(r"[a-f0-9]{64}", blob):
                raise TransferError("Object catalog contains an invalid blob identity")
            path = workspace / "state" / "objects" / bucket / blob
            if path.is_symlink() or not path.is_file() or path.stat().st_size != size or sha256(path) != blob:
                raise TransferError(f"Missing or damaged object: {bucket}/{key}")
            total += size
            count += 1
    finally:
        db.close()
    return {"objects": count, "bytes": total}


def restore(archive_path: Path, destination: Path) -> dict:
    manifest = verify(archive_path)
    required = sum(entry["size"] for entry in manifest["files"])
    destination = destination.absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(destination.parent).free < required + max(64 * 1024 * 1024, required // 20):
        raise TransferError("Not enough free space to restore this workspace")
    with new_workspace(destination) as staging:
        with zipfile.ZipFile(archive_path) as archive:
            for entry in manifest["files"]:
                target = staging / entry["path"]
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.open(entry["path"]) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
                target.chmod(0o600)
                # Re-check extraction, including an archive changed after verify().
                if sha256(target) != entry["sha256"]:
                    raise TransferError("Archive changed while restoring")
        for database in staging.rglob("*"):
            if database.is_file():
                with database.open("rb") as stream:
                    signature = stream.read(16)
                if signature == b"SQLite format 3\x00":
                    db = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
                    try:
                        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                            raise TransferError(f"Restored database is damaged: {database.name}")
                    finally:
                        db.close()
        if manifest["client_history_included"]:
            client = staging / "client"
            exported = client / "history-export"
            named = client / "history.tessmora-chat"
            if not exported.is_file() or named.exists():
                raise TransferError("Client history entry is missing or conflicts with its destination")
            exported.rename(named)
        counts = validate_objects(staging)
        rewrite_owned_paths(staging, [], destination)
    return {"workspace": str(destination), "workspace_id": manifest["workspace_id"], **counts,
            "credentials_required": True, "client_history_included": manifest["client_history_included"],
            "client_history_path": str(destination / "client" / "history.tessmora-chat") if manifest["client_history_included"] else None}
