from __future__ import annotations

from nexus.modules.tools.domain import ToolView
from nexus.modules.tools.ports import ToolRepositoryPort

BUILTIN_TOOLS = (
    (
        "knowledge_search",
        "Search published evidence in the frozen scope",
        {"query": {"type": "string"}, "limit": {"type": "integer"}},
        ("query",),
    ),
    (
        "find_in_source",
        "Find exact phrases, identifiers, numbers and locators",
        {"query": {"type": "string"}, "source_id": {"type": "string"}},
        ("query",),
    ),
    (
        "open_evidence",
        "Open one immutable Evidence Revision and its locator",
        {"evidence_revision_id": {"type": "string"}},
        ("evidence_revision_id",),
    ),
    (
        "expand_context",
        "Expand parent, neighbor or timeline context",
        {
            "evidence_revision_id": {"type": "string"},
            "before": {"type": "integer"},
            "after": {"type": "integer"},
        },
        ("evidence_revision_id",),
    ),
    (
        "compare_versions",
        "Compare two immutable Source Versions",
        {
            "left_source_version_id": {"type": "string"},
            "right_source_version_id": {"type": "string"},
        },
        ("left_source_version_id", "right_source_version_id"),
    ),
    (
        "list_sources",
        "List Sources visible in the frozen scope",
        {"space_id": {"type": "string"}, "limit": {"type": "integer"}},
        ("space_id",),
    ),
    (
        "sql_read",
        "Run a read-only DuckDB SELECT over caller-provided rows in an isolated memory database",
        {
            "query": {"type": "string"},
            "rows": {"type": "array", "items": {"type": "object"}},
        },
        ("query", "rows"),
    ),
)

EXTERNAL_READ_TOOLS = (
    (
        "web_read",
        "Fetch a public Web resource and materialize it as run-scoped immutable Evidence",
        {
            "url": {"type": "string"},
            "space_id": {"type": "string"},
        },
        ("url", "space_id"),
    ),
    (
        "mcp_read",
        "Call an allow-listed read-only MCP Tool and materialize the response as Evidence",
        {
            "server": {"type": "string"},
            "tool": {"type": "string"},
            "arguments": {"type": "object"},
            "space_id": {"type": "string"},
        },
        ("server", "tool", "arguments", "space_id"),
    ),
)


class ToolRegistryService:
    def __init__(self, repository: ToolRepositoryPort) -> None:
        self.repository = repository

    def seed_builtin(self, *, external_enabled: bool = False) -> list[ToolView]:
        builtins = [
            self.repository.upsert_tool(
                ToolView(
                    id="",
                    name=name,
                    version="1.0.0",
                    description=description,
                    input_schema={
                        "type": "object",
                        "properties": properties,
                        "required": list(required),
                        "additionalProperties": False,
                    },
                    output_schema={"type": "object"},
                    risk_level="read",
                    requires_approval=False,
                    idempotency="read_only",
                    enabled=True,
                )
            )
            for name, description, properties, required in BUILTIN_TOOLS
        ]
        external = [
            self.repository.upsert_tool(
                ToolView(
                    id="",
                    name=name,
                    version="1.0.0",
                    description=description,
                    input_schema={
                        "type": "object",
                        "properties": properties,
                        "required": list(required),
                        "additionalProperties": False,
                    },
                    output_schema={"type": "object"},
                    risk_level="external_read",
                    requires_approval=False,
                    idempotency="read_only_materialized",
                    enabled=external_enabled,
                )
            )
            for name, description, properties, required in EXTERNAL_READ_TOOLS
        ]
        return [*builtins, *external]

    def list(self) -> list[ToolView]:
        return self.repository.list_tools()
