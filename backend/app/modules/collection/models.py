"""Public collection API contracts. Trusted scope is fixed when a run is created."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

RunStatus = Literal["planning", "searching", "review", "collecting", "completed", "partial", "failed", "cancelled", "interrupted"]
ItemStatus = Literal["candidate", "downloading", "processing", "ready", "duplicate", "failed", "skipped"]
ACTIVE_STATUSES = {"planning", "searching", "collecting"}


class CreateRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kb_id: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=4000)
    mode: Literal["auto", "review"] = "review"
    max_items: int = Field(default=5, ge=1, le=20)
    client_request_id: str = Field(min_length=8, max_length=200)

    @field_validator("kb_id", "prompt", "client_request_id")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("内容不能为空")
        return value


class CollectSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_ids: list[str] = Field(min_length=1, max_length=20)


class Candidate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    title: str
    url: str
    download_url: str | None = None
    source: str
    kind: str = "webpage"
    required_format: Literal["pdf"] | None = None
    material_intent: Literal["paper"] | None = None
    description: str = ""
    thumbnail_url: str | None = None
    published_at: str | None = None
    author: str | None = None
    license: str | None = None
    width: int | None = None
    height: int | None = None
    reason: str | None = None
    ranking_status: Literal["accepted", "unavailable"] | None = None
    warnings: list[str] = Field(default_factory=list)
    status: ItemStatus = "candidate"
    file_id: str | None = None
    processing_id: str | None = None
    error: str | None = None
    error_code: str | None = None


class Counts(BaseModel):
    found: int = 0
    ready: int = 0
    failed: int = 0
    duplicate: int = 0
    selected: int = 0


class CollectionRun(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    kb_id: str
    prompt: str
    mode: Literal["auto", "review"]
    max_items: int
    status: RunStatus
    plan: dict[str, Any] = Field(default_factory=dict)
    candidates: list[Candidate] = Field(default_factory=list)
    counts: Counts = Field(default_factory=Counts)
    message: str = ""
    error_code: str | None = None
    warnings: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


def public_run(run: dict) -> dict:
    """Never expose payload paths, credentials or internal recovery markers."""
    data = dict(run)
    items = run.get("candidates", [])
    data["counts"] = {
        "found": len(items),
        "ready": sum(i["status"] == "ready" for i in items),
        "failed": sum(i["status"] == "failed" for i in items),
        "duplicate": sum(i["status"] == "duplicate" for i in items),
        "selected": sum(bool(i.get("_selected")) for i in items),
    }
    return CollectionRun.model_validate(data).model_dump()
