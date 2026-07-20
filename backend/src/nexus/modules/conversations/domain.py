from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ConversationView:
    id: str
    title: str
    pinned: bool
    archived: bool
    revision: int
    run_count: int
    latest_run_id: str
    latest_goal: str
    latest_status: str
    kinds: tuple[str, ...]
    space_ids: tuple[str, ...]
    citation_count: int
    created_at: datetime
    updated_at: datetime
    last_activity_at: datetime
