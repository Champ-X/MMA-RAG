"""Data contracts for the bounded Agentic retrieval loop."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class AgentDecision:
    """One planner decision.

    ``search`` asks the read-only knowledge tool to run one or more focused
    queries. ``final`` means the evidence ledger is sufficient for synthesis.
    """

    action: str
    reason: str = ""
    queries: List[str] = field(default_factory=list)


@dataclass
class AgentTraceStep:
    round: int
    action: str
    reason: str
    queries: List[str] = field(default_factory=list)
    result_count: int = 0
    new_evidence_count: int = 0
    total_evidence_count: int = 0
    target_kbs: List[Dict[str, Any]] = field(default_factory=list)
    duration_seconds: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "round": self.round,
            "action": self.action,
            "reason": self.reason,
            "queries": list(self.queries),
            "result_count": self.result_count,
            "new_evidence_count": self.new_evidence_count,
            "total_evidence_count": self.total_evidence_count,
            "target_kbs": [dict(item) for item in self.target_kbs],
            "duration_seconds": round(self.duration_seconds, 4),
            **({"error": self.error} if self.error else {}),
        }


@dataclass
class AgentRunResult:
    retrieval_result: Any
    trace: List[AgentTraceStep]
    stop_reason: str
    executed_queries: List[str]

    def metadata(self) -> Dict[str, Any]:
        return {
            "enabled": True,
            "stop_reason": self.stop_reason,
            "rounds": len(self.trace),
            "executed_queries": list(self.executed_queries),
            "steps": [step.to_dict() for step in self.trace],
        }
