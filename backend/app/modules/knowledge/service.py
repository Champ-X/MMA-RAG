"""
知识库管理服务
负责知识库的CRUD操作和基础管理功能
"""

from typing import Dict, List, Any, Optional
import uuid
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
from qdrant_client.http import models

logger = get_logger(__name__)

@dataclass
class KnowledgeBase:
    """知识库数据类"""
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str
    user_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class KnowledgeBaseService:
    """知识库管理服务"""
    
    def __init__(self):
        self.vector_store = VectorStore()
        self.minio_adapter = MinIOAdapter()
        self._kb_storage = {}  # 简单内存存储，生产环境应使用数据库
    
    async def create_knowledge_base(
        self,
        name: str,
        description: str,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """创建知识库"""
        try:
            kb_id = str(uuid.uuid4())
            
            # 创建知识库记录
            kb = KnowledgeBase(
                id=kb_id,
                name=name,
                description=description,
                created_at=datetime.utcnow().isoformat(),
                updated_at=datetime.utcnow().isoformat(),
                user_id=user_id,
                metadata=metadata or {}
            )
            
            # 存储到内存（生产环境应存储到数据库）
            self._kb_storage[kb_id] = kb
            
            # 创建存储桶目录结构
            await self._create_kb_structure(kb_id)
            
            audit_log(
                f"知识库创建成功: {name}",
                kb_id=kb_id,
                user_id=user_id,
                kb_name=name
            )
            
            logger.info(f"知识库创建成功: {kb_id} - {name}")
            
            return {
                "id": kb_id,
                "name": name,
                "description": description,
                "created_at": kb.created_at,
                "updated_at": kb.updated_at,
                "status": "active"
            }
            
        except Exception as e:
            logger.error(f"创建知识库失败: {str(e)}")
            raise
    
    async def get_knowledge_base(self, kb_id: str) -> Optional[Dict[str, Any]]:
        """获取知识库信息"""
        try:
            kb = self._kb_storage.get(kb_id)
            if not kb:
                return None
            
            # 获取统计信息
            stats = await self._get_kb_statistics(kb_id)
            
            return {
                "id": kb.id,
                "name": kb.name,
                "description": kb.description,
                "created_at": kb.created_at,
                "updated_at": kb.updated_at,
                "user_id": kb.user_id,
                "metadata": kb.metadata,
                "statistics": stats
            }
            
        except Exception as e:
            logger.error(f"获取知识库信息失败: {str(e)}")
            return None
    
    async def list_knowledge_bases(
        self,
        user_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """列出知识库"""
        try:
            kbs = []
            
            for kb_id, kb in self._kb_storage.items():
                # 如果指定了用户ID，过滤用户的知识库
                if user_id and kb.user_id != user_id:
                    continue
                
                # 获取统计信息
                stats = await self._get_kb_statistics(kb_id)
                
                kb_info = {
                    "id": kb.id,
                    "name": kb.name,
                    "description": kb.description,
                    "created_at": kb.created_at,
                    "updated_at": kb.updated_at,
                    "statistics": stats
                }
                kbs.append(kb_info)
            
            # 分页处理
            kbs = kbs[offset:offset + limit]
            
            return kbs
            
        except Exception as e:
            logger.error(f"列出知识库失败: {str(e)}")
            return []
    
    async def update_knowledge_base(
        self,
        kb_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """更新知识库"""
        try:
            kb = self._kb_storage.get(kb_id)
            if not kb:
                return None
            
            # 更新字段
            if name is not None:
                kb.name = name
            if description is not None:
                kb.description = description
            if metadata is not None:
                kb.metadata = metadata
            
            kb.updated_at = datetime.utcnow().isoformat()
            
            audit_log(
                f"知识库更新成功: {kb_id}",
                kb_id=kb_id,
                updated_fields=["name" if name else None, "description" if description else None]
            )
            
            logger.info(f"知识库更新成功: {kb_id}")
            
            return {
                "id": kb.id,
                "name": kb.name,
                "description": kb.description,
                "updated_at": kb.updated_at,
                "metadata": kb.metadata
            }
            
        except Exception as e:
            logger.error(f"更新知识库失败: {str(e)}")
            raise
    
    async def delete_knowledge_base(self, kb_id: str) -> bool:
        """删除知识库"""
        try:
            if kb_id not in self._kb_storage:
                return False
            
            kb = self._kb_storage[kb_id]
            
            # 清理相关数据
            try:
                # 1. 删除向量数据库中的向量
                await self._delete_kb_vectors(kb_id)
                
                # 2. 删除知识库画像
                await self.vector_store.delete_kb_portraits(kb_id)
                
                # 3. 删除MinIO中的文件
                await self._delete_kb_files(kb_id)
                
                logger.info(f"知识库数据清理完成: {kb_id}")
            except Exception as cleanup_error:
                logger.error(f"清理知识库数据时出错: {str(cleanup_error)}")
                # 即使清理失败，也继续删除知识库记录
            
            # 从存储中删除
            del self._kb_storage[kb_id]
            
            audit_log(
                f"知识库删除成功: {kb_id}",
                kb_id=kb_id,
                kb_name=kb.name
            )
            
            logger.info(f"知识库删除成功: {kb_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"删除知识库失败: {str(e)}")
            return False
    
    async def _create_kb_structure(self, kb_id: str):
        """创建知识库专属存储桶，该知识库下所有文档与图片均存于此桶"""
        try:
            self.minio_adapter.ensure_bucket_for_kb(kb_id)
            logger.info(f"知识库存储桶已就绪: {kb_id}")
        except Exception as e:
            logger.error(f"创建知识库目录结构失败: {str(e)}")
            raise
    
    async def _delete_kb_vectors(self, kb_id: str):
        """删除知识库的所有向量"""
        try:
            from qdrant_client.http.models import Filter, FieldCondition, MatchValue
            
            # 删除文本块向量
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            
            # 先查询所有相关的点ID
            scroll_result = self.vector_store.client.scroll(
                collection_name="text_chunks",
                scroll_filter=filter_condition,
                limit=10000  # 设置一个较大的限制
            )
            
            text_point_ids = [point.id for point in scroll_result[0] if hasattr(point, 'id')]
            if text_point_ids:
                self.vector_store.client.delete(
                    collection_name="text_chunks",
                    points_selector=models.PointIdsList(points=text_point_ids)
                )
                logger.info(f"删除文本块向量: {len(text_point_ids)} 个")
            
            # 删除图片向量
            scroll_result = self.vector_store.client.scroll(
                collection_name="image_vectors",
                scroll_filter=filter_condition,
                limit=10000
            )
            
            image_point_ids = [point.id for point in scroll_result[0] if hasattr(point, 'id')]
            if image_point_ids:
                self.vector_store.client.delete(
                    collection_name="image_vectors",
                    points_selector=models.PointIdsList(points=image_point_ids)
                )
                logger.info(f"删除图片向量: {len(image_point_ids)} 个")
            
        except Exception as e:
            logger.error(f"删除知识库向量失败: {str(e)}")
            raise
    
    async def _delete_kb_files(self, kb_id: str):
        """删除知识库在 MinIO 中的所有文件及对应存储桶。"""
        try:
            bucket_name = self.minio_adapter.bucket_name_for_kb(kb_id)

            if not self.minio_adapter.bucket_exists(bucket_name):
                logger.info(f"知识库 MinIO 存储桶不存在，跳过删除: {bucket_name}")
                return

            files = await self.minio_adapter.list_files(
                bucket=bucket_name,
                prefix="",
                max_keys=10000
            )

            deleted_count = 0
            object_paths = [f["object_path"] for f in files]
            if object_paths:
                for object_path in object_paths:
                    try:
                        await self.minio_adapter.delete_file(bucket_name, object_path)
                        deleted_count += 1
                    except Exception as e:
                        logger.warning(f"删除文件失败 {object_path}: {str(e)}")

            await self.minio_adapter.remove_bucket(bucket_name)
            logger.info(f"删除知识库 MinIO 完成: {deleted_count} 个文件, 已删除存储桶 {bucket_name}")
        except Exception as e:
            logger.error(f"删除知识库文件失败: {str(e)}")
            raise
    
    async def _get_kb_statistics(self, kb_id: str) -> Dict[str, Any]:
        """获取知识库统计信息"""
        try:
            from qdrant_client.http.models import Filter, FieldCondition, MatchValue
            
            # 构建过滤条件
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            
            # 统计文本块数量
            text_scroll_result = self.vector_store.client.scroll(
                collection_name="text_chunks",
                scroll_filter=filter_condition,
                limit=10000  # 设置一个较大的限制以获取所有数据
            )
            text_points = text_scroll_result[0]
            total_chunks = len(text_points)
            
            # 统计图片数量
            image_scroll_result = self.vector_store.client.scroll(
                collection_name="image_vectors",
                scroll_filter=filter_condition,
                limit=10000
            )
            image_points = image_scroll_result[0]
            total_images = len(image_points)
            
            # 统计文档数量（通过file_id去重）
            unique_file_ids = set()
            for point in text_points:
                if hasattr(point, 'payload') and point.payload:
                    payload = point.payload if isinstance(point.payload, dict) else {}
                    file_id = payload.get("file_id")
                    if file_id:
                        unique_file_ids.add(file_id)
            
            # 图片文件也计入文档数
            for point in image_points:
                if hasattr(point, 'payload') and point.payload:
                    payload = point.payload if isinstance(point.payload, dict) else {}
                    file_id = payload.get("file_id")
                    if file_id:
                        unique_file_ids.add(file_id)
            
            total_documents = len(unique_file_ids)
            
            # 统计该知识库对应 Bucket 中的文件大小
            total_size_bytes = 0
            bucket_name = self.minio_adapter.bucket_name_for_kb(kb_id)
            try:
                kb_files = await self.minio_adapter.list_files(
                    bucket=bucket_name,
                    prefix="",
                    max_keys=10000
                )
                for file_info in kb_files:
                    total_size_bytes += file_info.get("size", 0)
            except Exception as e:
                logger.debug(f"统计知识库存储桶时跳过或为空: {bucket_name}, {e}")
            
            # 转换为MB
            total_size_mb = round(total_size_bytes / (1024 * 1024), 2)
            
            return {
                "total_documents": total_documents,
                "total_chunks": total_chunks,
                "total_images": total_images,
                "total_size_mb": total_size_mb,
                "last_updated": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"获取知识库统计失败: {str(e)}")
            return {
                "total_documents": 0,
                "total_chunks": 0,
                "total_images": 0,
                "total_size_mb": 0,
                "last_updated": datetime.utcnow().isoformat()
            }
    
    async def list_kb_files(self, kb_id: str) -> List[Dict[str, Any]]:
        """列出知识库下的文件"""
        try:
            if kb_id not in self._kb_storage:
                return []
            bucket_name = self.minio_adapter.bucket_name_for_kb(kb_id)
            raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
            files = []
            for f in raw_files:
                op = f.get("object_path", "")
                parts = op.split("/")
                if len(parts) < 2:
                    continue
                rest = parts[1]
                under = rest.find("_")
                file_id = rest[:under] if under >= 0 else rest
                name = rest[under + 1:] if under >= 0 else rest
                lm = f.get("last_modified")
                date_str = (lm.isoformat() if lm is not None and hasattr(lm, "isoformat")
                            else str(lm) if lm is not None else "")
                files.append({
                    "id": file_id,
                    "name": name,
                    "size": f.get("size") or 0,
                    "date": date_str,
                    "type": name.rsplit(".", 1)[-1].lower() if "." in name else "file",
                })
            return files
        except Exception as e:
            logger.error(f"列出知识库文件失败: {str(e)}")
            return []

    async def delete_kb_file(self, kb_id: str, file_id: str) -> bool:
        """删除知识库下的单个文件及其向量"""
        try:
            if kb_id not in self._kb_storage:
                return False
            bucket_name = self.minio_adapter.bucket_name_for_kb(kb_id)
            raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
            object_path = None
            for f in raw_files:
                op = f.get("object_path", "")
                if file_id in op and op.startswith(("documents/", "images/")):
                    rest = op.split("/", 1)[1]
                    if rest.startswith(file_id + "_"):
                        object_path = op
                        break
            if not object_path:
                return False
            from qdrant_client.http.models import Filter, FieldCondition, MatchValue
            filt = Filter(must=[
                FieldCondition(key="kb_id", match=MatchValue(value=kb_id)),
                FieldCondition(key="file_id", match=MatchValue(value=file_id)),
            ])
            deleted_chunk_count = 0
            for coll in ["text_chunks", "image_vectors"]:
                try:
                    scroll_result = self.vector_store.client.scroll(
                        collection_name=coll, scroll_filter=filt, limit=10000
                    )
                    point_ids = [p.id for p in (scroll_result[0] or []) if hasattr(p, "id")]
                    if point_ids:
                        deleted_chunk_count += len(point_ids)
                        self.vector_store.client.delete(
                            collection_name=coll,
                            points_selector=models.PointIdsList(points=point_ids),
                        )
                except Exception as ex:
                    logger.warning(f"删除向量失败 {coll}: {ex}")
            await self.minio_adapter.delete_file(bucket_name, object_path)

            # 删除 chunk 计入增量，达到阈值后触发画像重建（与上传逻辑一致）
            if deleted_chunk_count > 0:
                try:
                    from app.core.portrait_trigger import increment_and_maybe_trigger

                    increment_and_maybe_trigger(kb_id, deleted_chunk_count)
                except Exception as trigger_err:
                    logger.warning(f"删除文件后画像增量触发失败 kb_id={kb_id}: {trigger_err}")

            return True
        except Exception as e:
            logger.error(f"删除知识库文件失败: {str(e)}")
            return False

    async def search_knowledge_bases(
        self,
        query: str,
        user_id: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        搜索知识库
        
        支持基于名称和描述的模糊搜索，以及向量相似度搜索
        """
        try:
            if not query or not query.strip():
                # 如果没有查询词，返回所有知识库
                return await self.list_knowledge_bases(user_id=user_id, limit=limit)
            
            query_lower = query.lower().strip()
            all_kbs = await self.list_knowledge_bases(user_id=user_id, limit=1000)  # 获取更多以进行搜索
            
            # 计算每个知识库的匹配分数
            scored_kbs = []
            for kb in all_kbs:
                name = kb.get("name", "").lower()
                description = kb.get("description", "").lower()
                
                score = 0.0
                
                # 名称完全匹配（最高分）
                if name == query_lower:
                    score += 100.0
                # 名称包含查询词
                elif query_lower in name:
                    score += 50.0 + (len(query_lower) / len(name)) * 30.0
                # 名称开头匹配
                elif name.startswith(query_lower):
                    score += 40.0
                
                # 描述包含查询词
                if query_lower in description:
                    score += 20.0 + (len(query_lower) / max(len(description), 1)) * 10.0
                
                # 关键词匹配（按词分割）
                query_words = query_lower.split()
                name_words = name.split()
                desc_words = description.split()
                
                for word in query_words:
                    if word in name_words:
                        score += 10.0
                    if word in desc_words:
                        score += 5.0
                
                if score > 0:
                    scored_kbs.append((score, kb))
            
            # 按分数排序
            scored_kbs.sort(key=lambda x: x[0], reverse=True)
            
            # 返回前limit个结果
            result = [kb for _, kb in scored_kbs[:limit]]
            
            logger.info(f"知识库搜索完成: 查询='{query}', 结果数={len(result)}")
            
            return result
            
        except Exception as e:
            logger.error(f"搜索知识库失败: {str(e)}")
            return []
    
    async def get_kb_content_summary(self, kb_id: str) -> Dict[str, Any]:
        """
        获取知识库内容摘要
        
        基于向量数据库中的实际数据进行分析，提取：
        - 主要主题
        - 内容类型
        - 文件格式
        """
        try:
            from qdrant_client.http.models import Filter, FieldCondition, MatchValue
            
            # 构建过滤条件
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            
            # 获取文本块样本进行分析
            text_scroll_result = self.vector_store.client.scroll(
                collection_name="text_chunks",
                scroll_filter=filter_condition,
                limit=100  # 取前100个样本进行分析
            )
            text_points = text_scroll_result[0]
            
            # 获取图片样本
            image_scroll_result = self.vector_store.client.scroll(
                collection_name="image_vectors",
                scroll_filter=filter_condition,
                limit=50
            )
            image_points = image_scroll_result[0]
            
            # 分析文件格式
            file_formats = set()
            content_types = []
            
            # 从文本块中提取文件格式
            for point in text_points:
                if hasattr(point, 'payload') and point.payload:
                    payload = point.payload if isinstance(point.payload, dict) else {}
                    file_type = payload.get("file_type", "")
                    if file_type:
                        file_formats.add(file_type)
            
            # 从图片中提取格式
            for point in image_points:
                if hasattr(point, 'payload') and point.payload:
                    payload = point.payload if isinstance(point.payload, dict) else {}
                    img_format = payload.get("img_format") or payload.get("image_format", "")
                    if img_format:
                        file_formats.add(img_format)
                    content_types.append("image")
            
            # 统计内容类型
            if text_points:
                content_types.append("document")
            if image_points:
                content_types.append("image")
            
            # 提取主要主题（从文本内容的前几个词）
            main_topics = []
            sample_texts = []
            
            for point in text_points[:10]:  # 取前10个样本
                if hasattr(point, 'payload') and point.payload:
                    payload = point.payload if isinstance(point.payload, dict) else {}
                    text_content = payload.get("text_content", "")
                    if text_content:
                        # 提取前50个字符作为主题线索
                        sample = text_content[:50].strip()
                        if sample:
                            sample_texts.append(sample)
            
            # 从样本文本中提取关键词作为主题
            if sample_texts:
                # 简单的关键词提取：取每个样本的前几个词
                for sample in sample_texts[:5]:  # 最多5个主题
                    words = sample.split()[:3]  # 每个主题最多3个词
                    if words:
                        topic = " ".join(words)
                        if topic not in main_topics:
                            main_topics.append(topic)
            
            # 如果没有找到主题，使用默认值
            if not main_topics:
                main_topics = ["未分类内容"]
            
            return {
                "kb_id": kb_id,
                "main_topics": main_topics[:10],  # 最多返回10个主题
                "content_types": list(set(content_types)),  # 去重
                "file_formats": sorted(list(file_formats)),  # 排序
                "sample_count": len(text_points) + len(image_points),
                "last_analysis": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"获取知识库内容摘要失败: {str(e)}")
            return {
                "kb_id": kb_id,
                "main_topics": [],
                "content_types": [],
                "file_formats": [],
                "sample_count": 0,
                "last_analysis": datetime.utcnow().isoformat(),
                "error": str(e)
            }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            vector_health = await self.vector_store.health_check()
            
            return {
                "status": "healthy" if vector_health.get("status") == "healthy" else "unhealthy",
                "total_knowledge_bases": len(self._kb_storage),
                "components": {
                    "vector_store": vector_health
                }
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }