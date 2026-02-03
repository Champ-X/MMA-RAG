"""
聊天API路由
处理对话和问答请求
"""

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional
import json
import asyncio
import uuid
from datetime import datetime

from app.core.logger import get_logger
from app.core.llm.manager import llm_manager
from app.modules.retrieval.service import RetrievalService
from app.modules.generation.service import GenerationService

router = APIRouter()
logger = get_logger(__name__)

# 创建服务实例
retrieval_service = RetrievalService()
generation_service = GenerationService()

# 简单的会话存储（生产环境应使用Redis或数据库）
sessions: Dict[str, Dict[str, Any]] = {}

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
            session_context=session_context
        )
        
        # 2. 生成回答
        generation_result = await generation_service.generate_response(
            query=message,
            retrieval_result=retrieval_result,
            kb_context=kb_context
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

@router.get("/stream")
async def stream_chat(
    message: str = Query(...),
    knowledgeBaseIds: Optional[str] = Query(None),
    sessionId: Optional[str] = Query(None)
):
    """流式聊天接口 (SSE)"""
    async def generate():
        try:
            # 解析知识库ID
            kb_ids = []
            if knowledgeBaseIds:
                kb_ids = [kb_id.strip() for kb_id in knowledgeBaseIds.split(",") if kb_id.strip()]
            
            # 获取或创建会话
            if not sessionId:
                current_session_id = str(uuid.uuid4())
            else:
                current_session_id = sessionId
            
            session = sessions.get(current_session_id, {})
            if not session:
                session = {
                    "id": current_session_id,
                    "messages": [],
                    "knowledge_base_ids": kb_ids,
                    "created_at": datetime.utcnow().isoformat()
                }
                sessions[current_session_id] = session
            
            # 构建会话上下文
            session_context = []
            for msg in session.get("messages", [])[-10:]:
                if msg.get("role") in ["user", "assistant"]:
                    session_context.append({
                        "role": msg["role"],
                        "content": msg.get("content", "")
                    })
            
            # 构建知识库上下文
            kb_context = None
            if kb_ids:
                kb_context = {
                    "kb_ids": kb_ids,
                    "kb_names": []
                }
            
            # 发送连接事件
            yield f"data: {json.dumps({'type': 'connected', 'sessionId': current_session_id})}\n\n"

            def _thought_event(stage: str, payload: dict) -> str:
                """前端期望: type=thought, data={ type: <phase>, data: { ... } }"""
                return json.dumps({
                    "type": "thought",
                    "data": {"type": stage, "data": payload},
                    "timestamp": datetime.utcnow().timestamp()
                }, ensure_ascii=False)

            # 1. 流式检索：每完成一个阶段立即推送 thought 事件，前端可逐步展示
            retrieval_result = None
            async for stage, payload in retrieval_service.search_stream(
                query=message,
                kb_context=kb_context,
                session_context=session_context
            ):
                if stage == "_result":
                    retrieval_result = payload
                    break
                yield f"data: {_thought_event(stage, payload)}\n\n"

            if retrieval_result is None:
                raise RuntimeError("检索流未返回结果")

            # 2. 生成阶段（简单提示）
            yield f"data: {_thought_event('generation', {'message': '正在生成回答...'})}\n\n"

            answer_chunks = []
            async for event in generation_service.stream_generate_response(
                query=message,
                retrieval_result=retrieval_result,
                session_id=current_session_id,
                kb_context=kb_context
            ):
                event_type = event.type.value if hasattr(event.type, "value") else str(event.type)

                if event_type == "message":
                    chunk = event.data.get("content", "")
                    answer_chunks.append(chunk)
                    yield f"data: {json.dumps({'type': 'message', 'data': {'delta': chunk}})}\n\n"
                elif event_type == "thought":
                    stage = event.data.get("stage", "generation")
                    msg = event.data.get("message", "")
                    yield f"data: {_thought_event(stage, msg)}\n\n"
                elif event_type == "citation":
                    refs = event.data.get("references", event.data.get("citations", []))
                    yield f"data: {json.dumps({'type': 'citation', 'data': {'references': refs}}, ensure_ascii=False)}\n\n"
                elif event_type == "error":
                    yield f"data: {json.dumps({'type': 'error', 'message': event.data.get('error', '未知错误')})}\n\n"
                elif event_type == "done":
                    break

            # 保存消息到会话
            full_answer = "".join(answer_chunks)
            session["messages"].append({
                "role": "user",
                "content": message,
                "timestamp": datetime.utcnow().isoformat()
            })
            session["messages"].append({
                "role": "assistant",
                "content": full_answer,
                "timestamp": datetime.utcnow().isoformat()
            })
            session["updated_at"] = datetime.utcnow().isoformat()

            # 发送完成事件（前端期望 type=complete）
            yield f"data: {json.dumps({'type': 'complete', 'sessionId': current_session_id})}\n\n"
            
        except Exception as e:
            logger.error(f"流式聊天失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")

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
        "chat_models": r.list_models("chat"),
        "embedding_models": r.list_models("embedding"),
        "vision_models": r.list_models("vision"),
        "reranker_models": r.list_models("reranker"),
        "current_config": current_config,
    }