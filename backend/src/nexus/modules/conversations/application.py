from __future__ import annotations

from nexus.modules.conversations.domain import ConversationView
from nexus.modules.conversations.ports import ConversationRepositoryPort
from nexus.shared.domain.errors import ValidationError


class ConversationService:
    def __init__(self, repository: ConversationRepositoryPort) -> None:
        self.repository = repository

    def get(self, conversation_id: str) -> ConversationView:
        return self.repository.get_conversation(conversation_id)

    def list(
        self,
        *,
        query: str | None,
        archived: bool,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[ConversationView], str | None]:
        normalized = query.strip() if query else None
        return self.repository.list_conversations(
            query=normalized or None,
            archived=archived,
            cursor=cursor,
            limit=limit,
        )

    def update(
        self,
        conversation_id: str,
        *,
        expected_revision: int,
        title: str | None,
        pinned: bool | None,
        archived: bool | None,
    ) -> ConversationView:
        normalized_title = title.strip() if title is not None else None
        if normalized_title is not None and not normalized_title:
            raise ValidationError("Conversation title cannot be empty")
        if normalized_title is not None and len(normalized_title) > 160:
            raise ValidationError("Conversation title cannot exceed 160 characters")
        if normalized_title is None and pinned is None and archived is None:
            raise ValidationError("At least one conversation field must be changed")
        return self.repository.update_conversation(
            conversation_id,
            expected_revision=expected_revision,
            title=normalized_title,
            pinned=pinned,
            archived=archived,
        )
