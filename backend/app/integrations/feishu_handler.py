"""
飞书消息 → 去重/过滤（同步入口在 ws 线程）→ RAG（主 asyncio 循环）→ 回复。
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Dict, List, Optional, Set

import redis

from app.core.config import settings
from app.core.logger import get_logger
from app.integrations import feishu_state
from app.integrations.feishu_client import (
    feishu_fetch_bot_open_id,
    feishu_reply_image,
    feishu_reply_post_md,
    feishu_reply_post_paragraphs,
    feishu_reply_text,
    feishu_upload_image,
)
from app.integrations.feishu_md_post import (
    DEFAULT_FEISHU_MD_CHUNK,
    feishu_normalize_markdown_for_post,
    split_feishu_md_chunks,
)
from app.integrations.feishu_media import read_image_bytes
from app.integrations.feishu_parser import extract_text
from app.integrations.feishu_presenter import FeishuOutboundMessage, build_outbound_messages
from app.integrations.feishu_sessions import append_turn, build_session_context, load_session
from app.modules.generation.service import GenerationService
from app.modules.retrieval.service import RetrievalService

logger = get_logger(__name__)

retrieval_service = RetrievalService()
generation_service = GenerationService()


async def _send_feishu_post_mixed(
    client: Any,
    message_id: str,
    segments: List[Any],
    *,
    reply_in_thread: bool,
    max_img: int,
) -> bool:
    """单条 post：md 段与 img 段交替（图片须独占段落）。"""
    paragraphs: List[List[Dict[str, Any]]] = []
    used = 0
    for seg in segments:
        if not seg:
            continue
        if seg[0] == "md":
            body = feishu_normalize_markdown_for_post(str(seg[1]))
            for chunk in split_feishu_md_chunks(body, DEFAULT_FEISHU_MD_CHUNK):
                if chunk.strip():
                    paragraphs.append([{"tag": "md", "text": chunk}])
        elif seg[0] == "img" and len(seg) >= 4:
            if used >= max_img:
                continue
            kb_id, fp, name = str(seg[1]), str(seg[2]), str(seg[3])
            data = await read_image_bytes(kb_id, fp)
            if not data:
                paragraphs.append(
                    [{"tag": "md", "text": f"（引用图片未能从存储读取：{fp}）"}]
                )
                continue
            b, _nm = data
            key = await feishu_upload_image(client, b, name or "img.png")
            if key:
                paragraphs.append([{"tag": "img", "image_key": key}])
                used += 1
            else:
                paragraphs.append(
                    [{"tag": "md", "text": f"（图片未能上传到飞书：{name}）"}]
                )
    if not paragraphs:
        return False
    return await feishu_reply_post_paragraphs(
        client,
        message_id=message_id,
        paragraphs=paragraphs,
        reply_in_thread=reply_in_thread,
    )


async def _fallback_post_mixed_as_separate_messages(
    client: Any,
    message_id: str,
    segments: List[Any],
    *,
    reply_in_thread: bool,
    max_img: int,
) -> None:
    used = 0
    for seg in segments:
        if not seg:
            continue
        if seg[0] == "md":
            body = feishu_normalize_markdown_for_post(str(seg[1]))
            for chunk in split_feishu_md_chunks(body, DEFAULT_FEISHU_MD_CHUNK):
                if not chunk.strip():
                    continue
                ok = await feishu_reply_post_md(
                    client,
                    message_id=message_id,
                    markdown=chunk,
                    reply_in_thread=reply_in_thread,
                )
                if not ok:
                    await feishu_reply_text(
                        client,
                        message_id=message_id,
                        text=chunk,
                        reply_in_thread=reply_in_thread,
                    )
        elif seg[0] == "img" and len(seg) >= 4:
            if used >= max_img:
                continue
            kb_id, fp, name = str(seg[1]), str(seg[2]), str(seg[3])
            data = await read_image_bytes(kb_id, fp)
            if not data:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"（引用图片未能从存储读取：{fp}）",
                    reply_in_thread=reply_in_thread,
                )
                continue
            b, _nm = data
            key = await feishu_upload_image(client, b, name or "img.png")
            if key:
                await feishu_reply_image(
                    client,
                    message_id=message_id,
                    image_key=key,
                    reply_in_thread=reply_in_thread,
                )
                used += 1
            else:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"（图片未能上传到飞书：{name}）",
                    reply_in_thread=reply_in_thread,
                )

_r_lock = threading.Lock()
_bot_refresh_started = False


def _lark_client():
    from lark_oapi import Client as LarkClient
    from lark_oapi.core.enum import LogLevel

    if feishu_state.lark_client is not None:
        return feishu_state.lark_client
    app_id = (settings.feishu_app_id or "").strip()
    app_secret = (settings.feishu_app_secret or "").strip()
    feishu_state.lark_client = (
        LarkClient.builder()
        .app_id(app_id)
        .app_secret(app_secret)
        .log_level(LogLevel.ERROR)
        .build()
    )
    return feishu_state.lark_client


async def ensure_bot_open_id() -> None:
    """首次异步调用时拉取并缓存机器人 open_id（群聊 @ 校验用）。"""
    global _bot_refresh_started
    with _r_lock:
        if _bot_refresh_started:
            return
        _bot_refresh_started = True
    if (settings.feishu_bot_open_id or "").strip():
        feishu_state.bot_open_id = settings.feishu_bot_open_id.strip()
        return
    oid = await feishu_fetch_bot_open_id(
        app_id=settings.feishu_app_id or "",
        app_secret=settings.feishu_app_secret or "",
    )
    if oid:
        feishu_state.bot_open_id = oid
        logger.info("飞书机器人 open_id 已缓存（用于群聊 @ 校验）")


def _dedup_sync(dedup_key: str) -> bool:
    """True 表示可处理；False 表示已处理过应跳过。"""
    try:
        r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        k = f"feishu:dedup:{dedup_key}"
        ok = r.set(k, "1", nx=True, ex=max(60, int(settings.feishu_dedup_ttl_sec)))
        return bool(ok)
    except Exception as e:
        logger.warning(f"飞书去重 Redis 不可用，跳过去重: {e}")
        return True


def _mention_open_ids(mentions: Optional[List[Any]]) -> Set[str]:
    out: Set[str] = set()
    if not mentions:
        return out
    for m in mentions:
        mid = getattr(m, "id", None)
        if mid is not None:
            oid = getattr(mid, "open_id", None)
            if oid:
                out.add(str(oid))
    return out


def _should_handle_group_message(*, chat_type: str, text: str, mentions: Optional[List[Any]]) -> bool:
    ct = (chat_type or "").lower()
    # 仅群聊需要 @ 或触发前缀；单聊与其它类型默认处理
    if ct != "group":
        return True
    prefix = (settings.feishu_group_trigger_prefix or "").strip()
    if prefix and text.strip().startswith(prefix):
        return True
    mids = _mention_open_ids(mentions)
    if not mids:
        return False
    bot = (feishu_state.bot_open_id or "").strip() or (settings.feishu_bot_open_id or "").strip()
    if bot:
        return bot in mids
    # 未配置 bot open_id 时：群聊任意 @ 即处理（适合仅机器人被 @ 的场景）
    return True


def _strip_trigger_prefix(text: str) -> str:
    prefix = (settings.feishu_group_trigger_prefix or "").strip()
    if prefix and text.strip().startswith(prefix):
        return text.strip()[len(prefix) :].strip()
    return text.strip()


def on_im_message_read_sync(_data: Any) -> None:
    """
    消息已读（im.message.message_read_v1）。业务无需处理，但必须注册，
    否则 Lark 长连接会对每条已读回执报 processor not found 并刷 ERROR。
    """
    return


def on_im_message_sync(data: Any) -> None:
    """在飞书 WS 线程中调用：尽快返回。"""
    feishu_state.touch_im_receive()
    loop = feishu_state.main_loop
    if loop is None or loop.is_closed():
        logger.error("飞书事件到达但主事件循环未就绪")
        return

    try:
        header = getattr(data, "header", None)
        event_id = getattr(header, "event_id", None) if header else None
        ev = getattr(data, "event", None)
        msg = getattr(ev, "message", None) if ev else None
        sender = getattr(ev, "sender", None) if ev else None
        if not msg:
            return
        message_id = getattr(msg, "message_id", None) or ""
        chat_id = getattr(msg, "chat_id", None) or ""
        chat_type_dbg = (getattr(msg, "chat_type", None) or "") or ""
        mt_dbg = (getattr(msg, "message_type", None) or "") or ""
        logger.info(
            f"飞书 IM 事件入队: event_id={event_id!r} message_id={message_id[:20]!r}… "
            f"chat_type={chat_type_dbg!r} message_type={mt_dbg!r} chat_id_len={len(chat_id)}"
        )
        dedup_key = (event_id or message_id or "").strip()
        if dedup_key and not _dedup_sync(dedup_key):
            logger.info(f"飞书事件去重跳过: event_id={event_id} message_id={message_id}")
            return

        if settings.feishu_ignore_bot_messages and sender:
            st = (getattr(sender, "sender_type", None) or "").lower()
            if st == "app":
                return
            sid = getattr(sender, "sender_id", None)
            s_open = getattr(sid, "open_id", None) if sid else None
            bot = (feishu_state.bot_open_id or "").strip() or (settings.feishu_bot_open_id or "").strip()
            if bot and s_open and str(s_open) == bot:
                return

        mt = getattr(msg, "message_type", None)
        raw_content = getattr(msg, "content", None)
        text = extract_text(message_type=mt, content=raw_content)
        if not text:
            fut = asyncio.run_coroutine_threadsafe(
                _reply_plain(message_id, "请发送文字消息（暂不支持当前消息类型）。"),
                loop,
            )
            fut.add_done_callback(lambda f: f.exception() and logger.error(f"飞书回复失败: {f.exception()}"))
            return

        chat_type = getattr(msg, "chat_type", None) or ""
        mentions = getattr(msg, "mentions", None)
        if not _should_handle_group_message(chat_type=chat_type, text=text, mentions=mentions):
            return

        query = _strip_trigger_prefix(text)
        if not query:
            return

        asyncio.run_coroutine_threadsafe(
            _process_user_message(
                message_id=message_id,
                chat_id=chat_id,
                query=query,
            ),
            loop,
        )
    except Exception as e:
        logger.error(f"飞书同步事件处理异常: {e}", exc_info=True)


async def _reply_plain(message_id: str, text: str) -> None:
    if not message_id:
        return
    client = _lark_client()
    await feishu_reply_text(
        client,
        message_id=message_id,
        text=text,
        reply_in_thread=bool(settings.feishu_reply_in_thread),
    )


async def _process_user_message(*, message_id: str, chat_id: str, query: str) -> None:
    await ensure_bot_open_id()
    log_chat = chat_id[:16] if chat_id else ""
    logger.info(f"飞书 RAG 开始: message_id={message_id} chat_id={log_chat}... query={query[:80]!r}")

    client = _lark_client()
    if message_id and settings.feishu_typing_hint:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text=settings.feishu_typing_hint_text,
            reply_in_thread=bool(settings.feishu_reply_in_thread),
        )

    session_key = f"feishu:{chat_id}" if chat_id else f"feishu:nochat:{message_id}"
    sess = load_session(session_key)
    session_context = build_session_context(sess)

    kb_context = None
    raw_ids = (settings.feishu_default_kb_ids or "").strip()
    if raw_ids:
        kb_ids = [x.strip() for x in raw_ids.split(",") if x.strip()]
        if kb_ids:
            kb_context = {"kb_ids": kb_ids, "kb_names": []}

    try:
        retrieval_result = await retrieval_service.search(
            query=query,
            kb_context=kb_context,
            session_context=session_context,
        )
        generation_result = await generation_service.generate_response(
            query=query,
            retrieval_result=retrieval_result,
            session_id=session_key,
            kb_context=kb_context,
        )
    except Exception as e:
        logger.error(f"飞书 RAG 失败: {e}", exc_info=True)
        if message_id:
            await feishu_reply_text(
                client,
                message_id=message_id,
                text="处理问题时发生错误，请稍后重试。",
                reply_in_thread=bool(settings.feishu_reply_in_thread),
            )
        return

    if not generation_result.get("success"):
        err = generation_result.get("error") or "生成失败"
        if message_id:
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"生成回答失败：{err}",
                reply_in_thread=bool(settings.feishu_reply_in_thread),
            )
        return

    answer = (generation_result.get("answer") or "").strip()
    outbound = build_outbound_messages(generation_result=generation_result, settings=settings)

    # 解析 presenter 中的图片：读 MinIO → 上传飞书（post_mixed 在发送时再读图）
    resolved: List[FeishuOutboundMessage] = []
    for m in outbound:
        if m.kind == "post_mixed":
            resolved.append(m)
            continue
        if m.kind == "image" and m.kb_id and m.file_path:
            data = await read_image_bytes(m.kb_id, m.file_path)
            if data:
                b, name = data
                m.image_bytes = b
                m.image_name = name
            else:
                m.kind = "text"
                m.text = f"（引用图片未能从存储读取：{m.file_path}）"
        resolved.append(m)

    if not message_id:
        logger.error("飞书 message_id 为空，无法回复")
        return

    max_img_cap = max(0, min(int(getattr(settings, "feishu_max_reply_images", 4)), 10))
    rt = bool(settings.feishu_reply_in_thread)

    for item in resolved:
        if item.kind == "post_mixed" and item.post_segments:
            ok = await _send_feishu_post_mixed(
                client,
                message_id,
                item.post_segments,
                reply_in_thread=rt,
                max_img=max_img_cap,
            )
            if not ok:
                logger.warning("飞书 post 混排发送失败，拆分为多条消息重试")
                await _fallback_post_mixed_as_separate_messages(
                    client,
                    message_id,
                    item.post_segments,
                    reply_in_thread=rt,
                    max_img=max_img_cap,
                )
            continue
        if item.kind == "text" and item.text:
            if settings.feishu_reply_post_md:
                md_body = feishu_normalize_markdown_for_post(item.text)
                ok = await feishu_reply_post_md(
                    client,
                    message_id=message_id,
                    markdown=md_body,
                    reply_in_thread=rt,
                )
                if not ok:
                    ok = await feishu_reply_text(
                        client,
                        message_id=message_id,
                        text=item.text,
                        reply_in_thread=rt,
                    )
            else:
                ok = await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=item.text,
                    reply_in_thread=rt,
                )
            if not ok:
                break
        elif item.kind == "image" and item.image_bytes:
            key = await feishu_upload_image(client, item.image_bytes, item.image_name or "img.png")
            if key:
                await feishu_reply_image(
                    client,
                    message_id=message_id,
                    image_key=key,
                    reply_in_thread=rt,
                )
            else:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"（图片未能上传到飞书：{item.image_name or item.file_path}）",
                    reply_in_thread=rt,
                )

    append_turn(session_key, query, answer)
    logger.info(f"飞书 RAG 完成: message_id={message_id} answer_len={len(answer)}")
