"""
对话轮次内图片/音频附件的多模态摘要（不入库、不向量化）。
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine
from app.core.logger import get_logger

logger = get_logger(__name__)

# 与设计方案对齐：数量与大小可后续挪到 settings
MAX_ATTACHMENTS = 3
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_SUMMARY_CHARS = 300
MAX_TOTAL_CONTEXT_CHARS = 900

ALLOWED_IMAGE_CT = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    }
)
ALLOWED_AUDIO_CT = frozenset(
    {
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/flac",
        "audio/x-flac",
        "audio/ogg",
        "audio/webm",
        "audio/mp4",
        "audio/x-m4a",
        "audio/m4a",
    }
)


def sniff_media_bytes_kind(data: bytes) -> Optional[str]:
    """供飞书等非上传入口复用：返回 image | audio | None。"""
    return _sniff_kind(data)


def _sniff_kind(data: bytes) -> Optional[str]:
    """返回 image | audio | None"""
    if len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image"
    if data[:4] == b"fLaC":
        return "audio"
    if data[:4] == b"OggS":
        return "audio"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio"
    if data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "audio"
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "audio"
    return None


def _guess_image_mime(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "png"


def _normalize_declared_ct(declared: str) -> str:
    return (declared or "").split(";", 1)[0].strip().lower()


def _truncate(text: str, max_chars: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1] + "…"


def _extract_chat_content(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    return (msg.get("content") or "").strip()


@dataclass
class AttachmentSummaryItem:
    index: int
    modality: str
    filename: str
    summary: str


class ChatAttachmentSummarizer:
    """对单轮对话中的图片/音频生成短摘要（不写 MinIO/Qdrant）。"""

    async def summarize_image(self, image_bytes: bytes, filename: str, user_message: str) -> str:
        raw_b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime = _guess_image_mime(image_bytes)
        data_url = f"data:image/{mime};base64,{raw_b64}"
        prompt_text = prompt_engine.render_template(
            "chat_attachment_image_summary",
            user_message=(user_message or "").strip() or "（用户未输入文字，仅上传图片）",
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    {"type": "text", "text": prompt_text},
                ],
            }
        ]
        result = await llm_manager.chat(
            messages=messages,
            task_type="image_captioning",
            model=None,
            fallback=True,
            temperature=0.2,
        )
        if not result.success:
            logger.warning("chat attachment image summary failed: {}", result.error)
            return f"（摘要失败：{result.error or 'VLM 调用失败'}）"
        text = _extract_chat_content(result.data)
        return _truncate(text, MAX_SUMMARY_CHARS) if text else "（摘要为空）"

    async def summarize_audio(self, audio_bytes: bytes, filename: str, user_message: str) -> str:
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        lower = (filename or "").lower()
        if lower.endswith(".wav"):
            fmt = "wav"
        elif lower.endswith(".flac"):
            fmt = "flac"
        elif lower.endswith(".ogg"):
            fmt = "ogg"
        elif lower.endswith(".webm"):
            fmt = "webm"
        elif lower.endswith(".m4a") or lower.endswith(".mp4"):
            fmt = "mp4"
        else:
            fmt = "mp3"

        prompt_text = prompt_engine.render_template(
            "chat_attachment_audio_summary",
            user_message=(user_message or "").strip() or "（用户未输入文字，仅上传音频）",
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "input_audio", "input_audio": {"data": audio_base64, "format": fmt}},
                ],
            }
        ]
        result = await llm_manager.chat(
            messages=messages,
            task_type="audio_transcription",
            model=None,
            fallback=True,
            temperature=0.2,
        )
        if not result.success:
            logger.warning("chat attachment audio summary failed: {}", result.error)
            return f"（摘要失败：{result.error or '音频模型调用失败'}）"
        text = _extract_chat_content(result.data)
        if not text:
            return "（摘要为空）"
        # 若模型仍返回 JSON 转写结构，优先取 description 或压缩 transcript
        parsed = _try_parse_summary_json(text)
        if parsed:
            text = parsed
        return _truncate(re.sub(r"\s+", " ", text), MAX_SUMMARY_CHARS)


def Pathish(filename: str) -> str:
    return filename


def _try_parse_summary_json(content: str) -> Optional[str]:
    """从音频模型返回的 JSON 中提取可当作摘要的短文本。"""
    raw = content.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
    if m:
        raw = m.group(1).strip()
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            desc = obj.get("description")
            if isinstance(desc, str) and desc.strip():
                return desc.strip()
            tr = obj.get("summary")
            if isinstance(tr, str) and tr.strip():
                return tr.strip()
            tr = obj.get("transcript")
            if isinstance(tr, str) and tr.strip():
                return _truncate(tr.strip(), MAX_SUMMARY_CHARS)
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _classify_attachment(filename: str, content_type: str, data: bytes) -> str:
    if not data:
        raise ValueError(f"文件为空：{filename}")
    ct = _normalize_declared_ct(content_type)
    kind = _sniff_kind(data)
    if kind is None:
        raise ValueError(f"无法识别为图片或音频（仅支持常见图片与音频格式）：{filename}")
    if ct and ct != "application/octet-stream":
        if kind == "image" and ct not in ALLOWED_IMAGE_CT:
            raise ValueError(f"文件内容与声明类型不一致或非允许的图片类型：{filename}")
        if kind == "audio" and ct not in ALLOWED_AUDIO_CT:
            raise ValueError(f"文件内容与声明类型不一致或非允许的音频类型：{filename}")
    if kind == "image" and len(data) > MAX_IMAGE_BYTES:
        raise ValueError(f"图片超过 {MAX_IMAGE_BYTES // 1024 // 1024}MB：{filename}")
    if kind == "audio" and len(data) > MAX_AUDIO_BYTES:
        raise ValueError(f"音频超过 {MAX_AUDIO_BYTES // 1024 // 1024}MB：{filename}")
    return kind


async def summarize_chat_attachments(
    *,
    user_message: str,
    files: List[Tuple[str, str, bytes]],
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    files: (filename, content_type, raw_bytes)
    返回 (attachment_context_block, items 用于日志/调试)
    """
    if not files:
        return "", []

    if len(files) > MAX_ATTACHMENTS:
        raise ValueError(f"附件最多 {MAX_ATTACHMENTS} 个")

    indexed: List[Tuple[int, str, str, bytes]] = []
    for i, (filename, content_type, data) in enumerate(files, start=1):
        kind = _classify_attachment(filename or f"file{i}", content_type, data)
        indexed.append((i, filename or f"file{i}", kind, data))

    summarizer = ChatAttachmentSummarizer()

    async def _one(tup: Tuple[int, str, str, bytes]) -> AttachmentSummaryItem:
        idx, fname, kind, raw = tup
        if kind == "image":
            summary = await summarizer.summarize_image(raw, fname, user_message)
        else:
            summary = await summarizer.summarize_audio(raw, fname, user_message)
        return AttachmentSummaryItem(idx, kind, fname, summary)

    items = list(await asyncio.gather(*[_one(t) for t in indexed]))
    items.sort(key=lambda x: x.index)

    lines: List[str] = []
    for it in items:
        label = "图片" if it.modality == "image" else "音频"
        lines.append(f"[附件{it.index} {label} {it.filename}] {it.summary}")

    block = "\n".join(lines)
    if len(block) > MAX_TOTAL_CONTEXT_CHARS:
        block = block[: MAX_TOTAL_CONTEXT_CHARS - 1] + "…"

    serializable = [
        {"index": it.index, "modality": it.modality, "filename": it.filename, "summary": it.summary}
        for it in items
    ]
    return block, serializable
