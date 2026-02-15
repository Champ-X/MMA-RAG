"""
数据输入处理服务
协调文件上传、解析、向量化、存储的完整流程
"""

from typing import Dict, List, Any, Optional, TYPE_CHECKING
import asyncio
import uuid
from datetime import datetime
from pathlib import Path
import base64
from io import BytesIO
import warnings
import os
from PIL import Image

# 在导入 transformers 之前设置警告过滤器
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*torch.utils._pytree.*")
warnings.filterwarnings("ignore", message=".*_register_pytree_node.*")
warnings.filterwarnings("ignore", message=".*resume_download.*")
warnings.filterwarnings("ignore", message=".*text_config_dict.*")
warnings.filterwarnings("ignore", message=".*text_config.*")
warnings.filterwarnings("ignore", message=".*id2label.*")
warnings.filterwarnings("ignore", message=".*bos_token_id.*")
warnings.filterwarnings("ignore", message=".*eos_token_id.*")
warnings.filterwarnings("ignore", message=".*overriden.*")

# 设置环境变量抑制 transformers 警告
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

if TYPE_CHECKING:
    from transformers import CLIPModel, CLIPProcessor

from .parsers.factory import ParserFactory, FileType
from .storage.minio_adapter import MinIOAdapter
from .storage.vector_store import VectorStore
from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine
from app.core.sparse_encoder import get_sparse_encoder
from app.core.logger import get_logger, audit_log

logger = get_logger(__name__)

class IngestionService:
    """数据输入处理服务"""
    
    def __init__(self):
        self.parser_factory = ParserFactory()
        self.minio_adapter = MinIOAdapter()
        self.vector_store = VectorStore()
        self.llm_manager = llm_manager
        self.sparse_encoder = get_sparse_encoder()  # BGE-M3 稀疏向量编码器
        self._clip_model: Optional["CLIPModel"] = None
        self._clip_processor: Optional["CLIPProcessor"] = None
        
        # 处理状态存储（生产环境应使用Redis或数据库）
        self._processing_status: Dict[str, Dict[str, Any]] = {}
        
    async def _get_actual_kb_id_for_upload(self, kb_id: str) -> str:
        """
        获取上传文件时应使用的实际 kb_id（从 MinIO 桶反查 Qdrant 中实际存在的 kb_id）。
        如果桶内文件对应多个 kb_id，选择数据量最大的那个（解决历史数据迁移/ID变更问题）。
        
        Args:
            kb_id: 前端传入的 kb_id
            
        Returns:
            实际应使用的 kb_id（反查得到的数据量最大的或前端传入的）
        """
        try:
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            if not self.minio_adapter.bucket_exists(bucket_name):
                # 桶不存在，说明是新知识库，直接用前端传入的 kb_id
                return kb_id
            
            # 从桶内收集所有 kb_id 及其数据量
            try:
                from qdrant_client.http.models import Filter, FieldCondition, MatchValue
                from collections import defaultdict
                
                raw = list(
                    self.minio_adapter.client.list_objects(
                        bucket_name, prefix=None, recursive=True
                    )
                )
                
                # 统计每个 kb_id 的数据量（file_id 采样）
                kb_id_counts = defaultdict(lambda: {"text": 0, "image": 0})
                sampled_file_ids = set()
                
                for obj in raw[:50]:  # 采样前 50 个文件
                    op = obj.object_name
                    parts = op.split("/")
                    if len(parts) < 2:
                        continue
                    rest = parts[1]
                    under = rest.find("_")
                    fid = rest[:under] if under >= 0 else rest
                    if not fid or fid in sampled_file_ids:
                        continue
                    sampled_file_ids.add(fid)
                    
                    filt = Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=fid))])
                    
                    # text_chunks
                    try:
                        res = self.vector_store.client.scroll(
                            collection_name="text_chunks",
                            scroll_filter=filt,
                            limit=1,
                            with_payload=True,
                        )
                        points = res[0] if res else []
                        if points:
                            p = getattr(points[0], "payload", None) or {}
                            discovered_kb_id = p.get("kb_id")
                            if discovered_kb_id:
                                kb_id_counts[discovered_kb_id]["text"] += 1
                    except:
                        pass
                    
                    # image_vectors
                    try:
                        res = self.vector_store.client.scroll(
                            collection_name="image_vectors",
                            scroll_filter=filt,
                            limit=1,
                            with_payload=True,
                        )
                        points = res[0] if res else []
                        if points:
                            p = getattr(points[0], "payload", None) or {}
                            discovered_kb_id = p.get("kb_id")
                            if discovered_kb_id:
                                kb_id_counts[discovered_kb_id]["image"] += 1
                    except:
                        pass
                
                # 选择数据量最大的 kb_id（优先文本数量）
                if kb_id_counts:
                    best_kb_id = max(
                        kb_id_counts.items(),
                        key=lambda x: (x[1]["text"], x[1]["image"])
                    )[0]
                    
                    if best_kb_id != kb_id:
                        total = kb_id_counts[best_kb_id]["text"] + kb_id_counts[best_kb_id]["image"]
                        logger.info(
                            f"桶 {bucket_name} 发现数据量最大的 kb_id: {best_kb_id} "
                            f"(text:{kb_id_counts[best_kb_id]['text']}, "
                            f"image:{kb_id_counts[best_kb_id]['image']})"
                        )
                    return best_kb_id
                    
            except Exception as e:
                logger.debug(f"从桶反查 kb_id 失败 {bucket_name}: {e}")
            
            # 反查失败，使用前端传入的 kb_id
            return kb_id
            
        except Exception as e:
            logger.debug(f"获取实际 kb_id 失败: {e}")
            return kb_id
    
    async def process_file_upload(
        self,
        file_content: bytes,
        file_path: str,
        kb_id: str,
        user_id: Optional[str] = None,
        processing_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        处理文件上传完整流程
        
        Args:
            file_content: 文件二进制内容
            file_path: 文件路径
            kb_id: 知识库ID
            user_id: 用户ID
            processing_id: 可选，由流式上传接口传入以便前端轮询/流式读取进度
            
        Returns:
            处理结果
        """
        if processing_id is None:
            processing_id = str(uuid.uuid4())
        logger.info(f"开始处理文件上传: {file_path}, 处理ID: {processing_id}")
        
        # 【关键修复】从 MinIO 桶内反查 Qdrant 中的实际 kb_id，确保新旧数据用同一 kb_id
        # 如果反查失败或桶不存在，则使用前端传入的 kb_id
        actual_kb_id = await self._get_actual_kb_id_for_upload(kb_id)
        if actual_kb_id != kb_id:
            logger.info(f"上传文件使用反查到的 kb_id: {kb_id} -> {actual_kb_id}")
        
        # 初始化处理状态
        self._processing_status[processing_id] = {
            "processing_id": processing_id,
            "status": "processing",
            "progress": 0,
            "stage": "initializing",
            "message": "开始处理文件上传",
            "file_path": file_path,
            "kb_id": actual_kb_id,
            "user_id": user_id,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "error": None
        }
        
        try:
            # 更新状态：解析中
            self._update_processing_status(processing_id, {
                "progress": 10,
                "stage": "parsing",
                "message": "正在解析文件..."
            })
            
            # 1. 解析文件
            parse_result = await self.parser_factory.parse_file(file_content, file_path)
            file_type = parse_result["file_type"]
            
            audit_log(
                f"文件解析完成: {file_path}, 类型: {file_type}",
                processing_id=processing_id,
                file_type=file_type,
                kb_id=kb_id
            )
            
            # 更新状态：解析完成
            self._update_processing_status(processing_id, {
                "progress": 20,
                "stage": "uploading",
                "message": "正在上传文件到存储..."
            })
            
            # 2. 上传到MinIO
            storage_result = await self.minio_adapter.upload_file(
                file_content=file_content,
                file_path=file_path,
                kb_id=kb_id,
                file_type="documents" if file_type in ["pdf", "docx", "txt", "md"] else "images"
            )
            
            audit_log(
                f"文件上传完成: {storage_result['file_id']}",
                processing_id=processing_id,
                file_id=storage_result["file_id"],
                storage_size=storage_result["size"]
            )
            
            # 更新状态：上传完成
            self._update_processing_status(processing_id, {
                "progress": 40,
                "stage": "processing",
                "message": f"正在处理{file_type}文件..."
            })
            
            # 3. 根据文件类型处理（使用反查得到的实际 kb_id）
            if file_type in ["pdf", "docx", "txt", "md"]:
                result = await self._process_document(
                    parse_result=parse_result,
                    storage_result=storage_result,
                    kb_id=actual_kb_id,
                    processing_id=processing_id,
                    file_path=file_path
                )
            elif file_type == "image":
                result = await self._process_image(
                    parse_result=parse_result,
                    storage_result=storage_result,
                    kb_id=actual_kb_id,
                    processing_id=processing_id
                )
            else:
                raise ValueError(f"不支持的文件类型: {file_type}")

            # 4. 画像增量触发：累计 Chunk 增量，达到阈值则异步触发 Celery 画像构建
            try:
                from app.core.portrait_trigger import increment_and_maybe_trigger
                delta = result.get("vectors_stored", 0) or 0
                if isinstance(delta, (int, float)) and int(delta) > 0:
                    increment_and_maybe_trigger(actual_kb_id, int(delta))
            except Exception as e:
                logger.warning(f"画像增量触发失败 kb_id={actual_kb_id}: {e}")
            
            # 更新状态：处理完成（写入 result 供流式上传接口读取）
            self._update_processing_status(processing_id, {
                "status": "completed",
                "progress": 100,
                "stage": "completed",
                "message": "文件处理完成",
                "completed_at": datetime.utcnow().isoformat(),
                "result": result,
            })
            
            return result
                
        except Exception as e:
            logger.error(f"文件处理失败: {str(e)}")
            audit_log(
                f"文件处理失败: {str(e)}",
                processing_id=processing_id,
                error=str(e)
            )
            
            # 更新状态：处理失败
            self._update_processing_status(processing_id, {
                "status": "failed",
                "progress": 0,
                "stage": "error",
                "message": f"处理失败: {str(e)}",
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat()
            })
            
            raise
    
    async def _process_document(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_path: Optional[str] = None
    ) -> Dict[str, Any]:
        """处理文档文件"""
        
        # 保存 MinIO 存储结果（包含 file_id）
        minio_storage_result = storage_result
        
        # 0. 处理 PDF 中提取的图片（如果有），并收集 (markdown_ref, caption) 用于后续插回
        extracted_images_count = 0
        caption_replacements: List[tuple] = []  # (markdown_ref, vlm_caption)
        if parse_result.get("file_type") == "pdf" and "extracted_images" in parse_result:
            extracted_images = parse_result.get("extracted_images", [])
            if extracted_images:
                logger.info(f"发现 {len(extracted_images)} 张从 PDF 提取的图片，开始处理")
                self._update_processing_status(processing_id, {
                    "stage": "processing_images",
                    "progress": 25,
                    "message": f"正在处理 PDF 中的 {len(extracted_images)} 张图片..."
                })
                
                file_id = minio_storage_result.get("file_id")
                full_md = parse_result.get("markdown") or ""

                for img_idx, img_info in enumerate(extracted_images):
                    try:
                        page_num = img_info.get("page", 1)
                        image_index = img_info.get("image_index", img_idx)
                        image_bytes = img_info.get("image_bytes")
                        image_path = img_info.get("image_path", "")
                        markdown_ref = img_info.get("markdown_ref")
                        meta = img_info.get("metadata") or {}
                        document_caption = meta.get("document_caption") or img_info.get("document_caption") or ""
                        surrounding_context = self._get_surrounding_context_for_image(
                            full_md, markdown_ref or "", page_num, parse_result
                        )

                        if not image_bytes:
                            logger.warning(f"跳过第 {page_num} 页第 {image_index} 张图片：缺少图片数据")
                            continue
                        
                        # 更新进度
                        self._update_processing_status(processing_id, {
                            "message": f"正在处理图片 {img_idx + 1}/{len(extracted_images)} (第 {page_num} 页)"
                        })
                        
                        # 使用 ImageParser 解析图片
                        image_parser = self.parser_factory.get_parser(FileType.IMAGE)
                        if not image_parser:
                            logger.error("ImageParser 不可用，跳过图片处理")
                            continue
                        
                        # 生成图片文件名
                        image_filename = f"{file_id}_page{page_num}_img{image_index}.jpg"
                        
                        # 解析图片
                        image_parse_result = await image_parser.parse(image_bytes, image_filename)
                        
                        # 上传图片到 MinIO
                        image_storage_result = await self.minio_adapter.upload_file(
                            file_content=image_bytes,
                            file_path=image_filename,
                            kb_id=kb_id,
                            file_type="images"
                        )
                        
                        # 处理图片（带文档标题与位置上下文的 VLM、CLIP、存储），并收集 markdown_ref 与 caption 用于插回；传入原始文档 file_id 便于删除文档时一并删图
                        image_result = await self._process_image(
                            parse_result=image_parse_result,
                            storage_result=image_storage_result,
                            kb_id=kb_id,
                            processing_id=processing_id,
                            image_source_type="pdf_extracted",
                            document_caption=document_caption or None,
                            surrounding_context=surrounding_context if surrounding_context != "无" else None,
                            markdown_ref=markdown_ref,
                            source_file_id=file_id,
                        )
                        if markdown_ref and image_result.get("caption"):
                            cap = image_result["caption"]
                            if cap.startswith("无法生成") or cap == "VLM API返回空响应":
                                cap = "解析失败"
                            caption_replacements.append((markdown_ref, cap))

                        extracted_images_count += 1
                        logger.info(f"PDF 图片处理完成: {image_filename}, 向量数: {image_result.get('vectors_stored', 0)}")
                        
                    except Exception as e:
                        logger.error(f"处理 PDF 图片失败 (第 {img_info.get('page', '?')} 页第 {img_info.get('image_index', '?')} 张): {str(e)}", exc_info=True)
                        continue
                
                logger.info(f"PDF 图片处理完成: {extracted_images_count}/{len(extracted_images)} 张图片成功处理")
        
        # 1. 用「补全后的 markdown」做文本分块：将 VLM 图注插回占位符后再 chunk
        parse_result_for_chunking = parse_result
        if caption_replacements and parse_result.get("markdown"):
            enriched_markdown = parse_result["markdown"]
            for ref, vlm_caption in caption_replacements:
                replacement = f"\n\n[图注：{vlm_caption}]\n\n"
                enriched_markdown = enriched_markdown.replace(ref, replacement, 1)
            parse_result_for_chunking = {**parse_result, "markdown": enriched_markdown}
            logger.info("已将 %d 条 VLM 图注插回 Markdown，使用补全后的文本进行分块", len(caption_replacements))
        chunks = await self._split_text_into_chunks(parse_result_for_chunking)
        
        # 为每个chunk添加file_path和file_type信息
        object_path = minio_storage_result.get("object_path", file_path or "")
        file_type = parse_result.get("file_type", "unknown")
        file_id = minio_storage_result.get("file_id")
        
        # 为每个chunk生成临时ID，用于填充context_window
        for i, chunk in enumerate(chunks):
            chunk["file_path"] = object_path
            chunk["file_type"] = file_type
            chunk["file_id"] = file_id
            chunk["temp_id"] = str(uuid.uuid4())  # 临时ID，用于context_window
        
        # 填充context_window：存储前后相邻chunk的临时ID
        for i, chunk in enumerate(chunks):
            context_window = {}
            if i > 0:
                context_window["prev_chunk_id"] = chunks[i - 1]["temp_id"]
            if i < len(chunks) - 1:
                context_window["next_chunk_id"] = chunks[i + 1]["temp_id"]
            chunk["context_window"] = context_window
        
        audit_log(
            f"文档分块完成: {len(chunks)} 个chunk",
            processing_id=processing_id,
            chunk_count=len(chunks)
        )
        
        # 2. 向量化文本块
        vectors_result = await self._vectorize_text_chunks(chunks, processing_id)
        
        # 获取稀疏向量统计信息
        sparse_stats = vectors_result.get("sparse_stats", {})
        
        # 3. 存储到向量数据库
        vector_storage_result = await self.vector_store.upsert_text_chunks(
            kb_id=kb_id,
            chunks=vectors_result["chunks"]
        )
        
        # 统计实际存储了稀疏向量的chunks数量
        chunks_with_sparse = sum(
            1 for chunk in vectors_result["chunks"]
            if chunk.get("sparse_vector") and len(chunk.get("sparse_vector", {})) > 0
        )
        
        return {
            "processing_id": processing_id,
            "status": "completed",
            "file_id": minio_storage_result["file_id"],
            "chunks_processed": len(chunks),
            "vectors_stored": vector_storage_result["points_inserted"],
            "file_type": "document",
            "sparse_stats": {
                "chunks_with_sparse": chunks_with_sparse,
                "total_chunks": sparse_stats.get("total_chunks", len(chunks)),
                "successful": sparse_stats.get("successful", 0),
                "failed": sparse_stats.get("failed", 0),
                "avg_sparse_size": sparse_stats.get("avg_sparse_size", 0.0)
            }
        }
    
    async def _process_image(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        image_source_type: str = "standalone_file",
        document_caption: Optional[str] = None,
        surrounding_context: Optional[str] = None,
        markdown_ref: Optional[str] = None,
        source_file_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """处理图片文件
        
        Args:
            parse_result: 图片解析结果
            storage_result: MinIO 存储结果
            kb_id: 知识库ID
            processing_id: 处理ID
            image_source_type: 图片来源类型，默认为 "standalone_file"，PDF提取的图片使用 "pdf_extracted"
            document_caption: 文档中该图的标题/说明（可选，用于 VLM 上下文）
            surrounding_context: 该图所在段落或页面上下文（可选）
            markdown_ref: 该图在 markdown 中的占位符，用于后续插回图注（可选）
            source_file_id: 来源文档的 file_id（PDF 解析图必填），用于删除文档时一并删除 image_vectors
        """
        
        # 保存 MinIO 存储结果（包含 file_id）
        minio_storage_result = storage_result
        
        # 1. 生成图片描述（VLM）：先推送阶段，再调用 VLM，便于前端进度与真实流程一致
        self._update_processing_status(processing_id, {
            "stage": "parsing",
            "progress": 45,
            "message": "VLM 生成图片描述",
        })
        caption_result = await self._generate_image_caption(
            parse_result["base64_content"],
            processing_id,
            image_format=parse_result.get("format"),
            document_caption=document_caption,
            surrounding_context=surrounding_context,
        )
        
        audit_log(
            f"图片描述生成完成",
            processing_id=processing_id,
            caption_length=len(caption_result["caption"])
        )
        
        # 2. CLIP向量化（使用原始图片bytes，不是base64）
        # 从parse_result中获取原始图片数据
        image_bytes = None
        if "base64_content" in parse_result:
            base64_str = parse_result["base64_content"]
            if base64_str.startswith("data:image"):
                base64_str = base64_str.split(",")[1]
            image_bytes = base64.b64decode(base64_str)
        
        # 2. CLIP 图片向量化（推送阶段供前端进度）
        self._update_processing_status(processing_id, {
            "stage": "vectorizing",
            "progress": 60,
            "message": "CLIP 图片向量化",
        })
        logger.info("开始 CLIP 图片向量化 (processing_id=%s)", processing_id)
        clip_input_data = {
            "image_bytes": image_bytes,
            "width": parse_result.get("width"),
            "height": parse_result.get("height"),
            "format": parse_result.get("format")
        }
        clip_result = await self._vectorize_with_clip(clip_input_data, processing_id)
        logger.info("CLIP 图片向量化完成: 维度=%s (processing_id=%s)", clip_result.get("vector_dim", 768), processing_id)
        
        # 3. 文本向量化描述（空描述用占位符，避免部分 API 对空输入返回 5xx）
        caption = (caption_result.get("caption") or "").strip()
        text_to_embed = caption if caption else " "
        self._update_processing_status(processing_id, {"message": "文本向量化"})
        logger.info("开始文本向量化（图片描述） (processing_id=%s)", processing_id)
        text_vector_result = await self._vectorize_text([text_to_embed])
        logger.info("文本向量化完成: 向量数=%s (processing_id=%s)", len(text_vector_result.get("vectors", [])), processing_id)
        
        # 4. 存储到向量数据库（PDF 解析图写入 source_file_id，删除文档时按此字段删图）
        image_data = [{
            "file_id": minio_storage_result["file_id"],
            "file_path": minio_storage_result["object_path"],
            "caption": caption or caption_result.get("caption", ""),
            "clip_vector": clip_result["clip_vector"],  # 768 维
            "text_vector": text_vector_result["vectors"][0],  # 4096 维
            "image_format": parse_result.get("format"),  # 会被转换为 img_format
            "image_source_type": image_source_type,
            "width": parse_result.get("width"),
            "height": parse_result.get("height"),
            "source_file_id": source_file_id,
        }]
        
        vector_storage_result = await self.vector_store.upsert_image_vectors(
            kb_id=kb_id,
            images=image_data
        )
        
        result = {
            "processing_id": processing_id,
            "status": "completed",
            "file_id": minio_storage_result["file_id"],
            "caption": caption_result["caption"],
            "vectors_stored": vector_storage_result["points_inserted"],
            "file_type": "image"
        }
        if markdown_ref is not None:
            result["markdown_ref"] = markdown_ref
        return result

    async def _split_text_into_chunks(self, parse_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """将文本分割成块"""
        chunks = []
        
        if parse_result["file_type"] == "pdf":
            # 如果 PDF 解析结果包含 markdown 字段（MinerU/PaddleOCR），使用完整 markdown 进行分块
            if "markdown" in parse_result and parse_result["markdown"]:
                logger.info("使用 PDF 解析生成的完整 Markdown 进行分块")
                markdown_text = parse_result["markdown"]
                
                # 使用 MarkdownParser 的逻辑提取段落
                from .parsers.factory import MarkdownParser
                markdown_parser = MarkdownParser()
                
                # 提取标题
                lines = markdown_text.split('\n')
                headers = []
                for line in lines:
                    if line.startswith('#'):
                        headers.append({
                            "level": len(line) - len(line.lstrip('#')),
                            "text": line.lstrip('#').strip()
                        })
                
                # 构建智能段落
                paragraphs = markdown_parser._build_smart_paragraphs(markdown_text, headers)
                
                # 转换为 chunks
                for paragraph in paragraphs:
                    if paragraph.get("text", "").strip():
                        chunk_metadata = {
                            "file_type": "pdf",
                            "parser": parse_result.get("metadata", {}).get("parser", "pymupdf"),
                        }
                        
                        # 添加标题信息
                        if paragraph.get("header"):
                            header = paragraph["header"]
                            chunk_metadata["header_level"] = header.get("level")
                            chunk_metadata["header_text"] = header.get("text")
                        
                        # 添加代码块标记
                        if paragraph.get("has_code"):
                            chunk_metadata["has_code"] = True
                        
                        chunks.append({
                            "text": paragraph["text"].strip(),
                            "metadata": chunk_metadata
                        })
            else:
                # 使用原有的按页分块逻辑（PyMuPDF 解析结果）
                logger.info("使用按页分块逻辑（PyMuPDF 解析结果）")
                for page in parse_result["pages"]:
                    if page.get("text", "").strip():
                        chunks.append({
                            "text": page["text"].strip(),
                            "metadata": {
                                "page": page["page"],
                                "file_type": "pdf",
                                "parser": parse_result.get("metadata", {}).get("parser", "pymupdf")
                            }
                        })
        
        elif parse_result["file_type"] in ["docx", "txt", "md"]:
            # 段落处理
            # 检查是否有 paragraphs 字段
            if "paragraphs" in parse_result:
                for paragraph in parse_result["paragraphs"]:
                    if isinstance(paragraph, dict) and paragraph.get("text", "").strip():
                        # 构建chunk元数据
                        chunk_metadata = {
                            "file_type": parse_result["file_type"]
                        }
                        
                        # 如果是markdown且有标题信息，添加到元数据
                        if parse_result["file_type"] == "md" and paragraph.get("header"):
                            header = paragraph["header"]
                            chunk_metadata["header_level"] = header.get("level")
                            chunk_metadata["header_text"] = header.get("text")
                        
                        chunks.append({
                            "text": paragraph["text"].strip(),
                            "metadata": chunk_metadata
                        })
            # 如果没有 paragraphs，尝试使用 content 字段
            elif "content" in parse_result:
                # 按段落分割内容
                content = parse_result["content"]
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                for para in paragraphs:
                    if para.strip():
                        chunks.append({
                            "text": para.strip(),
                            "metadata": {
                                "file_type": parse_result["file_type"]
                            }
                        })
            else:
                logger.warning(f"无法从解析结果中提取文本块: {parse_result.keys()}")
        
        # 实现更智能的分块策略
        # - 递归分块：如果块太大，继续分割
        # - 重叠窗口：相邻块之间有重叠，保持上下文连贯性
        
        # 配置参数
        max_chunk_size = 1000  # 最大块大小（字符数）
        chunk_overlap = 200    # 重叠窗口大小（字符数）
        min_chunk_size = 100   # 最小块大小（字符数）
        
        # 对每个初始块进行智能处理
        processed_chunks = []
        for chunk in chunks:
            text = chunk["text"]
            
            # 如果块太大，进行递归分块
            if len(text) > max_chunk_size:
                sub_chunks = self._recursive_split_chunk(
                    text=text,
                    max_size=max_chunk_size,
                    overlap=chunk_overlap,
                    min_size=min_chunk_size,
                    metadata=chunk.get("metadata", {})
                )
                processed_chunks.extend(sub_chunks)
            else:
                # 块大小合适，直接使用
                processed_chunks.append(chunk)
        
        # 对相邻块应用重叠窗口（如果块数大于1）
        if len(processed_chunks) > 1:
            processed_chunks = self._apply_overlap_window(
                processed_chunks,
                overlap_size=chunk_overlap
            )
        
        return processed_chunks
    
    def _recursive_split_chunk(
        self,
        text: str,
        max_size: int,
        overlap: int,
        min_size: int,
        metadata: Dict[str, Any],
        depth: int = 0,
        max_depth: int = 10
    ) -> List[Dict[str, Any]]:
        """递归分割大块文本
        
        Args:
            text: 要分割的文本
            max_size: 最大块大小
            overlap: 重叠大小
            min_size: 最小块大小
            metadata: 元数据
            depth: 当前递归深度
            max_depth: 最大递归深度（防止无限递归）
        """
        # 防止无限递归
        if depth >= max_depth:
            logger.warning(f"达到最大递归深度 {max_depth}，强制截断文本")
            # 强制截断到最大大小
            return [{
                "text": text[:max_size].strip(),
                "metadata": metadata.copy()
            }]
        
        # 如果文本本身小于等于最大大小，直接返回
        if len(text) <= max_size:
            return [{
                "text": text.strip(),
                "metadata": metadata.copy()
            }]
        
        chunks = []
        
        # 尝试按段落分割
        paragraphs = text.split('\n\n')
        current_chunk = ""
        
        for para in paragraphs:
            # 如果当前块加上新段落超过最大大小
            if len(current_chunk) + len(para) > max_size and current_chunk:
                # 保存当前块
                chunks.append({
                    "text": current_chunk.strip(),
                    "metadata": metadata.copy()
                })
                # 开始新块，保留重叠部分
                if overlap > 0 and len(current_chunk) > overlap:
                    # 从当前块末尾提取重叠部分
                    overlap_text = current_chunk[-overlap:]
                    current_chunk = overlap_text + "\n\n" + para
                else:
                    current_chunk = para
            else:
                # 添加到当前块
                if current_chunk:
                    current_chunk += "\n\n" + para
                else:
                    current_chunk = para
        
        # 添加最后一个块
        if current_chunk.strip():
            # 如果最后一个块仍然太大，继续递归分割
            if len(current_chunk) > max_size:
                sub_chunks = self._recursive_split_chunk(
                    current_chunk, max_size, overlap, min_size, metadata, depth + 1, max_depth
                )
                chunks.extend(sub_chunks)
            else:
                chunks.append({
                    "text": current_chunk.strip(),
                    "metadata": metadata.copy()
                })
        
        # 如果按段落分割后仍有块太大，按句子分割
        final_chunks = []
        for chunk in chunks:
            if len(chunk["text"]) > max_size:
                # 按句子分割
                sentences = self._split_by_sentences(chunk["text"])
                current_text = ""
                
                for sentence in sentences:
                    # 如果单个句子就超过最大大小，强制截断
                    if len(sentence) > max_size:
                        logger.warning(f"单个句子超过最大大小 ({len(sentence)} > {max_size})，强制截断")
                        # 将长句子按字符强制分割
                        sentence_chunks = []
                        remaining = sentence
                        while len(remaining) > max_size:
                            sentence_chunks.append(remaining[:max_size])
                            remaining = remaining[max_size:]
                        if remaining:
                            sentence_chunks.append(remaining)
                        
                        # 处理这些强制分割的块
                        for sc in sentence_chunks:
                            if len(current_text) + len(sc) > max_size and current_text:
                                final_chunks.append({
                                    "text": current_text.strip(),
                                    "metadata": chunk["metadata"].copy()
                                })
                                current_text = sc
                            else:
                                current_text += " " + sc if current_text else sc
                    elif len(current_text) + len(sentence) > max_size and current_text:
                        final_chunks.append({
                            "text": current_text.strip(),
                            "metadata": chunk["metadata"].copy()
                        })
                        # 保留重叠
                        if overlap > 0 and len(current_text) > overlap:
                            overlap_text = current_text[-overlap:]
                            current_text = overlap_text + " " + sentence
                        else:
                            current_text = sentence
                    else:
                        current_text += " " + sentence if current_text else sentence
                
                if current_text.strip():
                    # 如果最后剩余的文本仍然太大，递归分割
                    if len(current_text) > max_size:
                        sub_chunks = self._recursive_split_chunk(
                            current_text, max_size, overlap, min_size, chunk["metadata"], depth + 1, max_depth
                        )
                        final_chunks.extend(sub_chunks)
                    else:
                        final_chunks.append({
                            "text": current_text.strip(),
                            "metadata": chunk["metadata"].copy()
                        })
            else:
                final_chunks.append(chunk)
        
        return final_chunks
    
    def _split_by_sentences(self, text: str) -> List[str]:
        """按句子分割文本"""
        import re
        # 使用正则表达式分割句子（支持中英文）
        sentences = re.split(r'([.!?。！？]\s*)', text)
        result = []
        for i in range(0, len(sentences) - 1, 2):
            if i + 1 < len(sentences):
                result.append(sentences[i] + sentences[i + 1])
            else:
                result.append(sentences[i])
        return [s.strip() for s in result if s.strip()]
    
    def _apply_overlap_window(
        self,
        chunks: List[Dict[str, Any]],
        overlap_size: int
    ) -> List[Dict[str, Any]]:
        """对相邻块应用重叠窗口"""
        if len(chunks) <= 1:
            return chunks
        
        overlapped_chunks = []
        for i, chunk in enumerate(chunks):
            text = chunk["text"]
            
            # 如果不是第一个块，添加前一个块的末尾作为重叠
            if i > 0:
                prev_text = chunks[i - 1]["text"]
                if len(prev_text) > overlap_size:
                    overlap_text = prev_text[-overlap_size:]
                    text = overlap_text + "\n\n" + text
            
            # 如果不是最后一个块，添加后一个块的开头作为重叠
            if i < len(chunks) - 1:
                next_text = chunks[i + 1]["text"]
                if len(next_text) > overlap_size:
                    overlap_text = next_text[:overlap_size]
                    text = text + "\n\n" + overlap_text
            
            overlapped_chunks.append({
                "text": text,
                "metadata": chunk.get("metadata", {}).copy()
            })
        
        return overlapped_chunks
    
    async def _vectorize_text_chunks(
        self, 
        chunks: List[Dict[str, Any]], 
        processing_id: str
    ) -> Dict[str, Any]:
        """向量化文本块（密集向量 + 稀疏向量）"""
        try:
            texts = [chunk["text"] for chunk in chunks]
            
            # 1. 使用LLM管理器进行密集向量化（Qwen3-Embedding-8B）
            dense_result = await self.llm_manager.embed(texts=texts)
            
            if not dense_result.success:
                raise Exception(f"文本密集向量化失败: {dense_result.error}")
            
            # 检查数据是否存在
            if dense_result.data is None:
                raise Exception("文本密集向量化返回的数据为空")
            
            # 2. 使用 BGE-M3 进行稀疏向量化
            sparse_stats = {
                "total_chunks": len(texts),
                "successful": 0,
                "failed": 0,
                "total_sparse_elements": 0,
                "avg_sparse_size": 0.0
            }
            
            try:
                sparse_results = self.sparse_encoder.encode_corpus(texts, batch_size=32)
                logger.info(f"BGE-M3 稀疏向量化完成: {len(sparse_results)} 个文档")
                
                # 统计稀疏向量信息
                sparse_elements_list = []
                for result in sparse_results:
                    sparse_dict = result.get("sparse", {})
                    if sparse_dict:
                        sparse_stats["successful"] += 1
                        sparse_elements_list.append(len(sparse_dict))
                        sparse_stats["total_sparse_elements"] += len(sparse_dict)
                    else:
                        sparse_stats["failed"] += 1
                
                if sparse_elements_list:
                    sparse_stats["avg_sparse_size"] = sum(sparse_elements_list) / len(sparse_elements_list)
                    logger.info(
                        f"BGE-M3 稀疏向量统计: 成功={sparse_stats['successful']}, "
                        f"失败={sparse_stats['failed']}, "
                        f"平均非零元素={sparse_stats['avg_sparse_size']:.1f}"
                    )
                
            except Exception as sparse_e:
                logger.warning(f"BGE-M3 稀疏向量化失败，将只使用密集向量: {str(sparse_e)}")
                sparse_results = [{"sparse": {}} for _ in texts]  # 使用空稀疏向量
                sparse_stats["failed"] = len(texts)
            
            # 3. 组合结果
            vectorized_chunks = []
            for i, chunk in enumerate(chunks):
                chunk["vector"] = dense_result.data[i]  # 密集向量
                
                # 添加稀疏向量（如果可用）
                if i < len(sparse_results) and sparse_results[i].get("sparse"):
                    chunk["sparse_vector"] = sparse_results[i]["sparse"]
                else:
                    chunk["sparse_vector"] = {}  # 空稀疏向量
                
                chunk["file_id"] = chunk.get("file_id", f"chunk_{i}")
                chunk["chunk_index"] = i
                vectorized_chunks.append(chunk)
            
            return {
                "chunks": vectorized_chunks,
                "tokens_used": getattr(dense_result, 'tokens_used', 0),
                "sparse_stats": sparse_stats  # 添加稀疏向量统计信息
            }
            
        except Exception as e:
            logger.error(f"文本向量化失败: {str(e)}")
            raise

    def _get_surrounding_context_for_image(
        self,
        markdown: str,
        markdown_ref: str,
        page_num: Optional[int],
        parse_result: Dict[str, Any],
        max_chars: int = 1200,
    ) -> str:
        """从完整 markdown 中根据图片占位符定位所在段落，作为 VLM 的位置上下文；若无则用该页整页文本。"""
        if not markdown or not markdown_ref:
            return self._fallback_page_context(page_num, parse_result, max_chars)
        idx = markdown.find(markdown_ref)
        if idx < 0:
            return self._fallback_page_context(page_num, parse_result, max_chars)
        # 按双换行切段，找包含该占位符的段，并取前后各一段
        segments = markdown.split("\n\n")
        start = 0
        for i, seg in enumerate(segments):
            if markdown_ref in seg:
                start = max(0, i - 1)
                end = min(len(segments), i + 2)
                context = "\n\n".join(segments[start:end]).strip()
                if len(context) > max_chars:
                    context = context[: max_chars - 3] + "..."
                return context or "无"
        return self._fallback_page_context(page_num, parse_result, max_chars)

    def _fallback_page_context(
        self,
        page_num: Optional[int],
        parse_result: Dict[str, Any],
        max_chars: int,
    ) -> str:
        """用该图所在页的整页文本作为保底上下文。"""
        if not page_num or not parse_result.get("pages"):
            return "无"
        for p in parse_result["pages"]:
            if p.get("page") == page_num and (p.get("markdown") or p.get("text")):
                text = (p.get("markdown") or p.get("text") or "").strip()
                if len(text) > max_chars:
                    text = text[: max_chars - 3] + "..."
                return text or "无"
        return "无"

    async def _generate_image_caption(
        self,
        base64_image: str,
        processing_id: str,
        image_format: Optional[str] = None,
        document_caption: Optional[str] = None,
        surrounding_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """生成图片描述。可传入文档标题与位置上下文以提升与文档语义的一致性。"""
        try:
            doc = (document_caption or "").strip() or "无"
            ctx = (surrounding_context or "").strip() or "无"
            prompt_text = prompt_engine.render_template(
                "image_captioning",
                document_caption=doc,
                surrounding_context=ctx,
            )

            # 提取纯 base64，兼容已有 data URL 前缀
            raw_b64 = (
                base64_image.split(",", 1)[1]
                if base64_image.startswith("data:")
                else base64_image
            )
            # MIME 与真实格式一致，见 https://docs.siliconflow.cn/cn/userguide/capabilities/vision
            fmt = (image_format or "PNG").upper()
            mime = "png" if fmt == "PNG" else "jpeg"
            data_url = f"data:image/{mime};base64,{raw_b64}"

            # SiliconFlow VLM：content 为数组，image_url 需含 url、detail（auto/low/high）
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                        {"type": "text", "text": prompt_text},
                    ],
                }
            ]
            
            # 调用VLM API（大图或高 detail 可能需 1～3 分钟，提供方已对 VL 模型使用更长超时）
            logger.info("开始调用 VLM 生成图片描述")
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="image_captioning",
                model=None,  # 使用默认的image_captioning模型
                fallback=True,
                temperature=0.3  # 较低温度以获得更准确的描述
            )
            logger.info("VLM 图片描述调用返回: success=%s", result.success)
            if not result.success:
                logger.error(f"VLM API调用失败: {result.error}")
                # 如果API调用失败，返回默认描述
                caption = "无法生成图片描述，VLM API调用失败"
                model_used = "unknown"
            else:
                # 提取响应内容
                if isinstance(result.data, dict):
                    # 标准API响应格式
                    choices = result.data.get("choices", [])
                    if choices and len(choices) > 0:
                        message = choices[0].get("message", {})
                        caption = message.get("content", "无法生成图片描述")
                    else:
                        caption = "VLM API返回空响应"
                elif isinstance(result.data, str):
                    # 直接返回字符串
                    caption = result.data
                else:
                    caption = str(result.data)
                
                model_used = result.model_used or "Qwen/Qwen3-VL-32B-Instruct"
            
            logger.info(f"图片描述生成完成: 长度={len(caption)}, 模型={model_used}")
            
            return {
                "caption": caption,
                "model_used": model_used
            }
            
        except Exception as e:
            logger.error(f"图片描述生成失败: {str(e)}", exc_info=True)
            # 返回默认描述而不是抛出异常，确保流程可以继续
            return {
                "caption": f"图片描述生成失败: {str(e)}",
                "model_used": "error"
            }
    
    def _load_clip_model(self):
        """懒加载CLIP模型和处理器"""
        if self._clip_model is None or self._clip_processor is None:
            try:
                import torch
                
                # 在导入 transformers 之前设置警告过滤器
                # 这些警告来自 transformers 库的内部实现，不影响功能
                import sys
                import logging
                
                # 临时重定向 stderr 以捕获警告
                original_stderr = sys.stderr
                
                model_name = "openai/clip-vit-large-patch14"
                logger.info(f"正在加载CLIP模型: {model_name}")
                
                # 使用上下文管理器抑制所有警告
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    warnings.filterwarnings("ignore", category=FutureWarning)
                    warnings.filterwarnings("ignore", category=UserWarning)
                    warnings.filterwarnings("ignore", category=DeprecationWarning)
                    
                    # 临时禁用 transformers 的警告输出
                    transformers_logger = logging.getLogger("transformers")
                    original_level = transformers_logger.level
                    transformers_logger.setLevel(logging.ERROR)
                    
                    try:
                        from transformers import CLIPProcessor, CLIPModel
                        
                        # 加载模型和处理器
                        # 使用类型忽略注释，因为 transformers 库的类型定义可能不完整
                        loaded_model = CLIPModel.from_pretrained(model_name)  # type: ignore
                        loaded_processor = CLIPProcessor.from_pretrained(model_name)  # type: ignore
                    finally:
                        # 恢复日志级别
                        transformers_logger.setLevel(original_level)
                
                # 设置为评估模式
                loaded_model.eval()  # type: ignore
                
                # 如果可用，使用GPU
                if torch.cuda.is_available():
                    device = torch.device("cuda")
                    loaded_model = loaded_model.to(device)  # type: ignore
                    logger.info("CLIP模型已加载到GPU")
                else:
                    logger.info("CLIP模型已加载到CPU")
                
                # 赋值给实例变量
                self._clip_model = loaded_model  # type: ignore
                self._clip_processor = loaded_processor  # type: ignore
                    
            except Exception as e:
                logger.error(f"CLIP模型加载失败: {str(e)}")
                raise
    
    async def _vectorize_with_clip(
        self, 
        image_data: Dict[str, Any], 
        processing_id: str
    ) -> Dict[str, Any]:
        """使用CLIP向量化图片"""
        try:
            logger.info("CLIP 图片向量化: 开始 (processing_id=%s)", processing_id)
            # 懒加载模型
            self._load_clip_model()
            
            # 处理图片输入 - 优先使用原始图片bytes
            image = None
            if "image_bytes" in image_data and image_data["image_bytes"]:
                # 使用原始图片bytes（推荐方式）
                image = Image.open(BytesIO(image_data["image_bytes"])).convert("RGB")
            elif "base64_content" in image_data:
                # 从base64解码（兼容旧代码）
                base64_str = image_data["base64_content"]
                if base64_str.startswith("data:image"):
                    # 移除data URL前缀
                    base64_str = base64_str.split(",")[1]
                image_bytes = base64.b64decode(base64_str)
                image = Image.open(BytesIO(image_bytes)).convert("RGB")
            elif "image_path" in image_data:
                # 从文件路径加载
                image = Image.open(image_data["image_path"]).convert("RGB")
            else:
                raise ValueError("image_data中必须包含image_bytes、base64_content或image_path")
            
            # 使用CLIP处理图片
            import torch
            
            # 确保模型和处理器已加载
            if self._clip_model is None or self._clip_processor is None:
                raise RuntimeError("CLIP模型未加载")
            
            # CLIPProcessor 类型未声明 return_tensors，先调用再手动转为 tensor
            inputs = self._clip_processor(images=image)
            pixel_values = inputs.get("pixel_values")
            if pixel_values is not None and not isinstance(pixel_values, torch.Tensor):
                inputs = {**inputs, "pixel_values": torch.tensor(pixel_values)}
            
            # 移动到正确的设备
            if torch.cuda.is_available():
                device = torch.device("cuda")
                inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}
            
            # 生成向量
            with torch.no_grad():
                # 类型检查：inputs 是字典，需要明确传递给 get_image_features
                pixel_values = inputs.get("pixel_values")
                if pixel_values is None:
                    raise ValueError("CLIP处理器未返回pixel_values")
                # 使用类型忽略注释，因为 transformers 的类型定义可能不完整
                image_features = self._clip_model.get_image_features(pixel_values=pixel_values)  # type: ignore
                # 归一化向量
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                # 转换为numpy数组并提取向量
                clip_vector = image_features.cpu().numpy()[0].tolist()
            
            # clip-vit-large-patch14 的向量维度是 768
            assert len(clip_vector) == 768, f"向量维度错误: 期望768，实际{len(clip_vector)}"
            logger.info("CLIP 图片向量化: 完成, 维度=768 (processing_id=%s)", processing_id)
            return {
                "clip_vector": clip_vector,
                "model_used": "openai/clip-vit-large-patch14",
                "vector_dim": 768
            }
            
        except Exception as e:
            logger.error(f"CLIP向量化失败: {str(e)}", exc_info=True)
            raise
    
    async def _vectorize_text(self, texts: List[str]) -> Dict[str, Any]:
        """向量化文本"""
        try:
            logger.info("文本向量化: 开始, 文本数=%s", len(texts))
            result = await self.llm_manager.embed(texts=texts)
            if not result.success:
                raise Exception(f"文本向量化失败: {result.error}")
            
            # 检查数据是否存在
            if result.data is None:
                raise Exception("文本向量化返回的数据为空")
            logger.info("文本向量化: 完成, 向量数=%s", len(result.data))
            return {
                "vectors": result.data,
                "model_used": result.model_used
            }
            
        except Exception as e:
            logger.error(f"文本向量化失败: {str(e)}")
            raise
    
    def _update_processing_status(
        self, 
        processing_id: str, 
        updates: Dict[str, Any]
    ):
        """更新处理状态"""
        if processing_id in self._processing_status:
            self._processing_status[processing_id].update(updates)
            self._processing_status[processing_id]["updated_at"] = datetime.utcnow().isoformat()
    
    async def get_processing_status(self, processing_id: str) -> Dict[str, Any]:
        """
        获取处理状态
        
        Args:
            processing_id: 处理ID
            
        Returns:
            处理状态信息
        """
        try:
            if processing_id not in self._processing_status:
                return {
                    "processing_id": processing_id,
                    "status": "not_found",
                    "message": "处理ID不存在"
                }
            
            return self._processing_status[processing_id].copy()
            
        except Exception as e:
            logger.error(f"获取处理状态失败: {str(e)}")
            return {
                "processing_id": processing_id,
                "status": "error",
                "error": str(e)
            }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            minio_health = await self.minio_adapter.health_check()
            vector_health = await self.vector_store.health_check()
            
            return {
                "status": "healthy" if all(h.get("status") == "healthy" for h in [minio_health, vector_health]) else "unhealthy",
                "components": {
                    "minio": minio_health,
                    "vector_store": vector_health
                }
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }