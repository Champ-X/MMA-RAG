"""
RAG 回复：飞书卡片 JSON 2.0（多段 markdown / 图片 / OPUS 音频混排；可选 CardKit 流式更新正文）。

- 静态卡：直接 msg_type=interactive 下发整卡 JSON。
- 流式：卡片内 markdown 与图片顺序与静态一致；每段连续正文对应独立 markdown 组件与 element_id，
  依次 PUT 打字机更新（全局 sequence 递增），图片夹在段落之间静态展示；最后 PATCH 关闭 streaming_mode。
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import Settings
from app.core.logger import get_logger
from app.integrations.feishu_cardkit import (
    feishu_cardkit_create_card_sync,
    feishu_cardkit_patch_settings_sync,
    feishu_cardkit_put_element_content_sync,
    feishu_tenant_access_token_sync,
    feishu_upload_im_file_with_duration_sync,
)
from app.integrations.feishu_client import (
    feishu_reply_file,
    feishu_reply_interactive,
    feishu_reply_message,
    feishu_upload_image,
    feishu_upload_im_file,
)
from app.integrations.feishu_md_post import (
    DEFAULT_FEISHU_MD_CHUNK,
    feishu_normalize_markdown_for_post,
    split_feishu_md_chunks,
)
from app.integrations.feishu_media import read_image_bytes
from app.integrations.feishu_presenter import (
    FeishuOutboundMessage,
    PostSegment,
    _format_references,
)

logger = get_logger(__name__)

# 单卡体积建议 <30KB（官方限制）；超出则回退 post
_MAX_CARD_JSON_BYTES = 28000
_IMG_CITATION = re.compile(r"\[(\d+)\]")


def _ffmpeg_bin(settings: Settings) -> Optional[str]:
    p = (getattr(settings, "ffmpeg_path", None) or "").strip()
    if p and Path(p).is_file():
        return p
    return shutil.which("ffmpeg")


def _ffprobe_bin(settings: Settings) -> Optional[str]:
    base = _ffmpeg_bin(settings)
    if base:
        probe = str(Path(base).parent / "ffprobe")
        if Path(probe).is_file():
            return probe
    return shutil.which("ffprobe")


def _probe_duration_ms(audio_bytes: bytes, settings: Settings) -> int:
    ffprobe = _ffprobe_bin(settings)
    if not ffprobe or not audio_bytes:
        return 1000
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".bin") as f:
            f.write(audio_bytes)
            path = f.name
        try:
            out = subprocess.run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    path,
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if out.returncode != 0:
                return 1000
            sec = float((out.stdout or "0").strip() or 0)
            ms = int(sec * 1000)
            return max(1000, ms)
        finally:
            Path(path).unlink(missing_ok=True)
    except Exception:
        return 1000


def _bytes_to_opus(audio_bytes: bytes, src_suffix: str, settings: Settings) -> Optional[bytes]:
    ffmpeg = _ffmpeg_bin(settings)
    if not ffmpeg or not audio_bytes:
        return None
    try:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / f"in{src_suffix or '.bin'}"
            dst = Path(td) / "out.opus"
            src.write_bytes(audio_bytes)
            r = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(src),
                    "-acodec",
                    "libopus",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    str(dst),
                ],
                capture_output=True,
                timeout=120,
            )
            if r.returncode != 0 or not dst.is_file():
                return None
            return dst.read_bytes()
    except Exception as e:
        logger.debug(f"ffmpeg 转 opus 失败: {e}")
        return None


def _markdown_element(
    content: str,
    *,
    element_id: Optional[str] = None,
) -> Dict[str, Any]:
    el: Dict[str, Any] = {
        "tag": "markdown",
        "content": content,
        "text_align": "left",
        "text_size": "normal",
    }
    if element_id:
        el["element_id"] = element_id
    return el


def _img_element(img_key: str, alt: str) -> Dict[str, Any]:
    return {
        "tag": "img",
        "img_key": img_key,
        "alt": {"tag": "plain_text", "content": (alt or "配图")[:80]},
        "preview": True,
    }


def _audio_element(*, file_key: str, audio_id: str) -> Dict[str, Any]:
    return {
        "tag": "audio",
        "element_id": f"au_{audio_id}"[:20],
        "file_key": file_key,
        "audio_id": audio_id,
        "width": "fill",
    }


def _card_config(
    *,
    streaming: bool,
    has_audio: bool,
    settings: Settings,
) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "update_multi": True,
        "streaming_mode": bool(streaming),
    }
    if streaming:
        cfg["summary"] = {"content": ""}
        pause = float(getattr(settings, "feishu_rag_card_stream_pause_sec", 0.08) or 0.08)
        freq = max(30, min(500, int(pause * 1000)))
        cfg["streaming_config"] = {
            "print_frequency_ms": {
                "default": freq,
                "android": freq,
                "ios": freq,
                "pc": freq,
            },
            "print_step": {"default": 1, "android": 1, "ios": 1, "pc": 1},
            "print_strategy": "fast",
        }
    if has_audio:
        cfg["enable_forward"] = False
    return cfg


def _estimate_card_bytes(card: Dict[str, Any]) -> int:
    return len(json.dumps(card, ensure_ascii=False).encode("utf-8"))


async def _flatten_outbound_to_slots(
    client: Any,
    resolved: List[FeishuOutboundMessage],
) -> List[Tuple[str, Any]]:
    """
    将 presenter 产出展开为有序槽位：
    ("md", str) | ("img", {...}) | ("audio", FeishuOutboundMessage)
    """
    slots: List[Tuple[str, Any]] = []

    async def handle_post_segments(segments: List[PostSegment]) -> None:
        for seg in segments:
            if not seg:
                continue
            kind = seg[0]
            if kind == "md" and len(seg) > 1:
                t = str(seg[1]).strip()
                if t:
                    slots.append(("md", str(seg[1])))
            elif kind == "img" and len(seg) >= 4:
                kb_id = str(seg[1])
                fp = str(seg[2])
                name = str(seg[3])
                data = await read_image_bytes(kb_id, fp)
                if not data:
                    slots.append(("md", f"（图片未能读取：{name}）"))
                    continue
                b, _ = data
                key = await feishu_upload_image(client, b, name or "img.png")
                if key:
                    slots.append(
                        (
                            "img",
                            {
                                "img_key": str(key),
                                "kb_id": kb_id,
                                "file_path": fp,
                                "name": name,
                            },
                        )
                    )
                else:
                    slots.append(("md", f"（图片上传飞书失败：{name}）"))

    for item in resolved:
        if item.kind == "post_mixed" and item.post_segments:
            await handle_post_segments(item.post_segments)
        elif item.kind == "text" and item.text:
            slots.append(("md", item.text))
        elif item.kind == "image" and item.image_bytes:
            key = await feishu_upload_image(
                client, item.image_bytes, item.image_name or "img.png"
            )
            if key:
                slots.append(
                    (
                        "img",
                        {
                            "img_key": str(key),
                            "kb_id": item.kb_id or "",
                            "file_path": item.file_path or "",
                            "name": item.image_name or "img.png",
                        },
                    )
                )
            else:
                slots.append(("md", f"（图片上传失败：{item.image_name}）"))
        elif item.kind == "audio" and item.audio_bytes:
            slots.append(("audio", item))

    return slots


_REF_MARKER = "参考知识库资料"


def _build_card_header_title(user_query: str) -> str:
    q = (user_query or "").strip().replace("\n", " ")
    if len(q) > 80:
        q = q[:77] + "..."
    return f"回答 · {q}" if q else "回答"


def _find_reference_md_run(
    slots: List[Tuple[str, Any]],
    ref_chunks: List[str],
) -> Optional[Tuple[int, int]]:
    """与 presenter 切分后的参考文献 md 段逐段一致时，返回 (起始下标, 段数)。"""
    if not ref_chunks:
        return None
    n = len(ref_chunks)
    for i in range(len(slots) - n + 1):
        ok = True
        for j in range(n):
            k, p = slots[i + j]
            if k != "md":
                ok = False
                break
            if str(p).strip() != str(ref_chunks[j]).strip():
                ok = False
                break
        if ok:
            return (i, n)
    return None


def _slots_contain_ref_marker(slots: List[Tuple[str, Any]]) -> bool:
    for k, p in slots:
        if k == "md" and _REF_MARKER in str(p):
            return True
    return False


def _split_md_by_ref_marker(text: str) -> Tuple[str, str]:
    raw = str(text or "")
    marker = "—— 参考知识库资料 ——"
    idx = raw.find(marker)
    if idx < 0:
        idx = raw.find(_REF_MARKER)
    if idx < 0:
        return raw, ""
    return raw[:idx].rstrip(), raw[idx:].strip()


def _split_slots_for_reference_collapsible(
    slots: List[Tuple[str, Any]],
    refs: List[Dict[str, Any]],
) -> Tuple[List[Tuple[str, Any]], List[Tuple[str, Any]], str]:
    """
    拆成 (参考文献之前的槽位, 之后的槽位, 折叠内要展示的参考文献全文 md)。
    无参考文献或无法安全剥离时，第三项为空字符串（不插折叠）。
    """
    ref_full = _format_references(refs).strip()
    if not ref_full:
        return (list(slots), [], "")

    ref_chunks = [
        c for c in split_feishu_md_chunks(ref_full, DEFAULT_FEISHU_MD_CHUNK) if (c or "").strip()
    ]
    run = _find_reference_md_run(slots, ref_chunks)
    if run:
        i, n = run
        return (slots[:i], slots[i + n :], ref_full)

    if _slots_contain_ref_marker(slots):
        before: List[Tuple[str, Any]] = []
        after: List[Tuple[str, Any]] = []
        found_ref = False
        for k, p in slots:
            if k == "md":
                text = str(p)
                if not found_ref and _REF_MARKER in text:
                    head, _tail = _split_md_by_ref_marker(text)
                    if head.strip():
                        before.append(("md", head.strip()))
                    found_ref = True
                    continue
                if found_ref:
                    continue
            if found_ref:
                after.append((k, p))
            else:
                before.append((k, p))
        return (before, after, ref_full)

    return (list(slots), [], ref_full)


def _refs_collapsible_element(ref_markdown: str) -> Dict[str, Any]:
    inner = feishu_normalize_markdown_for_post(ref_markdown.strip())
    return {
        "tag": "collapsible_panel",
        "element_id": "refsPanel01",
        "expanded": False,
        "direction": "vertical",
        "vertical_spacing": "8px",
        "padding": "8px",
        "margin": "8px 0 0 0",
        "header": {
            "title": {
                "tag": "plain_text",
                "content": "参考知识库资料",
            },
            "vertical_align": "center",
            "icon": {
                "tag": "standard_icon",
                "token": "down-small-ccm_outlined",
                "color": "",
                "size": "16px 16px",
            },
            "icon_position": "right",
            "icon_expanded_angle": -180,
        },
        "border": {"color": "grey", "corner_radius": "5px"},
        "elements": [_markdown_element(inner)],
    }


def _split_slots_audio(
    slots: List[Tuple[str, Any]],
) -> Tuple[List[Tuple[str, Any]], List[FeishuOutboundMessage]]:
    rest: List[Tuple[str, Any]] = []
    audios: List[FeishuOutboundMessage] = []
    for k, p in slots:
        if k == "audio" and isinstance(p, FeishuOutboundMessage):
            audios.append(p)
        else:
            rest.append((k, p))
    return rest, audios


def _stream_md_element_id(index: int) -> str:
    """须字母开头、≤20 字符，与同卡其它 element_id 不重复。"""
    return f"m{index:03d}"


def _img_slot_ref_index(payload: Any, refs: List[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    kb_id = str(payload.get("kb_id") or "")
    fp = str(payload.get("file_path") or "")
    if not fp:
        return None
    for idx, r in enumerate(refs, start=1):
        if (r.get("type") or "").lower() != "image":
            continue
        md = r.get("metadata") or {}
        if kb_id and str(md.get("kb_id") or "") != kb_id:
            continue
        if str(r.get("file_path") or "") == fp:
            return idx
    return None


def _ordered_unique_ints(vals: List[int]) -> List[int]:
    out: List[int] = []
    seen: set[int] = set()
    for v in vals:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _reflow_trailing_images_by_citations(
    slots: List[Tuple[str, Any]],
    refs: List[Dict[str, Any]],
) -> List[Tuple[str, Any]]:
    """
    presenter 会把未内联图片统一追加到末尾。这里将尾部图片按正文中的 [n] 引用号
    回插到命中段落后；已在正文中间的图片保持原位不动。
    """
    if not slots:
        return []

    last_non_img = -1
    for i, (kind, _) in enumerate(slots):
        if kind != "img":
            last_non_img = i
    if last_non_img < 0 or last_non_img == len(slots) - 1:
        return list(slots)

    lead = list(slots[: last_non_img + 1])
    tail = list(slots[last_non_img + 1 :])
    if not tail or any(kind != "img" for kind, _ in tail):
        return list(slots)

    img_by_ref: Dict[int, List[Tuple[str, Any]]] = {}
    tail_unmapped: List[Tuple[str, Any]] = []
    for slot in tail:
        ref_idx = _img_slot_ref_index(slot[1], refs)
        if ref_idx is None:
            tail_unmapped.append(slot)
        else:
            img_by_ref.setdefault(ref_idx, []).append(slot)

    if not img_by_ref:
        return list(slots)

    out: List[Tuple[str, Any]] = []
    used_refs: set[int] = set()
    for kind, payload in lead:
        if kind != "md":
            out.append((kind, payload))
            continue
        parts = [p.strip() for p in re.split(r"\n{2,}", str(payload)) if p.strip()]
        if not parts:
            continue
        for part in parts:
            out.append(("md", part))
            cited = _ordered_unique_ints(
                [int(m.group(1)) for m in _IMG_CITATION.finditer(part)]
            )
            for ref_idx in cited:
                if ref_idx in used_refs:
                    continue
                imgs = img_by_ref.get(ref_idx) or []
                if imgs:
                    out.extend(imgs)
                    used_refs.add(ref_idx)

    for ref_idx in sorted(img_by_ref.keys()):
        if ref_idx in used_refs:
            continue
        out.extend(img_by_ref[ref_idx])
    out.extend(tail_unmapped)
    return out


def _slots_to_elements(
    slots: List[Tuple[str, Any]],
    *,
    streaming: bool,
    stream_placeholder: str,
    md_index_base: int = 0,
) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str]], int]:
    """
    将槽位转为 body.elements。

    非流式：md 与 img 交替（连续 md 会先合并为一块），stream_specs 为空。
    流式：每块合并后的 markdown 单独一个组件并带 element_id（从 md_index_base 递增），
    stream_specs 为 [(element_id, 该块全量正文), ...]。返回下一可用的 md 序号。
    """
    placeholder = (stream_placeholder or " ").strip() or " "

    if streaming:
        elems: List[Dict[str, Any]] = []
        stream_specs: List[Tuple[str, str]] = []
        md_buf: List[str] = []
        md_idx = md_index_base

        def flush_md_stream() -> None:
            nonlocal md_idx
            if not md_buf:
                return
            text = "\n\n".join(m.strip() for m in md_buf if m.strip())
            md_buf.clear()
            if not text:
                return
            full = feishu_normalize_markdown_for_post(text)
            eid = _stream_md_element_id(md_idx)
            md_idx += 1
            elems.append(_markdown_element(placeholder, element_id=eid))
            stream_specs.append((eid, full))

        for kind, payload in slots:
            if kind == "md":
                md_buf.append(str(payload))
            elif kind == "img":
                flush_md_stream()
                if isinstance(payload, dict):
                    elems.append(
                        _img_element(
                            str(payload.get("img_key") or ""),
                            str(payload.get("name") or "配图"),
                        )
                    )
        flush_md_stream()
        return elems, stream_specs, md_idx

    elems_ns: List[Dict[str, Any]] = []
    md_buf_ns: List[str] = []

    def flush_md_ns() -> None:
        if not md_buf_ns:
            return
        text = "\n\n".join(m.strip() for m in md_buf_ns if m.strip())
        md_buf_ns.clear()
        if not text:
            return
        text = feishu_normalize_markdown_for_post(text)
        elems_ns.append(_markdown_element(text))

    for kind, payload in slots:
        if kind == "md":
            md_buf_ns.append(str(payload))
        elif kind == "img":
            flush_md_ns()
            if isinstance(payload, dict):
                elems_ns.append(
                    _img_element(
                        str(payload.get("img_key") or ""),
                        str(payload.get("name") or "配图"),
                    )
                )
    flush_md_ns()
    return elems_ns, [], md_index_base


def _inject_audio_elements(
    card: Dict[str, Any],
    audio_entries: List[Tuple[str, str]],
) -> None:
    body = card.setdefault("body", {})
    el = body.setdefault("elements", [])
    for fk, aid in audio_entries:
        el.append(_audio_element(file_key=fk, audio_id=str(aid)))


async def try_send_feishu_rag_card_v2(
    client: Any,
    *,
    message_id: str,
    resolved: List[FeishuOutboundMessage],
    settings: Settings,
    reply_in_thread: bool,
    user_query: str = "",
    generation_result: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    尝试以卡片 2.0 发送整条 RAG 回复。失败返回 False，由调用方回退 post/多消息逻辑。
    """
    fmt = (getattr(settings, "feishu_rag_reply_format", "post") or "post").strip().lower()
    if fmt != "card_v2":
        return False

    app_id = (getattr(settings, "feishu_app_id", None) or "").strip()
    app_secret = (getattr(settings, "feishu_app_secret", None) or "").strip()
    if not app_id or not app_secret:
        logger.warning("飞书卡片 v2：未配置 FEISHU_APP_ID / FEISHU_APP_SECRET")
        return False

    slots = await _flatten_outbound_to_slots(client, resolved)
    slots_na, audio_msgs = _split_slots_audio(slots)

    refs_list: List[Dict[str, Any]] = list(
        (generation_result or {}).get("references_used") or []
    )
    slots_na = _reflow_trailing_images_by_citations(slots_na, refs_list)
    slots_before, slots_after, ref_collapsed_md = _split_slots_for_reference_collapsible(
        slots_na, refs_list
    )

    streaming = bool(getattr(settings, "feishu_rag_card_streaming", False))
    stream_ph = " "

    elems_a, specs_a, md_next = _slots_to_elements(
        slots_before,
        streaming=streaming,
        stream_placeholder=stream_ph,
        md_index_base=0,
    )
    elems_b, specs_b, _ = _slots_to_elements(
        slots_after,
        streaming=streaming,
        stream_placeholder=stream_ph,
        md_index_base=md_next,
    )
    collapse_el = (
        _refs_collapsible_element(ref_collapsed_md) if ref_collapsed_md else None
    )
    elems = elems_a + ([collapse_el] if collapse_el else []) + elems_b
    stream_md_specs = specs_a + specs_b

    # 处理音频 → OPUS + file_key（失败则记录待会外发）
    use_opus = bool(getattr(settings, "feishu_rag_card_opus_audio", True))
    audio_card: List[Tuple[str, str]] = []
    audio_fallback: List[FeishuOutboundMessage] = []
    token: Optional[str] = None

    if use_opus and audio_msgs:
        token = feishu_tenant_access_token_sync(app_id=app_id, app_secret=app_secret)

    for i, item in enumerate(audio_msgs, start=1):
        if not item.audio_bytes:
            continue
        if not use_opus or not token:
            audio_fallback.append(item)
            continue
        name = item.audio_name or "audio.bin"
        suf = Path(name).suffix.lower()
        raw = item.audio_bytes
        dur_ms = _probe_duration_ms(raw, settings)
        opus_bytes: Optional[bytes] = None
        if suf == ".opus":
            opus_bytes = raw
        else:
            opus_bytes = _bytes_to_opus(raw, suf, settings)
        if not opus_bytes:
            audio_fallback.append(item)
            continue
        fk = feishu_upload_im_file_with_duration_sync(
            token=token,
            file_bytes=opus_bytes,
            filename=re.sub(r"\.[^.]+$", "", name) + ".opus" if "." in name else name + ".opus",
            file_type="opus",
            duration_ms=dur_ms,
        )
        if not fk:
            audio_fallback.append(item)
            continue
        audio_card.append((fk, str(i)))

    has_audio = len(audio_card) > 0

    card: Dict[str, Any] = {
        "schema": "2.0",
        "config": _card_config(
            streaming=streaming, has_audio=has_audio, settings=settings
        ),
        "header": {
            "title": {
                "tag": "plain_text",
                "content": _build_card_header_title(user_query),
            },
            "template": "blue",
        },
        "body": {
            "direction": "vertical",
            "padding": "12px 12px 12px 12px",
            "elements": elems,
        },
    }

    if audio_card:
        _inject_audio_elements(card, audio_card)

    if not elems and not audio_card:
        return False

    if _estimate_card_bytes(card) > _MAX_CARD_JSON_BYTES:
        logger.info("飞书卡片 v2 体积超限，回退 post/多消息")
        return False

    if not streaming:
        ok = await feishu_reply_interactive(
            client,
            message_id=message_id,
            card=card,
            reply_in_thread=reply_in_thread,
        )
        if not ok:
            return False
        await _send_audio_fallback(
            client,
            message_id=message_id,
            items=audio_fallback,
            reply_in_thread=reply_in_thread,
        )
        return True

    # —— 流式：创建实体 → 回复 card_id → PUT 正文 → 关闭 streaming ——
    if token is None:
        token = feishu_tenant_access_token_sync(app_id=app_id, app_secret=app_secret)
    if not token:
        return False

    card_id = await asyncio.to_thread(feishu_cardkit_create_card_sync, token=token, card=card)
    if not card_id:
        return False

    content_wrap = json.dumps(
        {"type": "card", "data": {"card_id": card_id}},
        ensure_ascii=False,
    )
    ok = await feishu_reply_message(
        client,
        message_id=message_id,
        msg_type="interactive",
        content_json=content_wrap,
        reply_in_thread=reply_in_thread,
    )
    if not ok:
        return False

    seq = 1
    chunk_sz = max(20, int(getattr(settings, "feishu_rag_card_stream_chunk_chars", 120) or 120))
    pause = float(getattr(settings, "feishu_rag_card_stream_pause_sec", 0.08) or 0.0)
    blank = stream_ph.strip() or " "

    for eid, full_text in stream_md_specs:
        final_md = (full_text or "").strip()
        if not final_md:
            final_md = blank
        final_md = final_md[:100000]
        if len(final_md) <= chunk_sz:
            ok_put = await asyncio.to_thread(
                feishu_cardkit_put_element_content_sync,
                token=token,
                card_id=card_id,
                element_id=eid,
                content=final_md,
                sequence=seq,
            )
            seq += 1
            if not ok_put:
                logger.warning(f"飞书卡片流式更新失败 element_id={eid!r} seq={seq - 1}")
        else:
            step = chunk_sz
            for i in range(0, len(final_md), step):
                acc = final_md[: i + step]
                ok_put = await asyncio.to_thread(
                    feishu_cardkit_put_element_content_sync,
                    token=token,
                    card_id=card_id,
                    element_id=eid,
                    content=acc,
                    sequence=seq,
                )
                seq += 1
                if not ok_put:
                    logger.warning(
                        f"飞书卡片流式更新失败 element_id={eid!r} seq={seq - 1}"
                    )
                if pause > 0:
                    await asyncio.sleep(pause)

    # 关闭流式，避免长期「生成中」、恢复转发能力（无音频时）
    settings_patch: Dict[str, Any] = {
        "config": {
            "update_multi": True,
            "streaming_mode": False,
            "enable_forward": False if has_audio else True,
        }
    }
    await asyncio.to_thread(
        feishu_cardkit_patch_settings_sync,
        token=token,
        card_id=card_id,
        settings=settings_patch,
        sequence=seq,
    )

    await _send_audio_fallback(
        client,
        message_id=message_id,
        items=audio_fallback,
        reply_in_thread=reply_in_thread,
    )
    return True


async def _send_audio_fallback(
    client: Any,
    *,
    message_id: str,
    items: List[FeishuOutboundMessage],
    reply_in_thread: bool,
) -> None:
    if not items:
        return

    for item in items:
        if not item.audio_bytes:
            continue
        fk = await feishu_upload_im_file(
            client,
            file_bytes=item.audio_bytes,
            filename=item.audio_name or "audio.mp3",
        )
        if fk:
            await feishu_reply_file(
                client,
                message_id=message_id,
                file_key=fk,
                reply_in_thread=reply_in_thread,
            )
