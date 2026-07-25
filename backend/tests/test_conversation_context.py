from app.modules.chat.context_manager import (
    build_conversation_context,
    trim_stored_messages,
)


def test_context_keeps_recent_complete_turns_within_budget():
    messages = [
        {"role": "user", "content": "第一轮问题"},
        {"role": "assistant", "content": "第一轮回答"},
        {"role": "user", "content": "第二轮问题"},
        {"role": "assistant", "content": "第二轮回答"},
        {"role": "user", "content": "第三轮问题"},
        {"role": "assistant", "content": "第三轮回答"},
    ]

    context = build_conversation_context(
        messages,
        max_messages=4,
        max_chars=200,
        max_message_chars=100,
    )

    assert [message["content"] for message in context.messages] == [
        "第二轮问题",
        "第二轮回答",
        "第三轮问题",
        "第三轮回答",
    ]
    assert context.omitted_messages == 2
    assert "第一轮" not in context.transcript


def test_oversized_latest_turn_preserves_both_roles():
    context = build_conversation_context(
        [
            {"role": "user", "content": "用户问题" * 100},
            {"role": "assistant", "content": "助手回答" * 100},
        ],
        max_messages=2,
        max_chars=180,
        max_message_chars=1000,
    )

    assert [message["role"] for message in context.messages] == ["user", "assistant"]
    assert context.total_chars <= 180
    assert all("…" in message["content"] for message in context.messages)


def test_trim_stored_messages_does_not_leave_orphan_assistant():
    messages = [
        {"role": "user", "content": "旧问题"},
        {"role": "assistant", "content": "旧回答"},
        {"role": "user", "content": "新问题"},
        {"role": "assistant", "content": "新回答"},
    ]

    trimmed = trim_stored_messages(messages, max_messages=3, max_chars=100)

    assert [message["role"] for message in trimmed] == ["user", "assistant"]
    assert trimmed[0]["content"] == "新问题"
