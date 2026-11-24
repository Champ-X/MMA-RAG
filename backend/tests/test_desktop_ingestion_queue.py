"""Desktop receipt boundaries and restart fencing, using isolated workspaces."""
import asyncio
import io
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.modules.ingestion.desktop_jobs import (
    DesktopJobs,
    JobConflict,
    WorkerOwnershipLost,
    active_job,
)


def op():
    return str(uuid.uuid4())


def test_input_receipt_is_durable_across_reopen_and_concurrent_replay(tmp_path):
    q = DesktopJobs(tmp_path)
    task = op()
    content = b"a" * (2 * 1024 * 1024 + 1)

    class Chunked(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024
            return super().read(size)

    def send():
        return q.enqueue(Chunked(content), "手册.pdf", "space", processing_id=task)

    with ThreadPoolExecutor(2) as pool:
        receipts = list(pool.map(lambda _: send(), range(2)))
    assert receipts[0] == receipts[1]
    assert DesktopJobs(tmp_path).status(task)["file_size"] == len(content)
    assert len(list(q.spool.iterdir())) == 1
    with pytest.raises(JobConflict):
        q.enqueue(io.BytesIO(b"other"), "手册.pdf", "space", processing_id=task)
    assert len(list(q.spool.iterdir())) == 1
    independent = q.enqueue(io.BytesIO(content), "手册.pdf", "space")
    assert independent["file_id"] != receipts[0]["file_id"]


def test_gc_preserves_inflight_staging_and_shared_objects(tmp_path):
    q = DesktopJobs(tmp_path)
    with q._stage(io.BytesIO(b"pending")) as (temp, _, _):
        q.collect_spool()
        assert temp.read_bytes() == b"pending"
    orphan = q.spool / "dead.part"
    orphan.write_bytes(b"orphan")
    q.collect_spool()
    assert not list(q.spool.iterdir())


def test_restart_fences_crashed_owner_recovers_persisted_success_and_cancel(tmp_path):
    q = DesktopJobs(tmp_path)
    task = q.enqueue(io.BytesIO(b"data"), "a.txt", "space")["processing_id"]
    original = q.claim()
    with pytest.raises(WorkerOwnershipLost):
        q.progress({"processing_id": task, "status": "completed"})
    q.recover()
    replacement = q.claim()
    with pytest.raises(WorkerOwnershipLost):
        q.finish(original)
    token = active_job.set((task, replacement["owner"]))
    try:
        q.progress(
            {
                "processing_id": task,
                "status": "completed",
                "result": {"file_id": replacement["file_id"]},
            }
        )
    finally:
        active_job.reset(token)
    assert q.cancel(task)["status"] == "completed"
    q.recover()
    assert q.claim() is None
    assert asyncio.run(q.wait(task))["file_id"] == replacement["file_id"]
    q.collect_spool()
    assert not list(q.spool.iterdir())
    second = q.enqueue(io.BytesIO(b"more"), "b.txt", "space")["processing_id"]
    assert q.cancel(second)["status"] == "cancelled"
    assert q.retry(second)["status"] == "queued"
    job = q.claim()
    assert q.cancel(second)["stage"] == "cancelling"
    q.finish(job, RuntimeError("cancelled"))
    assert q.status(second)["status"] == "cancelled"


def test_batch_endpoint_stages_item_by_item_and_exposes_status(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.upload import router

    monkeypatch.setenv("TESSMORA_RUNTIME_PROFILE", "desktop")
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        ids = [op(), op()]
        import json

        args = dict(
            data={"kb_id": "kb", "request_ids": json.dumps(ids)},
            files=[("files", ("手册.pdf", b"%PDF")), ("files", ("bad.exe", b"no"))],
        )
        receipt = client.post("/batch/start", **args)
        assert receipt.status_code == 202, receipt.text
        assert receipt.json()["accepted_count"] == 1
        assert receipt.json()["failed_count"] == 1
        assert receipt.json() == client.post("/batch/start", **args).json()
        assert client.get("/progress/" + ids[0]).json()["file_size"] == 4
        assert client.post("/cancel/" + ids[0]).json()["status"] == "cancelled"
        assert client.post("/cancel/" + ids[1]).status_code == 404


def test_worker_child_is_exclusive_and_exits_on_host_eof(tmp_path):
    ready = tmp_path / "worker-ready"
    env = {
        **os.environ,
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
        "TESSMORA_RUNTIME_PROFILE": "desktop",
        "TESSMORA_STATE_DIR": str(tmp_path),
        "TESSMORA_WORKER_READY_FILE": str(ready),
    }
    command = [sys.executable, "-m", "app.modules.ingestion.desktop_worker"]
    with subprocess.Popen(command, env=env, stdin=subprocess.PIPE) as process:
        try:
            deadline = time.monotonic() + 15
            while (
                not ready.exists()
                and time.monotonic() < deadline
                and process.poll() is None
            ):
                time.sleep(0.05)
            assert ready.read_text() == str(process.pid)
            assert (
                subprocess.run(
                    command, env=env, capture_output=True, timeout=10
                ).returncode
                != 0
            )
            assert process.poll() is None
            process.stdin.close()
            assert process.wait(timeout=5) == 0
            assert not ready.exists()
        finally:
            if process.poll() is None:
                process.kill()


def test_paid_response_replays_after_crash_and_ambiguous_call_requires_consent(
    tmp_path, monkeypatch
):
    from app.modules.ingestion.desktop_jobs import jobs, ProviderOutcomeUnknown
    from app.modules.ingestion.provider_receipts import recorded_provider_call

    monkeypatch.setenv("TESSMORA_RUNTIME_PROFILE", "desktop")
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    q = jobs()
    task = q.enqueue(io.BytesIO(b"pdf"), "a.pdf", "space")["processing_id"]
    counter = []

    async def answer():
        counter.append(1)
        return {"choices": [{"text": "confirmed"}], "asset": b"image"}

    async def lost():
        counter.append(2)
        raise TimeoutError

    first = q.claim()
    token = active_job.set((task, first["owner"]))
    try:
        accepted = asyncio.run(
            recorded_provider_call("model", {"prompt": "same"}, answer)
        )
    finally:
        active_job.reset(token)
    q.recover()
    second = q.claim()
    token = active_job.set((task, second["owner"]))
    try:
        assert accepted == asyncio.run(
            recorded_provider_call("model", {"prompt": "same"}, answer)
        )
        with pytest.raises(ProviderOutcomeUnknown):
            asyncio.run(recorded_provider_call("model", {"prompt": "other"}, lost))
        with pytest.raises(ProviderOutcomeUnknown):
            asyncio.run(
                recorded_provider_call("fallback-model", {"prompt": "other"}, answer)
            )
    finally:
        active_job.reset(token)
    q.recover()
    assert q.status(task)["error_code"] == "provider_interrupted"
    with pytest.raises(JobConflict):
        q.retry(task)
    q.retry(task, confirm_provider_retry=True)
    third = q.claim()
    token = active_job.set((task, third["owner"]))
    try:
        assert accepted == asyncio.run(
            recorded_provider_call("model", {"prompt": "same"}, answer)
        )
        assert accepted == asyncio.run(
            recorded_provider_call("model", {"prompt": "other"}, answer)
        )
    finally:
        active_job.reset(token)
    assert counter == [1, 2, 1]


def test_portrait_counts_survive_termination_concurrent_additions_and_redelivery(
    tmp_path, monkeypatch
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "portrait_update_threshold", 3)
    q = DesktopJobs(tmp_path)
    task = q.enqueue(io.BytesIO(b"x"), "a.txt", "space")["processing_id"]
    first = q.claim()
    token = active_job.set((task, first["owner"]))
    try:
        assert q.add_portrait_delta("space", 3) == 3
        assert q.add_portrait_delta("space", 3) == 3
    finally:
        active_job.reset(token)
    claim = q.next_portrait()
    assert claim["dirty"] == 3
    assert q.add_portrait_delta("space", 2, force=True) == 5
    q.recover()
    assert q.next_portrait()["dirty"] == 5
    q.finish_portrait(claim, True)  # stale claim after a process restart
    q.recover()
    renewed = q.next_portrait()
    q.finish_portrait(renewed, False)
    with q.connection(write=True) as conn:
        assert conn.execute("SELECT dirty FROM portrait").fetchone()[0] == 5
        conn.execute("UPDATE portrait SET retry_after=0")
    renewed = q.next_portrait()
    q.add_portrait_delta("space", 2, force=True)
    q.finish_portrait(renewed, True)
    q.finish_portrait(renewed, True)  # delayed duplicate ACK
    next_work = DesktopJobs(tmp_path).next_portrait()
    assert next_work["dirty"] == 2
    assert next_work["urgent"] == 1
    q.finish_portrait(next_work, True)
    assert q.next_portrait() is None


def test_directory_stages_sibling_images_and_stable_relative_ids(tmp_path, monkeypatch):
    from app.modules.ingestion.desktop_folder import stage_directory
    from app.modules.ingestion.desktop_jobs import jobs

    monkeypatch.setenv("TESSMORA_RUNTIME_PROFILE", "desktop")
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "手册"
    section = root / "part"
    section.mkdir(parents=True)
    (section / "notes.md").write_text("![graphic](../graphic.png)")
    (root / "graphic.png").write_bytes(b"image")
    with_external = root / "not-library"
    try:
        with_external.symlink_to(tmp_path)
    except OSError:
        pass
    group = op()
    entries = stage_directory(root, "kb", request_id=group)
    assert len(entries) == 2
    assert entries == stage_directory(root, "kb", request_id=group)
    while job := jobs().claim():
        if job["options"]["filename"] == "notes.md":
            assert job["options"]["logical_path"] == "part/notes.md"
            assert (
                jobs().spool / job["options"]["assets"]["graphic.png"]
            ).read_bytes() == b"image"
            break
    else:
        pytest.fail("Markdown job not found")
