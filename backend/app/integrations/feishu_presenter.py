"""
将 generate_response 结果转为飞书侧有序消息（文本分段 + 参考文献 + 配图任务）。
图片字节在 handler 中通过 feishu_media.read_image 填充。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import Settings
from app.core.logger import get_logger
from app.integrations.feishu_md_post import DEFAULT_FEISHU_MD_CHUNK, split_feishu_md_chunks
from app.integrations.feishu_media import looks_like_image_path

logger = get_logger(__name__)


@dataclass
class FeishuOutboundMessage:
    kind: str  # "text" | "image"
    text: Optional[str] = None
    image_bytes: Optional[bytes] = None
    image_name: Optional[str] = None
    kb_id: Optional[str] = None
    file_path: Optional[str] = None


def _format_references(refs: List[Dict[str, Any]], max_items: int = 15) -> str:
    if not refs:
        return ""
    lines: List[str] = ["—— 参考文献 ——"]
    for i, r in enumerate(refs[:max_items], start=1):
        fn = r.get("file_name") or ""
        snippet = (r.get("content") or "").replace("\n", " ").strip()
        if len(snippet) > 120:
            snippet = snippet[:117] + "..."
        lines.append(f"{i}. {fn}: {snippet}")
    if len(refs) > max_items:
        lines.append(f"... 共 {len(refs)} 条，此处仅展示前 {max_items} 条")
    return "\n".join(lines)


def build_outbound_messages(
    *,
    generation_result: Dict[str, Any],
    settings: Settings,
) -> List[FeishuOutboundMessage]:
    out: List[FeishuOutboundMessage] = []
    answer = (generation_result.get("answer") or "").strip()
    refs: List[Dict[str, Any]] = list(generation_result.get("references_used") or [])

    max_chunk = DEFAULT_FEISHU_MD_CHUNK

    audio_note = ""
    video_note = ""
    for r in refs:
        t = (r.get("type") or "").lower()
        if t == "audio" and not audio_note:
            audio_note = "（回答引用中含音频素材，请在 Web 端对话中播放。）"
        if t == "video" and not video_note:
            video_note = "（回答引用中含视频素材，请在 Web 端对话中查看。）"
    if audio_note:
        answer = f"{answer}\n\n{audio_note}".strip()
    if video_note:
        answer = f"{answer}\n\n{video_note}".strip()

    web_base = (getattr(settings, "feishu_web_base_url", None) or "").strip()
    if web_base:
        answer = f"{answer}\n\n完整排版与多媒体: {web_base.rstrip('/')}/".strip()

    for part in split_feishu_md_chunks(answer, max_chunk):
        out.append(FeishuOutboundMessage(kind="text", text=part))

    ref_block = _format_references(refs)
    if ref_block:
        for part in split_feishu_md_chunks(ref_block, max_chunk):
            out.append(FeishuOutboundMessage(kind="text", text=part))

    if not getattr(settings, "feishu_image_send_enabled", True):
        return out

    max_img = max(0, min(int(getattr(settings, "feishu_max_reply_images", 4)), 10))
    if max_img == 0:
        return out

    seen: set = set()
    for r in refs:
        if len([m for m in out if m.kind == "image"]) >= max_img:
            break
        if (r.get("type") or "").lower() != "image":
            continue
        fp = r.get("file_path")
        if not fp or not looks_like_image_path(str(fp)):
            continue
        md = r.get("metadata") or {}
        kb_id = md.get("kb_id") or ""
        if not kb_id:
            continue
        key = (kb_id, str(fp))
        if key in seen:
            continue
        seen.add(key)
        name = Path(str(fp).split("?", 1)[0]).name or "image.png"
        out.append(
            FeishuOutboundMessage(
                kind="image",
                kb_id=kb_id,
                file_path=str(fp),
                image_name=name,
            )
        )

    return out
