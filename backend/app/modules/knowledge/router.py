"""
知识库智能路由控制器
基于知识库画像进行动态路由选择（TopN 检索 + 每 KB 前 K 节点平均 + 归一化 + 差距决策）
"""

import asyncio
from collections import defaultdict
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from dataclasses import dataclass

from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.knowledge.service import KnowledgeBaseService
from app.core.llm.manager import llm_manager

logger = get_logger(__name__)

# 路由策略常量（与 ROUTING_STRATEGY_ANALYSIS 对齐）
ROUTING_TOP_N = 30
ROUTING_TOP_K_PER_KB = 5  # 每个 KB 只取前 K 个最相关节点求加权平均，缓解画像多的 KB 累加分数过高
ROUTING_DECAY_ALPHA = 0.9  # 位置衰减：w_i = α^(i-1)，越靠前的节点权重越大
ROUTING_ALL_LOW_THRESHOLD = 0.08
ROUTING_DOMINANT_ABSOLUTE_GAP = 0.04
ROUTING_DOMINANT_RELATIVE_GAP = 0.12
ROUTING_CANDIDATE_RATIO = 0.82
ROUTING_QUERY_WEIGHTS = (1.0, 0.72, 0.58, 0.48)

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
    query_count: int = 1

class KnowledgeRouter:
    """知识库智能路由控制器"""
    
    def __init__(self):
        from app.modules.knowledge.portraits import PortraitGenerator

        self.vector_store = VectorStore()
        self.kb_service = KnowledgeBaseService()
        self.portrait_generator = PortraitGenerator()
        self.llm_manager = llm_manager

    async def _enrich_target_kbs(
        self,
        target_kb_ids: List[str],
        confidence_scores: Dict[str, float],
    ) -> List[Dict[str, Any]]:
        """用 MinIO 最新元数据构建 target_kbs，避免路由实例展示重命名前的缓存值。"""
        if not target_kb_ids:
            return []

        async def _enrich_one(kb_id: str) -> Dict[str, Any]:
            name = kb_id
            try:
                kb = await self.kb_service.get_knowledge_base_metadata(
                    kb_id,
                    refresh=True,
                )
                if kb and kb.get("name"):
                    name = kb["name"]
            except Exception as e:
                logger.debug(f"获取知识库名称失败 kb_id={kb_id}: {e}")
            return {
                "id": kb_id,
                "name": name,
                "score": float(confidence_scores.get(kb_id, 0)),
            }

        return list(await asyncio.gather(*[_enrich_one(kb_id) for kb_id in target_kb_ids]))

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
        kb_context: Optional[Dict[str, Any]] = None,
        query_variants: Optional[List[str]] = None,
        max_targets: int = 2,
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
                selected_files = kb_context.get("selected_files") or []
                if selected_files:
                    logger.info(
                        "使用指定的文件范围: kb_ids=%s, file_ids=%s",
                        kb_ids,
                        [item.get("file_id") for item in selected_files],
                    )
                else:
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
            
            routing_queries = self._normalize_routing_queries(query_text, query_variants)

            # 1. 批量向量化独立改写与多视角查询，减少指代和单一措辞造成的路由偏差。
            query_vector_result = await self.llm_manager.embed(texts=routing_queries)
            
            if not query_vector_result.success or not query_vector_result.data:
                logger.warning("查询向量化失败，使用默认路由")
                return await self._default_routing()
            
            query_vectors = list(query_vector_result.data)[: len(routing_queries)]

            # 2. 每个查询信号独立召回画像，再按信号权重和覆盖度聚合。
            topn_by_query = await asyncio.gather(
                *[
                    self.vector_store.search_kb_portraits_topn(
                        query_vector=query_vector,
                        limit=ROUTING_TOP_N,
                    )
                    for query_vector in query_vectors
                ]
            )
            
            if not any(topn_by_query):
                return await self._default_routing(routing_method="no_portraits_default_all")
            
            # 3. 按 kb_id 聚合：先计算每个信号内的画像分数，再做跨信号加权。
            kb_scores_raw = self._calculate_multi_signal_scores(topn_by_query)
            # 日志：每个知识库的原始得分（按得分降序）
            _log_kb_scores_raw(kb_scores_raw)
            
            # 4. 相对置信度与路由决策
            routing_result = await self._apply_routing_strategy(
                kb_scores_raw,
                max_targets=max_targets,
            )
            routing_result.query_count = len(query_vectors)
            
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

    def _normalize_routing_queries(
        self,
        query_text: str,
        query_variants: Optional[List[str]],
    ) -> List[str]:
        """Deduplicate and bound query variants while preserving priority."""
        out: List[str] = []
        seen = set()
        for raw in [query_text, *(query_variants or [])]:
            query = " ".join(str(raw or "").split()).strip()
            key = query.casefold()
            if not query or key in seen:
                continue
            seen.add(key)
            out.append(query[:500])
            if len(out) >= len(ROUTING_QUERY_WEIGHTS):
                break
        return out or [query_text]

    def _calculate_multi_signal_scores(
        self,
        topn_by_query: List[List[Dict[str, Any]]],
    ) -> Dict[str, float]:
        """Aggregate per-query portrait scores with a small cross-signal coverage bonus."""
        weighted_scores: Dict[str, float] = defaultdict(float)
        coverage: Dict[str, int] = defaultdict(int)
        active_weight = 0.0

        for index, nodes in enumerate(topn_by_query[: len(ROUTING_QUERY_WEIGHTS)]):
            weight = ROUTING_QUERY_WEIGHTS[index]
            if not nodes:
                continue
            active_weight += weight
            per_query = self._calculate_kb_scores_from_topn(nodes)
            for kb_id, score in per_query.items():
                weighted_scores[kb_id] += score * weight
                coverage[kb_id] += 1

        if not weighted_scores or active_weight <= 0:
            return {}

        signal_count = max(1, sum(1 for nodes in topn_by_query if nodes))
        aggregated: Dict[str, float] = {}
        for kb_id, weighted_score in weighted_scores.items():
            # Normalize by the highest-priority weights for the same coverage count.
            # This preserves the original score scale for a primary-only match while
            # still penalizing candidates found only by lower-priority variants.
            normalizer = sum(ROUTING_QUERY_WEIGHTS[: coverage[kb_id]])
            base = weighted_score / max(normalizer, 1e-9)
            coverage_factor = 0.9 + 0.1 * (coverage[kb_id] / signal_count)
            aggregated[kb_id] = base * coverage_factor
        return aggregated

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
        """Normalize against the best raw score without exaggerating close scores."""
        if not kb_scores:
            return {}
        highest = max(kb_scores.values())
        if highest <= 0:
            return {k: 0.0 for k in kb_scores}
        return {
            key: max(0.0, min(1.0, value / highest))
            for key, value in kb_scores.items()
        }

    async def _apply_routing_strategy(
        self,
        kb_scores_raw: Dict[str, float],
        *,
        max_targets: int = 2,
    ) -> RoutingResult:
        """
        Apply routing using raw-score gaps and relative confidence.

        Min-max normalization is deliberately avoided for the decision itself:
        two nearly equal raw scores would otherwise become 1.0 and 0.0.
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
            
            # 2. 相对第一名归一化到 [0, 1]，仅用于置信度展示与候选筛选。
            normed = self._normalize_scores(kb_scores_raw)
            sorted_raw = sorted(kb_scores_raw.items(), key=lambda x: x[1], reverse=True)
            # 日志：每个知识库的归一化得分
            normed_parts = [f"{kb_id}={normed[kb_id]:.4f}" for kb_id, _ in sorted_raw]
            logger.info("知识库路由-归一化得分: {}", " | ".join(normed_parts))
            
            # 3. 同时检查绝对差与相对差，避免相近分数被误判为单库独占。
            first_id, first_raw = sorted_raw[0]
            second_id = sorted_raw[1][0] if len(sorted_raw) > 1 else None
            second_raw = sorted_raw[1][1] if len(sorted_raw) > 1 else 0.0
            absolute_gap = first_raw - second_raw
            relative_gap = absolute_gap / max(abs(first_raw), 1e-9)
            bounded_max_targets = max(1, min(int(max_targets or 1), 3))

            if second_id is None or (
                absolute_gap >= ROUTING_DOMINANT_ABSOLUTE_GAP
                and relative_gap >= ROUTING_DOMINANT_RELATIVE_GAP
            ):
                target_kb_ids = [first_id]
                routing_method = "single_kb_dominant"
            else:
                target_kb_ids = [
                    kb_id
                    for kb_id, _ in sorted_raw
                    if normed[kb_id] >= ROUTING_CANDIDATE_RATIO
                ][:bounded_max_targets]
                if len(target_kb_ids) < min(2, len(sorted_raw)):
                    target_kb_ids = [kb_id for kb_id, _ in sorted_raw[:bounded_max_targets]]
                routing_method = {
                    1: "single_kb",
                    2: "dual_kb",
                }.get(len(target_kb_ids), "multi_kb")
            
            logger.info(
                "知识库路由-决策: 第一名={}({:.4f}) 第二名={}({:.4f}) "
                "abs_gap={:.4f} rel_gap={:.4f} -> {} 目标KB={}",
                first_id,
                first_raw,
                second_id or "-",
                second_raw,
                absolute_gap,
                relative_gap,
                routing_method,
                target_kb_ids,
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
    
    async def _default_routing(self, routing_method: str = "default_all") -> RoutingResult:
        """默认路由策略"""
        try:
            # 获取所有知识库
            kbs = await self.kb_service.list_knowledge_bases(limit=100)
            
            if kbs:
                target_kb_ids = [kb["id"] for kb in kbs]
                return RoutingResult(
                    target_kb_ids=target_kb_ids,
                    confidence_scores={kb_id: 1.0 for kb_id in target_kb_ids},
                    routing_method=routing_method,
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
                "批量更新知识库画像完成",
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
