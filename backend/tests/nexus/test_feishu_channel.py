from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from nexus.bootstrap import NexusContainer
from nexus.infrastructure.feishu import (
    FeishuChannelService,
    FeishuMessage,
    FeishuResource,
    FeishuStateStore,
    extract_resource_spec,
    extract_text,
)
from nexus.infrastructure.feishu.worker import LarkHttpTransport


@dataclass
class FakeTransport:
    replies: list[tuple[str, str, bool]] = field(default_factory=list)

    def reply(self, message_id: str, text: str, *, in_thread: bool) -> None:
        self.replies.append((message_id, text, in_thread))

    def download_resource(
        self, message_id: str, resource: FeishuResource
    ) -> tuple[bytes, str, str]:
        return (
            b"# IM Upload\n\nFeishu files enter the normal Raw-first pipeline.",
            "im.md",
            "text/markdown",
        )


def test_feishu_parser_supports_text_post_and_all_ingestible_files() -> None:
    assert extract_text("text", '{"text":"@_user_1  hello  Nexus"}') == "hello Nexus"
    post = '{"zh_cn":{"content":[[{"tag":"text","text":"paragraph"}]]}}'
    assert extract_text("post", post) == "paragraph"
    assert extract_resource_spec(
        "file", '{"file_key":"file-v2","file_name":"brief.pdf"}'
    ) == ("file", "file-v2", ".pdf", "brief.pdf")


def test_feishu_transport_keeps_rich_card_presentation() -> None:
    calls: list[dict[str, Any]] = []

    class Response:
        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        def json() -> dict[str, int]:
            return {"code": 0}

    class Client:
        @staticmethod
        def post(path: str, **kwargs: Any) -> Response:
            calls.append({"path": path, **kwargs})
            return Response()

        @staticmethod
        def close() -> None:
            return None

    transport = LarkHttpTransport(app_id="app", app_secret="secret", reply_format="card")
    transport.client.close()
    transport.client = Client()  # type: ignore[assignment]
    transport._token = "tenant-token"
    transport._token_expires_at = 10**12
    transport.reply("message-1", "Answer\n\n- citation", in_thread=True)
    payload = calls[0]["json"]
    assert payload["msg_type"] == "interactive"
    assert json.loads(payload["content"])["elements"][0]["tag"] == "markdown"
    assert payload["reply_in_thread"] is True


def test_feishu_channel_uses_nexus_runs_scope_and_ingestion(nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Feishu Space", slug="feishu-space")
    nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="facts.md",
        content=b"# Fact\n\nProject Atlas launch allocation is 42 USD.",
        mime_type="text/markdown",
    )
    transport = FakeTransport()
    channel = FeishuChannelService(
        container=nexus,
        transport=transport,
        state=FeishuStateStore(None),
    )
    help_message = FeishuMessage(
        event_id="event-help",
        message_id="message-help",
        chat_id="chat-1",
        text="/help",
    )
    channel.handle(help_message)
    channel.handle(help_message)
    assert len(transport.replies) == 1
    assert "Nexus" in transport.replies[-1][1]

    channel.handle(
        FeishuMessage(
            event_id="event-question",
            message_id="message-question",
            chat_id="chat-1",
            text="What is the Project Atlas launch allocation?",
        )
    )
    assert "42 USD" in transport.replies[-1][1]
    assert "引用" in transport.replies[-1][1]

    channel.handle(
        FeishuMessage(
            event_id="event-file",
            message_id="message-file",
            chat_id="chat-1",
            resource=FeishuResource("file", "file-v2", ".md", "im.md"),
        )
    )
    assert "已接收入库" in transport.replies[-1][1]
    sources, _ = nexus.control_plane.list_sources(space_id=space.id, cursor=None, limit=20)
    assert {item.display_name for item in sources} == {"facts.md", "im.md"}
