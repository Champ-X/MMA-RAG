"""对话相关能力（附件摘要与上下文管理，与知识库入库链路隔离）。"""

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .attachment_summarizer import ChatAttachmentSummarizer, summarize_chat_attachments
    from .context_manager import (
        ConversationContext,
        build_conversation_context,
        trim_stored_messages,
    )

__all__ = [
    "ChatAttachmentSummarizer",
    "ConversationContext",
    "build_conversation_context",
    "summarize_chat_attachments",
    "trim_stored_messages",
]

_EXPORTS = {
    "ChatAttachmentSummarizer": (".attachment_summarizer", "ChatAttachmentSummarizer"),
    "summarize_chat_attachments": (".attachment_summarizer", "summarize_chat_attachments"),
    "ConversationContext": (".context_manager", "ConversationContext"),
    "build_conversation_context": (".context_manager", "build_conversation_context"),
    "trim_stored_messages": (".context_manager", "trim_stored_messages"),
}


def __getattr__(name: str) -> Any:
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(target[0], __name__)
    value = getattr(module, target[1])
    globals()[name] = value
    return value
