from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from nexus.bootstrap.container import NexusContainer
from nexus.infrastructure.feishu.channel import (
    FeishuChannelService,
    FeishuMessage,
    FeishuResource,
    FeishuStateStore,
)
from nexus.infrastructure.feishu.parser import extract_resource_spec, extract_text
from nexus.shared.domain.errors import CapabilityUnavailableError

logger = logging.getLogger(__name__)


class LarkHttpTransport:
    """Small official-API transport; WS delivery remains handled by lark-oapi."""

    def __init__(self, *, app_id: str, app_secret: str, reply_format: str = "card") -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.reply_format = reply_format
        self.client = httpx.Client(
            base_url="https://open.feishu.cn",
            timeout=60,
            follow_redirects=True,
        )
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = threading.Lock()

    def close(self) -> None:
        self.client.close()

    def probe_auth(self) -> None:
        """Verify credentials without sending a message or mutating Feishu state."""
        self._tenant_token()

    def _tenant_token(self) -> str:
        with self._token_lock:
            if self._token and time.monotonic() < self._token_expires_at - 60:
                return self._token
            response = self.client.post(
                "/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self.app_id, "app_secret": self.app_secret},
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("code") != 0 or not payload.get("tenant_access_token"):
                raise CapabilityUnavailableError(
                    "Feishu tenant token request failed",
                    details={"code": payload.get("code"), "message": payload.get("msg")},
                )
            self._token = str(payload["tenant_access_token"])
            self._token_expires_at = time.monotonic() + int(payload.get("expire") or 7200)
            return self._token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._tenant_token()}"}

    def reply(self, message_id: str, text: str, *, in_thread: bool) -> None:
        if self.reply_format == "card":
            message_type = "interactive"
            content = {
                "config": {"wide_screen_mode": True},
                "header": {
                    "template": "blue",
                    "title": {"tag": "plain_text", "content": "MMA-RAG Nexus"},
                },
                "elements": [{"tag": "markdown", "content": text[:18_000]}],
            }
        else:
            message_type = "text"
            content = {"text": text}
        response = self.client.post(
            f"/open-apis/im/v1/messages/{message_id}/reply",
            headers=self._headers(),
            json={
                "msg_type": message_type,
                "content": json.dumps(content, ensure_ascii=False),
                "reply_in_thread": in_thread,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise CapabilityUnavailableError(
                "Feishu message reply failed",
                details={"code": payload.get("code"), "message": payload.get("msg")},
            )

    def download_resource(
        self, message_id: str, resource: FeishuResource
    ) -> tuple[bytes, str, str]:
        response = self.client.get(
            (
                f"/open-apis/im/v1/messages/{message_id}/resources/"
                f"{resource.resource_key}"
            ),
            headers=self._headers(),
            params={"type": resource.resource_type},
        )
        response.raise_for_status()
        disposition = response.headers.get("content-disposition", "")
        match = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\';]+)', disposition, re.I)
        filename = resource.filename or (match.group(1) if match else "")
        if not filename:
            filename = f"feishu-{resource.resource_key}{resource.suffix}"
        return response.content, filename, response.headers.get("content-type", "")


def run_feishu_worker(container: NexusContainer) -> dict[str, object]:
    settings = container.settings
    if not settings.feishu_enabled:
        logger.info("Feishu worker is disabled by configuration")
        while True:
            time.sleep(3600)
    app_id = (settings.feishu_app_id or "").strip()
    secret = settings.feishu_app_secret.get_secret_value() if settings.feishu_app_secret else ""
    if not app_id or not secret:
        raise CapabilityUnavailableError(
            "Feishu channel is enabled but FEISHU_APP_ID/FEISHU_APP_SECRET is missing"
        )

    state = FeishuStateStore(settings.redis_url)
    transport = LarkHttpTransport(
        app_id=app_id,
        app_secret=secret,
        reply_format=settings.feishu_reply_format,
    )
    # A ready heartbeat means the worker has authenticated, not merely that the
    # process reached its entrypoint. This keeps health probes honest when
    # credentials are revoked or misconfigured.
    transport.probe_auth()
    channel = FeishuChannelService(container=container, transport=transport, state=state)
    executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="nexus-feishu")
    stopped = threading.Event()

    def heartbeat() -> None:
        while not stopped.wait(30):
            state.heartbeat()

    heartbeat_thread = threading.Thread(target=heartbeat, name="feishu-heartbeat", daemon=True)
    heartbeat_thread.start()
    state.heartbeat()

    # lark-oapi binds an asyncio loop while importing its WS module.
    asyncio.set_event_loop(asyncio.new_event_loop())
    from lark_oapi.core.enum import LogLevel
    from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
    from lark_oapi.ws.client import Client as WSClient

    def on_message(data: Any) -> None:
        header = getattr(data, "header", None)
        event = getattr(data, "event", None)
        message = getattr(event, "message", None) if event else None
        sender = getattr(event, "sender", None) if event else None
        if message is None:
            return
        message_type = str(getattr(message, "message_type", "") or "")
        content = str(getattr(message, "content", "") or "")
        spec = extract_resource_spec(message_type, content)
        resource = FeishuResource(*spec) if spec else None
        sender_type = str(getattr(sender, "sender_type", "") or "").lower()
        mentions = getattr(message, "mentions", None)
        envelope = FeishuMessage(
            event_id=str(getattr(header, "event_id", "") or ""),
            message_id=str(getattr(message, "message_id", "") or ""),
            chat_id=str(getattr(message, "chat_id", "") or ""),
            text=extract_text(message_type, content),
            resource=resource,
            is_group=str(getattr(message, "chat_type", "") or "").lower() != "p2p",
            mentioned=bool(mentions),
            sender_is_bot=sender_type == "app",
        )
        executor.submit(channel.handle, envelope)

    encrypt_key = (
        settings.feishu_encrypt_key.get_secret_value() if settings.feishu_encrypt_key else ""
    )
    verification_token = (
        settings.feishu_verification_token.get_secret_value()
        if settings.feishu_verification_token
        else ""
    )
    handler = (
        EventDispatcherHandler.builder(encrypt_key, verification_token, LogLevel.WARNING)
        .register_p2_im_message_receive_v1(on_message)
        .build()
    )
    client = WSClient(
        app_id,
        secret,
        log_level=LogLevel.WARNING,
        event_handler=handler,
    )
    logger.info("Feishu long-connection worker started")
    try:
        client.start()
    finally:
        stopped.set()
        executor.shutdown(wait=True, cancel_futures=False)
        transport.close()
    return {"status": "stopped"}
