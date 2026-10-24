"""Accurate seek, bounded overlap, progress and cancellation contracts; no model calls."""

import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.config import settings
from app.modules.ingestion import service as ingestion_module
from app.modules.ingestion.service import IngestionService
from app.modules.ingestion.video_scene_shot import normalize_video_analysis
from app.modules.ingestion.video_segments import (
    extract_segment, prefetch_segments, segment_command, video_segments,
)


def test_interview_window_plan_keeps_every_window_and_final_tail():
    windows = video_segments(9262.997, 120, 15)
    assert len(windows) == 89
    assert windows[0].start == 0
    assert windows[-1].start == 9240
    assert windows[-1].duration == pytest.approx(22.997)
    assert all(b.start == a.start + 105 for a, b in zip(windows, windows[1:]))
    assert windows[-1].start + windows[-1].duration == pytest.approx(9262.997)


def test_seek_keeps_accurate_transcoding_and_audio_instead_of_stream_copy():
    command = segment_command("ffmpeg", "source.mkv", 8400, 120, "target.mp4")
    assert command.index("-ss") < command.index("-accurate_seek") < command.index("-i")
    assert command[command.index("-t") + 1] == "120"
    assert command[command.index("-c:v") + 1] == "libx264"
    assert command[command.index("-c:a") + 1] == "aac"
    assert "0:a?" in command and "copy" not in command


def test_prefetch_overlaps_only_one_next_window_and_cleans_early_exit(tmp_path):
    async def run():
        started = []
        next_ready = asyncio.Event()

        async def extract(window):
            started.append(window.index)
            path = tmp_path / f"segment-{window.index}.mp4"
            path.write_bytes(b"segment")
            if window.index == 2:
                next_ready.set()
            return str(path)

        async with prefetch_segments(video_segments(300, 120, 15), extract) as stream:
            first = await anext(stream)
            await asyncio.wait_for(next_ready.wait(), timeout=1)
            assert started == [1, 2]  # No third extraction while model 1 runs.
            assert Path(first.path).is_file()
            assert len(list(tmp_path.glob("segment-*"))) == 2
        assert not list(tmp_path.glob("segment-*"))
        assert started == [1, 2]

    asyncio.run(run())


@pytest.mark.parametrize("interrupt", ["cancel", "timeout"])
def test_extractor_reaps_only_its_child_and_removes_partial_output(tmp_path, monkeypatch, interrupt):
    """A real short-lived child proves cancellation does not merely cancel a thread."""
    source = tmp_path / "source.mkv"
    source.write_bytes(b"source")
    outputs, processes = [], []
    original_create = asyncio.create_subprocess_exec

    async def launch_owned_test_child(*command, **kwargs):
        target = command[-1]
        outputs.append(Path(target))
        process = await original_create(
            sys.executable, "-c",
            "import pathlib,sys,time; pathlib.Path(sys.argv[1]).write_bytes(b'partial'); time.sleep(60)",
            target, **kwargs,
        )
        processes.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", launch_owned_test_child)

    async def run():
        task = asyncio.create_task(extract_segment(
            "unused-ffmpeg", str(source), 10, 20, timeout=0.1 if interrupt == "timeout" else 5,
        ))
        if interrupt == "cancel":
            async def wait_for_partial_output():
                while not outputs or not outputs[0].exists() or outputs[0].stat().st_size == 0:
                    await asyncio.sleep(0.005)
            await asyncio.wait_for(wait_for_partial_output(), timeout=2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            assert await task is None
        assert len(processes) == 1 and processes[0].returncode is not None
        assert outputs and not outputs[0].exists()
        assert source.read_bytes() == b"source"

    asyncio.run(run())


def _service_fixture(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "video_chunk_window_seconds", 120)
    monkeypatch.setattr(settings, "video_max_chunk_duration_seconds", 120)
    monkeypatch.setattr(settings, "video_long_threshold_seconds", 120)
    monkeypatch.setattr(settings, "video_chunk_overlap_seconds", 15)
    service = IngestionService.__new__(IngestionService)
    service.minio_adapter = SimpleNamespace(upload_file=AsyncMock())
    service.vector_store = SimpleNamespace(
        delete_video_points_by_file_id=Mock(return_value=True),
        upsert_video_shot_vectors=AsyncMock(return_value={"points_inserted": 3}),
        upsert_video_keyframe_vectors=AsyncMock(return_value={"points_inserted": 0}),
    )
    service._cleanup_stale_video_keyframes = AsyncMock()
    updates, sources, extracted = [], [], []
    service._update_processing_status = lambda _id, update: updates.append(update)
    service._build_video_scene_shot_points = AsyncMock(return_value={
        "shot_points": [{"payload": {}} for _ in range(3)], "keyframe_points": [],
    })

    async def extract(_ffmpeg, source, start, duration):
        sources.append(Path(source))
        path = tmp_path / f"segment-{start}.mp4"
        path.write_bytes(b"test-segment")
        extracted.append((start, duration, path))
        return str(path)

    monkeypatch.setattr(ingestion_module, "extract_segment", extract)
    kwargs = {
        "parse_result": {"duration": 250, "format": "mkv", "fps": 24, "has_audio": True},
        "storage_result": {"file_id": "file-1", "object_path": "videos/source.mkv", "bucket": "kb-source"},
        "kb_id": "kb-1", "processing_id": "task-1", "file_content": b"x" * 1024,
    }
    return service, kwargs, updates, sources, extracted


def _analysis(index, duration):
    return normalize_video_analysis({
        "video_summary": f"window {index}",
        "scenes": [{"start_time": 0, "end_time": duration, "scene_summary": f"unique scene {index}",
                    "shots": [{"start_time": 0, "end_time": duration, "caption": f"caption {index}",
                               "asr_status": "present", "asr_text": f"spoken window {index}"}]}],
    }, duration)


@pytest.mark.parametrize("failed_window", [None, 2])
def test_prefetched_pipeline_preserves_context_order_atomicity_and_progress(monkeypatch, tmp_path, failed_window):
    service, kwargs, updates, sources, extracted = _service_fixture(monkeypatch, tmp_path)
    contexts, paths = [], []

    async def parse(**call):
        index = len(contexts) + 1
        contexts.append(call["previous_segments_summary"])
        paths.append(Path(call["video_local_path"]))
        assert paths[-1].is_file()
        await asyncio.sleep(0)  # Allow the single producer to make progress.
        if index == failed_window:
            return None
        return _analysis(index, call["duration"])

    service._parse_video_scene_shot_mllm = parse
    if failed_window:
        with pytest.raises(RuntimeError, match="105–225 秒"):
            asyncio.run(service._process_video_scene_shot(**kwargs))
        service._build_video_scene_shot_points.assert_not_awaited()
        service.minio_adapter.upload_file.assert_not_awaited()
        service.vector_store.delete_video_points_by_file_id.assert_not_called()
        service.vector_store.upsert_video_shot_vectors.assert_not_awaited()
    else:
        result = asyncio.run(service._process_video_scene_shot(**kwargs))
        assert result["shots_count"] == 3
        merged = service._build_video_scene_shot_points.call_args.kwargs["analysis"]
        assert merged["coverage"] == {"start_time": 0.0, "end_time": 250.0}
        assert service.minio_adapter.upload_file.call_args.kwargs["kb_id"] == "kb-source"
    assert len(contexts) == 3
    assert "首段" in contexts[0]
    assert "spoken window 1" in contexts[1]
    assert f"spoken window {1 if failed_window else 2}" in contexts[2]
    assert [(start, duration) for start, duration, _ in extracted] == [(0.0, 120), (105.0, 120), (210.0, 40)]
    assert all(not path.exists() for path in paths + sources)
    assert not list(tmp_path.glob("segment-*"))
    progress = [u["progress"] for u in updates if "progress" in u]
    assert progress == sorted(progress)
    assert all(u["segment_total"] == 3 for u in updates if "segment_total" in u)
    assert [u["stage"] for u in updates if u.get("segment_index") and "stage" in u] == [
        "preparing_segment", "preparing_segment", "preparing_segment",
    ]
    assert sum(u.get("stage") == "parsing_segment" for u in updates) == 3


def test_cancel_during_model_wait_cleans_current_lookahead_and_source(monkeypatch, tmp_path):
    service, kwargs, _updates, sources, extracted = _service_fixture(monkeypatch, tmp_path)

    async def run():
        entered = asyncio.Event()

        async def parse(**_call):
            entered.set()
            await asyncio.Event().wait()

        service._parse_video_scene_shot_mllm = parse
        task = asyncio.create_task(service._process_video_scene_shot(**kwargs))
        await entered.wait()
        await asyncio.sleep(0)
        assert len(extracted) == 2
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert all(not source.exists() for source in sources)
        assert not list(tmp_path.glob("segment-*"))
        service.minio_adapter.upload_file.assert_not_awaited()
        service.vector_store.delete_video_points_by_file_id.assert_not_called()

    asyncio.run(run())
