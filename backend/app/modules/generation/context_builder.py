"""
上下文构建器
将检索结果转换为LLM可理解的标准上下文格式
"""

from typing import Dict, List, Any, Optional, Tuple
import uuid
import asyncio
from datetime import datetime
from dataclasses import dataclass

from app.core.logger import get_logger
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter

logger = get_logger(__name__)

@dataclass
class ReferenceMap:
    """引用映射数据类"""
    id: str
    content_type: str  # "doc" 或 "image"
    file_path: str
    content: str
    metadata: Dict[str, Any]
    presigned_url: Optional[str] = None

@dataclass
class ContextBuildResult:
    """上下文构建结果"""
    context_string: str
    reference_map: Dict[str, ReferenceMap]
    total_chunks: int
    total_images: int
    max_tokens_used: int
    build_time: float

class ContextBuilder:
    """检索产物上下文构建器"""
    
    def __init__(self):
        self.formatter = MultiModalFormatter()
        self.minio_adapter = MinIOAdapter()
        
        # 上下文配置
        self.max_context_length = 4000  # 最大上下文长度
        self.max_chunks = 15           # 最大文本块数量
        self.max_images = 5            # 最大图片数量（默认）
        self.max_images_implicit = 6   # implicit_enrichment时的最大图片数量（稍低于原8，控制图片占比）
    
    async def build_context(
        self,
        retrieval_result: Any,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None
    ) -> ContextBuildResult:
        """
        构建LLM上下文
        
        Args:
            retrieval_result: 检索结果
            query: 用户查询
            kb_context: 知识库上下文
            
        Returns:
            上下文构建结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始构建上下文: 查询='{query}', 结果数={len(retrieval_result.reranked_results)}")
            
            # 1. 处理检索结果
            processed_results = await self._process_retrieval_results(retrieval_result)
            
            # 2. 生成引用映射
            reference_map = await self._generate_reference_map(processed_results)
            
            # 3. 构建上下文字符串
            context_string = await self._build_context_string(
                processed_results, reference_map, query
            )
            
            # 4. 优化上下文长度
            optimized_context = await self._optimize_context_length(
                context_string, reference_map
            )
            
            # 5. 构建最终结果
            build_time = (datetime.utcnow() - start_time).total_seconds()
            
            final_result = ContextBuildResult(
                context_string=optimized_context,
                reference_map=reference_map,
                total_chunks=len([r for r in processed_results if r["content_type"] == "doc"]),
                total_images=len([r for r in processed_results if r["content_type"] == "image"]),
                max_tokens_used=len(optimized_context.split()),
                build_time=build_time
            )
            
            logger.info(f"上下文构建完成: 文本{final_result.total_chunks}, 图片{final_result.total_images}, Token数{final_result.max_tokens_used}")
            
            # 调试日志：记录实际构建的context内容（仅前500字符）
            context_preview = optimized_context[:500] + "..." if len(optimized_context) > 500 else optimized_context
            logger.debug(f"构建的上下文预览: {context_preview}")
            logger.debug(f"引用映射ID列表: {list(reference_map.keys())}")
            
            return final_result
            
        except Exception as e:
            logger.error(f"上下文构建失败: {str(e)}")
            return ContextBuildResult(
                context_string="",
                reference_map={},
                total_chunks=0,
                total_images=0,
                max_tokens_used=0,
                build_time=0.0
            )
    
    async def _process_retrieval_results(self, retrieval_result: Any) -> List[Dict[str, Any]]:
        """处理检索结果"""
        try:
            # 根据visual_intent调整图片配额
            visual_intent = None
            if hasattr(retrieval_result, 'context') and hasattr(retrieval_result.context, 'visual_intent'):
                visual_intent = retrieval_result.context.visual_intent
            
            # 对于implicit_enrichment，增加图片配额
            max_images = self.max_images_implicit if visual_intent == "implicit_enrichment" else self.max_images
            
            processed_results = []
            seen_chunk_ids = set()  # 用于去重，确保每个 chunk 只出现一次
            doc_count = 0
            image_count = 0
            
            for result in retrieval_result.reranked_results:
                # 必须使用检索返回的 point id（向量库 chunk 的 id），用于引用与 context_window 查询
                point_id = result.get("id")
                chunk_id = str(point_id) if point_id is not None else None
                if not chunk_id:
                    continue
                
                # 跳过重复的 chunk（相同的 chunk_id）
                if chunk_id in seen_chunk_ids:
                    logger.debug(f"跳过重复的 chunk: {chunk_id}")
                    continue
                
                seen_chunk_ids.add(chunk_id)
                
                payload = result.get("payload", {})
                
                # 确定内容类型
                content_type = "image" if "caption" in payload else "doc"
                
                # 提取内容
                if content_type == "doc":
                    content = payload.get("text_content", "")
                    file_path = payload.get("file_path", "")
                    file_type = payload.get("file_type", "unknown")
                else:  # image
                    content = payload.get("caption", "")
                    file_path = payload.get("file_path", "")
                    file_type = "image"
                
                # 构建处理结果（id 为检索返回的 point id，贯穿引用与检查器）
                processed_result = {
                    "id": chunk_id,
                    "content_type": content_type,
                    "content": content,
                    "file_path": file_path,
                    "file_type": file_type,
                    "score": result.get("final_score", 0.0),
                    "metadata": {
                        "kb_id": payload.get("kb_id"),
                        "chunk_index": payload.get("chunk_index"),
                        "original_score": result.get("original_score"),
                        "cross_encoder_score": result.get("cross_encoder_score")
                    }
                }
                
                processed_results.append(processed_result)
            
            # 按分数排序
            processed_results.sort(key=lambda x: x["score"], reverse=True)
            
            # 限制结果数量（使用动态的max_images）
            limited_results = []
            doc_count = 0
            image_count = 0
            
            for result in processed_results:
                if result["content_type"] == "doc" and doc_count >= self.max_chunks:
                    continue
                if result["content_type"] == "image" and image_count >= max_images:
                    continue
                
                limited_results.append(result)
                
                if result["content_type"] == "doc":
                    doc_count += 1
                else:
                    image_count += 1
            
            if visual_intent == "implicit_enrichment":
                logger.info(
                    f"Implicit enrichment图片配额优化: 使用max_images={max_images}, "
                    f"实际保留{image_count}张图片, {doc_count}个文本块"
                )
            
            return limited_results
            
        except Exception as e:
            logger.error(f"处理检索结果失败: {str(e)}")
            return []
    
    async def _generate_reference_map(
        self, 
        processed_results: List[Dict[str, Any]]
    ) -> Dict[str, ReferenceMap]:
        """生成引用映射"""
        try:
            reference_map = {}
            
            # 按类型分组，确保文档在前、图片在后，与_build_context_string保持一致
            docs = [r for r in processed_results if r["content_type"] == "doc"]
            images = [r for r in processed_results if r["content_type"] == "image"]
            
            # 文档从1开始编号
            for i, doc in enumerate(docs, 1):
                ref_id = str(i)
                reference = ReferenceMap(
                    id=ref_id,
                    content_type=doc["content_type"],
                    file_path=doc["file_path"],
                    content=doc["content"],
                    metadata={
                        "score": doc["score"],
                        "kb_id": doc["metadata"].get("kb_id"),
                        "file_type": doc["file_type"],
                        "chunk_id": doc.get("id"),  # 检索返回的 point id，直接用于 context_window 查询
                        "chunk_index": doc["metadata"].get("chunk_index")  # chunk 在文档中的索引
                    }
                )
                reference_map[ref_id] = reference
            
            # 图片从len(docs)+1开始编号
            # 并行生成图片预签名URL以提高性能
            async def _generate_presigned_url_for_image(image: Dict[str, Any], ref_id: str) -> Tuple[str, Optional[str]]:
                """为单个图片生成预签名URL"""
                try:
                    kb_id = image["metadata"].get("kb_id")
                    bucket = (
                        self.minio_adapter.bucket_name_for_kb(kb_id)
                        if kb_id
                        else "images"
                    )
                    object_path = image["file_path"]
                    presigned_url = await self.minio_adapter.get_presigned_url(
                        bucket=bucket,
                        object_path=object_path,
                        expires_hours=24
                    )
                    return ref_id, presigned_url
                except Exception as e:
                    logger.error(f"生成图片预签名URL失败: {str(e)}")
                    return ref_id, None
            
            # 创建所有图片引用对象
            image_references = []
            for i, image in enumerate(images, len(docs) + 1):
                ref_id = str(i)
                reference = ReferenceMap(
                    id=ref_id,
                    content_type=image["content_type"],
                    file_path=image["file_path"],
                    content=image["content"],
                    metadata={
                        "score": image["score"],
                        "kb_id": image["metadata"].get("kb_id"),
                        "file_type": image["file_type"],
                        "chunk_id": image.get("id"),  # 检索返回的 point id
                        "chunk_index": image["metadata"].get("chunk_index")  # chunk 在文档中的索引（如果有）
                    }
                )
                image_references.append((ref_id, reference, image))
            
            # 并行生成所有图片的预签名URL
            if image_references:
                presigned_tasks = [
                    _generate_presigned_url_for_image(image, ref_id)
                    for ref_id, _, image in image_references
                ]
                presigned_results = await asyncio.gather(*presigned_tasks, return_exceptions=True)
                
                # 将预签名URL分配给对应的引用对象
                presigned_map = {}
                for result in presigned_results:
                    if isinstance(result, BaseException):
                        logger.error(f"生成预签名URL时出错: {result}")
                        continue
                    if isinstance(result, tuple) and len(result) == 2:
                        ref_id, presigned_url = result
                        presigned_map[ref_id] = presigned_url
                
                # 设置预签名URL并添加到引用映射
                for ref_id, reference, _ in image_references:
                    reference.presigned_url = presigned_map.get(ref_id)
                    reference_map[ref_id] = reference
            
            return reference_map
            
        except Exception as e:
            logger.error(f"生成引用映射失败: {str(e)}")
            return {}
    
    async def _build_context_string(
        self,
        processed_results: List[Dict[str, Any]],
        reference_map: Dict[str, ReferenceMap],
        query: str
    ) -> str:
        """构建上下文字符串"""
        try:
            context_parts = []
            
            # 添加标题
            context_parts.append("参考材料列表：\n")
            
            # 按类型分组处理
            docs = [r for r in processed_results if r["content_type"] == "doc"]
            images = [r for r in processed_results if r["content_type"] == "image"]
            
            # 如果包含图片，在标题后添加提示
            if images:
                context_parts.append("**注意**：以下材料包含图片内容，请仔细阅读图片的【视觉描述】，判断其是否与用户查询相关。\n")
            
            # 处理文档
            for i, doc in enumerate(docs, 1):
                ref_id = str(i)
                
                # 使用模态格式化器
                doc_format = self.formatter.format_document_chunk(
                    index=ref_id,
                    content=doc["content"],
                    file_path=doc["file_path"],
                    metadata=doc["metadata"]
                )
                
                context_parts.append(doc_format)
                context_parts.append("")  # 空行分隔
            
            # 处理图片
            for i, image in enumerate(images, len(docs) + 1):
                ref_id = str(i)
                
                # 使用模态格式化器
                image_format = self.formatter.format_image_content(
                    index=ref_id,
                    caption=image["content"],
                    file_path=image["file_path"],
                    metadata=image["metadata"]
                )
                
                context_parts.append(image_format)
                context_parts.append("")  # 空行分隔
            
            # 添加用户问题
            context_parts.append(f"用户问题：{query}")
            
            return "\n".join(context_parts)
            
        except Exception as e:
            logger.error(f"构建上下文字符串失败: {str(e)}")
            return "参考材料构建失败"
    
    async def _optimize_context_length(
        self,
        context_string: str,
        reference_map: Dict[str, ReferenceMap]
    ) -> str:
        """优化上下文长度"""
        try:
            tokens = context_string.split()
            current_length = len(tokens)
            
            if current_length <= self.max_context_length:
                return context_string
            
            logger.info(f"上下文过长({current_length} tokens)，需要优化")
            
            # 简单策略：逐步截断每个引用的内容
            optimized_parts = ["参考材料列表：\n"]
            
            for ref_id, reference in reference_map.items():
                # 截断内容
                max_content_length = max(100, self.max_context_length // len(reference_map))
                content = reference.content[:max_content_length]
                
                if reference.content_type == "doc":
                    optimized_parts.append(
                        f"【材料 {ref_id}】 (类型: 文档 | 来源: {reference.file_path})"
                    )
                    optimized_parts.append("内容片段：")
                    optimized_parts.append(f"{content}...\n")
                else:
                    optimized_parts.append(
                        f"【材料 {ref_id}】 (类型: 图片 | 来源: {reference.file_path})"
                    )
                    optimized_parts.append("[视觉描述]：")
                    optimized_parts.append(f"{content}...\n")
            
            optimized_context = "\n".join(optimized_parts)
            
            # 检查优化后的长度
            new_length = len(optimized_context.split())
            logger.info(f"上下文优化完成: {current_length} -> {new_length} tokens")
            
            return optimized_context
            
        except Exception as e:
            logger.error(f"上下文长度优化失败: {str(e)}")
            return context_string
    
    async def get_reference_preview(
        self, 
        reference_id: str, 
        reference_map: Dict[str, ReferenceMap]
    ) -> Optional[Dict[str, Any]]:
        """
        获取引用预览
        
        Args:
            reference_id: 引用ID
            reference_map: 引用映射字典
            
        Returns:
            引用预览信息，包含内容、文件路径、预签名URL等
        """
        try:
            if reference_id not in reference_map:
                logger.warning(f"引用ID不存在: {reference_id}")
                return None
            
            reference = reference_map[reference_id]
            
            # 构建预览信息
            preview = {
                "id": reference.id,
                "content_type": reference.content_type,
                "file_path": reference.file_path,
                "content": reference.content[:200] + "..." if len(reference.content) > 200 else reference.content,
                "metadata": reference.metadata
            }
            
            # 按知识库划分 Bucket：同一知识库的文档与图片在同一 bucket，用 kb_id 解析 bucket
            if reference.content_type == "image":
                try:
                    kb_id = (reference.metadata or {}).get("kb_id")
                    bucket = (
                        self.minio_adapter.bucket_name_for_kb(kb_id)
                        if kb_id
                        else "images"  # 兼容旧数据：无 kb_id 时按类型回退
                    )
                    object_path = reference.file_path
                    presigned_url = await self.minio_adapter.get_presigned_url(
                        bucket=bucket,
                        object_path=object_path,
                        expires_hours=24
                    )
                    preview["presigned_url"] = presigned_url
                    reference.presigned_url = presigned_url
                except Exception as e:
                    logger.error(f"生成图片预签名URL失败: {str(e)}")
                    preview["presigned_url"] = None

            elif reference.content_type == "doc":
                try:
                    kb_id = (reference.metadata or {}).get("kb_id")
                    bucket = (
                        self.minio_adapter.bucket_name_for_kb(kb_id)
                        if kb_id
                        else "documents"  # 兼容旧数据
                    )
                    object_path = reference.file_path
                    presigned_url = await self.minio_adapter.get_presigned_url(
                        bucket=bucket,
                        object_path=object_path,
                        expires_hours=24
                    )
                    preview["presigned_url"] = presigned_url
                    reference.presigned_url = presigned_url
                except Exception as e:
                    logger.error(f"生成文档预签名URL失败: {str(e)}")
                    preview["presigned_url"] = None
            
            return preview
            
        except Exception as e:
            logger.error(f"获取引用预览失败: {str(e)}")
            return None
    
    def validate_references(self, answer: str, reference_map: Dict[str, ReferenceMap]) -> List[Dict[str, Any]]:
        """验证引用是否有效，返回引用详细信息字典列表（去重）"""
        try:
            import re
            
            # 查找所有引用格式 [数字]
            ref_pattern = r'\[(\d+)\]'
            references = re.findall(ref_pattern, answer)
            
            # 使用集合去重，确保每个引用编号只处理一次
            unique_ref_nums = list(dict.fromkeys(references))  # 保持顺序的去重
            
            valid_references = []
            seen_keys = set()  # 用于去重，确保同一素材不重复出现
            
            for ref_num in unique_ref_nums:
                if ref_num in reference_map:
                    reference = reference_map[ref_num]
                    chunk_id = reference.metadata.get("chunk_id")
                    file_path = reference.file_path or ""
                    dedupe_key = chunk_id or file_path
                    if dedupe_key and dedupe_key in seen_keys:
                        logger.debug(f"跳过重复引用: {dedupe_key} (引用编号: {ref_num})")
                        continue
                    if dedupe_key:
                        seen_keys.add(dedupe_key)
                    
                    # 构建引用字典
                    ref_dict = {
                        "id": reference.id,  # 引用编号（1, 2, 3...）
                        "type": reference.content_type,  # "doc" 或 "image"
                        "file_name": reference.file_path.split('/')[-1] if '/' in reference.file_path else reference.file_path,
                        "file_path": reference.file_path,
                        "content": reference.content[:200] if reference.content else "",  # 只保留前200字符
                        "img_url": reference.presigned_url if reference.content_type == "image" else None,
                        "scores": {"rerank": reference.metadata.get("score", 0.0)},
                        "chunk_id": chunk_id,  # chunk 的 ID（Qdrant point ID）
                        "chunk_index": reference.metadata.get("chunk_index"),  # chunk 在文档中的索引
                        "metadata": reference.metadata
                    }
                    valid_references.append(ref_dict)
                else:
                    logger.warning(f"发现无效引用: [{ref_num}]")
            
            return valid_references
            
        except Exception as e:
            logger.error(f"引用验证失败: {str(e)}")
            return []
    
    async def get_context_statistics(self) -> Dict[str, Any]:
        """获取上下文构建统计"""
        try:
            return {
                "max_context_length": self.max_context_length,
                "max_chunks": self.max_chunks,
                "max_images": self.max_images,
                "formatter_type": "multimodal"
            }
            
        except Exception as e:
            logger.error(f"获取统计失败: {str(e)}")
            return {}