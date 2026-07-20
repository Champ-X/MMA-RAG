from __future__ import annotations

from typing import Protocol

from nexus.modules.evidence.domain import EvidenceView


class EvidenceRepositoryPort(Protocol):
    def get_evidence(self, revision_id: str) -> EvidenceView: ...

    def list_evidence(
        self,
        *,
        space_id: str | None,
        source_id: str | None,
        modality: str | None,
        cursor: str | None,
        limit: int,
        query: str | None = None,
    ) -> tuple[list[EvidenceView], str | None]: ...

    def expand_evidence(
        self, revision_id: str, *, before: int, after: int
    ) -> list[EvidenceView]: ...

    def compare_source_versions(self, left_id: str, right_id: str) -> dict[str, object]: ...

    def hydrate_evidence(
        self,
        revision_ids: list[str],
        *,
        space_ids: tuple[str, ...],
        source_ids: tuple[str, ...],
        watermark: int | None,
    ) -> dict[str, EvidenceView]: ...

    def count_published_evidence(
        self,
        *,
        space_ids: tuple[str, ...],
        source_ids: tuple[str, ...],
        watermark: int | None,
    ) -> int: ...
