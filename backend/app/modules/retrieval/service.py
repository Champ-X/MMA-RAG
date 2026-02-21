"""
检索服务
协调查询预处理、检索和重排的完整流程
"""

from typing import Dict, List, Any, Optional, AsyncGenerator, Tuple
from datetime import datetime
from dataclasses import dataclass

from .processors.intent import IntentProcessor
from .processors.rewriter import QueryRewriter
from .search_engine import HybridSearchEngine
from .reranker import Reranker
from app.core.logger import get_logger, audit_log
from app.modules.knowledge.router import KnowledgeRouter

logger = get_logger(__name__)

@dataclass
class RetrievalContext:
    """检索上下文数据类"""
    original_query: str
    refined_query: str
    intent_type: str
    is_complex: bool
    visual_intent: str  # 视觉意图：explicit_demand, implicit_enrichment, unnecessary
    visual_reasoning: str  # 视觉意图推理说明
    audio_intent: str  # 音频意图：explicit_demand, implicit_enrichment, unnecessary
    audio_reasoning: str  # 音频意图推理说明
    search_strategies: Dict[str, Any]
    target_kb_ids: List[str]
    confidence_scores: Dict[str, float]
    processing_time: float = 0.0

@dataclass
class RetrievalResult:
    """检索结果数据类"""
    context: RetrievalContext
    raw_results: Dict[str, List[Dict[str, Any]]]
    reranked_results: List[Dict[str, Any]]
    processing_time: float
    debug_info: Dict[str, Any]

class RetrievalService:
    """检索服务"""
    
    def __init__(self):
        self.intent_processor = IntentProcessor()
        self.query_rewriter = QueryRewriter()
        self.search_engine = HybridSearchEngine()
        self.reranker = Reranker()
        self.kb_router = KnowledgeRouter()
        
        # 检索统计信息存储（生产环境应使用Redis或数据库）
        self._retrieval_stats: Dict[str, Any] = {
            "total_searches": 0,
            "total_processing_time": 0.0,
            "intent_distribution": {},
            "routing_distribution": {},
            "retrieval_strategy_usage": {},
            "average_result_count": 0.0,
            "total_result_count": 0,
            "last_updated": datetime.utcnow().isoformat()
        }
    
    async def search(
        self,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None
    ) -> RetrievalResult:
        """
        执行完整检索流程
        
        Args:
            query: 用户查询
            kb_context: 知识库上下文
            user_id: 用户ID
            session_context: 会话上下文
            
        Returns:
            检索结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始检索流程: {query}")
            
            # 1. 查询预处理 - One-Pass 意图识别
            preprocessing_result = await self._preprocess_query(
                query=query,
                session_context=session_context or []
            )
            
            # 2. 知识库路由
            routing_result = await self._route_to_knowledge_bases(
                preprocessing_result["refined_query"],
                kb_context=kb_context
            )
            
            # 3. 构建检索上下文
            retrieval_context = RetrievalContext(
                original_query=query,
                refined_query=preprocessing_result["refined_query"],
                intent_type=preprocessing_result["intent_type"],
                is_complex=preprocessing_result["is_complex"],
                visual_intent=preprocessing_result.get("visual_intent", "unnecessary"),
                visual_reasoning=preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                audio_intent=preprocessing_result.get("audio_intent", "unnecessary"),
                audio_reasoning=preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                search_strategies=preprocessing_result["search_strategies"],
                target_kb_ids=routing_result.target_kb_ids,
                confidence_scores=routing_result.confidence_scores
            )
            
            # 4. 混合检索
            search_results = await self._perform_hybrid_search(retrieval_context)
            
            # 5. 两阶段重排
            reranked_results = await self._apply_reranking(
                retrieval_context, search_results
            )
            
            # 6. 计算总处理时间
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            retrieval_context.processing_time = processing_time
            
            # 7. 构建调试信息
            debug_info = {
                "preprocessing_time": preprocessing_result.get("processing_time", 0),
                "routing_time": routing_result.processing_time,
                "search_time": search_results.get("processing_time", 0),
                "reranking_time": reranked_results.get("processing_time", 0),
                "total_time": processing_time,
                "routing_method": routing_result.routing_method,
                "retrieval_strategy": search_results.get("strategy"),
                "total_candidates": sum(
                    len(results) for results in search_results.get("raw_results", {}).values()
                )
            }
            
            # 更新检索统计信息
            self._update_retrieval_stats(
                intent_type=preprocessing_result["intent_type"],
                routing_method=routing_result.routing_method,
                retrieval_strategy=search_results.get("strategy", "unknown"),
                processing_time=processing_time,
                result_count=len(reranked_results.get("results", []))
            )
            
            audit_log(
                f"检索流程完成: {query[:50]}...",
                query_length=len(query),
                intent_type=preprocessing_result["intent_type"],
                target_kbs=retrieval_context.target_kb_ids,
                result_count=len(reranked_results.get("results", [])),
                processing_time=processing_time
            )
            
            logger.info(
                f"检索完成: 查询='{query}', 意图='{preprocessing_result['intent_type']}', "
                f"目标KB={len(retrieval_context.target_kb_ids)}, "
                f"结果数={len(reranked_results.get('results', []))}"
            )
            
            return RetrievalResult(
                context=retrieval_context,
                raw_results=search_results.get("raw_results", {}),
                reranked_results=reranked_results.get("results", []),
                processing_time=processing_time,
                debug_info=debug_info
            )
            
        except Exception as e:
            logger.error(f"检索流程失败: {str(e)}")
            raise

    async def search_stream(
        self,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
    ) -> AsyncGenerator[Tuple[str, Any], None]:
        """
        流式检索：每完成一个阶段就 yield (stage, payload)，最后 yield ("_result", retrieval_result)。
        用于 SSE 流式聊天时按阶段推送思考过程，避免等全部检索完才一次性展示。
        """
        start_time = datetime.utcnow()
        try:
            logger.info(f"开始检索流程(流式): {query}")

            # 1. 查询预处理 - One-Pass 意图识别
            preprocessing_result = await self._preprocess_query(
                query=query,
                session_context=session_context or []
            )
            intent_payload = {
                "message": "意图解析完成",
                "intent_type": preprocessing_result.get("intent_type", "factual"),
                "original_query": preprocessing_result.get("original_query", query),
                "refined_query": preprocessing_result.get("refined_query", query),
                "visual_intent": preprocessing_result.get("visual_intent", "unnecessary"),
                "visual_reasoning": preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                "audio_intent": preprocessing_result.get("audio_intent", "unnecessary"),
                "audio_reasoning": preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                "is_complex": preprocessing_result.get("is_complex", False),
                "sub_queries": preprocessing_result.get("sub_queries", []) or [],
            }
            yield ("intent", intent_payload)

            # 2. 知识库路由
            routing_result = await self._route_to_knowledge_bases(
                preprocessing_result["refined_query"],
                kb_context=kb_context
            )
            target_kb_ids = getattr(routing_result, "target_kb_ids", []) or []
            confidence_scores = getattr(routing_result, "confidence_scores", {}) or {}
            target_kbs = getattr(routing_result, "target_kbs", None)
            if not target_kbs:
                target_kbs = [
                    {"id": kb_id, "name": kb_id, "score": float(confidence_scores.get(kb_id, 0))}
                    for kb_id in target_kb_ids
                ]
            routing_payload = {
                "message": "智能路由完成",
                "target_kbs": target_kbs,
                "fallback_search": len(target_kb_ids) == 0,
            }
            yield ("routing", routing_payload)

            # 3. 构建检索上下文
            retrieval_context = RetrievalContext(
                original_query=query,
                refined_query=preprocessing_result["refined_query"],
                intent_type=preprocessing_result["intent_type"],
                is_complex=preprocessing_result["is_complex"],
                visual_intent=preprocessing_result.get("visual_intent", "unnecessary"),
                visual_reasoning=preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                audio_intent=preprocessing_result.get("audio_intent", "unnecessary"),
                audio_reasoning=preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                search_strategies=preprocessing_result["search_strategies"],
                target_kb_ids=target_kb_ids,
                confidence_scores=confidence_scores,
            )

            # 4. 混合检索
            search_results = await self._perform_hybrid_search(retrieval_context)

            # 5. 两阶段重排
            reranked_results = await self._apply_reranking(
                retrieval_context, search_results
            )
            results_list = reranked_results.get("results", [])

            # 6. 总处理时间与调试信息
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            retrieval_context.processing_time = processing_time
            debug_info = {
                "preprocessing_time": preprocessing_result.get("processing_time", 0),
                "routing_time": getattr(routing_result, "processing_time", 0),
                "search_time": search_results.get("processing_time", 0),
                "reranking_time": reranked_results.get("processing_time", 0),
                "total_time": processing_time,
                "routing_method": getattr(routing_result, "routing_method", ""),
                "retrieval_strategy": search_results.get("strategy"),
                "total_candidates": sum(
                    len(results) for results in search_results.get("raw_results", {}).values()
                ),
            }
            strategies = retrieval_context.search_strategies or {}
            sparse_keywords = list(strategies.get("sparse_keywords", []) or [])
            # 获取重排统计信息
            coarse_ranking_count = reranked_results.get("coarse_ranking_count", 0)
            final_ranking_count = reranked_results.get("final_ranking_count", len(results_list))
            retrieval_payload = {
                "message": f"检索完成，找到 {len(results_list)} 个相关结果",
                "sparse_keywords": sparse_keywords,
                "sub_queries": getattr(retrieval_context, "sub_queries", []) or preprocessing_result.get("sub_queries", []) or [],
                "total_found": coarse_ranking_count if coarse_ranking_count > 0 else len(results_list),  # 粗排后的候选数量
                "reranked_count": final_ranking_count,  # 重排后保留的数量
            }
            yield ("retrieval", retrieval_payload)

            self._update_retrieval_stats(
                intent_type=preprocessing_result["intent_type"],
                routing_method=getattr(routing_result, "routing_method", "unknown"),
                retrieval_strategy=search_results.get("strategy", "unknown"),
                processing_time=processing_time,
                result_count=len(results_list),
            )
            audit_log(
                f"检索流程完成: {query[:50]}...",
                query_length=len(query),
                intent_type=preprocessing_result["intent_type"],
                target_kbs=retrieval_context.target_kb_ids,
                result_count=len(results_list),
                processing_time=processing_time,
            )

            retrieval_result = RetrievalResult(
                context=retrieval_context,
                raw_results=search_results.get("raw_results", {}),
                reranked_results=results_list,
                processing_time=processing_time,
                debug_info=debug_info,
            )
            yield ("_result", retrieval_result)

        except Exception as e:
            logger.error(f"检索流程(流式)失败: {str(e)}")
            raise

    async def _preprocess_query(
        self,
        query: str,
        session_context: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """查询预处理"""
        try:
            # One-Pass 意图识别
            intent_result = await self.intent_processor.process(
                query=query,
                chat_history=session_context
            )
            
            # 获取 refined_query，如果不存在则从 search_strategies 或使用 original_query
            refined_query = intent_result.get(
                "refined_query",
                intent_result.get("search_strategies", {}).get("dense_query", intent_result.get("original_query", query))
            )
            
            # 查询改写与扩展
            rewriter_result = await self.query_rewriter.rewrite(
                original_query=refined_query,
                chat_history=session_context,
                intent_analysis=intent_result
            )
            
            # 合并结果
            final_refined_query = rewriter_result.get("refined_query", refined_query)
            preprocessing_result = {
                "original_query": query,
                "refined_query": final_refined_query,
                "intent_type": intent_result.get("intent_type", "factual"),
                "is_complex": intent_result.get("is_complex", False),
                "visual_intent": intent_result.get("visual_intent", "unnecessary"),
                "visual_reasoning": intent_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                "audio_intent": intent_result.get("audio_intent", "unnecessary"),
                "audio_reasoning": intent_result.get("audio_reasoning", "未检测到音频需求"),
                "search_strategies": {
                    "dense_query": final_refined_query,
                    "original_query": intent_result.get("original_query", query),
                    "multi_view_queries": rewriter_result.get("multi_view_queries", []),
                    "sparse_keywords": rewriter_result.get("keywords", [])
                },
                "sub_queries": intent_result.get("sub_queries", []),
                "processing_time": 0.0
            }
            
            return preprocessing_result
            
        except Exception as e:
            logger.error(f"查询预处理失败: {str(e)}")
            # 返回默认值
            return {
                "original_query": query,
                "refined_query": query,
                "intent_type": "factual",
                "is_complex": False,
                "visual_intent": "unnecessary",
                "visual_reasoning": "使用默认规则，未检测到明确的视觉需求",
                "audio_intent": "unnecessary",
                "audio_reasoning": "使用默认规则，未检测到音频需求",
                "search_strategies": {
                    "dense_query": query,
                    "original_query": query,
                    "multi_view_queries": [],
                    "sparse_keywords": []
                },
                "sub_queries": [],
                "processing_time": 0.0
            }
        
    async def _route_to_knowledge_bases(self, query: str, kb_context: Optional[Dict[str, Any]] = None):
        """路由到知识库"""
        try:
            return await self.kb_router.route_query(query, kb_context=kb_context)
        except Exception as e:
            logger.error(f"知识库路由失败: {str(e)}")
            # 返回默认路由
            from app.modules.knowledge.router import RoutingResult
            return RoutingResult(
                target_kb_ids=[],
                confidence_scores={},
                routing_method="error",
                total_candidates=0,
                processing_time=0.0
            )
    
    async def _perform_hybrid_search(
        self,
        context: RetrievalContext
    ) -> Dict[str, Any]:
        """执行混合检索。仅使用 Qdrant 中的 kb_id，将指定知识库的 ID 解析为向量库实际存储的 kb_id 后再检索。"""
        try:
            qdrant_kb_ids = await self.kb_router.resolve_to_qdrant_kb_ids(context.target_kb_ids)
            return await self.search_engine.search(
                query_strategies=context.search_strategies,
                target_kb_ids=qdrant_kb_ids,
                visual_intent=context.visual_intent,
                audio_intent=context.audio_intent,
                intent_type=context.intent_type
            )
        except Exception as e:
            logger.error(f"混合检索失败: {str(e)}")
            return {
                "raw_results": {},
                "strategy": "error",
                "processing_time": 0.0
            }
    
    async def _apply_reranking(
        self,
        context: RetrievalContext,
        search_results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """应用重排序"""
        try:
            return await self.reranker.rerank(
                query=context.refined_query,
                raw_results=search_results.get("raw_results", {}),
                context=context
            )
        except Exception as e:
            logger.error(f"重排序失败: {str(e)}")
            return {
                "results": [],
                "processing_time": 0.0
            }
    
    async def batch_search(
        self,
        queries: List[str],
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> List[RetrievalResult]:
        """批量检索"""
        try:
            results = []
            
            for query in queries:
                result = await self.search(
                    query=query,
                    kb_context=kb_context,
                    user_id=user_id
                )
                results.append(result)
            
            return results
            
        except Exception as e:
            logger.error(f"批量检索失败: {str(e)}")
            return []
    
    def _update_retrieval_stats(
        self,
        intent_type: str,
        routing_method: str,
        retrieval_strategy: str,
        processing_time: float,
        result_count: int
    ):
        """更新检索统计信息"""
        try:
            # 更新总检索次数
            self._retrieval_stats["total_searches"] += 1
            
            # 更新总处理时间
            self._retrieval_stats["total_processing_time"] += processing_time
            
            # 更新意图分布
            intent_dist = self._retrieval_stats["intent_distribution"]
            intent_dist[intent_type] = intent_dist.get(intent_type, 0) + 1
            
            # 更新路由分布
            routing_dist = self._retrieval_stats["routing_distribution"]
            routing_dist[routing_method] = routing_dist.get(routing_method, 0) + 1
            
            # 更新检索策略使用情况
            strategy_usage = self._retrieval_stats["retrieval_strategy_usage"]
            strategy_usage[retrieval_strategy] = strategy_usage.get(retrieval_strategy, 0) + 1
            
            # 更新结果数量统计
            self._retrieval_stats["total_result_count"] += result_count
            
            # 更新最后更新时间
            self._retrieval_stats["last_updated"] = datetime.utcnow().isoformat()
            
        except Exception as e:
            logger.error(f"更新检索统计失败: {str(e)}")
    
    async def get_retrieval_statistics(self) -> Dict[str, Any]:
        """
        获取检索统计信息
        
        Returns:
            包含以下统计信息的字典：
            - total_searches: 总检索次数
            - average_processing_time: 平均处理时间
            - intent_distribution: 意图类型分布
            - routing_distribution: 路由方法分布
            - retrieval_strategy_usage: 检索策略使用情况
            - average_result_count: 平均结果数量
        """
        try:
            stats = self._retrieval_stats.copy()
            
            # 计算平均处理时间
            total_searches = stats["total_searches"]
            if total_searches > 0:
                stats["average_processing_time"] = stats["total_processing_time"] / total_searches
                stats["average_result_count"] = stats["total_result_count"] / total_searches
            else:
                stats["average_processing_time"] = 0.0
                stats["average_result_count"] = 0.0
            
            # 计算意图分布百分比
            intent_dist = stats["intent_distribution"]
            if intent_dist and total_searches > 0:
                intent_percentages = {
                    intent: round((count / total_searches) * 100, 2)
                    for intent, count in intent_dist.items()
                }
                stats["intent_distribution_percentages"] = intent_percentages
            
            # 计算路由分布百分比
            routing_dist = stats["routing_distribution"]
            if routing_dist and total_searches > 0:
                routing_percentages = {
                    method: round((count / total_searches) * 100, 2)
                    for method, count in routing_dist.items()
                }
                stats["routing_distribution_percentages"] = routing_percentages
            
            # 计算检索策略使用百分比
            strategy_usage = stats["retrieval_strategy_usage"]
            if strategy_usage and total_searches > 0:
                strategy_percentages = {
                    strategy: round((count / total_searches) * 100, 2)
                    for strategy, count in strategy_usage.items()
                }
                stats["retrieval_strategy_usage_percentages"] = strategy_percentages
            
            return stats
            
        except Exception as e:
            logger.error(f"获取检索统计失败: {str(e)}")
            return {
                "total_searches": 0,
                "average_processing_time": 0.0,
                "intent_distribution": {},
                "routing_distribution": {},
                "retrieval_strategy_usage": {},
                "error": str(e)
            }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            component_health = {
                "intent_processor": await self.intent_processor.health_check(),
                "query_rewriter": await self.query_rewriter.health_check(),
                "search_engine": await self.search_engine.health_check(),
                "reranker": await self.reranker.health_check(),
                "kb_router": await self.kb_router.get_routing_statistics()
            }
            
            all_healthy = all(
                health.get("status") == "healthy" 
                for health in component_health.values()
            )
            
            return {
                "status": "healthy" if all_healthy else "unhealthy",
                "components": component_health
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }