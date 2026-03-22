"""
飞书会话内「待合并附件」缓冲：用户常先发图/语音再发文字（或相反），
与 Web 单条多模态不同。文本侧通过短延迟拉取本缓冲，与附件摘要一并检索。
"""

from __future__ import annotations

import asyncio
import time
from typing import Dict, List, Optional, Tuple

from app.core.logger import get_logger
from app.modules.chat.attachment_summarizer import MAX_ATTACHMENTS

logger = get_logger(__name__)

# 与 summarize 上限一致；超时后丢弃，避免陈旧附件误绑下一条提问
_ATTACH_TTL_SEC = 120.0

# (filename, content_type, raw_bytes)
PendingFile = Tuple[str, str, bytes]

_PENDING: Dict[str, dict] = {}
_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


async def pending_add_file(session_key: str, item: PendingFile) -> bool:
    """追加一条已下载附件；超过数量则拒绝并返回 False。"""
    async with _get_lock():
        now = time.monotonic()
        ent = _PENDING.get(session_key)
        if ent and now > float(ent["deadline"]):
            ent = None
        if not ent:
            ent = {"items": [], "deadline": now + _ATTACH_TTL_SEC}
        items: List[PendingFile] = ent["items"]
        if len(items) >= MAX_ATTACHMENTS:
            logger.warning(
                f"飞书待合并附件已满（>{MAX_ATTACHMENTS}），跳过新附件 session_key={session_key[:24]}…"
            )
            return False
        items.append(item)
        ent["deadline"] = now + _ATTACH_TTL_SEC
        _PENDING[session_key] = ent
        return True


async def pending_take_all(session_key: str) -> List[PendingFile]:
    """取出当前会话全部未过期附件并清空缓冲。"""
    async with _get_lock():
        ent = _PENDING.pop(session_key, None)
        if not ent:
            return []
        if time.monotonic() > float(ent["deadline"]):
            return []
        return list(ent["items"])


async def pending_restore(session_key: str, items: List[PendingFile]) -> None:
    """摘要等失败时把已取出的附件塞回缓冲（新会话优先排在前面）。"""
    if not items:
        return
    async with _get_lock():
        now = time.monotonic()
        ent = _PENDING.get(session_key)
        if ent and now > float(ent["deadline"]):
            ent = None
        rest: List[PendingFile] = list(ent["items"]) if ent else []
        merged = list(items) + rest
        if len(merged) > MAX_ATTACHMENTS:
            merged = merged[:MAX_ATTACHMENTS]
        _PENDING[session_key] = {"items": merged, "deadline": now + _ATTACH_TTL_SEC}
