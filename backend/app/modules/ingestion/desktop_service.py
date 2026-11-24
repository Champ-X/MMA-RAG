"""Desktop ingress, status and deletion adapters for the shared ingestion pipeline."""
from __future__ import annotations

import asyncio
import hashlib
import io
import threading
import uuid

from filelock import FileLock, Timeout

from .desktop_jobs import jobs
from .service import IngestionService, ProcessingTaskActiveError, retry_capabilities


class DesktopIngestionService(IngestionService):
    def __init__(self, *, status_only=False):
        self.queue = jobs()
        if status_only:
            self._processing_status = {}
        else:
            super().__init__()
        self._delete_locks = {}
        self._delete_guard = threading.Lock()

    def _get_processing_status_redis_client(self):
        return None

    def _load_persisted_processing_status(self, processing_id, *, raise_on_error=False):
        return self.queue.status(processing_id)

    def _persist_processing_status(
        self,
        status,
        *,
        require_persistence=False,
        expected_status=None,
        raise_if_reserved=False,
    ):
        persisted = self.queue.progress(status, expected_status)
        if persisted:
            self._cache_processing_status(status)
        return persisted

    def get_processing_status_sync(self, processing_id):
        status = self.queue.status(processing_id)
        if not status:
            return {
                "processing_id": processing_id,
                "status": "not_found",
                "message": "未找到文件任务",
            }
        return self._public_status(status)

    @staticmethod
    def _public_status(status):
        result = retry_capabilities(status)
        # Existing Web consumers group cancelled work with other terminal failures.
        # The ledger and cancellation response retain the distinct cancelled state.
        if status.get("status") == "cancelled":
            result.update(status="failed", stage="cancelled", error_code="cancelled")
        if status.get("status") in {"failed", "cancelled"} and status.get(
            "retry_supported"
        ):
            result.update(retry_supported=True, retryable=status.get("retryable", True))
        return result

    def list_processing_statuses_for_kb(self, kb_id):
        return [self._public_status(s) for s in self.queue.statuses(kb_id)]

    def get_file_processing_status(self, file_id, kb_id=None):
        return next(
            (
                self._public_status(s)
                for s in self.queue.statuses(file_id=file_id)
                if not kb_id or self._status_matches_file(s, file_id, kb_id)
            ),
            None,
        )

    def prepare_file_upload(
        self, *, file_content, file_path, kb_id, processing_id=None
    ):
        # prepare/launch callers supply provenance and stable collection file IDs only on launch.
        return {
            "processing_id": processing_id or str(uuid.uuid4()),
            "filename": file_path,
            "size": len(file_content),
            "status": "preparing",
        }

    def launch_prepared_file_upload(
        self,
        *,
        file_content,
        file_path,
        kb_id,
        processing_id,
        user_id=None,
        asset_map=None,
        source_type=None,
        source_metadata=None,
        file_id_override=None,
    ):
        return self.queue.enqueue(
            io.BytesIO(file_content),
            file_path,
            kb_id,
            processing_id=processing_id,
            file_id=file_id_override,
            user_id=user_id,
            asset_map=asset_map,
            source_type=source_type,
            source_metadata=source_metadata,
        )

    async def process_file_upload(
        self,
        file_content,
        file_path,
        kb_id,
        user_id=None,
        processing_id=None,
        asset_map=None,
        source_type=None,
        source_metadata=None,
        file_id_override=None,
    ):
        # Other application entrypoints (including folder/URL imports) use this async method.
        result = await asyncio.to_thread(
            self.queue.enqueue,
            io.BytesIO(file_content),
            file_path,
            kb_id,
            processing_id=processing_id,
            file_id=file_id_override,
            source_type=source_type,
            source_metadata=source_metadata,
            user_id=user_id,
            asset_map=asset_map,
        )
        return await self.queue.wait(result["processing_id"])

    def retry_file_processing(self, processing_id, *, confirm_provider_retry=False):
        return self.queue.retry(processing_id, confirm_provider_retry=confirm_provider_retry)

    def _file_rows(self, conn, file_id, kb_id):
        rows = conn.execute(
            "SELECT s.id,j.state,s.body FROM status s LEFT JOIN jobs j USING(id) "
            "WHERE s.file_id=? AND (s.kb=? OR json_extract(s.body,'$.kb_id')=? "
            "OR json_extract(s.body,'$.bucket')=?)",
            (file_id, kb_id, kb_id, kb_id),
        ).fetchall()
        if any(r["state"] in {"queued", "running"} for r in rows):
            raise ProcessingTaskActiveError("任务仍在排队或执行，请取消并等待它停止后删除")
        return rows

    def assert_file_deletable(self, file_id, kb_id):
        with self.queue.connection() as conn:
            return len(self._file_rows(conn, file_id, kb_id))

    def begin_file_deletion(self, file_id, kb_id):
        # OS lock proves previous owner is gone even if PID has been recycled.
        key = hashlib.sha256(file_id.encode()).hexdigest()
        directory = self.queue.root / "delete-locks"
        directory.mkdir(exist_ok=True)
        lock = FileLock(directory / key, thread_local=False)
        try:
            lock.acquire(timeout=0)
        except Timeout:
            raise ProcessingTaskActiveError("文件正在删除，请稍后重试") from None
        try:
            with self.queue.connection(write=True) as conn:
                rows = self._file_rows(conn, file_id, kb_id)
                old = conn.execute(
                    "SELECT token,done FROM deletion WHERE file_id=? AND kb=?",
                    (file_id, kb_id),
                ).fetchone()
                if old and old["done"]:
                    lock.release()
                    return {
                        "matched_count": len(rows),
                        "already_deleted": True,
                        "token": old["token"],
                    }
                token = uuid.uuid4().hex
                conn.execute(
                    "INSERT OR REPLACE INTO deletion(file_id,kb,token,done) VALUES(?,?,?,0)",
                    (file_id, kb_id, token),
                )
            with self._delete_guard:
                self._delete_locks[token] = lock
            return {
                "matched_count": len(rows),
                "already_deleted": False,
                "token": token,
            }
        except BaseException:
            lock.release()
            raise

    def release_file_deletion_owner(self, token):
        with self._delete_guard:
            lock = self._delete_locks.pop(token, None)
        if lock:
            lock.release()

    def commit_file_deletion(self, file_id, kb_id, token):
        try:
            with self.queue.connection(write=True) as conn:
                rows = self._file_rows(conn, file_id, kb_id)
                if not conn.execute(
                    "UPDATE deletion SET done=1 WHERE file_id=? AND kb=? AND token=?",
                    (file_id, kb_id, token),
                ).rowcount:
                    raise ProcessingTaskActiveError("删除预约已改变")
                for row in rows:
                    self.queue._transition(
                        conn, row["id"], "deleted", message="文件已删除", result=None
                    )
            self.queue.collect_spool()
            return len(rows)
        finally:
            self.release_file_deletion_owner(token)

    def abort_file_deletion(self, file_id, kb_id, token):
        try:
            with self.queue.connection(write=True) as conn:
                conn.execute(
                    "DELETE FROM deletion WHERE file_id=? AND kb=? AND token=? AND done=0",
                    (file_id, kb_id, token),
                )
        finally:
            self.release_file_deletion_owner(token)

    def retire_processing_placeholder(self, processing_id, kb_id):
        with self.queue.connection(write=True) as conn:
            status = self.queue._status(conn, processing_id)
            if not status or kb_id not in {
                status.get("source_kb_id"),
                status.get("kb_id"),
            }:
                return False
            if status.get("storage_persisted"):
                raise ProcessingTaskActiveError("原件已保存，请通过文件 ID 删除")
            row = conn.execute(
                "SELECT state FROM jobs WHERE id=?", (processing_id,)
            ).fetchone()
            if row and row[0] in {"queued", "running"}:
                raise ProcessingTaskActiveError("请先取消正在处理的任务")
            self.queue._transition(conn, processing_id, "deleted", message="上传记录已删除")
        self.queue.collect_spool()
        return True
