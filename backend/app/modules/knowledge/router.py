"""
知识库智能路由控制器
基于知识库画像进行动态路由选择（TopN 检索 + 每 KB 前 K 节点平均 + 归一化 + 差距决策）
"""

from collections import defaultdict
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone
from dataclasses import dataclass

from app.core.config import settings
from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.portraits import PortraitGenerator
from app.core.llm.manager import llm_manager

logger = get_logger(__name__)

# 路由策略常量（与 ROUTING_STRATEGY_ANALYSIS 对齐）
ROUTING_TOP_N = 30
ROUTING_TOP_K_PER_KB = 5  # 每个 KB 只取前 K 个最相关节点求加权平均，缓解画像多的 KB 累加分数过高
ROUTING_DECAY_ALPHA = 0.9  # 位置衰减：w_i = α^(i-1)，越靠前的节点权重越大
ROUTING_ALL_LOW_THRESHOLD = 0.08
ROUTING_GAP_DOMINANT = 0.3

@dataclass
class RoutingResult:
    """路由结果数据类"""
    target_kb_ids: List[str]
    confidence_scores: Dict[str, float]
    routing_method: str
    total_candidates: int
    processing_time: float
    """目标知识库列表（含 id、name、score），供前端展示名称"""
    target_kbs: Optional[List[Dict[str, Any]]] = None

class KnowledgeRouter:
    """知识库智能路由控制器"""
    
    def __init__(self):
        self.vector_store = VectorStore()
        self.kb_service = KnowledgeBaseService()
        self.portrait_generator = PortraitGenerator()
        self.llm_manager = llm_manager

    async def _enrich_target_kbs(
        self,
        target_kb_ids: List[str],
        confidence_scores: Dict[str, float],
    ) -> List[Dict[str, Any]]:
        """根据 target_kb_ids 和 confidence_scores 构建含名称的 target_kbs（id、name、score）。"""
        if not target_kb_ids:
            return []
        out: List[Dict[str, Any]] = []
        for kb_id in target_kb_ids:
            name = kb_id
            try:
                kb = await self.kb_service.get_knowledge_base(kb_id)
                if kb and kb.get("name"):
                    name = kb["name"]
            except Exception as e:
                logger.debug(f"获取知识库名称失败 kb_id={kb_id}: {e}")
            out.append({
                "id": kb_id,
                "name": name,
                "score": float(confidence_scores.get(kb_id, 0)),
            })
        return out

    async def resolve_to_qdrant_kb_ids(self, kb_ids: List[str]) -> List[str]:
        """
        将前端/指定知识库传入的 ID（可能为 MinIO bucket 派生 id）解析为向量库 Qdrant 中实际存储的 kb_id，
        检索时只使用 Qdrant 的 kb_id，不使用 MinIO bucket id，否则无法命中知识库。
        """
        seen: set = set()
        out: List[str] = []
        for kb_id in kb_ids:
            if not kb_id:
                continue
            discovered = await self.kb_service._discover_kb_id_from_bucket_async(kb_id)
            canonical = (discovered if discovered else kb_id).strip()
            if canonical and canonical not in seen:
                seen.add(canonical)
                out.append(canonical)
        return out

    async def route_query(
        self,
        query_text: str,
        kb_context: Optional[Dict[str, Any]] = None
    ) -> RoutingResult:
        """
        路由用户查询到合适的知识库
        
        Args:
            query_text: 用户查询文本
            kb_context: 可选的查询上下文
            
        Returns:
            路由结果
        """
        try:
            start_time = datetime.now(timezone.utc)
            
            # 如果提供了 kb_context 且包含 kb_ids，直接使用指定的知识库
            if kb_context and kb_context.get("kb_ids"):
                kb_ids = kb_context["kb_ids"]
                logger.info(f"使用指定的知识库: {kb_ids}")
                processing_time = (datetime.now(timezone.utc) - start_time).total_seconds()
                target_kbs = await self._enrich_target_kbs(
                    kb_ids, {kb_id: 1.0 for kb_id in kb_ids}
                )
                return RoutingResult(
                    target_kb_ids=kb_ids,
                    confidence_scores={kb_id: 1.0 for kb_id in kb_ids},
                    routing_method="explicit",
                    total_candidates=len(kb_ids),
                    processing_time=processing_time,
                    target_kbs=target_kbs,
                )
            
            # 1. 向量化查询文本（processed_query）
            query_vector_result = await self.llm_manager.embed(texts=[query_text])
            
            if not query_vector_result.success or not query_vector_result.data:
                logger.warning("查询向量化失败，使用默认路由")
                return await self._default_routing()
            
            query_vector = query_vector_result.data[0]
            
            # 2. 在 kb_portraits 全集中检索 TopN 个最相似的主题节点
            topn_nodes = await self.vector_store.search_kb_portraits_topn(
                query_vector=query_vector,
                limit=ROUTING_TOP_N,
            )
            
            if not topn_nodes:
                return RoutingResult(
                    target_kb_ids=[],
                    confidence_scores={},
                    routing_method="no_portraits",
                    total_candidates=0,
                    processing_time=0.0
                )
            
            # 3. 按 kb_id 聚合：每 KB 前 K 节点按 w_i=α^(i-1) 衰减加权平均
            kb_scores_raw = self._calculate_kb_scores_from_topn(topn_nodes)
            # 日志：每个知识库的原始得分（按得分降序）
            _log_kb_scores_raw(kb_scores_raw)
            
            # 4. 归一化与路由决策
            routing_result = await self._apply_routing_strategy(kb_scores_raw)
            
            # 5. 计算处理时间
            processing_time = (datetime.now(timezone.utc) - start_time).total_seconds()
            routing_result.processing_time = processing_time

            # 6. 填充 target_kbs（id、name、score）供前端展示知识库名称
            routing_result.target_kbs = await self._enrich_target_kbs(
                routing_result.target_kb_ids,
                routing_result.confidence_scores,
            )
            
            audit_log(
                f"知识库路由完成: {query_text[:50]}...",
                query_length=len(query_text),
                target_kbs=routing_result.target_kb_ids,
                confidence_scores=routing_result.confidence_scores,
                processing_time=processing_time
            )
            
            logger.info(f"知识库路由完成: 查询长度={len(query_text)}, 目标KB={routing_result.target_kb_ids}")
            
            return routing_result
            
        except Exception as e:
            logger.error(f"知识库路由失败: {str(e)}")
            return await self._default_routing()

    def _calculate_kb_scores_from_topn(
        self,
        topn_nodes: List[Dict[str, Any]]
    ) -> Dict[str, float]:
        """
        对 TopN 节点按 kb_id 聚合打分。
        每个 KB 只取前 ROUTING_TOP_K_PER_KB 个最相关节点（不足则全量），
        按位置衰减加权平均：w_i = α^(i-1)，突出最相关画像。
        Score(KB_x) = Σ(sim_i × α^(i-1)) / Σ(α^(i-1))
        """
        # 按 kb_id 分组
        kb_nodes: Dict[str, List[float]] = defaultdict(list)
        for node in topn_nodes:
            kb_id = node.get("kb_id") or ""
            if not kb_id:
                continue
            sim = float(node.get("score", 0.0))
            kb_nodes[kb_id].append(sim)

        alpha = ROUTING_DECAY_ALPHA
        kb_scores: Dict[str, float] = {}
        k = ROUTING_TOP_K_PER_KB
        for kb_id, sims in kb_nodes.items():
            if not sims:
                continue
            sorted_sims = sorted(sims, reverse=True)
            top_k = sorted_sims[:k]
            # w_i = α^(i-1)，i 从 1 开始
            weighted_sum = sum(s * (alpha ** i) for i, s in enumerate(top_k))
            weight_sum = sum(alpha ** i for i in range(len(top_k)))
            kb_scores[kb_id] = weighted_sum / weight_sum

        return kb_scores

    def _normalize_scores(self, kb_scores: Dict[str, float]) -> Dict[str, float]:
        """将各 KB 的 Score 归一化到 [0, 1]（min-max）。"""
        if not kb_scores:
            return {}
        vals = list(kb_scores.values())
        lo, hi = min(vals), max(vals)
        if hi <= lo:
            return {k: 1.0 for k in kb_scores}
        return {k: (v - lo) / (hi - lo) for k, v in kb_scores.items()}

    async def _apply_routing_strategy(
        self,
        kb_scores_raw: Dict[str, float]
    ) -> RoutingResult:
        """
        应用路由策略：归一化 → 全部偏小则全库 → 否则按与第一名差距决定单库/多库。
        """
        try:
            if not kb_scores_raw:
                return await self._default_routing()
            
            # 1. 全部偏小 → 路由失败，启用全库检索
            max_raw = max(kb_scores_raw.values())
            if max_raw < ROUTING_ALL_LOW_THRESHOLD:
                logger.info(
                    "知识库路由-决策: 全部得分偏低 max_raw=%.6f < 阈值%.2f -> low_confidence 启用全库检索",
                    max_raw, ROUTING_ALL_LOW_THRESHOLD,
                )
                kbs = await self.kb_service.list_knowledge_bases(limit=1000)
                all_kb_ids = [kb["id"] for kb in kbs]
                return RoutingResult(
                    target_kb_ids=all_kb_ids,
                    confidence_scores={k: 1.0 for k in all_kb_ids},
                    routing_method="low_confidence",
                    total_candidates=len(kb_scores_raw),
                    processing_time=0.0
                )
            
            # 2. 归一化到 [0, 1]
            normed = self._normalize_scores(kb_scores_raw)
            sorted_kbs = sorted(normed.items(), key=lambda x: x[1], reverse=True)
            # 日志：每个知识库的归一化得分
            normed_parts = [f"{kb_id}={score:.4f}" for kb_id, score in sorted_kbs]
            logger.info("知识库路由-归一化得分: {}", " | ".join(normed_parts))
            
            # 3. 选出第一名；按与第一名的差距决定单库或多库
            first_id, first_score = sorted_kbs[0]
            second_id = sorted_kbs[1][0] if len(sorted_kbs) > 1 else None
            second_score = sorted_kbs[1][1] if len(sorted_kbs) > 1 else 0.0
            gap = first_score - second_score
            
            if gap >= ROUTING_GAP_DOMINANT:
                target_kb_ids = [first_id]
                routing_method = "single_kb_dominant"
            else:
                top2 = [kb_id for kb_id, _ in sorted_kbs[:2]]
                target_kb_ids = top2
                routing_method = "dual_kb" if len(top2) == 2 else "single_kb"
            
            logger.info(
                "知识库路由-决策: 第一名={}({:.4f}) 第二名={}({:.4f}) gap={:.4f} 阈值={} -> {} 目标KB={}",
                first_id, first_score,
                second_id or "-", second_score,
                gap, ROUTING_GAP_DOMINANT, routing_method, target_kb_ids,
            )
            confidence_scores = {k: normed[k] for k in target_kb_ids}
            
            return RoutingResult(
                target_kb_ids=target_kb_ids,
                confidence_scores=confidence_scores,
                routing_method=routing_method,
                total_candidates=len(kb_scores_raw),
                processing_time=0.0
            )
            
        except Exception as e:
            logger.error(f"应用路由策略失败: {str(e)}")
            return await self._default_routing()
    
    async def _default_routing(self) -> RoutingResult:
        """默认路由策略"""
        try:
            # 获取所有知识库
            kbs = await self.kb_service.list_knowledge_bases(limit=100)
            
            if kbs:
                target_kb_ids = [kb["id"] for kb in kbs]
                return RoutingResult(
                    target_kb_ids=target_kb_ids,
                    confidence_scores={kb_id: 1.0 for kb_id in target_kb_ids},
                    routing_method="default_all",
                    total_candidates=len(target_kb_ids),
                    processing_time=0.0
                )
            else:
                return RoutingResult(
                    target_kb_ids=[],
                    confidence_scores={},
                    routing_method="no_kb_available",
                    total_candidates=0,
                    processing_time=0.0
                )
                
        except Exception as e:
            logger.error(f"默认路由失败: {str(e)}")
            return RoutingResult(
                target_kb_ids=[],
                confidence_scores={},
                routing_method="error",
                total_candidates=0,
                processing_time=0.0
            )
    
    async def update_all_kb_portraits(self) -> Dict[str, Any]:
        """批量更新所有知识库的画像"""
        try:
            # 获取所有知识库
            kbs = await self.kb_service.list_knowledge_bases(limit=1000)
            
            update_results = []
            
            for kb in kbs:
                kb_id = kb["id"]
                
                try:
                    result = await self.portrait_generator.update_kb_portrait(
                        kb_id=kb_id,
                        force_update=True
                    )
                    
                    update_results.append({
                        "kb_id": kb_id,
                        "status": "success",
                        "result": result
                    })
                    
                    logger.info(f"知识库画像更新成功: {kb_id}")
                    
                except Exception as e:
                    logger.error(f"知识库画像更新失败 {kb_id}: {str(e)}")
                    update_results.append({
                        "kb_id": kb_id,
                        "status": "failed",
                        "error": str(e)
                    })
            
            # 统计更新结果
            success_count = len([r for r in update_results if r["status"] == "success"])
            failed_count = len([r for r in update_results if r["status"] == "failed"])
            
            audit_log(
                f"批量更新知识库画像完成",
                total_kbs=len(kbs),
                success_count=success_count,
                failed_count=failed_count
            )
            
            return {
                "status": "completed",
                "total_knowledge_bases": len(kbs),
                "success_count": success_count,
                "failed_count": failed_count,
                "results": update_results
            }
            
        except Exception as e:
            logger.error(f"批量更新知识库画像失败: {str(e)}")
            raise
    
    async def get_routing_statistics(self) -> Dict[str, Any]:
        """获取路由统计信息"""
        try:
            # 获取知识库统计
            kbs = await self.kb_service.list_knowledge_bases(limit=1000)
            
            # 获取画像统计
            portrait_stats = {}
            for kb in kbs:
                kb_id = kb["id"]
                portraits = await self.portrait_generator.get_kb_portraits(kb_id)
                portrait_stats[kb_id] = len(portraits)
            
            return {
                "total_knowledge_bases": len(kbs),
                "knowledge_bases_with_portraits": len([k for k in portrait_stats.values() if k > 0]),
                "total_portraits": sum(portrait_stats.values()),
                "average_portraits_per_kb": (
                    sum(portrait_stats.values()) / len(portrait_stats) 
                    if portrait_stats else 0
                ),
                "portrait_distribution": portrait_stats
            }
            
        except Exception as e:
            logger.error(f"获取路由统计失败: {str(e)}")
            return {}


def _log_kb_scores_raw(kb_scores_raw: Dict[str, float]) -> None:
    """记录每个知识库的原始得分（按得分降序），便于排查路由决策。"""
    if not kb_scores_raw:
        logger.info("知识库路由-原始得分: (无)")
        return
    sorted_items = sorted(kb_scores_raw.items(), key=lambda x: x[1], reverse=True)
    parts = [f"{kb_id}={score:.6f}" for kb_id, score in sorted_items]
    logger.info("知识库路由-原始得分: {}", " | ".join(parts))