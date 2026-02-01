"""
混合搜索引擎
实现Dense+Sparse+Visual的三路融合检索策略
"""

from typing import Dict, List, Any, Optional
import asyncio
from datetime import datetime

from app.core.llm.manager import llm_manager
from app.core.sparse_encoder import get_sparse_encoder
from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.ingestion.service import IngestionService

logger = get_logger(__name__)

class HybridSearchEngine:
    """混合搜索引擎"""
    
    def __init__(self):
        self.vector_store = VectorStore()
        self.llm_manager = llm_manager
        self.sparse_encoder = get_sparse_encoder()  # BGE-M3 稀疏向量编码器
        self.ingestion_service = IngestionService()  # 用于CLIP文本向量化
        
        # RRF融合权重
        self.rrf_weights = {
            "dense": 1.0,
            "sparse": 0.8,
            "visual": 1.2  # 视觉检索权重稍高
        }
        
        # RRF参数
        self.rrf_k = 60  # RRF算法参数
    
    async def search(
        self,
        query_strategies: Dict[str, Any],
        target_kb_ids: List[str],
        needs_visual: bool = False,
        intent_type: str = "factual"
    ) -> Dict[str, Any]:
        """
        执行混合检索
        
        Args:
            query_strategies: 查询策略
            target_kb_ids: 目标知识库ID列表
            needs_visual: 是否需要视觉检索
            intent_type: 意图类型
            
        Returns:
            检索结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始混合检索: KB={len(target_kb_ids)}, Visual={needs_visual}")
            
            # 构建检索任务
            search_tasks = []
            
            # 1. Dense向量检索
            dense_task = self._dense_search(
                query_strategies.get("dense_query", ""),
                query_strategies.get("multi_view_queries", []),
                target_kb_ids,
                intent_type
            )
            search_tasks.append(("dense", dense_task))
            
            # 2. Sparse关键词检索（使用 BGE-M3 稀疏向量）
            sparse_task = self._sparse_search(
                dense_query=query_strategies.get("dense_query", ""),
                keywords=query_strategies.get("sparse_keywords", []),
                target_kb_ids=target_kb_ids,
                intent_type=intent_type
            )
            search_tasks.append(("sparse", sparse_task))
            
            # 3. Visual检索（如果需要）
            if needs_visual:
                visual_task = self._visual_search(
                    query_strategies.get("dense_query", ""),
                    query_strategies.get("multi_view_queries", []),
                    target_kb_ids
                )
                search_tasks.append(("visual", visual_task))
            
            # 并行执行检索任务
            results = {}
            for task_type, task in search_tasks:
                try:
                    result = await task
                    results[task_type] = result
                    logger.info(f"{task_type}检索完成: {len(result)} 个结果")
                except Exception as e:
                    logger.error(f"{task_type}检索失败: {str(e)}")
                    results[task_type] = []

            # 当 Dense 与 Sparse 均无结果时，记录各目标 KB 的文本块数量，便于排查“未建索引”问题
            dense_count = len(results.get("dense", []))
            sparse_count = len(results.get("sparse", []))
            if dense_count == 0 and sparse_count == 0 and target_kb_ids:
                try:
                    for kb_id in target_kb_ids:
                        n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
                        logger.warning(
                            f"目标知识库无文本检索结果，请确认是否已对文本建索引: kb_id={kb_id}, "
                            f"text_chunks={n_text}, image_vectors={n_img}"
                        )
                except Exception as e:
                    logger.debug(f"统计目标KB文本块数量时出错: {e}")

            # 4. RRF融合
            fused_results = await self._fuse_results(results)
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            audit_log(
                f"混合检索完成",
                kb_count=len(target_kb_ids),
                dense_results=len(results.get("dense", [])),
                sparse_results=len(results.get("sparse", [])),
                visual_results=len(results.get("visual", [])),
                fused_results=len(fused_results),
                processing_time=processing_time
            )
            
            return {
                "raw_results": results,
                "fused_results": fused_results,
                "strategy": f"hybrid_{len(results)}_way",
                "processing_time": processing_time,
                "kb_targets": target_kb_ids
            }
            
        except Exception as e:
            logger.error(f"混合检索失败: {str(e)}")
            return {
                "raw_results": {},
                "fused_results": [],
                "strategy": "error",
                "processing_time": (datetime.utcnow() - start_time).total_seconds()
            }
    
    async def _dense_search(
        self,
        dense_query: str,
        multi_view_queries: List[str],
        target_kb_ids: List[str],
        intent_type: str
    ) -> List[Dict[str, Any]]:
        """Dense向量检索（支持多角度查询）"""
        try:
            # 构建所有查询（主查询 + 多角度查询）
            all_queries = [dense_query]
            if multi_view_queries:
                all_queries.extend(multi_view_queries)
            
            # 记录多角度查询使用情况
            if multi_view_queries:
                logger.info(
                    f"Dense检索使用多角度查询: 主查询1个 + 多角度查询{len(multi_view_queries)}个 = 共{len(all_queries)}个查询"
                )
                for idx, mvq in enumerate(multi_view_queries, start=2):
                    logger.debug(f"  多角度查询{idx}: {mvq[:80]}...")
            else:
                logger.info("Dense检索仅使用主查询，未使用多角度查询")
            
            # 向量化所有查询
            embedding_result = await self.llm_manager.embed(texts=all_queries)
            
            if not embedding_result.success or not embedding_result.data:
                logger.error("Dense检索向量化失败")
                return []
            
            query_vectors = embedding_result.data
            results = []
            query_result_counts = {}  # 记录每个查询的结果数量
            
            # 对每个查询向量执行检索
            for i, query_vector in enumerate(query_vectors):
                try:
                    query_text = all_queries[i]
                    search_results = await self.vector_store.search_text_chunks(
                        query_vector=query_vector,
                        kb_ids=target_kb_ids,
                        limit=20,
                        score_threshold=0.0
                    )
                    
                    query_result_counts[i] = len(search_results)
                    
                    # 为每个结果添加查询来源
                    for result in search_results:
                        result["search_type"] = "dense"
                        result["query_index"] = i
                        result["query_source"] = query_text
                        if i == 0:
                            result["is_primary_query"] = True
                        else:
                            result["is_primary_query"] = False
                            result["multi_view_index"] = i - 1
                    
                    results.extend(search_results)
                    
                    logger.debug(
                        f"Dense检索查询{i+1}/{len(all_queries)} ({'主查询' if i == 0 else f'多角度查询{i}'}) "
                        f"完成: 找到{len(search_results)}个结果"
                    )
                    
                except Exception as e:
                    logger.error(f"Dense检索查询{i}失败: {str(e)}")
                    query_result_counts[i] = 0
                    continue
            
            # 去重和排序
            unique_results = self._deduplicate_results(results)
            
            # 统计多角度查询的贡献
            primary_results = [r for r in unique_results if r.get("is_primary_query", False)]
            multi_view_results = [r for r in unique_results if not r.get("is_primary_query", True)]
            
            logger.info(
                f"Dense检索完成: {len(unique_results)} 个唯一结果 "
                f"(主查询贡献: {len(primary_results)}个, 多角度查询贡献: {len(multi_view_results)}个)"
            )
            if query_result_counts:
                logger.debug(f"各查询结果数统计: {query_result_counts}")
            
            return unique_results
            
        except Exception as e:
            logger.error(f"Dense检索失败: {str(e)}")
            return []
    
    async def _sparse_search(
        self,
        dense_query: str,
        keywords: List[str],
        target_kb_ids: List[str],
        intent_type: str
    ) -> List[Dict[str, Any]]:
        """
        Sparse关键词检索（使用 BGE-M3 稀疏向量）
        
        Args:
            dense_query: 密集查询文本（优先使用）
            keywords: 关键词列表（备用）
            target_kb_ids: 目标知识库ID列表
            intent_type: 意图类型
            
        Returns:
            检索结果列表
        """
        try:
            # 优先使用 dense_query，如果没有则使用关键词拼接
            if dense_query and dense_query.strip():
                query_text = dense_query.strip()
            elif keywords:
                query_text = " ".join(keywords)
            else:
                logger.info("无查询文本和关键词，跳过Sparse检索")
                return []
            
            # 使用 BGE-M3 生成稀疏向量
            try:
                sparse_result = self.sparse_encoder.encode_query(query_text)
                
                if not sparse_result.get("sparse"):
                    logger.warning("BGE-M3 稀疏向量生成失败，跳过Sparse检索")
                    return []
                
                query_sparse = sparse_result["sparse"]
                logger.debug(f"BGE-M3 稀疏向量生成成功: 查询='{query_text[:50]}...', 非零元素={len(query_sparse)}")
                
            except Exception as e:
                logger.error(f"BGE-M3 稀疏向量生成异常: {str(e)}")
                return []
            
            # 使用稀疏向量检索
            search_results = await self.vector_store.search_text_chunks_sparse(
                query_sparse=query_sparse,
                kb_ids=target_kb_ids,
                limit=15,  # Sparse检索结果数量稍少
                score_threshold=0.0
            )
            
            # 标记为Sparse结果
            for result in search_results:
                result["search_type"] = "sparse"
                result["query_text"] = query_text
                result["keywords_matched"] = keywords if keywords else []
                result["sparse_vector_size"] = len(query_sparse)
            
            logger.info(f"Sparse检索完成（BGE-M3）: {len(search_results)} 个结果")
            
            return search_results
            
        except Exception as e:
            logger.error(f"Sparse检索失败: {str(e)}")
            return []
    
    async def _visual_search(
        self,
        query: str,
        multi_view_queries: List[str],
        target_kb_ids: List[str]
    ) -> List[Dict[str, Any]]:
        """Visual图像检索（真正的双路RRF：文本语义向量 + CLIP视觉特征向量）"""
        try:
            logger.info(f"Visual检索开始: 查询='{query}...'")
            
            # 1. 生成文本语义向量（用于匹配VLM生成的图片描述）
            logger.info("Visual检索步骤1: 生成文本语义向量（匹配图片描述）")
            text_embedding_result = await self.llm_manager.embed(texts=[query])
            
            if not text_embedding_result.success or not text_embedding_result.data:
                logger.error("Visual检索文本语义向量化失败")
                return []
            
            text_query_vector = text_embedding_result.data[0]
            logger.debug(f"文本语义向量生成成功: 维度={len(text_query_vector)}")
            
            # 2. 生成CLIP视觉特征向量（用于匹配图片的视觉特征）
            logger.info("Visual检索步骤2: 生成CLIP视觉特征向量（匹配图片视觉特征）")
            try:
                clip_text_vector = await self._generate_clip_text_vector(query)
                logger.debug(f"CLIP视觉特征向量生成成功: 维度={len(clip_text_vector)}")
            except Exception as e:
                logger.warning(f"CLIP文本向量化失败，仅使用文本语义向量: {str(e)}")
                clip_text_vector = None
            
            # 3. 执行双路检索（如果CLIP向量可用）
            if clip_text_vector:
                logger.info("Visual检索步骤3: 执行双路RRF查询（文本语义向量 + CLIP视觉特征向量）")
                search_results = await self.vector_store.search_image_vectors_dual_rrf(
                    text_query_vector=text_query_vector,
                    clip_query_vector=clip_text_vector,
                    kb_ids=target_kb_ids,
                    limit=10,
                    score_threshold=0.0
                )
                
                # 标记结果来源
                for result in search_results:
                    result["search_type"] = "visual"
                    result["dual_rrf"] = True
                    result["text_vec_score"] = result.get("scores", {}).get("text_vec", 0.0)
                    result["clip_vec_score"] = result.get("scores", {}).get("clip_vec", 0.0)
                
                logger.info(
                    f"Visual检索完成（双路RRF）: {len(search_results)} 个图片结果 "
                    f"(文本语义匹配: {sum(1 for r in search_results if r.get('text_vec_score', 0) > 0)}个, "
                    f"CLIP视觉匹配: {sum(1 for r in search_results if r.get('clip_vec_score', 0) > 0)}个)"
                )
                
                return search_results
            else:
                # 仅使用文本语义向量
                logger.info("Visual检索步骤3: 仅使用文本语义向量查询（CLIP向量不可用）")
                search_results = await self.vector_store.search_image_vectors(
                    query_vector=text_query_vector,
                    kb_ids=target_kb_ids,
                    limit=10,
                    score_threshold=0.0
                )
                
                # 标记结果
                for result in search_results:
                    result["search_type"] = "visual"
                    result["dual_rrf"] = False
                    result["text_vec_score"] = result.get("score", 0.0)
                
                logger.info(f"Visual检索完成（单路文本语义）: {len(search_results)} 个图片结果")
                return search_results
            
        except Exception as e:
            logger.error(f"Visual检索失败: {str(e)}", exc_info=True)
            return []
    
    async def _generate_clip_text_vector(self, query_text: str) -> List[float]:
        """使用CLIP生成文本查询向量
        
        Args:
            query_text: 查询文本（建议翻译成英文效果更好）
            
        Returns:
            CLIP文本向量（768维）
        """
        try:
            # 懒加载CLIP模型
            self.ingestion_service._load_clip_model()
            
            if self.ingestion_service._clip_model is None or self.ingestion_service._clip_processor is None:
                raise RuntimeError("CLIP模型未加载")
            
            import torch
            
            # 使用CLIP处理器的tokenizer处理文本
            inputs = self.ingestion_service._clip_processor.tokenizer(  # type: ignore
                query_text,
                return_tensors="pt",
                padding=True,
                truncation=True
            )
            
            # 移动到正确的设备
            if torch.cuda.is_available():
                device = torch.device("cuda")
                inputs = {k: v.to(device) if hasattr(v, 'to') else v for k, v in inputs.items()}
            else:
                device = torch.device("cpu")
            
            # 生成文本向量
            with torch.no_grad():
                text_features = self.ingestion_service._clip_model.get_text_features(**inputs)  # type: ignore
                # 归一化向量
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)  # type: ignore
                # 转换为numpy数组并提取向量
                clip_text_vector = text_features.cpu().numpy()[0].tolist()
            
            # clip-vit-large-patch14 的向量维度是 768
            assert len(clip_text_vector) == 768, f"CLIP文本向量维度错误: 期望768，实际{len(clip_text_vector)}"
            
            logger.debug(f"CLIP文本向量生成成功: 查询='{query_text}...', 维度={len(clip_text_vector)}")
            
            return clip_text_vector
            
        except Exception as e:
            logger.error(f"CLIP文本向量化失败: {str(e)}")
            raise
    
    def _fuse_visual_results_rrf(
        self,
        all_search_results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """对Visual检索的多路结果进行RRF融合
        
        Args:
            all_search_results: 包含所有查询结果的列表，每个元素包含query_index、query_text和results
            
        Returns:
            融合后的结果列表
        """
        try:
            fused_results = {}
            
            # 为不同查询设置权重（主查询权重更高）
            query_weights = {}
            for search_data in all_search_results:
                query_idx = search_data["query_index"]
                if query_idx == 0:
                    query_weights[query_idx] = 1.0  # 主查询权重
                else:
                    query_weights[query_idx] = 0.8  # 多角度查询权重
            
            # 遍历每个查询的结果
            for search_data in all_search_results:
                query_idx = search_data["query_index"]
                results = search_data["results"]
                weight = query_weights.get(query_idx, 1.0)
                
                # 为每个结果计算RRF分数
                for rank, result in enumerate(results):
                    result_id = result["id"]
                    
                    # RRF公式: score = weight / (k + rank)
                    rrf_score = weight / (self.rrf_k + rank)
                    
                    if result_id not in fused_results:
                        fused_results[result_id] = {
                            "id": result_id,
                            "scores": {},
                            "total_score": 0.0,
                            "payload": result.get("payload", {}),
                            "query_sources": []  # 记录来自哪些查询
                        }
                    
                    # 累加该结果在所有查询中的分数
                    fused_results[result_id]["scores"][f"query_{query_idx}"] = rrf_score
                    fused_results[result_id]["total_score"] += rrf_score
                    fused_results[result_id]["payload"] = result.get("payload", {})
                    fused_results[result_id]["query_sources"].append({
                        "query_index": query_idx,
                        "query_text": search_data["query_text"],
                        "rank": rank,
                        "score": rrf_score
                    })
            
            # 按总分排序
            sorted_results = sorted(
                fused_results.values(),
                key=lambda x: x["total_score"],
                reverse=True
            )
            
            # 限制结果数量
            max_results = 10
            final_results = sorted_results[:max_results]
            
            # 添加search_type标记
            for result in final_results:
                result["search_type"] = "visual"
                result["rrf_fused"] = True
                result["query_count"] = len(result["query_sources"])
            
            logger.debug(
                f"Visual检索内部RRF融合完成: {len(all_search_results)}路查询 -> "
                f"{len(final_results)}个融合结果"
            )
            
            return final_results
            
        except Exception as e:
            logger.error(f"Visual检索RRF融合失败: {str(e)}")
            # 如果融合失败，返回主查询的结果
            if all_search_results:
                return all_search_results[0]["results"]
            return []
    
    async def _fuse_results(self, raw_results: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """RRF融合结果"""
        try:
            # 使用RRF算法融合结果
            fused_results = {}
            
            # 遍历每种检索类型的结果
            for search_type, results in raw_results.items():
                if not results:
                    continue
                
                weight = self.rrf_weights.get(search_type, 1.0)
                
                # 为每个结果计算RRF分数
                for rank, result in enumerate(results):
                    result_id = result["id"]
                    
                    # RRF公式: score = weight / (k + rank)
                    rrf_score = weight / (self.rrf_k + rank)
                    
                    if result_id not in fused_results:
                        fused_results[result_id] = {
                            "id": result_id,
                            "scores": {},
                            "total_score": 0.0,
                            "payload": result.get("payload", {})
                        }
                    
                    # 累加该结果在所有检索类型中的分数
                    fused_results[result_id]["scores"][search_type] = rrf_score
                    fused_results[result_id]["total_score"] += rrf_score
                    fused_results[result_id]["payload"] = result.get("payload", {})
            
            # 按总分排序
            sorted_results = sorted(
                fused_results.values(),
                key=lambda x: x["total_score"],
                reverse=True
            )
            
            # 限制结果数量
            max_results = 50
            final_results = sorted_results[:max_results]
            
            logger.info(f"RRF融合完成: {len(raw_results)} 种检索 -> {len(final_results)} 个融合结果")
            
            return final_results
            
        except Exception as e:
            logger.error(f"RRF融合失败: {str(e)}")
            return []
    
    def _deduplicate_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """去重结果"""
        try:
            seen_ids = set()
            unique_results = []
            
            for result in results:
                result_id = result["id"]
                if result_id not in seen_ids:
                    seen_ids.add(result_id)
                    unique_results.append(result)
            
            # 按分数排序
            unique_results.sort(key=lambda x: x.get("score", 0), reverse=True)
            
            return unique_results
            
        except Exception as e:
            logger.error(f"结果去重失败: {str(e)}")
            return results
    
    async def get_retrieval_statistics(self) -> Dict[str, Any]:
        """获取检索统计"""
        try:
            # 获取向量数据库统计
            stats = await self.vector_store.get_all_collections_stats()
            
            return {
                "text_chunks": stats.get("text_chunks", {}),
                "image_vectors": stats.get("image_vectors", {}),
                "kb_portraits": stats.get("kb_portraits", {}),
                "rrf_weights": self.rrf_weights,
                "rrf_k": self.rrf_k
            }
            
        except Exception as e:
            logger.error(f"获取检索统计失败: {str(e)}")
            return {}
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 检查向量数据库
            vector_health = await self.vector_store.health_check()
            
            # 检查LLM服务
            llm_health = await self.llm_manager.chat(
                messages=[{"role": "user", "content": "health check"}],
                task_type="health_check",
                max_tokens=10
            )
            
            return {
                "status": "healthy" if all([
                    vector_health.get("status") == "healthy",
                    llm_health.success
                ]) else "unhealthy",
                "components": {
                    "vector_store": vector_health,
                    "llm_manager": llm_health.success
                }
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }