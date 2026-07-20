from __future__ import annotations

from sqlalchemy import select

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import ToolDefinition, ToolExecution
from nexus.modules.tools.domain import ToolExecutionView, ToolView
from nexus.shared.domain.errors import ConflictError, NotFoundError


class SqlToolRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def upsert_tool(self, definition: ToolView) -> ToolView:
        with self.database.transaction() as session:
            row = session.scalar(
                select(ToolDefinition).where(
                    ToolDefinition.name == definition.name,
                    ToolDefinition.version == definition.version,
                )
            )
            if row is None:
                row = ToolDefinition(
                    name=definition.name,
                    version=definition.version,
                    description=definition.description,
                    input_schema=definition.input_schema,
                    output_schema=definition.output_schema,
                    risk_level=definition.risk_level,
                    requires_approval=definition.requires_approval,
                    idempotency=definition.idempotency,
                    enabled=definition.enabled,
                )
                session.add(row)
                session.flush()
            else:
                row.description = definition.description
                row.input_schema = definition.input_schema
                row.output_schema = definition.output_schema
                row.risk_level = definition.risk_level
                row.requires_approval = definition.requires_approval
                row.idempotency = definition.idempotency
                row.enabled = definition.enabled
            return self._view(row)

    def list_tools(self) -> list[ToolView]:
        with self.database.transaction() as session:
            return [
                self._view(row)
                for row in session.scalars(select(ToolDefinition).order_by(ToolDefinition.name))
            ]

    def get_tool(self, name: str) -> ToolView:
        with self.database.transaction() as session:
            row = session.scalar(
                select(ToolDefinition)
                .where(ToolDefinition.name == name)
                .order_by(ToolDefinition.version.desc())
            )
            if row is None:
                raise NotFoundError("Tool not found", details={"tool": name})
            return self._view(row)

    def prepare_execution(
        self,
        *,
        run_id: str,
        tool_definition_id: str,
        idempotency_key: str,
        input_payload: dict[str, object],
    ) -> ToolExecutionView:
        with self.database.transaction() as session:
            existing = session.scalar(
                select(ToolExecution).where(
                    ToolExecution.run_id == run_id,
                    ToolExecution.idempotency_key == idempotency_key,
                )
            )
            if existing:
                if existing.input_payload != input_payload:
                    raise ConflictError("Tool idempotency key was reused with different input")
                return self._execution_view(existing)
            row = ToolExecution(
                run_id=run_id,
                tool_definition_id=tool_definition_id,
                status="running",
                idempotency_key=idempotency_key,
                input_payload=input_payload,
            )
            session.add(row)
            session.flush()
            return self._execution_view(row)

    def finish_execution(
        self,
        execution_id: str,
        *,
        status: str,
        output_payload: dict[str, object] | None = None,
        error: str | None = None,
    ) -> ToolExecutionView:
        with self.database.transaction() as session:
            row = session.get(ToolExecution, execution_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Tool execution not found")
            row.status = status
            row.output_payload = output_payload
            row.error = error
            session.flush()
            return self._execution_view(row)

    @staticmethod
    def _view(row: ToolDefinition) -> ToolView:
        return ToolView(
            id=row.id,
            name=row.name,
            version=row.version,
            description=row.description,
            input_schema=row.input_schema,
            output_schema=row.output_schema,
            risk_level=row.risk_level,
            requires_approval=row.requires_approval,
            idempotency=row.idempotency,
            enabled=row.enabled,
        )

    @staticmethod
    def _execution_view(row: ToolExecution) -> ToolExecutionView:
        return ToolExecutionView(
            id=row.id,
            run_id=row.run_id,
            tool_definition_id=row.tool_definition_id,
            status=row.status,
            idempotency_key=row.idempotency_key,
            input_payload=row.input_payload,
            output_payload=row.output_payload,
            error=row.error,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
