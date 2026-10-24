"""Video failures retain cause and stop rejected input without service/model calls."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.core.llm.model_health import ProviderAPIError
from app.modules.ingestion.service import IngestionService
from app.modules.ingestion.video_errors import VIDEO_ERROR_FIELDS, VideoParsingError
from test_upload_queue import FakeRedis, _queue_service
from test_video_segment_pipeline import _service_fixture


def _failure(category="content_policy", **overrides):
    fields = dict(success=False, data=None, error="provider request failed", error_category=category,
                  provider_code="DataInspectionFailed", request_id="provider-request-123",
                  model_used="aliyun_bailian:qwen-test", retryable=False)
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _success(raw=None):
    if raw is None:
        raw = json.dumps({"scenes": [{"start_time": 0, "end_time": 120,
            "scene_summary": "An animal documentary", "shots": [{"start_time": 0, "end_time": 120,
            "caption": "Animal in water", "asr_status": "no_speech"}]}]})
    return SimpleNamespace(success=True, data={"choices": [{"message": {"content": raw}}]},
                           error=None, model_used="aliyun_bailian:qwen-test", request_id="success-request")


def _parser_service(tmp_path, results):
    service = IngestionService.__new__(IngestionService)
    service.llm_manager = SimpleNamespace(chat=AsyncMock(side_effect=results))
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    return service, source


def test_content_policy_is_raised_once_without_format_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "video_parsing_retry_attempts", 3)
    service, source = _parser_service(tmp_path, [_failure()])
    with pytest.raises(VideoParsingError) as failure:
        asyncio.run(service._parse_video_scene_shot_mllm(120, "task", video_local_path=str(source)))
    error = failure.value
    assert error.error_code == "content_policy" and error.retryable is False
    assert error.provider_code == "DataInspectionFailed"
    assert error.provider_request_id == "provider-request-123"
    assert error.model_used == "aliyun_bailian:qwen-test"
    assert "服务商" in error.recovery_hint
    assert service.llm_manager.chat.await_count == 1
    assert source.exists()  # The caller, not the parser, owns the original source.


def test_provider_policy_exception_also_stops_without_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "video_parsing_retry_attempts", 3)
    provider_error = ProviderAPIError("provider content check rejected input", status_code=400, code="DataInspectionFailed")
    service, source = _parser_service(tmp_path, [provider_error])
    with pytest.raises(VideoParsingError) as error:
        asyncio.run(service._parse_video_scene_shot_mllm(120, "task", video_local_path=str(source)))
    assert error.value.error_code == "content_policy"
    assert error.value.provider_code == "DataInspectionFailed"
    assert error.value.retryable is False
    assert service.llm_manager.chat.await_count == 1


@pytest.mark.parametrize("first,format_retry", [
    (_failure("network_error", provider_code=None, retryable=True), False),
    (TimeoutError("transport timed out"), False),
    (_success('{"scenes": ['), True),
])
def test_retry_prompt_distinguishes_transport_failure_from_bad_json(tmp_path, monkeypatch, first, format_retry):
    monkeypatch.setattr(settings, "video_parsing_retry_attempts", 1)
    service, source = _parser_service(tmp_path, [first, _success()])
    result = asyncio.run(service._parse_video_scene_shot_mllm(120, "task", video_local_path=str(source)))
    assert result["scenes"]
    calls = service.llm_manager.chat.call_args_list
    original = calls[0].kwargs["messages"][0]["content"][1]["text"]
    retried = calls[1].kwargs["messages"][0]["content"][1]["text"]
    assert ("格式恢复重试" in retried) is format_retry
    if not format_retry:
        assert retried == original


def test_exhausted_model_failure_preserves_structured_cause(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "video_parsing_retry_attempts", 1)
    failure = _failure("network_error", provider_code="UpstreamTimeout", retryable=True)
    service, source = _parser_service(tmp_path, [failure, failure])
    with pytest.raises(VideoParsingError) as error:
        asyncio.run(service._parse_video_scene_shot_mllm(120, "task", video_local_path=str(source)))
    assert service.llm_manager.chat.await_count == 2
    assert error.value.error_code == "video_model_error"
    assert error.value.provider_code == "UpstreamTimeout"
    assert error.value.provider_request_id == "provider-request-123"
    assert "network_error" in str(error.value)


def test_rejection_stops_later_segments_and_cleans_prefetch_before_any_index_write(monkeypatch, tmp_path):
    service, kwargs, _updates, sources, extracted = _service_fixture(monkeypatch, tmp_path)
    kwargs["parse_result"]["duration"] = 626.391
    service.llm_manager = SimpleNamespace(chat=AsyncMock(side_effect=[_success(), _success(), _success(), _failure()]))
    with pytest.raises(VideoParsingError, match="315–435 秒") as error:
        asyncio.run(service._process_video_scene_shot(**kwargs))
    assert error.value.failed_segment_start == 315 and error.value.failed_segment_end == 435
    assert error.value.error_code == "content_policy"
    assert service.llm_manager.chat.await_count == 4
    assert all(start <= 420 for start, _duration, _path in extracted)  # Only one prefetch was allowed.
    assert all(not source.exists() for source in sources)
    assert not list(tmp_path.glob("segment-*"))
    service._build_video_scene_shot_points.assert_not_awaited()
    service.minio_adapter.upload_file.assert_not_awaited()
    service.vector_store.delete_video_points_by_file_id.assert_not_called()
    service.vector_store.upsert_video_shot_vectors.assert_not_awaited()


def test_short_video_rejection_has_full_source_range(monkeypatch, tmp_path):
    service, kwargs, _updates, _sources, _extracted = _service_fixture(monkeypatch, tmp_path)
    kwargs["parse_result"]["duration"] = 20.25
    service.llm_manager = SimpleNamespace(chat=AsyncMock(return_value=_failure()))
    with pytest.raises(VideoParsingError) as error:
        asyncio.run(service._process_video_scene_shot(**kwargs))
    assert (error.value.failed_segment_start, error.value.failed_segment_end) == (0, 20.25)
    source = service.llm_manager.chat.call_args.kwargs["messages"][0]["content"][0]["path"]
    assert not Path(source).exists()
    service.minio_adapter.upload_file.assert_not_awaited()


def _persisted_failure(service, **overrides):
    status = {"processing_id": "task", "status": "failed", "stage": "error", "file_type": "video",
              "file_id": "original", "bucket": "kb", "object_path": "videos/original_video.mp4",
              "kb_id": "kb", "source_kb_id": "kb", "storage_persisted": True,
              **VideoParsingError.from_model_failure(_failure()).at_segment(315, 435).status_fields(),
              **overrides}
    service._processing_status["task"] = status
    service._persist_processing_status(status)
    return status


def test_initial_upload_failure_keeps_original_and_persists_recovery_fields():
    service = _queue_service(FakeRedis())
    service._get_actual_kb_id_for_upload = AsyncMock(return_value="kb")
    service.parser_factory = SimpleNamespace(parse_file=AsyncMock(return_value={"file_type": "video", "duration": 120}))
    service.minio_adapter = SimpleNamespace(upload_file=AsyncMock(return_value={
        "file_id": "original", "bucket": "kb", "object_path": "videos/original.mp4", "size": 5,
    }))
    failure = VideoParsingError.from_model_failure(_failure()).at_segment(0, 120)
    service._process_video = AsyncMock(side_effect=failure)
    with pytest.raises(VideoParsingError):
        asyncio.run(service.process_file_upload(b"video", "video.mp4", "kb", processing_id="task"))
    status = service._load_persisted_processing_status("task")
    assert status["status"] == "failed" and status["storage_persisted"] is True
    assert status["file_id"] == "original"
    assert all(status[field] == getattr(failure, field) for field in VIDEO_ERROR_FIELDS)
    assert service.minio_adapter.upload_file.await_count == 1  # Original only, no manifest/frames.


@pytest.mark.parametrize("status", ["completed", "queued", "processing", "cancelled"])
def test_explicit_retry_rejects_every_nonfailed_state(status):
    service = _queue_service(FakeRedis())
    _persisted_failure(service, status=status)
    with pytest.raises(ValueError, match="已失败"):
        service.retry_video_processing("task")
    assert service._load_persisted_processing_status("task")["status"] == status


def test_explicit_retry_is_allowed_after_policy_failure_and_clears_stale_error_fields():
    async def run():
        service = _queue_service(FakeRedis())
        _persisted_failure(service)
        failure = VideoParsingError.from_model_failure(_failure(request_id="new-request")).at_segment(315, 435)
        service._reprocess_persisted_video = AsyncMock(side_effect=failure)
        response = service.retry_video_processing("task")
        assert response["status"] == "queued" and response["file_id"] == "original"
        queued = service._load_persisted_processing_status("task")
        assert all(queued[field] is None for field in VIDEO_ERROR_FIELDS)
        assert queued["storage_persisted"] is True
        task = service._background_upload_tasks["task"]
        with pytest.raises(VideoParsingError):
            await task
        status = service._load_persisted_processing_status("task")
        assert status["status"] == "failed" and status["retry_count"] == 1
        assert status["provider_request_id"] == "new-request"
        assert status["failed_segment_start"] == 315 and status["retryable"] is False
        assert status["storage_persisted"] is True
    asyncio.run(run())
