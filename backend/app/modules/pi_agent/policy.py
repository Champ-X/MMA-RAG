"""Immutable request scope and host-owned accounting, independent of model instructions."""
from __future__ import annotations

from dataclasses import dataclass, field
import time

from .contracts import RunRequest


class ToolError(ValueError):
    def __init__(self, code: str, message: str, *, retryable=False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


@dataclass(frozen=True)
class AccessScope:
    allowed_kbs: frozenset[str]
    search_kbs: frozenset[str]
    search_files: frozenset[tuple[str, str]]
    references: frozenset[tuple[str, str]]

    @classmethod
    def from_request(cls, request: RunRequest, allowed_kbs: set[str]):
        allowed = frozenset(allowed_kbs)
        requested = frozenset(request.knowledge_base_ids)
        files = frozenset((f.kb_id, f.file_id) for f in request.selected_files)
        references = frozenset((f.kb_id, f.file_id) for f in request.reference_files)
        all_requested = requested | {kb for kb, _ in files | references}
        if not all_requested <= allowed:
            raise ToolError("scope_denied", "所选知识库或引用材料不在当前可访问范围内")
        if requested and any(kb not in requested for kb, _ in files):
            raise ToolError("scope_conflict", "指定文件与所选知识库范围冲突")
        search_kbs = frozenset(kb for kb, _ in files) if files else requested or allowed
        return cls(allowed, search_kbs, files, references)

    def can_search(self, kb_id: str, file_id: str, parent_file_id: str | None = None) -> bool:
        if kb_id not in self.allowed_kbs or kb_id not in self.search_kbs:
            return False
        return not self.search_files or any((kb_id, fid) in self.search_files for fid in (file_id, parent_file_id) if fid)

    def can_read(self, kb_id: str, file_id: str, parent_file_id: str | None = None) -> bool:
        if kb_id not in self.allowed_kbs:
            return False
        return self.can_search(kb_id, file_id, parent_file_id) or any(
            (kb_id, fid) in self.references for fid in (file_id, parent_file_id) if fid)

    def narrow_kbs(self, requested: list[str] | None) -> list[str]:
        effective = set(requested) if requested else set(self.search_kbs)
        if not effective <= self.search_kbs:
            raise ToolError("scope_denied", "工具不能扩展本轮检索范围")
        return sorted(effective)

    def public(self):
        return {"knowledge_base_ids": sorted(self.search_kbs),
                "selected_files": [{"kb_id": kb, "file_id": fid} for kb, fid in sorted(self.search_files)],
                "reference_files": [{"kb_id": kb, "file_id": fid} for kb, fid in sorted(self.references)]}


@dataclass
class UsageLedger:
    """Measure work without imposing an execution deadline or allowance.

    Missing provider usage is recorded as unknown, never guessed from UTF-8
    bytes or charged as if the maximum possible output had been generated.
    """
    started: float = field(default_factory=time.monotonic)
    model_requests: int = 0
    model_tokens: int = 0
    tool_calls: int = 0
    searches: int = 0
    media_calls: int = 0
    media_input_bytes: int = 0
    media_seconds: float = 0
    tool_output_chars: int = 0
    unknown_usage_requests: int = 0
    _pending: set[int] = field(default_factory=set)
    _settled: set[int] = field(default_factory=set)

    def start_model(self, turn: int):
        if turn in self._pending or turn in self._settled:
            raise ToolError("duplicate_model_request", "重复的模型请求标识")
        self.model_requests += 1
        self._pending.add(turn)
        return {"allowed": True}

    def settle_model(self, turn: int, usage: dict | None):
        if turn not in self._pending:
            return
        self._pending.remove(turn)
        self._settled.add(turn)
        total = (usage or {}).get("totalTokens")
        if not isinstance(total, (int, float)) or total <= 0:
            self.unknown_usage_requests += 1
        else:
            self.model_tokens += int(total)

    def record_tool(self, name: str):
        self.tool_calls += 1
        self.searches += int(name == "search")
        self.media_calls += int(name == "inspect_media")

    def account_output(self, chars: int):
        self.tool_output_chars += chars

    def record_media(self, size: int, seconds: float):
        self.media_input_bytes += size
        self.media_seconds += seconds

    def snapshot(self):
        return {"model_requests": self.model_requests, "model_tokens": self.model_tokens,
                "unknown_usage_requests": self.unknown_usage_requests, "tool_calls": self.tool_calls,
                "searches": self.searches, "media_calls": self.media_calls,
                "media_input_bytes": self.media_input_bytes, "media_seconds": self.media_seconds,
                "tool_output_chars": self.tool_output_chars,
                "duration_ms": round((time.monotonic() - self.started) * 1000)}
