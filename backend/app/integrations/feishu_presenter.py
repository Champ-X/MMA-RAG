"""
将 generate_response 结果转为飞书侧有序消息（文本分段 + 参考文献 + 配图任务）。
图片字节在 handler 中通过 feishu_media.read_image 填充。

支持单条 post 内交替 md 与 img（飞书要求图片独占段落），避免图文拆成多条气泡。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from app.core.config import Settings
from app.core.logger import get_logger
from app.integrations.feishu_md_post import DEFAULT_FEISHU_MD_CHUNK, split_feishu_md_chunks
from app.integrations.feishu_media import looks_like_image_path

logger = get_logger(__name__)

# 单条 post 的 content JSON 过大时回退为「多条消息」旧逻辑
_MAX_POST_JSON_BYTES = 48000

_IMG_MD = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")

# 段落元组：("md", str) | ("img", kb_id, file_path, image_name)
PostSegment = Tuple[Union[str, Any], ...]


@dataclass
class FeishuOutboundMessage:
    kind: str  # "text" | "image" | "post_mixed"
    text: Optional[str] = None
    image_bytes: Optional[bytes] = None
    image_name: Optional[str] = None
    kb_id: Optional[str] = None
    file_path: Optional[str] = None
    post_segments: Optional[List[PostSegment]] = field(default=None)


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


def _match_image_ref(url: str, refs: List[Dict[str, Any]]) -> Optional[Tuple[str, str, str]]:
    u = url.split("?", 1)[0].strip().replace("\\", "/")
    base = Path(u).name
    for r in refs:
        if (r.get("type") or "").lower() != "image":
            continue
        fp = r.get("file_path")
        if not fp or not looks_like_image_path(str(fp)):
            continue
        md = r.get("metadata") or {}
        kb_id = md.get("kb_id") or ""
        if not kb_id:
            continue
        p = str(fp).split("?", 1)[0].replace("\\", "/")
        if p == u or p.endswith("/" + u) or p.endswith(u) or Path(p).name == base:
            name = Path(p).name or "image.png"
            return kb_id, str(fp), name
    return None


def _split_answer_inline_images(
    answer: str,
    refs: List[Dict[str, Any]],
    max_img: int,
) -> Tuple[List[PostSegment], Set[Tuple[str, str]], int]:
    """
    按 ![alt](url) 切分正文；本地路径若命中引用则产出 img 段，否则文案占位。
    返回 (segments, inlined_kb_fp_keys, img_segment_count)。
    """
    inlined: Set[Tuple[str, str]] = set()
    out: List[PostSegment] = []
    pos = 0
    img_segments = 0

    for m in _IMG_MD.finditer(answer):
        before = answer[pos : m.start()]
        if before:
            out.append(("md", before))
        alt, url = m.group(1) or "", (m.group(2) or "").strip()
        if url.startswith(("http://", "https://")):
            link = f"[{alt}]({url})"
            if out and out[-1][0] == "md":
                out[-1] = ("md", str(out[-1][1]) + link)
            else:
                out.append(("md", link))
        elif img_segments >= max_img:
            repl = f"（图：{alt or '配图'}）"
            if out and out[-1][0] == "md":
                out[-1] = ("md", str(out[-1][1]) + repl)
            else:
                out.append(("md", repl))
        else:
            hit = _match_image_ref(url, refs)
            if hit:
                kb_id, fp, name = hit
                out.append(("img", kb_id, fp, name))
                inlined.add((kb_id, str(fp)))
                img_segments += 1
            else:
                repl = f"（图：{alt or '配图'}）"
                if out and out[-1][0] == "md":
                    out[-1] = ("md", str(out[-1][1]) + repl)
                else:
                    out.append(("md", repl))
        pos = m.end()

    tail = answer[pos:]
    if tail:
        out.append(("md", tail))
    return out, inlined, img_segments


def _coalesce_md_segments(segments: List[PostSegment]) -> List[PostSegment]:
    out: List[PostSegment] = []
    buf: List[str] = []
    for seg in segments:
        if seg[0] == "md":
            t = str(seg[1]).strip() if len(seg) > 1 else ""
            if t:
                buf.append(str(seg[1]))
        else:
            if buf:
                out.append(("md", "\n\n".join(buf)))
                buf = []
            out.append(seg)
    if buf:
        out.append(("md", "\n\n".join(buf)))
    return out


def _estimate_post_json_bytes(segments: List[PostSegment]) -> int:
    """用占位 image_key 估算序列化后体积，避免超过飞书单条上限。"""
    rows: List[List[dict[str, Any]]] = []
    for seg in segments:
        if seg[0] == "md" and len(seg) > 1:
            rows.append([{"tag": "md", "text": str(seg[1])}])
        elif seg[0] == "img":
            rows.append([{"tag": "img", "image_key": "img_" + "x" * 48}])
    payload = {"zh_cn": {"title": "", "content": rows}}
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def _build_legacy_outbound_messages(
    *,
    answer: str,
    refs: List[Dict[str, Any]],
    settings: Settings,
    max_chunk: int,
) -> List[FeishuOutboundMessage]:
    out: List[FeishuOutboundMessage] = []

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


def build_outbound_messages(
    *,
    generation_result: Dict[str, Any],
    settings: Settings,
) -> List[FeishuOutboundMessage]:
    answer_core = (generation_result.get("answer") or "").strip()
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

    web_base = (getattr(settings, "feishu_web_base_url", None) or "").strip()

    inline_enabled = (
        bool(getattr(settings, "feishu_inline_images_in_post", True))
        and bool(getattr(settings, "feishu_reply_post_md", True))
        and bool(getattr(settings, "feishu_image_send_enabled", True))
    )
    max_img = max(0, min(int(getattr(settings, "feishu_max_reply_images", 4)), 10))

    if inline_enabled and max_img > 0:
        segs, inlined, img_used = _split_answer_inline_images(answer_core, refs, max_img)
        for note in filter(None, [audio_note, video_note]):
            segs.append(("md", note))
        if web_base:
            segs.append(("md", f"完整排版与多媒体: {web_base.rstrip('/')}/"))

        ref_block = _format_references(refs)
        if ref_block:
            for part in split_feishu_md_chunks(ref_block, max_chunk):
                segs.append(("md", part))

        seen_trailing: set = set()
        for r in refs:
            if img_used >= max_img:
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
            if key in inlined or key in seen_trailing:
                continue
            seen_trailing.add(key)
            name = Path(str(fp).split("?", 1)[0]).name or "image.png"
            segs.append(("img", kb_id, str(fp), name))
            img_used += 1

        segs = _coalesce_md_segments(segs)
        segs = [s for s in segs if not (s[0] == "md" and not str(s[1]).strip())]

        est = _estimate_post_json_bytes(segs) if segs else 0
        if segs and est <= _MAX_POST_JSON_BYTES:
            return [FeishuOutboundMessage(kind="post_mixed", post_segments=segs)]

        if segs:
            logger.info(f"飞书 post 混排体积超限，回退为多消息发送 (estimate={est} bytes)")

    # 旧逻辑：正文带音视频提示与 web 链接后再切分
    answer = answer_core
    if audio_note:
        answer = f"{answer}\n\n{audio_note}".strip()
    if video_note:
        answer = f"{answer}\n\n{video_note}".strip()
    if web_base:
        answer = f"{answer}\n\n完整排版与多媒体: {web_base.rstrip('/')}/".strip()

    return _build_legacy_outbound_messages(
        answer=answer, refs=refs, settings=settings, max_chunk=max_chunk
    )
