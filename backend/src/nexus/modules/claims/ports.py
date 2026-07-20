from __future__ import annotations

from typing import Protocol

from nexus.modules.claims.domain import ClaimView, SpaceKnowledgeClaimView


class ClaimRepositoryPort(Protocol):
    def create_claim(
        self,
        *,
        run_id: str,
        text: str,
        claim_type: str,
        verification_level: str,
        status: str,
        explanation: str,
        evidence_links: list[dict[str, object]],
    ) -> ClaimView: ...

    def list_claims(self, run_id: str) -> list[ClaimView]: ...

    def list_space_knowledge_claims(
        self,
        space_id: str,
        *,
        status_filter: str,
        cursor: str | None,
        limit: int,
    ) -> tuple[list[SpaceKnowledgeClaimView], str | None]: ...
