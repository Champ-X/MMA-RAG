"""
知识库管理服务
负责知识库的CRUD操作和基础管理功能。
知识库列表与元数据仅从 MinIO 获取（按存储桶列出，元数据存于桶标签）。
注意：同一知识库在 MinIO 的 bucket id（桶名去掉 kb- 前缀）与 Qdrant 向量库 payload 中的 kb_id 可能不一致，检索/删除时通过 _kb_id_candidates 与 _discover_kb_id_from_bucket 兼容。
"""

from typing import Dict, List, Any, Optional
import asyncio
import hashlib
import random
import re
import uuid
from datetime import datetime
from dataclasses import dataclass

from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
from qdrant_client.http import models

logger = get_logger(__name__)

# 列文件时忽略的对象路径前缀（MinIO 内系统预览/缓存，非用户上传的素材）
_KB_LIST_IGNORE_OBJECT_PREFIXES = ("previews/",)


def office_preview_cache_object_path(object_path: str, filename: str) -> str:
    """DOCX/PPTX 内联预览写入 MinIO 的路径，与 `stream_file_for_preview` 一致。"""
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    digest = hashlib.sha1(object_path.encode("utf-8")).hexdigest()[:16]
    return f"previews/office_pdf/{digest}_{stem}.pdf"

# MinIO 桶标签键名，用于存储知识库元数据
_TAG_NAME = "name"
_TAG_DESCRIPTION = "description"
_TAG_CREATED_AT = "created_at"
_TAG_UPDATED_AT = "updated_at"
_TAG_USER_ID = "user_id"


@dataclass
class KnowledgeBase:
    """知识库数据类（id 为 MinIO bucket 派生 id，与 Qdrant payload 中的 kb_id 可能不同）"""
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str
    user_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


def _kb_id_from_bucket_name(bucket_name: str) -> Optional[str]:
    """从存储桶名得到知识库 id：kb-xxx -> xxx，非 kb- 前缀的桶忽略（不当作知识库）。"""
    if not bucket_name or bucket_name == "kb-default":
        return None
    if bucket_name.startswith("kb-"):
        return bucket_name[3:]
    return None


def _tags_to_kb(bucket_name: str, tags: Dict[str, str]) -> KnowledgeBase:
    kb_id = _kb_id_from_bucket_name(bucket_name)
    if not kb_id:
        raise ValueError(f"invalid kb bucket name: {bucket_name}")
    now = datetime.utcnow().isoformat()
    return KnowledgeBase(
        id=kb_id,
        name=tags.get(_TAG_NAME) or kb_id,
        description=tags.get(_TAG_DESCRIPTION) or "",
        created_at=tags.get(_TAG_CREATED_AT) or now,
        updated_at=tags.get(_TAG_UPDATED_AT) or now,
        user_id=tags.get(_TAG_USER_ID) or None,
        metadata={},
    )


def _kb_from_meta(bucket_name: str, meta: Dict[str, Any]) -> KnowledgeBase:
    """从桶内 .kb_meta.json 内容构建 KnowledgeBase（支持任意 UTF-8 名称/描述）。"""
    kb_id = _kb_id_from_bucket_name(bucket_name)
    if not kb_id:
        raise ValueError(f"invalid kb bucket name: {bucket_name}")
    now = datetime.utcnow().isoformat()
    return KnowledgeBase(
        id=kb_id,
        name=meta.get("name") or kb_id,
        description=meta.get("description") or "",
        created_at=meta.get("created_at") or now,
        updated_at=meta.get("updated_at") or now,
        user_id=meta.get("user_id") or None,
        metadata={},
    )


# S3/MinIO TagValue：仅允许 ASCII 字母数字、空格及 _ . : / = + - @；空字符串也可能被拒
_TAG_VALUE_ALLOWED_RE = re.compile(r"[^a-zA-Z0-9\s_.:/=+\-@]")


def _sanitize_tag_value(v: Optional[str]) -> str:
    """将字符串消毒为 S3/MinIO 可接受的标签值（仅保留允许字符，空则返回占位）。"""
    if v is None:
        return "-"
    s = str(v).strip()
    s = _TAG_VALUE_ALLOWED_RE.sub(" ", s)
    s = " ".join(s.split())[:256]
    return s if s else "-"  # 空字符串会导致 MinIO TagValue invalid，用占位


def _kb_to_tags(kb: KnowledgeBase) -> Dict[str, str]:
    return {
        _TAG_NAME: _sanitize_tag_value(kb.name),
        _TAG_DESCRIPTION: _sanitize_tag_value(kb.description),
        _TAG_CREATED_AT: _sanitize_tag_value(kb.created_at),
        _TAG_UPDATED_AT: _sanitize_tag_value(kb.updated_at),
        **({_TAG_USER_ID: _sanitize_tag_value(kb.user_id)} if kb.user_id else {}),
    }


class KnowledgeBaseService:
    """知识库管理服务。数据源仅为 MinIO（列桶 + 桶标签），不再使用本地 JSON 文件。"""

    def _load_from_minio(self) -> None:
        """从 MinIO 列出所有 kb- 存储桶；优先用桶内 .kb_meta.json（支持任意 UTF-8），无则用桶标签。"""
        self._kb_storage = {}
        try:
            bucket_names = self.minio_adapter.list_bucket_names()
            for bucket_name in bucket_names:
                kb_id = _kb_id_from_bucket_name(bucket_name)
                if not kb_id:
                    continue
                meta = self.minio_adapter.get_kb_metadata(bucket_name)
                if meta:
                    self._kb_storage[kb_id] = _kb_from_meta(bucket_name, meta)
                else:
                    tags = self.minio_adapter.get_bucket_tags(bucket_name)
                    self._kb_storage[kb_id] = _tags_to_kb(bucket_name, tags)
            logger.info(f"已从 MinIO 加载 {len(self._kb_storage)} 个知识库")
        except Exception as e:
            logger.warning(f"从 MinIO 加载知识库失败，将使用空列表: {e}")
            self._kb_storage = {}

    def _ensure_kb_in_cache(self, kb_id: str) -> bool:
        """若 kb_id 不在缓存中且对应 MinIO 桶存在，则从 .kb_meta.json 或桶标签加载并加入缓存。返回是否在缓存中。"""
        if kb_id in self._kb_storage:
            return True
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        if not self.minio_adapter.bucket_exists(bucket_name):
            return False
        meta = self.minio_adapter.get_kb_metadata(bucket_name)
        if meta:
            self._kb_storage[kb_id] = _kb_from_meta(bucket_name, meta)
        else:
            tags = self.minio_adapter.get_bucket_tags(bucket_name)
            self._kb_storage[kb_id] = _tags_to_kb(bucket_name, tags)
        return True

    def __init__(self):
        self.vector_store = VectorStore()
        self.minio_adapter = MinIOAdapter()
        self._kb_storage: Dict[str, KnowledgeBase] = {}
        self._load_from_minio()
    
    async def create_knowledge_base(
        self,
        name: str,
        description: str,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """创建知识库（在 MinIO 建桶并写入桶标签，不再写本地 JSON）"""
        try:
            kb_id = str(uuid.uuid4())
            now = datetime.utcnow().isoformat()
            kb = KnowledgeBase(
                id=kb_id,
                name=name,
                description=description,
                created_at=now,
                updated_at=now,
                user_id=user_id,
                metadata=metadata or {}
            )
            self._kb_storage[kb_id] = kb
            await self._create_kb_structure(kb_id)
            bucket_name = self.minio_adapter.bucket_name_for_kb(kb_id)
            # 优先用 .kb_meta.json 持久化（任意 UTF-8），重启后可正确加载
            self.minio_adapter.put_kb_metadata(bucket_name, {
                "name": kb.name,
                "description": kb.description,
                "created_at": kb.created_at,
                "updated_at": kb.updated_at,
                **({"user_id": kb.user_id} if kb.user_id else {}),
            })
            try:
                self.minio_adapter.set_bucket_tags(bucket_name, _kb_to_tags(kb))
            except Exception as tag_err:
                logger.debug(f"桶标签写入可选失败（已用 .kb_meta.json 持久化）: {tag_err}")
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
        """获取知识库信息（若不在缓存则从 MinIO 桶标签加载）"""
        try:
            if not self._ensure_kb_in_cache(kb_id):
                return None
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
        """列出知识库（使用内存缓存，避免每次从 MinIO 重载覆盖本进程内已更新的标题/描述）"""
        try:
            # 仅首次或未加载时从 MinIO 拉取；后续列表用内存，保证本进程内编辑后刷新不丢
            if not self._kb_storage:
                self._load_from_minio()
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
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            # 用 .kb_meta.json 持久化名称/描述（任意 UTF-8），重启后可正确加载
            self.minio_adapter.put_kb_metadata(bucket_name, {
                "name": kb.name,
                "description": kb.description,
                "created_at": kb.created_at,
                "updated_at": kb.updated_at,
                **({"user_id": kb.user_id} if kb.user_id else {}),
            })
            try:
                self.minio_adapter.set_bucket_tags(bucket_name, _kb_to_tags(kb))
            except Exception as tag_err:
                logger.debug(f"桶标签写入可选失败（已用 .kb_meta.json 持久化）: {tag_err}")
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
        """删除知识库（以 MinIO 桶存在为准；向量删除会尝试 _kb_id_candidates 以兼容 Qdrant 中不同 kb_id）"""
        try:
            self._ensure_kb_in_cache(kb_id)
            if kb_id not in self._kb_storage:
                return False
            kb = self._kb_storage[kb_id]
            
            # 清理相关数据（MinIO bucket id 与 Qdrant payload kb_id 可能不同，对每个候选都删除向量与画像）
            try:
                candidates = list(self._kb_id_candidates(kb_id))
                try:
                    discovered = await self._discover_kb_id_from_bucket_async(kb_id)
                    if discovered and discovered not in candidates:
                        candidates.append(discovered)
                except Exception as e:
                    logger.debug(f"删除知识库时反查 kb_id 失败(可忽略): {e}")
                for candidate in candidates:
                    try:
                        await self._delete_kb_vectors(candidate)
                        await self.vector_store.delete_kb_portraits(candidate)
                    except Exception as e:
                        logger.warning(f"删除知识库向量/画像失败 candidate={candidate}: {e}")
                
                # 3. 删除MinIO中的文件
                await self._delete_kb_files(kb_id)
                
                logger.info(f"知识库数据清理完成: {kb_id}")
            except Exception as cleanup_error:
                logger.error(f"清理知识库数据时出错: {str(cleanup_error)}")
                # 即使清理失败，也继续删除知识库记录
            
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
        """删除知识库在 text_chunks、image_vectors、audio_vectors、video_vectors 中该 kb_id 的所有向量（按 filter 删除，可靠）。"""
        await self.vector_store.delete_kb_vectors(kb_id)
    
    async def _delete_kb_files(self, kb_id: str):
        """删除知识库在 MinIO 中的所有文件及对应存储桶。"""
        try:
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)

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
    
    def _scroll_kb_points_sync(self, candidate: str, collection: str, limit: int = 10000):
        """同步 scroll 指定集合中某 kb_id 的点，供 run_in_executor 调用。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        filter_condition = Filter(
            must=[FieldCondition(key="kb_id", match=MatchValue(value=candidate))]
        )
        res = self.vector_store.client.scroll(
            collection_name=collection,
            scroll_filter=filter_condition,
            limit=limit,
        )
        return res[0] if res else []

    def _count_kb_points_sync(self, candidate: str) -> tuple:
        """同步按 kb_id 统计 text_chunks 与 image_vectors 数量（使用 count 避免 scroll limit 导致漏统）。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=candidate))])
        try:
            n_text = self.vector_store.client.count(
                collection_name="text_chunks",
                count_filter=filt,
                exact=True,
            ).count
            n_img = self.vector_store.client.count(
                collection_name="image_vectors",
                count_filter=filt,
                exact=True,
            ).count
            return (int(n_text), int(n_img))
        except Exception as e:
            logger.debug(f"count_kb_points_sync 失败 candidate={candidate}: {e}")
            return (0, 0)

    def _scroll_text_chunks_file_ids_sync(self, candidate: str, max_points: int = 100000) -> set:
        """同步滚动 text_chunks 收集文档类文件的 file_id（用于文档数统计）。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue

        def _payload(p) -> dict:
            if p is None:
                return {}
            return p if isinstance(p, dict) else {}

        filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=candidate))])
        file_ids: set = set()
        offset = None
        total_scrolled = 0
        try:
            while total_scrolled < max_points:
                res = self.vector_store.client.scroll(
                    collection_name="text_chunks",
                    scroll_filter=filt,
                    limit=5000,
                    offset=offset,
                    with_payload=True,
                )
                points = res[0] if res else []
                for point in points:
                    payload = _payload(getattr(point, "payload", None))
                    fid = payload.get("file_id")
                    if fid:
                        file_ids.add(fid)
                total_scrolled += len(points)
                offset = res[1] if res and len(res) > 1 else None
                if not points or offset is None:
                    break
            return file_ids
        except Exception as e:
            logger.debug(f"scroll_text_chunks_file_ids_sync 失败 candidate={candidate}: {e}")
            return file_ids

    def _get_stats_by_bucket_files_sync(self, file_ids: List[str]) -> Dict[str, int]:
        """
        按 file_id 列表从向量库汇总统计（不限 kb_id）。
        用于兜底：当 kb_id 候选都无数据时，通过 MinIO 桶内 file_id 汇总。
        """
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue

        total_chunks = 0
        total_images = 0
        doc_file_ids = set()  # 仅统计有 text_chunk 的 file_id（文档类文件）

        for fid in file_ids:
            if not fid:
                continue
            filt = Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=fid))])
            try:
                tc = self.vector_store.client.scroll(
                    collection_name="text_chunks",
                    scroll_filter=filt,
                    limit=5000,
                )
                text_points = tc[0] if tc else []
                if text_points:
                    total_chunks += len(text_points)
                    doc_file_ids.add(fid)

                im = self.vector_store.client.scroll(
                    collection_name="image_vectors",
                    scroll_filter=filt,
                    limit=10000,
                )
                image_points = im[0] if im else []
                if image_points:
                    total_images += len(image_points)
            except Exception:
                pass

        return {
            "total_documents": len(doc_file_ids),
            "total_chunks": total_chunks,
            "total_images": total_images,
        }

    async def _get_kb_statistics(self, kb_id: str) -> Dict[str, Any]:
        """获取知识库统计信息（兼容多种 kb_id 格式，以第一个有数据的为准）。
        文档数 = 有 text_chunk 的 file_id 个数；文本块/图片用 count() 精确统计，避免 scroll limit 漏统。
        优先使用从 MinIO 桶内反查得到的实际 kb_id（解决 Qdrant 中 kb_id 与列表不一致）。
        """
        loop = asyncio.get_event_loop()
        candidates = list(self._kb_id_candidates(kb_id))
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        if bucket_name and self.minio_adapter.bucket_exists(bucket_name):
            discovered = await self._discover_kb_id_from_bucket_async(kb_id)
            if discovered and discovered not in candidates:
                candidates.insert(0, discovered)
        for candidate in candidates:
            try:
                total_chunks, total_images = await loop.run_in_executor(
                    None,
                    lambda c=candidate: self._count_kb_points_sync(c),
                )
                total_audio = await self.vector_store.count_kb_audio(candidate)
                total_video = await self.vector_store.count_kb_video(candidate)
                if total_chunks == 0 and total_images == 0 and total_audio == 0 and total_video == 0:
                    continue

                doc_file_ids = await loop.run_in_executor(
                    None,
                    lambda c=candidate: self._scroll_text_chunks_file_ids_sync(c),
                )
                total_documents = len(doc_file_ids)

                total_size_bytes = 0
                bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
                try:
                    kb_files = await self.minio_adapter.list_files(
                        bucket=bucket_name, prefix="", max_keys=10000
                    )
                    for file_info in kb_files:
                        total_size_bytes += file_info.get("size", 0)
                except Exception as e:
                    logger.debug(f"统计知识库存储桶时跳过或为空: {bucket_name}, {e}")

                total_size_mb = round(total_size_bytes / (1024 * 1024), 2)

                return {
                    "total_documents": total_documents,
                    "total_chunks": total_chunks,
                    "total_images": total_images,
                    "total_audio": total_audio,
                    "total_video": total_video,
                    "total_size_mb": total_size_mb,
                    "last_updated": datetime.utcnow().isoformat(),
                    "text_vector_dim": 4096,
                    "image_vector_dim": 768,
                    "audio_vector_dim": 512,
                }

            except Exception as e:
                logger.debug(f"候选 kb_id={candidate} 统计异常: {e}")
                continue

        # 兜底：按 MinIO 桶内文件的 file_id 汇总统计（向量库 kb_id 可能为原始 UUID，与 JSON 中桶名派生的 kb_id 不一致）
        try:
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            if self.minio_adapter.bucket_exists(bucket_name):
                raw_files = await self.minio_adapter.list_files(
                    bucket=bucket_name, prefix="", max_keys=10000
                )
                file_ids = []
                total_size_bytes = 0
                for f in raw_files:
                    op = f.get("object_path", "")
                    parts = op.split("/")
                    if len(parts) >= 2:
                        rest = parts[1]
                        under = rest.find("_")
                        fid = rest[:under] if under >= 0 else rest
                        file_ids.append(fid)
                    total_size_bytes += f.get("size") or 0

                if file_ids:
                    fallback = await loop.run_in_executor(
                        None,
                        lambda: self._get_stats_by_bucket_files_sync(file_ids),
                    )
                    if fallback["total_chunks"] > 0 or fallback["total_images"] > 0:
                        total_size_mb = round(total_size_bytes / (1024 * 1024), 2)
                        total_audio_fb = await self.vector_store.count_kb_audio(kb_id)
                        total_video_fb = await self.vector_store.count_kb_video(kb_id)
                        logger.debug(f"通过 MinIO 桶文件兜底获取统计: kb_id={kb_id}")
                        return {
                            "total_documents": fallback["total_documents"],
                            "total_chunks": fallback["total_chunks"],
                            "total_images": fallback["total_images"],
                            "total_audio": total_audio_fb,
                            "total_video": total_video_fb,
                            "total_size_mb": total_size_mb,
                            "last_updated": datetime.utcnow().isoformat(),
                            "text_vector_dim": 4096,
                            "image_vector_dim": 768,
                            "audio_vector_dim": 512,
                        }
        except Exception as e:
            logger.debug(f"统计兜底失败 kb_id={kb_id}: {e}")

        return {
            "total_documents": 0,
            "total_chunks": 0,
            "total_images": 0,
            "total_audio": 0,
            "total_video": 0,
            "total_size_mb": 0,
            "last_updated": datetime.utcnow().isoformat(),
            "text_vector_dim": 4096,
            "image_vector_dim": 768,
            "audio_vector_dim": 512,
        }

    def _discover_kb_id_from_bucket_sync(self, bucket_name: str) -> Optional[str]:
        """
        从 MinIO 桶内文件反查 Qdrant 中实际存在的 kb_id。
        如果桶内文件对应多个 kb_id，返回数据量最大的那个（解决历史数据迁移/ID变更问题）。
        """
        try:
            from collections import defaultdict
            raw = list(
                self.minio_adapter.client.list_objects(
                    bucket_name, prefix=None, recursive=True
                )
            )
            
            # 统计每个 kb_id 的出现次数（采样文件），含 text / image / audio / video，以便纯视频/纯音频库也能反查到 Qdrant 中的 kb_id
            kb_id_counts = defaultdict(lambda: {"text": 0, "image": 0, "audio": 0, "video": 0})
            sampled_file_ids = set()
            
            for obj in raw[:80]:  # 采样前 80 个文件（含 videos/uuid/keyframes/ 下多条）
                op = obj.object_name
                parts = op.split("/")
                if len(parts) < 2:
                    continue
                # 文档/图片: documents/fileid_xxx 或 images/fileid_xxx；视频: videos/uuid/keyframes/xxx -> file_id=uuid
                rest = parts[1]
                under = rest.find("_")
                fid = rest[:under] if under >= 0 else rest
                if not fid or fid in sampled_file_ids:
                    continue
                sampled_file_ids.add(fid)
                
                from qdrant_client.http.models import Filter, FieldCondition, MatchValue
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
                        kid = p.get("kb_id")
                        if kid:
                            kb_id_counts[kid]["text"] += 1
                except Exception:
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
                        kid = p.get("kb_id")
                        if kid:
                            kb_id_counts[kid]["image"] += 1
                except Exception:
                    pass
                
                # audio_vectors（纯音频库时也需反查到 Qdrant 中的 kb_id）
                try:
                    res = self.vector_store.client.scroll(
                        collection_name="audio_vectors",
                        scroll_filter=filt,
                        limit=1,
                        with_payload=True,
                    )
                    points = res[0] if res else []
                    if points:
                        p = getattr(points[0], "payload", None) or {}
                        kid = p.get("kb_id")
                        if kid:
                            kb_id_counts[kid]["audio"] += 1
                except Exception:
                    pass
                
                # video_vectors（纯视频库时也需反查到 Qdrant 中的 kb_id，路径 videos/uuid/keyframes/xxx 中 fid=uuid）
                try:
                    res = self.vector_store.client.scroll(
                        collection_name="video_vectors",
                        scroll_filter=filt,
                        limit=1,
                        with_payload=True,
                    )
                    points = res[0] if res else []
                    if points:
                        p = getattr(points[0], "payload", None) or {}
                        kid = p.get("kb_id")
                        if kid:
                            kb_id_counts[kid]["video"] += 1
                except Exception:
                    pass
            
            # 返回数据量最大的 kb_id（优先 text > image > audio > video）
            if kb_id_counts:
                best_kb_id = max(
                    kb_id_counts.items(),
                    key=lambda x: (x[1]["text"], x[1]["image"], x[1]["audio"], x[1]["video"])
                )[0]
                c = kb_id_counts[best_kb_id]
                logger.debug(
                    "桶 %s 反查到数据量最大的 kb_id: %s (采样 text:%s, image:%s, audio:%s, video:%s)",
                    bucket_name, best_kb_id, c["text"], c["image"], c["audio"], c["video"]
                )
                return best_kb_id
                
        except Exception as e:
            logger.debug(f"从桶反查 kb_id 失败 {bucket_name}: {e}")
        return None

    async def _discover_kb_id_from_bucket_async(self, kb_id: str) -> Optional[str]:
        """从 MinIO 桶内文件反查向量中的实际 kb_id（异步封装）。"""
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        if not self.minio_adapter.bucket_exists(bucket_name):
            return None
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self._discover_kb_id_from_bucket_sync(bucket_name),
        )

    async def get_kb_portraits_with_fallback(self, kb_id: str) -> List[Dict[str, Any]]:
        """获取知识库画像，兼容多种 kb_id 格式。若候选都无数据，则从 MinIO 桶内文件反查实际 kb_id 再查画像。"""
        for candidate in self._kb_id_candidates(kb_id):
            try:
                portraits = await self.vector_store.search_kb_portraits(candidate, limit=100)
                if portraits:
                    return portraits
            except Exception as e:
                logger.debug(f"候选 kb_id={candidate} 画像查询异常: {e}")

        # 兜底：从 MinIO 桶内文件反查向量中的实际 kb_id
        try:
            discovered = await self._discover_kb_id_from_bucket_async(kb_id)
            if discovered:
                portraits = await self.vector_store.search_kb_portraits(discovered, limit=100)
                if portraits:
                    logger.debug(f"通过桶反查获取画像: kb_id={kb_id} -> discovered={discovered}")
                    return portraits
        except Exception as e:
            logger.debug(f"画像兜底失败 kb_id={kb_id}: {e}")
        return []

    def _kb_id_candidates(self, kb_id: str) -> List[str]:
        """
        返回查询向量库时可尝试的 kb_id 候选列表，兼容历史数据中可能使用的不同格式。
        - 当前约定：kb_id（如 xxx，对应桶 kb-xxx）
        - 兼容：桶名（kb-xxx）可能在旧数据中作为 kb_id 存储
        - 兼容：将桶名中的 - 替换为 _（如 test_kb_kb1）以匹配测试/旧格式
        - 兼容：桶名去掉 kb- 前缀（与恢复逻辑一致）
        """
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        candidates = [kb_id]
        if bucket_name and bucket_name not in candidates:
            candidates.append(bucket_name)
        alt = bucket_name.replace("-", "_") if bucket_name else None
        if alt and alt not in candidates:
            candidates.append(alt)
        # 桶名去掉 kb- 前缀，与 _recover_from_minio 的 kb_id 一致
        if bucket_name and bucket_name.startswith("kb-"):
            without_prefix = bucket_name[3:]
            if without_prefix and without_prefix not in candidates:
                candidates.append(without_prefix)
        return candidates

    def _is_previewable_type(self, ext: str) -> bool:
        """判断文件类型是否支持预览（图片、PDF、MD、TXT）"""
        return ext.lower() in ("jpg", "jpeg", "png", "gif", "webp", "tiff", "tif", "pdf", "md", "txt")

    def _is_image_type(self, ext: str) -> bool:
        """判断是否为图片类型（用于封面展示）"""
        return ext.lower() in ("jpg", "jpeg", "png", "gif", "webp", "tiff", "tif")

    async def get_file_text_content(self, kb_id: str, file_id: str) -> Optional[str]:
        """
        获取文本类文件（md/txt）的原始内容，用于预览（避免 iframe 触发下载）。
        从 MinIO 读取并解码为 UTF-8 文本。对 md 文件会将文档内图片的本地路径替换为 MinIO 预签名 URL，便于前端正常显示图片。
        """
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        if not self.minio_adapter.bucket_exists(bucket_name):
            return None
        raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
        object_path = None
        for f in raw_files:
            op = f.get("object_path", "")
            if file_id in op and op.startswith("documents/"):
                rest = op.split("/", 1)[1]
                if rest.startswith(file_id + "_"):
                    object_path = op
                    break
        if not object_path:
            return None
        try:
            content = await self.minio_adapter.get_file_content(bucket_name, object_path)
            content = content.decode("utf-8", errors="replace")
        except Exception as e:
            logger.debug("读取文件内容失败 {}: {}", object_path, e)
            return None
        # 对 md：将正文中的图片引用（本地路径）替换为已上传到 MinIO 的图片预签名 URL，以便预览时能显示
        if object_path.lower().endswith(".md") or object_path.lower().endswith(".markdown"):
            loop = asyncio.get_event_loop()
            image_points = await loop.run_in_executor(
                None,
                lambda: self._scroll_image_points_by_source_file_id(kb_id, file_id),
            )
            for point in image_points:
                payload = getattr(point, "payload", None) or {}
                ref = (payload.get("markdown_ref") or "").strip()
                img_path = (payload.get("file_path") or "").strip()
                if not ref or not img_path:
                    continue
                try:
                    url = await self.minio_adapter.get_presigned_url(bucket_name, img_path, expires_hours=24)
                    # 保持 ![alt](...) 结构，仅将括号内路径换为 URL
                    new_ref = re.sub(r"\]\s*\(\s*[^)]+\s*\)", "](" + url + ")", ref, count=1)
                    content = content.replace(ref, new_ref, 1)
                except Exception as e:
                    logger.debug("生成图片预签名 URL 失败 {}: {}", img_path, e)
                    continue
        return content

    def _scroll_image_points_by_file_id(self, file_id: str):
        """按 file_id 全局查询 image_vectors（不限制 kb_id），用于兜底。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        filt = Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))])
        res = self.vector_store.client.scroll(
            collection_name="image_vectors",
            scroll_filter=filt,
            limit=1,
            with_payload=True,
        )
        return res[0] if res else []

    def _scroll_image_points_by_source_file_id(self, kb_id: str, source_file_id: str) -> List[Any]:
        """按 source_file_id 查询该文档关联的图片向量（含 markdown_ref、file_path），用于 md 预览时替换图片 URL。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        for candidate in self._kb_id_candidates(kb_id):
            try:
                filt = Filter(
                    must=[
                        FieldCondition(key="kb_id", match=MatchValue(value=candidate)),
                        FieldCondition(key="source_file_id", match=MatchValue(value=source_file_id)),
                    ]
                )
                res = self.vector_store.client.scroll(
                    collection_name="image_vectors",
                    scroll_filter=filt,
                    limit=100,
                    with_payload=True,
                )
                points = res[0] if res else []
                if points:
                    return points
            except Exception as e:
                logger.debug("按 source_file_id 查询图片失败 candidate={}: {}", candidate, e)
                continue
        return []

    def _scroll_image_points(self, candidate: str, file_id: str, with_file_filter: bool):
        """同步 scroll image_vectors，在线程中调用以避免阻塞事件循环。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        must: List[Any] = [FieldCondition(key="kb_id", match=MatchValue(value=candidate))]
        if with_file_filter:
            must.append(FieldCondition(key="file_id", match=MatchValue(value=file_id)))
        filt = Filter(must=must)
        res = self.vector_store.client.scroll(
            collection_name="image_vectors",
            scroll_filter=filt,
            limit=100 if not with_file_filter else 1,
            with_payload=True,
        )
        return res[0] if res else []

    def _scroll_text_points(self, candidate: str, file_id: str):
        """同步 scroll text_chunks，在线程中调用。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        filt = Filter(
            must=[
                FieldCondition(key="kb_id", match=MatchValue(value=candidate)),
                FieldCondition(key="file_id", match=MatchValue(value=file_id)),
            ]
        )
        res = self.vector_store.client.scroll(
            collection_name="text_chunks",
            scroll_filter=filt,
            limit=200,
            with_payload=True,
        )
        return res[0] if res else []

    def _scroll_text_points_by_file_id(self, file_id: str):
        """按 file_id 全局查询 text_chunks（不限制 kb_id），用于兜底。"""
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue
        filt = Filter(must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))])
        res = self.vector_store.client.scroll(
            collection_name="text_chunks",
            scroll_filter=filt,
            limit=200,
            with_payload=True,
        )
        return res[0] if res else []

    async def get_file_preview_details(
        self, kb_id: str, file_id: str
    ) -> Dict[str, Any]:
        """
        获取文件预览详情：caption（图片）、chunks（文档）、text_preview（文本类）。
        兼容多种 kb_id 格式，以第一个有数据的候选为准。
        不依赖 _kb_storage，直接按候选查询向量库，以支持已有知识库中的文件。
        图片描述：先按 (kb_id, file_id) 查；若所有候选都无结果，则直接按 file_id 全局查。
        """
        result: Dict[str, Any] = {"caption": None, "chunks": [], "text_preview": None, "transcript": None, "description": None}
        from qdrant_client.http.models import Filter, FieldCondition, MatchValue

        def _payload(p) -> Dict[str, Any]:
            if p is None:
                return {}
            return p if isinstance(p, dict) else {}

        loop = asyncio.get_event_loop()

        # 关键帧：file_id 为 object_path（videos/{uuid}/keyframes/xxx.jpg），从 video_vectors 取 scene_summary + frame_description 作为图片描述
        if file_id.startswith("videos/") and "/keyframes/" in file_id:
            for candidate in self._kb_id_candidates(kb_id):
                try:
                    video_points = await loop.run_in_executor(
                        None,
                        lambda c=candidate: self.vector_store.scroll_video_points_by_frame_image_path(file_id, c, limit=1),
                    )
                    if video_points:
                        p = _payload(getattr(video_points[0], "payload", None))
                        scene_summary = (p.get("scene_summary") or "").strip()
                        frame_description = (p.get("frame_description") or "").strip()
                        if scene_summary or frame_description:
                            result["caption"] = (scene_summary + ("\n\n" if scene_summary and frame_description else "") + frame_description).strip() or None
                            result["description"] = frame_description or None
                            return result
                except Exception as e:
                    logger.debug(f"获取关键帧预览详情失败 candidate={candidate} {kb_id}/{file_id}: {e}")
            if not result["caption"]:
                try:
                    video_points = await loop.run_in_executor(
                        None,
                        lambda: self.vector_store.scroll_video_points_by_frame_image_path(file_id, None, limit=1),
                    )
                    if video_points:
                        p = _payload(getattr(video_points[0], "payload", None))
                        scene_summary = (p.get("scene_summary") or "").strip()
                        frame_description = (p.get("frame_description") or "").strip()
                        if scene_summary or frame_description:
                            result["caption"] = (scene_summary + ("\n\n" if scene_summary and frame_description else "") + frame_description).strip() or None
                            result["description"] = frame_description or None
                            logger.debug(f"通过 frame_image_path 全局查询找到关键帧描述: {file_id}")
                            return result
                except Exception as e:
                    logger.debug(f"frame_image_path 全局查询关键帧描述失败 {file_id}: {e}")

        # 视频主文件：file_id 为 uuid（无斜杠），从 video_vectors 拉取所有点，按 segment 顺序拼接全部 scene_summary 作为视频描述
        if "/" not in file_id:
            def _video_description_for(file_id: str, kb_id: Optional[str]) -> Optional[str]:
                points = self.vector_store.scroll_video_points_by_file_id(file_id, kb_id, limit=500)
                if not points:
                    return None
                # 按 segment_id、frame_timestamp 排序，同一 segment 只保留一条 scene_summary，再按序拼接
                ordered: List[tuple] = []
                for pt in points:
                    p = _payload(getattr(pt, "payload", None))
                    seg = p.get("segment_id") or ""
                    ft = p.get("frame_timestamp")
                    ts = float(ft) if ft is not None else 0.0
                    summary = (p.get("scene_summary") or "").strip()
                    if summary:
                        ordered.append((seg, ts, summary))
                ordered.sort(key=lambda x: (x[0], x[1]))
                seen_seg: set = set()
                summaries: List[str] = []
                for seg, _ts, summary in ordered:
                    if seg not in seen_seg:
                        seen_seg.add(seg)
                        summaries.append(summary)
                return "\n\n".join(summaries).strip() or None

            for candidate in self._kb_id_candidates(kb_id):
                try:
                    desc = await loop.run_in_executor(
                        None,
                        lambda c=candidate: _video_description_for(file_id, c),
                    )
                    if desc:
                        result["caption"] = desc
                        result["description"] = desc
                        return result
                except Exception as e:
                    logger.debug(f"获取视频主文件预览详情失败 candidate={candidate} {kb_id}/{file_id}: {e}")
            try:
                desc = await loop.run_in_executor(
                    None,
                    lambda: _video_description_for(file_id, None),
                )
                if desc:
                    result["caption"] = desc
                    result["description"] = desc
                    logger.debug(f"通过 file_id 全局查询找到视频描述: {file_id}")
                    return result
            except Exception as e:
                logger.debug(f"file_id 全局查询视频描述失败 {file_id}: {e}")

        # 第一轮：按 kb_id 候选 + file_id 查询
        for candidate in self._kb_id_candidates(kb_id):
            try:
                img_points = await loop.run_in_executor(
                    None,
                    lambda c=candidate: self._scroll_image_points(c, file_id, with_file_filter=True),
                )
                if img_points:
                    payload = _payload(getattr(img_points[0], "payload", None))
                    result["caption"] = (
                        (payload.get("caption") or payload.get("description") or "").strip()
                    ) or None

                text_points = await loop.run_in_executor(
                    None,
                    lambda c=candidate: self._scroll_text_points(c, file_id),
                )
                chunks_raw = []
                for r in text_points:
                    p = _payload(getattr(r, "payload", None))
                    text = (p.get("text_content") or "").strip()
                    idx = p.get("chunk_index", len(chunks_raw))
                    if text:
                        chunks_raw.append((idx, text))
                chunks_raw.sort(key=lambda x: x[0])
                result["chunks"] = [{"index": i + 1, "text": t} for i, (_, t) in enumerate(chunks_raw)]

                if result["chunks"] and not result["caption"]:
                    result["text_preview"] = "\n\n".join(c["text"] for c in result["chunks"])

                if result["caption"] or result["chunks"]:
                    return result
            except Exception as e:
                logger.debug(f"获取文件预览详情失败 candidate={candidate} {kb_id}/{file_id}: {e}")

        # 第二轮兜底：直接按 file_id 全局查（不限 kb_id），适用于 kb_id 不一致的历史数据
        if not result["caption"]:
            try:
                img_points = await loop.run_in_executor(
                    None,
                    lambda: self._scroll_image_points_by_file_id(file_id),
                )
                if img_points:
                    payload = _payload(getattr(img_points[0], "payload", None))
                    result["caption"] = (
                        (payload.get("caption") or payload.get("description") or "").strip()
                    ) or None
                    logger.debug(f"通过 file_id 全局查询找到图片描述: {file_id}")
            except Exception as e:
                logger.debug(f"file_id 全局查询失败 {file_id}: {e}")

        # 文档 chunks 兜底：若第一轮未获取到，按 file_id 全局查
        if not result["chunks"]:
            try:
                text_points = await loop.run_in_executor(
                    None,
                    lambda: self._scroll_text_points_by_file_id(file_id),
                )
                chunks_raw = []
                for r in text_points:
                    p = _payload(getattr(r, "payload", None))
                    text = (p.get("text_content") or "").strip()
                    idx = p.get("chunk_index", len(chunks_raw))
                    if text:
                        chunks_raw.append((idx, text))
                chunks_raw.sort(key=lambda x: x[0])
                result["chunks"] = [{"index": i + 1, "text": t} for i, (_, t) in enumerate(chunks_raw)]
                if result["chunks"]:
                    result["text_preview"] = "\n\n".join(c["text"] for c in result["chunks"])
                    logger.debug(f"通过 file_id 全局查询找到文档分块: {file_id}")
            except Exception as e:
                logger.debug(f"file_id 全局查询 text_chunks 失败 {file_id}: {e}")

        # 音频预览：从 audio_vectors 取 transcript、description，供前端展示（参考图片 caption）
        for candidate in self._kb_id_candidates(kb_id):
            try:
                audio_points = await loop.run_in_executor(
                    None,
                    lambda c=candidate: self.vector_store.scroll_audio_points_by_file_id(c, file_id, limit=1),
                )
                if audio_points:
                    p = _payload(getattr(audio_points[0], "payload", None))
                    result["transcript"] = (p.get("transcript") or "").strip() or None
                    result["description"] = (p.get("description") or "").strip() or None
                    if result["description"] or result["transcript"]:
                        desc = (result["description"] or "") + ("\n\n" if result["description"] and result["transcript"] else "") + (result["transcript"] or "")
                        result["caption"] = result["caption"] or desc.strip() or None
                    break
            except Exception as e:
                logger.debug(f"获取音频预览详情失败 candidate={candidate} {kb_id}/{file_id}: {e}")
        if not result["transcript"] and not result["description"]:
            try:
                audio_points = await loop.run_in_executor(
                    None,
                    lambda: self.vector_store.scroll_audio_points_by_file_id(None, file_id, limit=1),
                )
                if audio_points:
                    p = _payload(getattr(audio_points[0], "payload", None))
                    result["transcript"] = (p.get("transcript") or "").strip() or None
                    result["description"] = (p.get("description") or "").strip() or None
                    if result["description"] or result["transcript"]:
                        desc = (result["description"] or "") + ("\n\n" if result["description"] and result["transcript"] else "") + (result["transcript"] or "")
                        result["caption"] = result["caption"] or desc.strip() or None
                    logger.debug(f"通过 file_id 全局查询找到音频预览: {file_id}")
            except Exception as e:
                logger.debug(f"file_id 全局查询音频预览失败 {file_id}: {e}")

        return result

    async def list_kb_files(self, kb_id: str) -> List[Dict[str, Any]]:
        """列出知识库下的文件，图片和 PDF 附带 preview_url。不依赖 _kb_storage，按 kb_id 解析桶名以支持已有知识库。
        若传入的 kb_id 对应桶不存在，则尝试候选 kb_id 的桶（兼容前端/API 传入的格式与 MinIO 实际桶名不一致）。"""
        raw_files: List[Dict[str, Any]] = []
        bucket_used: Optional[str] = None
        bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
        if self.minio_adapter.bucket_exists(bucket_name):
            try:
                raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
                bucket_used = bucket_name
            except Exception as e:
                logger.debug(f"列出桶 {bucket_name} 失败: {e}")
        if not raw_files:
            for candidate in self._kb_id_candidates(kb_id):
                if candidate == kb_id:
                    continue
                try:
                    cand_bucket = self.minio_adapter.get_bucket_for_kb(candidate)
                    if self.minio_adapter.bucket_exists(cand_bucket):
                        raw_files = await self.minio_adapter.list_files(bucket=cand_bucket, prefix="", max_keys=1000)
                        if raw_files:
                            bucket_used = cand_bucket
                            logger.debug(f"列出文件使用候选桶: kb_id={kb_id} -> candidate={candidate}, bucket={cand_bucket}")
                            break
                except Exception as e:
                    logger.debug(f"候选 kb_id={candidate} 列出文件失败: {e}")
        try:
            # 构建「视频 uuid -> 视频文件名（无扩展名）」映射，用于关键帧展示名加前缀以区分所属视频
            video_uuid_to_basename: Dict[str, str] = {}
            for f in raw_files:
                op = f.get("object_path", "")
                parts = op.split("/")
                if parts[0] == "videos" and len(parts) == 2 and "_" in parts[1]:
                    uid, fname = parts[1].split("_", 1)
                    video_uuid_to_basename[uid] = fname.rsplit(".", 1)[0] if "." in fname else fname
            files = []
            for f in raw_files:
                op = f.get("object_path", "")
                if any(op.startswith(p) for p in _KB_LIST_IGNORE_OBJECT_PREFIXES):
                    continue
                parts = op.split("/")
                if len(parts) < 2:
                    continue
                lm = f.get("last_modified")
                date_str = (lm.isoformat() if lm is not None and hasattr(lm, "isoformat")
                            else str(lm) if lm is not None else "")
                # 关键帧：videos/{file_id}/keyframes/{filename}.jpg，展示为图片；name 加视频名前缀便于区分所属视频
                if (parts[0] == "videos" and len(parts) >= 4 and parts[2] == "keyframes"):
                    file_id = parts[1]
                    frame_fname = parts[-1]
                    video_basename = video_uuid_to_basename.get(file_id)
                    name = f"{video_basename}_{frame_fname}" if video_basename else frame_fname
                    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "file"
                    item = {
                        "id": op,
                        "name": name,
                        "size": f.get("size") or 0,
                        "date": date_str,
                        "type": ext,
                    }
                else:
                    rest = parts[1]
                    under = rest.find("_")
                    file_id = rest[:under] if under >= 0 else rest
                    name = rest[under + 1:] if under >= 0 else rest
                    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "file"
                    item = {
                        "id": file_id,
                        "name": name,
                        "size": f.get("size") or 0,
                        "date": date_str,
                        "type": ext,
                    }
                if self._is_previewable_type(ext) and bucket_used:
                    try:
                        item["preview_url"] = await self.minio_adapter.get_presigned_url(
                            bucket_used, op, expires_hours=24
                        )
                    except Exception as e:
                        logger.debug(f"生成预览 URL 失败 {op}: {e}")
                files.append(item)
            return files
        except Exception as e:
            logger.error(f"列出知识库文件失败: {str(e)}")
            return []

    async def get_file_stream_info(self, kb_id: str, file_id: str) -> Optional[tuple[str, str, str]]:
        """获取用于流式预览的文件信息，返回 (bucket_name, object_path, filename) 或 None。
        支持关键帧 object_path（videos/.../keyframes/xxx.jpg）、documents/、audios/、videos/ 主文件。"""
        try:
            # 关键帧：file_id 即为 object_path
            if file_id.startswith("videos/") and "/keyframes/" in file_id:
                bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
                if not bucket_name:
                    return None
                filename = file_id.rsplit("/", 1)[-1] if "/" in file_id else file_id
                return (bucket_name, file_id, filename)
            if not self._ensure_kb_in_cache(kb_id):
                return None
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
            for f in raw_files:
                op = f.get("object_path", "")
                if not op.startswith(("documents/", "audios/", "videos/")):
                    continue
                rest = op.split("/", 1)[1] if "/" in op else ""
                if not rest.startswith(file_id + "_"):
                    continue
                name = rest[len(file_id) + 1:] if len(rest) > len(file_id) + 1 else rest
                return (bucket_name, op, name)
            return None
        except Exception as e:
            logger.debug(f"获取文件流信息失败 {kb_id}/{file_id}: {e}")
            return None

    async def get_random_cover_url(self, kb_id: str) -> Optional[str]:
        """从知识库中随机取一张图片或视频关键帧的预览 URL 作为封面。
        优先使用 images/ 下的图片；若无图片但有视频关键帧（videos/.../keyframes/*.jpg 等），则随机取一张关键帧作为封面。"""
        try:
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=500)
            image_objects: List[str] = []
            keyframe_objects: List[str] = []
            for f in raw_files:
                op = f.get("object_path", "")
                parts = op.split("/")
                if len(parts) < 2:
                    continue
                # 1) images/ 下的图片：parts[1] 为文件名
                rest = parts[1]
                under = rest.find("_")
                name = rest[under + 1:] if under >= 0 else rest
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
                if self._is_image_type(ext):
                    image_objects.append(op)
                    continue
                # 2) 视频关键帧：videos/{uuid}/keyframes/xxx.jpg
                if op.startswith("videos/") and "/keyframes/" in op:
                    last_seg = parts[-1]
                    kf_ext = last_seg.rsplit(".", 1)[-1].lower() if "." in last_seg else ""
                    if self._is_image_type(kf_ext):
                        keyframe_objects.append(op)
            # 优先用图片，没有图片则用视频关键帧
            candidates = image_objects if image_objects else keyframe_objects
            if not candidates:
                return None
            chosen = random.choice(candidates)
            return await self.minio_adapter.get_presigned_url(
                bucket_name, chosen, expires_hours=24
            )
        except Exception as e:
            logger.debug(f"获取知识库封面图失败 {kb_id}: {e}")
            return None

    async def delete_kb_file(self, kb_id: str, file_id: str) -> bool:
        """删除知识库下的单个文件及其向量（以 MinIO 桶存在为准）。先删向量再删 MinIO，向量删除失败则不删 MinIO。
        若 file_id 为关键帧的 object_path（形如 videos/xxx/keyframes/seg_0_80_0.jpg），则仅删除该 MinIO 对象。"""
        try:
            if not self._ensure_kb_in_cache(kb_id):
                return False
            bucket_name = self.minio_adapter.get_bucket_for_kb(kb_id)
            # 关键帧单项删除：前端传入的 id 为 object_path
            if file_id.startswith("videos/") and "/keyframes/" in file_id:
                try:
                    await self.minio_adapter.delete_file(bucket_name, file_id)
                    return True
                except Exception as e:
                    logger.warning("删除关键帧 MinIO 对象失败 {}: {}", file_id, e)
                    return False
            raw_files = await self.minio_adapter.list_files(bucket=bucket_name, prefix="", max_keys=1000)
            # 收集该 file_id 在 MinIO 下的所有对象：文档、图片、音频、视频（含 videos/{file_id}/keyframes/）
            object_paths: List[str] = []
            for f in raw_files:
                op = f.get("object_path", "")
                rest = op.split("/", 1)[1] if "/" in op else op
                if op.startswith("documents/") or op.startswith("images/"):
                    if rest.startswith(file_id + "_"):
                        object_paths.append(op)
                        continue
                    if op.startswith("images/") and file_id in rest and "_page" in rest and "_img" in rest:
                        object_paths.append(op)
                elif op.startswith("audios/") and rest.startswith(file_id + "_"):
                    object_paths.append(op)
                elif op.startswith("videos/"):
                    if rest.startswith(file_id + "_") or rest.startswith(file_id + "/"):
                        object_paths.append(op)
            if not object_paths:
                return False

            # 与 delete_knowledge_base / 统计一致：合并桶内反查的 kb_id，避免 Qdrant payload 与候选列表不一致时 delete 命中 0 点仍计为成功、进而只删 MinIO
            vector_kb_candidates: List[str] = list(dict.fromkeys(self._kb_id_candidates(kb_id)))
            try:
                discovered_pre = await self._discover_kb_id_from_bucket_async(kb_id)
                if discovered_pre and discovered_pre not in vector_kb_candidates:
                    vector_kb_candidates.append(discovered_pre)
            except Exception as e:
                logger.debug(f"删除文件前反查 kb_id 失败(可忽略): {e}")

            # 先删除向量库中该文件对应的向量（按 filter 删除）；若全部失败则不删 MinIO
            from qdrant_client.http.models import Filter, FieldCondition, MatchValue, FilterSelector
            deleted_chunk_count = 0
            for candidate in vector_kb_candidates:
                filt_text = Filter(must=[
                    FieldCondition(key="kb_id", match=MatchValue(value=candidate)),
                    FieldCondition(key="file_id", match=MatchValue(value=file_id)),
                ])
                filt_image = Filter(
                    must=[FieldCondition(key="kb_id", match=MatchValue(value=candidate))],
                    should=[
                        FieldCondition(key="file_id", match=MatchValue(value=file_id)),
                        FieldCondition(key="source_file_id", match=MatchValue(value=file_id)),
                    ],
                )
                try:
                    self.vector_store.client.delete(
                        collection_name="text_chunks",
                        points_selector=FilterSelector(filter=filt_text),
                    )
                    deleted_chunk_count += 1
                except Exception as del_e:
                    logger.warning(f"删除文件文本向量失败 candidate={candidate}: {del_e}")
                try:
                    self.vector_store.client.delete(
                        collection_name="image_vectors",
                        points_selector=FilterSelector(filter=filt_image),
                    )
                    deleted_chunk_count += 1
                except Exception as del_e:
                    logger.warning(f"删除文件图片向量失败 candidate={candidate}: {del_e}")
                try:
                    self.vector_store.client.delete(
                        collection_name="audio_vectors",
                        points_selector=FilterSelector(filter=filt_text),
                    )
                    deleted_chunk_count += 1
                except Exception as del_e:
                    logger.warning(f"删除文件音频向量失败 candidate={candidate}: {del_e}")
                if self.vector_store.delete_video_points_by_file_id(candidate, file_id):
                    deleted_chunk_count += 1

            # 兜底：不限定 kb_id（与预览详情中按 file_id 全局 scroll 一致），清除候选 kb_id 均未覆盖时的残留点
            filt_by_file_id = Filter(
                must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))]
            )
            try:
                self.vector_store.client.delete(
                    collection_name="text_chunks",
                    points_selector=FilterSelector(filter=filt_by_file_id),
                )
                deleted_chunk_count += 1
            except Exception as del_e:
                logger.warning(f"删除文件文本向量(按 file_id 全局)失败 file_id={file_id}: {del_e}")
            try:
                self.vector_store.client.delete(
                    collection_name="image_vectors",
                    points_selector=FilterSelector(filter=filt_by_file_id),
                )
                deleted_chunk_count += 1
            except Exception as del_e:
                logger.warning(f"删除文件图片向量(按 file_id 全局)失败 file_id={file_id}: {del_e}")
            try:
                filt_by_src = Filter(
                    must=[FieldCondition(key="source_file_id", match=MatchValue(value=file_id))]
                )
                self.vector_store.client.delete(
                    collection_name="image_vectors",
                    points_selector=FilterSelector(filter=filt_by_src),
                )
                deleted_chunk_count += 1
            except Exception as del_e:
                logger.warning(
                    f"删除文件图片向量(按 source_file_id 全局)失败 file_id={file_id}: {del_e}"
                )
            try:
                self.vector_store.client.delete(
                    collection_name="audio_vectors",
                    points_selector=FilterSelector(filter=filt_by_file_id),
                )
                deleted_chunk_count += 1
            except Exception as del_e:
                logger.warning(f"删除文件音频向量(按 file_id 全局)失败 file_id={file_id}: {del_e}")
            if self.vector_store.delete_video_points_by_file_id(None, file_id):
                deleted_chunk_count += 1

            if deleted_chunk_count == 0:
                logger.error(f"删除文件向量全部失败，不删除 MinIO 对象 kb_id={kb_id} file_id={file_id}")
                return False

            minio_delete_targets = list(object_paths)
            for op in object_paths:
                if not op.startswith("documents/"):
                    continue
                rest = op.split("/", 1)[1] if "/" in op else ""
                if not rest.startswith(file_id + "_"):
                    continue
                display_name = rest[len(file_id) + 1 :] if len(rest) > len(file_id) + 1 else rest
                ext = display_name.rsplit(".", 1)[-1].lower() if "." in display_name else ""
                if ext in ("docx", "pptx"):
                    p = office_preview_cache_object_path(op, display_name)
                    if p not in minio_delete_targets:
                        minio_delete_targets.append(p)

            # 删除 chunk 后、删 MinIO 前：画像清理使用与向量删除相同的 kb_id 候选（已含桶内反查）
            portrait_candidate_ids: List[str] = list(dict.fromkeys(vector_kb_candidates))
            if deleted_chunk_count > 0 and not portrait_candidate_ids:
                portrait_candidate_ids = list(dict.fromkeys(self._kb_id_candidates(kb_id)))

            # 向量删除成功后，再删除 MinIO 中该文件的所有对象（含 Office 预览 PDF 缓存）
            for object_path in minio_delete_targets:
                await self.minio_adapter.delete_file(bucket_name, object_path)

            # 删除 chunk 计入增量，达到阈值后触发画像重建（与上传逻辑一致）
            if deleted_chunk_count > 0:
                try:
                    from app.core.portrait_trigger import increment_and_maybe_trigger

                    increment_and_maybe_trigger(kb_id, deleted_chunk_count)
                except Exception as trigger_err:
                    logger.warning(f"删除文件后画像增量触发失败 kb_id={kb_id}: {trigger_err}")

                # 若删除后该知识库已无 chunk（文本+图片+音频+视频关键帧合计为 0），则删除所有可能存在的画像
                total_remaining = 0
                for cid in portrait_candidate_ids:
                    try:
                        n_text, n_img = await self.vector_store.count_kb_chunks(cid)
                        n_audio = await self.vector_store.count_kb_audio(cid)
                        n_video = await self.vector_store.count_kb_video(cid)
                        total_remaining += n_text + n_img + n_audio + n_video
                    except Exception as e:
                        logger.warning(f"统计 chunk 失败 candidate={cid}: {e}")
                if total_remaining == 0:
                    for cid in portrait_candidate_ids:
                        try:
                            await self._delete_kb_vectors(cid)
                            await self.vector_store.delete_kb_portraits(cid)
                            logger.info(f"知识库已为空，已清理三集合(向量+画像): {cid}")
                        except Exception as e:
                            logger.warning(f"删除空知识库向量/画像失败 candidate={cid}: {e}")

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