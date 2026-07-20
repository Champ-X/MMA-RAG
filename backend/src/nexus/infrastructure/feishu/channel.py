from __future__ import annotations

import mimetypes
import threading
import time
from dataclasses import dataclass
from typing import Protocol

from redis import Redis

from nexus.bootstrap.container import NexusContainer
from nexus.modules.retrieval.domain import ScopeCapsule
from nexus.shared.domain.enums import QualityMode, RunKind


@dataclass(frozen=True, slots=True)
class FeishuResource:
    resource_type: str
    resource_key: str
    suffix: str
    filename: str | None = None


@dataclass(frozen=True, slots=True)
class FeishuMessage:
    event_id: str
    message_id: str
    chat_id: str
    text: str | None = None
    resource: FeishuResource | None = None
    is_group: bool = False
    mentioned: bool = False
    sender_is_bot: bool = False


class FeishuTransportPort(Protocol):
    def reply(self, message_id: str, text: str, *, in_thread: bool) -> None: ...

    def download_resource(
        self, message_id: str, resource: FeishuResource
    ) -> tuple[bytes, str, str]: ...


class FeishuStateStore:
    """Redis is coordination only; Nexus Runs and Sources remain PostgreSQL authority."""

    def __init__(self, redis_url: str | None) -> None:
        self._memory: dict[str, str] = {}
        self._lock = threading.Lock()
        self._redis_lock = threading.Lock()
        self._redis_url = redis_url
        self.redis: Redis | None = None
        self._redis_client()

    def _redis_client(self) -> Redis | None:
        if self.redis is not None:
            return self.redis
        if not self._redis_url:
            return None
        with self._redis_lock:
            if self.redis is not None:
                return self.redis
            try:
                client = Redis.from_url(self._redis_url, decode_responses=True)
                client.ping()
                self.redis = client
            except Exception:
                self.redis = None
        return self.redis

    def _drop_redis(self, client: Redis) -> None:
        with self._redis_lock:
            if self.redis is client:
                self.redis = None

    def deduplicate(self, event_id: str, ttl_seconds: int = 86_400) -> bool:
        key = f"nexus:feishu:event:{event_id}"
        with self._lock:
            if key in self._memory:
                return False
            self._memory[key] = "1"
        client = self._redis_client()
        if client is not None:
            try:
                return bool(client.set(key, "1", nx=True, ex=ttl_seconds))
            except Exception:
                self._drop_redis(client)
        return True

    def get_space(self, chat_id: str) -> str | None:
        key = f"nexus:feishu:chat:{chat_id}:space"
        client = self._redis_client()
        if client is not None:
            try:
                value = client.get(key)
                return str(value) if value else None
            except Exception:
                self._drop_redis(client)
        return self._memory.get(key)

    def set_space(self, chat_id: str, space_id: str) -> None:
        key = f"nexus:feishu:chat:{chat_id}:space"
        with self._lock:
            self._memory[key] = space_id
        client = self._redis_client()
        if client is not None:
            try:
                client.set(key, space_id)
            except Exception:
                self._drop_redis(client)

    def heartbeat(self, *, status: str = "ready") -> None:
        payload = f"{status}:{int(time.time())}"
        key = "nexus:feishu:worker:heartbeat"
        with self._lock:
            self._memory[key] = payload
        client = self._redis_client()
        if client is not None:
            try:
                client.set(key, payload, ex=90)
            except Exception:
                self._drop_redis(client)

    def health(self) -> dict[str, object]:
        key = "nexus:feishu:worker:heartbeat"
        client = self._redis_client()
        raw = None
        if client is not None:
            try:
                raw = client.get(key)
            except Exception:
                self._drop_redis(client)
        if raw is None:
            with self._lock:
                raw = self._memory.get(key)
        if not raw:
            return {"status": "unavailable", "worker_heartbeat": False}
        status, _, timestamp = str(raw).partition(":")
        age = max(0, int(time.time()) - int(timestamp or "0"))
        return {
            "status": "ready" if status == "ready" and age <= 90 else "degraded",
            "worker_heartbeat": True,
            "heartbeat_age_seconds": age,
        }


class FeishuChannelService:
    def __init__(
        self,
        *,
        container: NexusContainer,
        transport: FeishuTransportPort,
        state: FeishuStateStore,
    ) -> None:
        self.container = container
        self.transport = transport
        self.state = state

    def handle(self, message: FeishuMessage) -> None:
        if message.sender_is_bot or not message.message_id or not message.chat_id:
            return
        if message.is_group and not message.mentioned:
            return
        event_key = message.event_id or message.message_id
        if not self.state.deduplicate(event_key):
            return
        self.state.heartbeat()
        try:
            if message.resource is not None:
                self._handle_resource(message)
            elif message.text:
                self._handle_text(message)
            else:
                self._reply(message, "请发送文字、图片、音频、视频或文档。")
        except Exception as exc:
            self._reply(message, f"处理失败（{type(exc).__name__}）。任务未静默降级，请稍后重试。")

    def _handle_text(self, message: FeishuMessage) -> None:
        text = (message.text or "").strip()
        lowered = text.casefold()
        if lowered in {"/help", "帮助", "help"}:
            self._reply(
                message,
                "MMA-RAG Nexus 飞书渠道\n"
                "• /spaces：列出知识空间\n"
                "• /space <名称、slug 或 ID>：设置当前会话范围\n"
                "• 直接提问：Quick Answer\n"
                "• /research <目标>：Deep Research\n"
                "• 发送文件：摄取到当前 Space",
            )
            return
        if lowered in {
            "/spaces",
            "/space",
            "/kb",
            "/menu",
            "/菜单",
            "/panel",
            "/面板",
            "知识空间",
        }:
            self._reply(message, self._space_listing())
            return
        if lowered.startswith("/space "):
            token = text.split(maxsplit=1)[1].strip()
            space_id = self._resolve_space_token(token)
            if space_id is None:
                self._reply(message, f"未找到唯一匹配的 Space：{token}\n{self._space_listing()}")
                return
            self.state.set_space(message.chat_id, space_id)
            space = self.container.spaces.get(space_id)
            self._reply(message, f"当前会话已绑定 Space：{space.name}（{space.slug}）")
            return
        kind = RunKind.QUICK
        goal = text
        if lowered.startswith("/research "):
            kind = RunKind.RESEARCH
            goal = text.split(maxsplit=1)[1].strip()
        space_id = self._selected_space(message.chat_id)
        if space_id is None:
            self._reply(message, "尚未选择 Space。\n" + self._space_listing())
            return
        space = self.container.spaces.get(space_id)
        run = self.container.run_service.create(
            goal=goal,
            kind=kind,
            scope=ScopeCapsule(space_ids=(space_id,)),
            quality_mode=(QualityMode.DEEP if kind == RunKind.RESEARCH else space.default_quality),
            idempotency_key=f"feishu:{message.event_id or message.message_id}",
            execute=True,
            scope_policy=self.container.spaces.usage_recommendation((space_id,)),
        )
        deadline = time.monotonic() + self.container.settings.feishu_run_timeout_seconds
        while run.status.value not in {"completed", "partial", "failed", "cancelled", "paused"}:
            if time.monotonic() >= deadline:
                self._reply(message, f"任务已创建并在后台继续执行：{run.id}")
                return
            time.sleep(0.5)
            run = self.container.run_service.get(run.id)
        result = run.result or {}
        answer = str(result.get("answer") or f"任务状态：{run.status.value}")
        citations = result.get("citations")
        citation_lines: list[str] = []
        if isinstance(citations, list):
            for item in citations[:6]:
                if not isinstance(item, dict):
                    continue
                source = item.get("source_name") or item.get("source") or "Evidence"
                evidence_id = str(item.get("evidence_revision_id") or "")
                citation_lines.append(f"- {source} · {evidence_id[:12]}")
        suffix = "\n\n引用：\n" + "\n".join(citation_lines) if citation_lines else ""
        self._reply(message, (answer + suffix)[:18_000])

    def _handle_resource(self, message: FeishuMessage) -> None:
        space_id = self._selected_space(message.chat_id)
        if space_id is None:
            self._reply(message, "请先使用 /space <名称或 ID> 选择文件入库范围。")
            return
        assert message.resource is not None
        content, downloaded_name, content_type = self.transport.download_resource(
            message.message_id, message.resource
        )
        filename = (
            message.resource.filename
            or downloaded_name
            or f"feishu-{message.resource.resource_key}{message.resource.suffix}"
        )
        mime = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        result = self.container.ingestion.ingest_bytes(
            space_id=space_id,
            filename=filename,
            content=content,
            mime_type=mime,
            idempotency_key=f"feishu-resource:{message.event_id or message.message_id}",
            process_inline=self.container.settings.inline_worker,
        )
        self._reply(
            message,
            f"已接收入库：{filename}\nJob：{result.job.id}\n状态：{result.job.status}",
        )

    def _selected_space(self, chat_id: str) -> str | None:
        selected = self.state.get_space(chat_id)
        if selected:
            try:
                return self.container.spaces.get(selected).id
            except Exception:
                pass
        configured = self.container.settings.feishu_default_space_ids
        valid: list[str] = []
        for token in configured:
            match = self._resolve_space_token(token)
            if match:
                valid.append(match)
        if len(valid) == 1:
            self.state.set_space(chat_id, valid[0])
            return valid[0]
        spaces, _ = self.container.spaces.list(limit=2)
        if len(spaces) == 1:
            self.state.set_space(chat_id, spaces[0].id)
            return spaces[0].id
        return None

    def _resolve_space_token(self, token: str) -> str | None:
        try:
            return self.container.spaces.get(token).id
        except Exception:
            pass
        spaces, _ = self.container.spaces.list(limit=200)
        lowered = token.casefold()
        matches = [
            item
            for item in spaces
            if item.slug.casefold() == lowered or item.name.casefold() == lowered
        ]
        return matches[0].id if len(matches) == 1 else None

    def _space_listing(self) -> str:
        spaces, next_cursor = self.container.spaces.list(limit=50)
        if not spaces:
            return "当前没有可用 Space，请先在 Web 工作台创建。"
        lines = ["可用 Space："]
        lines.extend(f"- {item.name} · {item.slug} · {item.id}" for item in spaces)
        if next_cursor:
            lines.append("（仅显示前 50 项）")
        lines.append("使用 /space <名称、slug 或 ID> 选择。")
        return "\n".join(lines)

    def _reply(self, message: FeishuMessage, text: str) -> None:
        self.transport.reply(
            message.message_id,
            text,
            in_thread=self.container.settings.feishu_reply_in_thread,
        )
