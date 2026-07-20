from __future__ import annotations

from typing import Protocol

from nexus.modules.tools.domain import ToolExecutionView, ToolView


class ToolRepositoryPort(Protocol):
    def upsert_tool(self, definition: ToolView) -> ToolView: ...

    def list_tools(self) -> list[ToolView]: ...

    def get_tool(self, name: str) -> ToolView: ...

    def prepare_execution(
        self,
        *,
        run_id: str,
        tool_definition_id: str,
        idempotency_key: str,
        input_payload: dict[str, object],
    ) -> ToolExecutionView: ...

    def finish_execution(
        self,
        execution_id: str,
        *,
        status: str,
        output_payload: dict[str, object] | None = None,
        error: str | None = None,
    ) -> ToolExecutionView: ...


class SandboxRunnerPort(Protocol):
    """Narrow bridge to an isolated computation worker."""

    def sql_read(self, payload: dict[str, object]) -> dict[str, object]: ...

    def health(self) -> dict[str, object]: ...
