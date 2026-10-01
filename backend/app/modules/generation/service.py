"""
生成服务
整合上下文构建、提示词管理和流式响应
"""

from typing import Dict, List, Any, Optional, AsyncGenerator
from datetime import datetime
import time

from .context_builder import ContextBuilder
from .stream_manager import StreamManager, StreamEvent, StreamEventType
from .templates.system_prompts import SystemPromptManager
from .jev_answer_audit import maybe_audit_answer
from .citation_selection import select_answer_references
from app.core.llm.manager import llm_manager
from app.core.logger import get_logger, audit_log

logger = get_logger(__name__)

MULTI_TURN_SYSTEM_INSTRUCTIONS = """

# 多轮会话约束
- 对话历史仅用于理解指代、延续主题和保持回答连贯；当前轮检索到的参考材料优先。
- 历史助手回答中的 `[n]` 引用编号属于旧轮次，禁止在本轮复用。
- 本轮只能引用当前用户输入中“参考材料列表”实际提供的编号。
""".rstrip()


def _get_vector_store():
    try:
        from app.modules.ingestion.storage.vector_store import VectorStore
        return VectorStore()
    except Exception as e:
        logger.debug(f"VectorStore 未注入到 StreamManager: {e}")
        return None


class GenerationService:
    """LLM内容生成服务"""
    
    def __init__(self):
        self.context_builder = ContextBuilder()
        self.stream_manager = StreamManager(vector_store=_get_vector_store())
        self.prompt_manager = SystemPromptManager()
        self.llm_manager = llm_manager
    
    async def generate_response(
        self,
        query: str,
        retrieval_result: Any,
        session_id: Optional[str] = None,
        kb_context: Optional[Dict[str, Any]] = None,
        attachment_context: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        生成回答
        
        Args:
            query: 用户查询
            retrieval_result: 检索结果
            session_id: 会话ID（用于流式响应）
            kb_context: 知识库上下文
            
        Returns:
            生成结果
        """
        try:
            logger.info(f"开始生成回答: 查询='{query}'")
            
            # 1. 构建上下文
            context_result = await self.context_builder.build_context(
                retrieval_result=retrieval_result,
                query=query,
                kb_context=kb_context,
                attachment_context=attachment_context,
            )
            
            # 2. 构建系统提示词
            intent_type = getattr(retrieval_result.context, 'intent_type', 'factual')
            system_prompt = self.prompt_manager.build_system_prompt(intent_type)
            if session_context:
                system_prompt = f"{system_prompt}\n{MULTI_TURN_SYSTEM_INSTRUCTIONS}"
            
            # 3. 构建用户输入
            user_input = self.context_builder.formatter.format_user_query(
                query=query,
                context=context_result.context_string
            )
            
            # 4. 调用LLM生成回答
            messages = [{"role": "system", "content": system_prompt}]
            messages.extend(session_context or [])
            messages.append({"role": "user", "content": user_input})
            
            logger.info("开始调用 final_generation 模型生成回答")
            llm_result = await self.llm_manager.chat(
                messages=messages,
                task_type="final_generation",
                temperature=0.3
            )
            logger.info(f"final_generation 模型调用完成: model={llm_result.model_used}, success={llm_result.success}")
            
            if not llm_result.success:
                logger.error(f"LLM生成失败: {llm_result.error}")
                return {
                    "success": False,
                    "error": llm_result.error,
                    "answer": "抱歉，生成回答时出现错误。",
                    "context_used": context_result
                }
            
            # 5. 提取回答内容
            answer = (llm_result.data or {}).get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # 6. 验证引用
            valid_references = self.context_builder.validate_references(
                answer, 
                context_result.reference_map
            )
            
            audit_log(
                f"回答生成完成: {query[:50]}...",
                query_length=len(query),
                answer_length=len(answer),
                references_used=len(valid_references),
                chunks_used=context_result.total_chunks,
                images_used=context_result.total_images,
                tokens_used=(llm_result.data or {}).get("usage", {}).get("total_tokens", 0)
            )
            
            logger.info(f"回答生成完成: 长度={len(answer)}, 引用={len(valid_references)}")
            citation_audit = await maybe_audit_answer(answer, context_result.reference_map)
            
            return {
                "success": True,
                "answer": answer,
                "context_used": context_result,
                "references_used": valid_references,
                "metadata": {
                    "query": query,
                    "intent_type": intent_type,
                    "chunks_count": context_result.total_chunks,
                    "images_count": context_result.total_images,
                    "tokens_used": (llm_result.data or {}).get("usage", {}).get("total_tokens", 0),
                    "model_used": llm_result.model_used,
                    "generation_time": llm_result.duration,
                    **({"jev_citation_audit": citation_audit} if citation_audit is not None else {})
                }
            }
            
        except Exception as e:
            logger.error(f"生成回答失败: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "answer": "抱歉，生成回答时出现系统错误。",
                "context_used": None
            }
    
    async def stream_generate_response(
        self,
        query: str,
        retrieval_result: Any,
        session_id: str,
        kb_context: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
        attachment_context: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        流式生成回答
        
        Args:
            query: 用户查询
            retrieval_result: 检索结果
            session_id: 会话ID
            kb_context: 知识库上下文
            
        Yields:
            StreamEvent: 流式事件
        """
        try:
            # 创建或获取会话
            if session_id not in self.stream_manager.active_streams:
                await self.stream_manager.create_session(
                    session_id=session_id,
                    metadata={"query": query, "created_at": datetime.utcnow().isoformat()}
                )
            
            # 发送"开始准备上下文"事件
            yield StreamEvent(
                type=StreamEventType.THOUGHT,
                data={"stage": "generation", "message": "正在构建上下文...", "status": "building_context"},
                timestamp=datetime.utcnow().timestamp()
            )
            
            # 构建上下文
            context_result = await self.context_builder.build_context(
                retrieval_result=retrieval_result,
                query=query,
                kb_context=kb_context,
                attachment_context=attachment_context,
            )
            
            # 发送"准备提示词"事件
            yield StreamEvent(
                type=StreamEventType.THOUGHT,
                data={"stage": "generation", "message": "正在准备提示词...", "status": "preparing_prompt"},
                timestamp=datetime.utcnow().timestamp()
            )
            
            # 构建系统提示词
            intent_type = getattr(retrieval_result.context, 'intent_type', 'factual')
            system_prompt = self.prompt_manager.build_system_prompt(intent_type)
            if session_context:
                system_prompt = f"{system_prompt}\n{MULTI_TURN_SYSTEM_INSTRUCTIONS}"
            
            # 构建用户输入
            user_input = self.context_builder.formatter.format_user_query(
                query=query,
                context=context_result.context_string
            )
            
            # 发送"开始生成"事件，让前端知道流式生成即将开始
            yield StreamEvent(
                type=StreamEventType.THOUGHT,
                data={"stage": "generation", "message": "正在生成回答...", "status": "generating"},
                timestamp=datetime.utcnow().timestamp()
            )
            
            # 开始流式响应（传入 context、提示词与用户输入，供真实 LLM 流式生成）
            answer_chunks: List[str] = []
            candidate_references: List[Dict[str, Any]] = []
            async for event in self.stream_manager.stream_chat_response(
                session_id=session_id,
                query=query,
                context_result=context_result,
                system_prompt=system_prompt,
                user_input=user_input,
                llm_manager=self.llm_manager,
                model=model,
                session_context=session_context,
            ):
                # 收集完整正文供完成后的引用审计使用
                if event.type == StreamEventType.MESSAGE:
                    chunk = event.data.get("content") or event.data.get("delta") or ""
                    if chunk:
                        answer_chunks.append(chunk)
                    yield event
                elif event.type == StreamEventType.CITATION:
                    # 引用在正文前预加载，不能用尚为空的正文筛选，否则整张映射被清空。
                    # 完成后以实际正文引用替换候选映射，避免把检索命中当作已采用的来源。
                    candidate_references = event.data.get("references", [])
                    yield event
                elif event.type == StreamEventType.DONE:
                    full_answer = "".join(answer_chunks)
                    yield StreamEvent(
                        type=StreamEventType.CITATION,
                        data={"references": select_answer_references(full_answer, candidate_references),
                              "replace": True},
                        timestamp=time.time(),
                    )
                    # Only successful completed answers are audited.
                    citation_audit = await maybe_audit_answer(full_answer, context_result.reference_map)
                    if citation_audit is not None:
                        event = StreamEvent(type=event.type, timestamp=time.time(),
                                            data={**event.data, "jev_citation_audit": citation_audit})
                    yield event
                else:
                    yield event
            
        except Exception as e:
            logger.error(f"流式生成失败: {str(e)}")
            yield StreamEvent(
                type=StreamEventType.ERROR,
                data={"error": str(e)},
                timestamp=datetime.utcnow().timestamp()
            )
    
    async def generate_summary(
        self,
        content: str,
        summary_type: str = "general"
    ) -> Dict[str, Any]:
        """生成内容摘要"""
        try:
            summary_prompts = {
                "general": f"请为以下内容生成简洁的摘要：\n\n{content}",
                "executive": f"请为以下内容生成高管摘要：\n\n{content}",
                "technical": f"请为以下技术内容生成详细摘要：\n\n{content}"
            }
            
            prompt = summary_prompts.get(summary_type, summary_prompts["general"])
            
            messages = [
                {"role": "user", "content": prompt}
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="final_generation",
                temperature=0.3
            )
            
            if result.success:
                summary = (result.data or {}).get("choices", [{}])[0].get("message", {}).get("content", "")
                
                return {
                    "success": True,
                    "summary": summary,
                    "summary_type": summary_type,
                    "tokens_used": (result.data or {}).get("usage", {}).get("total_tokens", 0)
                }
            else:
                return {
                    "success": False,
                    "error": result.error,
                    "summary": ""
                }
                
        except Exception as e:
            logger.error(f"生成摘要失败: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "summary": ""
            }
    
    async def analyze_content(
        self,
        content: str,
        analysis_type: str = "general"
    ) -> Dict[str, Any]:
        """分析内容"""
        try:
            analysis_prompts = {
                "sentiment": f"请分析以下内容的情感倾向：\n\n{content}",
                "topics": f"请提取以下内容的主要主题：\n\n{content}",
                "entities": f"请提取以下内容中的实体信息：\n\n{content}",
                "structure": f"请分析以下内容的结构：\n\n{content}"
            }
            
            prompt = analysis_prompts.get(analysis_type, analysis_prompts["sentiment"])
            
            messages = [
                {"role": "user", "content": prompt}
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="final_generation",
                temperature=0.3
            )
            
            if result.success:
                analysis = (result.data or {}).get("choices", [{}])[0].get("message", {}).get("content", "")
                
                return {
                    "success": True,
                    "analysis": analysis,
                    "analysis_type": analysis_type,
                    "tokens_used": (result.data or {}).get("usage", {}).get("total_tokens", 0)
                }
            else:
                return {
                    "success": False,
                    "error": result.error,
                    "analysis": ""
                }
                
        except Exception as e:
            logger.error(f"内容分析失败: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "analysis": ""
            }
    
    async def get_generation_statistics(self) -> Dict[str, Any]:
        """获取生成统计"""
        try:
            # 获取流式管理器统计
            stream_stats = await self.stream_manager.get_session_statistics()
            
            # 获取上下文构建器统计
            context_stats = await self.context_builder.get_context_statistics()
            
            # 获取提示词管理器统计
            prompt_stats = self.prompt_manager.get_prompt_statistics()
            
            return {
                "stream_sessions": stream_stats,
                "context_building": context_stats,
                "prompt_management": prompt_stats,
                "llm_manager_status": "healthy"  # 可以添加实际检查
            }
            
        except Exception as e:
            logger.error(f"获取生成统计失败: {str(e)}")
            return {}
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 检查各个组件
            components_health = {
                "context_builder": "healthy",  # 可以添加实际检查
                "stream_manager": "healthy",   # 可以添加实际检查
                "prompt_manager": "healthy",    # 可以添加实际检查
                "llm_manager": "healthy"        # 可以添加实际检查
            }
            
            all_healthy = all(
                status == "healthy" 
                for status in components_health.values()
            )
            
            return {
                "status": "healthy" if all_healthy else "unhealthy",
                "components": components_health,
                "active_streams": len(self.stream_manager.active_streams)
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }
