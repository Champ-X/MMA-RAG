from __future__ import annotations

from dataclasses import dataclass

from nexus.runtime.nexus.harness import NexusHarness


@dataclass
class _Evidence:
    id: str
    source_id: str
    text_content: str


@dataclass
class _Hit:
    evidence: _Evidence


def test_t3_numeric_gate_detects_cross_source_conflict() -> None:
    hits = [
        _Hit(_Evidence("evidence-a", "source-a", "The approved pilot size is 42")),
        _Hit(_Evidence("evidence-b", "source-b", "The approved pilot size is 43")),
    ]
    result = NexusHarness._verify_claim("The approved pilot size is 42", hits, minimum_level="T1")
    assert result["level"] == "T3"
    assert result["status"] == "conflicted"
    assert result["conflicts"]


def test_t3_numeric_gate_rejects_uncited_generated_number() -> None:
    hits = [_Hit(_Evidence("evidence-a", "source-a", "The approved budget is 40"))]
    result = NexusHarness._verify_claim("The approved budget is 99", hits, minimum_level="T2")
    assert result["level"] == "T3"
    assert result["status"] == "partially_supported"
    assert result["missing_numbers"] == ["99"]
