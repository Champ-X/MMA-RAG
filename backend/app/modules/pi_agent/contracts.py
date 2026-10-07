"""Versioned host contracts. The model never supplies trusted identity."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_VERSION = 1
TERMINAL_STATUSES = frozenset({"completed", "partial", "needs_input", "cancelled", "failed"})
RunStatus = Literal["queued", "running", "cancelling", "completed", "partial", "needs_input", "cancelled", "failed"]
Modality = Literal["doc", "image", "audio", "video"]


class SourceFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kb_id: str = Field(min_length=1)
    file_id: str = Field(min_length=1)
    name: str = Field(default="")
    type: str = Field(default="")
    kb_name: str = Field(default="")


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol_version: Literal[1] = 1
    client_request_id: str = Field(min_length=8)
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    model: str | None = Field(default=None)
    knowledge_base_ids: list[str] = Field(default_factory=list)
    selected_files: list[SourceFile] = Field(default_factory=list)
    reference_files: list[SourceFile] = Field(default_factory=list)
    mentions: list[dict[str, Any]] = Field(default_factory=list)
    history: list[dict[str, str]] = Field(default_factory=list)
    parent_run_id: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)


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
