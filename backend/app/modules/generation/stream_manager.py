"""
流式响应管理器
实现Server-Sent Events (SSE) 流式通信
"""

from typing import Dict, List, Any, Optional, AsyncGenerator, Callable
import asyncio
import json
import time
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum

from app.core.logger import get_logger

logger = get_logger(__name__)

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
    
    def __init__(self):
        self.active_streams: Dict[str, StreamSession] = {}
        self.session_timeout = 3600  # 会话超时时间（秒）
    
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
        context_builder: Callable,
        llm_manager: Any
    ) -> AsyncGenerator[StreamEvent, None]:
        """流式聊天响应"""
        try:
            session = await self.get_session(session_id)
            if not session:
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    data={"error": "会话不存在"},
                    timestamp=time.time()
                )
                return
            
            # 1. 发送连接事件
            yield StreamEvent(
                type=StreamEventType.CONNECTED,
                data={"session_id": session_id, "query": query},
                timestamp=time.time()
            )
            
            # 2. 开始思考阶段
            await self._send_thought_event(session, "开始分析用户查询")
            
            # 3. 意图识别
            await self._send_thought_event(session, "进行意图识别")
            await asyncio.sleep(0.5)  # 模拟处理时间
            
            # 4. 检索阶段
            await self._send_thought_event(session, "执行混合检索")
            await asyncio.sleep(0.8)  # 模拟检索时间
            
            # 5. 重排阶段
            await self._send_thought_event(session, "应用重排序")
            await asyncio.sleep(0.3)  # 模拟重排时间
            
            # 6. 发送引用预加载
            await self._send_citation_event(session, [])
            
            # 7. 开始生成回答
            await self._send_thought_event(session, "开始生成回答")
            
            # 8. 模拟流式回答生成
            async for chunk in self._generate_streaming_response(session, query, llm_manager):
                yield chunk
            
            # 9. 完成事件
            yield StreamEvent(
                type=StreamEventType.DONE,
                data={"session_id": session_id, "total_chunks": 1},
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
        llm_manager: Any
    ) -> AsyncGenerator[StreamEvent, None]:
        """生成流式回答"""
        try:
            # 这里实现实际的流式回答生成
            # 暂时使用模拟回答
            
            response_text = f"基于您的查询 '{query}'，我需要为您提供一个详细的回答。这是一个多模态RAG系统的示例回答，包含了文档和图片信息的引用。[1][2]"
            
            # 模拟流式输出
            words = response_text.split()
            current_text = ""
            
            for word in words:
                current_text += word + " "
                
                yield StreamEvent(
                    type=StreamEventType.MESSAGE,
                    data={
                        "content": word + " ",
                        "delta": True,
                        "full_content": current_text.strip()
                    },
                    timestamp=time.time()
                )
                
                await asyncio.sleep(0.1)  # 模拟打字效果
            
        except Exception as e:
            logger.error(f"生成流式回答失败: {str(e)}")
            yield StreamEvent(
                type=StreamEventType.ERROR,
                data={"error": str(e)},
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