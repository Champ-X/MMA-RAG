from __future__ import annotations

from dataclasses import asdict
from typing import Any

from nexus.modules.evidence.domain import EvidenceView


def serialize(value: object) -> dict[str, Any]:
    return asdict(value)  # type: ignore[arg-type]


def evidence_payload(value: EvidenceView) -> dict[str, Any]:
    payload = asdict(value)
    payload["quality_flags"] = list(value.quality_flags)
    payload["asset_url"] = f"/api/v1/evidence/{value.id}/asset"
    return payload
