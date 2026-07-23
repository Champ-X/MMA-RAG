"""视频统计与失败安全的回归测试。"""

import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.knowledge import _stats_for_frontend
from app.core import portrait_trigger
from app.modules.ingestion.service import IngestionService
from app.modules.knowledge.service import KnowledgeBaseService, _count_raw_video_files


def test_raw_video_count_excludes_scene_shot_artifacts_and_api_exposes_both_units():
    raw_files = [
        {"object_path": "videos/video-1_讲解甜瓜.mp4", "size": 10},
        {"object_path": "videos/video-1/analysis/scene_shot_asr_v4.json", "size": 2},
        {"object_path": "videos/video-1/keyframes/scene-001_shot-001_0.jpg", "size": 3},
        {"object_path": "videos/video-2_另一个视频.mp4", "size": 11},
        {"object_path": "documents/doc-1_notes.md", "size": 4},
    ]

    assert _count_raw_video_files(raw_files) == 2
    frontend = _stats_for_frontend(
        {"total_video_files": 2, "total_video_shots": 53, "total_video": 53}
    )
    assert frontend["video"] == 2
    assert frontend["video_shots"] == 53


def test_statistics_returns_raw_video_count_even_when_the_video_is_not_indexed():
    class FakeMinio:
        def get_bucket_for_kb(self, _kb_id):
            return "kb-demo"

        def bucket_exists(self, _bucket):
            return True

        async def list_files(self, **_kwargs):
            return [
                {"object_path": "videos/video-1_尚未解析.mp4", "size": 1024},
                {"object_path": "videos/video-1/analysis/scene_shot_asr_v4.json", "size": 10},
            ]

    class FakeVectorStore:
        async def count_kb_audio(self, _kb_id):
            return 0

        async def count_kb_video(self, _kb_id):
            return 0

    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = FakeMinio()
    service.vector_store = FakeVectorStore()
    service._kb_id_candidates = lambda kb_id: [kb_id]
    service._count_kb_points_sync = lambda _kb_id: (0, 0)
    service._scroll_text_chunks_file_ids_sync = lambda _kb_id: set()

    async def no_discovered_kb(_kb_id):
        return None

    service._discover_kb_id_from_bucket_async = no_discovered_kb
    stats = asyncio.run(service._get_kb_statistics("demo"))

    assert stats["total_video_files"] == 1
    assert stats["total_video_shots"] == 0


def test_statistics_separates_one_video_file_from_fifty_three_shots():
    class FakeMinio:
        def get_bucket_for_kb(self, _kb_id):
            return "kb-demo"

        def bucket_exists(self, _bucket):
            return True

        async def list_files(self, **_kwargs):
            return [
                {"object_path": "videos/video-1_甜瓜.mp4", "size": 1024},
                {"object_path": "videos/video-1/keyframes/scene-001_shot-001_0.jpg", "size": 10},
            ]

    class FakeVectorStore:
        async def count_kb_audio(self, _kb_id):
            return 0

        async def count_kb_video(self, _kb_id):
            return 53

    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = FakeMinio()
    service.vector_store = FakeVectorStore()
    service._kb_id_candidates = lambda kb_id: [kb_id]
    service._count_kb_points_sync = lambda _kb_id: (0, 0)
    service._scroll_text_chunks_file_ids_sync = lambda _kb_id: set()

    async def no_discovered_kb(_kb_id):
        return None

    service._discover_kb_id_from_bucket_async = no_discovered_kb
    stats = asyncio.run(service._get_kb_statistics("demo"))

    assert stats["total_video_files"] == 1
    assert stats["total_video_shots"] == 53
    assert _stats_for_frontend(stats)["video"] == 1
    assert _stats_for_frontend(stats)["video_shots"] == 53


def test_video_portrait_rebuild_prefers_celery_over_self_http(monkeypatch):
    """视频上传/删除不能在当前 API 请求内同步回调自身。"""
    enqueue = Mock(return_value=True)
    fallback = Mock(return_value=True)
    monkeypatch.setattr(portrait_trigger, "_enqueue_portrait_task", enqueue)
    monkeypatch.setattr(portrait_trigger, "_schedule_portrait_via_sync_api", fallback)

    assert portrait_trigger.trigger_portrait_rebuild("kb-video", reason="video_ingested")
    enqueue.assert_called_once_with("kb-video", force_update=True)
    fallback.assert_not_called()


def test_video_portrait_rebuild_fallback_is_scheduled_not_executed_inline(monkeypatch):
    enqueue = Mock(return_value=False)
    fallback = Mock(return_value=True)
    monkeypatch.setattr(portrait_trigger, "_enqueue_portrait_task", enqueue)
    monkeypatch.setattr(portrait_trigger, "_schedule_portrait_via_sync_api", fallback)

    assert portrait_trigger.trigger_portrait_rebuild("kb-video", reason="video_deleted")
    enqueue.assert_called_once_with("kb-video", force_update=True)
    fallback.assert_called_once_with("kb-video")


def test_video_mllm_failure_does_not_create_a_fake_ready_shot():
    class FakeMinio:
        async def get_presigned_url(self, *_args, **_kwargs):
            return "https://example.test/video.mp4"

    service = IngestionService.__new__(IngestionService)
    service.minio_adapter = FakeMinio()
    service._update_processing_status = Mock()
    service._parse_video_scene_shot_mllm = AsyncMock(return_value=None)
    service._build_video_scene_shot_points = AsyncMock()

    with pytest.raises(RuntimeError, match="未返回有效的 Scene–Shot"):
        asyncio.run(
            service._process_video_scene_shot(
                parse_result={"duration": 10, "format": "mp4", "fps": 24, "has_audio": True},
                storage_result={
                    "file_id": "video-1",
                    "object_path": "videos/video-1_测试.mp4",
                    "bucket": "kb-origin",
                },
                kb_id="qdrant-legacy-kb",
                processing_id="process-1",
                file_content=b"",
            )
        )

    service._build_video_scene_shot_points.assert_not_awaited()


def test_video_keyframe_artifacts_stay_with_the_original_video_bucket():
    uploads = []

    class FakeMinio:
        async def upload_file(self, **kwargs):
            uploads.append(kwargs)
            return {"object_path": kwargs["custom_object_path"]}

    class FakeSparseEncoder:
        def encode_corpus(self, texts):
            return [{"sparse": {1: 1.0}} for _ in texts]

    async def embed(texts, label, **_kwargs):
        if label == "视频关键帧描述":
            return [[0.5, 0.5] for _ in texts]
        return [[1.0, 0.0] for _ in texts]

    service = IngestionService.__new__(IngestionService)
    service.minio_adapter = FakeMinio()
    service.sparse_encoder = FakeSparseEncoder()
    service._embed_video_texts = embed
    service._extract_frame_at_timestamp_from_path = lambda *_args: b"jpeg-bytes"
    service._vectorize_with_clip = AsyncMock(return_value={"clip_vector": [0.1] * 768})

    analysis = {
        "video_summary": "甜瓜讲解",
        "scenes": [
            {
                "scene_id": "scene-001",
                "start_time": 0.0,
                "end_time": 8.0,
                "scene_summary": "讲解者展示甜瓜。",
                "shots": [
                    {
                        "shot_id": "shot-001",
                        "start_time": 0.0,
                        "end_time": 8.0,
                        "caption": "讲解者切开甜瓜。",
                        "asr_text": "",
                        "keyframes": [{"timestamp": 4.0, "description": "切开的甜瓜。"}],
                    }
                ],
            }
        ],
    }

    result = asyncio.run(
        service._build_video_scene_shot_points(
            video_bytes=b"video-bytes",
            analysis=analysis,
            file_id="video-1",
            file_path="videos/video-1_测试.mp4",
            manifest_path="videos/video-1/analysis/scene_shot_asr_v4.json",
            storage_kb_id="kb-origin",
            duration=8.0,
            video_format="mp4",
            resolution="1920x1080",
            fps=24.0,
            has_audio=True,
            processing_id="process-1",
        )
    )

    assert len(result["keyframe_points"]) == 1
    assert uploads and uploads[0]["kb_id"] == "kb-origin"
    assert result["keyframe_points"][0]["payload"]["frame_image_path"].startswith(
        "videos/video-1/keyframes/"
    )
