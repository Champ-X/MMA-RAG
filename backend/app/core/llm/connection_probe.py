"""Bounded synthetic capability probes, isolated from saved routing and health.

Never use LLMManager here: its retries, fallback routing and health mutations
are business behavior, not evidence about the user's exact draft selection.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import math
from pathlib import Path
import struct
import sys
import time
import wave
import zlib

import httpx

from app.core.llm.model_health import ProviderAPIError

PROBE_TIMEOUT_SECONDS = 50.0
PROBE_CONCURRENCY = 2
_active_probes = 0
VIDEO_FIXTURE = Path(__file__).with_name("probe_media") / "connection.mp4"

ERROR_MESSAGES = {
    "busy": "已有连接测试正在运行，请稍后重试。",
    "missing_key": "尚未配置该服务商的 API 密钥。",
    "unsupported": "当前服务商适配器不支持该能力的连接测试。",
    "timeout": "连接测试超时，请稍后重试。",
    "authentication": "服务商拒绝了 API 密钥，请检查服务端配置。",
    "access_denied": "当前账号或地区没有该模型的访问权限。",
    "billing": "服务商余额或计费状态不允许调用该模型。",
    "not_found": "服务商未找到所选模型或能力接口。",
    "rate_limited": "服务商限流，请稍后重试。",
    "provider_error": "服务商暂时不可用，请稍后重试。",
    "request_rejected": "服务商拒绝了该能力的测试请求，请检查模型支持范围。",
    "transport": "无法连接服务商，请检查网络连接。",
    "invalid_response": "服务商返回的内容未通过该能力的格式校验。",
    "probe_unavailable": "测试素材或隔离运行环境暂不可用。",
}


class ProbeFailure(Exception):
    def __init__(self, code: str):
        self.code = code if code in ERROR_MESSAGES else "invalid_response"
        super().__init__(self.code)


def safe_error_code(exc: Exception) -> str:
    """No response body, URL, key or arbitrary exception string crosses the API."""
    if isinstance(exc, ProbeFailure):
        return exc.code
    if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
        return "timeout"
    if isinstance(exc, NotImplementedError):
        return "unsupported"
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is None and isinstance(exc, ProviderAPIError):
        status = exc.status_code
    if isinstance(status, int):
        if status in {401, 402, 403, 404, 429}:
            return {401: "authentication", 402: "billing", 403: "access_denied", 404: "not_found", 429: "rate_limited"}[status]
        if status >= 500:
            return "provider_error"
        if status >= 400:
            return "request_rejected"
    if isinstance(exc, (httpx.TransportError, ConnectionError)):
        return "transport"
    return "invalid_response"


def synthetic_image() -> str:
    """A 128px red PNG using only the standard library."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 128, 128, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress((b"\x00" + bytes((220, 20, 20)) * 128) * 128)) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def synthetic_audio() -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"".join(struct.pack("<h", int(2000 * math.sin(2 * math.pi * 440 * t / 16000))) for t in range(16000)))
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def probe_messages(capability: str) -> list[dict]:
    if capability == "chat":
        return [{"role": "user", "content": "Reply briefly with OK."}]
    if capability == "vision":
        prompt, media = "Name the main color in this image briefly.", {"type": "image_url", "image_url": {"url": synthetic_image()}}
    elif capability == "audio":
        prompt, media = "Describe this sound briefly. Do not invent speech.", {"type": "input_audio", "input_audio": {"data": synthetic_audio(), "format": "wav"}}
    elif capability == "video":
        prompt = "Describe how the color changes in this short video briefly."
        media = {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + base64.b64encode(VIDEO_FIXTURE.read_bytes()).decode("ascii")}, "fps": 1}
    else:
        raise ProbeFailure("unsupported")
    return [{"role": "user", "content": [{"type": "text", "text": prompt}, media]}]


def create_probe_provider(source, provider: str):
    """Fresh transport instances share credentials, never runtime clients/state."""
    key = getattr(source, "api_key", "") or ""
    if not key.strip():
        raise ProbeFailure("missing_key")
    if provider == "siliconflow":
        from app.core.llm.providers.silicon_flow import SiliconFlowProvider
        result = SiliconFlowProvider(key, embedding_trust_env=getattr(source, "_embedding_trust_env", True))
        result.base_url = source.base_url
        return result
    from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
    from app.core.llm.providers.deepseek import DeepSeekProvider
    from app.core.llm.providers.openrouter import OpenRouterProvider
    constructor = {"deepseek": DeepSeekProvider, "openrouter": OpenRouterProvider, "aliyun_bailian": AliyunBailianProvider}.get(provider)
    if constructor is None:
        raise ProbeFailure("unsupported")
    return constructor(key, base_url=source.base_url)


async def isolated_bailian_video(provider, raw_model: str) -> dict:
    """Kill the complete SDK process on cancellation, including upload threads.

    DashScope's local-file upload and streaming SDK cannot be cancelled safely
    inside the API event loop. Credentials travel over stdin, never argv/files.
    """
    if not VIDEO_FIXTURE.is_file():
        raise ProbeFailure("probe_unavailable")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "app.core.llm.connection_probe_video",
        cwd=str(Path(__file__).resolve().parents[3]),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        request = json.dumps({"api_key": provider.api_key, "base_url": provider.base_url, "model": raw_model}).encode()
        stdout, _ = await process.communicate(request)
        if process.returncode != 0 or len(stdout) > 131072:
            raise ProbeFailure("probe_unavailable")
        payload = json.loads(stdout)
        if not payload.get("success"):
            raise ProbeFailure(payload.get("error_code", "invalid_response"))
        return payload["data"]
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


def _finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_result(data, capability: str, *, provider: str, raw_model: str) -> str:
    if capability == "embedding":
        if (not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], list)
                or not 1 <= len(data[0]) <= 65536 or not all(_finite(value) for value in data[0])):
            raise ProbeFailure("invalid_response")
        return f"收到 1 个有效向量，维度为 {len(data[0])}。"
    if capability == "reranker":
        if not isinstance(data, list) or len(data) != 2:
            raise ProbeFailure("invalid_response")
        indices = []
        for row in data:
            if not isinstance(row, dict) or type(row.get("index")) is not int or not _finite(row.get("relevance_score", row.get("score"))):
                raise ProbeFailure("invalid_response")
            indices.append(row["index"])
        if sorted(indices) != [0, 1]:
            raise ProbeFailure("invalid_response")
        return "收到 2 条重排结果，索引和相关性分数有效。"
    if not isinstance(data, dict) or data.get("error"):
        raise ProbeFailure("invalid_response")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ProbeFailure("invalid_response")
    message = choices[0].get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str))
    if not isinstance(content, str) or not content.strip():
        raise ProbeFailure("invalid_response")
    noun = {"chat": "文本", "vision": "合成图片", "audio": "合成音频", "video": "合成视频"}[capability]
    detail = f"{noun}请求已返回非空文本；仅验证连通与输出格式。"
    if provider == "openrouter" and isinstance(data.get("model"), str) and data["model"] != raw_model:
        # Providers may resolve a public alias to a dated version. The request
        # remains pinned to exactly one model and explicitly disables fallback.
        # Do not echo the arbitrary upstream field into the diagnostic UI.
        detail += "服务端返回了不同的模型标识，可能为版本别名。"
    return detail


async def _perform(source, provider: str, raw_model: str, capability: str) -> str:
    probe = create_probe_provider(source, provider)
    try:
        if capability == "embedding":
            data = await probe.embed_texts(texts=["model connectivity check"], model=raw_model)
        elif capability == "reranker":
            options = {"strict_response": True} if provider == "aliyun_bailian" else {}
            data = await probe.rerank(query="apple", documents=["apple fruit", "blue sky"], model=raw_model, **options)
        elif capability == "video" and provider == "aliyun_bailian":
            data = await isolated_bailian_video(probe, raw_model)
        else:
            options = {"max_tokens": 256, "timeout": PROBE_TIMEOUT_SECONDS, "temperature": 0.1}
            if provider == "openrouter":
                options["provider"] = {"allow_fallbacks": False}
            data = await probe.chat_completion(messages=probe_messages(capability), model=raw_model, **options)
        return validate_result(data, capability, provider=provider, raw_model=raw_model)
    finally:
        # SiliconFlow's private embedding pool belongs only to this probe.
        if provider == "siliconflow":
            await probe.close()


async def run_probe(source, *, provider: str, model: str, raw_model: str, capability: str) -> dict:
    global _active_probes
    result = {"success": False, "provider": provider, "model": model, "capability": capability, "duration_ms": 0}
    # There is no await between check and increment; calls run on the API loop.
    if _active_probes >= PROBE_CONCURRENCY:
        return {**result, "error_code": "busy", "message": ERROR_MESSAGES["busy"]}
    _active_probes += 1
    started = time.perf_counter()
    try:
        detail = await asyncio.wait_for(_perform(source, provider, raw_model, capability), PROBE_TIMEOUT_SECONDS)
        return {**result, "success": True, "duration_ms": round((time.perf_counter() - started) * 1000), "message": "连接成功", "details": detail}
    except Exception as exc:
        code = safe_error_code(exc)
        return {**result, "duration_ms": round((time.perf_counter() - started) * 1000), "error_code": code, "message": ERROR_MESSAGES[code]}
    finally:
        _active_probes -= 1
