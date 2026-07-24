"""批量异步上传与刷新恢复的回归测试。"""

import asyncio
import time
from datetime import datetime, timedelta
from io import BytesIO
from unittest.mock import AsyncMock

from starlette.datastructures import UploadFile

from app.api import upload as upload_api
from app.modules.ingestion.service import IngestionService
from app.modules.knowledge.service import KnowledgeBaseService


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.sets = {}

    def setex(self, key, _ttl, value):
        self.values[key] = value

    def sadd(self, key, *values):
        self.sets.setdefault(key, set()).update(values)

    def expire(self, _key, _ttl):
        return True

    def get(self, key):
        return self.values.get(key)

    def smembers(self, key):
        return self.sets.get(key, set())


def _queue_service(redis_client):
    service = IngestionService.__new__(IngestionService)
    service._processing_status = {}
    service._processing_status_redis_client = redis_client
    service._background_upload_tasks = {}
    service._video_processing_semaphore = None
    return service


def test_queued_upload_state_survives_a_new_service_instance():
    fake_redis = FakeRedis()
    producer = _queue_service(fake_redis)
    producer.register_processing_initial(
        "task-1",
        "第二个视频.mp4",
        "kb-video",
        file_size=123,
        queued=True,
    )

    # 模拟浏览器刷新后请求落到一个没有进程内状态的新实例；状态仍可从 Redis 找回。
    consumer = _queue_service(fake_redis)
    restored = consumer.list_processing_statuses_for_kb("kb-video")

    assert len(restored) == 1
    assert restored[0]["processing_id"] == "task-1"
    assert restored[0]["status"] == "queued"
    assert restored[0]["file_size"] == 123


def test_expired_upload_lease_is_recovered_as_failed_after_restart():
    fake_redis = FakeRedis()
    producer = _queue_service(fake_redis)
    producer.register_processing_initial(
        "task-expired",
        "崩溃前的视频.mp4",
        "kb-video",
        file_size=123,
        queued=True,
        lease_id="worker-lease-1",
    )
    stale_at = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    producer._processing_status["task-expired"].update({
        "lease_heartbeat_at": stale_at,
        "updated_at": stale_at,
    })
    producer._persist_processing_status(producer._processing_status["task-expired"])

    # 新进程没有运行中的 task；文件列表读取会将失联 lease 安全回收。
    consumer = _queue_service(fake_redis)
    recovered = consumer.list_processing_statuses_for_kb("kb-video")

    assert recovered[0]["status"] == "failed"
    assert recovered[0]["error"] == "processing lease expired"
    assert recovered[0]["lease_expired_at"]


def test_fresh_upload_lease_is_not_recovered_by_another_service_instance():
    fake_redis = FakeRedis()
    producer = _queue_service(fake_redis)
    producer.register_processing_initial(
        "task-live",
        "仍在处理的视频.mp4",
        "kb-video",
        queued=True,
        lease_id="worker-lease-live",
    )

    consumer = _queue_service(fake_redis)
    restored = consumer.list_processing_statuses_for_kb("kb-video")

    assert restored[0]["status"] == "queued"
    assert restored[0]["lease_id"] == "worker-lease-live"


def test_start_file_upload_registers_each_task_before_background_work_runs():
    async def run():
        service = _queue_service(FakeRedis())
        service.process_file_upload = AsyncMock(return_value={"status": "completed"})

        first = service.start_file_upload(
            file_content=b"video-1",
            file_path="第一个视频.mp4",
            kb_id="kb-video",
        )
        second = service.start_file_upload(
            file_content=b"video-2",
            file_path="第二个视频.mp4",
            kb_id="kb-video",
        )

        assert first["processing_id"] != second["processing_id"]
        assert all(item["status"] == "queued" for item in service._processing_status.values())
        await asyncio.sleep(0)
        assert service.process_file_upload.await_count == 2

    asyncio.run(run())


def test_background_upload_keeps_lease_heartbeat_while_work_is_pending():
    async def run():
        service = _queue_service(FakeRedis())
        entered = asyncio.Event()
        release = asyncio.Event()
        refresh_calls = []
        service._processing_lease_heartbeat_interval_seconds = lambda: 0.01
        original_refresh = service._refresh_processing_lease

        def record_refresh(processing_id, lease_id):
            refresh_calls.append((processing_id, lease_id))
            return original_refresh(processing_id, lease_id)

        async def pending_upload(**kwargs):
            entered.set()
            await release.wait()
            service._update_processing_status(kwargs["processing_id"], {"status": "completed"})
            return {"status": "completed"}

        service._refresh_processing_lease = record_refresh
        service.process_file_upload = pending_upload
        started = service.start_file_upload(
            file_content=b"video",
            file_path="等待队列的视频.mp4",
            kb_id="kb-video",
        )
        task = service._background_upload_tasks[started["processing_id"]]
        await entered.wait()
        await asyncio.sleep(0.035)
        assert refresh_calls
        assert service._processing_status[started["processing_id"]]["lease_heartbeat_at"]

        release.set()
        await task

    asyncio.run(run())


def test_failed_persisted_video_can_be_requeued_without_reuploading_source():
    async def run():
        service = _queue_service(FakeRedis())
        service._processing_status["video-retry"] = {
            "processing_id": "video-retry",
            "status": "failed",
            "stage": "error",
            "file_type": "video",
            "file_id": "file-video-1",
            "bucket": "kb-video",
            "object_path": "videos/file-video-1_demo.mp4",
            "file_path": "demo.mp4",
            "source_kb_id": "kb-video",
            "kb_id": "kb-video",
            "file_size": 123,
            "error": "invalid model json",
        }
        service._persist_processing_status(service._processing_status["video-retry"])

        async def fake_reprocess(*, processing_id, status):
            assert processing_id == "video-retry"
            assert status["file_id"] == "file-video-1"
            service._update_processing_status(processing_id, {
                "status": "completed",
                "stage": "completed",
                "progress": 100,
            })
            return {"file_id": "file-video-1", "status": "completed"}

        service._reprocess_persisted_video = fake_reprocess
        started = service.retry_video_processing("video-retry")
        assert started["status"] == "queued"
        assert started["file_id"] == "file-video-1"
        assert started["retry_count"] == 1

        await service._background_upload_tasks["video-retry"]
        assert service._processing_status["video-retry"]["status"] == "completed"
        assert service._processing_status["video-retry"]["retry_count"] == 1

    asyncio.run(run())


def test_batch_start_registers_every_file_before_starting_any_background_task(monkeypatch):
    calls = []

    class FakeIngestion:
        def prepare_file_upload(self, **kwargs):
            calls.append(("prepare", kwargs))
            return {"processing_id": f"task-{len([c for c in calls if c[0] == 'prepare'])}"}

        def launch_prepared_file_upload(self, **kwargs):
            # 如果这里提前运行，批量读取后续 UploadFile 时可能把第一个视频的同步
            # MinIO 上传带入事件循环；必须等两项都已完成持久化登记。
            assert len([c for c in calls if c[0] == "prepare"]) == 2
            calls.append(("launch", kwargs))
            return {"processing_id": kwargs["processing_id"]}

    monkeypatch.setattr(upload_api, "_ingestion", lambda: FakeIngestion())
    first = UploadFile(file=BytesIO(b"first"), filename="第一个视频.mp4")
    second = UploadFile(file=BytesIO(b"second"), filename="第二个视频.mp4")

    result = asyncio.run(
        upload_api.start_upload_batch(
            kb_id="kb-video",
            files=[first, second],
            source_type=None,
        )
    )

    assert result["accepted_count"] == 2
    assert [item["processing_id"] for item in result["results"]] == ["task-1", "task-2"]
    assert [kind for kind, _kwargs in calls] == ["prepare", "prepare", "launch", "launch"]
    assert [kwargs["file_path"] for _kind, kwargs in calls] == [
        "第一个视频.mp4",
        "第二个视频.mp4",
        "第一个视频.mp4",
        "第二个视频.mp4",
    ]


def test_file_list_includes_queued_placeholder_before_minio_object_exists(monkeypatch):
    class FakeMinio:
        def get_bucket_for_kb(self, _kb_id):
            return "kb-video"

        def bucket_exists(self, _bucket):
            return True

        async def list_files(self, **_kwargs):
            return []

    class FakeRegistry:
        def list_processing_statuses_for_kb(self, _kb_id):
            return [{
                "processing_id": "task-2",
                "status": "queued",
                "file_path": "第二个视频.mp4",
                "file_size": 456,
                "submitted_at": "2026-07-23T16:00:00",
            }]

    import app.modules.ingestion.service as ingestion_service_module

    monkeypatch.setattr(ingestion_service_module, "get_ingestion_service", lambda: FakeRegistry())
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = FakeMinio()
    service._kb_id_candidates = lambda kb_id: [kb_id]

    files = asyncio.run(service.list_kb_files("kb-video"))

    assert files == [{
        "id": "processing:task-2",
        "processing_id": "task-2",
        "name": "第二个视频.mp4",
        "size": 456,
        "date": "2026-07-23T16:00:00",
        "type": "mp4",
        "status": "queued",
        "submitted_at": "2026-07-23T16:00:00",
    }]


def test_file_list_merges_live_task_details_into_persisted_video(monkeypatch):
    class FakeMinio:
        def get_bucket_for_kb(self, _kb_id):
            return "kb-video"

        def bucket_exists(self, _bucket):
            return True

        async def list_files(self, **_kwargs):
            return [{
                "object_path": "videos/video-1_正在解析的视频.mp4",
                "size": 1024,
                "last_modified": None,
            }]

    class FakeRegistry:
        def list_processing_statuses_for_kb(self, _kb_id):
            return [{
                "processing_id": "task-video-1",
                "file_id": "video-1",
                "status": "processing",
                "stage": "vectorizing",
                "progress": 72,
                "message": "正在构建 Shot 的四路向量并提取关键帧…",
                "error": None,
                "submitted_at": "2026-07-24T10:00:00",
                "updated_at": "2026-07-24T10:03:00",
                "lease_heartbeat_at": "2026-07-24T10:03:00",
                "lease_expires_at": "2026-07-24T10:08:00",
            }]

    class FakeVectorStore:
        def scroll_video_shot_points_by_file_id(self, **_kwargs):
            raise AssertionError("active task must not query Qdrant before rendering its state")

    import app.modules.ingestion.service as ingestion_service_module

    monkeypatch.setattr(ingestion_service_module, "get_ingestion_service", lambda: FakeRegistry())
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = FakeMinio()
    service.vector_store = FakeVectorStore()
    service._kb_id_candidates = lambda kb_id: [kb_id]

    files = asyncio.run(service.list_kb_files("kb-video"))

    assert files == [{
        "id": "video-1",
        "name": "正在解析的视频.mp4",
        "size": 1024,
        "date": "",
        "type": "mp4",
        "processing_id": "task-video-1",
        "status": "processing",
        "stage": "vectorizing",
        "progress": 72,
        "message": "正在构建 Shot 的四路向量并提取关键帧…",
        "submitted_at": "2026-07-24T10:00:00",
        "updated_at": "2026-07-24T10:03:00",
        "lease_heartbeat_at": "2026-07-24T10:03:00",
        "lease_expires_at": "2026-07-24T10:08:00",
    }]


def test_file_list_returns_raw_files_when_task_state_source_times_out(monkeypatch):
    class FakeMinio:
        def get_bucket_for_kb(self, _kb_id):
            return "kb-video"

        def bucket_exists(self, _bucket):
            return True

        async def list_files(self, **_kwargs):
            return [{
                "object_path": "documents/doc-1_notes.bin",
                "size": 100,
                "last_modified": None,
            }]

    class SlowRegistry:
        def list_processing_statuses_for_kb(self, _kb_id):
            time.sleep(0.08)
            return [{"processing_id": "late-task", "status": "processing"}]

    import app.modules.ingestion.service as ingestion_service_module
    import app.modules.knowledge.service as knowledge_service_module

    monkeypatch.setattr(ingestion_service_module, "get_ingestion_service", lambda: SlowRegistry())
    monkeypatch.setattr(knowledge_service_module, "_PROCESSING_STATUS_LOOKUP_TIMEOUT_SECONDS", 0.01)
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = FakeMinio()
    service._kb_id_candidates = lambda kb_id: [kb_id]

    async def _read_files():
        started = time.monotonic()
        files = await service.list_kb_files("kb-video")
        return time.monotonic() - started, files

    elapsed, files = asyncio.run(_read_files())

    # asyncio.run 会在协程返回后等待其默认线程池清理；这里断言 API 协程本身
    # 已在 deadline 内返回，生产请求不会等待慢状态源完成。
    assert elapsed < 0.06
    assert files == [{
        "id": "doc-1",
        "name": "notes.bin",
        "size": 100,
        "date": "",
        "type": "bin",
    }]


def test_file_processing_status_prefers_the_most_recent_retry_state():
    service = _queue_service(FakeRedis())
    service._processing_status = {
        "old-failed": {
            "processing_id": "old-failed",
            "file_id": "same-file",
            "source_kb_id": "kb-video",
            "status": "failed",
            "updated_at": "2026-07-23T10:00:00",
        },
        "new-processing": {
            "processing_id": "new-processing",
            "file_id": "same-file",
            "source_kb_id": "kb-video",
            "status": "processing",
            "updated_at": "2026-07-23T11:00:00",
        },
    }

    status = service.get_file_processing_status("same-file", kb_id="kb-video")

    assert status is not None
    assert status["processing_id"] == "new-processing"
