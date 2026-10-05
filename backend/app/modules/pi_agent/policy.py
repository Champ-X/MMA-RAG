"""Immutable request scope and host-owned accounting, independent of model instructions."""
from __future__ import annotations

from dataclasses import dataclass, field
import time

from .contracts import RunBudget, RunRequest


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
class BudgetLedger:
    limits: RunBudget
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
    _reservations: dict[int, int] = field(default_factory=dict)
    _settled: set[int] = field(default_factory=set)

    def check_time(self):
        if time.monotonic() - self.started >= self.limits.wall_seconds:
            raise ToolError("time_budget_exhausted", "本轮运行时间预算已用尽")

    def reserve_model(self, turn: int, input_bytes: int, max_output_tokens: int):
        self.check_time()
        if turn in self._reservations or turn in self._settled:
            raise ToolError("duplicate_model_request", "重复的模型请求标识")
        if self.model_requests >= self.limits.model_requests:
            raise ToolError("model_request_budget_exhausted", "本轮模型调用预算已用尽")
        # UTF-8 bytes are a conservative text-token allowance; actual usage reconciles it.
        # Images carried as base64 are conservatively charged by serialized bytes too.
        output = min(max_output_tokens, self.limits.output_tokens)
        reserve = max(0, input_bytes) + output
        if self.model_tokens + sum(self._reservations.values()) + reserve > self.limits.model_tokens:
            raise ToolError("token_budget_exhausted", "剩余 Token 预算不足以执行下一次模型请求")
        self.model_requests += 1
        self._reservations[turn] = reserve
        return {"allowed": True, "max_output_tokens": output}

    def settle_model(self, turn: int, usage: dict | None):
        if turn in self._settled:
            return
        reserved = self._reservations.pop(turn, None)
        if reserved is None:
            return  # A rejected request can still produce Pi's terminal error event.
        self._settled.add(turn)
        total = (usage or {}).get("totalTokens")
        if not isinstance(total, (int, float)) or total <= 0:
            self.unknown_usage_requests += 1
            self.model_tokens += reserved
        else:
            self.model_tokens += int(total)

    def reserve_tool(self, name: str):
        self.check_time()
        if self.tool_calls >= self.limits.tool_calls:
            raise ToolError("tool_budget_exhausted", "本轮工具调用预算已用尽")
        # Preserve admission slots for a final answer even when research is exhausted.
        if name not in {"submit_answer", "ask_user"} and self.tool_calls >= self.limits.tool_calls - 2:
            raise ToolError("research_budget_exhausted", "研究预算即将用尽，请提交已有结论并说明缺口")
        if name == "search" and self.searches >= self.limits.searches:
            raise ToolError("search_budget_exhausted", "搜索预算已用尽，可以读取已有证据或提交回答")
        if name == "inspect_media" and self.media_calls >= self.limits.media_calls:
            raise ToolError("media_budget_exhausted", "媒体分析预算已用尽")
        self.tool_calls += 1
        self.searches += int(name == "search")
        self.media_calls += int(name == "inspect_media")

    def account_output(self, chars: int):
        if chars > self.limits.tool_output_chars:
            raise ToolError("tool_output_too_large", "工具结果超过单次预算，请缩小范围或分页读取")
        if self.tool_output_chars + chars > self.limits.total_tool_output_chars:
            raise ToolError("tool_output_budget_exhausted", "工具输出预算已用尽，请根据已有证据回答")
        self.tool_output_chars += chars

    def reserve_media(self, size: int, seconds: float):
        self.check_time()
        if self.media_input_bytes + size > self.limits.media_input_bytes or self.media_seconds + seconds > self.limits.media_seconds:
            raise ToolError("media_input_budget_exhausted", "媒体输入预算已用尽，请根据已有证据回答")
        self.media_input_bytes += size
        self.media_seconds += seconds

    def snapshot(self):
        return {"model_requests": self.model_requests, "model_tokens": self.model_tokens,
                "unknown_usage_requests": self.unknown_usage_requests, "tool_calls": self.tool_calls,
                "searches": self.searches, "media_calls": self.media_calls,
                "media_input_bytes": self.media_input_bytes, "media_seconds": self.media_seconds,
                "tool_output_chars": self.tool_output_chars,
                "duration_ms": round((time.monotonic() - self.started) * 1000)}
