from __future__ import annotations

from typing import Protocol

from nexus.modules.conversations.domain import ConversationView


class ConversationRepositoryPort(Protocol):
    def get_conversation(self, conversation_id: str) -> ConversationView: ...

    def list_conversations(
        self,
        *,
        query: str | None,
        archived: bool,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[ConversationView], str | None]: ...

    def update_conversation(
        self,
        conversation_id: str,
        *,
        expected_revision: int,
        title: str | None,
        pinned: bool | None,
        archived: bool | None,
    ) -> ConversationView: ...
