import time
from types import SimpleNamespace

import pytest

from app.modules.generation.stream_manager import (
    StreamEvent,
    StreamEventType,
    StreamManager,
)
from app.modules.generation.context_builder import ReferenceMap


@pytest.mark.asyncio
async def test_stream_error_is_terminal_and_not_followed_by_done():
    manager = StreamManager()
    await manager.create_session("session-error")

    async def failing_generation(*_args, **_kwargs):
        yield StreamEvent(
            type=StreamEventType.ERROR,
            data={"error": "provider unavailable"},
            timestamp=time.time(),
        )

    manager._generate_streaming_response = failing_generation  # type: ignore[method-assign]

    events = [
        event
        async for event in manager.stream_chat_response(
            session_id="session-error",
            query="test",
            context_result=None,
            system_prompt="system",
            user_input="user",
            llm_manager=None,
        )
    ]

    assert [event.type for event in events] == [
        StreamEventType.CONNECTED,
        StreamEventType.ERROR,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_after_text", [False, True])
async def test_image_reference_arrives_before_generation_and_only_once(fail_after_text):
    manager = StreamManager()
    image = ReferenceMap(
        id="3", content_type="image", file_path="images/login.jpg",
        content="登录注册截图", metadata={"kb_id": "test-kb"},
        presigned_url="https://example.test/login.jpg",
    )
    started = False

    async def stream_chat(**_kwargs):
        nonlocal started
        started = True
        yield "注册账号，如图 [3] 所示。"
        if fail_after_text:
            raise RuntimeError("generation interrupted")

    events = manager._generate_streaming_response(
        session=None, query="如何注册？",
        context_result=SimpleNamespace(reference_map={"3": image}),
        system_prompt="system", user_input="user", model="test-model",
        llm_manager=SimpleNamespace(stream_chat=stream_chat),
    )
    first = await anext(events)
    assert first.type == StreamEventType.CITATION
    assert not started
    assert first.data["references"][0]["img_url"] == image.presigned_url
    assert first.data["references"][0]["debug_info"]["kb_id"] == "test-kb"
    rest = [event async for event in events]
    assert [event.type for event in rest] == (
        [StreamEventType.MESSAGE, StreamEventType.ERROR]
        if fail_after_text else [StreamEventType.MESSAGE]
    )
