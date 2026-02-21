"""
重排序器
实现两阶段重排系统（RRF粗排+Cross-Encoder精排）
"""

from typing import Dict, List, Any, Optional
import asyncio
from datetime import datetime

from app.core.llm.manager import llm_manager
from app.core.logger import get_logger, audit_log

logger = get_logger(__name__)

class Reranker:
    """两阶段重排序器"""
    
    def __init__(self):
        self.llm_manager = llm_manager
        
        # 重排序参数
        self.cross_encoder_weight = 0.7  # Cross-Encoder权重
        self.rrf_weight = 0.3          # RRF权重
        self.top_k = 20                # Cross-Encoder处理的候选数量（从20增加到30，提高重排质量）
        self.final_top_k = 10          # 最终返回结果数量（从10增加到15，提高图片丰富度）
    
    async def rerank(
        self,
        query: str,
        raw_results: Dict[str, List[Dict[str, Any]]],
        context: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        执行两阶段重排序
        
        Args:
            query: 查询文本
            raw_results: 原始检索结果
            context: 检索上下文
            
        Returns:
            重排序结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始两阶段重排序: {len(raw_results)} 种检索类型")
            
            # 1. 第一阶段：合并和粗排（已在HybridSearchEngine中完成RRF）
            coarse_ranking = self._prepare_coarse_ranking(raw_results)
            
            # 2. 第二阶段：Cross-Encoder精排
            reranked_results = await self._apply_cross_encoder_reranking(
                query, coarse_ranking, context
            )
            
            # 3. 最终排序和限制数量，并对implicit_enrichment进行图片保护
            final_results = self._apply_final_ranking_with_image_protection(
                reranked_results, context
            )
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            
            audit_log(
                f"两阶段重排完成",
                query_preview=query[:50],
                coarse_candidates=len(coarse_ranking),
                reranked_results=len(final_results),
                processing_time=processing_time
            )
            
            logger.info(f"两阶段重排完成: 候选{len(coarse_ranking)} -> 最终{len(final_results)}")
            
            return {
                "results": final_results,
                "processing_time": processing_time,
                "coarse_ranking_count": len(coarse_ranking),
                "final_ranking_count": len(final_results),
                "strategy": "two_stage_reranking"
            }
            
        except Exception as e:
            logger.error(f"两阶段重排失败: {str(e)}")
            return {
                "results": [],
                "processing_time": (datetime.utcnow() - start_time).total_seconds(),
                "error": str(e)
            }
    
    def _apply_final_ranking_with_image_protection(
        self,
        reranked_results: List[Dict[str, Any]],
        context: Optional[Any] = None
    ) -> List[Dict[str, Any]]:
        """
        应用最终排序，并对implicit_enrichment进行图片保护
        
        对于implicit_enrichment，确保至少保留一定数量的图片结果，
        避免图片被文本结果完全挤掉
        """
        try:
            # 检查是否是implicit_enrichment
            visual_intent = None
            if context and hasattr(context, 'visual_intent'):
                visual_intent = context.visual_intent
            
            # 如果不是implicit_enrichment，直接返回Top-K
            if visual_intent != "implicit_enrichment":
                return reranked_results[:self.final_top_k]
            
            # 对于implicit_enrichment，进行图片保护
            # 分离图片和文本结果
            image_results = []
            text_results = []
            
            for result in reranked_results:
                payload = result.get("payload", {})
                # 判断是否为图片：如果有caption字段，则为图片
                is_image = "caption" in payload
                if is_image:
                    image_results.append(result)
                else:
                    text_results.append(result)
            
            # 图片保护策略：对于implicit_enrichment，确保保留足够的图片
            # 由于final_top_k增加到15，可以保留更多图片（8-10张），接近显式模式的效果
            # 策略：优先保留所有高分图片，确保图片丰富度
            min_images = min(10, len(image_results))  # 最多保留10张图片，大幅提升图片丰富度
            if min_images > 0:
                # 优先选择分数最高的图片
                top_images = image_results[:min_images]
                
                # 剩余位置分配给文本结果
                remaining_slots = self.final_top_k - len(top_images)
                top_texts = text_results[:remaining_slots] if remaining_slots > 0 else []
                
                # 合并结果：先放文本（保持文本优先），再放图片
                # 这样可以确保文本结果在前面，图片作为补充
                final_results = top_texts + top_images
                
                logger.info(
                    f"Implicit enrichment图片保护: 保留{len(top_images)}张图片, "
                    f"{len(top_texts)}个文本结果, 总计{len(final_results)}个结果 "
                    f"(top_k={self.top_k}, final_top_k={self.final_top_k})"
                )
                
                return final_results
            else:
                # 如果没有图片，直接返回文本结果
                return text_results[:self.final_top_k]
                
        except Exception as e:
            logger.error(f"应用图片保护失败: {str(e)}")
            # 如果出错，返回原始排序结果
            return reranked_results[:self.final_top_k]
    
    def _prepare_coarse_ranking(self, raw_results: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """准备粗排候选列表"""
        try:
            # 合并所有检索结果
            all_candidates = []
            
            for search_type, results in raw_results.items():
                for result in results:
                    # 标准化结果格式
                    source_score = result.get("score", 0.0)
                    scores = result.get("scores", {})
                    
                    # 计算total_score：优先使用已有的total_score，否则使用source_score或scores的总和
                    total_score = result.get("total_score")
                    if total_score is None:
                        if scores:
                            # 如果有scores字典，计算总和
                            total_score = sum(scores.values())
                        else:
                            # 否则使用source_score
                            total_score = source_score
                    
                    # 音频/视频结果可能无 payload，需构建合成 payload 供下游 context_builder 使用
                    payload = result.get("payload") or {}
                    if result.get("content_type") == "audio" and not payload.get("transcript"):
                        meta = result.get("metadata") or {}
                        payload = {
                            "transcript": result.get("content", ""),
                            "description": meta.get("description", ""),
                            "file_path": result.get("file_path", ""),
                            "file_id": result.get("file_id"),
                            "duration": meta.get("duration", 0.0),
                            "audio_format": meta.get("audio_format", ""),
                        }
                    elif result.get("content_type") == "video" and not payload.get("description"):
                        meta = result.get("metadata") or {}
                        payload = {
                            "description": result.get("content", "") or meta.get("description", ""),
                            "file_path": result.get("file_path", ""),
                            "file_id": result.get("file_id"),
                            "duration": meta.get("duration", 0.0),
                        }
                    candidate = {
                        "id": result["id"],
                        "payload": payload,
                        "content_type": result.get("content_type"),
                        "scores": scores,
                        "search_type": search_type,
                        "source_score": source_score,
                        "total_score": total_score  # 确保有total_score字段
                    }
                    all_candidates.append(candidate)
            
            # 去重和初步排序
            unique_candidates = self._deduplicate_candidates(all_candidates)
            
            # 按总分排序
            unique_candidates.sort(key=lambda x: x.get("total_score", 0), reverse=True)
            
            # 限制候选数量
            max_candidates = 50
            return unique_candidates[:max_candidates]
            
        except Exception as e:
            logger.error(f"准备粗排候选失败: {str(e)}")
            return []
    
    def _deduplicate_candidates(self, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """去重候选结果"""
        try:
            seen_ids = set()
            unique_candidates = []
            
            for candidate in candidates:
                candidate_id = candidate["id"]
                if candidate_id not in seen_ids:
                    seen_ids.add(candidate_id)
                    unique_candidates.append(candidate)
            
            return unique_candidates
            
        except Exception as e:
            logger.error(f"候选去重失败: {str(e)}")
            return candidates
    
    async def _apply_cross_encoder_reranking(
        self,
        query: str,
        coarse_candidates: List[Dict[str, Any]],
        context: Optional[Any] = None
    ) -> List[Dict[str, Any]]:
        """应用Cross-Encoder重排序"""
        try:
            if not coarse_candidates:
                logger.info("无候选结果，跳过Cross-Encoder重排")
                return []
            
            # 选择Top-K候选进行精排
            candidates_to_rerank = coarse_candidates[:self.top_k]
            
            # 构建文档列表
            documents = []
            for candidate in candidates_to_rerank:
                # 根据内容类型构建文档文本
                content = self._build_document_content(candidate)
                # 确保内容不为空且是字符串
                if content and isinstance(content, str) and content.strip():
                    documents.append(content)
            
            # 验证文档列表
            if not documents:
                logger.warning("文档列表为空，跳过Cross-Encoder重排")
                return coarse_candidates[:self.final_top_k]
            
            # 验证查询不为空
            if not query or not query.strip():
                logger.warning("查询为空，跳过Cross-Encoder重排")
                return coarse_candidates[:self.final_top_k]
            
            logger.info(f"Cross-Encoder重排候选: {len(documents)} 个文档")
            
            # 调用Reranker模型
            reranker_result = await self.llm_manager.rerank(
                query=query.strip(),
                documents=documents,
                task_type="reranking"
            )
            
            if not reranker_result.success or not reranker_result.data:
                error_msg = reranker_result.error or "未知错误"
                logger.warning(f"Cross-Encoder调用失败: {error_msg}，使用原始排序结果")
                return coarse_candidates[:self.final_top_k]
            
            # 解析重排结果
            # 根据 SiliconFlow API 文档，返回格式是：
            # {
            #   "id": "...",
            #   "results": [{"document": {...}, "index": 0, "relevance_score": 0.95}, ...],
            #   "meta": [...]
            # }
            # SiliconFlowProvider.rerank 返回 result.get("results", [])，即 results 数组
            logger.debug(f"Cross-Encoder响应数据类型: {type(reranker_result.data)}, 内容预览: {str(reranker_result.data)[:300]}")
            reranked_scores = self._parse_reranker_response(reranker_result.data)
            
            # 验证解析结果
            if reranked_scores:
                first_result = reranked_scores[0] if isinstance(reranked_scores, list) else None
                if first_result and isinstance(first_result, dict):
                    logger.debug(
                        f"解析后的重排分数数量: {len(reranked_scores)}, "
                        f"第一个结果: index={first_result.get('index', 'N/A')}, "
                        f"relevance_score={first_result.get('relevance_score', 'N/A')}, "
                        f"score={first_result.get('score', 'N/A')}"
                    )
                else:
                    logger.debug(f"解析后的重排分数数量: {len(reranked_scores)}, 第一个结果类型: {type(first_result)}")
            else:
                logger.warning("解析后的重排分数为空，可能解析失败")
            
            # 合并原始分数和Cross-Encoder分数（传入context以支持图片保护）
            final_ranking = self._merge_scores(
                query, candidates_to_rerank, reranked_scores, context
            )
            
            # 按最终分数排序
            final_ranking.sort(key=lambda x: x["final_score"], reverse=True)
            
            return final_ranking
            
        except Exception as e:
            logger.error(f"Cross-Encoder重排失败: {str(e)}", exc_info=True)
            # 返回原始排序结果，确保系统继续运行
            return coarse_candidates[:self.final_top_k]
    
    def _build_document_content(self, candidate: Dict[str, Any]) -> str:
        """构建文档内容用于重排序"""
        try:
            payload = candidate.get("payload", {})
            content_type = candidate.get("content_type")
            if not content_type:
                content_type = "text" if payload.get("text_content") else ("image" if payload.get("caption") else ("audio" if payload.get("transcript") else "doc"))
            
            if content_type == "audio":
                transcript = payload.get("transcript", "")
                description = payload.get("description", "")
                file_path = payload.get("file_path", "")
                content = f"[音频/歌曲] 来源: {file_path}\n转写/歌词: {transcript}\n描述: {description}"
            elif content_type == "video":
                description = payload.get("description", "")
                file_path = payload.get("file_path", "")
                content = f"[视频] 来源: {file_path}\n描述: {description}"
            elif payload.get("text_content"):
                # 文本/文档内容
                text_content = payload.get("text_content", "")
                file_path = payload.get("file_path", "")
                content = f"[文档片段] 来源: {file_path}\n内容: {text_content}"
            else:
                # 图片内容
                caption = payload.get("caption", "")
                file_path = payload.get("file_path", "")
                content = f"[图片描述] 来源: {file_path}\n描述: {caption}"
            
            # 限制内容长度
            if len(content) > 1000:
                content = content[:997] + "..."
            
            return content
            
        except Exception as e:
            logger.error(f"构建文档内容失败: {str(e)}")
            return "文档内容解析失败"
    
    def _parse_reranker_response(self, response_data: Any) -> List[Dict[str, Any]]:
        """解析重排序响应"""
        try:
            import json
            
            # 格式1: 直接是结果列表（最常见的情况，SiliconFlowProvider 直接返回列表）
            if isinstance(response_data, list):
                logger.debug(f"响应是列表格式，包含 {len(response_data)} 个结果")
                # 验证列表中的元素格式
                if response_data and isinstance(response_data[0], dict):
                    # 检查是否有 score 字段
                    if "score" in response_data[0] or "relevance_score" in response_data[0]:
                        # 已经是正确的格式 [{index: 0, score: 0.95}, ...]
                        return response_data
                    # 可能是 [{index: 0}, {index: 1}] 格式，需要检查
                    return response_data
                return response_data
            
            # 如果不是列表，尝试作为字典处理
            if not isinstance(response_data, dict):
                logger.warning(f"响应格式不支持: {type(response_data)}")
                return []
            
            # 格式2: 在results字段中
            if "results" in response_data:
                results = response_data["results"]
                if isinstance(results, list):
                    logger.debug(f"从results字段提取到 {len(results)} 个结果")
                    return results
            
            # 格式3: 在data字段中
            if "data" in response_data:
                data = response_data["data"]
                if isinstance(data, list):
                    logger.debug(f"从data字段提取到 {len(data)} 个结果")
                    return data
                if isinstance(data, dict) and "results" in data:
                    results = data["results"]
                    if isinstance(results, list):
                        logger.debug(f"从data.results字段提取到 {len(results)} 个结果")
                        return results
            
            # 格式4: 在choices中（类似OpenAI格式，用于chat模型返回的JSON）
            choices = response_data.get("choices", [])
            if choices:
                # 尝试解析JSON
                content = choices[0].get("message", {}).get("content", "")
                if content.strip():
                    try:
                        # 尝试直接解析JSON
                        parsed = json.loads(content)
                        if isinstance(parsed, list):
                            logger.debug(f"从choices中解析到 {len(parsed)} 个结果")
                            return parsed
                        if isinstance(parsed, dict) and "results" in parsed:
                            results = parsed["results"]
                            if isinstance(results, list):
                                logger.debug(f"从choices解析的results字段提取到 {len(results)} 个结果")
                                return results
                    except json.JSONDecodeError:
                        # 如果JSON解析失败，尝试从文本中提取JSON
                        try:
                            json_start = content.find("[")
                            json_end = content.rfind("]") + 1
                            if json_start != -1 and json_end > json_start:
                                json_str = content[json_start:json_end]
                                parsed = json.loads(json_str)
                                if isinstance(parsed, list):
                                    logger.debug(f"从choices文本中提取到 {len(parsed)} 个结果")
                                    return parsed
                        except Exception as e:
                            logger.debug(f"从choices文本提取JSON失败: {str(e)}")
            
            logger.warning(f"无法解析重排序响应格式: {type(response_data)}, keys: {list(response_data.keys()) if isinstance(response_data, dict) else 'N/A'}")
            logger.debug(f"响应内容预览: {str(response_data)[:500]}")
            return []
            
        except Exception as e:
            logger.error(f"解析重排序响应失败: {str(e)}", exc_info=True)
            return []
    
    def _merge_scores(
        self,
        query: str,
        candidates: List[Dict[str, Any]],
        reranked_scores: List[Dict[str, Any]],
        context: Optional[Any] = None
    ) -> List[Dict[str, Any]]:
        """
        合并原始分数和Cross-Encoder分数
        
        对于implicit_enrichment的图片，给予特殊保护：
        - 降低Cross-Encoder权重（图片caption短，可能被打低分）
        - 提高RRF权重（向量检索对图片更公平）
        """
        try:
            # 检查是否是implicit_enrichment
            visual_intent = None
            if context and hasattr(context, 'visual_intent'):
                visual_intent = context.visual_intent
            # 构建reranked_scores的索引
            # 根据 SiliconFlow API 文档，每个结果包含 index 和 relevance_score
            score_index = {}
            index_based_map = {}
            
            for score_data in reranked_scores:
                if isinstance(score_data, dict):
                    # 优先使用 index 字段（SiliconFlow API 标准格式）
                    idx = score_data.get("index", -1)
                    if idx >= 0:
                        index_based_map[idx] = score_data
                    # 也按顺序建立索引（作为后备方案）
                    if len(score_index) < len(reranked_scores):
                        score_index[len(score_index)] = score_data
            
            # 优先使用 index 字段的映射（SiliconFlow API 标准）
            if index_based_map:
                score_index = index_based_map
                logger.debug(
                    f"使用index字段建立映射，共 {len(score_index)} 个分数。"
                    f"示例: index={list(score_index.keys())[0] if score_index else 'N/A'}, "
                    f"relevance_score={score_index[list(score_index.keys())[0]].get('relevance_score', 'N/A') if score_index else 'N/A'}"
                )
            else:
                logger.debug(f"使用顺序索引建立映射，共 {len(score_index)} 个分数")
            
            # 检查第一位和第二位的原始分数差距
            if len(candidates) >= 2:
                first_original_score = candidates[0].get("total_score", 0.0)
                second_original_score = candidates[1].get("total_score", 0.0)
                
                # 如果第一位原始分数明显高于第二位（差距超过20%），增加第一位的权重
                if first_original_score > 0 and second_original_score > 0:
                    score_gap_ratio = (first_original_score - second_original_score) / first_original_score
                    if score_gap_ratio > 0.2:  # 差距超过20%
                        # 动态调整权重：第一位使用更高的原始分数权重
                        dynamic_rrf_weight = min(0.5, self.rrf_weight * (1 + score_gap_ratio))
                        dynamic_cross_weight = 1.0 - dynamic_rrf_weight
                    else:
                        dynamic_rrf_weight = self.rrf_weight
                        dynamic_cross_weight = self.cross_encoder_weight
                else:
                    dynamic_rrf_weight = self.rrf_weight
                    dynamic_cross_weight = self.cross_encoder_weight
            else:
                dynamic_rrf_weight = self.rrf_weight
                dynamic_cross_weight = self.cross_encoder_weight
            
            final_ranking = []
            
            for i, candidate in enumerate(candidates):
                # 获取Cross-Encoder分数
                cross_encoder_score = 0.0
                
                # 根据 SiliconFlow API 文档，results 数组中每个元素包含：
                # - document: {text: "..."}
                # - index: 文档在输入数组中的索引
                # - relevance_score: 相似度分数
                
                # 优先通过 index 字段匹配（SiliconFlow API 的标准格式）
                matched_score_data = None
                for score_data in reranked_scores:
                    if isinstance(score_data, dict):
                        score_index_val = score_data.get("index", -1)
                        if score_index_val == i:
                            matched_score_data = score_data
                            break
                
                # 如果通过 index 找不到，尝试通过顺序索引
                if matched_score_data is None and i in score_index:
                    matched_score_data = score_index[i]
                
                # 提取分数（优先使用 relevance_score，这是 SiliconFlow API 的标准字段）
                if matched_score_data:
                    cross_encoder_score = (
                        matched_score_data.get("relevance_score", 0.0) or  # SiliconFlow API 标准字段
                        matched_score_data.get("score", 0.0) or
                        matched_score_data.get("relevance", 0.0) or
                        matched_score_data.get("rank_score", 0.0)
                    )
                
                # 记录日志以便调试
                if cross_encoder_score == 0.0:
                    if reranked_scores:
                        logger.debug(
                            f"候选 {i} 的Cross-Encoder分数为0，"
                            f"reranked_scores数量: {len(reranked_scores)}, "
                            f"score_index keys: {list(score_index.keys())}, "
                            f"第一个score_data: {reranked_scores[0] if reranked_scores else 'N/A'}"
                        )
                    else:
                        logger.warning(f"候选 {i} 的Cross-Encoder分数为0：reranked_scores为空")
                else:
                    logger.debug(f"候选 {i} 的Cross-Encoder分数: {cross_encoder_score}")
                
                # 获取原始分数
                original_score = candidate.get("total_score", 0.0)
                
                # 判断是否为图片
                is_image = "caption" in candidate.get("payload", {})
                
                # 对于implicit_enrichment的图片，给予特殊保护
                # 因为图片caption短，Cross-Encoder可能打分偏低，需要降低Cross-Encoder权重
                if visual_intent == "implicit_enrichment" and is_image:
                    # 图片保护：降低Cross-Encoder权重，提高RRF权重
                    # Cross-Encoder权重降低到50%，RRF权重提高到150%
                    image_cross_weight = self.cross_encoder_weight * 0.5
                    image_rrf_weight = self.rrf_weight * 1.5
                    
                    logger.debug(
                        f"图片保护机制激活: 候选{i} (图片), "
                        f"Cross-Encoder分数={cross_encoder_score:.3f}, "
                        f"RRF分数={original_score:.3f}, "
                        f"权重调整: Cross={image_cross_weight:.2f}, RRF={image_rrf_weight:.2f}"
                    )
                    
                    # 对于第一位图片，如果原始分数明显高于第二位，使用动态权重
                    if i == 0 and len(candidates) >= 2:
                        first_original_score = candidates[0].get("total_score", 0.0)
                        second_original_score = candidates[1].get("total_score", 0.0)
                        if first_original_score > 0 and second_original_score > 0:
                            score_gap_ratio = (first_original_score - second_original_score) / first_original_score
                            if score_gap_ratio > 0.2:
                                # 第一位图片使用更高的RRF权重
                                dynamic_image_rrf_weight = min(2.0, image_rrf_weight * (1 + score_gap_ratio))
                                dynamic_image_cross_weight = 1.0 - (dynamic_image_rrf_weight - image_rrf_weight)
                                final_score = (
                                    dynamic_image_cross_weight * cross_encoder_score +
                                    dynamic_image_rrf_weight * original_score
                                )
                            else:
                                final_score = (
                                    image_cross_weight * cross_encoder_score +
                                    image_rrf_weight * original_score
                                )
                        else:
                            final_score = (
                                image_cross_weight * cross_encoder_score +
                                image_rrf_weight * original_score
                            )
                    else:
                        final_score = (
                            image_cross_weight * cross_encoder_score +
                            image_rrf_weight * original_score
                        )
                else:
                    # 对于文本或非implicit_enrichment，使用标准权重
                    # 对于第一位，如果原始分数明显高于第二位，使用动态权重
                    if i == 0 and len(candidates) >= 2:
                        first_original_score = candidates[0].get("total_score", 0.0)
                        second_original_score = candidates[1].get("total_score", 0.0)
                        if first_original_score > 0 and second_original_score > 0:
                            score_gap_ratio = (first_original_score - second_original_score) / first_original_score
                            if score_gap_ratio > 0.2:
                                # 第一位使用更高的原始分数权重
                                final_score = (
                                    dynamic_cross_weight * cross_encoder_score +
                                    dynamic_rrf_weight * original_score
                                )
                            else:
                                final_score = (
                                    self.cross_encoder_weight * cross_encoder_score +
                                    self.rrf_weight * original_score
                                )
                        else:
                            final_score = (
                                self.cross_encoder_weight * cross_encoder_score +
                                self.rrf_weight * original_score
                            )
                    else:
                        final_score = (
                            self.cross_encoder_weight * cross_encoder_score +
                            self.rrf_weight * original_score
                        )
                
                # 构建最终结果
                final_candidate = {
                    "id": candidate["id"],
                    "payload": candidate["payload"],
                    "content_type": candidate.get("content_type"),
                    "original_score": original_score,
                    "cross_encoder_score": cross_encoder_score,
                    "final_score": final_score,
                    "rank": i + 1,
                    "query": query
                }
                
                final_ranking.append(final_candidate)
            
            return final_ranking
            
        except Exception as e:
            logger.error(f"合并分数失败: {str(e)}")
            return candidates
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 测试Reranker模型
            test_result = await self.llm_manager.rerank(
                query="测试查询",
                documents=["测试文档1", "测试文档2"],
                task_type="reranking"
            )
            
            return {
                "status": "healthy" if test_result.success else "unhealthy",
                "reranker_available": test_result.success,
                "cross_encoder_weight": self.cross_encoder_weight,
                "rrf_weight": self.rrf_weight,
                "top_k": self.top_k
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }