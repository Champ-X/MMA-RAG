"""
飞书集成运行时状态（主循环、Lark HTTP Client、bot open_id、WS 线程）。
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from lark_oapi import Client

_ws_lock = threading.Lock()

main_loop: Optional[asyncio.AbstractEventLoop] = None
lark_client: Optional["Client"] = None
bot_open_id: Optional[str] = None
last_event_at: float = 0.0
ws_thread: Optional[threading.Thread] = None

# 由 feishu_ws 对 lark SDK 的 _connect/_disconnect 打补丁更新（供 /api/feishu/ws-status 判断长连接是否真连上）
ws_transport_connected: bool = False
ws_last_connected_at: float = 0.0
ws_last_disconnected_at: float = 0.0
ws_last_error: Optional[str] = None
ws_last_error_at: float = 0.0
# SDK Client._connect 每次进入时更新（区分「未开始建连」与「卡在握手」）
ws_last_connect_attempt_at: float = 0.0
# on_im_message_sync 入口计数（证明收到了 im.message.receive_v1）
im_receive_handler_calls: int = 0
last_im_receive_at: float = 0.0


def touch_event() -> None:
    global last_event_at
    last_event_at = time.time()


def touch_im_receive() -> None:
    """在 IM 事件处理入口调用（与 touch_event 区分：仅统计收消息事件）。"""
    global last_event_at, im_receive_handler_calls, last_im_receive_at
    now = time.time()
    with _ws_lock:
        last_event_at = now
        im_receive_handler_calls += 1
        last_im_receive_at = now


def ws_transport_on_connected() -> None:
    global ws_transport_connected, ws_last_connected_at, ws_last_error
    with _ws_lock:
        ws_transport_connected = True
        ws_last_connected_at = time.time()
        ws_last_error = None


def ws_transport_on_disconnected() -> None:
    global ws_transport_connected, ws_last_disconnected_at
    with _ws_lock:
        ws_transport_connected = False
        ws_last_disconnected_at = time.time()


def ws_transport_on_error(exc: BaseException) -> None:
    global ws_last_error, ws_last_error_at, ws_transport_connected
    with _ws_lock:
        ws_transport_connected = False
        ws_last_error = f"{type(exc).__name__}: {exc!s}"[:2000]
        ws_last_error_at = time.time()


def ws_transport_touch_connect_attempt() -> None:
    global ws_last_connect_attempt_at
    with _ws_lock:
        ws_last_connect_attempt_at = time.time()


def ws_status_snapshot() -> Dict[str, Any]:
    """供 HTTP 探活，字段保持稳定便于脚本解析。"""
    with _ws_lock:
        return {
            "ws_transport_connected": ws_transport_connected,
            "ws_last_connected_at": ws_last_connected_at,
            "ws_last_disconnected_at": ws_last_disconnected_at,
            "ws_last_error": ws_last_error,
            "ws_last_error_at": ws_last_error_at,
            "ws_last_connect_attempt_at": ws_last_connect_attempt_at,
            "im_receive_handler_calls": im_receive_handler_calls,
            "last_im_receive_at": last_im_receive_at,
            "last_event_at": last_event_at,
            "bot_open_id_cached": bool((bot_open_id or "").strip()),
        }
