from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from nexus.shared.domain.enums import ClaimStatus


@dataclass(frozen=True, slots=True)
class ClaimView:
    id: str
    run_id: str | None
    text: str
    claim_type: str
    verification_level: str
    status: ClaimStatus
    explanation: str
    evidence_revision_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class KnowledgeEvidenceReferenceView:
    evidence_revision_id: str
    source_name: str
    modality: str
    evidence_type: str
    locator_type: str
    relation: str
    support_score: float


@dataclass(frozen=True, slots=True)
class SpaceKnowledgeClaimView:
    id: str
    run_id: str
    text: str
    claim_type: str
    verification_level: str
    status: ClaimStatus
    explanation: str
    evidence: tuple[KnowledgeEvidenceReferenceView, ...]
    created_at: datetime
