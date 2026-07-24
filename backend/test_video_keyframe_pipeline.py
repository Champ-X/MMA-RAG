"""视频关键帧预算与 CLIP 批处理的轻量回归测试。"""

import asyncio
from io import BytesIO
import json
import tempfile

import torch
from PIL import Image

from app.core.config import settings
from app.modules.ingestion.service import IngestionService


def _shot(shot_id: str, timestamps: list[float]):
    return {
        "shot_id": shot_id,
        "start_time": timestamps[0] - 1 if timestamps else 0,
        "end_time": timestamps[-1] + 1 if timestamps else 1,
        "keyframes": [
            {"timestamp": timestamp, "description": f"{shot_id} at {timestamp}"}
            for timestamp in timestamps
        ],
    }


def test_keyframe_budget_covers_each_shot_before_adding_extra_frames():
    scene = {"scene_id": "scene_001"}
    rows = [
        (scene, _shot("shot_01", [1, 2, 3])),
        (scene, _shot("shot_02", [11, 12, 13])),
        (scene, _shot("shot_03", [21, 22, 23])),
    ]

    selected = IngestionService._select_video_keyframes_for_processing(rows, max_keyframes=5)

    assert [(row_index, frame_index) for row_index, _scene, _shot_data, frame_index, _frame in selected] == [
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
    ]


def test_keyframe_budget_samples_across_timeline_when_there_are_more_shots_than_budget():
    scene = {"scene_id": "scene_001"}
    rows = [(scene, _shot(f"shot_{index:02d}", [index * 10 + 1])) for index in range(5)]

    selected = IngestionService._select_video_keyframes_for_processing(rows, max_keyframes=3)

    assert [row_index for row_index, _scene, _shot_data, _frame_index, _frame in selected] == [0, 2, 4]


class _FakeClipProcessor:
    def __call__(self, *, images, return_tensors=None):
        assert return_tensors == "pt"
        return {"pixel_values": torch.ones((len(images), 3, 2, 2))}


class _FakeClipModel:
    def get_image_features(self, *, pixel_values):
        return torch.ones((pixel_values.shape[0], 768))


def _jpeg_bytes(color: tuple[int, int, int]) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), color=color).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_video_clip_batches_keep_event_loop_friendly_vector_count():
    service = IngestionService.__new__(IngestionService)
    service._clip_model = _FakeClipModel()
    service._clip_processor = _FakeClipProcessor()
    service._processing_status = {
        "task-1": {"processing_id": "task-1", "status": "processing"},
    }
    service._processing_status_redis_client = None
    service._load_clip_model = lambda: None
    service._persist_processing_status = lambda _status: None

    vectors = asyncio.run(
        service._vectorize_video_keyframe_clip_batches(
            [_jpeg_bytes((255, 0, 0)), _jpeg_bytes((0, 255, 0)), _jpeg_bytes((0, 0, 255))],
            processing_id="task-1",
        )
    )

    assert len(vectors) == 3
    assert all(len(vector) == 768 for vector in vectors)
    assert service._processing_status["task-1"]["stage"] == "vectorizing_keyframes"


class _FakeVideoParsingResult:
    def __init__(self, content: str):
        self.success = True
        self.error = None
        self.data = {"choices": [{"message": {"content": content}}]}


class _FakeVideoParsingManager:
    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    async def chat(self, **_kwargs):
        result = self.results[self.calls]
        self.calls += 1
        return result


def test_video_mllm_retries_once_when_first_json_is_incomplete(monkeypatch):
    valid_json = json.dumps({
        "video_summary": "一段讲解视频。",
        "scenes": [{
            "start_time": 0,
            "end_time": 10,
            "scene_summary": "讲解者展示一个物体。",
            "shots": [{
                "start_time": 0,
                "end_time": 10,
                "caption": "讲解者在桌面展示物体。",
                "asr_status": "no_speech",
                "asr_text": "",
                "keyframes": [{"timestamp": 5, "description": "桌面上的物体。"}],
            }],
        }],
    }, ensure_ascii=False)
    manager = _FakeVideoParsingManager([
        _FakeVideoParsingResult('{"scenes": ['),
        _FakeVideoParsingResult(valid_json),
    ])
    service = IngestionService.__new__(IngestionService)
    service.llm_manager = manager
    monkeypatch.setattr(settings, "video_parsing_retry_attempts", 1)

    with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file:
        parsed = asyncio.run(
            service._parse_video_scene_shot_mllm(
                duration=10,
                processing_id="task-retry-json",
                video_local_path=video_file.name,
                video_fps=1,
            )
        )

    assert manager.calls == 2
    assert parsed is not None
    assert len(parsed["scenes"]) == 1
