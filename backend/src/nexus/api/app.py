from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import asdict
from typing import Any

from fastapi import (
    APIRouter,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text

from nexus import __version__
from nexus.api.mcp import NexusMcpServer
from nexus.api.schemas import (
    AgentProfileListResponse,
    ArtifactFromTemplateCreate,
    ArtifactListResponse,
    ArtifactRefreshProposalListResponse,
    ArtifactRefreshProposalResponse,
    ArtifactRefreshResolution,
    ArtifactResponse,
    ArtifactRevisionCreate,
    ArtifactStatusUpdate,
    ArtifactTemplateListResponse,
    BackupListResponse,
    CollectionCreate,
    CollectionListResponse,
    CollectionResponse,
    CollectionUpdate,
    CompareEvidenceBody,
    ConnectorSyncCreate,
    ConnectorSyncResponse,
    ConversationListResponse,
    ConversationResponse,
    ConversationUpdate,
    EvidenceListResponse,
    EvidenceResponse,
    HealthResponse,
    IngestionJobEventListResponse,
    IngestionJobListResponse,
    IngestionJobResponse,
    ModelListResponse,
    ModelRegistrationCreate,
    ModelResponseSchema,
    ModelRouteCreate,
    ModelRouteListResponse,
    ModelRouteResponse,
    ModelSetupApplyRequest,
    ModelSetupApplyResponse,
    ModelSetupResponse,
    ProviderCreate,
    ProviderListResponse,
    ProviderResponse,
    RunCreate,
    RunListResponse,
    RunResponse,
    RunSnapshotResponse,
    RunSuggestedQuestionListResponse,
    SearchBody,
    SearchResponse,
    SourceListResponse,
    SourceSyncExecutionListResponse,
    SourceSyncScheduleEnvelope,
    SourceSyncScheduleResponse,
    SourceSyncScheduleUpdate,
    SourceVersionResponse,
    SpaceCreate,
    SpaceKnowledgeListResponse,
    SpaceListResponse,
    SpaceResponse,
    SpaceRouteRequest,
    SpaceRouteResponse,
    ToolExecuteBody,
    ToolExecutionResponse,
    ToolListResponse,
    UploadComplete,
    UploadResponse,
    UploadSessionCreate,
    UploadSessionResponse,
)
from nexus.api.serializers import evidence_payload, serialize
from nexus.bootstrap.container import NexusContainer, build_container
from nexus.config import NexusSettings
from nexus.infrastructure.feishu import FeishuStateStore
from nexus.infrastructure.telemetry import configure_telemetry, current_trace_id
from nexus.modules.artifacts.domain import ARTIFACT_TEMPLATES
from nexus.modules.artifacts.renderers import (
    ArtifactRenderMetadata,
    render_artifact as render_canonical_artifact,
)
from nexus.modules.retrieval.domain import ScopeCapsule, SearchRequest
from nexus.shared.domain.enums import TERMINAL_RUN_STATUSES, QualityMode, RunKind
from nexus.shared.domain.errors import DomainError
from nexus.shared.domain.ids import new_id


async def _run_inline_source_sync_scheduler(container: NexusContainer) -> None:
    """Give Docker-free local mode the same durable schedule semantics as Celery beat."""

    while True:
        schedules = await asyncio.to_thread(container.source_syncs.claim_due, limit=25)
        for schedule in schedules:
            try:
                await asyncio.to_thread(container.source_syncs.run_schedule, schedule.id)
            except Exception:
                # The execution and schedule rows retain the failure. One bad upstream
                # must not stop other schedules or the local application lifecycle.
                continue
        await asyncio.sleep(max(1.0, container.settings.scheduler_interval_seconds))


def create_app(
    *,
    settings: NexusSettings | None = None,
    container: NexusContainer | None = None,
) -> FastAPI:
    owned_container = container is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.container = container or build_container(settings)
        scheduler_task: asyncio.Task[None] | None = None
        if app.state.container.settings.inline_worker:
            scheduler_task = asyncio.create_task(
                _run_inline_source_sync_scheduler(app.state.container)
            )
        try:
            yield
        finally:
            if scheduler_task is not None:
                scheduler_task.cancel()
                with suppress(asyncio.CancelledError):
                    await scheduler_task
            if owned_container:
                app.state.container.database.engine.dispose()

    app = FastAPI(
        title="MMA-RAG Nexus API",
        description="Evidence-first multimodal agentic knowledge base",
        version=__version__,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    configured = settings or (container.settings if container else NexusSettings())
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key", "If-Match", "Last-Event-ID"],
    )

    @app.middleware("http")
    async def trace_context(request: Request, call_next: Any) -> Response:
        trace_id = request.headers.get("x-trace-id") or current_trace_id() or new_id()
        request.state.trace_id = trace_id
        response = await call_next(request)
        response.headers["X-Trace-ID"] = trace_id
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(
                _error_payload(request, exc.code, exc.message, exc.details, exc.retryable)
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(
                _error_payload(
                    request,
                    "REQUEST_VALIDATION_ERROR",
                    "Request does not match the API contract",
                    {"errors": exc.errors()},
                    False,
                )
            ),
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = str(detail.get("code") or f"HTTP_{exc.status_code}")
        message = str(
            detail.get("message")
            or (exc.detail if isinstance(exc.detail, str) else "Request failed")
        )
        details = {key: value for key, value in detail.items() if key not in {"code", "message"}}
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(_error_payload(request, code, message, details, False)),
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=jsonable_encoder(
                _error_payload(
                    request,
                    "INTERNAL_ERROR",
                    "An unexpected internal error occurred",
                    {"type": type(exc).__name__},
                    False,
                )
            ),
        )

    router = APIRouter(prefix="/api/v1")

    def get_container(request: Request) -> NexusContainer:
        return request.app.state.container

    # ----- Spaces ---------------------------------------------------------------------

    @router.post(
        "/spaces", response_model=SpaceResponse, operation_id="create_space", status_code=201
    )
    async def create_space(
        body: SpaceCreate,
        request: Request,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).spaces.create,
            name=body.name,
            slug=body.slug,
            description=body.description,
            knowledge_profile=body.knowledge_profile,
            default_quality=body.default_quality,
            idempotency_key=idempotency_key,
        )
        return serialize(item)

    @router.get("/spaces", response_model=SpaceListResponse, operation_id="list_spaces")
    async def list_spaces(
        request: Request,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).spaces.list, cursor=cursor, limit=limit
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": next_cursor}}

    @router.get("/spaces/{space_id}", response_model=SpaceResponse, operation_id="get_space")
    async def get_space(space_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).spaces.get, space_id))

    @router.delete(
        "/spaces/{space_id}",
        response_model=SpaceResponse,
        operation_id="archive_space",
        status_code=202,
    )
    async def archive_space(space_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).spaces.archive, space_id))

    @router.get("/spaces/{space_id}/portrait", operation_id="get_space_portrait")
    async def get_space_portrait(space_id: str, request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(
            get_container(request).space_intelligence.portrait,
            space_id,
        )

    @router.get(
        "/spaces/{space_id}/suggested-questions",
        operation_id="get_space_suggested_questions",
    )
    async def get_space_suggested_questions(
        space_id: str,
        request: Request,
        limit: int = Query(default=6, ge=1, le=12),
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            get_container(request).space_intelligence.suggested_questions,
            space_id,
            limit=limit,
        )

    @router.get(
        "/spaces/{space_id}/knowledge",
        response_model=SpaceKnowledgeListResponse,
        operation_id="list_space_knowledge",
    )
    async def list_space_knowledge(
        space_id: str,
        request: Request,
        status: str = Query(default="all", pattern="^(all|supported|attention)$"),
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        await asyncio.to_thread(get_container(request).spaces.get, space_id)
        items, next_cursor = await asyncio.to_thread(
            get_container(request).runs_repository.list_space_knowledge_claims,
            space_id,
            status_filter=status,
            cursor=cursor,
            limit=limit,
        )
        return {
            "items": [serialize(item) for item in items],
            "page": {"next_cursor": next_cursor},
        }

    @router.post(
        "/spaces/route",
        response_model=SpaceRouteResponse,
        operation_id="route_spaces",
    )
    async def route_spaces(body: SpaceRouteRequest, request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(
            get_container(request).space_intelligence.route,
            body.query,
            limit=body.limit,
        )

    @router.post(
        "/spaces/{space_id}/collections",
        response_model=CollectionResponse,
        operation_id="create_collection",
        status_code=201,
    )
    async def create_collection(
        space_id: str, body: CollectionCreate, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).spaces.create_collection,
            space_id=space_id,
            name=body.name,
            description=body.description,
            color=body.color,
            view_kind=body.view_kind,
            rule_logic=body.rule_logic,
            source_ids=tuple(body.source_ids),
            rules=tuple(rule.model_dump() for rule in body.rules),
        )
        return serialize(item)

    @router.get(
        "/spaces/{space_id}/collections",
        response_model=CollectionListResponse,
        operation_id="list_collections",
    )
    async def list_collections(space_id: str, request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(
            get_container(request).spaces.list_collections, space_id
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": None}}

    @router.get(
        "/collections/{collection_id}",
        response_model=CollectionResponse,
        operation_id="get_collection",
    )
    async def get_collection(collection_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(
                get_container(request).spaces.get_collection, collection_id
            )
        )

    @router.patch(
        "/collections/{collection_id}",
        response_model=CollectionResponse,
        operation_id="update_collection",
    )
    async def update_collection(
        collection_id: str, body: CollectionUpdate, request: Request
    ) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(
                get_container(request).spaces.update_collection,
                collection_id,
                name=body.name,
                description=body.description,
                color=body.color,
                rule_logic=body.rule_logic,
                source_ids=tuple(body.source_ids) if body.source_ids is not None else None,
                rules=(
                    tuple(rule.model_dump() for rule in body.rules)
                    if body.rules is not None
                    else None
                ),
                expected_revision=body.expected_revision,
            )
        )

    @router.delete(
        "/collections/{collection_id}",
        response_model=CollectionResponse,
        operation_id="archive_collection",
        status_code=202,
    )
    async def archive_collection(collection_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(
                get_container(request).spaces.archive_collection, collection_id
            )
        )

    # ----- Sources/Ingestion ----------------------------------------------------------

    @router.post(
        "/sources/upload",
        response_model=UploadResponse,
        operation_id="upload_source",
        status_code=202,
    )
    async def upload_source(
        request: Request,
        space_id: str = Form(...),
        file: UploadFile = File(...),
        source_id: str | None = Form(default=None),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> dict[str, Any]:
        content = await file.read()
        container_value = get_container(request)
        result = await asyncio.to_thread(
            container_value.ingestion.ingest_bytes,
            space_id=space_id,
            filename=file.filename or "upload.bin",
            content=content,
            mime_type=file.content_type,
            source_id=source_id,
            idempotency_key=idempotency_key,
            process_inline=container_value.settings.inline_worker,
        )
        if container_value.index and result.job.status == "completed":
            # In standard/full profiles the outbox worker performs this projection.
            await asyncio.to_thread(container_value.index.project_pending)
        return {"source_version": serialize(result.source_version), "job": serialize(result.job)}

    @router.post(
        "/connectors/sync",
        response_model=ConnectorSyncResponse,
        operation_id="sync_builtin_connector",
        status_code=202,
    )
    async def sync_builtin_connector(body: ConnectorSyncCreate, request: Request) -> dict[str, Any]:
        container_value = get_container(request)
        connector = body.root
        parameters = connector.model_dump(exclude={"kind", "space_id"}, exclude_none=True)
        results = await asyncio.to_thread(
            container_value.connectors.sync,
            kind=connector.kind,
            space_id=connector.space_id,
            process_inline=container_value.settings.inline_worker,
            **parameters,
        )
        if container_value.index and any(item.job.status == "completed" for item in results):
            await asyncio.to_thread(container_value.index.project_pending)
        return {
            "connector_kind": connector.kind,
            "location": container_value.connectors.describe_origin(
                kind=connector.kind, parameters=parameters
            ),
            "items": [
                {
                    "source_version": serialize(item.source_version),
                    "job": serialize(item.job),
                }
                for item in results
            ],
        }

    @router.post(
        "/spaces/{space_id}/sources/{source_id}/sync",
        response_model=ConnectorSyncResponse,
        operation_id="refresh_connected_source",
        status_code=202,
    )
    async def refresh_connected_source(
        space_id: str,
        source_id: str,
        request: Request,
    ) -> dict[str, Any]:
        result = await asyncio.to_thread(
            get_container(request).source_syncs.run_now,
            space_id=space_id,
            source_id=source_id,
        )
        return {
            "connector_kind": result.connector_kind,
            "location": result.location,
            "items": [
                {
                    "source_version": serialize(item.source_version),
                    "job": serialize(item.job),
                }
                for item in result.items
            ],
            "execution": serialize(result.execution),
        }

    @router.get(
        "/spaces/{space_id}/sources/{source_id}/sync-schedule",
        response_model=SourceSyncScheduleEnvelope,
        operation_id="get_source_sync_schedule",
    )
    async def get_source_sync_schedule(
        space_id: str, source_id: str, request: Request
    ) -> dict[str, Any]:
        schedule = await asyncio.to_thread(
            get_container(request).source_syncs.get,
            space_id=space_id,
            source_id=source_id,
        )
        return {"schedule": serialize(schedule) if schedule else None}

    @router.put(
        "/spaces/{space_id}/sources/{source_id}/sync-schedule",
        response_model=SourceSyncScheduleResponse,
        operation_id="configure_source_sync_schedule",
    )
    async def configure_source_sync_schedule(
        space_id: str,
        source_id: str,
        body: SourceSyncScheduleUpdate,
        request: Request,
    ) -> dict[str, Any]:
        schedule = await asyncio.to_thread(
            get_container(request).source_syncs.configure,
            space_id=space_id,
            source_id=source_id,
            interval_minutes=body.interval_minutes,
            enabled=body.enabled,
            expected_revision=body.expected_revision,
        )
        return serialize(schedule)

    @router.get(
        "/spaces/{space_id}/sources/{source_id}/sync-executions",
        response_model=SourceSyncExecutionListResponse,
        operation_id="list_source_sync_executions",
    )
    async def list_source_sync_executions(
        space_id: str,
        source_id: str,
        request: Request,
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, Any]:
        items = await asyncio.to_thread(
            get_container(request).source_syncs.history,
            space_id=space_id,
            source_id=source_id,
            limit=limit,
        )
        return {"items": [serialize(item) for item in items]}

    @router.post(
        "/upload-sessions",
        response_model=UploadSessionResponse,
        operation_id="create_upload_session",
        status_code=201,
    )
    async def create_upload_session(body: UploadSessionCreate, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).upload_sessions.create,
            space_id=body.space_id,
            source_id=body.source_id,
            filename=body.filename,
            mime_type=body.mime_type,
            total_bytes=body.total_bytes,
            part_size=body.part_size,
            expected_hash=body.expected_hash,
        )
        return serialize(item)

    @router.put(
        "/upload-sessions/{session_id}/parts/{part_no}",
        response_model=UploadSessionResponse,
        operation_id="put_upload_part",
    )
    async def put_upload_part(
        session_id: str,
        part_no: int,
        request: Request,
        part_hash: str = Header(alias="X-Part-SHA256"),
    ) -> dict[str, Any]:
        content = await request.body()
        item = await asyncio.to_thread(
            get_container(request).upload_sessions.put_part,
            session_id,
            part_no=part_no,
            content=content,
            expected_hash=part_hash,
        )
        return serialize(item)

    @router.post(
        "/upload-sessions/{session_id}/complete",
        response_model=UploadResponse,
        operation_id="complete_upload_session",
        status_code=202,
    )
    async def complete_upload_session(
        session_id: str, body: UploadComplete, request: Request
    ) -> dict[str, Any]:
        result = await asyncio.to_thread(
            get_container(request).upload_sessions.complete,
            session_id,
            expected_hash=body.expected_hash,
        )
        container_value = get_container(request)
        if container_value.index and result.job.status == "completed":
            await asyncio.to_thread(container_value.index.project_pending)
        return {"source_version": serialize(result.source_version), "job": serialize(result.job)}

    @router.get(
        "/spaces/{space_id}/sources",
        response_model=SourceListResponse,
        operation_id="list_sources",
    )
    async def list_sources(
        space_id: str,
        request: Request,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).control_plane.list_sources,
            space_id=space_id,
            cursor=cursor,
            limit=limit,
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": next_cursor}}

    @router.get(
        "/source-versions/{source_version_id}",
        response_model=SourceVersionResponse,
        operation_id="get_source_version",
    )
    async def get_source_version(source_version_id: str, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).control_plane.get_source_version, source_version_id
        )
        return serialize(item)

    @router.delete("/sources/{source_id}", operation_id="tombstone_source", status_code=202)
    async def tombstone_source(source_id: str, request: Request) -> dict[str, object]:
        container_value = get_container(request)
        await asyncio.to_thread(container_value.control_plane.tombstone_source, source_id)
        removed = 0
        if container_value.settings.inline_worker and container_value.index is not None:
            removed = await asyncio.to_thread(container_value.index.remove_source, source_id)
        return {
            "source_id": source_id,
            "status": "tombstoned",
            "projection": "removed" if removed else "queued_or_not_configured",
            "removed_projection_items": removed,
        }

    @router.get(
        "/ingestion-jobs/{job_id}",
        response_model=IngestionJobResponse,
        operation_id="get_ingestion_job",
    )
    async def get_ingestion_job(job_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(get_container(request).control_plane.get_ingestion_job, job_id)
        )

    @router.post(
        "/ingestion-jobs/{job_id}/retry",
        response_model=IngestionJobResponse,
        operation_id="retry_ingestion_job",
        status_code=202,
    )
    async def retry_ingestion_job(job_id: str, request: Request) -> dict[str, Any]:
        container_value = get_container(request)
        job = await asyncio.to_thread(
            container_value.ingestion.retry,
            job_id,
            process_inline=container_value.settings.inline_worker,
        )
        if container_value.index and job.status == "completed":
            await asyncio.to_thread(container_value.index.project_pending)
        return serialize(job)

    @router.post(
        "/ingestion-jobs/{job_id}/cancel",
        response_model=IngestionJobResponse,
        operation_id="cancel_ingestion_job",
        status_code=202,
    )
    async def cancel_ingestion_job(job_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(get_container(request).ingestion.cancel, job_id)
        )

    @router.get(
        "/ingestion-jobs/{job_id}/events",
        response_model=IngestionJobEventListResponse,
        operation_id="stream_ingestion_job_events",
    )
    async def stream_ingestion_job_events(
        job_id: str,
        request: Request,
        after: int | None = Query(default=None, ge=0),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
        stream: bool = True,
    ) -> Response:
        header_cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else None
        if after is not None and header_cursor is not None and after != header_cursor:
            raise HTTPException(
                status_code=409,
                detail={"code": "CURSOR_CONFLICT", "after": after, "last_event_id": header_cursor},
            )
        cursor = after if after is not None else (header_cursor or 0)
        repository = get_container(request).control_plane
        if not stream:
            events, next_cursor = await asyncio.to_thread(
                repository.list_ingestion_events,
                job_id,
                after=cursor,
                limit=500,
            )
            return JSONResponse(
                jsonable_encoder(
                    {
                        "items": [serialize(event) for event in events],
                        "page": {"next_cursor": next_cursor},
                    }
                )
            )

        async def event_stream():
            nonlocal cursor
            last_heartbeat = time.monotonic()
            while True:
                if await request.is_disconnected():
                    return
                events, _ = await asyncio.to_thread(
                    repository.list_ingestion_events,
                    job_id,
                    after=cursor,
                    limit=200,
                )
                for event in events:
                    cursor = event.sequence
                    data = json.dumps(serialize(event), ensure_ascii=False, default=str)
                    yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {data}\n\n"
                job = await asyncio.to_thread(repository.get_ingestion_job, job_id)
                if job.status in {"completed", "failed", "cancelled"} and not events:
                    return
                if (
                    time.monotonic() - last_heartbeat
                    >= get_container(request).settings.event_heartbeat_seconds
                ):
                    yield f": heartbeat {cursor}\n\n"
                    last_heartbeat = time.monotonic()
                await asyncio.sleep(get_container(request).settings.event_poll_seconds)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @router.post(
        "/sources/{source_id}/reprocess",
        response_model=IngestionJobResponse,
        operation_id="reprocess_source",
        status_code=202,
    )
    async def reprocess_source(source_id: str, request: Request) -> dict[str, Any]:
        container_value = get_container(request)
        job = await asyncio.to_thread(
            container_value.ingestion.reprocess,
            source_id,
            process_inline=container_value.settings.inline_worker,
        )
        if container_value.index and job.status == "completed":
            await asyncio.to_thread(container_value.index.project_pending)
        return serialize(job)

    @router.get(
        "/ingestion-jobs",
        response_model=IngestionJobListResponse,
        operation_id="list_ingestion_jobs",
    )
    async def list_ingestion_jobs(
        request: Request,
        status: str | None = None,
        space_id: str | None = None,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).control_plane.list_ingestion_jobs,
            status=status,
            space_id=space_id,
            cursor=cursor,
            limit=limit,
        )
        return {
            "items": [serialize(item) for item in items],
            "page": {"next_cursor": next_cursor},
        }

    @router.post("/ingestion-jobs/{job_id}/advance", operation_id="advance_ingestion_job")
    async def advance_ingestion_job(job_id: str, request: Request) -> dict[str, Any]:
        job = await asyncio.to_thread(get_container(request).ingestion.process_job, job_id)
        container_value = get_container(request)
        if container_value.index and job.status == "completed":
            await asyncio.to_thread(container_value.index.project_pending)
        return serialize(job)

    # ----- Evidence/Search ------------------------------------------------------------

    @router.get(
        "/evidence/{revision_id}",
        response_model=EvidenceResponse,
        operation_id="get_evidence",
    )
    async def get_evidence(revision_id: str, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).control_plane.get_evidence, revision_id
        )
        return evidence_payload(item)

    @router.get("/evidence/{revision_id}/asset", operation_id="get_evidence_asset")
    async def get_evidence_asset(
        revision_id: str,
        request: Request,
        range_header: str | None = Header(default=None, alias="Range"),
    ) -> Response:
        container_value = get_container(request)
        evidence = await asyncio.to_thread(container_value.control_plane.get_evidence, revision_id)
        source = await asyncio.to_thread(
            container_value.control_plane.get_source_version,
            evidence.source_version_id,
        )
        extra = evidence.locator.extra
        object_key = source.object_key
        if extra.get("object_key"):
            object_key = str(extra["object_key"])
        elif evidence.modality.value == "audio" and extra.get("audio_object_key"):
            object_key = str(extra["audio_object_key"])
        handle = await asyncio.to_thread(container_value.blob_store.open, object_key)
        try:
            await asyncio.to_thread(handle.seek, 0, 2)
            size = await asyncio.to_thread(handle.tell)
            start, end, status_code = _parse_range(range_header, size)
            await asyncio.to_thread(handle.seek, start)
            body = await asyncio.to_thread(handle.read, end - start + 1)
        finally:
            handle.close()
        media_type = mimetypes.guess_type(object_key)[0] or source.mime_type
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(body)),
            "Content-Disposition": (f'inline; filename="{_safe_filename(source.display_name)}"'),
        }
        if status_code == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(
            content=body,
            status_code=status_code,
            media_type=media_type,
            headers=headers,
        )

    @router.get("/evidence", response_model=EvidenceListResponse, operation_id="list_evidence")
    async def list_evidence(
        request: Request,
        space_id: str | None = None,
        source_id: str | None = None,
        modality: str | None = None,
        query: str | None = Query(default=None, min_length=1, max_length=200),
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).control_plane.list_evidence,
            space_id=space_id,
            source_id=source_id,
            modality=modality,
            cursor=cursor,
            limit=limit,
            query=query,
        )
        return {
            "items": [evidence_payload(item) for item in items],
            "page": {"next_cursor": next_cursor},
        }

    @router.post(
        "/evidence/{revision_id}/expand",
        response_model=EvidenceListResponse,
        operation_id="expand_evidence",
    )
    async def expand_evidence(
        revision_id: str,
        request: Request,
        before: int = Query(default=1, ge=0, le=20),
        after: int = Query(default=1, ge=0, le=20),
    ) -> dict[str, Any]:
        items = await asyncio.to_thread(
            get_container(request).control_plane.expand_evidence,
            revision_id,
            before=before,
            after=after,
        )
        return {"items": [evidence_payload(item) for item in items], "page": {"next_cursor": None}}

    @router.post("/evidence/compare", operation_id="compare_evidence_versions")
    async def compare_evidence(body: CompareEvidenceBody, request: Request) -> dict[str, object]:
        return await asyncio.to_thread(
            get_container(request).control_plane.compare_source_versions,
            body.left_source_version_id,
            body.right_source_version_id,
        )

    @router.post("/search", response_model=SearchResponse, operation_id="search_evidence")
    async def search_evidence(body: SearchBody, request: Request) -> dict[str, Any]:
        collection_source_ids = await asyncio.to_thread(
            get_container(request).spaces.resolve_collection_source_ids,
            tuple(body.scope.collection_ids),
        )
        pack = await asyncio.to_thread(
            get_container(request).retrieval.search,
            SearchRequest(
                query=body.query,
                scope=_scope(body.scope, collection_source_ids=collection_source_ids),
                quality_mode=body.quality_mode,
                modalities=tuple(body.modalities),
                limit=body.limit,
            ),
        )
        return {
            "query": pack.query,
            "requested_quality": pack.requested_quality,
            "actual_quality": pack.actual_quality,
            "degraded": pack.degraded,
            "degradation_reasons": list(pack.degradation_reasons),
            "coverage": pack.coverage,
            "explanation": asdict(pack.explanation) if pack.explanation else {
                "outcome": "retrieval_unavailable",
                "severity": "error",
                "scope_evidence_count": 0,
                "candidate_count": 0,
                "completed_channels": 0,
                "failed_channels": 0,
                "unavailable_channels": 0,
                "suggested_actions": ["retry_search"],
            },
            "hits": [
                {
                    "rank": hit.rank,
                    "fused_score": hit.fused_score,
                    "channels": list(hit.channels),
                    "selection_reason": hit.selection_reason,
                    "evidence": evidence_payload(hit.evidence),
                }
                for hit in pack.hits
            ],
            "channels": [
                {
                    "channel": channel.channel,
                    "status": channel.status,
                    "candidate_count": len(channel.candidates),
                    "latency_ms": channel.latency_ms,
                    "error": channel.error,
                    "model": channel.model,
                    "generation": channel.generation,
                    "native_modality": channel.native_modality,
                }
                for channel in pack.channels
            ],
        }

    # ----- Runs and durable events ----------------------------------------------------

    @router.post("/runs", response_model=RunResponse, operation_id="create_run", status_code=202)
    async def create_run(
        body: RunCreate,
        request: Request,
        response: Response,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> dict[str, Any]:
        routing_trace: dict[str, object] = {}
        if body.auto_route:
            routing_trace = await asyncio.to_thread(
                get_container(request).space_intelligence.route,
                body.goal,
            )
            routed_space_ids = tuple(routing_trace.get("selected_space_ids", []))
        else:
            routed_space_ids = tuple(body.scope.space_ids)
        scope_policy = await asyncio.to_thread(
            get_container(request).spaces.usage_recommendation,
            routed_space_ids,
        )
        resolved_kind = body.kind or RunKind(str(scope_policy["recommended_kind"]))
        resolved_quality = body.quality_mode
        if resolved_quality is None:
            resolved_quality = (
                QualityMode.DEEP
                if resolved_kind == RunKind.RESEARCH
                else QualityMode(str(scope_policy["recommended_quality"]))
            )
        source_ids = set(body.scope.source_ids)
        collection_source_ids = await asyncio.to_thread(
            get_container(request).spaces.resolve_collection_source_ids,
            tuple(body.scope.collection_ids),
        )
        source_ids.update(collection_source_ids)
        if body.attachment_source_ids:
            source_ids.update(body.attachment_source_ids)
        resolved_scope = ScopeCapsule(
            space_ids=routed_space_ids,
            collection_ids=tuple(body.scope.collection_ids),
            source_ids=tuple(sorted(source_ids)),
            global_search=body.scope.global_search if not body.auto_route else False,
            publish_watermark=body.scope.publish_watermark,
        )
        run = await asyncio.to_thread(
            get_container(request).run_service.create,
            goal=body.goal,
            kind=resolved_kind,
            scope=resolved_scope,
            quality_mode=resolved_quality,
            idempotency_key=idempotency_key,
            execute=body.execute,
            conversation_id=body.conversation_id,
            parent_run_id=body.parent_run_id,
            attachment_source_ids=tuple(body.attachment_source_ids),
            selected_model_deployment_id=body.selected_model_deployment_id,
            routing_trace=routing_trace,
            scope_policy=scope_policy,
        )
        response.headers["Location"] = f"/api/v1/runs/{run.id}"
        return serialize(run)

    @router.get(
        "/conversations",
        response_model=ConversationListResponse,
        operation_id="list_conversations",
    )
    async def list_conversations(
        request: Request,
        query: str | None = Query(default=None, max_length=200),
        archived: bool = False,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).conversations.list,
            query=query,
            archived=archived,
            cursor=cursor,
            limit=limit,
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": next_cursor}}

    @router.get(
        "/conversations/{conversation_id}",
        response_model=ConversationResponse,
        operation_id="get_conversation",
    )
    async def get_conversation(conversation_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(
                get_container(request).conversations.get,
                conversation_id,
            )
        )

    @router.patch(
        "/conversations/{conversation_id}",
        response_model=ConversationResponse,
        operation_id="update_conversation",
    )
    async def update_conversation(
        conversation_id: str,
        body: ConversationUpdate,
        request: Request,
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).conversations.update,
            conversation_id,
            expected_revision=body.expected_revision,
            title=body.title,
            pinned=body.pinned,
            archived=body.archived,
        )
        return serialize(item)

    @router.get("/runs", response_model=RunListResponse, operation_id="list_runs")
    async def list_runs(
        request: Request,
        status: str | None = None,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).runs_repository.list_runs,
            status=status,
            cursor=cursor,
            limit=limit,
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": next_cursor}}

    @router.get("/runs/{run_id}", response_model=RunResponse, operation_id="get_run")
    async def get_run(run_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).run_service.get, run_id))

    @router.get(
        "/runs/{run_id}/suggested-questions",
        response_model=RunSuggestedQuestionListResponse,
        operation_id="get_run_suggested_questions",
    )
    async def get_run_suggested_questions(
        run_id: str,
        request: Request,
        limit: int = Query(default=3, ge=1, le=6),
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            get_container(request).run_suggestions.suggest,
            run_id,
            limit=limit,
        )

    @router.get(
        "/conversations/{conversation_id}/runs",
        response_model=RunListResponse,
        operation_id="list_conversation_runs",
    )
    async def list_conversation_runs(conversation_id: str, request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(
            get_container(request).runs_repository.list_conversation,
            conversation_id,
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": None}}

    @router.get(
        "/runs/{run_id}/snapshot",
        response_model=RunSnapshotResponse,
        operation_id="get_run_snapshot",
    )
    async def get_run_snapshot(run_id: str, request: Request) -> dict[str, Any]:
        repository = get_container(request).runs_repository
        snapshot = await asyncio.to_thread(repository.get_snapshot, run_id)
        run = await asyncio.to_thread(repository.get_run, run_id)
        events, _ = await asyncio.to_thread(repository.list_events, run_id, after=0, limit=10000)
        return {
            **serialize(snapshot),
            "state": serialize(run),
            "base_cursor": events[-1].sequence if events else 0,
        }

    @router.get("/runs/{run_id}/events", operation_id="stream_run_events")
    async def stream_run_events(
        run_id: str,
        request: Request,
        after: int | None = Query(default=None, ge=0),
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
        stream: bool = True,
    ) -> Response:
        header_cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else None
        if after is not None and header_cursor is not None and after != header_cursor:
            raise HTTPException(
                status_code=409,
                detail={"code": "CURSOR_CONFLICT", "after": after, "last_event_id": header_cursor},
            )
        cursor = after if after is not None else (header_cursor or 0)
        repository = get_container(request).runs_repository
        if not stream:
            events, next_cursor = await asyncio.to_thread(
                repository.list_events, run_id, after=cursor, limit=500
            )
            return JSONResponse(
                jsonable_encoder(
                    {
                        "items": [serialize(event) for event in events],
                        "page": {"next_cursor": next_cursor},
                    }
                )
            )

        async def event_stream():
            nonlocal cursor
            last_heartbeat = time.monotonic()
            while True:
                if await request.is_disconnected():
                    return
                events, _ = await asyncio.to_thread(
                    repository.list_events, run_id, after=cursor, limit=200
                )
                for event in events:
                    cursor = event.sequence
                    data = json.dumps(serialize(event), ensure_ascii=False, default=str)
                    yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {data}\n\n"
                run = await asyncio.to_thread(repository.get_run, run_id)
                if run.status.value in TERMINAL_RUN_STATUSES and not events:
                    return
                if (
                    time.monotonic() - last_heartbeat
                    >= get_container(request).settings.event_heartbeat_seconds
                ):
                    yield f": heartbeat {cursor}\n\n"
                    last_heartbeat = time.monotonic()
                await asyncio.sleep(get_container(request).settings.event_poll_seconds)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @router.post("/runs/{run_id}/pause", response_model=RunResponse, operation_id="pause_run")
    async def pause_run(run_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).run_service.pause, run_id))

    @router.post("/runs/{run_id}/resume", response_model=RunResponse, operation_id="resume_run")
    async def resume_run(run_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).run_service.resume, run_id))

    @router.post("/runs/{run_id}/cancel", response_model=RunResponse, operation_id="cancel_run")
    async def cancel_run(run_id: str, request: Request) -> dict[str, Any]:
        return serialize(await asyncio.to_thread(get_container(request).run_service.cancel, run_id))

    # ----- Assets ---------------------------------------------------------------------

    @router.get("/assets/{source_version_id}", operation_id="get_asset")
    async def get_asset(
        source_version_id: str,
        request: Request,
        range_header: str | None = Header(default=None, alias="Range"),
    ) -> Response:
        container_value = get_container(request)
        source = await asyncio.to_thread(
            container_value.control_plane.get_source_version, source_version_id
        )
        start, end, status_code = _parse_range(range_header, source.byte_size)
        handle = await asyncio.to_thread(container_value.blob_store.open, source.object_key)
        try:
            await asyncio.to_thread(handle.seek, start)
            body = await asyncio.to_thread(handle.read, end - start + 1)
        finally:
            handle.close()
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(body)),
            "Content-Disposition": f'inline; filename="{_safe_filename(source.display_name)}"',
        }
        if status_code == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{source.byte_size}"
        return Response(
            content=body, status_code=status_code, media_type=source.mime_type, headers=headers
        )

    # ----- Artifacts ------------------------------------------------------------------

    @router.get(
        "/artifact-templates",
        response_model=ArtifactTemplateListResponse,
        operation_id="list_artifact_templates",
    )
    async def list_artifact_templates() -> dict[str, Any]:
        return {"items": [serialize(item) for item in ARTIFACT_TEMPLATES]}

    @router.post(
        "/artifacts/from-template",
        response_model=ArtifactResponse,
        operation_id="create_artifact_from_template",
        status_code=201,
    )
    async def create_artifact_from_template(
        body: ArtifactFromTemplateCreate, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).runs_repository.create_artifact_from_template,
            source_artifact_id=body.source_artifact_id,
            template_id=body.template_id,
            title=body.title,
            review_text=body.review_text,
        )
        return serialize(item)

    @router.get(
        "/artifacts/{artifact_id}",
        response_model=ArtifactResponse,
        operation_id="get_artifact",
    )
    async def get_artifact(artifact_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(
                get_container(request).runs_repository.get_artifact, artifact_id
            )
        )

    @router.patch(
        "/artifacts/{artifact_id}",
        response_model=ArtifactResponse,
        operation_id="revise_artifact",
    )
    async def revise_artifact(
        artifact_id: str, body: ArtifactRevisionCreate, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).runs_repository.revise_artifact,
            artifact_id,
            canonical_document=body.canonical_document,
            expected_revision_no=body.expected_revision_no,
        )
        return serialize(item)

    @router.patch(
        "/artifacts/{artifact_id}/status",
        response_model=ArtifactResponse,
        operation_id="set_artifact_status",
    )
    async def set_artifact_status(
        artifact_id: str, body: ArtifactStatusUpdate, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).runs_repository.set_artifact_status,
            artifact_id,
            status=body.status,
            expected_revision_no=body.expected_revision_no,
        )
        return serialize(item)

    @router.get("/artifacts", response_model=ArtifactListResponse, operation_id="list_artifacts")
    async def list_artifacts(
        request: Request,
        cursor: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> dict[str, Any]:
        items, next_cursor = await asyncio.to_thread(
            get_container(request).runs_repository.list_artifacts,
            cursor=cursor,
            limit=limit,
        )
        return {"items": [serialize(item) for item in items], "page": {"next_cursor": next_cursor}}

    @router.get(
        "/artifacts/{artifact_id}/refresh-proposals",
        response_model=ArtifactRefreshProposalListResponse,
        operation_id="list_artifact_refresh_proposals",
    )
    async def list_artifact_refresh_proposals(artifact_id: str, request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(
            get_container(request).runs_repository.list_artifact_refresh_proposals,
            artifact_id,
        )
        return {"items": [serialize(item) for item in items]}

    @router.post(
        "/artifact-refresh-proposals/{proposal_id}/resolve",
        response_model=ArtifactRefreshProposalResponse,
        operation_id="resolve_artifact_refresh_proposal",
    )
    async def resolve_artifact_refresh_proposal(
        proposal_id: str, body: ArtifactRefreshResolution, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).runs_repository.resolve_artifact_refresh_proposal,
            proposal_id,
            accept=body.accept,
        )
        return serialize(item)

    @router.get("/artifacts/{artifact_id}/render", operation_id="render_artifact")
    async def render_artifact(
        artifact_id: str,
        request: Request,
        format: str = Query(default="markdown", pattern="^(json|markdown|html|pdf|csv|xlsx)$"),
    ) -> Response:
        artifact = await asyncio.to_thread(
            get_container(request).runs_repository.get_artifact, artifact_id
        )
        metadata = ArtifactRenderMetadata(
            artifact_id=artifact.id,
            artifact_type=artifact.artifact_type,
            bound_evidence_count=artifact.coverage.bound_evidence_count,
            content_block_count=artifact.coverage.content_block_count,
            coverage_percent=artifact.coverage.coverage_percent,
            pending_refresh_count=artifact.pending_refresh_count,
            revision_id=artifact.revision_id,
            revision_no=artifact.revision_no,
            status=artifact.status,
            supported_block_count=artifact.coverage.supported_block_count,
            updated_at=artifact.updated_at,
        )
        body, media_type, extension = await asyncio.to_thread(
            render_canonical_artifact, artifact.canonical_document, format, metadata
        )
        return Response(
            body,
            media_type=media_type,
            headers=_artifact_render_headers(artifact, format, extension),
        )

    # ----- Operations -----------------------------------------------------------------

    @router.post(
        "/model-providers",
        response_model=ProviderResponse,
        operation_id="create_model_provider",
        status_code=201,
    )
    async def create_model_provider(body: ProviderCreate, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).model_catalog.create_provider,
            name=body.name,
            protocol_family=body.protocol_family,
            endpoint=body.endpoint,
            secret_ref=body.secret_ref,
        )
        return serialize(item)

    @router.get(
        "/model-providers",
        response_model=ProviderListResponse,
        operation_id="list_model_providers",
    )
    async def list_model_providers(request: Request) -> dict[str, Any]:
        await asyncio.to_thread(get_container(request).model_catalog.ensure_managed)
        items = await asyncio.to_thread(
            get_container(request).model_catalog.repository.list_providers
        )
        return {"items": [serialize(item) for item in items]}

    @router.post("/model-catalog/sync", operation_id="sync_model_catalog")
    async def sync_model_catalog(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(get_container(request).model_catalog.sync_managed)

    @router.post(
        "/model-catalog/verify-configured",
        operation_id="verify_configured_models",
    )
    async def verify_configured_models(request: Request) -> dict[str, Any]:
        return await asyncio.to_thread(get_container(request).model_catalog.verify_configured)

    @router.get(
        "/model-setup",
        response_model=ModelSetupResponse,
        operation_id="get_recommended_model_setup",
    )
    async def get_recommended_model_setup(request: Request) -> dict[str, Any]:
        await asyncio.to_thread(get_container(request).model_catalog.ensure_managed)
        return await asyncio.to_thread(get_container(request).model_catalog.recommend_setup)

    @router.post(
        "/model-setup/apply",
        response_model=ModelSetupApplyResponse,
        operation_id="apply_recommended_model_setup",
    )
    async def apply_recommended_model_setup(
        body: ModelSetupApplyRequest,
        request: Request,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            get_container(request).model_catalog.apply_recommended_setup,
            replace_existing=body.replace_existing,
        )

    @router.post(
        "/model-providers/{provider_id}/discover",
        response_model=ModelListResponse,
        operation_id="discover_models",
    )
    async def discover_models(provider_id: str, request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(get_container(request).model_catalog.discover, provider_id)
        return {"items": [serialize(item) for item in items]}

    @router.post(
        "/model-providers/{provider_id}/models",
        response_model=ModelResponseSchema,
        operation_id="register_provider_model",
        status_code=201,
    )
    async def register_provider_model(
        provider_id: str, body: ModelRegistrationCreate, request: Request
    ) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).model_catalog.register_model,
            provider_id,
            upstream_model_id=body.upstream_model_id,
            declared_capabilities=body.declared_capabilities,
        )
        return serialize(item)

    @router.get("/models", response_model=ModelListResponse, operation_id="list_models")
    async def list_models(request: Request, provider_id: str | None = None) -> dict[str, Any]:
        await asyncio.to_thread(get_container(request).model_catalog.ensure_managed)
        items = await asyncio.to_thread(
            get_container(request).model_catalog.repository.list_models, provider_id
        )
        return {"items": [serialize(item) for item in items]}

    @router.post(
        "/models/{model_id}/probe",
        response_model=ModelResponseSchema,
        operation_id="probe_model",
    )
    async def probe_model(model_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(get_container(request).model_catalog.probe, model_id)
        )

    @router.post(
        "/models/{model_id}/enable",
        response_model=ModelResponseSchema,
        operation_id="enable_model",
    )
    async def enable_model(model_id: str, request: Request) -> dict[str, Any]:
        return serialize(
            await asyncio.to_thread(get_container(request).model_catalog.enable, model_id)
        )

    @router.post(
        "/model-routes",
        response_model=ModelRouteResponse,
        operation_id="create_model_route",
        status_code=201,
    )
    async def create_model_route(body: ModelRouteCreate, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).model_catalog.create_route,
            role=body.role,
            deployment_ids=body.deployment_ids,
            required_capabilities=body.required_capabilities,
        )
        return serialize(item)

    @router.get(
        "/model-routes",
        response_model=ModelRouteListResponse,
        operation_id="list_model_routes",
    )
    async def list_model_routes(request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(get_container(request).model_catalog.list_routes)
        return {"items": [serialize(item) for item in items]}

    @router.post(
        "/model-routes/{route_id}/activate",
        response_model=ModelRouteResponse,
        operation_id="activate_model_route",
    )
    async def activate_model_route(route_id: str, request: Request) -> dict[str, Any]:
        item = await asyncio.to_thread(
            get_container(request).model_catalog.activate_route, route_id
        )
        return serialize(item)

    @router.get("/tools", response_model=ToolListResponse, operation_id="list_tools")
    async def list_tools(request: Request) -> dict[str, Any]:
        items = await asyncio.to_thread(get_container(request).tools.list)
        return {"items": [serialize(item) for item in items]}

    @router.get(
        "/agent-profiles",
        response_model=AgentProfileListResponse,
        operation_id="list_agent_profiles",
    )
    async def list_agent_profiles(request: Request) -> dict[str, object]:
        container_value = get_container(request)
        enabled_tools = [item.name for item in container_value.tools.list() if item.enabled]
        knowledge_tools = [
            item for item in enabled_tools if item not in {"web_read", "mcp_read", "sql_read"}
        ]
        return {
            "items": [
                {
                    "id": "quick-answer",
                    "enabled": True,
                    "description": "Quality retrieval, evidence-bound synthesis and T1/T3 gate.",
                    "default_quality": "quality",
                    "minimum_verification": "T1",
                    "tools": knowledge_tools,
                    "policy": {
                        "scope_expansion": False,
                        "external_tools": False,
                        "partial_delivery": True,
                    },
                },
                {
                    "id": "deep-research",
                    "enabled": container_value.settings.research_runtime_enabled,
                    "description": (
                        "Durable plan, evidence gain, checkpoints, T2/T3 gate and Artifact."
                    ),
                    "default_quality": "deep",
                    "minimum_verification": "T2",
                    "tools": enabled_tools,
                    "policy": {
                        "scope_expansion": False,
                        "external_tools": container_value.settings.external_tools_enabled,
                        "safety_fuse": "no_evidence_gain",
                        "partial_delivery": True,
                    },
                },
            ]
        }

    @router.get("/system/config", operation_id="get_safe_system_config")
    async def get_safe_system_config(request: Request) -> dict[str, object]:
        value = get_container(request).settings
        return {
            "environment": value.environment,
            "agent_runtime": value.agent_runtime,
            "research_runtime_enabled": value.research_runtime_enabled,
            "external_tools_enabled": value.external_tools_enabled,
            "sandbox_backend": value.sandbox_backend,
            "sandbox": get_container(request).sandbox_runner.health(),
            "knowledge_compilation_enabled": value.knowledge_compilation_enabled,
            "background_enrichment_enabled": value.background_enrichment_enabled,
            "page_multivector_enabled": value.page_multivector_enabled,
            "feature_models_enabled": value.feature_models_enabled,
            "media_enrichment_enabled": value.media_enrichment_enabled,
            "worker_lease_seconds": value.worker_lease_seconds,
            "max_upload_bytes": value.max_upload_bytes,
            "connector_max_download_bytes": value.connector_max_download_bytes,
            "connectors": {
                "allowed_folder_roots": [
                    str(path) for path in value.connector_allowed_folder_roots
                ],
                "news_search_configured": bool(os.environ.get("TAVILY_API_KEY", "").strip()),
                "google_images_configured": bool(os.environ.get("SERPAPI_KEY", "").strip()),
                "pixabay_configured": bool(os.environ.get("PIXABAY_API_KEY", "").strip()),
                "internet_archive_configured": True,
            },
            "secrets": {
                "mineru_configured": value.mineru_token is not None,
                "generation_configured": value.generation_api_key is not None,
                "embedding_configured": value.embedding_api_key is not None,
                "reranker_configured": value.reranker_api_key is not None,
                "feishu_configured": bool(value.feishu_app_id and value.feishu_app_secret),
            },
        }

    @router.post(
        "/runs/{run_id}/tools/{tool_name}/execute",
        response_model=ToolExecutionResponse,
        operation_id="execute_read_only_tool",
    )
    async def execute_read_only_tool(
        run_id: str, tool_name: str, body: ToolExecuteBody, request: Request
    ) -> dict[str, Any]:
        execution = await asyncio.to_thread(
            get_container(request).tool_executor.execute,
            run_id=run_id,
            tool_name=tool_name,
            payload=body.payload,
            idempotency_key=body.idempotency_key,
        )
        return serialize(execution)

    @router.post("/indexes/rebuild", operation_id="rebuild_indexes", status_code=202)
    async def rebuild_indexes(request: Request) -> dict[str, object]:
        container_value = get_container(request)
        index = container_value.index
        if index is None:
            return {"status": "unavailable", "reason": "qdrant_not_configured"}
        if not container_value.settings.inline_worker:
            from nexus.infrastructure.celery.app import celery_app

            result = celery_app.send_task("nexus.index.rebuild", queue="index")
            return {"status": "queued", "task_id": result.id, "durable_truth": "postgresql"}
        return await asyncio.to_thread(
            index.project_pending,
            limit=100000,
            force_rebuild=True,
        )

    @router.get("/system/indexes", operation_id="get_index_health")
    async def get_index_health(request: Request) -> dict[str, object]:
        index = get_container(request).index
        return (
            await asyncio.to_thread(index.health)
            if index
            else {"status": "not_configured", "reason": "qdrant_not_configured"}
        )

    @router.post("/reconciliation", operation_id="run_reconciliation")
    async def run_reconciliation(request: Request) -> dict[str, object]:
        return await asyncio.to_thread(get_container(request).operations.reconcile)

    @router.post("/backups", operation_id="create_backup", status_code=202)
    async def create_backup(request: Request) -> dict[str, object]:
        container_value = get_container(request)
        return await asyncio.to_thread(
            container_value.operations.backup,
            container_value.settings.backup_root,
        )

    @router.get("/backups", response_model=BackupListResponse, operation_id="list_backups")
    async def list_backups(request: Request) -> dict[str, object]:
        items = await asyncio.to_thread(get_container(request).operations.list_backups)
        return {"items": items}

    @router.get("/system/health", response_model=HealthResponse, operation_id="get_system_health")
    async def system_health(request: Request) -> dict[str, Any]:
        container_value = get_container(request)
        database_status: dict[str, Any]
        try:
            with container_value.database.transaction() as session:
                session.execute(text("SELECT 1"))
            database_status = {"status": "ready", "detail": {"authoritative": True}}
        except Exception as exc:
            database_status = {
                "status": "unavailable",
                "detail": {"error_type": type(exc).__name__},
            }
        index_health = (
            await asyncio.to_thread(container_value.index.health)
            if container_value.index
            else {"status": "not_configured"}
        )
        model_health = container_value.model_gateway.health()
        mineru_credential = (
            container_value.mineru.credential_status()
            if container_value.mineru
            else {"status": "not_configured", "token_configured": False}
        )
        mineru_credential_status = str(mineru_credential.get("status"))
        feishu_health = (
            FeishuStateStore(container_value.settings.redis_url).health()
            if container_value.settings.feishu_enabled
            else {"status": "not_configured", "worker_heartbeat": False}
        )
        media_health = (
            container_value.media_analyzer.health()
            if container_value.media_analyzer
            else {"status": "not_configured"}
        )
        worker_health: dict[str, Any]
        if container_value.settings.redis_url:
            try:
                from redis import Redis

                redis_client = Redis.from_url(container_value.settings.redis_url)
                worker_keys = list(redis_client.scan_iter(match="nexus:worker:*", count=100))
                roles = sorted(
                    {
                        key.decode().split(":", 3)[2]
                        for key in worker_keys
                        if len(key.decode().split(":", 3)) >= 3
                    }
                )
                worker_health = {
                    "status": "ready" if worker_keys else "degraded",
                    "worker_count": len(worker_keys),
                    "roles": roles,
                    "broker": "redis",
                    "durable_truth": "postgresql",
                }
            except Exception as exc:
                worker_health = {
                    "status": "unavailable",
                    "worker_count": 0,
                    "roles": [],
                    "error_type": type(exc).__name__,
                }
        else:
            worker_health = {"status": "not_configured", "worker_count": 0, "roles": []}
        components = {
            "postgres": database_status,
            "blob": {
                "status": "ready",
                "detail": {"backend": container_value.settings.blob_backend},
            },
            "qdrant": {"status": index_health.get("status", "unavailable"), "detail": index_health},
            "model_gateway": {
                "status": model_health.get("status", "unavailable"),
                "detail": model_health,
            },
            "mineru": {
                "status": (
                    "ready"
                    if mineru_credential_status == "configured"
                    else (
                        "unavailable" if mineru_credential_status == "expired" else "not_configured"
                    )
                ),
                "detail": {
                    **mineru_credential,
                    "adapter": "precision_api",
                    "model": container_value.settings.mineru_model,
                },
            },
            "feishu": {
                "status": feishu_health.get("status", "unavailable"),
                "detail": {
                    **feishu_health,
                    "enabled": container_value.settings.feishu_enabled,
                    "app_id_configured": bool(container_value.settings.feishu_app_id),
                    "app_secret_configured": bool(container_value.settings.feishu_app_secret),
                    "transport": "long_connection",
                },
            },
            "media_enrichment": {
                "status": media_health.get("status", "not_configured"),
                "detail": media_health,
            },
            "workers": {
                "status": worker_health["status"],
                "detail": worker_health,
            },
        }
        control_ready = database_status["status"] == "ready"
        overall = (
            "ready"
            if control_ready and all(item["status"] == "ready" for item in components.values())
            else ("degraded" if control_ready else "unavailable")
        )
        return {
            "status": overall,
            "control_ready": control_ready,
            "capabilities": components,
            "version": __version__,
        }

    app.include_router(router)
    app.state.telemetry_configured = configure_telemetry(app, configured)

    @app.post("/mcp", include_in_schema=False)
    async def mcp_endpoint(request: Request) -> Response:
        origin = request.headers.get("origin")
        if origin and origin not in configured.cors_origins:
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32000, "message": "Forbidden Origin"},
                },
                status_code=403,
            )
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                status_code=400,
            )
        if not isinstance(body, dict):
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {
                        "code": -32600,
                        "message": "Batch requests are not supported",
                    },
                },
                status_code=400,
            )
        response = await asyncio.to_thread(NexusMcpServer(get_container(request)).handle, body)
        if response is None:
            return Response(status_code=202)
        return JSONResponse(response)

    @app.get("/mcp", include_in_schema=False)
    async def mcp_stream_not_enabled() -> Response:
        return Response(status_code=405, headers={"Allow": "POST"})

    @app.get("/health/live", include_in_schema=False)
    async def live() -> dict[str, str]:
        return {"status": "alive", "version": __version__}

    @app.get("/health/ready", include_in_schema=False)
    async def ready(request: Request) -> Response:
        try:
            with get_container(request).database.transaction() as session:
                session.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready", "control_ready": True})
        except Exception:
            return JSONResponse({"status": "unavailable", "control_ready": False}, status_code=503)

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"service": "MMA-RAG Nexus", "version": __version__, "api": "/api/v1"}

    return app


def _scope(body: Any, *, collection_source_ids: tuple[str, ...] = ()) -> ScopeCapsule:
    return ScopeCapsule(
        space_ids=tuple(body.space_ids),
        collection_ids=tuple(getattr(body, "collection_ids", ())),
        source_ids=tuple(sorted(set(body.source_ids) | set(collection_source_ids))),
        global_search=body.global_search,
        publish_watermark=body.publish_watermark,
    )


def _error_payload(
    request: Request,
    code: str,
    message: str,
    details: dict[str, Any],
    retryable: bool,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "trace_id": getattr(request.state, "trace_id", new_id()),
            "retryable": retryable,
        }
    }


def _parse_range(value: str | None, size: int) -> tuple[int, int, int]:
    if not value:
        return 0, max(0, size - 1), 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match:
        raise HTTPException(status_code=416, detail="Invalid Range header")
    start_text, end_text = match.groups()
    if not start_text:
        length = int(end_text or 0)
        start = max(0, size - length)
        end = size - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    if start < 0 or start >= size or end < start:
        raise HTTPException(status_code=416, detail="Range is outside the asset")
    return start, min(end, size - 1), 206


def _safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", value)[:180] or "asset"


def _safe_slug(value: object, *, fallback: str, max_length: int = 72) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(value or "").lower()).strip("-")
    return slug[:max_length].strip("-") or fallback


def _artifact_delivery_filename(artifact: Any, extension: str) -> str:
    title = _safe_slug(artifact.title, fallback="")
    if not title:
        title = f"artifact-{_safe_slug(artifact.id, fallback='unknown', max_length=8)}"
    status = _safe_slug(artifact.status, fallback="candidate", max_length=24)
    revision = _safe_slug(artifact.revision_id, fallback="revision", max_length=8)
    filename = f"{title}-{status}-v{artifact.revision_no}-{revision}.{extension}"
    return _safe_filename(filename)


def _artifact_render_headers(artifact: Any, format_name: str, extension: str) -> dict[str, str]:
    disposition = "attachment" if format_name in {"pdf", "csv", "xlsx"} else "inline"
    filename = _artifact_delivery_filename(artifact, extension)
    return {
        "Content-Disposition": f'{disposition}; filename="{filename}"',
        "Cache-Control": "private, max-age=0, must-revalidate",
        "ETag": f'W/"{artifact.revision_id}-{artifact.status}-{format_name}"',
        "X-Nexus-Artifact-Coverage": str(artifact.coverage.coverage_percent),
        "X-Nexus-Artifact-Evidence-Count": str(artifact.coverage.bound_evidence_count),
        "X-Nexus-Artifact-ID": str(artifact.id),
        "X-Nexus-Artifact-Render-Format": format_name,
        "X-Nexus-Artifact-Revision": str(artifact.revision_id),
        "X-Nexus-Artifact-Revision-No": str(artifact.revision_no),
        "X-Nexus-Artifact-Status": str(artifact.status),
    }


app = create_app()
