"""Video gallery covers reuse stored keyframes without changing media previews."""

import asyncio
from unittest.mock import AsyncMock, Mock

from app.modules.knowledge.service import (
    KnowledgeBaseService,
    _select_video_file_covers,
    _video_keyframe_timestamp,
)


def frame(file_id, seconds):
    return {
        "object_path": f"videos/{file_id}/keyframes/scene_001_shot_001_01_0_{seconds}_000.jpg",
        "size": 256,
    }


def test_cover_selection_is_stable_and_scoped_to_each_source_video():
    raw = [frame("a", second) for second in [0, 40, 80, 120]] + [frame("b", 250)]
    selected = _select_video_file_covers(raw)
    assert selected == _select_video_file_covers(list(reversed(raw)))
    assert selected["a"] == (frame("a", 40)["object_path"], 40.0)
    assert selected["b"] == (frame("b", 250)["object_path"], 250.0)


def test_cover_selection_excludes_unrelated_artifacts_and_empty_images():
    assert _select_video_file_covers([
        {"object_path": "images/a_illustration.jpg", "size": 50},
        {"object_path": "videos/a/analysis/scene.json", "size": 50},
        {"object_path": "videos/a/keyframes/metadata.json", "size": 50},
        {"object_path": "videos/a/keyframes/empty.jpg", "size": 0},
        {"object_path": "videos/a_original.mp4", "size": 50},
    ]) == {}


def test_legacy_frames_remain_supported_without_inventing_timestamps():
    assert _video_keyframe_timestamp("videos/a/keyframes/seg_1_82_5.jpg") == 82.5
    assert _video_keyframe_timestamp(frame("a", 120)["object_path"]) == 120.0
    assert _video_keyframe_timestamp("videos/a/keyframes/scene-001_shot-001_0.jpg") is None
    path = "videos/a/keyframes/unknown.jpg"
    assert _select_video_file_covers([{"object_path": path, "size": 50}]) == {"a": (path, None)}


def make_service(*, fail_cover=False):
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = Mock()
    service.minio_adapter.get_bucket_for_kb.return_value = "kb-current"
    service.minio_adapter.bucket_exists.return_value = True
    service.minio_adapter.list_files = AsyncMock(return_value=[
        {"object_path": "videos/a_带封面.mp4", "size": 1000},
        {"object_path": "videos/b_未解析.mp4", "size": 2000},
        {"object_path": "documents/c_notes.pdf", "size": 500},
        frame("a", 40),
    ])

    async def presign(bucket, path, **_kwargs):
        if fail_cover and "/keyframes/" in path:
            raise RuntimeError("cover unavailable")
        return f"https://storage.test/{bucket}/{path}"

    service.minio_adapter.get_presigned_url = AsyncMock(side_effect=presign)
    service._list_processing_statuses_for_kb_best_effort = AsyncMock(return_value=[])
    service._get_video_file_index_status = Mock(side_effect=["ready", "unindexed"])
    return service


def test_file_list_adds_cover_using_single_current_bucket_listing():
    service = make_service()
    files = asyncio.run(service.list_kb_files("current"))
    assert len(files) == 3  # The internal keyframe never becomes an uploaded file.
    assert files[0]["cover_url"].startswith("https://storage.test/kb-current/videos/a/keyframes/")
    assert files[0]["cover_timestamp"] == 40.0
    assert files[0]["status"] == "ready"
    assert "preview_url" not in files[0]  # A frame must never replace the original video.
    assert "cover_url" not in files[1]
    assert files[1]["status"] == "unindexed"
    assert files[2]["preview_url"].endswith("documents/c_notes.pdf")
    service.minio_adapter.list_files.assert_awaited_once_with(bucket="kb-current", prefix="", max_keys=1000)


def test_cover_failure_does_not_hide_files_or_break_document_previews():
    service = make_service(fail_cover=True)
    files = asyncio.run(service.list_kb_files("current"))
    assert [file["id"] for file in files] == ["a", "b", "c"]
    assert "cover_url" not in files[0]
    assert files[0]["status"] == "ready"
    assert files[2]["preview_url"].endswith("documents/c_notes.pdf")
