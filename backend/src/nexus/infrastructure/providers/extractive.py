from __future__ import annotations

import re

from nexus.modules.models.domain import (
    ModelRequirement,
    ModelResponse,
    SynthesisRequest,
    TaskRequest,
)
from nexus.shared.domain.errors import CapabilityUnavailableError


def _plain_excerpt(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"(?m)^\s{0,3}(?:#{1,6}|>|[-*+])\s+", "", text)
    text = re.sub(r"!\[([^]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[`*_~]", "", text)
    return " ".join(text.split())


class ExtractiveModelGateway:
    """Deterministic, offline synthesis used for setup smoke and failure-safe partial output.

    It never advertises itself as an LLM and only restates supplied evidence.
    """

    def synthesize(self, request: SynthesisRequest, requirement: ModelRequirement) -> ModelResponse:
        if not request.evidence:
            return ModelResponse(
                text="当前范围内没有足够证据支持可靠回答。",
                actual_model="extractive-local-v1",
                metadata={"mode": "extractive", "citations": []},
            )
        lines: list[str] = []
        citation_ids: list[str] = []
        for item in request.evidence[:12]:
            revision_id = str(item["evidence_revision_id"])
            citation_ids.append(revision_id)
            text = _plain_excerpt(item.get("text", ""))
            if len(text) > 500:
                text = text[:497] + "..."
            source = str(item.get("source_name") or "unknown source")
            lines.append(f"- {text} [evidence:{revision_id}]（{source}）")
        heading = "研究证据摘要" if request.artifact else "基于当前证据"
        return ModelResponse(
            text=f"{heading}：\n\n" + "\n".join(lines),
            actual_model="extractive-local-v1",
            finish_reason="stop",
            metadata={
                "mode": "extractive",
                "citations": citation_ids,
                "degraded": True,
                "degradation_reason": "no_enabled_generation_model",
            },
        )

    def complete(self, request: TaskRequest, requirement: ModelRequirement) -> ModelResponse:
        raise CapabilityUnavailableError(
            "A configured language model is required for semantic task completion",
            details={"role": requirement.role},
        )

    def snapshot(self) -> dict[str, object]:
        return {
            "gateway": "extractive-local-v1",
            "capabilities": ["evidence_bound_text"],
            "generation_model_enabled": False,
        }

    def health(self) -> dict[str, object]:
        return {
            "status": "degraded",
            "reason": "No enabled provider route; extractive synthesis is active",
        }
