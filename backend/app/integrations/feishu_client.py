"""
飞书 IM API 封装（基于 lark-oapi HTTP Client，在主事件循环中 await）。
"""

from __future__ import annotations

import io
import json
from typing import TYPE_CHECKING, Any, List, Optional, Tuple

from app.core.logger import get_logger

if TYPE_CHECKING:
    from lark_oapi import Client

logger = get_logger(__name__)


def _text_content(text: str) -> str:
    return json.dumps({"text": text}, ensure_ascii=False)


def _image_content(image_key: str) -> str:
    return json.dumps({"image_key": image_key}, ensure_ascii=False)


def _post_md_content(*, markdown: str, title: str = "") -> str:
    """msg_type=post：单段 md 节点（独占段落）。"""
    payload = {
        "zh_cn": {
            "title": title or "",
            "content": [[{"tag": "md", "text": markdown}]],
        }
    }
    return json.dumps(payload, ensure_ascii=False)


def _post_content_json(*, paragraphs: List[List[dict[str, Any]]], title: str = "") -> str:
    """post.content：多段落；每段为节点列表（如 md、img 各占一段）。"""
    payload = {"zh_cn": {"title": title or "", "content": paragraphs}}
    return json.dumps(payload, ensure_ascii=False)


def feishu_fetch_bot_open_id_sync(*, app_id: str, app_secret: str) -> Optional[str]:
    """同步拉取 bot open_id，供 WS 线程启动时预取。"""
    import httpx

    try:
        with httpx.Client(timeout=20.0) as hc:
            tr = hc.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
            tr.raise_for_status()
            tj = tr.json()
            if tj.get("code") != 0:
                logger.warning(f"飞书 tenant_token 失败: {tj}")
                return None
            token = tj.get("tenant_access_token")
            if not token:
                return None
            br = hc.get(
                "https://open.feishu.cn/open-apis/bot/v3/info",
                headers={"Authorization": f"Bearer {token}"},
            )
            br.raise_for_status()
            bj = br.json()
            if bj.get("code") != 0:
                logger.warning(
                    f"飞书 bot/v3/info 失败: code={bj.get('code')} msg={bj.get('msg')!r} "
                    f"（可检查应用权限是否含通讯录/机器人信息，或在 .env 设置 FEISHU_BOT_OPEN_ID）"
                )
                return None
            # 飞书实际返回多为顶层 bot；文档示例也有包在 data.bot 下的形态，两种都兼容
            bot: Optional[dict] = None
            if isinstance(bj.get("bot"), dict):
                bot = bj["bot"]
            else:
                raw_data = bj.get("data")
                if isinstance(raw_data, dict):
                    inner = raw_data.get("bot")
                    bot = inner if isinstance(inner, dict) else raw_data
            if isinstance(bot, dict):
                oid = bot.get("open_id")
                if oid:
                    return str(oid)
            logger.warning(
                f"飞书 bot/v3/info 未解析到 open_id，完整 JSON 摘要 keys={list(bj.keys())}；可配置 FEISHU_BOT_OPEN_ID"
            )
            return None
    except Exception as e:
        logger.warning(f"同步拉取飞书 bot open_id 异常: {e}")
        return None


async def feishu_fetch_bot_open_id(*, app_id: str, app_secret: str) -> Optional[str]:
    """GET /open-apis/bot/v3/info（不依赖 SDK 是否生成该路径的封装）。"""
    import asyncio

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        lambda: feishu_fetch_bot_open_id_sync(app_id=app_id, app_secret=app_secret),
    )


async def feishu_upload_image(client: "Client", image_bytes: bytes, filename: str = "image.png") -> Optional[str]:
    from lark_oapi.api.im.v1.model.create_image_request import CreateImageRequest
    from lark_oapi.api.im.v1.model.create_image_request_body import CreateImageRequestBody

    body = (
        CreateImageRequestBody.builder()
        .image_type("message")
        .image(io.BytesIO(image_bytes))
        .build()
    )
    req = CreateImageRequest.builder().request_body(body).build()
    resp = await client.im.v1.image.acreate(req)
    if resp.code != 0:
        logger.warning(f"飞书上传图片失败: code={resp.code} msg={getattr(resp, 'msg', '')}")
        return None
    if resp.data and getattr(resp.data, "image_key", None):
        return str(resp.data.image_key)
    return None


async def feishu_reply_message(
    client: "Client",
    *,
    message_id: str,
    msg_type: str,
    content_json: str,
    reply_in_thread: bool = False,
) -> bool:
    from lark_oapi.api.im.v1.model.reply_message_request import ReplyMessageRequest
    from lark_oapi.api.im.v1.model.reply_message_request_body import ReplyMessageRequestBody

    bb = ReplyMessageRequestBody.builder().msg_type(msg_type).content(content_json)
    if reply_in_thread:
        bb = bb.reply_in_thread(True)
    body = bb.build()
    req = ReplyMessageRequest.builder().message_id(message_id).request_body(body).build()
    resp = await client.im.v1.message.areply(req)
    if resp.code != 0:
        logger.warning(
            f"飞书回复消息失败: message_id={message_id} code={resp.code} msg={getattr(resp, 'msg', '')}"
        )
        return False
    return True


async def feishu_send_text_to_chat(
    client: "Client",
    *,
    chat_id: str,
    text: str,
) -> bool:
    from lark_oapi.api.im.v1.model.create_message_request import CreateMessageRequest
    from lark_oapi.api.im.v1.model.create_message_request_body import CreateMessageRequestBody

    body = (
        CreateMessageRequestBody.builder()
        .receive_id(chat_id)
        .msg_type("text")
        .content(_text_content(text))
        .build()
    )
    req = CreateMessageRequest.builder().receive_id_type("chat_id").request_body(body).build()
    resp = await client.im.v1.message.acreate(req)
    if resp.code != 0:
        logger.warning(f"飞书发消息失败 chat_id={chat_id} code={resp.code} msg={getattr(resp, 'msg', '')}")
        return False
    return True


async def feishu_reply_text(
    client: "Client",
    *,
    message_id: str,
    text: str,
    reply_in_thread: bool = False,
) -> bool:
    return await feishu_reply_message(
        client,
        message_id=message_id,
        msg_type="text",
        content_json=_text_content(text),
        reply_in_thread=reply_in_thread,
    )


async def feishu_reply_post_md(
    client: "Client",
    *,
    message_id: str,
    markdown: str,
    title: str = "",
    reply_in_thread: bool = False,
) -> bool:
    """富文本 post，内容放在 md 标签内（与飞书客户端 Markdown 子集对齐）。"""
    return await feishu_reply_message(
        client,
        message_id=message_id,
        msg_type="post",
        content_json=_post_md_content(markdown=markdown, title=title),
        reply_in_thread=reply_in_thread,
    )


async def feishu_download_message_resource(
    client: "Client",
    *,
    message_id: str,
    file_key: str,
    resource_type: str,
) -> Optional[Tuple[bytes, str, str]]:
    """
    下载单条消息内资源（图片 image_key / 语音 file_key 等）。
    需在开放平台为应用申请读取消息资源相关权限（如 im:resource 等，以控制台为准）。
    返回 (bytes, filename, content_type)；失败返回 None。
    """
    from lark_oapi.api.im.v1.model.get_message_resource_request import GetMessageResourceRequest

    try:
        req = (
            GetMessageResourceRequest.builder()
            .message_id(message_id)
            .file_key(file_key)
            .type(resource_type)
            .build()
        )
        resp = await client.im.v1.message_resource.aget(req)
    except Exception as e:
        logger.warning(f"飞书下载消息资源异常: {e}", exc_info=True)
        return None

    if not getattr(resp, "file", None):
        code = getattr(resp, "code", None)
        msg = getattr(resp, "msg", "")
        logger.warning(
            f"飞书下载消息资源失败: message_id={message_id[:16]}… type={resource_type!r} "
            f"code={code} msg={msg!r}"
        )
        return None

    try:
        raw = resp.file.read()
    except Exception as e:
        logger.warning(f"飞书资源读取流失败: {e}")
        return None

    fn = (getattr(resp, "file_name", None) or "").strip() or f"feishu_{file_key[-16:]}"
    ct = "application/octet-stream"
    raw_http = getattr(resp, "raw", None)
    if raw_http is not None:
        headers = getattr(raw_http, "headers", None) or {}
        ct = headers.get("Content-Type") or headers.get("content-type") or ct
    return raw, fn, ct.split(";", 1)[0].strip()


async def feishu_reply_post_paragraphs(
    client: "Client",
    *,
    message_id: str,
    paragraphs: List[List[dict[str, Any]]],
    title: str = "",
    reply_in_thread: bool = False,
) -> bool:
    """单条 post 内多段落（md 与 img 交替等）。"""
    if not paragraphs:
        return False
    return await feishu_reply_message(
        client,
        message_id=message_id,
        msg_type="post",
        content_json=_post_content_json(paragraphs=paragraphs, title=title),
        reply_in_thread=reply_in_thread,
    )


async def feishu_reply_image(
    client: "Client",
    *,
    message_id: str,
    image_key: str,
    reply_in_thread: bool = False,
) -> bool:
    return await feishu_reply_message(
        client,
        message_id=message_id,
        msg_type="image",
        content_json=_image_content(image_key),
        reply_in_thread=reply_in_thread,
    )
