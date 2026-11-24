"""Desktop object storage with the subset of the MinIO contract used by Tessmora.

Logical bucket/object identities are unchanged. Immutable, content-addressed blobs
avoid OS filename restrictions; a SQLite catalog atomically publishes each write.
No network server, model import, or development data directory is involved.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
from types import SimpleNamespace
from urllib.parse import quote, urlencode

from minio.error import S3Error

from app.core.runtime_paths import state_dir


def desktop_storage_enabled() -> bool:
    return os.environ.get("TESSMORA_RUNTIME_PROFILE", "").strip().lower() == "desktop"


def object_store_root() -> Path:
    root = state_dir()
    if root is None:
        raise RuntimeError("Desktop storage requires TESSMORA_STATE_DIR")
    return root / "objects"


def _error(code: str, message: str) -> S3Error:
    return S3Error(code, message, "", "", "", None)


def _bucket(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", value) or ".." in value:
        raise _error("InvalidBucketName", "Invalid storage bucket")
    return value


def _key(value: str) -> str:
    if (not isinstance(value, str) or not value or len(value.encode("utf-8")) > 1024
            or "\\" in value or any(ord(char) < 32 for char in value)
            or any(part in {"", ".", ".."} for part in value.split("/"))):
        raise _error("InvalidObjectName", "Invalid storage object key")
    return value


def _private_directory(path: Path) -> None:
    if path.is_symlink():
        raise PermissionError("Object storage paths must not be symbolic links")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise NotADirectoryError("Object storage directory is unavailable")


def _sync_directory(path: Path) -> None:
    # POSIX requires a directory fsync to make a renamed blob durable before its
    # catalog entry commits. Windows does not expose directory fsync via os.open.
    if os.name == "posix":
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _signing_key() -> bytes:
    token = os.environ.get("TESSMORA_DESKTOP_TOKEN", "")
    if not token:
        raise RuntimeError("Desktop media requires an instance access token")
    return hmac.new(token.encode(), b"tessmora-object-urls-v1", hashlib.sha256).digest()


def _signature(bucket: str, key: str, expires: int) -> str:
    payload = json.dumps(["object-v1", bucket, key, expires], ensure_ascii=False, separators=(",", ":"))
    return hmac.new(_signing_key(), payload.encode(), hashlib.sha256).hexdigest()


def verify_object_signature(bucket: str, key: str, expires: str, signature: str) -> bool:
    try:
        _bucket(bucket)
        _key(key)
        if not re.fullmatch(r"[0-9]{1,12}", expires) or not re.fullmatch(r"[0-9a-f]{64}", signature):
            return False
        deadline = int(expires)
        if not int(time.time()) <= deadline <= int(time.time()) + 7 * 86400:
            return False
        return hmac.compare_digest(signature, _signature(bucket, key, deadline))
    except (S3Error, RuntimeError, TypeError, ValueError):
        return False


class LocalObjectResponse:
    """Closable streaming response compatible with minio/urllib3 consumers."""
    def __init__(self, stream, remaining: int, metadata):
        self._stream, self._remaining = stream, remaining
        self.headers = {"Content-Length": str(remaining), "Content-Type": metadata.content_type,
                        "ETag": metadata.etag}

    def read(self, amt: int | None = None, **_kwargs) -> bytes:
        count = self._remaining if amt is None or amt < 0 else min(amt, self._remaining)
        result = self._stream.read(count)
        self._remaining -= len(result)
        return result

    def stream(self, amt: int = 65536, **_kwargs):
        while block := self.read(amt):
            yield block

    def close(self):
        self._stream.close()

    def release_conn(self):
        self.close()


class LocalObjectClient:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root is not None else object_store_root()
        self.metadata_root = self.root.with_name(self.root.name + "-metadata")
        self.staging = self.root / ".staging"
        for path in (self.root, self.metadata_root, self.staging):
            _private_directory(path)
        self.database = self.metadata_root / "catalog.sqlite3"
        if self.database.is_symlink():
            raise PermissionError("Object catalog must not be a symbolic link")
        with self._connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in {0, 1}:
                raise ValueError("Unsupported object catalog version; migration is required")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS buckets (
                    name TEXT PRIMARY KEY, created REAL NOT NULL, tags TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS objects (
                    bucket TEXT NOT NULL REFERENCES buckets(name), key TEXT NOT NULL,
                    blob TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL,
                    modified REAL NOT NULL, PRIMARY KEY(bucket, key));
                CREATE INDEX IF NOT EXISTS objects_blob ON objects(bucket, blob);
                PRAGMA user_version=1;
            """)
        os.chmod(self.database, 0o600)

    @contextmanager
    def _connection(self, *, write=False):
        if self.database.is_symlink() or self.metadata_root.is_symlink():
            raise PermissionError("Object catalog must not be a symbolic link")
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA busy_timeout=30000")
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    def _blob_path(self, bucket: str, digest: str) -> Path:
        _bucket(bucket)
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid object blob identity")
        directory = self.root / bucket
        if self.root.is_symlink() or directory.is_symlink() or (directory / digest).is_symlink():
            raise PermissionError("Object blobs must not be symbolic links")
        return directory / digest

    @staticmethod
    def _require_bucket(db, bucket: str):
        if not db.execute("SELECT 1 FROM buckets WHERE name=?", (_bucket(bucket),)).fetchone():
            raise _error("NoSuchBucket", "Storage bucket does not exist")

    @classmethod
    def _row(cls, db, bucket: str, key: str):
        cls._require_bucket(db, bucket)
        row = db.execute("SELECT * FROM objects WHERE bucket=? AND key=?", (bucket, _key(key))).fetchone()
        if row is None:
            raise _error("NoSuchKey", "Storage object does not exist")
        return row

    @staticmethod
    def _info(row):
        return SimpleNamespace(bucket_name=row["bucket"], object_name=row["key"], size=row["size"],
            etag=row["blob"], last_modified=datetime.fromtimestamp(row["modified"], timezone.utc),
            content_type=row["content_type"], metadata={}, version_id=None, is_dir=False)

    def bucket_exists(self, bucket_name: str) -> bool:
        with self._connection() as db:
            return db.execute("SELECT 1 FROM buckets WHERE name=?", (_bucket(bucket_name),)).fetchone() is not None

    def make_bucket(self, bucket_name: str, **_kwargs):
        bucket_name = _bucket(bucket_name)
        with self._connection(write=True) as db:
            _private_directory(self.root / bucket_name)
            db.execute("INSERT OR IGNORE INTO buckets(name,created) VALUES (?,?)", (bucket_name, time.time()))

    def list_buckets(self):
        with self._connection() as db:
            return [SimpleNamespace(name=row["name"], creation_date=datetime.fromtimestamp(row["created"], timezone.utc))
                    for row in db.execute("SELECT name,created FROM buckets ORDER BY name")]

    def get_bucket_tags(self, bucket_name: str):
        with self._connection() as db:
            self._require_bucket(db, bucket_name)
            return json.loads(db.execute("SELECT tags FROM buckets WHERE name=?", (bucket_name,)).fetchone()[0])

    def set_bucket_tags(self, bucket_name: str, tags):
        with self._connection(write=True) as db:
            self._require_bucket(db, bucket_name)
            db.execute("UPDATE buckets SET tags=? WHERE name=?", (json.dumps(dict(tags), ensure_ascii=False), bucket_name))

    def put_object(self, bucket_name: str, object_name: str, data, length: int, content_type="application/octet-stream", **_kwargs):
        bucket_name, object_name = _bucket(bucket_name), _key(object_name)
        if length < 0:
            raise ValueError("Local object writes require a known length")
        digest = hashlib.sha256()
        descriptor, temporary_name = tempfile.mkstemp(prefix="write-", dir=self.staging)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                remaining = length
                while remaining:
                    block = data.read(min(1024 * 1024, remaining))
                    if not block or len(block) > remaining:
                        raise IOError("Object stream length does not match the declared length")
                    digest.update(block)
                    output.write(block)
                    remaining -= len(block)
                output.flush()
                os.fsync(output.fileno())
            identity = digest.hexdigest()
            old_blob = None
            with self._connection(write=True) as db:
                self._require_bucket(db, bucket_name)
                destination = self._blob_path(bucket_name, identity)
                _private_directory(destination.parent)
                prior = db.execute("SELECT blob FROM objects WHERE bucket=? AND key=?", (bucket_name, object_name)).fetchone()
                old_blob = prior[0] if prior else None
                if destination.exists():
                    if not destination.is_file() or destination.stat().st_size != length:
                        raise IOError("Existing object blob failed integrity validation")
                else:
                    os.replace(temporary, destination)
                    _sync_directory(destination.parent)
                db.execute("INSERT INTO objects(bucket,key,blob,size,content_type,modified) VALUES (?,?,?,?,?,?) "
                           "ON CONFLICT(bucket,key) DO UPDATE SET blob=excluded.blob,size=excluded.size,"
                           "content_type=excluded.content_type,modified=excluded.modified",
                           (bucket_name, object_name, identity, length, content_type or "application/octet-stream", time.time()))
            if old_blob and old_blob != identity:
                self._collect_blob(bucket_name, old_blob)
            return SimpleNamespace(bucket_name=bucket_name, object_name=object_name, etag=identity, version_id=None)
        finally:
            temporary.unlink(missing_ok=True)

    def _collect_blob(self, bucket: str, identity: str):
        with self._connection(write=True) as db:
            if not db.execute("SELECT 1 FROM objects WHERE bucket=? AND blob=?", (bucket, identity)).fetchone():
                try:
                    self._blob_path(bucket, identity).unlink(missing_ok=True)
                except PermissionError:
                    # Windows retains a blob while a preview has its handle open.
                    # Catalog deletion is still durable; bucket deletion reclaims it.
                    pass

    def stat_object(self, bucket_name: str, object_name: str, **_kwargs):
        with self._connection() as db:
            row = self._row(db, bucket_name, object_name)
            path = self._blob_path(bucket_name, row["blob"])
            if not path.is_file() or path.stat().st_size != row["size"]:
                raise _error("InternalError", "Stored object is missing or incomplete")
            return self._info(row)

    def get_object(self, bucket_name: str, object_name: str, offset=0, length=0, request_headers=None, **_kwargs):
        if offset < 0 or length < 0:
            raise ValueError("Invalid object range")
        # Serialize opening the immutable blob with garbage collection. The open
        # handle survives replacement/deletion, so active readers retain their view.
        with self._connection(write=True) as db:
            row = self._row(db, bucket_name, object_name)
            expected = (request_headers or {}).get("If-Match")
            if expected and expected.strip('"') != row["blob"]:
                raise _error("PreconditionFailed", "Storage object version has changed")
            path = self._blob_path(bucket_name, row["blob"])
            if not path.is_file() or path.stat().st_size != row["size"]:
                raise _error("InternalError", "Stored object is missing or incomplete")
            stream = path.open("rb")
            stream.seek(offset)
            remaining = max(0, row["size"] - offset)
            return LocalObjectResponse(stream, min(remaining, length) if length else remaining, self._info(row))

    def list_objects(self, bucket_name: str, prefix=None, recursive=False, **_kwargs):
        with self._connection() as db:
            self._require_bucket(db, bucket_name)
            # Prefix is compared literally: %, _ and unicode are valid key content.
            rows = db.execute("SELECT * FROM objects WHERE bucket=? AND substr(key,1,?)=? ORDER BY key",
                              (bucket_name, len(prefix or ""), prefix or "")).fetchall()
        directories = set()
        for row in rows:
            suffix = row["key"][len(prefix or ""):]
            if not recursive and "/" in suffix:
                directory = (prefix or "") + suffix.split("/", 1)[0] + "/"
                if directory not in directories:
                    directories.add(directory)
                    yield SimpleNamespace(bucket_name=bucket_name, object_name=directory, size=0,
                                          etag=None, last_modified=None, is_dir=True)
            else:
                yield self._info(row)

    def remove_object(self, bucket_name: str, object_name: str, **_kwargs):
        with self._connection(write=True) as db:
            self._require_bucket(db, bucket_name)
            prior = db.execute("SELECT blob FROM objects WHERE bucket=? AND key=?", (bucket_name, _key(object_name))).fetchone()
            db.execute("DELETE FROM objects WHERE bucket=? AND key=?", (bucket_name, object_name))
        if prior:
            self._collect_blob(bucket_name, prior[0])

    def remove_bucket(self, bucket_name: str):
        with self._connection(write=True) as db:
            self._require_bucket(db, bucket_name)
            if db.execute("SELECT 1 FROM objects WHERE bucket=?", (bucket_name,)).fetchone():
                raise _error("BucketNotEmpty", "Storage bucket is not empty")
            path = self.root / bucket_name
            if path.is_symlink():
                raise PermissionError("Object buckets must not be symbolic links")
            if path.exists():
                shutil.rmtree(path)
            db.execute("DELETE FROM buckets WHERE name=?", (bucket_name,))

    def copy_object(self, bucket_name: str, object_name: str, source, **_kwargs):
        if isinstance(source, str):
            source_bucket, source_key = source.lstrip("/").split("/", 1)
        else:
            source_bucket, source_key = source.bucket_name, source.object_name
        original = self.stat_object(source_bucket, source_key)
        response = self.get_object(source_bucket, source_key, request_headers={"If-Match": original.etag})
        try:
            return self.put_object(bucket_name, object_name, response, original.size, original.content_type)
        finally:
            response.close()

    def presigned_get_object(self, bucket_name: str, object_name: str, expires=timedelta(days=7), **_kwargs):
        bucket_name, object_name = _bucket(bucket_name), _key(object_name)
        duration = int(expires.total_seconds())
        if not 1 <= duration <= 7 * 86400:
            raise ValueError("Object URL lifetime must be between one second and seven days")
        deadline = int(time.time()) + duration
        query = urlencode({"expires": deadline, "signature": _signature(bucket_name, object_name, deadline)})
        return f"/api/objects/{quote(bucket_name, safe='')}/{quote(object_name, safe='/')}?{query}"

    def health_check(self):
        with self._connection() as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise IOError("Object catalog integrity check failed")
        descriptor, path = tempfile.mkstemp(prefix="health-", dir=self.staging)
        os.close(descriptor)
        Path(path).unlink()
