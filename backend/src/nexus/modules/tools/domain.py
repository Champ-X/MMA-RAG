from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ToolView:
    id: str
    name: str
    version: str
    description: str
    input_schema: dict[str, object]
    output_schema: dict[str, object]
    risk_level: str
    requires_approval: bool
    idempotency: str
    enabled: bool


@dataclass(frozen=True, slots=True)
class ToolExecutionView:
    id: str
    run_id: str
    tool_definition_id: str
    status: str
    idempotency_key: str
    input_payload: dict[str, object]
    output_payload: dict[str, object] | None
    error: str | None
    created_at: datetime
    updated_at: datetime
