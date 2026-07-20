from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class ArtifactCoverageView:
    content_block_count: int
    supported_block_count: int
    coverage_percent: int
    bound_evidence_count: int
    user_block_count: int


@dataclass(frozen=True, slots=True)
class ArtifactTemplateView:
    id: str
    name: str
    description: str
    artifact_type: str
    audience: str
    review_prompt: str | None = None


ARTIFACT_TEMPLATES = (
    ArtifactTemplateView(
        id="evidence_brief",
        name="Evidence brief",
        description="A compact, source-led report with the complete Evidence register.",
        artifact_type="evidence_brief",
        audience="Researchers and reviewers",
    ),
    ArtifactTemplateView(
        id="decision_memo",
        name="Decision memo",
        description="Evidence-backed findings followed by an explicit decision and owner check.",
        artifact_type="decision_memo",
        audience="Decision makers",
        review_prompt="Add the decision, owner, and review date before publishing.",
    ),
    ArtifactTemplateView(
        id="review_packet",
        name="Review packet",
        description="Preserves the full record and adds a visible reviewer-notes section.",
        artifact_type="review_packet",
        audience="Governance and audit",
        review_prompt="Add reviewer notes, unresolved questions, and sign-off before publishing.",
    ),
)


def get_artifact_template(template_id: str) -> ArtifactTemplateView | None:
    return next((item for item in ARTIFACT_TEMPLATES if item.id == template_id), None)


def apply_artifact_template(
    template: ArtifactTemplateView,
    *,
    source_artifact_id: str,
    source_document: dict[str, object],
    title: str,
    review_text: str | None = None,
) -> dict[str, object]:
    """Reframe existing blocks without generating or rebinding evidence."""
    source_blocks = [item for item in source_document.get("blocks", []) if isinstance(item, dict)]
    content_blocks: list[dict[str, Any]] = [
        dict(item)
        for item in source_blocks
        if item.get("type") in {"paragraph", "table"}
    ]
    evidence_blocks: list[dict[str, Any]] = [
        dict(item) for item in source_blocks if item.get("type") == "evidence_list"
    ]
    if template.id == "evidence_brief":
        body = [dict(item) for item in source_blocks if item.get("type") != "heading"]
    else:
        section_title = (
            "Evidence-backed findings" if template.id == "decision_memo" else "Current record"
        )
        review_title = "Decision and owner" if template.id == "decision_memo" else "Reviewer notes"
        body = [
            {"type": "heading", "level": 2, "text": section_title, "origin": "generated"},
            *content_blocks,
            {"type": "heading", "level": 2, "text": review_title, "origin": "generated"},
            {
                "type": "paragraph",
                "text": review_text,
                "origin": "user",
            },
            *evidence_blocks,
        ]
    return {
        "schema": "nexus.block-document.v1",
        "title": title,
        "template": {
            "id": template.id,
            "version": 1,
            "source_artifact_id": source_artifact_id,
        },
        "blocks": [
            {"type": "heading", "level": 1, "text": title, "origin": "generated"},
            *body,
        ],
    }


def summarize_artifact_coverage(
    document: dict[str, object], evidence_revision_ids: tuple[str, ...] | list[str]
) -> ArtifactCoverageView:
    blocks = [item for item in document.get("blocks", []) if isinstance(item, dict)]
    content_blocks = [item for item in blocks if item.get("type") in {"paragraph", "table"}]
    supported_blocks = [
        item
        for item in content_blocks
        if isinstance(item.get("evidence_revision_ids"), list)
        and any(str(value).strip() for value in item["evidence_revision_ids"])
    ]
    bound_ids = {
        str(value)
        for item in supported_blocks
        for value in item.get("evidence_revision_ids", [])
        if str(value).strip()
    }
    authoritative_ids = {str(value) for value in evidence_revision_ids}
    coverage_percent = (
        round(len(supported_blocks) / len(content_blocks) * 100) if content_blocks else 0
    )
    return ArtifactCoverageView(
        content_block_count=len(content_blocks),
        supported_block_count=len(supported_blocks),
        coverage_percent=coverage_percent,
        bound_evidence_count=len(bound_ids.intersection(authoritative_ids)),
        user_block_count=sum(1 for item in blocks if item.get("origin") == "user"),
    )


@dataclass(frozen=True, slots=True)
class ArtifactView:
    id: str
    run_id: str | None
    title: str
    artifact_type: str
    status: str
    revision_id: str
    revision_no: int
    canonical_document: dict[str, object]
    evidence_revision_ids: tuple[str, ...]
    coverage: ArtifactCoverageView
    pending_refresh_count: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ArtifactRefreshProposalView:
    id: str
    artifact_id: str
    base_revision_id: str
    status: str
    reason: str
    impacted_evidence_revision_ids: tuple[str, ...]
    proposed_document: dict[str, object]
    proposed_evidence_revision_ids: tuple[str, ...]
    diff: dict[str, object]
    created_at: datetime
    resolved_at: datetime | None
