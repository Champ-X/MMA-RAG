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
            "visual": 1.2,  # 视觉检索权重稍高
            "audio": 1.0,   # 音频检索权重
            "video": 1.1    # 视频检索权重（稍高于音频，因为包含视觉信息）
        }
        
        # RRF参数
        self.rrf_k = 60  # RRF算法参数
    
    async def search(
        self,
        query_strategies: Dict[str, Any],
        target_kb_ids: List[str],
        visual_intent: str = "unnecessary",
        audio_intent: str = "unnecessary",
        video_intent: str = "unnecessary",
        intent_type: str = "factual"
    ) -> Dict[str, Any]:
        """
        执行混合检索
        
        Args:
            query_strategies: 查询策略
            target_kb_ids: 目标知识库ID列表
            visual_intent: 视觉意图（explicit_demand, implicit_enrichment, unnecessary）
            audio_intent: 音频意图（explicit_demand, implicit_enrichment, unnecessary）
            intent_type: 意图类型
            
        Returns:
            检索结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始混合检索: KB={len(target_kb_ids)}, Visual={visual_intent}, Audio={audio_intent}")
            
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
            
            # 2. Sparse关键词检索（使用 BGE-M3 稀疏向量，始终启用）
            sparse_task = self._sparse_search(
                dense_query=query_strategies.get("dense_query", ""),
                keywords=query_strategies.get("sparse_keywords", []),
                target_kb_ids=target_kb_ids,
                intent_type=intent_type,
                fallback_query=query_strategies.get("original_query", "")
            )
            search_tasks.append(("sparse", sparse_task))
            
            # 3. Visual检索（基于visual_intent的机会主义检索策略）
            if visual_intent in ["explicit_demand", "implicit_enrichment"]:
                visual_task = self._visual_search(
                    query_strategies.get("dense_query", ""),
                    query_strategies.get("multi_view_queries", []),
                    target_kb_ids,
                    visual_intent=visual_intent
                )
                search_tasks.append(("visual", visual_task))
            
            # 4. Audio检索（基于 audio_intent：unnecessary 时直接返回空；explicit/implicit 时使用 CLAP 双路 RRF）
            audio_task = self._audio_search(
                query_strategies.get("dense_query", ""),
                target_kb_ids,
                audio_intent=audio_intent,
                limit=10
            )
            search_tasks.append(("audio", audio_task))
            
            # 5. Video检索
            video_task = self._video_search(
                query_strategies.get("dense_query", ""),
                target_kb_ids,
                visual_query=query_strategies.get("dense_query", "") if visual_intent != "unnecessary" else None,
                limit=10
            )
            search_tasks.append(("video", video_task))
            
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

            # 当 Dense 与 Sparse 均无结果时，记录各目标 KB 的文本/图/音频数量，便于排查“未建索引”问题
            dense_count = len(results.get("dense", []))
            sparse_count = len(results.get("sparse", []))
            if dense_count == 0 and sparse_count == 0 and target_kb_ids:
                try:
                    for kb_id in target_kb_ids:
                        n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
                        n_audio = await self.vector_store.count_kb_audio(kb_id)
                        logger.warning(
                            "目标知识库无文本检索结果，请确认是否已对文本建索引: kb_id={}, "
                            "text_chunks={}, image_vectors={}, audio_vectors={}",
                            kb_id, n_text, n_img, n_audio
                        )
                except Exception as e:
                    logger.debug("统计目标KB数量时出错: {}", e)
            # 当有音频意图但音频检索为 0 时，打印各目标 KB 的 audio_vectors 数量，便于区分「库内无音频」与「有数据但未命中」
            audio_count = len(results.get("audio", []))
            if audio_count == 0 and audio_intent in ["explicit_demand", "implicit_enrichment"] and target_kb_ids:
                try:
                    parts = []
                    for kb_id in target_kb_ids:
                        n_audio = await self.vector_store.count_kb_audio(kb_id)
                        parts.append(f"{kb_id}={n_audio}")
                    logger.info(
                        "音频检索为 0（audio_intent={}），目标知识库 audio_vectors 数量: {}",
                        audio_intent, ", ".join(parts)
                    )
                except Exception as e:
                    logger.debug("统计目标KB音频数量时出错: {}", e)

            # 4. RRF融合（根据 visual_intent / audio_intent / video_intent 动态调整权重）
            fused_results = await self._fuse_results(
                results, visual_intent=visual_intent, audio_intent=audio_intent, video_intent=video_intent
            )
            
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
        intent_type: str,
        fallback_query: str = ""
    ) -> List[Dict[str, Any]]:
        """
        Sparse关键词检索（使用 BGE-M3 稀疏向量，始终启用）
        
        Args:
            dense_query: 密集查询文本（优先使用）
            keywords: 关键词列表（备用）
            target_kb_ids: 目标知识库ID列表
            intent_type: 意图类型
            fallback_query: 当 dense_query 与 keywords 均空时使用的备用查询（如 original_query）
            
        Returns:
            检索结果列表
        """
        try:
            # 优先使用 dense_query，其次 keywords 拼接，最后 fallback_query，确保 sparse 始终有输入
            if dense_query and dense_query.strip():
                query_text = dense_query.strip()
            elif keywords:
                query_text = " ".join(str(k) for k in keywords if k)
            elif fallback_query and str(fallback_query).strip():
                query_text = str(fallback_query).strip()
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
        target_kb_ids: List[str],
        visual_intent: str = "explicit_demand"
    ) -> List[Dict[str, Any]]:
        """
        Visual图像检索（真正的双路RRF：文本语义向量 + CLIP视觉特征向量）
        基于visual_intent实现机会主义检索策略
        
        Args:
            query: 查询文本
            multi_view_queries: 多视角查询列表
            target_kb_ids: 目标知识库ID列表
            visual_intent: 视觉意图（explicit_demand, implicit_enrichment）
        """
        try:
            logger.info(f"Visual检索开始: 查询='{query}...', Visual Intent={visual_intent}")
            
            # 根据visual_intent设置检索参数
            if visual_intent == "explicit_demand":
                # 显式需求：扩大召回范围，放宽相似度阈值
                limit = 20
                score_threshold = 0.0
                logger.info("Visual检索策略: explicit_demand - 扩大召回范围")
            elif visual_intent == "implicit_enrichment":
                # 隐性增益：进一步优化图片丰富度，缩小与显式模式的差距
                # 注意：Qdrant使用余弦相似度，对于归一化向量，分数范围是0-1
                # 为了提升图片丰富度，采用更接近显式模式的策略
                limit = 20  # 增加到20，与显式模式一致，提供更多图片候选
                score_threshold = 0.3  # 进一步降低阈值到0.4，接近显式模式的0.0，召回更多相关图片
                logger.info(f"Visual检索策略: implicit_enrichment - 优化图片丰富度，limit={limit}, 相似度阈值={score_threshold} (接近显式模式)")
            else:
                # 不应该到达这里，但为了安全起见
                limit = 10
                score_threshold = 0.0
            
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
                    limit=limit,
                    score_threshold=score_threshold
                )
                
                # 标记结果来源
                for result in search_results:
                    result["search_type"] = "visual"
                    result["dual_rrf"] = True
                    result["text_vec_score"] = result.get("scores", {}).get("text_vec", 0.0)
                    result["clip_vec_score"] = result.get("scores", {}).get("clip_vec", 0.0)
                    result["visual_intent"] = visual_intent
                
                # 统计分数分布（用于分析和优化阈值）
                if search_results:
                    scores = [r.get("score", 0.0) for r in search_results]
                    max_score = max(scores) if scores else 0.0
                    min_score = min(scores) if scores else 0.0
                    avg_score = sum(scores) / len(scores) if scores else 0.0
                    logger.debug(
                        f"Visual检索分数分布: max={max_score:.3f}, min={min_score:.3f}, "
                        f"avg={avg_score:.3f}, count={len(search_results)}"
                    )
                
                # 4. 用同一批向量查 video_vectors 中的关键帧（关键帧存于 video_vectors 的 clip_vec），补齐显式视觉需求下的「图片」来源
                video_keyframe_results = await self.vector_store.search_video_vectors(
                    query_vector=text_query_vector,
                    clip_vector=clip_text_vector,
                    target_kb_ids=target_kb_ids,
                    limit=limit,
                    score_threshold=score_threshold,
                )
                for v in video_keyframe_results:
                    payload = v.get("payload") or {}
                    caption = payload.get("frame_description") or payload.get("scene_summary") or ""
                    file_path = payload.get("frame_image_path") or ""
                    if not file_path:
                        continue
                    search_results.append({
                        "id": v.get("id"),
                        "score": v.get("score", 0.0),
                        "payload": {
                            "caption": caption,
                            "file_path": file_path,
                            "kb_id": payload.get("kb_id"),
                            "file_id": payload.get("file_id"),
                        },
                        "scores": {"text_vec": 0.0, "clip_vec": v.get("score", 0.0), "rrf_fused": v.get("score", 0.0)},
                        "search_type": "visual",
                        "dual_rrf": True,
                        "text_vec_score": 0.0,
                        "clip_vec_score": v.get("score", 0.0),
                        "visual_intent": visual_intent,
                        "from_video_keyframe": True,
                    })
                if video_keyframe_results:
                    logger.info("Visual检索补充: 从 video_vectors 关键帧召回 %s 条，合并为图片结果", len([r for r in search_results if r.get("from_video_keyframe")]))
                
                logger.info(
                    f"Visual检索完成（双路RRF）: {len(search_results)} 个图片结果, "
                    f"Visual Intent={visual_intent}, Score Threshold={score_threshold} "
                    f"(文本语义匹配: {sum(1 for r in search_results if r.get('text_vec_score', 0) > 0)}个, "
                    f"CLIP视觉匹配: {sum(1 for r in search_results if r.get('clip_vec_score', 0) > 0)}个)"
                )
                
                # 对于implicit_enrichment，记录检索结果
                if visual_intent == "implicit_enrichment":
                    if len(search_results) == 0:
                        logger.info(
                            f"Implicit enrichment: 未找到相关图片（相似度阈值{score_threshold}），"
                            f"返回空列表（机会主义策略）"
                        )
                    else:
                        logger.info(
                            f"Implicit enrichment: 成功检索到{len(search_results)}张图片候选 "
                            f"(阈值={score_threshold}, limit={limit})"
                        )
                
                return search_results
            else:
                # 仅使用文本语义向量
                logger.info("Visual检索步骤3: 仅使用文本语义向量查询（CLIP向量不可用）")
                search_results = await self.vector_store.search_image_vectors(
                    query_vector=text_query_vector,
                    kb_ids=target_kb_ids,
                    limit=limit,
                    score_threshold=score_threshold
                )
                
                # 标记结果
                for result in search_results:
                    result["search_type"] = "visual"
                    result["dual_rrf"] = False
                    result["text_vec_score"] = result.get("score", 0.0)
                    result["visual_intent"] = visual_intent
                
                # 统计分数分布（用于分析和优化阈值）
                if search_results:
                    scores = [r.get("score", 0.0) for r in search_results]
                    max_score = max(scores) if scores else 0.0
                    min_score = min(scores) if scores else 0.0
                    avg_score = sum(scores) / len(scores) if scores else 0.0
                    logger.debug(
                        f"Visual检索分数分布: max={max_score:.3f}, min={min_score:.3f}, "
                        f"avg={avg_score:.3f}, count={len(search_results)}"
                    )
                
                # 用文本向量查 video_vectors 关键帧（scene_vec/frame_vec），补齐图片来源
                video_keyframe_results = await self.vector_store.search_video_vectors(
                    query_vector=text_query_vector,
                    clip_vector=None,
                    target_kb_ids=target_kb_ids,
                    limit=limit,
                    score_threshold=score_threshold,
                )
                for v in video_keyframe_results:
                    payload = v.get("payload") or {}
                    file_path = payload.get("frame_image_path") or ""
                    if not file_path:
                        continue
                    caption = payload.get("frame_description") or payload.get("scene_summary") or ""
                    search_results.append({
                        "id": v.get("id"),
                        "score": v.get("score", 0.0),
                        "payload": {
                            "caption": caption,
                            "file_path": file_path,
                            "kb_id": payload.get("kb_id"),
                            "file_id": payload.get("file_id"),
                        },
                        "search_type": "visual",
                        "dual_rrf": False,
                        "text_vec_score": v.get("score", 0.0),
                        "visual_intent": visual_intent,
                        "from_video_keyframe": True,
                    })
                if video_keyframe_results:
                    logger.info("Visual检索补充: 从 video_vectors 关键帧召回 %s 条，合并为图片结果", len([r for r in search_results if r.get("from_video_keyframe")]))
                
                logger.info(
                    f"Visual检索完成（单路文本语义）: {len(search_results)} 个图片结果, "
                    f"Visual Intent={visual_intent}, Score Threshold={score_threshold}"
                )
                
                # 对于implicit_enrichment，如果没有找到相关图片，返回空列表（机会主义策略）
                if visual_intent == "implicit_enrichment" and len(search_results) == 0:
                    logger.info(
                        f"Implicit enrichment: 未找到相关图片（相似度阈值{score_threshold}），"
                        f"返回空列表（机会主义策略）"
                    )
                
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
    
    async def _fuse_results(
        self,
        raw_results: Dict[str, List[Dict[str, Any]]],
        visual_intent: str = "unnecessary",
        audio_intent: str = "unnecessary",
        video_intent: str = "unnecessary"
    ) -> List[Dict[str, Any]]:
        """
        RRF融合结果
        根据 visual_intent / audio_intent / video_intent 动态调整权重。
        当存在视频意图时降低视觉权重，避免视频片段被关键帧图片排挤。
        """
        try:
            fused_results = {}
            dynamic_weights = self.rrf_weights.copy()
            if visual_intent == "explicit_demand":
                # 有视频显式需求时略降视觉权重，让视频片段能进入 top-k
                dynamic_weights["visual"] = 0.9 if video_intent == "explicit_demand" else 1.2
            elif visual_intent == "implicit_enrichment":
                dynamic_weights["visual"] = 0.9
            else:
                dynamic_weights["visual"] = 0.0
            if audio_intent == "explicit_demand":
                dynamic_weights["audio"] = 1.2
            elif audio_intent == "implicit_enrichment":
                dynamic_weights["audio"] = 0.9
            else:
                dynamic_weights["audio"] = 0.0
            if video_intent == "explicit_demand":
                dynamic_weights["video"] = 1.2
            elif video_intent == "implicit_enrichment":
                dynamic_weights["video"] = 1.0
            else:
                dynamic_weights["video"] = self.rrf_weights.get("video", 0.8)
            # sparse 始终启用，保持默认权重（与 rrf_weights 一致）
            if "sparse" not in dynamic_weights or dynamic_weights.get("sparse", 0) <= 0:
                dynamic_weights["sparse"] = self.rrf_weights.get("sparse", 0.8)
            
            # 遍历每种检索类型的结果
            for search_type, results in raw_results.items():
                if not results:
                    continue
                
                weight = dynamic_weights.get(search_type, 1.0)
                
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
                            "content_type": result.get("content_type", "doc"),  # 保留内容类型
                            "file_id": result.get("file_id"),
                            "file_path": result.get("file_path"),
                            "content": result.get("content", ""),
                            "metadata": result.get("metadata", {})
                        }
                    else:
                        # 同一 id 可能既来自 visual（关键帧图）又来自 video（视频片段），
                        # 优先保留 video 类型，避免视频被图片排挤、最终上下文只有图没有视频
                        new_type = result.get("content_type", "doc")
                        if new_type == "video":
                            fused_results[result_id]["content_type"] = "video"
                            fused_results[result_id]["file_path"] = result.get("file_path") or fused_results[result_id].get("file_path")
                            fused_results[result_id]["content"] = result.get("content", "") or fused_results[result_id].get("content", "")
                            fused_results[result_id]["metadata"] = result.get("metadata", {}) or fused_results[result_id].get("metadata", {})
                    
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
            
            logger.info(
                f"RRF融合完成: {len(raw_results)} 种检索 -> {len(final_results)} 个融合结果, "
                f"Visual={visual_intent}(w={dynamic_weights.get('visual', 0.0)}), "
                f"Audio={audio_intent}(w={dynamic_weights.get('audio', 0.0)}), "
                f"Video={video_intent}(w={dynamic_weights.get('video', 0.0)})"
            )
            
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
    
    async def _audio_search(
        self,
        query: str,
        target_kb_ids: List[str],
        audio_intent: str = "unnecessary",
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """音频检索。基于 audio_intent：unnecessary 不检索；explicit/implicit 时使用 text_vec + clap_vec 双路 RRF（可选 sparse）。"""
        try:
            if audio_intent == "unnecessary":
                return []
            # 1. 文本向量化查询
            embed_result = await self.llm_manager.embed(texts=[query])
            if not embed_result.success or not embed_result.data:
                logger.error("音频检索向量化失败")
                return []
            query_vector = embed_result.data[0] if isinstance(embed_result.data, list) else embed_result.data
            sparse_result = self.sparse_encoder.encode_query(query)
            sparse_vector = sparse_result.get("sparse") if sparse_result else None
            # 2. 有音频意图时尝试 CLAP 双路 RRF（text_vec + clap_vec [+ sparse]）
            if audio_intent in ["explicit_demand", "implicit_enrichment"]:
                clap_vector = None
                try:
                    clap_vector = await self.ingestion_service.get_clap_text_vector_for_query(query)
                except Exception as e:
                    logger.warning("CLAP 查询向量生成失败，回退单路: %s", e)
                if clap_vector:
                    search_results = await self.vector_store.search_audio_vectors_dual_rrf(
                        text_query_vector=query_vector,
                        clap_query_vector=clap_vector,
                        sparse_vector=sparse_vector,
                        target_kb_ids=target_kb_ids,
                        limit=limit * 2 if audio_intent == "implicit_enrichment" else limit,
                        score_threshold=0.0 if audio_intent == "explicit_demand" else 0.2
                    )
                else:
                    search_results = await self.vector_store.search_audio_vectors(
                        query_vector=query_vector,
                        sparse_vector=sparse_vector,
                        target_kb_ids=target_kb_ids,
                        limit=limit
                    )
            else:
                search_results = await self.vector_store.search_audio_vectors(
                    query_vector=query_vector,
                    sparse_vector=sparse_vector,
                    target_kb_ids=target_kb_ids,
                    limit=limit
                )
            # 3. 格式化结果（保留完整 payload 供下游 context_builder 取 kb_id 等）
            formatted_results = []
            for result in search_results:
                payload = result.get("payload", {})
                formatted_results.append({
                    "id": result.get("id"),
                    "content": payload.get("transcript", ""),
                    "content_type": "audio",
                    "file_id": payload.get("file_id"),
                    "file_path": payload.get("file_path"),
                    "score": result.get("score", 0.0),
                    "payload": payload,
                    "metadata": {
                        "duration": payload.get("duration", 0.0),
                        "audio_format": payload.get("audio_format", ""),
                        "description": payload.get("description", ""),
                        "transcript": payload.get("transcript", "")
                    }
                })
            return formatted_results
        except Exception as e:
            logger.error("音频检索失败: %s", e, exc_info=True)
            return []
    
    async def _video_search(
        self,
        query: str,
        target_kb_ids: List[str],
        visual_query: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """视频检索"""
        try:
            # 1. 文本向量化查询
            embed_result = await self.llm_manager.embed(texts=[query])
            if not embed_result.success or not embed_result.data:
                logger.error("视频检索向量化失败")
                return []
            
            query_vector = embed_result.data[0] if isinstance(embed_result.data, list) else embed_result.data
            
            # 2. 如果visual_query存在，生成CLIP向量
            clip_vector = None
            if visual_query:
                try:
                    clip_vector = await self._generate_clip_text_vector(visual_query)
                except Exception as e:
                    logger.warning(f"视频检索CLIP向量生成失败: {str(e)}")
            
            # 3. 检索video_vectors集合
            search_results = await self.vector_store.search_video_vectors(
                query_vector=query_vector,
                clip_vector=clip_vector,
                target_kb_ids=target_kb_ids,
                limit=limit
            )
            
            # 4. 格式化结果（一关键帧一点），再按方案六「场景聚合去重」：同 segment_id 合并为一块，保留得分最高的一帧为代表
            formatted_results = []
            for result in search_results:
                payload = result.get("payload", {})
                ts = payload.get("frame_timestamp", 0.0)
                frame_desc = payload.get("frame_description", "")
                frame_image_path = payload.get("frame_image_path", "")
                key_frames = [{
                    "timestamp": ts,
                    "description": frame_desc,
                    "frame_image_path": frame_image_path,
                }]
                content = payload.get("scene_summary", "") or frame_desc
                formatted_results.append({
                    "id": result.get("id"),
                    "content": content,
                    "content_type": "video",
                    "file_id": payload.get("file_id"),
                    "file_path": payload.get("file_path"),
                    "score": result.get("score", 0.0),
                    "payload": payload,
                    "metadata": {
                        "duration": payload.get("duration", 0.0),
                        "video_format": payload.get("video_format", ""),
                        "resolution": payload.get("resolution", ""),
                        "fps": payload.get("fps", 0.0),
                        "key_frames": key_frames,
                        "has_audio": payload.get("has_audio", False),
                        "audio_file_id": payload.get("audio_file_id"),
                        "segment_id": payload.get("segment_id"),
                        "frame_timestamp": ts,
                        "frame_image_path": frame_image_path,
                    },
                })
            # Group by (file_id, segment_id)，保留每组得分最高的作为代表，形成「一个 Context 块 per segment」
            grouped: Dict[tuple, List[Dict]] = {}
            for r in formatted_results:
                fid = r.get("file_id", "")
                sid = r.get("metadata", {}).get("segment_id", "")
                key = (fid, sid)
                if key not in grouped:
                    grouped[key] = []
                grouped[key].append(r)
            by_segment = []
            for key, group in grouped.items():
                best = max(group, key=lambda x: x.get("score", 0.0))
                by_segment.append(best)
            by_segment.sort(key=lambda x: -x.get("score", 0.0))
            return by_segment
            
        except Exception as e:
            logger.error(f"视频检索失败: {str(e)}", exc_info=True)
            return []

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