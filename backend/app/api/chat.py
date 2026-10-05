"""
聊天API路由
处理对话和问答请求
"""

from fastapi import APIRouter, HTTPException, Request, Query, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator
from pydantic import BaseModel, Field
import json
import asyncio
import uuid
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from app.core.logger import get_logger
from app.core.config import settings
from app.core.jev_settings import get_jev_config
from app.core.llm.jev import JevRequiredError
from app.core.stage_timing import StageTimings
from app.core.score_details import citation_score_fields
from app.core.llm.manager import llm_manager
from app.core.llm import TASK_MODEL_TYPES
from app.core.llm.models_catalog import ensure_llm_catalog_fresh, get_llm_catalog_status
from app.modules.retrieval.service import RetrievalService
from app.modules.generation.service import GenerationService
from app.modules.generation.citation_selection import select_answer_references
from app.modules.agent.mode_router import resolve_agent_mode
from app.modules.agent.service import AgenticRetrievalService
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
from app.modules.chat.attachment_summarizer import MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES, summarize_chat_attachments
from app.modules.chat.references import normalize_attachment_ids, resolve_message_references, resolve_multipart_references
from app.modules.chat.context_manager import build_conversation_context, trim_stored_messages

router = APIRouter()
logger = get_logger(__name__)

# 创建服务实例
retrieval_service = RetrievalService()
generation_service = GenerationService()
agentic_retrieval_service = AgenticRetrievalService(retrieval_service)

def _retrieval_diagnostics(result):
    """Keep configured vs actually used Jev stages inspectable in history."""
    debug = getattr(result, "debug_info", None) or {}
    keys = ("jev_decision", "reranking_scorer", "target_modality_fallback",
            "total_candidates", "total_time")
    runs = debug.get("retrieval_runs") or [debug]
    return {
        "jev_config": get_jev_config().model_dump(),
        "runs": [{key: run[key] for key in keys if key in run} for run in runs],
    }


# 简单的会话存储（生产环境应使用Redis或数据库）
sessions: Dict[str, Dict[str, Any]] = {}

# OpenRouter 公开模型列表（代理 + 短缓存，供前端搜索）
OPENROUTER_PUBLIC_MODELS_URL = "https://openrouter.ai/api/v1/models"
_OPENROUTER_CACHE_TTL_SEC = 600.0
_openrouter_catalog_cache: Dict[str, Any] = {"ts": 0.0, "models": None}
_openrouter_catalog_lock = asyncio.Lock()
TASK_SETTINGS_KEYS = (
    "intent_recognition",
    "query_rewriting",
    "image_captioning",
    "embedding",
    "reranking",
    "audio_transcription",
    "video_parsing",
    "kb_portrait_generation",
    "final_generation",
)


def _build_session_context(session: Dict[str, Any]) -> List[Dict[str, str]]:
    context = build_conversation_context(
        session.get("messages", []),
        max_messages=settings.chat_context_max_messages,
        max_chars=settings.chat_context_max_chars,
        max_message_chars=settings.chat_context_message_max_chars,
    )
    if context.omitted_messages:
        logger.debug(
            "会话上下文已按预算裁剪: omitted=%s selected=%s chars=%s",
            context.omitted_messages,
            len(context.messages),
            context.total_chars,
        )
    return context.messages


def _append_session_turn(
    session: Dict[str, Any],
    *,
    user_message: Dict[str, Any],
    assistant_message: Dict[str, Any],
) -> None:
    messages = session.setdefault("messages", [])
    messages.extend((user_message, assistant_message))
    session["messages"] = trim_stored_messages(
        messages,
        max_messages=settings.chat_session_max_stored_messages,
    )
    session["updated_at"] = datetime.utcnow().isoformat()


class SelectedFileScope(BaseModel):
    kb_id: str = Field(..., min_length=1)
    file_id: str = Field(..., min_length=1)
    name: Optional[str] = None
    type: Optional[str] = None
    kb_name: Optional[str] = None


def _clean_optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_selected_files(raw: Any) -> List[Dict[str, str]]:
    """将前端传入的 selectedFiles 归一化为 [{kb_id, file_id, ...}]。"""
    if raw is None:
        return []
    payload = raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            payload = json.loads(text)
        except Exception:
            logger.warning("selectedFiles JSON 解析失败")
            return []
    if not isinstance(payload, list):
        return []

    normalized: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        normalized_item = {
            "kb_id": _clean_optional_str(item.get("kb_id") or item.get("kbId")),
            "file_id": _clean_optional_str(item.get("file_id") or item.get("fileId")),
            "name": _clean_optional_str(item.get("name")),
            "type": _clean_optional_str(item.get("type")),
            "kb_name": _clean_optional_str(item.get("kb_name") or item.get("kbName")),
        }
        try:
            scope = SelectedFileScope(**normalized_item)
        except Exception:
            continue
        key = (scope.kb_id.strip(), scope.file_id.strip())
        if not key[0] or not key[1] or key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "kb_id": key[0],
                "file_id": key[1],
                **({"name": scope.name.strip()} if isinstance(scope.name, str) and scope.name.strip() else {}),
                **({"type": scope.type.strip()} if isinstance(scope.type, str) and scope.type.strip() else {}),
                **({"kb_name": scope.kb_name.strip()} if isinstance(scope.kb_name, str) and scope.kb_name.strip() else {}),
            }
        )
    return normalized


class TaskModelSelection(BaseModel):
    model: str = Field(..., min_length=1)
    provider: Optional[str] = None


class UpdateTaskModelsRequest(BaseModel):
    tasks: Dict[str, TaskModelSelection] = Field(default_factory=dict)


def _openrouter_model_chat_capable(raw: Dict[str, Any]) -> bool:
    """仅保留输出含 text 的模型，供对话 final_generation 选用（排除纯向量等）。"""
    arch = raw.get("architecture") or {}
    outs = arch.get("output_modalities")
    if not isinstance(outs, list) or not outs:
        return True
    return "text" in outs


def _slim_openrouter_model(raw: Dict[str, Any]) -> Dict[str, Any]:
    arch = raw.get("architecture") or {}
    mid = (raw.get("id") or "").strip()
    return {
        "id": mid,
        "registry_id": f"openrouter:{mid}" if mid else "",
        "name": raw.get("name"),
        "context_length": raw.get("context_length"),
        "modality": arch.get("modality"),
        "input_modalities": arch.get("input_modalities"),
        "output_modalities": arch.get("output_modalities"),
    }


def _build_chat_catalog(registry: Any) -> List[Dict[str, Any]]:
    """供前端统一搜索：仅 chat 能力模型，含 registry_id / provider / 展示字段。"""
    ids = registry.list_models("chat")
    seen: set[str] = set()
    rows: List[Dict[str, Any]] = []
    for mid in sorted(ids, key=lambda x: str(x).lower()):
        if not mid or mid in seen:
            continue
        seen.add(mid)
        cfg = registry.get_model_config(mid) or {}
        prov = cfg.get("provider") or "siliconflow"
        api_id = mid.split(":", 1)[-1] if ":" in str(mid) else str(mid)
        rows.append(
            {
                "registry_id": mid,
                "provider": prov,
                "id": api_id,
                "name": cfg.get("description"),
                "context_length": cfg.get("context_length"),
                "capabilities": [s.strip() for s in str(cfg.get("type") or "").split(",") if s.strip()],
                "catalog_synced": bool(cfg.get("catalog_synced")),
            }
        )
    return rows


def _serialize_current_task_config() -> Dict[str, Dict[str, str]]:
    registry = llm_manager.registry
    available_providers = set(registry.list_providers())
    current_config: Dict[str, Dict[str, str]] = {}

    for task in TASK_SETTINGS_KEYS:
        model_name = registry.get_task_model(task)
        if not model_name:
            continue
        model_config = registry.get_model_config(model_name)
        if not model_config:
            continue
        provider = model_config.get("provider") or "siliconflow"
        if provider not in available_providers:
            continue
        raw_type = model_config.get("type") or ""
        model_types = [s.strip() for s in str(raw_type).split(",") if s.strip()]
        required_type = TASK_MODEL_TYPES.get(task)
        if required_type and required_type not in model_types:
            continue
        current_config[task] = {"model": model_name, "provider": provider}

    return current_config


def _normalize_media_file_path(file_path: str) -> str:
    """归一化引用中的 file_path（兼容 URL/绝对路径/编码路径）。"""
    raw = unquote((file_path or "").strip())
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        raw = unquote(parsed.path or "")
    raw = raw.split("?", 1)[0].split("#", 1)[0].strip()
    return raw.lstrip("/")


def _build_object_path_candidates(file_path: str, media_prefix: str) -> List[str]:
    """构建 object_path 候选，兼容历史数据路径格式差异。"""
    raw = _normalize_media_file_path(file_path)
    if not raw:
        return []
    candidates: List[str] = []

    def _add(p: str) -> None:
        p = (p or "").strip().lstrip("/")
        if p and p not in candidates:
            candidates.append(p)

    _add(raw)
    if "/" in raw:
        # 兼容 file_path 中误带 bucket 前缀：kb-xxx/images/a.jpg -> images/a.jpg
        _add(raw.split("/", 1)[1])
    base_name = Path(raw).name
    if base_name:
        _add(f"{media_prefix}/{base_name}")
    return candidates


def _build_bucket_candidates(minio_adapter: MinIOAdapter, kb_id: str) -> List[str]:
    """构建 bucket 候选（兼容 kb_id 可能已是 bucket 名的历史数据）。"""
    candidates: List[str] = []
    for b in [minio_adapter.get_bucket_for_kb(kb_id), minio_adapter.bucket_name_for_kb(kb_id), kb_id]:
        if not b or b in candidates:
            continue
        try:
            if minio_adapter.bucket_exists(b):
                candidates.append(b)
        except Exception:
            continue
    # 至少保留一个主候选，避免 bucket_exists 网络抖动导致空列表
    if not candidates:
        candidates.append(minio_adapter.get_bucket_for_kb(kb_id))
    return candidates


async def _resolve_media_presigned_url(
    *,
    minio_adapter: MinIOAdapter,
    kb_id: str,
    file_path: str,
    media_prefix: str,
    expires_hours: int = 24,
) -> Tuple[str, str, str]:
    """
    解析并校验真实存在的 bucket/object_path 后再生成 presigned URL。
    返回: (url, bucket, object_path)
    """
    bucket_candidates = _build_bucket_candidates(minio_adapter, kb_id)
    object_candidates = _build_object_path_candidates(file_path, media_prefix)
    if not object_candidates:
        raise HTTPException(status_code=400, detail="file_path 非法")

    for bucket in bucket_candidates:
        for object_path in object_candidates:
            try:
                minio_adapter.client.stat_object(bucket, object_path)
                url = await minio_adapter.get_presigned_url(
                    bucket=bucket,
                    object_path=object_path,
                    expires_hours=expires_hours,
                )
                return url, bucket, object_path
            except Exception:
                continue

    raise HTTPException(
        status_code=404,
        detail=f"引用资源不存在：{Path(file_path).name or file_path}",
    )

@router.post("/message")
async def chat_message(request: Request):
    """非流式聊天对话接口"""
    try:
        data = await request.json()
        message = data.get("message", "")
        knowledge_base_ids = data.get("knowledgeBaseIds", [])
        selected_files = _normalize_selected_files(data.get("selectedFiles"))
        mentions, resolved_query, reference_context = resolve_message_references(
            message, data.get("mentions"), selected_files, []
        )
        session_id = data.get("sessionId")
        agent_mode_request = data.get("agentMode", "direct")
        model = _clean_optional_str(data.get("model"))

        if not message.strip():
            raise HTTPException(status_code=400, detail="消息内容不能为空")
        
        logger.info(
            f"收到聊天消息: {message[:50]}..., session_id={session_id}, "
            f"kb_ids={knowledge_base_ids}, selected_files={len(selected_files)}, "
            f"selected_file_ids={[item.get('file_id') for item in selected_files[:10]]}"
        )
        
        # 获取或创建会话
        if not session_id:
            session_id = str(uuid.uuid4())
            sessions[session_id] = {
                "id": session_id,
                "messages": [],
                "knowledge_base_ids": knowledge_base_ids,
                "created_at": datetime.utcnow().isoformat()
            }
        
        session = sessions.get(session_id, {})
        if not session:
            session = {
                "id": session_id,
                "messages": [],
                "knowledge_base_ids": knowledge_base_ids,
                "created_at": datetime.utcnow().isoformat()
            }
            sessions[session_id] = session
        
        # 按完整轮次和字符预算构建统一会话上下文。
        session_context = _build_session_context(session)
        
        # 构建知识库上下文
        kb_context = None
        effective_kb_ids = knowledge_base_ids or []
        if selected_files:
            effective_kb_ids = list(dict.fromkeys([item["kb_id"] for item in selected_files if item.get("kb_id")]))
        if effective_kb_ids or selected_files:
            kb_context = {
                "kb_ids": effective_kb_ids,
                "kb_names": [],  # 可以从知识库服务获取名称
                "selected_files": selected_files,
            }
            if selected_files:
                logger.info(
                    "聊天请求启用文件级检索: kb_ids=%s, file_ids=%s",
                    effective_kb_ids,
                    [item.get("file_id") for item in selected_files],
                )

        mode_resolution = resolve_agent_mode(
            agent_mode_request,
            query=resolved_query,
            selected_files=selected_files,
            attachment_context=reference_context or None,
        )
        agent_mode = mode_resolution.enabled
        logger.info(
            "Agent 模式选择: requested=%s selected=%s score=%s reason=%s",
            mode_resolution.requested_mode,
            mode_resolution.selected_mode,
            mode_resolution.score,
            mode_resolution.reason,
        )

        # 1. 执行检索。Agent 模式只是在现有多模态检索之上做有界迭代，
        # 普通模式保持原路径与行为不变。
        agent_result = None
        if agent_mode:
            agent_result = await agentic_retrieval_service.search(
                query=resolved_query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=reference_context or None,
                model=model,
            )
            retrieval_result = agent_result.retrieval_result
        else:
            retrieval_result = await retrieval_service.search(
                allow_smalltalk=True,
                query=resolved_query,
                kb_context=kb_context,
                session_context=session_context,
                attachment_context=reference_context or None,
            )
        
        # 2. 生成回答
        generation_result = await generation_service.generate_response(
            query=resolved_query,
            retrieval_result=retrieval_result,
            kb_context=kb_context,
            session_context=session_context,
            attachment_context=reference_context or None,
        )
        
        if not generation_result.get("success"):
            raise HTTPException(
                status_code=500, 
                detail=generation_result.get("error", "生成回答失败")
            )
        
        # 构建响应
        answer = generation_result.get("answer", "")
        context_used = generation_result.get("context_used")
        references = generation_result.get("references_used", [])
        
        # 格式化引用信息
        citations = []
        if references:
            for ref in references:
                citations.append({
                    "id": ref.get("id", ""),
                    "type": ref.get("type", "doc"),
                    "file_name": ref.get("file_name", ""),
                    "content": ref.get("content", ""),
                    "score": ref.get("score", (ref.get("scores") or {}).get("final")),
                    **citation_score_fields(ref),
                    "metadata": ref.get("metadata", {})
                })
        
        # 保存消息到会话
        _append_session_turn(
            session,
            user_message={
                "role": "user",
                "content": message,
                "selected_files": selected_files,
                "mentions": mentions,
                "reference_query": resolved_query,
                "reference_context": reference_context,
                "timestamp": datetime.utcnow().isoformat(),
            },
            assistant_message={
                "role": "assistant",
                "content": answer,
                "citations": citations,
                "agent": agent_result.metadata() if agent_result else None,
                "agent_selection": mode_resolution.metadata(),
                "retrieval_diagnostics": _retrieval_diagnostics(retrieval_result),
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
        
        logger.info(f"聊天消息处理完成: session_id={session_id}, answer_length={len(answer)}")
        
        return {
            "success": True,
            "sessionId": session_id,
            "message": answer,
            "citations": citations,
            "metadata": {
                "query": message,
                "intent_type": retrieval_result.context.intent_type,
                "processing_time": (
                    retrieval_result.processing_time
                    + generation_result.get("metadata", {}).get("generation_time", 0)
                    + generation_result.get("metadata", {}).get("jev_citation_audit", {}).get("duration_s", 0)
                ),
                "chunks_used": context_used.total_chunks if context_used else 0,
                "images_used": context_used.total_images if context_used else 0,
                "tokens_used": generation_result.get("metadata", {}).get("tokens_used", 0),
                "model_used": generation_result.get("metadata", {}).get("model_used", ""),
                **({"jev_citation_audit": generation_result["metadata"]["jev_citation_audit"]}
                   if "jev_citation_audit" in generation_result.get("metadata", {}) else {}),
                "agent": agent_result.metadata() if agent_result else {"enabled": False},
                "agent_selection": mode_resolution.metadata(),
                "retrieval_diagnostics": _retrieval_diagnostics(retrieval_result),
            }
        }
        
    except JevRequiredError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"聊天消息处理失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"处理聊天消息时发生错误: {str(e)}")

def _thought_event_payload(stage: str, payload: dict) -> str:
    """前端期望: type=thought, data={ type: <phase>, data: { ... } }"""
    return json.dumps(
        {
            "type": "thought",
            "data": {"type": stage, "data": payload},
            "timestamp": datetime.utcnow().timestamp(),
        },
        ensure_ascii=False,
    )


async def _iter_chat_sse(
    **kwargs,
) -> AsyncGenerator[str, None]:
    """Keep terminal timing diagnostics even when retrieval raises early."""
    timings = StageTimings()
    try:
        async for line in _iter_chat_sse_impl(stage_timer=timings, **kwargs):
            yield line
    except asyncio.CancelledError:
        timings.finish_active("cancelled")
        raise
    except Exception as exc:
        timings.finish_active("failed")
        event = {"type": "error", "message": str(exc), "stage_timings": timings.snapshot()}
        if isinstance(exc, JevRequiredError):
            event["diagnostics"] = exc.diagnostics()
        else:
            logger.error(f"流式聊天失败: {str(exc)}", exc_info=True)
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def _iter_chat_sse_impl(
    *,
    message: str,
    knowledge_base_ids_csv: Optional[str],
    selected_files_raw: Optional[str],
    session_id_opt: Optional[str],
    model: Optional[str],
    agent_mode: Any,
    attachment_context: Optional[str],
    stage_timer: StageTimings,
    include_connected: bool = True,
    mentions_raw: Any = None,
    attachment_files: Optional[List[Dict[str, Any]]] = None,
) -> AsyncGenerator[str, None]:
    """流式聊天 SSE 行迭代器（GET/POST 共用）。"""
    thinking: Dict[str, Any] = {}

    def thought(stage: str, payload: dict) -> str:
        enriched = stage_timer.attach(stage, payload)
        # The persisted shape matches the frontend's flattened ThoughtData.
        # Stage-specific clocks live in stage_timings, not the last event slot.
        thinking.update({key: value for key, value in enriched.items() if key != "stage_timing"})
        if stage == "generation":
            thinking["generation_status"] = payload.get("status", "generating")
            thinking["generation_message"] = payload.get("message", "")
        return f"data: {_thought_event_payload(stage, enriched)}\n\n"

    kb_ids: List[str] = []
    if knowledge_base_ids_csv:
        kb_ids = [kb_id.strip() for kb_id in knowledge_base_ids_csv.split(",") if kb_id.strip()]
    selected_files = _normalize_selected_files(selected_files_raw)
    mentions, resolved_query, reference_context = resolve_message_references(
        message, mentions_raw, selected_files, attachment_files or []
    )
    media_context = attachment_context
    attachment_context = "\n\n".join(part for part in (reference_context, media_context) if part) or None
    if selected_files:
        kb_ids = list(dict.fromkeys([item["kb_id"] for item in selected_files if item.get("kb_id")]))
        logger.info(
            "流式聊天启用文件级检索: kb_ids=%s, file_ids=%s",
            kb_ids,
            [item.get("file_id") for item in selected_files],
        )

    if not session_id_opt:
        current_session_id = str(uuid.uuid4())
    else:
        current_session_id = session_id_opt

    session = sessions.get(current_session_id, {})
    if not session:
        session = {
            "id": current_session_id,
            "messages": [],
            "knowledge_base_ids": kb_ids,
            "created_at": datetime.utcnow().isoformat(),
        }
        sessions[current_session_id] = session

    session_context = _build_session_context(session)

    kb_context = None
    if kb_ids or selected_files:
        kb_context = {"kb_ids": kb_ids, "kb_names": [], "selected_files": selected_files}

    if include_connected:
        yield f"data: {json.dumps({'type': 'connected', 'sessionId': current_session_id})}\n\n"

    mode_resolution = resolve_agent_mode(
        agent_mode,
        query=resolved_query,
        selected_files=selected_files,
        attachment_context=attachment_context,
    )
    if mode_resolution.requested_mode == "auto":
        auto_mode_payload = {
            "stage_status": "processing",
            "message": (
                "自动模式已选择 Agent 深研"
                if mode_resolution.enabled
                else "自动模式已选择直接检索"
            ),
            "agent_mode_auto": True,
            "agent_mode": mode_resolution.enabled,
            "agent_mode_selected": mode_resolution.selected_mode,
            "agent_mode_reason": mode_resolution.reason,
            "agent_mode_score": mode_resolution.score,
        }
        if not mode_resolution.enabled:
            stage_timer.start("intent")
        yield thought("intent", auto_mode_payload)

    retrieval_result = None
    agent_result = None
    if mode_resolution.enabled:
        async for stage, payload in agentic_retrieval_service.search_stream(
            query=resolved_query,
            kb_context=kb_context,
            session_context=session_context,
            attachment_context=attachment_context,
            model=model,
        ):
            if stage == "_result":
                agent_result = payload
                retrieval_result = payload.retrieval_result
                break
            yield thought(stage, payload)
    else:
        async for stage, payload in retrieval_service.search_stream(
            allow_smalltalk=True,
            query=resolved_query,
            kb_context=kb_context,
            session_context=session_context,
            attachment_context=attachment_context,
            stage_timer=stage_timer,
        ):
            if stage == "_result":
                retrieval_result = payload
                break
            yield thought(stage, payload)

    if retrieval_result is None:
        raise RuntimeError("检索流未返回结果")

    stage_timer.start("generation")
    yield thought("generation", {"message": "正在准备生成回答...", "status": "preparing", "stage_status": "processing"})

    answer_chunks: List[str] = []
    last_citations: List[Any] = []
    citation_audit = None
    generation_done = False
    async for event in generation_service.stream_generate_response(
        query=resolved_query,
        retrieval_result=retrieval_result,
        session_id=current_session_id,
        kb_context=kb_context,
        model=model,
        attachment_context=attachment_context,
        session_context=session_context,
        attachment_files=attachment_files,
    ):
        event_type = event.type.value if hasattr(event.type, "value") else str(event.type)

        if event_type == "message":
            chunk = event.data.get("content", "")
            answer_chunks.append(chunk)
            yield f"data: {json.dumps({'type': 'message', 'data': {'delta': chunk}})}\n\n"
        elif event_type == "thought":
            stage = event.data.get("stage", "generation")
            if isinstance(event.data.get("message"), dict):
                pl = event.data.get("message", {})
            else:
                pl = {"message": event.data.get("message", "")}
            if "status" in event.data:
                pl["status"] = event.data["status"]
            yield thought(stage, pl)
        elif event_type == "citation":
            refs = event.data.get("references", event.data.get("citations", []))
            last_citations = refs
            citation_data = {"references": refs}
            if event.data.get("replace"):
                citation_data["replace"] = True
            yield f"data: {json.dumps({'type': 'citation', 'data': citation_data}, ensure_ascii=False)}\n\n"
        elif event_type == "error":
            stage_timer.finish_active("failed")
            yield f"data: {json.dumps({'type': 'error', 'message': event.data.get('error', '未知错误'), 'stage_timings': stage_timer.snapshot()}, ensure_ascii=False)}\n\n"
            return
        elif event_type == "done":
            citation_audit = event.data.get("jev_citation_audit")
            generation_done = True
            break

    if not generation_done:
        raise RuntimeError("生成流未正常结束")
    stage_timer.finish("generation")
    yield thought("generation", {"message": "回答生成完成", "status": "completed", "stage_status": "completed"})
    thinking["_generation_completed"] = True
    final_timings = stage_timer.snapshot()
    thinking["stage_timings"] = final_timings
    full_answer = "".join(answer_chunks)
    last_citations = select_answer_references(full_answer, last_citations)
    _append_session_turn(
        session,
        user_message={
            "role": "user",
            "content": message,
            "selected_files": selected_files,
            "mentions": mentions,
            "attachments": attachment_files or [],
            "reference_query": resolved_query,
            "reference_context": reference_context,
            "attachment_context": media_context,
            "timestamp": datetime.utcnow().isoformat(),
        },
        assistant_message={
            "role": "assistant",
            "content": full_answer,
            "citations": last_citations,
            "agent": agent_result.metadata() if agent_result else None,
            "agent_selection": mode_resolution.metadata(),
            "retrieval_diagnostics": _retrieval_diagnostics(retrieval_result),
            "thinking": thinking,
            "stage_timings": final_timings,
            "timestamp": datetime.utcnow().isoformat(),
        },
    )

    completion = {'type': 'complete', 'sessionId': current_session_id,
                  'stage_timings': final_timings, 'thinking': thinking,
                  'diagnostics': {'retrieval': _retrieval_diagnostics(retrieval_result)}}
    if citation_audit is not None:
        completion['diagnostics']['jev_citation_audit'] = citation_audit
    yield f"data: {json.dumps(completion)}\n\n"


@router.get("/stream")
async def stream_chat(
    message: str = Query(...),
    knowledgeBaseIds: Optional[str] = Query(None),
    selectedFiles: Optional[str] = Query(None),
    mentions: Optional[str] = Query(None),
    sessionId: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    agentMode: str = Query("direct"),
):
    """流式聊天接口 (SSE)，无附件时使用 GET。"""

    async def generate():
        try:
            async for line in _iter_chat_sse(
                message=message,
                knowledge_base_ids_csv=knowledgeBaseIds,
                selected_files_raw=selectedFiles,
                mentions_raw=mentions,
                session_id_opt=sessionId,
                model=model,
                agent_mode=agentMode,
                attachment_context=None,
            ):
                yield line
        except JevRequiredError as exc:
            event = {'type': 'error', 'message': str(exc), 'diagnostics': exc.diagnostics()}
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"流式聊天失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/stream")
async def stream_chat_multipart(
    message: str = Form(""),
    messageJson: Optional[str] = Form(None),
    knowledgeBaseIds: Optional[str] = Form(None),
    selectedFiles: Optional[str] = Form(None),
    mentions: Optional[str] = Form(None),
    attachmentIds: Optional[str] = Form(None),
    sessionId: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    agentMode: str = Form("direct"),
    files: List[UploadFile] = File(default=[]),
):
    """流式聊天 (SSE)，支持 multipart 上传图片/音频附件（服务端生成摘要，不入库）。"""

    named_uploads = [uf for uf in files if uf.filename]
    if len(named_uploads) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"附件最多 {MAX_ATTACHMENTS} 个",
        )

    async def generate():
        try:
            try:
                ids = normalize_attachment_ids(attachmentIds, len(named_uploads))
                attachment_files = [
                    {"id": ids[i], "index": i + 1, "name": uf.filename, "type": uf.content_type or ""}
                    for i, uf in enumerate(named_uploads)
                ]
                message_text, _, summary_query, _ = resolve_multipart_references(
                    message or "", messageJson, mentions, _normalize_selected_files(selectedFiles), attachment_files
                )
            except ValueError as exc:
                logger.info("聊天请求校验未通过: {}", exc)
                yield f"data: {json.dumps({'type': 'error', 'stage': 'validation', 'code': 'invalid_chat_input', 'message': str(exc)}, ensure_ascii=False)}\n\n"
                return
            raw_files: List[Tuple[str, str, bytes]] = []
            for i, uf in enumerate(named_uploads):
                video_upload = (uf.content_type or "").startswith("video/") or (uf.filename or "").lower().endswith((".mp4", ".webm", ".mov"))
                limit = MAX_VIDEO_BYTES if video_upload else max(MAX_IMAGE_BYTES, MAX_AUDIO_BYTES)
                body = await uf.read(limit + 1)
                if len(body) > limit:
                    raise ValueError(f"附件超过 {limit // 1024 // 1024}MB：{uf.filename}")
                raw_files.append((uf.filename, uf.content_type or "", body))
                attachment_files[i]["size"] = len(body)

            if not message_text.strip() and not raw_files:
                yield f"data: {json.dumps({'type': 'error', 'message': '请输入消息或上传附件'})}\n\n"
                return

            kb_ids_pre: List[str] = []
            if knowledgeBaseIds:
                kb_ids_pre = [
                    x.strip() for x in knowledgeBaseIds.split(",") if x.strip()
                ]
            current_sid = (sessionId or "").strip() or str(uuid.uuid4())
            if current_sid not in sessions:
                sessions[current_sid] = {
                    "id": current_sid,
                    "messages": [],
                    "knowledge_base_ids": kb_ids_pre,
                    "created_at": datetime.utcnow().isoformat(),
                }

            yield f"data: {json.dumps({'type': 'connected', 'sessionId': current_sid})}\n\n"

            attachment_context: Optional[str] = None
            if raw_files:
                yield f"data: {_thought_event_payload('attachment', {'message': '正在分析附件…', 'status': 'processing', 'count': len(raw_files)})}\n\n"
                try:
                    block, parsed_items = await summarize_chat_attachments(
                        user_message=summary_query, files=raw_files
                    )
                    attachment_context = block.strip() or None
                except ValueError as e:
                    yield f"data: {json.dumps({'type': 'error', 'stage': 'attachment', 'message': str(e)})}\n\n"
                    return
                for file, parsed in zip(attachment_files, parsed_items):
                    file.update(kind=parsed["modality"], status=parsed["status"], summary=parsed["summary"], media_info=parsed.get("media_info", {}))
                failed = sum(item["status"] == "failed" for item in parsed_items)
                note = f"{failed} 个附件解析失败；回答会明确说明缺失内容" if failed else "附件解析已完成"
                yield f"data: {_thought_event_payload('attachment', {'message': note, 'status': 'completed', 'count': len(raw_files), 'items': parsed_items})}\n\n"
                if failed == len(parsed_items):
                    details = " ".join(f"{item.get('filename') or '附件'}：{item['summary']}" for item in parsed_items)
                    yield f"data: {json.dumps({'type': 'error', 'stage': 'attachment', 'message': '所有附件均解析失败，请检查文件或模型配置后重试。' + details}, ensure_ascii=False)}\n\n"
                    return

            effective_message = (
                message_text if message_text.strip() else "请结合我上传的附件内容回答。"
            )

            async for line in _iter_chat_sse(
                message=effective_message,
                knowledge_base_ids_csv=knowledgeBaseIds,
                selected_files_raw=selectedFiles,
                mentions_raw=mentions,
                attachment_files=attachment_files,
                session_id_opt=current_sid,
                model=model,
                agent_mode=agentMode,
                attachment_context=attachment_context,
                include_connected=False,
            ):
                yield line
        except JevRequiredError as exc:
            event = {'type': 'error', 'message': str(exc), 'diagnostics': exc.diagnostics()}
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"流式聊天(附件)失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            for uf in files:
                await uf.close()

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/reference-audio-url")
async def get_reference_audio_url(request: Request):
    """根据 kb_id 与 file_path 返回音频预签名 URL，供前端「点击播放」按需拉取播放地址。"""
    try:
        body = await request.json()
        kb_id = (body.get("kb_id") or "").strip()
        file_path = (body.get("file_path") or "").strip()
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path 不能为空")
        if not kb_id:
            raise HTTPException(
                status_code=400,
                detail="缺少知识库 ID，无法生成播放地址；请从引用详情或检查器中查看",
            )
        minio_adapter = MinIOAdapter()
        audio_url, bucket, object_path = await _resolve_media_presigned_url(
            minio_adapter=minio_adapter,
            kb_id=kb_id,
            file_path=file_path,
            media_prefix="audios",
            expires_hours=24,
        )
        logger.debug("audio 引用URL已刷新: kb_id=%s bucket=%s object_path=%s", kb_id, bucket, object_path)
        return {"audio_url": audio_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.debug("生成引用音频预签名 URL 失败: %s", e)
        raise HTTPException(status_code=500, detail="无法生成播放地址")


@router.post("/reference-video-url")
async def get_reference_video_url(request: Request):
    """根据 kb_id 与 file_path 返回视频预签名 URL，供前端「点击播放」按需拉取播放地址。"""
    try:
        body = await request.json()
        kb_id = (body.get("kb_id") or "").strip()
        file_path = (body.get("file_path") or "").strip()
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path 不能为空")
        if not kb_id:
            raise HTTPException(
                status_code=400,
                detail="缺少知识库 ID，无法生成播放地址；请从引用详情或检查器中查看",
            )
        minio_adapter = MinIOAdapter()
        video_url, bucket, object_path = await _resolve_media_presigned_url(
            minio_adapter=minio_adapter,
            kb_id=kb_id,
            file_path=file_path,
            media_prefix="videos",
            expires_hours=24,
        )
        logger.debug("video 引用URL已刷新: kb_id=%s bucket=%s object_path=%s", kb_id, bucket, object_path)
        return {"video_url": video_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.debug("生成引用视频预签名 URL 失败: %s", e)
        raise HTTPException(status_code=500, detail="无法生成播放地址")


@router.post("/reference-image-url")
async def get_reference_image_url(request: Request):
    """根据 kb_id 与 file_path 返回图片预签名 URL，供前端在 URL 过期后按需刷新预览。"""
    try:
        body = await request.json()
        kb_id = (body.get("kb_id") or "").strip()
        file_path = (body.get("file_path") or "").strip()
        if not file_path:
            raise HTTPException(status_code=400, detail="file_path 不能为空")
        if not kb_id:
            raise HTTPException(
                status_code=400,
                detail="缺少知识库 ID，无法生成预览地址；请从引用详情或检查器中查看",
            )
        minio_adapter = MinIOAdapter()
        img_url, bucket, object_path = await _resolve_media_presigned_url(
            minio_adapter=minio_adapter,
            kb_id=kb_id,
            file_path=file_path,
            media_prefix="images",
            expires_hours=24,
        )
        logger.debug("image 引用URL已刷新: kb_id=%s bucket=%s object_path=%s", kb_id, bucket, object_path)
        return {"img_url": img_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.debug("生成引用图片预签名 URL 失败: %s", e)
        raise HTTPException(status_code=500, detail="无法生成预览地址")


@router.get("/history")
async def get_chat_history(sessionId: Optional[str] = Query(None)):
    """获取对话历史"""
    try:
        if sessionId:
            session = sessions.get(sessionId)
            if session:
                # Older streams saved the full candidate map before the final
                # answer existed. Repair the response without mutating history.
                messages = [
                    {**message, "citations": select_answer_references(
                        message.get("content", ""), message.get("citations", []))}
                    if message.get("role") == "assistant" else message
                    for message in session.get("messages", [])
                ]
                return {
                    "success": True,
                    "sessionId": sessionId,
                    "messages": messages,
                    "created_at": session.get("created_at"),
                    "updated_at": session.get("updated_at")
                }
            else:
                return {
                    "success": False,
                    "error": "会话不存在"
                }
        else:
            # 返回所有会话列表
            session_list = []
            for sid, session in sessions.items():
                session_list.append({
                    "id": sid,
                    "title": session.get("title", f"会话 {sid[:8]}"),
                    "message_count": len(session.get("messages", [])),
                    "created_at": session.get("created_at"),
                    "updated_at": session.get("updated_at")
                })
            
            return {
                "success": True,
                "sessions": session_list
            }
    except Exception as e:
        logger.error(f"获取对话历史失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/session")
async def create_session(request: Request):
    """创建新会话"""
    try:
        data = await request.json()
        title = data.get("title", "")
        knowledge_base_ids = data.get("knowledgeBaseIds", [])
        
        session_id = str(uuid.uuid4())
        session = {
            "id": session_id,
            "title": title or f"新会话 {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
            "messages": [],
            "knowledge_base_ids": knowledge_base_ids,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        sessions[session_id] = session
        
        logger.info(f"创建新会话: {session_id}, title={session['title']}")
        
        return {
            "success": True,
            "sessionId": session_id,
            "title": session["title"],
            "created_at": session["created_at"]
        }
    except Exception as e:
        logger.error(f"创建会话失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/openrouter-models")
async def list_openrouter_models_catalog():
    """代理 OpenRouter 公开模型列表，供前端搜索任意对话模型（带短 TTL 缓存）。"""
    import httpx

    registry = llm_manager.registry
    openrouter_configured = "openrouter" in registry.list_providers()

    async with _openrouter_catalog_lock:
        now = time.monotonic()
        cached = _openrouter_catalog_cache.get("models")
        ts = float(_openrouter_catalog_cache.get("ts") or 0.0)
        if cached is not None and (now - ts) < _OPENROUTER_CACHE_TTL_SEC:
            models = cached
        else:
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        OPENROUTER_PUBLIC_MODELS_URL,
                        timeout=90.0,
                        headers={"Accept": "application/json", "User-Agent": "Tessmora/chat-api"},
                    )
                    resp.raise_for_status()
                    payload = resp.json()
            except Exception as e:
                logger.warning(f"拉取 OpenRouter 模型列表失败: {e}")
                return {
                    "openrouter_configured": openrouter_configured,
                    "error": str(e),
                    "models": [],
                    "source": OPENROUTER_PUBLIC_MODELS_URL,
                }

            raw_list = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(raw_list, list):
                return {
                    "openrouter_configured": openrouter_configured,
                    "error": "OpenRouter 响应格式异常",
                    "models": [],
                    "source": OPENROUTER_PUBLIC_MODELS_URL,
                }

            models = []
            for item in raw_list:
                if not isinstance(item, dict):
                    continue
                if not _openrouter_model_chat_capable(item):
                    continue
                models.append(_slim_openrouter_model(item))
            models.sort(key=lambda x: (x.get("id") or "").lower())
            _openrouter_catalog_cache["ts"] = now
            _openrouter_catalog_cache["models"] = models

    return {
        "openrouter_configured": openrouter_configured,
        "model_count": len(models),
        "models": models,
        "source": OPENROUTER_PUBLIC_MODELS_URL,
    }


@router.get("/models")
async def list_models(refresh_catalog: bool = Query(False)):
    """获取可用模型列表与当前任务模型配置（从 LLMRegistry 动态读取）。
    首次请求会从已配置 Key 的厂商拉取 /v1/models 合并目录（短 TTL 缓存）；refresh_catalog=true 强制刷新。
    """
    r = llm_manager.registry
    await ensure_llm_catalog_fresh(r, force=refresh_catalog)
    return {
        "providers": r.list_providers(),
        "models_by_provider": r.list_models_by_provider(),
        "chat_models": r.list_models("chat"),
        "chat_catalog": _build_chat_catalog(r),
        "embedding_models": r.list_models("embedding"),
        "vision_models": r.list_models("vision"),
        "reranker_models": r.list_models("reranker"),
        "audio_models": r.list_models("audio"),
        "video_models": r.list_models("video"),
        "model_details": r.list_model_details(),
        "task_candidates": r.list_task_candidates_by_task(list(TASK_SETTINGS_KEYS)),
        "catalog_status": get_llm_catalog_status(),
        "model_health": r.model_health.snapshot(),
        "current_config": _serialize_current_task_config(),
        "task_types": {task: TASK_MODEL_TYPES.get(task) for task in TASK_SETTINGS_KEYS},
    }


@router.put("/models")
async def update_models(request: UpdateTaskModelsRequest):
    """运行时更新任务模型配置，并持久化到本地文件。"""
    if not request.tasks:
        raise HTTPException(status_code=400, detail="未提供任务模型配置")

    registry = llm_manager.registry
    await ensure_llm_catalog_fresh(registry, force=False)
    task_models: Dict[str, str] = {}
    for task_type, selection in request.tasks.items():
        if task_type not in TASK_SETTINGS_KEYS:
            raise HTTPException(status_code=400, detail=f"不支持的任务类型: {task_type}")
        model_name = (selection.model or "").strip()
        if not model_name:
            raise HTTPException(status_code=400, detail=f"任务 {task_type} 缺少模型")
        if selection.provider:
            model_config = registry.get_model_config(model_name)
            provider = model_config.get("provider") if model_config else None
            if provider and provider != selection.provider:
                raise HTTPException(
                    status_code=400,
                    detail=f"任务 {task_type} 的 provider 与模型不匹配: {selection.provider} != {provider}",
                )
        task_models[task_type] = model_name

    try:
        registry.update_task_models(task_models, persist=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {
        "success": True,
        "current_config": _serialize_current_task_config(),
    }
