import time

import pytest

from app.modules.generation.stream_manager import (
    StreamEvent,
    StreamEventType,
    StreamManager,
)


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
