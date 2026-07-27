"""Read-only tool registry used by the Agentic retrieval runtime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ToolContext:
    kb_context: Optional[Dict[str, Any]]
    session_context: List[Dict[str, str]]
    attachment_context: Optional[str]
    agent_round: int = 1
    explored_kb_counts: Optional[Dict[str, int]] = None
    # The original user question is analyzed once before the Agent starts
    # planning.  Child queries inherit explicit modality demands so a planner
    # cannot accidentally turn an "include images" request into text-only
    # retrieval just by wording a sub-query differently.
    base_modality_intents: Optional[Dict[str, str]] = None


class MultimodalKnowledgeSearchTool:
    """Adapter that exposes the existing retrieval service as an Agent tool."""

    name = "multimodal_knowledge_search"
    read_only = True
    description = (
        "Search text, images, audio and video with the project's existing "
        "intent routing, knowledge-base routing, hybrid recall and reranking."
    )

    def __init__(self, retrieval_service: Any):
        self.retrieval_service = retrieval_service

    async def execute(self, *, query: str, context: ToolContext) -> Any:
        clean_query = " ".join((query or "").split()).strip()
        if not clean_query:
            raise ValueError("query must not be empty")
        return await self.retrieval_service.search(
            query=clean_query,
            kb_context=context.kb_context,
            session_context=context.session_context,
            attachment_context=context.attachment_context,
            preplanned=True,
            routing_hints={
                "agent_mode": True,
                "agent_round": context.agent_round,
                "explored_kb_counts": dict(context.explored_kb_counts or {}),
                "agent_base_modality_intents": dict(
                    context.base_modality_intents or {}
                ),
            },
        )


class AgentToolRegistry:
    """Minimal first-wins registry with an explicit read-only execution gate."""

    def __init__(self) -> None:
        self._tools: Dict[str, Any] = {}

    def register(self, tool: Any) -> bool:
        name = str(getattr(tool, "name", "") or "").strip()
        if not name or name in self._tools:
            return False
        self._tools[name] = tool
        return True

    def get(self, name: str) -> Any:
        tool = self._tools.get(name)
        if tool is None:
            raise KeyError(f"unknown agent tool: {name}")
        if not bool(getattr(tool, "read_only", False)):
            raise PermissionError(f"tool is not approved for automatic execution: {name}")
        return tool

    def names(self) -> List[str]:
        return sorted(self._tools)
