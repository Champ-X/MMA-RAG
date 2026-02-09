"""
流式响应管理器
实现Server-Sent Events (SSE) 流式通信
"""

from typing import Dict, List, Any, Optional, AsyncGenerator, Callable, Union
import asyncio
import json
import time
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum

from app.core.logger import get_logger

logger = get_logger(__name__)


def _reference_map_to_frontend_refs(reference_map: Any) -> List[Dict[str, Any]]:
    """将 ContextBuildResult.reference_map 转为前端 CitationReference 格式。"""
    if not reference_map:
        return []
    refs = []
    for k, v in sorted(reference_map.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0):
        ref_id = int(k) if str(k).isdigit() else len(refs) + 1
        file_name = v.file_path.split("/")[-1] if "/" in v.file_path else (v.file_path or "")
        ref_type = "doc" if v.content_type == "doc" else "image"
        score = float(v.metadata.get("score", 0.0)) if v.metadata else 0.0
        item = {
            "id": ref_id,
            "type": ref_type,
            "file_name": file_name,
            "file_path": v.file_path,
            "content": (v.content or "")[:500],
            "img_url": v.presigned_url if ref_type == "image" else None,
            "scores": {"dense": 0, "sparse": 0, "visual": 0, "rerank": score},
        }
        if ref_type == "doc":
            meta = v.metadata or {}
            chunk_id = meta.get("chunk_id")
            # doc 引用始终带 debug_info；chunk_id 必须为检索返回的向量库 point id，缺则无法查上下文
            item["debug_info"] = {
                "chunk_id": str(chunk_id) if chunk_id is not None else None,
                "kb_id": meta.get("kb_id"),
            }
            if chunk_id is None:
                logger.warning("引用缺少 chunk_id（应为检索 point id），检查器将无法拉取上下文")
        refs.append(item)
    return refs


async def _enrich_refs_with_context_window(
    refs: List[Dict[str, Any]],
    vector_store: Any,
) -> List[Dict[str, Any]]:
    """为 doc 类型引用补全 debug_info.context_window (prev/next 文本)。
    引用处 chunk_id 已统一为向量库 point id，直接据此查询即可。
    """
    empty_ctx = {"prev": "", "next": ""}
    if not vector_store:
        for ref in refs:
            if ref.get("type") == "doc":
                d = ref.get("debug_info") or {}
                d["context_window"] = empty_ctx
                ref["debug_info"] = d
        return refs
    loop = asyncio.get_event_loop()
    for ref in refs:
        if ref.get("type") != "doc":
            continue
        debug_info = ref.get("debug_info") or {}
        chunk_id = debug_info.get("chunk_id")
        if not chunk_id:
            debug_info["context_window"] = empty_ctx
            ref["debug_info"] = debug_info
            continue
        try:
            ctx = await loop.run_in_executor(
                None,
                lambda cid=str(chunk_id): vector_store.get_chunk_context_window_texts(cid),
            )
            debug_info["context_window"] = {
                "prev": (ctx or {}).get("prev", "") or "",
                "next": (ctx or {}).get("next", "") or "",
            }
            ref["debug_info"] = debug_info
        except Exception as e:
            logger.debug(f"补全 context_window 失败: chunk_id={chunk_id}, e={e}")
            debug_info["context_window"] = empty_ctx
            ref["debug_info"] = debug_info
    return refs

class StreamEventType(Enum):
    """流式事件类型"""
    CONNECTED = "connected"
    THOUGHT = "thought"
    CITATION = "citation"
    MESSAGE = "message"
    ERROR = "error"
    DONE = "done"

@dataclass
class StreamEvent:
    """流式事件数据类"""
    type: StreamEventType
    data: Dict[str, Any]
    timestamp: float

class StreamSession:
    """流式会话类"""
    
    def __init__(self, session_id: str, metadata: Dict[str, Any], created_at: float):
        self.session_id = session_id
        self.metadata = metadata
        self.created_at = created_at
        self.events: List[StreamEvent] = []
        self.is_active = True
        self.last_activity = time.time()
    
    async def send_event(self, event: StreamEvent):
        """发送事件"""
        try:
            self.events.append(event)
            self.last_activity = time.time()
            
            logger.debug(f"会话 {self.session_id} 发送事件: {event.type.value}")
            
        except Exception as e:
            logger.error(f"发送事件失败: {str(e)}")
    
    async def close(self):
        """关闭会话"""
        try:
            self.is_active = False
            logger.info(f"会话 {self.session_id} 已关闭，事件数: {len(self.events)}")
            
        except Exception as e:
            logger.error(f"关闭会话失败: {str(e)}")
    
    def get_recent_events(self, count: int = 10) -> List[StreamEvent]:
        """获取最近的事件"""
        return self.events[-count:] if self.events else []
    
    def is_expired(self, timeout: int = 3600) -> bool:
        """检查是否过期"""
        return time.time() - self.created_at > timeout

class StreamManager:
    """SSE流式响应管理器"""
    
    def __init__(self, vector_store: Any = None):
        self.active_streams: Dict[str, StreamSession] = {}
        self.session_timeout = 3600  # 会话超时时间（秒）
        self.vector_store = vector_store
    
    async def create_session(
        self,
        session_id: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> StreamSession:
        """创建流式会话"""
        try:
            session = StreamSession(
                session_id=session_id,
                metadata=metadata or {},
                created_at=time.time()
            )
            
            self.active_streams[session_id] = session
            
            logger.info(f"创建流式会话: {session_id}")
            
            return session
            
        except Exception as e:
            logger.error(f"创建流式会话失败: {str(e)}")
            raise
    
    async def get_session(self, session_id: str) -> Optional[StreamSession]:
        """获取流式会话"""
        return self.active_streams.get(session_id)
    
    async def close_session(self, session_id: str) -> bool:
        """关闭流式会话"""
        try:
            if session_id in self.active_streams:
                session = self.active_streams[session_id]
                await session.close()
                del self.active_streams[session_id]
                
                logger.info(f"关闭流式会话: {session_id}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"关闭流式会话失败: {str(e)}")
            return False
    
    async def cleanup_expired_sessions(self):
        """清理过期会话"""
        try:
            current_time = time.time()
            expired_sessions = []
            
            for session_id, session in self.active_streams.items():
                if current_time - session.created_at > self.session_timeout:
                    expired_sessions.append(session_id)
            
            for session_id in expired_sessions:
                await self.close_session(session_id)
            
            if expired_sessions:
                logger.info(f"清理过期会话: {len(expired_sessions)} 个")
            
        except Exception as e:
            logger.error(f"清理过期会话失败: {str(e)}")
    
    async def stream_chat_response(
        self,
        session_id: str,
        query: str,
        context_result: Any,
        system_prompt: str,
        user_input: str,
        llm_manager: Any,
        model: Optional[str] = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """流式聊天响应：使用真实 LLM 流式生成，并发送引用事件。思考事件由 chat.py 在检索后发送。"""
        try:
            session = await self.get_session(session_id)
            if not session:
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    data={"error": "会话不存在"},
                    timestamp=time.time()
                )
                return

            # 1. 发送连接事件（可选，与 chat.py 的 connected 一致）
            yield StreamEvent(
                type=StreamEventType.CONNECTED,
                data={"session_id": session_id, "query": query},
                timestamp=time.time()
            )

            # 2. 真实流式生成 + 引用
            async for event in self._generate_streaming_response(
                session, query, context_result, system_prompt, user_input, llm_manager, model
            ):
                yield event

            # 3. 完成事件
            yield StreamEvent(
                type=StreamEventType.DONE,
                data={"session_id": session_id},
                timestamp=time.time()
            )

        except Exception as e:
            logger.error(f"流式聊天响应失败: {str(e)}")
            yield StreamEvent(
                type=StreamEventType.ERROR,
                data={"error": str(e)},
                timestamp=time.time()
            )
    
    async def _send_thought_event(
        self,
        session: StreamSession,
        stage: str,
        data: Optional[Dict[str, Any]] = None
    ):
        """发送思考事件"""
        event_data = {"stage": stage}
        if data:
            event_data.update(data)
        
        await session.send_event(
            StreamEvent(
                type=StreamEventType.THOUGHT,
                data=event_data,
                timestamp=time.time()
            )
        )
    
    async def _send_citation_event(
        self,
        session: StreamSession,
        references: List[Dict[str, Any]]
    ):
        """发送引用事件"""
        await session.send_event(
            StreamEvent(
                type=StreamEventType.CITATION,
                data={"references": references},
                timestamp=time.time()
            )
        )
    
    async def _generate_streaming_response(
        self,
        session: StreamSession,
        query: str,
        context_result: Any,
        system_prompt: str,
        user_input: str,
        llm_manager: Any,
        model: Optional[str] = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """使用真实 LLM 流式生成回答，并在结束后发送引用事件。"""
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ]
            model_name = model or llm_manager.registry.get_task_model("final_generation")
            logger.info(f"开始调用 final_generation 模型流式生成回答: {model_name}")
            chunk_count = 0
            async for delta in llm_manager.stream_chat(
                messages=messages,
                task_type="final_generation",
                model=model,
                temperature=0.3,
            ):
                if delta:
                    chunk_count += 1
                    yield StreamEvent(
                        type=StreamEventType.MESSAGE,
                        data={"content": delta, "delta": True},
                        timestamp=time.time()
                    )
            
            logger.info(f"final_generation 模型流式生成完成: 共收到 {chunk_count} 个数据块")

            # 流结束后发送引用（与前端 CitationReference 格式一致）
            refs = _reference_map_to_frontend_refs(
                getattr(context_result, "reference_map", None) or {}
            )
            if self.vector_store:
                refs = await _enrich_refs_with_context_window(refs, self.vector_store)
            yield StreamEvent(
                type=StreamEventType.CITATION,
                data={"references": refs},
                timestamp=time.time()
            )

        except Exception as e:
            err_msg = str(e).strip() or repr(e)
            logger.error(f"生成流式回答失败: {type(e).__name__} - {err_msg}", exc_info=True)
            yield StreamEvent(
                type=StreamEventType.ERROR,
                data={"error": err_msg},
                timestamp=time.time()
            )
    
    def format_sse_event(self, event: StreamEvent) -> str:
        """格式化SSE事件"""
        try:
            event_data = {
                "type": event.type.value,
                "data": event.data,
                "timestamp": event.timestamp
            }
            
            return f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            logger.error(f"格式化SSE事件失败: {str(e)}")
            return f"data: {json.dumps({'type': 'error', 'data': {'error': str(e)}})}\n\n"
    
    async def get_session_statistics(self) -> Dict[str, Any]:
        """获取会话统计"""
        try:
            return {
                "active_sessions": len(self.active_streams),
                "sessions": [
                    {
                        "session_id": session.session_id,
                        "created_at": session.created_at,
                        "event_count": len(session.events),
                        "metadata": session.metadata
                    }
                    for session in self.active_streams.values()
                ]
            }
            
        except Exception as e:
            logger.error(f"获取会话统计失败: {str(e)}")
            return {}

# 全局流式管理器实例
stream_manager = StreamManager()