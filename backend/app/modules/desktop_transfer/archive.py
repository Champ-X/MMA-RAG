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

BLOCK_SIZE = 1024 * 1024
ZERO_BLOCK = bytes(BLOCK_SIZE)
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


def _sqlite_backup(source: Path, destination: Path, *, frozen=False):
    # SQLite's online backup includes committed WAL pages. In a frozen workspace an
    # immutable base needs no source-side SHM file. Replay outstanding WAL in scratch.
    if frozen:
        wal = source.with_name(source.name + "-wal")
        if wal.is_file() and wal.stat().st_size:
            with tempfile.TemporaryDirectory(dir=destination.parent) as directory:
                clone = Path(directory) / "source.sqlite"
                shutil.copyfile(source, clone)
                shutil.copyfile(wal, clone.with_name(clone.name + "-wal"))
                _sqlite_backup(clone, destination)
            return
    original = sqlite3.connect(source.as_uri() + ("?immutable=1" if frozen else "?mode=ro"), uri=True)
    copied = sqlite3.connect(destination)
    try:
        original.backup(copied)
        if copied.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise TransferError(f"SQLite integrity check failed: {source.name}")
    finally:
        copied.close()
        original.close()


def _tree_entries(source: Path, *, excluded=True):
    if not source.exists() and not source.is_symlink():
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
        yield relative, Path(directory), True
        for name in files:
            child, rel = Path(directory) / name, relative / name
            if excluded and _excluded(rel):
                continue
            if child.is_symlink() or not stat.S_ISREG(child.stat(follow_symlinks=False).st_mode):
                raise TransferError(f"Only ordinary files can be transferred: {rel}")
            yield rel, child, False


def copy_data_tree(source: Path, destination: Path, *, excluded=True):
    """Copy owned data only, rejecting links and devices instead of following them."""
    for rel, child, directory in _tree_entries(source, excluded=excluded):
        if directory:
            (destination / rel).mkdir(parents=True, exist_ok=True, mode=0o700)
            continue
        target = destination / rel
        if target.exists():
            if target.is_file() and sha256(target) == sha256(child):
                continue
            raise TransferError(f"Conflicting migration data: {rel}")
        with child.open("rb") as stream:
            signature = stream.read(16)
        if signature == b"SQLite format 3\x00":
            _sqlite_backup(child.resolve(), target)
        elif rel.name == "setup.json":
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


def rewrite_owned_paths(workspace: Path, mappings: list[tuple[str, str]], destination: Path | None, *, source_files: Path | None = None):
    """Only host-owned attachment/payload fields are relocatable, never user text."""
    files = source_files or workspace
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
                if not _safe_member(relative) or not (files / relative).is_file():
                    raise TransferError(f"Missing transferred attachment or collection payload: {relative}")
                if key == "local_path" and value.get("attachment_id"):
                    path = files / relative
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


def _stored_media(signature: bytes) -> bool:
    return signature.startswith((b"PK\x03\x04", b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF8", b"OggS",
                                 b"fLaC", b"\x1aE\xdf\xa3", b"\x1f\x8b")) or signature[4:8] == b"ftyp" or (
        signature.startswith(b"RIFF") and signature[8:12] == b"WEBP")


def _write_member(archive, name, path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        signature = source.read(16)
        source.seek(0)
        # Named members inherit the archive's streaming DEFLATE level. ZipInfo defaults to STORED.
        member = zipfile.ZipInfo(name) if not name.startswith("qdrant/") and _stored_media(signature) else name
        with archive.open(member, "w", force_zip64=path.stat().st_size * 1.05 > zipfile.ZIP64_LIMIT) as target:
            while block := source.read(BLOCK_SIZE):
                target.write(block)
                digest.update(block)
                size += len(block)
    return {"path": name, "size": size, "sha256": digest.hexdigest()}


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
        # Only SQLite snapshots and sanitized/relocated metadata need writable scratch space.
        # Immutable originals and stopped Qdrant files stream directly from the workspace.
        sources = {"workspace.json": stage / "workspace.json"}
        for directory in ("state", "qdrant"):
            for rel, source, is_directory in _tree_entries(workspace / directory, excluded=directory == "state"):
                if is_directory:
                    continue
                name = f"{directory}/{rel.as_posix()}"
                with source.open("rb") as stream:
                    sqlite = stream.read(16) == b"SQLite format 3\x00"
                if sqlite or rel.name == "setup.json":
                    snapshot = stage / name
                    snapshot.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    if sqlite:
                        _sqlite_backup(source.resolve(), snapshot, frozen=True)
                    else:
                        snapshot.write_bytes(json_bytes(_sanitize_config(json.loads(source.read_text()))))
                    source = snapshot
                sources[name] = source
        rewrite_owned_paths(stage, [(str(workspace) + os.sep, "")], None, source_files=workspace)
        if client_history is not None:
            if client_history.is_symlink() or not client_history.is_file():
                raise TransferError("Client history export must be an ordinary file")
            sources["client/history-export"] = client_history
        descriptor, temporary = tempfile.mkstemp(prefix=".backup-", suffix=".zip", dir=output.parent)
        os.close(descriptor)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
                entries = [_write_member(archive, name, source) for name, source in sorted(sources.items())]
                manifest = {"format": FORMAT, "version": 1, "workspace_id": identity["id"],
                            "created_at": datetime.now(timezone.utc).isoformat(), "files": entries,
                            "credentials_included": False, "client_history_included": client_history is not None,
                            "client_history_name": client_history.name if client_history else None,
                            "required_qdrant_version": identity.get("qdrant_version")}
                archive.writestr("manifest.json", json_bytes(manifest))
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
    return _verify(archive_path)[0]


def _verify(archive_path: Path, *, measure_sparse=False):
    allocated = 0
    try:
        with zipfile.ZipFile(archive_path) as archive:
            manifest, entries = _validated_manifest(archive)
            for name, entry in entries.items():
                digest = hashlib.sha256()
                with archive.open(name) as source:
                    while block := source.read(1024 * 1024):
                        digest.update(block)
                        if measure_sparse and block != ZERO_BLOCK[:len(block)]:
                            allocated += len(block)
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
                            entry = entries.get(_object_member(bucket, blob))
                            if not entry or entry["size"] != size or entry["sha256"] != blob:
                                raise TransferError(f"Missing or damaged object in backup: {bucket}/{key}")
                    finally:
                        db.close()
            return manifest, allocated
    except (zipfile.BadZipFile, KeyError, TypeError, json.JSONDecodeError, UnicodeError) as error:
        raise TransferError("Backup archive is invalid or incomplete") from error


def _object_member(bucket, blob):
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or ".." in bucket or not re.fullmatch(r"[a-f0-9]{64}", blob):
        raise TransferError("Object catalog contains an invalid blob identity")
    return f"state/objects/{bucket}/{blob}"


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
            path = workspace / _object_member(bucket, blob)
            if path.is_symlink() or not path.is_file() or path.stat().st_size != size or sha256(path) != blob:
                raise TransferError(f"Missing or damaged object: {bucket}/{key}")
            total += size
            count += 1
    finally:
        db.close()
    return {"objects": count, "bytes": total}


def _enable_sparse(stream):
    if os.name != "nt":
        return True
    import ctypes
    import msvcrt
    from ctypes import wintypes
    # NTFS requires FSCTL_SET_SPARSE before a seek beyond EOF creates unallocated ranges.
    returned = wintypes.DWORD()
    return bool(ctypes.windll.kernel32.DeviceIoControl(
        wintypes.HANDLE(msvcrt.get_osfhandle(stream.fileno())), 0x900C4, None, 0, None, 0,
        ctypes.byref(returned), None))


def _sparse_volume(directory):
    with tempfile.TemporaryFile(dir=directory) as stream:
        if not _enable_sparse(stream):
            return False
        stream.seek(BLOCK_SIZE)
        stream.write(b"1")
        stream.flush()
        info = os.fstat(stream.fileno())
        return getattr(info, "st_blocks", None) is None or info.st_blocks * 512 < BLOCK_SIZE


def _release_macos_hole(output, start, end):
    # APFS can allocate interior gaps when a later buffered write extends an extent.
    # F_PUNCHHOLE takes struct fpunchhole (sys/fcntl.h). Punch only observed zeros.
    import errno
    import fcntl
    import struct
    alignment = os.fstatvfs(output.fileno()).f_bsize
    length = (end - start) // alignment * alignment
    if not length:
        return
    output.flush()
    try:
        fcntl.fcntl(output.fileno(), 99, struct.pack("=IIqq", 0, 0, start, length))
    except OSError as exc:
        if exc.errno not in {errno.ENOTSUP, errno.EINVAL, errno.ENOTTY, errno.ENOSYS}:
            raise


def _extract_member(source, output, size, *, sparse):
    sparse = sparse and _enable_sparse(output)
    if sparse:
        output.truncate(size)
    hole_start = None
    while block := source.read(BLOCK_SIZE):
        if sparse and block == ZERO_BLOCK[:len(block)]:
            if hole_start is None:
                hole_start = output.tell()
            output.seek(len(block), os.SEEK_CUR)
        else:
            start = output.tell()
            output.write(block)
            if hole_start is not None and sys.platform == "darwin":
                _release_macos_hole(output, hole_start, start)
            hole_start = None
    length = output.tell()
    if length != size:
        raise TransferError("Archive changed while restoring")
    output.truncate(length)
    if hole_start is not None and sys.platform == "darwin":
        _release_macos_hole(output, hole_start, length)
    output.flush()
    os.fsync(output.fileno())


def restore(archive_path: Path, destination: Path) -> dict:
    destination = destination.absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    sparse = _sparse_volume(destination.parent)
    manifest, allocated = _verify(archive_path, measure_sparse=sparse)
    required = (allocated + len(manifest["files"]) * 8192) if sparse else sum(entry["size"] for entry in manifest["files"])
    if shutil.disk_usage(destination.parent).free < required + max(64 * 1024 * 1024, required // 20):
        raise TransferError("Not enough free space to restore this workspace")
    with new_workspace(destination) as staging:
        with zipfile.ZipFile(archive_path) as archive:
            for entry in manifest["files"]:
                target = staging / entry["path"]
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.open(entry["path"]) as source, target.open("xb") as output:
                    _extract_member(source, output, entry["size"], sparse=sparse)
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
