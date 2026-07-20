from __future__ import annotations

from dataclasses import dataclass

from nexus.modules.spaces.domain import SpacePolicy, SpaceView
from nexus.shared.domain.enums import (
    KnowledgeProfile,
    QualityMode,
    RunKind,
)


@dataclass(frozen=True, slots=True)
class _PolicyTemplate:
    label: str
    summary: str
    default_quality: QualityMode
    recommended_run_kind: RunKind
    auto_route_eligible: bool
    behaviors: tuple[str, ...]


_POLICIES: dict[KnowledgeProfile, _PolicyTemplate] = {
    KnowledgeProfile.SEARCHABLE: _PolicyTemplate(
        label="Balanced search",
        summary="Fast questions and evidence browsing across text and structured material.",
        default_quality=QualityMode.QUALITY,
        recommended_run_kind=RunKind.QUICK,
        auto_route_eligible=True,
        behaviors=("auto_route", "quality_retrieval", "quick_answer"),
    ),
    KnowledgeProfile.MULTIMODAL: _PolicyTemplate(
        label="Multimodal discovery",
        summary=(
            "Prioritize this Space when questions ask for figures, audio or video evidence."
        ),
        default_quality=QualityMode.QUALITY,
        recommended_run_kind=RunKind.QUICK,
        auto_route_eligible=True,
        behaviors=("media_intent_boost", "native_media_retrieval", "quality_retrieval"),
    ),
    KnowledgeProfile.RESEARCH: _PolicyTemplate(
        label="Deep research",
        summary=(
            "Default to planned, iterative research with stronger verification and Artifacts."
        ),
        default_quality=QualityMode.DEEP,
        recommended_run_kind=RunKind.RESEARCH,
        auto_route_eligible=True,
        behaviors=("research_intent_boost", "deep_retrieval", "artifact_delivery"),
    ),
    KnowledgeProfile.ARCHIVE: _PolicyTemplate(
        label="Reference archive",
        summary="Keep evidence available for explicit lookup without automatic routing.",
        default_quality=QualityMode.FAST,
        recommended_run_kind=RunKind.QUICK,
        auto_route_eligible=False,
        behaviors=("manual_scope_only", "fast_retrieval", "originals_preserved"),
    ),
}


def policy_for(
    profile: KnowledgeProfile,
    *,
    default_quality: QualityMode | None = None,
) -> SpacePolicy:
    template = _POLICIES[profile]
    return SpacePolicy(
        profile=profile,
        label=template.label,
        summary=template.summary,
        default_quality=default_quality or template.default_quality,
        recommended_run_kind=template.recommended_run_kind,
        auto_route_eligible=template.auto_route_eligible,
        behaviors=template.behaviors,
    )


def recommend_space_usage(spaces: list[SpaceView]) -> dict[str, object]:
    if not spaces:
        return {
            "recommended_kind": RunKind.QUICK.value,
            "recommended_quality": QualityMode.QUALITY.value,
            "reasons": [],
            "spaces": [],
        }
    recommended_kind = (
        RunKind.RESEARCH
        if any(space.policy.recommended_run_kind == RunKind.RESEARCH for space in spaces)
        else RunKind.QUICK
    )
    quality_order = {QualityMode.FAST: 0, QualityMode.QUALITY: 1, QualityMode.DEEP: 2}
    recommended_quality = max(
        (space.policy.default_quality for space in spaces),
        key=quality_order.__getitem__,
    )
    if recommended_kind == RunKind.RESEARCH:
        recommended_quality = QualityMode.DEEP
    return {
        "recommended_kind": recommended_kind.value,
        "recommended_quality": recommended_quality.value,
        "reasons": sorted(
            {
                behavior
                for space in spaces
                for behavior in space.policy.behaviors
                if behavior
                in {"media_intent_boost", "research_intent_boost", "manual_scope_only"}
            }
        ),
        "spaces": [
            {
                "space_id": space.id,
                "profile": space.knowledge_profile.value,
                "policy_label": space.policy.label,
                "default_quality": space.policy.default_quality.value,
                "recommended_kind": space.policy.recommended_run_kind.value,
                "auto_route_eligible": space.policy.auto_route_eligible,
            }
            for space in spaces
        ],
    }
