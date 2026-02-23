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
    content_type: str  # "doc" | "image" | "audio" | "video"
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
            
            # 检索目标知识库 ID 列表，用于在 payload 无 kb_id 时（如历史视频数据）补全引用
            target_kb_ids = []
            if hasattr(retrieval_result, "context") and hasattr(retrieval_result.context, "target_kb_ids"):
                target_kb_ids = getattr(retrieval_result.context, "target_kb_ids", []) or []
            
            # 2. 生成引用映射
            reference_map = await self._generate_reference_map(processed_results, target_kb_ids=target_kb_ids)
            
            # 2b. 为音频（及视频）引用生成 presigned_url，便于前端展示播放器
            await self._enrich_audio_video_presigned_urls(reference_map)
            # 2c. 为视频引用的关键帧图片生成 presigned_url，便于前端展示关键帧缩略图
            await self._enrich_video_keyframe_presigned_urls(reference_map)
            # 2d. 将关键帧作为独立「图片」引用加入 reference_map，加入 prompt 后可被模型单独引用 [n]
            self._add_keyframe_image_references(reference_map)
            
            # 3. 构建上下文字符串
            context_string = await self._build_context_string(
                processed_results, reference_map, query
            )
            
            # 4. 优化上下文长度
            optimized_context = await self._optimize_context_length(
                context_string, reference_map
            )
            
            # 5. 构建最终结果（total_images 含检索图片 + 视频关键帧作为图片的引用数）
            build_time = (datetime.utcnow() - start_time).total_seconds()
            total_images = len([r for r in reference_map.values() if r.content_type == "image"])
            
            final_result = ContextBuildResult(
                context_string=optimized_context,
                reference_map=reference_map,
                total_chunks=len([r for r in processed_results if r["content_type"] == "doc"]),
                total_images=total_images,
                max_tokens_used=len(optimized_context.split()),
                build_time=build_time
            )
            
            total_audio = len([r for r in reference_map.values() if r.content_type == "audio"])
            total_video = len([r for r in reference_map.values() if r.content_type == "video"])
            logger.info(
                f"上下文构建完成: 文本{final_result.total_chunks}, 图片{final_result.total_images}, "
                f"音频{total_audio}, 视频{total_video}, Token数{final_result.max_tokens_used}"
            )
            
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
                # 确定内容类型：优先用重排结果中的 content_type，再按 payload 推断
                content_type = result.get("content_type")
                if not content_type:
                    content_type = "image" if "caption" in payload else ("audio" if "transcript" in payload else ("video" if "description" in payload and payload.get("file_path") else "doc"))
                
                # 提取内容
                if content_type == "image":
                    content = payload.get("caption", "")
                    file_path = payload.get("file_path", "")
                    file_type = "image"
                elif content_type == "audio":
                    content = payload.get("transcript", "") or payload.get("description", "")
                    file_path = payload.get("file_path", "")
                    file_type = payload.get("audio_format", "audio") or "audio"
                    # metadata 中保留 description、duration 等供 format_audio_content 使用
                    payload_meta = {
                        "kb_id": payload.get("kb_id"),
                        "description": payload.get("description", ""),
                        "duration": payload.get("duration", 0.0),
                        "original_score": result.get("original_score"),
                        "cross_encoder_score": result.get("cross_encoder_score"),
                    }
                elif content_type == "video":
                    content = (
                        result.get("content", "")
                        or payload.get("scene_summary", "")
                        or payload.get("description", "")
                    )
                    file_path = payload.get("file_path", "") or result.get("file_path", "")
                    file_type = "video"
                    payload_meta = {
                        "kb_id": payload.get("kb_id"),
                        "duration": payload.get("duration", 0.0),
                        "original_score": result.get("original_score"),
                        "cross_encoder_score": result.get("cross_encoder_score"),
                        "scene_start_time": payload.get("scene_start_time"),
                        "scene_end_time": payload.get("scene_end_time"),
                    }
                    # 合并检索返回的 metadata（含 key_frames 等），供 format_video_content 与前端展示
                    result_meta = result.get("metadata") or {}
                    payload_meta = {**payload_meta, **result_meta}
                else:  # doc
                    content = payload.get("text_content", "")
                    file_path = payload.get("file_path", "")
                    file_type = payload.get("file_type", "unknown")
                    payload_meta = {
                        "kb_id": payload.get("kb_id"),
                        "chunk_index": payload.get("chunk_index"),
                        "original_score": result.get("original_score"),
                        "cross_encoder_score": result.get("cross_encoder_score"),
                    }
                
                # 构建处理结果（id 为检索返回的 point id，贯穿引用与检查器）
                metadata = payload_meta if content_type in ("audio", "video") else {
                    "kb_id": payload.get("kb_id"),
                    "chunk_index": payload.get("chunk_index"),
                    "original_score": result.get("original_score"),
                    "cross_encoder_score": result.get("cross_encoder_score"),
                }
                processed_result = {
                    "id": chunk_id,
                    "content_type": content_type,
                    "content": content,
                    "file_path": file_path,
                    "file_type": file_type,
                    "score": result.get("final_score", 0.0),
                    "metadata": metadata,
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
                # audio / video 不单独设上限，与 doc 一起计入上下文
                limited_results.append(result)
                if result["content_type"] == "doc":
                    doc_count += 1
                elif result["content_type"] == "image":
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
        processed_results: List[Dict[str, Any]],
        target_kb_ids: Optional[List[str]] = None,
    ) -> Dict[str, ReferenceMap]:
        """生成引用映射。target_kb_ids 为检索目标知识库列表，用于在 payload 无 kb_id 时补全音频/视频引用。"""
        try:
            reference_map = {}
            target_kb_ids = target_kb_ids or []
            fallback_kb_id = target_kb_ids[0] if target_kb_ids else None
            
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
            
            # 音频从 len(docs)+len(images)+1 开始编号（与 _build_context_string 顺序一致），并生成预签名 URL 供前端播放
            audios = [r for r in processed_results if r["content_type"] == "audio"]
            start_audio = len(docs) + len(images) + 1
            audio_refs_for_presigned = []
            for i, audio in enumerate(audios, start_audio):
                ref_id = str(i)
                reference = ReferenceMap(
                    id=ref_id,
                    content_type=audio["content_type"],
                    file_path=audio["file_path"],
                    content=audio["content"],
                    metadata={
                        "score": audio["score"],
                        "kb_id": audio["metadata"].get("kb_id") or fallback_kb_id,
                        "file_type": audio["file_type"],
                        "chunk_id": audio.get("id"),
                        "description": audio["metadata"].get("description", ""),
                        "duration": audio["metadata"].get("duration", 0.0),
                    }
                )
                reference_map[ref_id] = reference
                audio_refs_for_presigned.append((ref_id, reference, audio))
            if audio_refs_for_presigned:
                async def _presigned_audio(ref_id: str, ref: ReferenceMap, aud: Dict[str, Any]) -> None:
                    try:
                        kb_id = aud["metadata"].get("kb_id")
                        bucket = self.minio_adapter.bucket_name_for_kb(kb_id) if kb_id else None
                        if bucket and aud.get("file_path"):
                            url = await self.minio_adapter.get_presigned_url(
                                bucket=bucket,
                                object_path=aud["file_path"],
                                expires_hours=24,
                            )
                            ref.presigned_url = url
                    except Exception as e:
                        logger.debug("音频预签名URL生成失败: ref_id=%s, e=%s", ref_id, e)
                await asyncio.gather(*[_presigned_audio(rid, ref, aud) for rid, ref, aud in audio_refs_for_presigned])
            
            # 视频紧接着音频编号
            videos = [r for r in processed_results if r["content_type"] == "video"]
            start_video = start_audio + len(audios)
            for i, video in enumerate(videos, start_video):
                ref_id = str(i)
                reference = ReferenceMap(
                    id=ref_id,
                    content_type=video["content_type"],
                    file_path=video["file_path"],
                    content=video["content"],
                    metadata={
                        "score": video["score"],
                        "kb_id": video["metadata"].get("kb_id") or fallback_kb_id,
                        "file_type": video["file_type"],
                        "chunk_id": video.get("id"),
                        "duration": video["metadata"].get("duration", 0.0),
                        "scene_start_time": video["metadata"].get("scene_start_time"),
                        "scene_end_time": video["metadata"].get("scene_end_time"),
                        "key_frames": video["metadata"].get("key_frames", []),
                    }
                )
                reference_map[ref_id] = reference
            
            return reference_map
            
        except Exception as e:
            logger.error(f"生成引用映射失败: {str(e)}")
            return {}
    
    async def _enrich_audio_video_presigned_urls(self, reference_map: Dict[str, ReferenceMap]) -> None:
        """为 reference_map 中 content_type 为 audio/video 的引用生成 presigned_url，便于前端展示播放器。"""
        for ref_id, reference in reference_map.items():
            if reference.content_type not in ("audio", "video"):
                continue
            if not reference.file_path:
                continue
            try:
                kb_id = (reference.metadata or {}).get("kb_id")
                bucket = (
                    self.minio_adapter.bucket_name_for_kb(kb_id)
                    if kb_id
                    else None
                )
                if bucket:
                    reference.presigned_url = await self.minio_adapter.get_presigned_url(
                        bucket=bucket,
                        object_path=reference.file_path,
                        expires_hours=24
                    )
                else:
                    reference.presigned_url = None
            except Exception as e:
                logger.debug("生成音频/视频预签名URL失败: ref_id=%s, e=%s", ref_id, e)
                reference.presigned_url = None
    
    async def _enrich_video_keyframe_presigned_urls(self, reference_map: Dict[str, ReferenceMap]) -> None:
        """为 reference_map 中 content_type 为 video 的引用的关键帧图片生成 presigned URL。"""
        for ref_id, reference in reference_map.items():
            if reference.content_type != "video":
                continue
            key_frames = (reference.metadata or {}).get("key_frames") or []
            if not key_frames:
                continue
            kb_id = (reference.metadata or {}).get("kb_id")
            bucket = (
                self.minio_adapter.bucket_name_for_kb(kb_id)
                if kb_id
                else None
            )
            if not bucket:
                continue
            enriched = []
            for frame in key_frames:
                path = frame.get("frame_image_path")
                if not path:
                    enriched.append({**frame})
                    continue
                try:
                    url = await self.minio_adapter.get_presigned_url(
                        bucket=bucket,
                        object_path=path,
                        expires_hours=24,
                    )
                    enriched.append({
                        **frame,
                        "img_url": url,
                    })
                except Exception as e:
                    logger.debug("关键帧预签名URL失败: ref_id=%s path=%s e=%s", ref_id, path, e)
                    enriched.append({**frame})
            reference.metadata["key_frames"] = enriched
    
    def _add_keyframe_image_references(self, reference_map: Dict[str, ReferenceMap]) -> None:
        """将视频引用的关键帧作为独立「图片」引用加入 reference_map，便于模型在回答中单独引用 [n] 并前端以图片展示。"""
        if not reference_map:
            return
        next_id = max((int(k) for k in reference_map if str(k).isdigit()), default=0) + 1
        to_add: List[tuple] = []
        for ref_id, ref in list(reference_map.items()):
            if ref.content_type != "video":
                continue
            key_frames = (ref.metadata or {}).get("key_frames") or []
            for frame in key_frames:
                img_url = frame.get("img_url")
                if not img_url:
                    continue
                frame_path = frame.get("frame_image_path") or ""
                frame_desc = frame.get("description") or ""
                to_add.append((
                    str(next_id),
                    ReferenceMap(
                        id=str(next_id),
                        content_type="image",
                        file_path=frame_path,
                        content=frame_desc,
                        metadata={
                            "kb_id": (ref.metadata or {}).get("kb_id"),
                            "score": (ref.metadata or {}).get("score", 0.0),
                            "from_video_keyframe": True,
                            "source_video_ref_id": ref_id,
                        },
                        presigned_url=img_url,
                    ),
                ))
                next_id += 1
        for rid, r in to_add:
            reference_map[rid] = r
    
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
            audios = [r for r in processed_results if r["content_type"] == "audio"]
            videos = [r for r in processed_results if r["content_type"] == "video"]
            
            # 如果包含多媒体内容，在标题后添加提示
            if images or audios or videos:
                context_parts.append("**注意**：以下材料包含多媒体内容（图片/音频/视频），请仔细阅读相关描述和转写文本，判断其是否与用户查询相关。\n")
            
            # 处理文档
            current_index = 1
            for doc in docs:
                ref_id = str(current_index)
                
                # 使用模态格式化器
                doc_format = self.formatter.format_document_chunk(
                    index=ref_id,
                    content=doc["content"],
                    file_path=doc["file_path"],
                    metadata=doc["metadata"]
                )
                
                context_parts.append(doc_format)
                context_parts.append("")  # 空行分隔
                current_index += 1
            
            # 处理图片
            for image in images:
                ref_id = str(current_index)
                
                # 使用模态格式化器
                image_format = self.formatter.format_image_content(
                    index=ref_id,
                    caption=image["content"],
                    file_path=image["file_path"],
                    metadata=image["metadata"]
                )
                
                context_parts.append(image_format)
                context_parts.append("")  # 空行分隔
                current_index += 1
            
            # 处理音频
            for audio in audios:
                ref_id = str(current_index)
                
                # 使用模态格式化器
                audio_format = self.formatter.format_audio_content(
                    index=ref_id,
                    transcript=audio.get("content", ""),
                    description=audio.get("metadata", {}).get("description", ""),
                    file_path=audio["file_path"],
                    metadata=audio.get("metadata", {})
                )
                
                context_parts.append(audio_format)
                context_parts.append("")  # 空行分隔
                current_index += 1
            
            # 处理视频
            for video in videos:
                ref_id = str(current_index)
                
                # 使用模态格式化器
                video_format = self.formatter.format_video_content(
                    index=ref_id,
                    description=video.get("content", ""),
                    file_path=video["file_path"],
                    metadata=video.get("metadata", {})
                )
                
                context_parts.append(video_format)
                context_parts.append("")  # 空行分隔
                current_index += 1
            
            # 视频关键帧作为独立图片材料（与图片模态一致），模型可单独引用 [n] 并在前端以图片展示
            for ref_id, ref in sorted(reference_map.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 999999):
                if ref.content_type != "image":
                    continue
                if not (ref.metadata or {}).get("from_video_keyframe"):
                    continue
                keyframe_format = self.formatter.format_image_content(
                    index=ref_id,
                    caption=ref.content or "（视频关键帧）",
                    file_path=ref.file_path or "",
                    metadata=ref.metadata or {},
                )
                context_parts.append(keyframe_format)
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

            elif reference.content_type == "audio":
                try:
                    kb_id = (reference.metadata or {}).get("kb_id")
                    bucket = (
                        self.minio_adapter.bucket_name_for_kb(kb_id)
                        if kb_id
                        else None
                    )
                    if bucket and reference.file_path:
                        presigned_url = await self.minio_adapter.get_presigned_url(
                            bucket=bucket,
                            object_path=reference.file_path,
                            expires_hours=24
                        )
                        preview["presigned_url"] = presigned_url
                        reference.presigned_url = presigned_url
                    else:
                        preview["presigned_url"] = None
                except Exception as e:
                    logger.debug(f"生成音频预签名URL失败: {e}")
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
                    
                    # 构建引用字典（支持 doc / image / audio / video）
                    ref_id = reference.id
                    if isinstance(ref_id, str) and ref_id.isdigit():
                        ref_id = int(ref_id)
                    ref_dict = {
                        "id": ref_id,
                        "type": reference.content_type,
                        "file_name": reference.file_path.split('/')[-1] if reference.file_path and '/' in reference.file_path else (reference.file_path or ""),
                        "file_path": reference.file_path,
                        "content": reference.content[:200] if reference.content else "",
                        "img_url": reference.presigned_url if reference.content_type == "image" else None,
                        "audio_url": reference.presigned_url if reference.content_type == "audio" else None,
                        "video_url": getattr(reference, "presigned_url", None) if reference.content_type == "video" else None,
                        "scores": {"rerank": reference.metadata.get("score", 0.0)},
                        "chunk_id": chunk_id,
                        "chunk_index": reference.metadata.get("chunk_index"),
                        "metadata": reference.metadata
                    }
                    if reference.content_type == "video":
                        st = reference.metadata.get("scene_start_time")
                        en = reference.metadata.get("scene_end_time")
                        if st is not None:
                            ref_dict["start_sec"] = float(st)
                        if en is not None:
                            ref_dict["end_sec"] = float(en)
                        ref_dict["debug_info"] = {"kb_id": reference.metadata.get("kb_id")}
                        kf = reference.metadata.get("key_frames")
                        if kf:
                            ref_dict["key_frames"] = kf
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