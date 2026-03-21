"""飞书集成探活与状态（事件走长连接，勿与此处 Webhook 混用）。"""

import time

from fastapi import APIRouter

from app.core.config import settings
from app.integrations import feishu_state

router = APIRouter()


@router.get("/ws-status")
async def feishu_ws_status():
    t = feishu_state.ws_thread
    alive = bool(t is not None and t.is_alive())
    snap = feishu_state.ws_status_snapshot()
    return {
        "feishu_ws_enabled": settings.feishu_ws_enabled,
        "ws_thread_alive": alive,
        "main_loop_ready": bool(
            feishu_state.main_loop is not None and not feishu_state.main_loop.is_closed()
        ),
        **snap,
        "diagnosis_hint": _ws_status_diagnosis(snap, alive),
    }


def _ws_status_diagnosis(snap: dict, thread_alive: bool) -> str:
    """给人读的简短结论（脚本可忽略）。"""
    if not thread_alive:
        return "WS 线程未运行或未启动；检查 FEISHU_WS_ENABLED 与凭证。"
    if not snap.get("ws_transport_connected"):
        err = snap.get("ws_last_error") or ""
        if err:
            return f"线程在跑但 WSS 未连上，最近错误: {err[:120]}"
        attempt = float(snap.get("ws_last_connect_attempt_at") or 0)
        now = time.time()
        if attempt <= 0:
            return (
                "线程在跑但未记录到 WSS 建连尝试（可能卡在 endpoint 探测/取 open_id，或运行的是未含 connect 埋点的旧代码）；"
                "看日志是否出现「飞书长连接启动」与 endpoint 探测结果。"
            )
        age = now - attempt
        if age > 90:
            return (
                f"约 {int(age)}s 前有建连尝试仍未连上且无 ws_last_error，多卡在 TLS/出网（WSL 试 FEISHU_WS_PREFER_IPV4、"
                f"HTTPS_PROXY，或 Windows 本机跑）；当前 FEISHU_WS_OPEN_TIMEOUT={getattr(settings, 'feishu_ws_open_timeout', '?')}s。"
            )
        return (
            f"WSS 可能仍在握手（距上次建连尝试约 {int(age)}s）；超时见 FEISHU_WS_OPEN_TIMEOUT。"
            " 若长期如此，查日志 connect/SSL/IPv4 相关行。"
        )
    if snap.get("im_receive_handler_calls", 0) == 0:
        return "WSS 已连上，但尚未收到 im.message.receive_v1；确认控制台长连接+订阅，且仅一处进程连该应用。"
    if snap.get("last_im_receive_at", 0) > 0 and snap.get("last_event_at", 0) == snap.get("last_im_receive_at"):
        return "已收到 IM 事件；若无回复，查日志「飞书 RAG」或过滤/群聊 @ 规则。"
    return "WSS 已连上；请结合 im_receive_handler_calls 与日志排查。"
