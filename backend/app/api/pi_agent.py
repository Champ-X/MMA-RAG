"""Versioned Pi API. Importing the router does not start workers or touch old modes."""
from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from app.modules.pi_agent.config import get_pi_settings
from app.modules.pi_agent.contracts import RunRequest, TERMINAL_STATUSES
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.store import RunConflict, RunNotFound

router = APIRouter()
_supervisor = None


def owner_for(request: Request):
    settings = get_pi_settings()
    if not settings.enabled:
        raise HTTPException(503, "纯 Agent 模式尚未启用")
    if settings.api_token:
        expected = "Bearer " + settings.api_token.get_secret_value()
        if not hmac.compare_digest(request.headers.get("authorization", ""), expected):
            raise HTTPException(401, "纯 Agent 服务需要已配置的访问凭证")
        return settings.trusted_user_id or "configured-workspace"
    try:
        loopback = ipaddress.ip_address(request.client.host if request.client else "").is_loopback
    except ValueError:
        loopback = False
    origin = request.headers.get("origin")
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if (not loopback or request.url.hostname not in local_hosts or
            origin and urlparse(origin).hostname not in local_hosts):
        raise HTTPException(403, "默认纯 Agent 服务仅允许本机工作区访问；远程部署需配置 PI_AGENT_API_TOKEN")
    # Current Tessmora is a single-user local workspace. This is not advertised
    # as application RBAC: remote deployments must supply a trusted identity.
    return settings.trusted_user_id or "local-workspace"


def host():
    global _supervisor
    if _supervisor is None:
        from app.core.llm.manager import llm_manager
        from app.modules.pi_agent.supervisor import PiSupervisor
        try:
            _supervisor = PiSupervisor(get_pi_settings(), llm_manager.registry)
        except ToolError as error:
            raise HTTPException(503, {"code": error.code, "message": str(error)}) from None
    return _supervisor


async def stop_pi_supervisor():
    global _supervisor
    if _supervisor:
        await _supervisor.close()
        _supervisor = None


def translate(error):
    if isinstance(error, RunNotFound):
        return HTTPException(404, "任务或来源不存在")
    if isinstance(error, RunConflict):
        return HTTPException(409, str(error))
    if isinstance(error, ToolError):
        status = 429 if error.code == "queue_full" else 403 if error.code == "scope_denied" else 422
        return HTTPException(status, {"code": error.code, "message": str(error), "retryable": error.retryable})
    return HTTPException(422, "请求参数、附件或行内引用无效，请检查后重试")


@router.get("/config")
async def configuration(owner=Depends(owner_for)):
    from app.core.llm.manager import llm_manager
    settings = get_pi_settings()
    models = [name for name in llm_manager.registry.list_models("chat")
              if not settings.allowed_models or name in settings.allowed_models]
    return {"engine": "pi", "protocol_version": 1, "enabled": settings.enabled, "default_model": settings.model,
            "models": models, "budget": settings.budget.model_dump(), "max_concurrent_runs": settings.max_concurrent_runs,
            "tools": ["list_sources", "search", "read_source", "expand_context", "recall_evidence", "inspect_media", "query_table", "submit_answer", "ask_user"]}


@router.post("/runs")
async def create_run(request: Request, owner=Depends(owner_for)):
    supervisor = host()
    try:
        if request.headers.get("content-type", "").startswith("multipart/form-data"):
            form = await request.form(max_files=3, max_fields=10)
            spec = RunRequest.model_validate_json(str(form.get("request") or ""))
            if spec.attachments:
                raise ToolError("invalid_attachment", "上传请求中的附件应由服务端生成描述")
            files = form.getlist("files")
            from app.modules.chat.references import normalize_attachment_ids
            from app.modules.chat.attachment_summarizer import _classify_attachment
            from app.modules.chat.media_probe import inspect_attachment_media
            from app.modules.pi_agent.uploads import save_attachment
            identities = normalize_attachment_ids(form.get("attachment_ids"), len(files))
            descriptors = []
            for identity, upload in zip(identities, files):
                raw = await upload.read(30 * 1024 * 1024 + 1)
                await upload.close()
                if not raw or len(raw) > 30 * 1024 * 1024:
                    raise ToolError("attachment_too_large", "每个本机附件最多 30 MB")
                kind = _classify_attachment(upload.filename or "attachment", upload.content_type or "", raw)
                if kind != "video" and len(raw) > 10 * 1024 * 1024:
                    raise ToolError("attachment_too_large", "本机图片或音频最多 10 MB")
                await supervisor.blocking(inspect_attachment_media, raw, kind)
                descriptors.append(await supervisor.blocking(save_attachment, raw, owner=owner, identity=identity,
                    name=upload.filename or "attachment", kind=kind, settings=supervisor.settings))
            spec = spec.model_copy(update={"attachments": descriptors})
        else:
            # Keep non-multipart requests bounded before JSON decoding.
            raw = bytearray()
            async for part in request.stream():
                raw.extend(part)
                if len(raw) > 256 * 1024:
                    raise HTTPException(413, "请求过大")
            spec = RunRequest.model_validate_json(raw)
        return await supervisor.start(spec, owner)
    except (ValueError, ToolError, RunNotFound, RunConflict, ValidationError) as error:
        raise translate(error) from None


@router.get("/runs")
async def list_runs(session_id: str, owner=Depends(owner_for)):
    return {"runs": host().store.list_runs(owner, session_id)}


@router.get("/runs/{run_id}")
async def read_run(run_id: str, owner=Depends(owner_for)):
    try:
        return host().store.get(run_id, owner=owner)
    except RunNotFound as error:
        raise translate(error) from None


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, owner=Depends(owner_for)):
    try:
        return await host().cancel(run_id, owner)
    except (RunNotFound, RunConflict) as error:
        raise translate(error) from None


@router.get("/runs/{run_id}/events")
async def events(run_id: str, request: Request, after: int = 0, owner=Depends(owner_for)):
    supervisor = host()
    try:
        supervisor.store.get(run_id, owner=owner)
    except RunNotFound as error:
        raise translate(error) from None
    last_id = request.headers.get("last-event-id", "")
    if last_id:
        prefix, _, sequence = last_id.rpartition(":")
        if prefix != run_id or not sequence.isdecimal():
            raise HTTPException(400, "事件游标不属于此任务")
        after = max(after, int(sequence))
    if after < 0:
        raise HTTPException(400, "事件游标无效")
    async def stream():
        cursor, heartbeats = after, 0
        while not await request.is_disconnected():
            batch = supervisor.store.events(run_id, after=cursor, owner=owner)
            for event in batch:
                cursor = event["seq"]
                yield f"id: {event['event_id']}\nevent: pi\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            run = supervisor.store.get(run_id, owner=owner)
            if run["status"] in TERMINAL_STATUSES and cursor >= run["seq"]:
                break
            if not batch:
                heartbeats += 1
                if heartbeats % 40 == 0:
                    yield ": keepalive\n\n"
                await asyncio.sleep(.25)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}/evidence")
async def evidence(run_id: str, owner=Depends(owner_for)):
    try:
        return {"evidence": [e.model_dump() for e in host().store.evidence(run_id, owner=owner)]}
    except RunNotFound as error:
        raise translate(error) from None


@router.get("/runs/{run_id}/artifacts/{artifact_id}")
async def artifact(run_id: str, artifact_id: str, owner=Depends(owner_for)):
    if not artifact_id.startswith("tool_"):
        raise HTTPException(404, "工具结果不存在")
    try:
        return host().store.artifact(run_id, artifact_id, owner=owner)
    except RunNotFound as error:
        raise translate(error) from None


@router.get("/runs/{run_id}/sources/{source_id}/content")
async def source_content(run_id: str, source_id: str, owner=Depends(owner_for)):
    from app.modules.pi_agent.catalog import Source, SourceCatalog
    supervisor = host()
    try:
        sources = supervisor.store.artifact(run_id, "_sources", owner=owner)
        value = next((s for s in sources if s["id"] == source_id), None)
        if not value:
            raise RunNotFound(source_id)
        source = Source(**value)
        # The snapshot is immutable. Re-check current deployment access too.
        allowed = supervisor.settings.allowed_kb_ids
        if not source.attachment and allowed is not None and source.kb_id not in allowed:
            raise RunNotFound(source_id)
        destination = supervisor.settings.data_dir / "previews" / run_id / source_id
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not destination.is_file():
            import uuid
            staging = destination.with_name(source_id + "." + uuid.uuid4().hex)
            try:
                await supervisor.blocking(SourceCatalog([source], {}).download, supervisor.storage, source, staging,
                                          max_bytes=supervisor.settings.max_source_bytes)
                staging.replace(destination)
            finally:
                staging.unlink(missing_ok=True)
        return FileResponse(destination, media_type=mimetypes.guess_type(source.name)[0] or "application/octet-stream",
                            filename=source.name, content_disposition_type="inline", headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
    except (RunNotFound, ToolError) as error:
        raise translate(error) from None
