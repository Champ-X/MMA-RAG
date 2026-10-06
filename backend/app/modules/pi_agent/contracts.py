"""Versioned host contracts. The model never supplies identity or run budgets."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 1
TERMINAL_STATUSES = frozenset({"completed", "partial", "needs_input", "cancelled", "failed"})
RunStatus = Literal["queued", "running", "cancelling", "completed", "partial", "needs_input", "cancelled", "failed"]
Modality = Literal["doc", "image", "audio", "video"]


class SourceFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kb_id: str = Field(min_length=1, max_length=200)
    file_id: str = Field(min_length=1, max_length=1000)
    name: str = Field(default="", max_length=1000)
    type: str = Field(default="", max_length=100)
    kb_name: str = Field(default="", max_length=300)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol_version: Literal[1] = 1
    client_request_id: str = Field(min_length=8, max_length=100)
    session_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=40000)
    model: str | None = Field(default=None, max_length=200)
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=100)
    selected_files: list[SourceFile] = Field(default_factory=list, max_length=100)
    reference_files: list[SourceFile] = Field(default_factory=list, max_length=100)
    mentions: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=24)
    parent_run_id: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=3)


class RunBudget(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    wall_seconds: int = Field(default=300, ge=10, le=1800)
    model_requests: int = Field(default=24, ge=2, le=100)
    model_tokens: int = Field(default=240000, ge=1000, le=2000000)
    output_tokens: int = Field(default=6000, ge=256, le=16000)
    tool_calls: int = Field(default=40, ge=2, le=200)
    searches: int = Field(default=8, ge=1, le=30)
    tool_seconds: int = Field(default=90, ge=1, le=180)
    tool_output_chars: int = Field(default=20000, ge=1000, le=100000)
    total_tool_output_chars: int = Field(default=240000, ge=1000, le=2000000)
    media_calls: int = Field(default=6, ge=0, le=20)
    media_input_bytes: int = Field(default=20 * 1024 * 1024, ge=1024, le=100 * 1024 * 1024)
    media_seconds: int = Field(default=180, ge=1, le=600)


class RunEvent(BaseModel):
    protocol_version: Literal[1] = 1
    run_id: str
    event_id: str
    seq: int
    type: str
    timestamp: float
    span_id: str | None = None
    parent_span_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class Evidence(BaseModel):
    """An immutable observation; numeric citation IDs are assigned by the host."""
    model_config = ConfigDict(extra="forbid")
    id: int = 0
    source: Literal["knowledge", "attachment"] = "knowledge"
    source_id: str
    modality: Modality
    file_name: str
    content: str
    version: str
    observation: Literal["parsed_text", "caption", "transcript", "media_observation", "calculation"]
    locator: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, Any] = Field(default_factory=dict)
    citation: dict[str, Any] = Field(default_factory=dict)
