"""
飞书长连接（lark-oapi WS Client）在独立线程中运行，避免阻塞 Uvicorn 主循环。
须在导入 lark_oapi.ws.client 之前为当前线程绑定 asyncio 事件循环（SDK 模块级 loop）。
"""

from __future__ import annotations

import asyncio
import socket
import threading
from typing import Optional
from urllib.parse import urlparse

from app.core.config import settings
from app.core.logger import get_logger
from app.integrations import feishu_state
from app.integrations.feishu_client import feishu_fetch_bot_open_id_sync
from app.integrations.feishu_handler import (
    on_card_action_sync,
    on_im_message_read_sync,
    on_im_message_sync,
)

logger = get_logger(__name__)


def _is_ipv4_literal(host: str) -> bool:
    try:
        socket.inet_pton(socket.AF_INET, host)
        return True
    except OSError:
        return False


def _ipv4_is_benchmark_or_fakeip(ip: str) -> bool:
    """
    198.18.0.0/15（RFC 5735 互联设备基准测试段）在不少环境里会被 Clash / sing-box 等
    TUN + Fake-IP 当成「假地址」返回；对飞书 WSS 强制连向该段易导致握手长期卡住。
    """
    try:
        packed = socket.inet_aton(ip)
    except OSError:
        return False
    a, b = packed[0], packed[1]
    return a == 198 and 18 <= b <= 19


def _resolve_wss_ipv4_target(hostname: str, port: int) -> Optional[str]:
    """返回用于 TCP 连接的 IPv4 地址；失败则返回 None（回退默认解析）。"""
    try:
        infos = socket.getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except OSError as e:
        logger.warning(f"飞书 WSS 域名解析失败 {hostname}:{port} — {e}")
        return None
    for fam, *_rest, sockaddr in infos:
        if fam != socket.AF_INET:
            continue
        ip = sockaddr[0]
        if _ipv4_is_benchmark_or_fakeip(ip):
            logger.warning(
                f"飞书 WSS IPv4 解析到 {ip}（198.18/15，多为代理/VPN Fake-IP），已跳过该结果。"
                f"请为 *.feishu.cn 配置直连/绕过，或暂时设置 FEISHU_WS_PREFER_IPV4=false。"
                f" 当前主机名={hostname!r}"
            )
            continue
        return ip
    logger.warning(f"飞书 WSS 未解析到可用 IPv4 地址: {hostname}（将使用系统默认解析顺序）")
    return None


def _patch_websockets_open_timeout() -> None:
    """
    lark-oapi WS Client 使用 websockets.connect() 且未传超时参数时：
    - websockets 默认 open_timeout=10s（易误判为空 TimeoutError）
    - asyncio create_connection 对 TLS 默认 ssl_handshake_timeout=60s（慢链路会报
      「SSL handshake is taking longer than 60.0 seconds」）

    在导入 lark_oapi.ws.client 之前打补丁，与 FEISHU_WS_OPEN_TIMEOUT 对齐。
    """
    import websockets

    timeout = max(10.0, float(settings.feishu_ws_open_timeout))
    try:
        _orig = websockets.connect
    except AttributeError:
        return

    async def _connect(uri, *args, **kwargs):
        kwargs.setdefault("open_timeout", timeout)
        # wss 走 asyncio SSL，默认握手仅 60s；跨境/代理下需与 open_timeout 一并加大
        if str(uri).lower().startswith("wss:"):
            kwargs.setdefault("ssl_handshake_timeout", timeout)
            if settings.feishu_ws_prefer_ipv4 and "host" not in kwargs:
                pu = urlparse(str(uri))
                h, p = pu.hostname, pu.port or 443
                if h and not _is_ipv4_literal(h):
                    ip = _resolve_wss_ipv4_target(h, p)
                    if ip:
                        kwargs["host"] = ip
                        kwargs.setdefault("server_hostname", h)
                        logger.info(
                            f"飞书 WSS 启用 IPv4 直连（缓解 WSL/IPv6 链路问题）: {h} -> {ip}，SNI={h}"
                        )
        return await _orig(uri, *args, **kwargs)

    websockets.connect = _connect  # type: ignore[method-assign]
    logger.info(
        f"已为飞书长连接设置 WebSocket open_timeout={timeout}s、"
        f"wss 下 ssl_handshake_timeout={timeout}s；"
        f"IPv4 优先={settings.feishu_ws_prefer_ipv4}（库默认 open≈10s、TLS 握手≈60s）"
    )


def _log_feishu_ws_endpoint_probe(app_id: str, app_secret: str) -> None:
    """
    与 lark-oapi WS Client 相同方式请求长连接 endpoint，便于在连接失败时看到飞书返回的 code/msg。
    常见：未在控制台启用「长连接」、未订阅事件、App Secret 错误。
    """
    import requests

    from lark_oapi.core.const import FEISHU_DOMAIN
    from lark_oapi.ws.const import GEN_ENDPOINT_URI

    url = f"{FEISHU_DOMAIN}{GEN_ENDPOINT_URI}"
    try:
        r = requests.post(
            url,
            headers={"locale": "zh"},
            json={"AppID": app_id, "AppSecret": app_secret},
            timeout=30,
        )
        logger.info(f"飞书长连接 endpoint 探测: HTTP {r.status_code} url={url}")
        try:
            body = r.json()
        except Exception:
            logger.warning(f"飞书长连接 endpoint 响应非 JSON，前 800 字符: {r.text[:800]!r}")
            return
        code = body.get("code")
        msg = body.get("msg")
        if code != 0:
            logger.error(
                f"飞书长连接 endpoint 业务错误: code={code} msg={msg!r}。"
                f"请确认：①开放平台「事件与回调」使用长连接方式且已订阅 im.message.receive_v1；"
                f"②应用已发布并通过管理员审批、已在租户内安装；③App ID / App Secret 与当前环境一致。"
            )
        else:
            logger.info("飞书长连接 endpoint 返回成功，SDK 将用返回的 URL 建立 WebSocket")
    except Exception as ex:
        logger.error(f"飞书长连接 endpoint 探测异常（网络/DNS/代理？）: {ex}", exc_info=True)


def _feishu_ws_thread_main() -> None:
    asyncio.set_event_loop(asyncio.new_event_loop())

    app_id = (settings.feishu_app_id or "").strip()
    app_secret = (settings.feishu_app_secret or "").strip()
    if not app_id or not app_secret:
        logger.error("飞书 WS 已启用但缺少 FEISHU_APP_ID / FEISHU_APP_SECRET")
        return

    if (settings.feishu_bot_open_id or "").strip():
        feishu_state.bot_open_id = settings.feishu_bot_open_id.strip()
    else:
        oid = feishu_fetch_bot_open_id_sync(app_id=app_id, app_secret=app_secret)
        if oid:
            feishu_state.bot_open_id = oid
            logger.info("飞书 WS 线程已预取机器人 open_id")
        else:
            logger.warning(
                "未缓存机器人 open_id：群聊 @ 校验可能宽松（任意 @ 即触发）。"
                "可在开放平台查看机器人信息并设置 FEISHU_BOT_OPEN_ID，或为应用申请 bot 信息相关权限。"
            )

    # 必须在设置线程 loop 之后再导入（SDK 绑定模块级 loop）
    _patch_websockets_open_timeout()

    from lark_oapi.core.enum import LogLevel
    from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
    import lark_oapi.ws.client as lark_ws_client
    from lark_oapi.ws.exception import ClientException

    def _patch_lark_ws_transport_state() -> None:
        """把 SDK 内部 WSS 建连/断开映射到 feishu_state，便于判断长连接是否真正成功。"""
        _orig_c = lark_ws_client.Client._connect
        _orig_d = lark_ws_client.Client._disconnect

        async def _connect_wrapped(self):
            feishu_state.ws_transport_touch_connect_attempt()
            try:
                await _orig_c(self)
            except BaseException as e:
                feishu_state.ws_transport_on_error(e)
                raise
            if self._conn is not None:
                feishu_state.ws_transport_on_connected()
                logger.info("飞书长连接：WSS 传输层已建立（可接收开放平台推送）")

        async def _disconnect_wrapped(self):
            try:
                await _orig_d(self)
            finally:
                feishu_state.ws_transport_on_disconnected()

        lark_ws_client.Client._connect = _connect_wrapped  # type: ignore[method-assign]
        lark_ws_client.Client._disconnect = _disconnect_wrapped  # type: ignore[method-assign]

    _patch_lark_ws_transport_state()

    def _patch_lark_ws_start_for_clear_errors() -> None:
        """SDK 对 TimeoutError 的 str 为空，补充可操作的提示（仍保持 WebSocket 长连接，非 Webhook）。"""
        _orig = lark_ws_client.Client.start

        def start_with_hints(self) -> None:
            try:
                lark_ws_client.loop.run_until_complete(self._connect())
            except ClientException as e:
                lark_ws_client.logger.error(self._fmt_log("connect failed, err: {}", e))
                raise e
            except Exception as e:
                hint = ""
                if isinstance(e, TimeoutError):
                    hint = (
                        f" [TimeoutError 无详情: 调大 FEISHU_WS_OPEN_TIMEOUT 当前={settings.feishu_ws_open_timeout}s；"
                        f"WSL 建议 FEISHU_WS_PREFER_IPV4=true；需代理时请配置 HTTPS_PROXY]"
                    )
                elif "SSL handshake" in str(e):
                    hint = " [TLS 握手过慢；已注入 ssl_handshake_timeout，可试 IPv4 优先或换网络]"
                try:
                    lark_ws_client.logger.error(self._fmt_log("connect failed, err: {}{}", e, hint))
                except Exception:
                    lark_ws_client.logger.error(self._fmt_log("connect failed, err: {}", e))
                lark_ws_client.loop.run_until_complete(self._disconnect())
                if self._auto_reconnect:
                    lark_ws_client.loop.run_until_complete(self._reconnect())
                else:
                    raise e

            lark_ws_client.loop.create_task(self._ping_loop())
            lark_ws_client.loop.run_until_complete(lark_ws_client._select())

        lark_ws_client.Client.start = start_with_hints  # type: ignore[method-assign]

    _patch_lark_ws_start_for_clear_errors()

    WSClient = lark_ws_client.Client

    enc = (settings.feishu_encrypt_key or "").strip()
    vtok = (settings.feishu_verification_token or "").strip()
    event_handler = (
        EventDispatcherHandler.builder(enc, vtok, LogLevel.WARNING)
        .register_p2_im_message_receive_v1(on_im_message_sync)
        .register_p2_im_message_message_read_v1(on_im_message_read_sync)
        .register_p2_card_action_trigger(on_card_action_sync)
        .build()
    )
    logger.info(
        "飞书事件：已注册 im.message.receive_v1、im.message.message_read_v1、"
        "card.action.trigger；请在开放平台为应用订阅「卡片回传交互」以启用面板按钮。"
    )

    _log_feishu_ws_endpoint_probe(app_id, app_secret)

    try:
        cli = WSClient(
            app_id,
            app_secret,
            log_level=LogLevel.WARNING,
            event_handler=event_handler,
        )
        logger.info("飞书长连接启动（阻塞于 SDK start）")
        cli.start()
    except Exception as e:
        try:
            from lark_oapi.ws.exception import ClientException, ServerException

            # 勿在函数内再 import asyncio，否则会把 asyncio 视为局部变量，导致函数开头 set_event_loop 报 UnboundLocalError
            if isinstance(e, TimeoutError):
                logger.error(
                    f"飞书 WebSocket 握手超时（当前 FEISHU_WS_OPEN_TIMEOUT={settings.feishu_ws_open_timeout}s）。"
                    f"默认 websockets 仅 10s，已自动加大；若仍失败请检查出网/防火墙/代理是否拦截 WSS。"
                )
            elif isinstance(e, (ClientException, ServerException)):
                logger.error(
                    f"飞书长连接失败: exception={type(e).__name__} code={getattr(e, 'code', None)!r} str={str(e)!r}"
                )
            else:
                logger.error(f"飞书长连接异常退出: {type(e).__name__}: {e!r}", exc_info=True)
        except Exception:
            logger.error(f"飞书长连接异常退出: {e}", exc_info=True)


def start_feishu_ws_thread() -> Optional[threading.Thread]:
    if not settings.feishu_ws_enabled:
        return None
    if not (settings.feishu_app_id or "").strip() or not (settings.feishu_app_secret or "").strip():
        logger.warning("FEISHU_WS_ENABLED=true 但未配置应用凭证，跳过飞书长连接")
        return None
    t = threading.Thread(target=_feishu_ws_thread_main, name="feishu-ws", daemon=True)
    feishu_state.ws_thread = t
    t.start()
    logger.info("飞书 WS 后台线程已启动")
    return t
