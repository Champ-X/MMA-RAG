from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum

import httpx
from sqlalchemy import select

from nexus.infrastructure.postgres.models import EvidenceRevision, SourceSpaceLink
from nexus.infrastructure.postgres.repository import SqlControlPlaneRepository
from nexus.infrastructure.postgres.run_repository import SqlRunRepository
from nexus.infrastructure.postgres.tool_repository import SqlToolRepository
from nexus.infrastructure.source_adapters.connectors import BuiltinConnectorService
from nexus.modules.retrieval.application import RetrievalOrchestrator
from nexus.modules.retrieval.domain import ScopeCapsule, SearchRequest
from nexus.modules.tools.domain import ToolExecutionView
from nexus.modules.tools.ports import SandboxRunnerPort
from nexus.shared.domain.enums import QualityMode
from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError
from nexus.shared.domain.ids import new_id


class KnowledgeToolExecutor:
    """Audited read-only tool executor bound to a Run's frozen scope."""

    def __init__(
        self,
        *,
        repository: SqlToolRepository,
        runs: SqlRunRepository,
        control_plane: SqlControlPlaneRepository,
        retrieval: RetrievalOrchestrator,
        connectors: BuiltinConnectorService,
        sandbox: SandboxRunnerPort,
        external_tools_enabled: bool,
        mcp_read_servers: dict[str, str],
    ) -> None:
        self.repository = repository
        self.runs = runs
        self.control_plane = control_plane
        self.retrieval = retrieval
        self.connectors = connectors
        self.sandbox = sandbox
        self.external_tools_enabled = external_tools_enabled
        self.mcp_read_servers = mcp_read_servers

    def execute(
        self,
        *,
        run_id: str,
        tool_name: str,
        payload: dict[str, object],
        idempotency_key: str | None = None,
    ) -> ToolExecutionView:
        run = self.runs.get_run(run_id)
        tool = self.repository.get_tool(tool_name)
        if not tool.enabled:
            raise CapabilityUnavailableError("Tool is disabled", details={"tool": tool_name})
        key = (
            idempotency_key
            or hashlib.sha256(
                json.dumps(
                    {"tool": tool_name, "payload": payload},
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest()
        )
        execution = self.repository.prepare_execution(
            run_id=run_id,
            tool_definition_id=tool.id,
            idempotency_key=key,
            input_payload=payload,
        )
        if execution.status == "completed":
            return execution
        try:
            output = self._dispatch(tool_name, payload, scope=run.scope, run_id=run_id)
            completed = self.repository.finish_execution(
                execution.id, status="completed", output_payload=output
            )
            self.runs.append_event(
                run_id,
                "tool.execution.completed",
                {"execution_id": execution.id, "tool": tool_name},
                producer="knowledge-tool-executor",
                trace_id=new_id(),
            )
            return completed
        except Exception as exc:
            self.repository.finish_execution(
                execution.id,
                status="failed",
                error=type(exc).__name__,
            )
            self.runs.append_event(
                run_id,
                "tool.execution.failed",
                {
                    "execution_id": execution.id,
                    "tool": tool_name,
                    "error_type": type(exc).__name__,
                },
                producer="knowledge-tool-executor",
                trace_id=new_id(),
            )
            raise

    def _dispatch(
        self,
        tool_name: str,
        payload: dict[str, object],
        *,
        scope: ScopeCapsule,
        run_id: str,
    ) -> dict[str, object]:
        if tool_name in {"knowledge_search", "find_in_source"}:
            query = _required_text(payload, "query")
            requested_source = str(payload.get("source_id") or "").strip()
            if requested_source:
                if scope.source_ids and requested_source not in scope.source_ids:
                    raise ValidationError("Requested Source is outside the frozen Run scope")
                scoped = ScopeCapsule(
                    space_ids=scope.space_ids,
                    collection_ids=scope.collection_ids,
                    source_ids=(requested_source,),
                    publish_watermark=scope.publish_watermark,
                )
            else:
                scoped = scope
            limit = min(max(int(payload.get("limit") or 20), 1), 100)
            pack = self.retrieval.search(
                SearchRequest(
                    query=query,
                    scope=scoped,
                    quality_mode=QualityMode.QUALITY,
                    limit=limit,
                )
            )
            return {
                "query": query,
                "hits": [_json_value(hit) for hit in pack.hits],
                "channels": [_json_value(channel) for channel in pack.channels],
                "degraded": pack.degraded,
                "degradation_reasons": list(pack.degradation_reasons),
            }
        if tool_name == "open_evidence":
            revision_id = _required_text(payload, "evidence_revision_id")
            self._assert_evidence_scope(revision_id, scope)
            return {"evidence": _json_value(self.control_plane.get_evidence(revision_id))}
        if tool_name == "expand_context":
            revision_id = _required_text(payload, "evidence_revision_id")
            self._assert_evidence_scope(revision_id, scope)
            before = min(max(int(payload.get("before") or 1), 0), 20)
            after = min(max(int(payload.get("after") or 1), 0), 20)
            return {
                "items": [
                    _json_value(item)
                    for item in self.control_plane.expand_evidence(
                        revision_id, before=before, after=after
                    )
                ]
            }
        if tool_name == "compare_versions":
            left = _required_text(payload, "left_source_version_id")
            right = _required_text(payload, "right_source_version_id")
            self._assert_source_scope(self.control_plane.get_source_version(left).source_id, scope)
            self._assert_source_scope(self.control_plane.get_source_version(right).source_id, scope)
            return self.control_plane.compare_source_versions(left, right)
        if tool_name == "list_sources":
            space_id = _required_text(payload, "space_id")
            if scope.space_ids and space_id not in scope.space_ids:
                raise ValidationError("Requested Space is outside the frozen Run scope")
            limit = min(max(int(payload.get("limit") or 50), 1), 200)
            items, cursor = self.control_plane.list_sources(
                space_id=space_id, cursor=None, limit=limit
            )
            return {"items": [_json_value(item) for item in items], "next_cursor": cursor}
        if tool_name == "sql_read":
            return self.sandbox.sql_read(payload)
        if tool_name == "web_read":
            self._assert_external_enabled()
            space_id = _required_text(payload, "space_id")
            self._assert_space_scope(space_id, scope)
            results = self.connectors.sync(
                kind="url",
                space_id=space_id,
                url=_required_text(payload, "url"),
                mode="auto",
                include_links=True,
                include_images=True,
                process_inline=True,
            )
            return self._materialized_result(
                run_id=run_id,
                source_version_id=results[0].source_version.id,
                source_id=results[0].source_version.source_id,
                origin="web_read",
            )
        if tool_name == "mcp_read":
            self._assert_external_enabled()
            space_id = _required_text(payload, "space_id")
            self._assert_space_scope(space_id, scope)
            return self._mcp_read(payload, space_id=space_id, run_id=run_id)
        raise ValidationError(
            "No executor is registered for this tool", details={"tool": tool_name}
        )

    def _assert_evidence_scope(self, revision_id: str, scope: ScopeCapsule) -> None:
        with self.control_plane.database.transaction() as session:
            row = session.get(EvidenceRevision, revision_id)
            if row is None:
                raise ValidationError("Evidence Revision does not exist")
            self._assert_source_scope(row.source_id, scope)
            if scope.space_ids and not scope.source_ids:
                visible = session.scalar(
                    select(SourceSpaceLink.id).where(
                        SourceSpaceLink.source_id == row.source_id,
                        SourceSpaceLink.space_id.in_(scope.space_ids),
                        SourceSpaceLink.valid_to_sequence.is_(None),
                    )
                )
                if visible is None:
                    raise ValidationError("Evidence Revision is outside the frozen Run scope")

    @staticmethod
    def _assert_source_scope(source_id: str, scope: ScopeCapsule) -> None:
        if scope.source_ids and source_id not in scope.source_ids:
            raise ValidationError("Source is outside the frozen Run scope")

    @staticmethod
    def _assert_space_scope(space_id: str, scope: ScopeCapsule) -> None:
        if scope.space_ids and space_id not in scope.space_ids:
            raise ValidationError("Requested Space is outside the frozen Run scope")

    def _assert_external_enabled(self) -> None:
        if not self.external_tools_enabled:
            raise CapabilityUnavailableError("External read tools are disabled by policy")

    def _mcp_read(
        self, payload: dict[str, object], *, space_id: str, run_id: str
    ) -> dict[str, object]:
        server = _required_text(payload, "server")
        tool = _required_text(payload, "tool")
        arguments = payload.get("arguments")
        if not isinstance(arguments, dict):
            raise ValidationError("MCP arguments must be an object")
        endpoint = self.mcp_read_servers.get(server)
        if endpoint is None:
            raise ValidationError("MCP server is not allow-listed", details={"server": server})
        self.connectors.validate_public_url(endpoint, schemes={"https"})
        response = httpx.post(
            endpoint,
            headers={"Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": new_id(),
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            },
            timeout=self.connectors.timeout_seconds,
        )
        response.raise_for_status()
        if len(response.content) > self.connectors.max_download_bytes:
            raise ValidationError("MCP response exceeds the configured byte limit")
        response_hash = hashlib.sha256(response.content).hexdigest()
        result = self.connectors.ingestion.ingest_bytes(
            space_id=space_id,
            filename=f"mcp-{server}-{tool}.json",
            content=response.content,
            mime_type=response.headers.get("content-type", "application/json").split(";")[0],
            connector_kind="mcp",
            canonical_uri=f"mcp://{server}/{tool}",
            external_version=response_hash,
            metadata={
                "source_type": "mcp",
                "server": server,
                "tool": tool,
                "response_hash": response_hash,
            },
            idempotency_key=f"mcp:{server}:{tool}:{response_hash}",
            process_inline=True,
        )
        return self._materialized_result(
            run_id=run_id,
            source_version_id=result.source_version.id,
            source_id=result.source_version.source_id,
            origin="mcp_read",
        )

    def _materialized_result(
        self,
        *,
        run_id: str,
        source_version_id: str,
        source_id: str,
        origin: str,
    ) -> dict[str, object]:
        evidence, _ = self.control_plane.list_evidence(
            space_id=None,
            source_id=source_id,
            modality=None,
            cursor=None,
            limit=200,
        )
        revision_ids = [item.id for item in evidence if item.source_version_id == source_version_id]
        self.runs.add_ledger_items(
            run_id,
            revision_ids,
            discovered_by=origin,
            relevance={identifier: 1.0 for identifier in revision_ids},
        )
        return {
            "materialized": True,
            "origin": origin,
            "source_version_id": source_version_id,
            "evidence_revision_ids": revision_ids,
            "run_id": run_id,
            "evidence": [_json_value(item) for item in evidence if item.id in revision_ids],
        }


def _required_text(payload: dict[str, object], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValidationError(f"{key} is required")
    return value


def _json_value(value: object) -> object:
    if is_dataclass(value):
        return _json_value(asdict(value))
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value
