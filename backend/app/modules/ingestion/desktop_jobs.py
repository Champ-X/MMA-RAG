"""Single-workspace durable ingestion. SQLite commits receipt only after the input is durable."""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import io
import json
import os
import sqlite3
import time
import uuid
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import BinaryIO

from filelock import FileLock, Timeout

from app.core.runtime_paths import state_dir


def desktop_profile() -> bool:
    return os.environ.get("TESSMORA_RUNTIME_PROFILE") == "desktop"


def now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def encoded(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


class JobConflict(ValueError):
    pass


class ProviderOutcomeUnknown(RuntimeError):
    def __init__(self):
        super().__init__("提供商请求的完成情况未知。请核对提供商账单，并确认可能再次计费后重试。")


class JobCancelled(Exception):
    pass


class WorkerOwnershipLost(RuntimeError):
    pass


# Propagated to asyncio tasks and to_thread operations inside the active worker.
active_job: ContextVar[tuple[str, str] | None] = ContextVar(
    "desktop_ingestion_job", default=None
)


def fsync_dir(directory: Path):
    if os.name == "nt":
        return
    fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class DesktopJobs:
    def __init__(self, root: Path):
        self.root = root
        self.spool = root / "spool"
        self.spool.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = root / "jobs.sqlite3"
        with self.connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, kb TEXT NOT NULL, file_id TEXT NOT NULL,
                    digest TEXT NOT NULL, identity TEXT NOT NULL, options TEXT NOT NULL,
                    state TEXT NOT NULL, owner TEXT, cancelled INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0, heartbeat REAL, created REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state,created);
                CREATE INDEX IF NOT EXISTS jobs_file_id ON jobs(file_id);
                CREATE TABLE IF NOT EXISTS status (
                    id TEXT PRIMARY KEY, kb TEXT NOT NULL, file_id TEXT, body TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS status_kb ON status(kb);
                CREATE INDEX IF NOT EXISTS status_file ON status(file_id);
                CREATE TABLE IF NOT EXISTS deletion (
                    file_id TEXT NOT NULL, kb TEXT NOT NULL, token TEXT NOT NULL, done INTEGER NOT NULL,
                    PRIMARY KEY(file_id,kb)
                );
                CREATE TABLE IF NOT EXISTS provider_calls (
                    task TEXT NOT NULL, call_id TEXT NOT NULL, state TEXT NOT NULL, result BLOB, PRIMARY KEY(task,call_id)
                );
                CREATE TABLE IF NOT EXISTS portrait (
                    kb TEXT PRIMARY KEY, dirty INTEGER NOT NULL DEFAULT 0,
                    urgent INTEGER NOT NULL DEFAULT 0, retry_after REAL NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS portrait_claim (
                    kb TEXT PRIMARY KEY, token TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS portrait_receipts (
                    operation TEXT PRIMARY KEY
                );
            """
            )

    @contextmanager
    def connection(self, *, write=False):
        conn = sqlite3.connect(self.db, timeout=20, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            # FULL also syncs each WAL commit before the receipt reaches the client.
            conn.execute("PRAGMA synchronous=FULL")
            if write:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            if write:
                conn.commit()
        finally:
            conn.close()

    @contextmanager
    def _stage(self, stream: BinaryIO):
        tmp = self.spool / (uuid.uuid4().hex + ".part")
        digest = hashlib.sha256()
        size = 0
        lock = FileLock(str(tmp) + ".lock")
        lock.acquire()
        try:
            with tmp.open("xb") as dst:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    dst.write(chunk)
                    digest.update(chunk)
                dst.flush()
                os.fsync(dst.fileno())
            yield tmp, digest.hexdigest(), size
        finally:
            tmp.unlink(missing_ok=True)
            lock.release()
            Path(lock.lock_file).unlink(missing_ok=True)

    @staticmethod
    def _write_status(conn, status):
        conn.execute(
            "INSERT INTO status(id,kb,file_id,body) VALUES(?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET kb=excluded.kb,file_id=excluded.file_id,body=excluded.body",
            (
                status["processing_id"],
                status.get("source_kb_id") or status["kb_id"],
                status.get("file_id"),
                encoded(status),
            ),
        )

    def enqueue(
        self,
        stream: BinaryIO,
        filename: str,
        kb: str,
        *,
        processing_id=None,
        file_id=None,
        source_type=None,
        source_metadata=None,
        user_id=None,
        asset_map=None,
        logical_path=None,
    ):
        """An explicit operation UUID identifies a request, independently of its content hash."""
        job_id = str(uuid.UUID(processing_id)) if processing_id else str(uuid.uuid4())
        filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
        if not filename or filename in (".", "..") or "\x00" in filename or not kb:
            raise ValueError("无效的文件名或知识库")
        file_id = (
            str(uuid.UUID(file_id))
            if file_id
            else str(uuid.uuid5(uuid.NAMESPACE_URL, "desktop-file:" + job_id))
        )
        with ExitStack() as cleanup:
            parts = [cleanup.enter_context(self._stage(stream))]
            _, digest, size = parts[0]
            if not size:
                raise ValueError("文件内容为空")
            assets = {}
            for key, value in (asset_map or {}).items():
                parts.append(cleanup.enter_context(self._stage(io.BytesIO(value))))
                assets[key] = parts[-1][1]
            options = dict(
                filename=filename,
                user_id=user_id,
                source_type=source_type,
                source_metadata=source_metadata,
                assets=assets,
            )
            if logical_path and logical_path != filename:
                options["logical_path"] = logical_path
            identity = hashlib.sha256(
                encoded([kb, file_id, digest, options]).encode()
            ).hexdigest()
            with self.connection(write=True) as conn:
                old = conn.execute(
                    "SELECT identity,state FROM jobs WHERE id=?", (job_id,)
                ).fetchone()
                if old and (old["identity"] != identity or old["state"] == "deleted"):
                    raise JobConflict("同一请求 ID 对应的文件已改变或已删除")
                if not old:
                    if conn.execute(
                        "SELECT 1 FROM deletion WHERE kb=? AND file_id=?", (kb, file_id)
                    ).fetchone():
                        raise JobConflict("文件正在删除或已删除")
                    for tmp, sha, _ in parts:
                        path = self.spool / sha
                        if not path.exists():
                            os.replace(tmp, path)
                    fsync_dir(self.spool)
                    stamp = now()
                    status = dict(
                        processing_id=job_id,
                        file_id=file_id,
                        file_path=filename,
                        file_size=size,
                        source_staged=True,
                        storage_persisted=False,
                        source_kb_id=kb,
                        kb_id=kb,
                        submitted_at=stamp,
                        updated_at=stamp,
                        status="queued",
                        stage="queued",
                        progress=0,
                        message="文件已保存，正在排队",
                    )
                    self._write_status(conn, status)
                    conn.execute(
                        "INSERT INTO jobs(id,kb,file_id,digest,identity,options,state,created) "
                        "VALUES(?,?,?,?,?,?,'queued',?)",
                        (
                            job_id,
                            kb,
                            file_id,
                            digest,
                            identity,
                            encoded(options),
                            time.time(),
                        ),
                    )
            # A receipt is stable across response loss, even if execution already completed.
            return dict(
                processing_id=job_id,
                file_id=file_id,
                filename=filename,
                size=size,
                status="queued",
            )

    @staticmethod
    def _status(conn, task):
        row = conn.execute("SELECT body FROM status WHERE id=?", (task,)).fetchone()
        return json.loads(row[0]) if row else None

    def status(self, task):
        with self.connection() as conn:
            return self._status(conn, task)

    def statuses(self, kb=None, file_id=None):
        query, args = (
            ("SELECT body FROM status WHERE file_id=?", (file_id,))
            if file_id
            else (
                "SELECT body FROM status WHERE kb=? OR json_extract(body,'$.kb_id')=? OR json_extract(body,'$.bucket')=?",
                (kb, kb, kb),
            )
        )
        with self.connection() as conn:
            values = [json.loads(row[0]) for row in conn.execute(query, args)]
        return sorted(
            (v for v in values if v.get("status") != "deleted"),
            key=lambda v: v.get("updated_at", ""),
            reverse=True,
        )

    def progress(self, status, expected_status=None):
        task = status["processing_id"]
        with self.connection(write=True) as conn:
            current = self._status(conn, task) or {}
            if expected_status and current.get("status") != expected_status:
                return False
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (task,)).fetchone()
            if row:
                if (
                    active_job.get() != (task, row["owner"])
                    or row["state"] != "running"
                ):
                    raise WorkerOwnershipLost("任务执行权已变更")
                if status.get("status") == "completed" and self._unconfirmed(
                    conn, task
                ):
                    raise ProviderOutcomeUnknown()
                if row["cancelled"]:
                    raise JobCancelled("用户已取消入库")
                status = {**current, **status, "file_id": row["file_id"]}
            if current.get("status") == "deleted":
                raise JobConflict("文件任务已删除")
            self._write_status(conn, status)
            if row:
                conn.execute(
                    "UPDATE jobs SET heartbeat=? WHERE id=?", (time.time(), task)
                )
        return True

    def _transition(self, conn, task, state, *, message=None, **updates):
        status = self._status(conn, task)
        if state == "deleted":
            # A tombstone needs scope and IDs, never old parse results or provider output.
            status = {
                key: status[key]
                for key in (
                    "processing_id",
                    "file_id",
                    "kb_id",
                    "source_kb_id",
                    "bucket",
                )
                if key in status
            }
            status.update(
                source_staged=False,
                storage_persisted=False,
                retry_supported=False,
                retryable=False,
            )
            conn.execute("DELETE FROM provider_calls WHERE task=?", (task,))
            conn.execute("UPDATE jobs SET options='{}' WHERE id=?", (task,))
        status.update(status=state, stage=state, updated_at=now(), **updates)
        if message:
            status["message"] = message
        self._write_status(conn, status)
        conn.execute(
            "UPDATE jobs SET state=?,owner=NULL,cancelled=0 WHERE id=?", (state, task)
        )

    @staticmethod
    def _check_owner(conn, owner):
        row = conn.execute(
            "SELECT cancelled FROM jobs WHERE id=? AND owner=? AND state='running'",
            owner,
        ).fetchone()
        if not row:
            raise WorkerOwnershipLost("任务执行权已变更")
        if row[0]:
            raise JobCancelled("用户已取消入库")

    def begin_call(self, owner, key):
        from .document_checkpoints import _decode

        with self.connection(write=True) as conn:
            self._check_owner(conn, owner)
            if conn.execute(
                "SELECT 1 FROM provider_calls WHERE task=? AND state='unknown'",
                (owner[0],),
            ).fetchone():
                raise ProviderOutcomeUnknown()
            row = conn.execute(
                "SELECT state,result FROM provider_calls WHERE task=? AND call_id=?",
                (owner[0], key),
            ).fetchone()
            if row:
                if row["state"] == "confirmed":
                    return True, json.loads(
                        gzip.decompress(row["result"]), object_hook=_decode
                    )
                raise ProviderOutcomeUnknown()
            conn.execute(
                "INSERT INTO provider_calls(task,call_id,state) VALUES(?,?,'inflight')",
                (owner[0], key),
            )
            return False, None

    def complete_call(self, owner, key, result):
        from .document_checkpoints import _encode

        packed = gzip.compress(
            json.dumps(
                result, default=_encode, ensure_ascii=False, separators=(",", ":")
            ).encode()
        )
        with self.connection(write=True) as conn:
            # A cancellation received during provider execution must still retain its confirmed result.
            row = conn.execute(
                "SELECT 1 FROM jobs WHERE id=? AND owner=?", owner
            ).fetchone()
            if not row:
                raise WorkerOwnershipLost("任务执行权已变更")
            conn.execute(
                "UPDATE provider_calls SET state='confirmed',result=? WHERE task=? AND call_id=?",
                (packed, owner[0], key),
            )

    def fail_call(self, owner, key, rejected):
        with self.connection(write=True) as conn:
            if not conn.execute(
                "SELECT 1 FROM jobs WHERE id=? AND owner=?", owner
            ).fetchone():
                raise WorkerOwnershipLost("任务执行权已变更")
            if rejected:
                conn.execute(
                    "DELETE FROM provider_calls WHERE task=? AND call_id=?",
                    (owner[0], key),
                )
            else:
                conn.execute(
                    "UPDATE provider_calls SET state='unknown' WHERE task=? AND call_id=?",
                    (owner[0], key),
                )

    def _unconfirmed(self, conn, task):
        return bool(
            conn.execute(
                "SELECT 1 FROM provider_calls WHERE task=? AND state!='confirmed' LIMIT 1",
                (task,),
            ).fetchone()
        )

    def _uncertain_failure(self, conn, task):
        reason = str(ProviderOutcomeUnknown())
        self._transition(
            conn,
            task,
            "failed",
            error=reason,
            message=reason,
            error_code="provider_interrupted",
            retry_supported=True,
            retryable=True,
        )

    def recover(self):
        """Call only under the OS worker lock, after the previous owner has exited."""
        with self.connection(write=True) as conn:
            conn.execute("DELETE FROM portrait_claim")
            for row in conn.execute(
                "SELECT * FROM jobs WHERE state='running'"
            ).fetchall():
                task = row["id"]
                status = self._status(conn, task)
                if self._unconfirmed(conn, task):
                    self._uncertain_failure(conn, task)
                elif (
                    status["status"] == "completed" and status.get("result") is not None
                ):
                    self._transition(conn, task, "completed")
                elif row["cancelled"]:
                    self._transition(
                        conn,
                        task,
                        "cancelled",
                        message="任务已取消",
                        retry_supported=True,
                        retryable=True,
                    )
                elif status["status"] == "failed":
                    self._transition(conn, task, "failed")
                elif row["attempts"] >= 3:
                    reason = "连续恢复中断，请检查诊断后重试"
                    self._transition(
                        conn,
                        task,
                        "failed",
                        error=reason,
                        message=reason,
                        retry_supported=True,
                        error_code="recovery_limit",
                        retryable=True,
                    )
                else:
                    self._transition(
                        conn, task, "queued", message="服务已重启，继续入库", progress=0
                    )

    def collect_spool(self):
        # Publication and garbage collection share a write lock. A live spool producer
        # holds its uniquely named .part.lock across staging and the receipt transaction.
        with self.connection(write=True) as conn:
            live = set()
            for row in conn.execute(
                "SELECT digest,options FROM jobs WHERE state NOT IN ('deleted','completed')"
            ):
                live.add(row["digest"])
                live.update(json.loads(row["options"]).get("assets", {}).values())
            for path in self.spool.iterdir():
                if len(path.name) == 64 and path.name not in live:
                    path.unlink(missing_ok=True)
                elif path.suffix == ".part":
                    lock_path = str(path) + ".lock"
                    try:
                        with FileLock(lock_path, timeout=0):
                            path.unlink(missing_ok=True)
                    except Timeout:
                        continue
                    Path(lock_path).unlink(missing_ok=True)

    def add_portrait_delta(self, kb, delta=0, *, force=False):
        owner = active_job.get()
        with self.connection(write=True) as conn:
            add = True
            if owner:
                self._check_owner(conn, owner)
                add = (
                    conn.execute(
                        "INSERT OR IGNORE INTO portrait_receipts(operation) VALUES(?)",
                        (encoded([owner[0], kb]),),
                    ).rowcount
                    == 1
                )
            if add:
                conn.execute(
                    "INSERT INTO portrait(kb,dirty,urgent) VALUES(?,?,?) "
                    "ON CONFLICT(kb) DO UPDATE SET dirty=dirty+excluded.dirty,urgent=urgent+excluded.urgent",
                    (kb, delta, int(force)),
                )
            row = conn.execute(
                "SELECT dirty FROM portrait WHERE kb=?", (kb,)
            ).fetchone()
            return row[0] if row else 0

    def next_portrait(self):
        from app.core.config import settings

        with self.connection(write=True) as conn:
            row = conn.execute(
                "SELECT * FROM portrait WHERE retry_after<=? AND (urgent>0 OR dirty>=?) "
                "AND kb NOT IN (SELECT kb FROM portrait_claim) ORDER BY retry_after,kb LIMIT 1",
                (time.time(), max(1, settings.portrait_update_threshold)),
            ).fetchone()
            if row is None:
                return None
            token = uuid.uuid4().hex
            conn.execute("INSERT INTO portrait_claim VALUES(?,?)", (row["kb"], token))
            return {**dict(row), "token": token}

    def finish_portrait(self, snapshot, success):
        with self.connection(write=True) as conn:
            if not conn.execute(
                "DELETE FROM portrait_claim WHERE kb=? AND token=?",
                (snapshot["kb"], snapshot["token"]),
            ).rowcount:
                return
            if success:
                conn.execute(
                    "UPDATE portrait SET dirty=MAX(0,dirty-?),urgent=MAX(0,urgent-?),retry_after=0 WHERE kb=?",
                    (snapshot["dirty"], snapshot["urgent"], snapshot["kb"]),
                )
            else:
                conn.execute(
                    "UPDATE portrait SET retry_after=? WHERE kb=?",
                    (time.time() + 60, snapshot["kb"]),
                )

    def claim(self):
        with self.connection(write=True) as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE state='queued' ORDER BY created,id LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            token = uuid.uuid4().hex
            conn.execute(
                "UPDATE jobs SET state='running',owner=?,heartbeat=?,attempts=attempts+1 WHERE id=?",
                (token, time.time(), row["id"]),
            )
            return {**dict(row), "owner": token, "options": json.loads(row["options"])}

    def finish(self, job, error=None):
        task = job["id"]
        with self.connection(write=True) as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE id=? AND owner=?", (task, job["owner"])
            ).fetchone()
            if not row:
                raise WorkerOwnershipLost("任务执行权已变更")
            status = self._status(conn, task)
            if self._unconfirmed(conn, task):
                self._uncertain_failure(conn, task)
            elif (
                status.get("status") == "completed" and status.get("result") is not None
            ):
                self._transition(conn, task, "completed")
            elif row["cancelled"]:
                self._transition(
                    conn,
                    task,
                    "cancelled",
                    message="任务已取消",
                    error_code="cancelled",
                    retry_supported=True,
                    retryable=True,
                )
            elif error is not None:
                self._transition(
                    conn,
                    task,
                    "failed",
                    message=str(error),
                    error=str(error),
                    retry_supported=True,
                )
            else:
                raise RuntimeError("入库未返回持久完成回执")

    def retry(self, task, *, confirm_provider_retry=False):
        with self.connection(write=True) as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (task,)).fetchone()
            if not row:
                raise LookupError("未找到已保存的文件任务")
            status = self._status(conn, task)
            if (
                row["state"] not in {"failed", "cancelled"}
                or status.get("retryable") is False
            ):
                raise JobConflict("该任务目前不允许重试")
            if conn.execute(
                "SELECT 1 FROM deletion WHERE file_id=? AND kb IN (?,?,?)",
                (row["file_id"], row["kb"], status.get("kb_id"), status.get("bucket")),
            ).fetchone():
                raise JobConflict("文件已进入删除流程")
            if not (self.spool / row["digest"]).is_file():
                raise JobConflict("已接收的原件缺失，请从备份恢复")
            if self._unconfirmed(conn, task):
                if not confirm_provider_retry:
                    raise JobConflict(str(ProviderOutcomeUnknown()))
                conn.execute(
                    "DELETE FROM provider_calls WHERE task=? AND state!='confirmed'",
                    (task,),
                )
            conn.execute("UPDATE jobs SET attempts=0 WHERE id=?", (task,))
            self._transition(
                conn,
                task,
                "queued",
                message="用户已重新提交",
                progress=0,
                error=None,
                error_code=None,
                result=None,
                retry_count=(status.get("retry_count") or 0) + 1,
            )
            return self._status(conn, task)

    def cancel(self, task):
        with self.connection(write=True) as conn:
            row = conn.execute("SELECT state FROM jobs WHERE id=?", (task,)).fetchone()
            if not row:
                raise LookupError("未找到文件任务")
            if row[0] == "queued":
                self._transition(
                    conn,
                    task,
                    "cancelled",
                    message="任务已取消",
                    error_code="cancelled",
                    retry_supported=True,
                    retryable=True,
                )
            elif row[0] == "running" and self._status(conn, task).get("status") not in {
                "completed",
                "failed",
            }:
                conn.execute("UPDATE jobs SET cancelled=1 WHERE id=?", (task,))
                status = self._status(conn, task)
                status.update(stage="cancelling", message="正在停止当前作业", updated_at=now())
                self._write_status(conn, status)
            return self._status(conn, task)

    async def wait(self, task):
        while True:
            status = await asyncio.to_thread(self.status, task)
            if not status:
                raise LookupError("未找到文件任务")
            if status["status"] == "completed":
                return status["result"]
            if status["status"] in {"failed", "cancelled", "deleted"}:
                raise ValueError(
                    status.get("error") or status.get("message") or "文件处理未完成"
                )
            await asyncio.sleep(0.25)


@lru_cache(maxsize=4)
def _queue(root):
    return DesktopJobs(root / "ingestion")


def jobs():
    root = state_dir()
    if not desktop_profile() or root is None:
        raise RuntimeError(
            "Desktop ingestion requires an explicit desktop workspace directory"
        )
    return _queue(root)
