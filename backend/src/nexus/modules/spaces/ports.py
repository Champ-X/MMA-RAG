from __future__ import annotations

from typing import Protocol

from nexus.modules.spaces.domain import CollectionView, SpaceView
from nexus.shared.domain.enums import KnowledgeProfile, QualityMode


class SpaceRepositoryPort(Protocol):
    def create_space(
        self,
        *,
        name: str,
        slug: str,
        description: str,
        knowledge_profile: KnowledgeProfile,
        default_quality: QualityMode,
        idempotency_key: str | None,
    ) -> SpaceView: ...

    def list_spaces(
        self, *, cursor: str | None, limit: int
    ) -> tuple[list[SpaceView], str | None]: ...

    def get_space(self, space_id: str) -> SpaceView: ...

    def archive_space(self, space_id: str) -> SpaceView: ...

    def create_collection(
        self,
        *,
        space_id: str,
        name: str,
        description: str,
        color: str,
        view_kind: str,
        rule_logic: str,
        source_ids: tuple[str, ...],
        rules: tuple[dict[str, object], ...],
    ) -> CollectionView: ...

    def list_collections(self, *, space_id: str) -> list[CollectionView]: ...

    def get_collection(self, collection_id: str) -> CollectionView: ...

    def update_collection(
        self,
        collection_id: str,
        *,
        name: str | None,
        description: str | None,
        color: str | None,
        rule_logic: str | None,
        source_ids: tuple[str, ...] | None,
        rules: tuple[dict[str, object], ...] | None,
        expected_revision: int | None,
    ) -> CollectionView: ...

    def archive_collection(self, collection_id: str) -> CollectionView: ...

    def resolve_collection_source_ids(self, collection_ids: tuple[str, ...]) -> tuple[str, ...]: ...
