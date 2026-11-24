"""Consume one durable workspace queue. Start with python -m app.modules.ingestion.desktop_worker."""
import asyncio
import logging
import os
import shutil
import signal
import sys
import time
import threading
from pathlib import Path

from filelock import FileLock, Timeout

from .desktop_jobs import active_job, jobs

logger = logging.getLogger(__name__)


async def execute_job(queue, job):
    from app.core.config import settings
    from app.modules.ingestion.parsers.factory import ParserFactory, FileType
    from app.core.setup_service import get_setup_service
    from .service import DOCUMENT_TYPES, IngestionService, get_ingestion_service

    task = job["id"]
    token = active_job.set((task, job["owner"]))
    local_path = None

    async def heartbeat():
        while True:
            await asyncio.sleep(5)
            with queue.connection(write=True) as conn:
                conn.execute(
                    "UPDATE jobs SET heartbeat=? WHERE id=? AND owner=?",
                    (time.time(), task, job["owner"]),
                )

    pulse = asyncio.create_task(heartbeat())
    try:
        get_setup_service(recover_preparation=False).refresh_worker_config()
        service = get_ingestion_service()
        service._processing_status.pop(task, None)
        status = queue.status(task)
        source = queue.spool / job["digest"]
        if (
            status.get("storage_persisted")
            and status.get("file_type") in DOCUMENT_TYPES
        ):
            await service._reprocess_persisted_document(
                processing_id=task, status=status
            )
        else:
            opts = job["options"]
            is_video = (
                ParserFactory.detect_file_type(opts["filename"], b"") == FileType.VIDEO
            )
            if is_video:
                # Retain the media suffix for providers that select the upload MIME type by name.
                directory = queue.root / "worker-input"
                directory.mkdir(exist_ok=True)
                local_path = directory / (
                    job["digest"] + Path(opts["filename"]).suffix.lower()
                )
                if not local_path.exists():
                    try:
                        os.link(source, local_path)
                    except OSError:
                        shutil.copyfile(source, local_path)
            elif source.stat().st_size > settings.max_file_size:
                raise ValueError(f"此解析器的单文件上限为 {settings.max_file_size} 字节，请拆分文件后导入")
            assets = {
                k: (queue.spool / v).read_bytes() for k, v in opts["assets"].items()
            }
            await IngestionService.process_file_upload(
                service,
                file_content=b"" if local_path else source.read_bytes(),
                source_path=local_path,
                file_path=opts.get("logical_path", opts["filename"]),
                kb_id=job["kb"],
                processing_id=task,
                asset_map=assets,
                source_type=opts["source_type"],
                source_metadata=opts["source_metadata"],
                user_id=opts["user_id"],
                file_id_override=job["file_id"],
            )
        queue.finish(job)
    except Exception as error:
        logger.error("Ingestion attempt failed (%s, %s)", task, type(error).__name__)
        queue.finish(job, error)
    finally:
        pulse.cancel()
        await asyncio.gather(pulse, return_exceptions=True)
        active_job.reset(token)
        if local_path is not None:
            local_path.unlink(missing_ok=True)


async def execute_portrait(queue, snapshot):
    from app.core.setup_service import get_setup_service
    from app.modules.knowledge.portraits import PortraitGenerator

    success = False
    try:
        get_setup_service(recover_preparation=False).refresh_worker_config()
        result = await PortraitGenerator().update_kb_portrait(
            snapshot["kb"], force_update=True
        )
        success = result.get("status") == "insufficient_data" or (
            result.get("status") == "success"
            and (result.get("storage_result") or {}).get("status") == "success"
        )
    except Exception as exc:
        logger.error("Desktop portrait rebuild failed (%s)", type(exc).__name__)
    finally:
        queue.finish_portrait(snapshot, success)


async def serve(queue, ready):
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def stop_worker(*_):
        loop.call_soon_threadsafe(stop.set)

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop_worker)

    shutil.rmtree(queue.root / "worker-input", ignore_errors=True)
    queue.recover()
    queue.collect_spool()
    if ready:

        def monitor_parent():
            try:
                while os.read(sys.stdin.fileno(), 256):
                    pass
            finally:
                stop_worker()

        threading.Thread(
            target=monitor_parent, name="worker-parent-pipe", daemon=True
        ).start()
        temp = ready.with_suffix(".tmp")
        temp.write_text(str(os.getpid()), encoding="ascii")
        os.replace(temp, ready)
    try:
        while not stop.is_set():
            job = queue.claim()
            if job:
                await execute_job(queue, job)
                queue.collect_spool()
            if stop.is_set():
                break
            portrait = queue.next_portrait()
            if portrait:
                await execute_portrait(queue, portrait)
            if job or portrait:
                continue
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.4)
            except asyncio.TimeoutError:
                pass
    finally:
        if ready:
            ready.unlink(missing_ok=True)


def main():
    queue = jobs()
    ready = os.environ.get("TESSMORA_WORKER_READY_FILE")
    try:
        with FileLock(queue.root / "worker.lock", timeout=0):
            asyncio.run(serve(queue, Path(ready) if ready else None))
    except Timeout:
        raise SystemExit(
            "This workspace already has a running ingestion worker"
        ) from None


if __name__ == "__main__":
    main()
