"""
聊天API路由
处理对话和问答请求
"""

from fastapi import APIRouter, HTTPException, Request, Query, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator
import json
import asyncio
import uuid
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from app.core.logger import get_logger
from app.core.llm.manager import llm_manager
from app.modules.retrieval.service import RetrievalService
from app.modules.generation.service import GenerationService
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
from app.modules.chat.attachment_summarizer import MAX_ATTACHMENTS, summarize_chat_attachments

router = APIRouter()
logger = get_logger(__name__)

# 创建服务实例
retrieval_service = RetrievalService()
generation_service = GenerationService()

# 简单的会话存储（生产环境应使用Redis或数据库）
sessions: Dict[str, Dict[str, Any]] = {}

# OpenRouter 公开模型列表（代理 + 短缓存，供前端搜索）
OPENROUTER_PUBLIC_MODELS_URL = "https://openrouter.ai/api/v1/models"
_OPENROUTER_CACHE_TTL_SEC = 600.0
_openrouter_catalog_cache: Dict[str, Any] = {"ts": 0.0, "models": None}
_openrouter_catalog_lock = asyncio.Lock()


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
        message = data.get("message", "").strip()
        knowledge_base_ids = data.get("knowledgeBaseIds", [])
        session_id = data.get("sessionId")
        
        if not message:
            raise HTTPException(status_code=400, detail="消息内容不能为空")
        
        logger.info(f"收到聊天消息: {message[:50]}..., session_id={session_id}, kb_ids={knowledge_base_ids}")
        
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
        
        # 构建会话上下文（最近N条消息）
        session_context = []
        for msg in session.get("messages", [])[-10:]:  # 只取最近10条
            if msg.get("role") in ["user", "assistant"]:
                session_context.append({
                    "role": msg["role"],
                    "content": msg.get("content", "")
                })
        
        # 构建知识库上下文
        kb_context = None
        if knowledge_base_ids:
            kb_context = {
                "kb_ids": knowledge_base_ids,
                "kb_names": []  # 可以从知识库服务获取名称
            }
        
        # 1. 执行检索
        retrieval_result = await retrieval_service.search(
            query=message,
            kb_context=kb_context,
            session_context=session_context,
        )
        
        # 2. 生成回答
        generation_result = await generation_service.generate_response(
            query=message,
            retrieval_result=retrieval_result,
            kb_context=kb_context,
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
                    "score": ref.get("score", 0.0),
                    "metadata": ref.get("metadata", {})
                })
        
        # 保存消息到会话
        session["messages"].append({
            "role": "user",
            "content": message,
            "timestamp": datetime.utcnow().isoformat()
        })
        session["messages"].append({
            "role": "assistant",
            "content": answer,
            "citations": citations,
            "timestamp": datetime.utcnow().isoformat()
        })
        session["updated_at"] = datetime.utcnow().isoformat()
        
        logger.info(f"聊天消息处理完成: session_id={session_id}, answer_length={len(answer)}")
        
        return {
            "success": True,
            "sessionId": session_id,
            "message": answer,
            "citations": citations,
            "metadata": {
                "query": message,
                "intent_type": retrieval_result.context.intent_type,
                "processing_time": retrieval_result.processing_time + generation_result.get("metadata", {}).get("generation_time", 0),
                "chunks_used": context_used.total_chunks if context_used else 0,
                "images_used": context_used.total_images if context_used else 0,
                "tokens_used": generation_result.get("metadata", {}).get("tokens_used", 0),
                "model_used": generation_result.get("metadata", {}).get("model_used", "")
            }
        }
        
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
    *,
    message: str,
    knowledge_base_ids_csv: Optional[str],
    session_id_opt: Optional[str],
    model: Optional[str],
    attachment_context: Optional[str],
    include_connected: bool = True,
) -> AsyncGenerator[str, None]:
    """流式聊天 SSE 行迭代器（GET/POST 共用）。"""
    kb_ids: List[str] = []
    if knowledge_base_ids_csv:
        kb_ids = [kb_id.strip() for kb_id in knowledge_base_ids_csv.split(",") if kb_id.strip()]

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

    session_context = []
    for msg in session.get("messages", [])[-10:]:
        if msg.get("role") in ["user", "assistant"]:
            session_context.append({"role": msg["role"], "content": msg.get("content", "")})

    kb_context = None
    if kb_ids:
        kb_context = {"kb_ids": kb_ids, "kb_names": []}

    if include_connected:
        yield f"data: {json.dumps({'type': 'connected', 'sessionId': current_session_id})}\n\n"

    retrieval_result = None
    async for stage, payload in retrieval_service.search_stream(
        query=message,
        kb_context=kb_context,
        session_context=session_context,
        attachment_context=attachment_context,
    ):
        if stage == "_result":
            retrieval_result = payload
            break
        yield f"data: {_thought_event_payload(stage, payload)}\n\n"

    if retrieval_result is None:
        raise RuntimeError("检索流未返回结果")

    yield f"data: {_thought_event_payload('generation', {'message': '正在准备生成回答...', 'status': 'preparing'})}\n\n"

    answer_chunks: List[str] = []
    last_citations: List[Any] = []
    async for event in generation_service.stream_generate_response(
        query=message,
        retrieval_result=retrieval_result,
        session_id=current_session_id,
        kb_context=kb_context,
        model=model,
        attachment_context=attachment_context,
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
            yield f"data: {_thought_event_payload(stage, pl)}\n\n"
        elif event_type == "citation":
            refs = event.data.get("references", event.data.get("citations", []))
            last_citations = refs
            yield f"data: {json.dumps({'type': 'citation', 'data': {'references': refs}}, ensure_ascii=False)}\n\n"
        elif event_type == "error":
            yield f"data: {json.dumps({'type': 'error', 'message': event.data.get('error', '未知错误')})}\n\n"
        elif event_type == "done":
            break

    full_answer = "".join(answer_chunks)
    session["messages"].append(
        {"role": "user", "content": message, "timestamp": datetime.utcnow().isoformat()}
    )
    session["messages"].append(
        {
            "role": "assistant",
            "content": full_answer,
            "citations": last_citations,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )
    session["updated_at"] = datetime.utcnow().isoformat()

    yield f"data: {json.dumps({'type': 'complete', 'sessionId': current_session_id})}\n\n"


@router.get("/stream")
async def stream_chat(
    message: str = Query(...),
    knowledgeBaseIds: Optional[str] = Query(None),
    sessionId: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
):
    """流式聊天接口 (SSE)，无附件时使用 GET。"""

    async def generate():
        try:
            async for line in _iter_chat_sse(
                message=message,
                knowledge_base_ids_csv=knowledgeBaseIds,
                session_id_opt=sessionId,
                model=model,
                attachment_context=None,
            ):
                yield line
        except Exception as e:
            logger.error(f"流式聊天失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/stream")
async def stream_chat_multipart(
    message: str = Form(""),
    knowledgeBaseIds: Optional[str] = Form(None),
    sessionId: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
):
    """流式聊天 (SSE)，支持 multipart 上传图片/音频附件（服务端生成摘要，不入库）。"""

    named_uploads = [uf for uf in files if uf.filename]
    if len(named_uploads) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"附件最多 {MAX_ATTACHMENTS} 个",
        )

    msg_stripped = (message or "").strip()

    async def generate():
        try:
            raw_files: List[Tuple[str, str, bytes]] = []
            for uf in named_uploads:
                body = await uf.read()
                raw_files.append((uf.filename, uf.content_type or "", body))

            if not msg_stripped and not raw_files:
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
                    block, _meta = await summarize_chat_attachments(
                        user_message=msg_stripped, files=raw_files
                    )
                    attachment_context = block.strip() or None
                except ValueError as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    return
                yield f"data: {_thought_event_payload('attachment', {'message': '附件摘要已完成', 'status': 'completed', 'count': len(raw_files)})}\n\n"

            effective_message = (
                msg_stripped if msg_stripped else "请结合我上传的图片/音频内容回答。"
            )

            async for line in _iter_chat_sse(
                message=effective_message,
                knowledge_base_ids_csv=knowledgeBaseIds,
                session_id_opt=current_sid,
                model=model,
                attachment_context=attachment_context,
                include_connected=False,
            ):
                yield line
        except Exception as e:
            logger.error(f"流式聊天(附件)失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
                return {
                    "success": True,
                    "sessionId": sessionId,
                    "messages": session.get("messages", []),
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
                        headers={"Accept": "application/json", "User-Agent": "MMAA-RAG/chat-api"},
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
async def list_models():
    """获取可用模型列表与当前任务模型配置（从 LLMRegistry 动态读取）"""
    r = llm_manager.registry
    task_keys = ["intent_recognition", "image_captioning", "final_generation", "reranking"]
    current_config = {}
    for task in task_keys:
        model_name = r.get_task_model(task)
        if model_name:
            mc = r.get_model_config(model_name)
            provider = mc.get("provider") or "siliconflow"
            current_config[task] = {"model": model_name, "provider": provider}

    return {
        "providers": r.list_providers(),
        "models_by_provider": r.list_models_by_provider(),
        "chat_models": r.list_models("chat"),
        "embedding_models": r.list_models("embedding"),
        "vision_models": r.list_models("vision"),
        "reranker_models": r.list_models("reranker"),
        "current_config": current_config,
    }