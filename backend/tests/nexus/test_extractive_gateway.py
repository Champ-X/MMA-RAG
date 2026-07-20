from __future__ import annotations

from nexus.infrastructure.providers.extractive import ExtractiveModelGateway
from nexus.modules.models.domain import ModelRequirement, SynthesisRequest


def test_extractive_fallback_renders_evidence_as_compact_plain_text() -> None:
    gateway = ExtractiveModelGateway()
    response = gateway.synthesize(
        SynthesisRequest(
            goal="Summarize Atlas",
            evidence=(
                {
                    "evidence_revision_id": "evidence-1",
                    "source_name": "atlas.md",
                    "text": "# Atlas Capacity\n\n**42 seats** with [approval](https://example.test).",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(role="quick_synthesis", required_capabilities=("text",)),
    )

    assert "# Atlas" not in response.text
    assert "**" not in response.text
    assert "](https://" not in response.text
    assert "Atlas Capacity 42 seats with approval." in response.text
    assert "[evidence:evidence-1]" in response.text
