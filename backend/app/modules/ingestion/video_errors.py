"""Stable video failure details for persistence and recovery without raw model output."""

from typing import Any, Optional


VIDEO_ERROR_FIELDS = (
    "error_code", "retryable", "provider_code", "provider_request_id", "model_used",
    "recovery_hint", "failed_segment_start", "failed_segment_end",
)


class VideoParsingError(RuntimeError):
    def __init__(
        self, message: str, *, error_code: str, retryable: Optional[bool] = True,
        provider_code: Optional[str] = None, provider_request_id: Optional[str] = None,
        model_used: Optional[str] = None, recovery_hint: Optional[str] = None,
        failed_segment_start: Optional[float] = None, failed_segment_end: Optional[float] = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.retryable = retryable
        self.provider_code = provider_code
        self.provider_request_id = provider_request_id
        self.model_used = model_used
        self.recovery_hint = recovery_hint or "原视频已保留，可在服务恢复后手动重新解析，无需重新上传。"
        self.failed_segment_start = failed_segment_start
        self.failed_segment_end = failed_segment_end

    def status_fields(self) -> dict[str, Any]:
        return {field: getattr(self, field) for field in VIDEO_ERROR_FIELDS}

    def at_segment(self, start: float, end: float) -> "VideoParsingError":
        fields = self.status_fields()
        fields.update(failed_segment_start=start, failed_segment_end=end)
        return VideoParsingError(f"视频片段 {start:g}–{end:g} 秒：{self}", **fields)

    @classmethod
    def from_model_failure(cls, result: Any) -> "VideoParsingError":
        category = getattr(result, "error_category", None)
        # LLMCallResult uses provider_code; a provider exception escaping the
        # manager retains the SDK-style code attribute instead.
        provider_code = getattr(result, "provider_code", None) or getattr(result, "code", None)
        content_policy = category == "content_policy" or provider_code == "DataInspectionFailed"
        fields = dict(
            provider_code=provider_code,
            provider_request_id=getattr(result, "request_id", None),
            model_used=getattr(result, "model_used", None),
        )
        if content_policy:
            return cls(
                "服务商内容检查拒绝了本段解析；原视频已保留，未写入检索索引。",
                error_code="content_policy", retryable=False,
                recovery_hint="请联系模型服务商核实内容检查结果；解决服务商问题后可手动重新解析原视频。直接重试通常无效。",
                **fields,
            )
        reason = category or (type(result).__name__ if isinstance(result, BaseException) else "upstream_error")
        return cls(
            f"视频模型调用失败（{reason}）；原视频已保留，未写入检索索引。",
            error_code="video_model_error", retryable=getattr(result, "retryable", None),
            **fields,
        )


def video_error_status(error: Exception) -> dict[str, Any]:
    return error.status_fields() if isinstance(error, VideoParsingError) else {}


def cleared_video_error_status() -> dict[str, None]:
    return dict.fromkeys(VIDEO_ERROR_FIELDS)
