"""
Qdrant向量数据库适配器
处理文本和图片的向量化存储
"""

from typing import Dict, List, Any, Optional, Union, Tuple
import json
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass
import numpy as np

from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import (
    Distance, VectorParams, NamedVector,
    PointStruct, Filter, FieldCondition, MatchValue,
    PayloadSchemaType, Query, Fusion, Prefetch, FusionQuery,
    SparseVectorParams, SparseIndexParams,
    FilterSelector,
    Condition,
)

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

@dataclass
class VectorPoint:
    """向量点数据类"""
    id: str
    vector: Union[List[float], Dict[str, List[float]]]
    payload: Dict[str, Any]

class VectorStore:
    """Qdrant向量数据库适配器"""
    
    def __init__(self):
        # 使用 host 和 port 参数，确保使用 HTTP
        self.client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=settings.qdrant_api_key if settings.qdrant_api_key else None,
            https=False  # 明确禁用 HTTPS
        )
        
        # 集合配置
        # Qwen/Qwen3-Embedding-8B 的向量维度是 4096
        self.collections = {
            "text_chunks": {
                "vector_size": 4096,  # Qwen/Qwen3-Embedding-8B 的维度
                "distance": Distance.COSINE,
                "vectors_config": VectorParams(size=4096, distance=Distance.COSINE),
                "sparse_vectors_config": {
                    "sparse": SparseVectorParams(
                        index=SparseIndexParams(on_disk=False)
                    )
                },
                "payload_schema": {
                    "text_content": PayloadSchemaType.TEXT,
                    "kb_id": PayloadSchemaType.KEYWORD,
                    "file_id": PayloadSchemaType.KEYWORD,
                    "file_path": PayloadSchemaType.TEXT,
                    "file_type": PayloadSchemaType.KEYWORD,
                    "chunk_index": PayloadSchemaType.INTEGER,
                    "context_window": PayloadSchemaType.TEXT,  # JSON 存储为 TEXT
                    "metadata": PayloadSchemaType.TEXT,  # JSON 存储为 TEXT
                    "created_at": PayloadSchemaType.TEXT
                }
            },
            "image_vectors": {
                # 图片向量使用多向量配置：clip_vec (768维) 和 text_vec (4096维)
                "is_multi_vector": True,  # 标记为多向量集合
                "vectors_config": {
                    "clip_vec": VectorParams(size=768, distance=Distance.COSINE),   # CLIP 向量
                    "text_vec": VectorParams(size=4096, distance=Distance.COSINE)    # 文本嵌入向量
                },
                "payload_schema": {
                    "kb_id": PayloadSchemaType.KEYWORD,
                    "file_id": PayloadSchemaType.KEYWORD,
                    "file_path": PayloadSchemaType.TEXT,
                    "caption": PayloadSchemaType.TEXT,
                    "image_source_type": PayloadSchemaType.KEYWORD,
                    "img_format": PayloadSchemaType.KEYWORD,
                    "width": PayloadSchemaType.INTEGER,
                    "height": PayloadSchemaType.INTEGER,
                    "created_at": PayloadSchemaType.TEXT
                }
            },
            "kb_portraits": {
                "vector_size": 4096,  # 知识库画像也使用相同的嵌入模型
                "distance": Distance.COSINE,
                "vectors_config": VectorParams(size=4096, distance=Distance.COSINE),
                "payload_schema": {
                    "kb_id": PayloadSchemaType.KEYWORD,
                    "topic_summary": PayloadSchemaType.TEXT,
                    "cluster_size": PayloadSchemaType.INTEGER,
                    "created_at": PayloadSchemaType.TEXT
                }
            }
        }
        
        self._ensure_collections()
    
    def _ensure_collections(self):
        """确保必要的集合存在"""
        for collection_name, config in self.collections.items():
            try:
                # 检查是否为多向量集合
                is_multi_vector = config.get("is_multi_vector", False)
                
                # 尝试获取集合，检查是否存在
                try:
                    existing_collection = self.client.get_collection(collection_name)
                    logger.debug(f"集合已存在: {collection_name}")
                    
                    # 对于多向量集合，不检查维度（结构复杂）
                    if not is_multi_vector:
                        # 检查是否需要稀疏向量支持
                        needs_sparse = bool(config.get("sparse_vectors_config"))
                        
                        # 检查现有集合的配置
                        existing_has_sparse = False
                        existing_is_named_vector = False
                        
                        try:
                            if hasattr(existing_collection, 'config'):
                                if hasattr(existing_collection.config, 'params'):
                                    # 检查是否支持稀疏向量
                                    if hasattr(existing_collection.config.params, 'sparse_vectors'):
                                        existing_has_sparse = bool(existing_collection.config.params.sparse_vectors)
                                    
                                    # 检查是否是 Named Vector 格式（字典格式）
                                    if hasattr(existing_collection.config.params, 'vectors'):
                                        vectors_config = existing_collection.config.params.vectors
                                        # 如果是字典格式，说明是 Named Vector
                                        if isinstance(vectors_config, dict):
                                            existing_is_named_vector = True
                        except Exception as e:
                            logger.debug(f"检查集合配置时出错: {str(e)}")
                        
                        # 如果需要稀疏向量但现有集合不支持，需要重新创建
                        # 或者如果集合是单向量格式但我们需要使用 Named Vector 格式
                        if needs_sparse:
                            if not existing_has_sparse or not existing_is_named_vector:
                                logger.warning(
                                    f"集合 {collection_name} 需要支持稀疏向量和 Named Vector 格式，"
                                    f"但现有集合不支持（sparse={existing_has_sparse}, named={existing_is_named_vector}）。"
                                    f"将删除并重新创建集合。"
                                )
                                # 删除旧集合
                                try:
                                    self.client.delete_collection(collection_name)
                                    logger.info(f"删除旧集合: {collection_name}（需要添加稀疏向量和Named Vector支持）")
                                except Exception as del_e:
                                    logger.error(f"删除集合失败 {collection_name}: {str(del_e)}")
                                    continue
                                
                                # 重新创建集合（包含稀疏向量支持，使用 Named Vector 格式）
                                # 将单向量配置转换为 Named Vector 格式
                                vectors_config_dict = {
                                    "dense": config["vectors_config"]  # 将 VectorParams 包装为 Named Vector
                                }
                                sparse_vectors_config = config.get("sparse_vectors_config")
                                
                                create_kwargs = {
                                    "collection_name": collection_name,
                                    "vectors_config": vectors_config_dict  # 使用 Named Vector 格式
                                }
                                if sparse_vectors_config:
                                    create_kwargs["sparse_vectors_config"] = sparse_vectors_config
                                
                                self.client.create_collection(**create_kwargs)
                                logger.info(f"重新创建向量集合: {collection_name} (Named Vector格式，支持稀疏向量)")
                                # 设置 payload schema
                                self._setup_payload_schema(collection_name, config)
                                continue
                            
                            # 如果集合支持稀疏向量，检查是否是 Named Vector 格式
                            if existing_has_sparse and not existing_is_named_vector:
                                logger.warning(
                                    f"集合 {collection_name} 支持稀疏向量，但不是 Named Vector 格式。"
                                    f"将删除并重新创建为 Named Vector 格式。"
                                )
                                # 删除旧集合
                                try:
                                    self.client.delete_collection(collection_name)
                                    logger.info(f"删除旧集合: {collection_name}（需要转换为Named Vector格式）")
                                except Exception as del_e:
                                    logger.error(f"删除集合失败 {collection_name}: {str(del_e)}")
                                    continue
                                
                                # 重新创建为 Named Vector 格式
                                vectors_config_dict = {
                                    "dense": config["vectors_config"]
                                }
                                sparse_vectors_config = config.get("sparse_vectors_config")
                                
                                create_kwargs = {
                                    "collection_name": collection_name,
                                    "vectors_config": vectors_config_dict
                                }
                                if sparse_vectors_config:
                                    create_kwargs["sparse_vectors_config"] = sparse_vectors_config
                                
                                self.client.create_collection(**create_kwargs)
                                logger.info(f"重新创建向量集合: {collection_name} (Named Vector格式)")
                                # 设置 payload schema
                                self._setup_payload_schema(collection_name, config)
                                continue
                        
                        # 检查单向量集合的维度是否匹配
                        expected_size = config.get("vector_size")
                        if expected_size is not None:
                            existing_size = None
                            
                            # 尝试获取现有集合的向量维度
                            try:
                                if hasattr(existing_collection, 'config'):
                                    if hasattr(existing_collection.config, 'params'):
                                        if hasattr(existing_collection.config.params, 'vectors'):
                                            vectors_config = existing_collection.config.params.vectors
                                            # 处理单向量配置（VectorParams对象）
                                            if isinstance(vectors_config, VectorParams):
                                                existing_size = vectors_config.size
                                            # 处理字典类型（多向量配置或字典格式）
                                            elif isinstance(vectors_config, dict):
                                                # 如果是多向量配置，取第一个向量的size
                                                if vectors_config:
                                                    first_vector = next(iter(vectors_config.values()))
                                                    if isinstance(first_vector, VectorParams):
                                                        existing_size = first_vector.size
                                                    elif isinstance(first_vector, dict):
                                                        existing_size = first_vector.get('size')
                                                else:
                                                    existing_size = vectors_config.get('size')
                                            # 尝试使用getattr安全访问
                                            else:
                                                existing_size = getattr(vectors_config, 'size', None)
                            except Exception:
                                pass
                            
                            if existing_size is not None and existing_size != expected_size:
                                logger.warning(
                                    f"集合 {collection_name} 的向量维度不匹配: "
                                    f"现有={existing_size}, 期望={expected_size}。"
                                    f"需要删除并重新创建集合。"
                                )
                                # 删除旧集合
                                try:
                                    self.client.delete_collection(collection_name)
                                    logger.info(f"删除旧集合: {collection_name}")
                                except Exception as del_e:
                                    logger.error(f"删除集合失败 {collection_name}: {str(del_e)}")
                                    continue
                                
                                # 重新创建集合
                                sparse_vectors_config = config.get("sparse_vectors_config")
                                
                                # 如果需要稀疏向量，使用 Named Vector 格式
                                if sparse_vectors_config:
                                    vectors_config_dict = {
                                        "dense": config["vectors_config"]
                                    }
                                    create_kwargs = {
                                        "collection_name": collection_name,
                                        "vectors_config": vectors_config_dict,
                                        "sparse_vectors_config": sparse_vectors_config
                                    }
                                else:
                                    create_kwargs = {
                                        "collection_name": collection_name,
                                        "vectors_config": config["vectors_config"]
                                    }
                                
                                self.client.create_collection(**create_kwargs)
                                logger.info(f"重新创建向量集合: {collection_name} (维度: {expected_size})")
                                # 设置 payload schema
                                self._setup_payload_schema(collection_name, config)
                            elif existing_size is not None:
                                logger.debug(f"集合已存在且维度正确: {collection_name} (维度: {existing_size})")
                                # 检查并设置 payload schema
                                self._setup_payload_schema(collection_name, config)
                except Exception as get_e:
                    # 集合不存在，创建它
                    error_msg = str(get_e)
                    if "not found" in error_msg.lower() or "404" in error_msg:
                        vectors_config = config["vectors_config"]
                        
                        if is_multi_vector:
                            # 多向量集合：使用字典格式
                            logger.info(f"创建多向量集合: {collection_name} (clip_vec: 768, text_vec: 4096)")
                        else:
                            # 单向量集合
                            vector_size = config.get("vector_size", "未知")
                            has_sparse = bool(config.get("sparse_vectors_config"))
                            sparse_info = " + 稀疏向量" if has_sparse else ""
                            logger.info(f"创建向量集合: {collection_name} (维度: {vector_size}{sparse_info})")
                        
                        # 检查是否有稀疏向量配置
                        sparse_vectors_config = config.get("sparse_vectors_config")
                        
                        # 如果需要稀疏向量，使用 Named Vector 格式
                        if sparse_vectors_config:
                            # 将单向量配置转换为 Named Vector 格式
                            vectors_config_dict = {
                                "dense": vectors_config  # 包装为 Named Vector
                            }
                            create_kwargs = {
                                "collection_name": collection_name,
                                "vectors_config": vectors_config_dict,
                                "sparse_vectors_config": sparse_vectors_config
                            }
                        else:
                            # 不需要稀疏向量，使用单向量格式
                            create_kwargs = {
                                "collection_name": collection_name,
                                "vectors_config": vectors_config
                            }
                        
                        self.client.create_collection(**create_kwargs)
                        # 设置 payload schema
                        self._setup_payload_schema(collection_name, config)
                    else:
                        raise
                else:
                    # 集合已存在，检查并设置 payload schema
                    self._setup_payload_schema(collection_name, config)
            except Exception as e:
                error_msg = str(e)
                # 忽略集合已存在的错误（409 Conflict）
                if "409" in error_msg or "already exists" in error_msg.lower():
                    logger.debug(f"集合已存在: {collection_name}")
                # 忽略 Pydantic 验证错误（集合已创建成功，只是响应解析失败）
                elif "validation error" in error_msg.lower() or "ParsingModel" in error_msg:
                    logger.warning(
                        f"集合 {collection_name} 创建成功，但响应验证失败（可忽略）: {str(e)[:200]}"
                    )
                else:
                    logger.error(f"创建集合失败 {collection_name}: {str(e)}")
    
    def _setup_payload_schema(self, collection_name: str, config: Dict[str, Any]):
        """
        为 collection 设置 payload schema
        
        Args:
            collection_name: 集合名称
            config: 集合配置
        """
        payload_schema = config.get("payload_schema")
        if not payload_schema:
            return
        
        try:
            # 获取现有集合信息，得到“已有索引的字段名”集合（兼容多种 Qdrant 返回结构）
            existing_index_fields: set = set()
            try:
                existing_collection = self.client.get_collection(collection_name)
                raw_schema = getattr(existing_collection, "payload_schema", None)
                if raw_schema is None and hasattr(existing_collection, "config") and hasattr(existing_collection.config, "params"):
                    raw_schema = getattr(existing_collection.config.params, "payload_schema", None)
                if raw_schema is not None:
                    if isinstance(raw_schema, dict):
                        existing_index_fields = set(raw_schema.keys())
                    elif isinstance(raw_schema, (list, tuple)):
                        for item in raw_schema:
                            name = getattr(item, "field_name", None) or (item.get("field_name") if isinstance(item, dict) else None)
                            if name:
                                existing_index_fields.add(name)
            except Exception:
                pass

            # 为每个字段创建 payload index；仅在实际新建时打 INFO，已存在则跳过不刷屏
            for field_name, field_type in payload_schema.items():
                try:
                    if field_name in existing_index_fields:
                        logger.debug(f"字段 {field_name} 在集合 {collection_name} 中已有索引")
                        continue
                    self.client.create_payload_index(
                        collection_name=collection_name,
                        field_name=field_name,
                        field_schema=field_type
                    )
                    existing_index_fields.add(field_name)
                    logger.info(f"为集合 {collection_name} 创建 payload index: {field_name} ({field_type})")
                except Exception as idx_e:
                    error_msg = str(idx_e)
                    if "already exists" in error_msg.lower() or "409" in error_msg:
                        existing_index_fields.add(field_name)
                        logger.debug(f"字段 {field_name} 的索引已存在: {collection_name}")
                    else:
                        logger.warning(f"为字段 {field_name} 创建索引失败: {str(idx_e)}")
        except Exception as e:
            logger.warning(f"设置 payload schema 失败 {collection_name}: {str(e)}")
    
    async def upsert_text_chunks(
        self,
        kb_id: str,
        chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        批量插入文本块
        
        Args:
            kb_id: 知识库ID
            chunks: 文本块列表
            
        Returns:
            插入结果
        """
        try:
            points = []
            temp_id_to_real_id = {}  # 临时ID到真实ID的映射
            
            # 第一遍：插入所有chunk，建立临时ID到真实ID的映射
            for chunk in chunks:
                point_id = str(uuid.uuid4())
                temp_id = chunk.get("temp_id")
                if temp_id:
                    temp_id_to_real_id[temp_id] = point_id
                
                # 准备payload（context_window 以 JSON 字符串存，与 PayloadSchemaType.TEXT 一致，稍后更新）
                payload = {
                    "kb_id": kb_id,
                    "text_content": chunk["text"],
                    "file_id": chunk.get("file_id"),
                    "file_path": chunk.get("file_path"),
                    "file_type": chunk.get("file_type"),
                    "chunk_index": chunk.get("chunk_index", 0),
                    "context_window": "{}",  # 先为空 JSON 字符串，插入后再 set_payload 更新
                    "metadata": chunk.get("metadata", {}),
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                
                # 准备向量（支持密集向量和稀疏向量）
                vectors = chunk["vector"]  # 默认是密集向量（列表）
                
                # 如果 chunk 包含稀疏向量，构建 Named Vector 格式
                if "sparse_vector" in chunk and chunk["sparse_vector"]:
                    sparse_dict = chunk["sparse_vector"]
                    # 转换为 Qdrant 的 SparseVector 格式
                    sparse_vector = models.SparseVector(
                        indices=list(sparse_dict.keys()),
                        values=list(sparse_dict.values())
                    )
                    # 使用 Named Vector 格式同时存储密集和稀疏向量
                    vectors = {
                        "dense": vectors,  # 密集向量
                        "sparse": sparse_vector  # 稀疏向量
                    }
                
                point = PointStruct(
                    id=point_id,
                    vector=vectors,
                    payload=payload
                )
                points.append(point)
            
            # 批量插入
            operation_info = self.client.upsert(
                collection_name="text_chunks",
                points=points
            )
            
            # 第二遍：更新context_window字段，将临时ID替换为真实ID
            update_points = []
            for i, chunk in enumerate(chunks):
                temp_id = chunk.get("temp_id")
                if not temp_id:
                    continue
                
                real_id = temp_id_to_real_id.get(temp_id)
                if not real_id:
                    continue
                
                # 构建更新后的context_window
                updated_context_window = {}
                original_context_window = chunk.get("context_window", {})
                
                if "prev_chunk_id" in original_context_window:
                    prev_temp_id = original_context_window["prev_chunk_id"]
                    prev_real_id = temp_id_to_real_id.get(prev_temp_id)
                    if prev_real_id:
                        updated_context_window["prev_chunk_id"] = prev_real_id
                
                if "next_chunk_id" in original_context_window:
                    next_temp_id = original_context_window["next_chunk_id"]
                    next_real_id = temp_id_to_real_id.get(next_temp_id)
                    if next_real_id:
                        updated_context_window["next_chunk_id"] = next_real_id
                
                # 如果context_window不为空，更新该point（存为 JSON 字符串，与 TEXT 一致）
                if updated_context_window:
                    update_points.append({
                        "id": real_id,
                        "payload": {
                            "context_window": json.dumps(updated_context_window, ensure_ascii=False)
                        }
                    })
            
            # 批量更新context_window
            if update_points:
                try:
                    # 使用 set_payload 方法更新 payload（不改变向量）
                    # 按 payload 分组，批量更新相同 payload 的点
                    payload_to_points = {}
                    for point in update_points:
                        payload_key = str(point["payload"])
                        if payload_key not in payload_to_points:
                            payload_to_points[payload_key] = {
                                "payload": point["payload"],
                                "point_ids": []
                            }
                        payload_to_points[payload_key]["point_ids"].append(point["id"])
                    
                    # 批量更新（points 传 list 即可，与 PointIdsList 等价）
                    for payload_data in payload_to_points.values():
                        self.client.set_payload(
                            collection_name="text_chunks",
                            payload=payload_data["payload"],
                            points=payload_data["point_ids"]
                        )
                    logger.info(f"更新了 {len(update_points)} 个chunk的context_window")
                except Exception as update_e:
                    logger.warning(f"更新context_window失败: {str(update_e)}")
            
            logger.info(f"文本块插入完成: {len(points)} 个, 操作ID: {operation_info.operation_id}")
            
            return {
                "operation_id": operation_info.operation_id,
                "points_inserted": len(points),
                "status": "success"
            }
            
        except Exception as e:
            logger.error(f"文本块插入失败: {str(e)}")
            raise
    
    async def upsert_image_vectors(
        self,
        kb_id: str,
        images: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        批量插入图片向量
        
        Args:
            kb_id: 知识库ID
            images: 图片信息列表
            
        Returns:
            插入结果
        """
        try:
            points = []
            
            for image in images:
                point_id = str(uuid.uuid4())
                
                # 准备Named Vector
                vectors = {
                    "clip_vec": image["clip_vector"],
                    "text_vec": image["text_vector"]
                }
                
                # 准备payload（按照规范字段名；PDF 解析图写入 source_file_id 便于删除文档时一并删图）
                payload = {
                    "kb_id": kb_id,
                    "file_id": image.get("file_id"),
                    "file_path": image.get("file_path"),
                    "caption": image.get("caption", ""),
                    "img_format": image.get("image_format") or image.get("img_format"),  # 使用 img_format
                    "image_source_type": image.get("image_source_type", "standalone_file"),
                    "width": image.get("width"),
                    "height": image.get("height"),
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                if image.get("source_file_id"):
                    payload["source_file_id"] = image["source_file_id"]
                
                point = PointStruct(
                    id=point_id,
                    vector=vectors,
                    payload=payload
                )
                points.append(point)
            
            # 批量插入
            operation_info = self.client.upsert(
                collection_name="image_vectors",
                points=points
            )
            
            logger.info(f"图片向量插入完成: {len(points)} 个, 操作ID: {operation_info.operation_id}")
            
            return {
                "operation_id": operation_info.operation_id,
                "points_inserted": len(points),
                "status": "success"
            }
            
        except Exception as e:
            logger.error(f"图片向量插入失败: {str(e)}")
            raise
    
    async def upsert_kb_portraits(
        self,
        kb_id: str,
        portraits: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        插入知识库画像
        
        Args:
            kb_id: 知识库ID
            portraits: 画像列表
            
        Returns:
            插入结果
        """
        try:
            # 先删除该知识库的旧画像
            await self.delete_kb_portraits(kb_id)
            
            points = []
            
            for portrait in portraits:
                point_id = str(uuid.uuid4())
                
                # 构建基础payload
                payload = {
                    "kb_id": kb_id,
                    "topic_summary": portrait["topic_summary"],
                    "cluster_size": portrait["cluster_size"],
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                
                # 如果portrait包含metadata，合并到payload中
                if "metadata" in portrait and isinstance(portrait["metadata"], dict):
                    payload.update(portrait["metadata"])
                
                point = PointStruct(
                    id=point_id,
                    vector=portrait["vector"],
                    payload=payload
                )
                points.append(point)
            
            # 批量插入
            operation_info = self.client.upsert(
                collection_name="kb_portraits",
                points=points
            )
            
            logger.info(f"知识库画像插入完成: {len(points)} 个, 操作ID: {operation_info.operation_id}")
            
            return {
                "operation_id": operation_info.operation_id,
                "points_inserted": len(points),
                "status": "success"
            }
            
        except Exception as e:
            logger.error(f"知识库画像插入失败: {str(e)}")
            raise
    
    def _delete_points_by_kb_id_filter(
        self, collection_name: str, filter_condition: "Filter"
    ) -> bool:
        """按 filter 删除集合中的点（同步，供内部调用）。"""
        try:
            self.client.delete(
                collection_name=collection_name,
                points_selector=FilterSelector(filter=filter_condition),
            )
            return True
        except Exception as e:
            logger.error(f"按 filter 删除 {collection_name} 失败: {str(e)}")
            return False

    async def delete_kb_portraits(self, kb_id: str) -> bool:
        """删除知识库画像（按 kb_id 条件删除，避免依赖 scroll 返回的 id）"""
        try:
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            ok = self._delete_points_by_kb_id_filter("kb_portraits", filter_condition)
            if ok:
                logger.info(f"删除知识库画像完成: {kb_id}")
            return ok
        except Exception as e:
            logger.error(f"删除知识库画像失败: {str(e)}")
            return False

    async def delete_kb_vectors(self, kb_id: str) -> bool:
        """删除知识库在 text_chunks、image_vectors 中该 kb_id 的所有点（按 filter 删除，可靠）。"""
        try:
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            ok_text = self._delete_points_by_kb_id_filter("text_chunks", filter_condition)
            ok_img = self._delete_points_by_kb_id_filter("image_vectors", filter_condition)
            if ok_text or ok_img:
                logger.info(f"删除知识库向量完成: {kb_id} (text_chunks={ok_text}, image_vectors={ok_img})")
            return ok_text and ok_img
        except Exception as e:
            logger.error(f"删除知识库向量失败: {str(e)}")
            return False
    
    async def search_text_chunks(
        self,
        query_vector: List[float],
        kb_ids: Optional[List[str]] = None,
        limit: int = 20,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """搜索文本块"""
        try:
            # 构建过滤条件
            search_filter = None
            if kb_ids:
                search_filter = Filter(
                    should=[FieldCondition(
                        key="kb_id", 
                        match=MatchValue(value=kb_id)
                    ) for kb_id in kb_ids]
                )
            
            # 使用 query_points API (新版本 qdrant-client)
            # 检查集合是否是 Named Vector 格式，如果是则指定 using="dense"
            try:
                collection_info = self.client.get_collection("text_chunks")
                is_named_vector = False
                if hasattr(collection_info, 'config') and hasattr(collection_info.config, 'params'):
                    if hasattr(collection_info.config.params, 'vectors'):
                        vectors_config = collection_info.config.params.vectors
                        # 如果是字典格式，说明是 Named Vector
                        if isinstance(vectors_config, dict):
                            is_named_vector = True
            except Exception:
                # 如果获取集合信息失败，假设是单向量格式
                is_named_vector = False
            
            query_kwargs = {
                "collection_name": "text_chunks",
                "query": query_vector,
                "query_filter": search_filter,
                "limit": limit,
                "score_threshold": score_threshold
            }
            
            # 如果是 Named Vector 格式，指定使用 dense 向量
            if is_named_vector:
                query_kwargs["using"] = "dense"
            
            query_result = self.client.query_points(**query_kwargs)
            
            # 处理返回结果：QueryResponse 对象有 points 属性
            if hasattr(query_result, 'points'):
                results = query_result.points
            elif isinstance(query_result, (list, tuple)):
                # 如果直接返回列表或元组，使用它
                results = query_result
            else:
                # 尝试作为可迭代对象处理
                results = list(query_result) if query_result else []
            
            # 转换结果格式；id 统一为向量库 point id（字符串），供引用/检查器直接使用
            formatted_results = []
            for result in results:
                try:
                    # 标准格式：result 是 ScoredPoint 对象
                    if hasattr(result, 'id') and hasattr(result, 'score'):
                        formatted_results.append({
                            "id": str(result.id) if result.id is not None else result.id,
                            "score": result.score,
                            "payload": result.payload if hasattr(result, 'payload') else {}
                        })
                    elif isinstance(result, (list, tuple)) and len(result) >= 2:
                        # 元组格式：(id, score, payload)
                        formatted_results.append({
                            "id": str(result[0]) if result[0] is not None else result[0],
                            "score": result[1] if len(result) > 1 else 0.0,
                            "payload": result[2] if len(result) > 2 else {}
                        })
                    else:
                        logger.warning(f"无法解析结果格式: {type(result)}")
                except Exception as e:
                    logger.error(f"处理单个结果失败: {str(e)}, result type: {type(result)}")
                    continue
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"文本块搜索失败: {str(e)}")
            return []
    
    async def search_text_chunks_sparse(
        self,
        query_sparse: Dict[int, float],
        kb_ids: Optional[List[str]] = None,
        limit: int = 20,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """
        使用稀疏向量搜索文本块
        
        Args:
            query_sparse: 查询稀疏向量 {token_id: weight}
            kb_ids: 知识库ID列表
            limit: 返回结果数量
            score_threshold: 分数阈值
            
        Returns:
            检索结果列表
        """
        try:
            # 构建过滤条件
            search_filter = None
            if kb_ids:
                search_filter = Filter(
                    should=[FieldCondition(
                        key="kb_id", 
                        match=MatchValue(value=kb_id)
                    ) for kb_id in kb_ids]
                )
            
            # 转换为 Qdrant 的 SparseVector 格式
            sparse_vector = models.SparseVector(
                indices=list(query_sparse.keys()),
                values=list(query_sparse.values())
            )
            
            # 使用 query_points API 进行稀疏向量检索
            query_result = self.client.query_points(
                collection_name="text_chunks",
                query=sparse_vector,
                using="sparse",  # 指定使用稀疏向量
                query_filter=search_filter,
                limit=limit,
                score_threshold=score_threshold
            )
            
            # 处理返回结果
            if hasattr(query_result, 'points'):
                results = query_result.points
            elif isinstance(query_result, (list, tuple)):
                results = query_result
            else:
                results = list(query_result) if query_result else []
            
            # 转换结果格式；id 统一为向量库 point id（字符串）
            formatted_results = []
            for result in results:
                try:
                    if hasattr(result, 'id') and hasattr(result, 'score'):
                        formatted_results.append({
                            "id": str(result.id) if result.id is not None else result.id,
                            "score": result.score,
                            "payload": result.payload if hasattr(result, 'payload') else {}
                        })
                    elif isinstance(result, (list, tuple)) and len(result) >= 2:
                        formatted_results.append({
                            "id": str(result[0]) if result[0] is not None else result[0],
                            "score": result[1] if len(result) > 1 else 0.0,
                            "payload": result[2] if len(result) > 2 else {}
                        })
                    else:
                        logger.warning(f"无法解析结果格式: {type(result)}")
                except Exception as e:
                    logger.error(f"处理单个结果失败: {str(e)}, result type: {type(result)}")
                    continue
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"稀疏向量文本块搜索失败: {str(e)}")
            return []
    
    async def search_image_vectors(
        self,
        query_vector: List[float],
        kb_ids: Optional[List[str]] = None,
        limit: int = 20,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """搜索图片向量（单路：仅使用文本语义向量）"""
        try:
            # 构建过滤条件
            search_filter = None
            if kb_ids:
                search_filter = Filter(
                    should=[FieldCondition(
                        key="kb_id", 
                        match=MatchValue(value=kb_id)
                    ) for kb_id in kb_ids]
                )
            
            # 使用 query_points API (新版本 qdrant-client)
            # 对于多向量集合，使用 using 参数指定命名向量
            # 使用 text_vec 进行查询（因为查询向量是文本嵌入向量）
            query_result = self.client.query_points(
                collection_name="image_vectors",
                query=query_vector,  # 直接传入向量列表
                using="text_vec",  # 指定使用 text_vec 命名向量
                query_filter=search_filter,
                limit=limit,
                score_threshold=score_threshold
            )
            
            # 处理返回结果：QueryResponse 对象有 points 属性
            if hasattr(query_result, 'points'):
                results = query_result.points
            elif isinstance(query_result, (list, tuple)):
                # 如果直接返回列表或元组，使用它
                results = query_result
            else:
                # 尝试作为可迭代对象处理
                results = list(query_result) if query_result else []
            
            # 转换结果格式；id 统一为向量库 point id（字符串）
            formatted_results = []
            for result in results:
                try:
                    # 标准格式：result 是 ScoredPoint 对象
                    if hasattr(result, 'id') and hasattr(result, 'score'):
                        formatted_results.append({
                            "id": str(result.id) if result.id is not None else result.id,
                            "score": result.score,
                            "payload": result.payload if hasattr(result, 'payload') else {}
                        })
                    elif isinstance(result, (list, tuple)) and len(result) >= 2:
                        # 元组格式：(id, score, payload)
                        formatted_results.append({
                            "id": str(result[0]) if result[0] is not None else result[0],
                            "score": result[1] if len(result) > 1 else 0.0,
                            "payload": result[2] if len(result) > 2 else {}
                        })
                    else:
                        logger.warning(f"无法解析结果格式: {type(result)}")
                except Exception as e:
                    logger.error(f"处理单个结果失败: {str(e)}, result type: {type(result)}")
                    continue
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"图片向量搜索失败: {str(e)}")
            return []
    
    async def search_image_vectors_dual_rrf(
        self,
        text_query_vector: List[float],
        clip_query_vector: List[float],
        kb_ids: Optional[List[str]] = None,
        limit: int = 20,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """搜索图片向量（双路RRF：文本语义向量 + CLIP视觉特征向量）
        
        使用Qdrant的Named Vector特性，构造内部双路RRF查询：
        - text_vec: 匹配VLM生成的图片描述特征
        - clip_vec: 匹配图片的视觉特征
        
        Args:
            text_query_vector: 文本语义向量（4096维）
            clip_query_vector: CLIP视觉特征向量（768维）
            kb_ids: 知识库ID列表
            limit: 返回结果数量限制
            score_threshold: 分数阈值
            
        Returns:
            融合后的检索结果列表
        """
        try:
            # 构建过滤条件
            search_filter = None
            if kb_ids:
                search_filter = Filter(
                    should=[FieldCondition(
                        key="kb_id", 
                        match=MatchValue(value=kb_id)
                    ) for kb_id in kb_ids]
                )
            
            logger.info(
                f"执行双路RRF查询: text_vec维度={len(text_query_vector)}, "
                f"clip_vec维度={len(clip_query_vector)}"
            )
            
            # 使用Qdrant的prefetch + Fusion RRF方式
            # 构建两个prefetch查询：分别使用text_vec和clip_vec
            prefetch_queries = [
                Prefetch(
                    query=text_query_vector,
                    using="text_vec",
                    limit=limit * 2  # prefetch limit应该大于最终limit
                ),
                Prefetch(
                    query=clip_query_vector,
                    using="clip_vec",
                    limit=limit * 2
                )
            ]
            
            # 使用Fusion RRF进行融合查询
            fusion_query = FusionQuery(fusion=Fusion.RRF)
            
            logger.debug(
                f"构建双路RRF查询: text_vec查询向量维度={len(text_query_vector)}, "
                f"clip_vec查询向量维度={len(clip_query_vector)}, "
                f"prefetch_limit={limit * 2}, final_limit={limit}"
            )
            
            # 执行融合查询
            query_result = self.client.query_points(
                collection_name="image_vectors",
                prefetch=prefetch_queries,
                query=fusion_query,
                query_filter=search_filter,
                limit=limit,
                score_threshold=score_threshold
            )
            
            logger.debug(f"双路RRF查询执行完成，返回结果数: {len(query_result.points) if hasattr(query_result, 'points') else 'unknown'}")
            
            # 处理返回结果
            if hasattr(query_result, 'points'):
                results = query_result.points
            elif isinstance(query_result, (list, tuple)):
                results = query_result
            else:
                results = list(query_result) if query_result else []
            
            # 同时执行两个单独查询以获取详细分数信息（用于日志）
            text_results = await self._query_single_vector(
                text_query_vector, "text_vec", kb_ids, limit * 2, score_threshold
            )
            clip_results = await self._query_single_vector(
                clip_query_vector, "clip_vec", kb_ids, limit * 2, score_threshold
            )
            
            # 构建结果ID到分数的映射
            text_scores = {r["id"]: r["score"] for r in text_results}
            clip_scores = {r["id"]: r["score"] for r in clip_results}
            
            # 转换结果格式并添加详细分数信息
            formatted_results = []
            for result in results:
                try:
                    result_id = None
                    score = 0.0
                    payload = {}
                    
                    if hasattr(result, 'id') and hasattr(result, 'score'):
                        result_id = str(result.id) if result.id is not None else result.id
                        score = result.score
                        payload = result.payload if hasattr(result, 'payload') else {}
                    elif isinstance(result, (list, tuple)) and len(result) >= 2:
                        result_id = str(result[0]) if result[0] is not None else result[0]
                        score = result[1] if len(result) > 1 else 0.0
                        payload = result[2] if len(result) > 2 else {}
                    
                    if result_id:
                        formatted_results.append({
                            "id": result_id,
                            "score": score,
                            "payload": payload,
                            "scores": {
                                "text_vec": text_scores.get(result_id, 0.0),
                                "clip_vec": clip_scores.get(result_id, 0.0),
                                "rrf_fused": score
                            }
                        })
                except Exception as e:
                    logger.error(f"处理单个结果失败: {str(e)}, result type: {type(result)}")
                    continue
            
            logger.info(
                f"双路RRF查询完成: 找到{len(formatted_results)}个结果 "
                f"(text_vec匹配: {len(text_scores)}个, clip_vec匹配: {len(clip_scores)}个)"
            )
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"双路RRF图片向量搜索失败: {str(e)}", exc_info=True)
            # 如果双路RRF失败，回退到单路文本查询
            logger.warning("回退到单路文本语义查询")
            return await self.search_image_vectors(
                query_vector=text_query_vector,
                kb_ids=kb_ids,
                limit=limit,
                score_threshold=score_threshold
            )
    
    async def _query_single_vector(
        self,
        query_vector: List[float],
        vector_name: str,
        kb_ids: Optional[List[str]] = None,
        limit: int = 20,
        score_threshold: float = 0.0
    ) -> List[Dict[str, Any]]:
        """执行单个命名向量的查询（用于获取详细分数）"""
        try:
            search_filter = None
            if kb_ids:
                search_filter = Filter(
                    should=[FieldCondition(
                        key="kb_id", 
                        match=MatchValue(value=kb_id)
                    ) for kb_id in kb_ids]
                )
            
            query_result = self.client.query_points(
                collection_name="image_vectors",
                query=query_vector,
                using=vector_name,
                query_filter=search_filter,
                limit=limit,
                score_threshold=score_threshold
            )
            
            if hasattr(query_result, 'points'):
                results = query_result.points
            elif isinstance(query_result, (list, tuple)):
                results = query_result
            else:
                results = list(query_result) if query_result else []
            
            formatted_results = []
            for result in results:
                try:
                    if hasattr(result, 'id') and hasattr(result, 'score'):
                        formatted_results.append({
                            "id": str(result.id) if result.id is not None else result.id,
                            "score": result.score,
                            "payload": result.payload if hasattr(result, 'payload') else {}
                        })
                    elif isinstance(result, (list, tuple)) and len(result) >= 2:
                        formatted_results.append({
                            "id": str(result[0]) if result[0] is not None else result[0],
                            "score": result[1] if len(result) > 1 else 0.0,
                            "payload": result[2] if len(result) > 2 else {}
                        })
                except Exception as e:
                    continue
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"单向量查询失败 ({vector_name}): {str(e)}")
            return []
    
    async def search_kb_portraits_topn(
        self,
        query_vector: List[float],
        limit: int = 30
    ) -> List[Dict[str, Any]]:
        """
        在 kb_portraits 全集中按查询向量检索 TopN 个最相似的主题节点（用于路由）。
        返回每条带 score（作 Similarity）、kb_id、cluster_size，便于按策略聚合打分。
        """
        try:
            query_result = self.client.query_points(
                collection_name="kb_portraits",
                query=query_vector,
                limit=limit,
                with_payload=True,
            )
            raw = query_result.points if hasattr(query_result, "points") else list(query_result or [])
            out = []
            for r in raw:
                payload = r.payload if isinstance(getattr(r, "payload", None), dict) else {}
                out.append({
                    "id": r.id,
                    "score": float(getattr(r, "score", 0.0)),
                    "kb_id": payload.get("kb_id", ""),
                    "cluster_size": int(payload.get("cluster_size", 1)),
                    "payload": payload,
                })
            return out
        except Exception as e:
            logger.error(f"kb_portraits TopN 检索失败: {str(e)}")
            return []

    async def search_kb_portraits(
        self,
        kb_id: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        按 kb_id 拉取该知识库的画像（scroll）。
        用于 get_kb_portraits、_delete 前查询、_check_update_needed 等。
        路由用 search_kb_portraits_topn 做全局 TopN 检索。
        """
        try:
            filter_condition = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            scroll_results = self.client.scroll(
                collection_name="kb_portraits",
                scroll_filter=filter_condition,
                limit=limit,
                with_payload=True,
            )
            results = scroll_results[0] if scroll_results else []
            return [
                {
                    "id": r.id,
                    "score": getattr(r, "score", 0),
                    "payload": r.payload if hasattr(r, "payload") and r.payload is not None else {},
                }
                for r in results
            ]
        except Exception as e:
            logger.error(f"知识库画像搜索失败: {str(e)}")
            return []
    
    async def get_collection_stats(self, collection_name: str) -> Dict[str, Any]:
        """获取集合统计信息"""
        try:
            info = self.client.get_collection(collection_name)
            
            # 安全获取segments信息
            segments = getattr(info, 'segments', None)
            segments_count = len(segments) if segments else 0
            
            return {
                "collection_name": collection_name,
                "vectors_count": getattr(info, 'vectors_count', 0),
                "segments_count": segments_count,
                "status": getattr(info, 'status', 'unknown'),
                "indexed_vectors_count": getattr(info, 'indexed_vectors_count', 0)
            }
            
        except Exception as e:
            logger.error(f"获取集合统计失败: {str(e)}")
            return {}

    def _text_chunks_uses_named_vector(self) -> bool:
        """判断 text_chunks 是否使用 Named Vector（dense）"""
        try:
            info = self.client.get_collection("text_chunks")
            if hasattr(info, "config") and hasattr(info.config, "params"):
                v = getattr(info.config.params, "vectors", None)
                return isinstance(v, dict)
        except Exception:
            pass
        return False

    async def count_kb_chunks(self, kb_id: str) -> Tuple[int, int]:
        """
        按 kb_id 统计文本块与图片向量数量。
        用于画像采样的 N_text、N_img 及按比例分配。
        """
        try:
            filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
            n_text = self.client.count(
                collection_name="text_chunks",
                count_filter=filt,
                exact=True,
            ).count
            n_img = self.client.count(
                collection_name="image_vectors",
                count_filter=filt,
                exact=True,
            ).count
            return (int(n_text), int(n_img))
        except Exception as e:
            logger.error(f"count_kb_chunks 失败: {str(e)}")
            return (0, 0)

    async def scroll_text_chunks_for_sampling(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any] = None,
        batch_size: int = 500,
    ) -> Tuple[List[Tuple[str, List[float]]], Optional[Any]]:
        """
        按 kb_id 滚动拉取文本块 (id, dense 向量)，用于画像采样。
        返回 ([(id, vector), ...], next_offset)。
        """
        try:
            filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
            use_named = self._text_chunks_uses_named_vector()
            with_vec = ["dense"] if use_named else True
            scroll_limit = min(limit, batch_size)
            kwargs: Dict[str, Any] = {
                "collection_name": "text_chunks",
                "scroll_filter": filt,
                "limit": scroll_limit,
                "with_payload": False,
                "with_vectors": with_vec,
            }
            if offset is not None:
                kwargs["offset"] = offset
            out: List[Tuple[str, List[float]]] = []
            res = self.client.scroll(**kwargs)
            records, next_offset = res[0], res[1] if len(res) > 1 else None
            for r in records:
                vid = str(r.id) if r.id is not None else ""
                v = None
                if hasattr(r, "vector") and r.vector is not None:
                    if isinstance(r.vector, dict):
                        v = r.vector.get("dense") if use_named else (list(r.vector.values())[0] if r.vector else None)
                    elif isinstance(r.vector, list):
                        v = r.vector
                if vid and v is not None and isinstance(v, list):
                    out.append((vid, v))
            return (out, next_offset)
        except Exception as e:
            logger.error(f"scroll_text_chunks_for_sampling 失败: {str(e)}")
            return ([], None)

    async def scroll_image_vectors_for_sampling(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any] = None,
        batch_size: int = 500,
    ) -> Tuple[List[Tuple[str, List[float]]], Optional[Any]]:
        """
        按 kb_id 滚动拉取图片向量 (id, text_vec)，用于画像采样。
        返回 ([(id, vector), ...], next_offset)。
        """
        try:
            filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))])
            scroll_limit = min(limit, batch_size)
            kwargs: Dict[str, Any] = {
                "collection_name": "image_vectors",
                "scroll_filter": filt,
                "limit": scroll_limit,
                "with_payload": False,
                "with_vectors": ["text_vec"],
            }
            if offset is not None:
                kwargs["offset"] = offset
            out: List[Tuple[str, List[float]]] = []
            res = self.client.scroll(**kwargs)
            records, next_offset = res[0], res[1] if len(res) > 1 else None
            for r in records:
                vid = str(r.id) if r.id is not None else ""
                v = None
                if hasattr(r, "vector") and r.vector is not None and isinstance(r.vector, dict):
                    v = r.vector.get("text_vec")
                if vid and v is not None and isinstance(v, list):
                    out.append((vid, v))
            return (out, next_offset)
        except Exception as e:
            logger.error(f"scroll_image_vectors_for_sampling 失败: {str(e)}")
            return ([], None)

    async def fetch_texts_by_ids(
        self,
        ids_doc: List[str],
        ids_image: List[str],
    ) -> Tuple[Dict[str, str], Dict[str, str]]:
        """
        按 point id 批量拉取文本：text_chunks 的 text_content，image_vectors 的 caption。
        返回 (doc_id -> text, image_id -> text)。
        """
        texts_doc: Dict[str, str] = {}
        texts_img: Dict[str, str] = {}
        try:
            if ids_doc:
                rows = self.client.retrieve(
                    collection_name="text_chunks",
                    ids=ids_doc,
                    with_payload=True,
                    with_vectors=False,
                )
                for r in rows:
                    pid = str(r.id) if r.id is not None else ""
                    payload = r.payload or {}
                    text = (payload.get("text_content") or "").strip()
                    if pid:
                        texts_doc[pid] = text
            if ids_image:
                rows = self.client.retrieve(
                    collection_name="image_vectors",
                    ids=ids_image,
                    with_payload=True,
                    with_vectors=False,
                )
                for r in rows:
                    pid = str(r.id) if r.id is not None else ""
                    payload = r.payload or {}
                    text = (payload.get("caption") or "").strip()
                    if pid:
                        texts_img[pid] = text
        except Exception as e:
            logger.error(f"fetch_texts_by_ids 失败: {str(e)}")
        return (texts_doc, texts_img)

    def get_point_id_by_file_id_and_chunk_index(
        self, file_id: str, chunk_index: Optional[int] = None
    ) -> Optional[str]:
        """
        按 MinIO 文档 file_id 与可选 chunk_index 解析出 Qdrant 的 point id。
        引用/检查器已统一使用检索返回的 point id，本方法供管理或迁移等场景按 file_id 查询使用。
        """
        if not file_id:
            return None
        try:
            must: List[Condition] = [
                FieldCondition(key="file_id", match=MatchValue(value=str(file_id)))
            ]
            if chunk_index is not None:
                must.append(
                    FieldCondition(key="chunk_index", match=MatchValue(value=int(chunk_index)))
                )
            scroll_results = self.client.scroll(
                collection_name="text_chunks",
                scroll_filter=Filter(must=must),
                limit=1,
                with_payload=False,
            )
            points = scroll_results[0] if scroll_results else []
            if not points:
                return None
            return str(points[0].id) if points[0].id is not None else None
        except Exception as e:
            logger.debug(f"get_point_id_by_file_id_and_chunk_index 失败: file_id={file_id}, e={e}")
            return None

    def get_chunk_context_window_texts(self, chunk_id: str) -> Optional[Dict[str, str]]:
        """
        根据 text_chunks 中某 chunk 的 context_window（prev_chunk_id, next_chunk_id）
        拉取上一 chunk 和下一 chunk 的 text_content，用于检查器按 context_window 展示上下文。
        chunk_id 为向量库 point id（检索结果已统一返回该 id，引用处直接使用）。
        返回 {"prev": "...", "next": "..."}，缺失则为空字符串。
        """
        try:
            norm_id = str(chunk_id) if chunk_id is not None else ""
            if not norm_id:
                return {"prev": "", "next": ""}
            rows = self.client.retrieve(
                collection_name="text_chunks",
                ids=[norm_id],
                with_payload=True,
                with_vectors=False,
            )
            if not rows:
                return {"prev": "", "next": ""}
            # 转为普通 dict，避免 Pydantic/Record 等类型导致 .get 或嵌套访问异常
            raw_payload = rows[0].payload
            payload = dict(raw_payload) if raw_payload else {}
            cw_raw = payload.get("context_window")
            if cw_raw is None or cw_raw == "":
                return {"prev": "", "next": ""}
            # 兼容：Qdrant 中 context_window 为对象 {"prev_chunk_id":"...", "next_chunk_id":"..."}
            # 可能是 JSON 字符串，或客户端解析后的 dict/对象
            if isinstance(cw_raw, str):
                try:
                    cw = json.loads(cw_raw)
                except Exception:
                    return {"prev": "", "next": ""}
            elif isinstance(cw_raw, dict):
                cw = dict(cw_raw)
            else:
                # 兼容 Pydantic/对象：用 getattr 取字段
                cw = {
                    "prev_chunk_id": getattr(cw_raw, "prev_chunk_id", None) or (cw_raw.get("prev_chunk_id") if hasattr(cw_raw, "get") else None),
                    "next_chunk_id": getattr(cw_raw, "next_chunk_id", None) or (cw_raw.get("next_chunk_id") if hasattr(cw_raw, "get") else None),
                }
            prev_id = cw.get("prev_chunk_id") or payload.get("context_window.prev_chunk_id")
            next_id = cw.get("next_chunk_id") or payload.get("context_window.next_chunk_id")
            ids_to_fetch = [x for x in (prev_id, next_id) if x]
            if not ids_to_fetch:
                return {"prev": "", "next": ""}
            # 统一为字符串，避免 Qdrant 返回的 UUID 与 payload 中字符串 key 不一致
            ids_str = [str(x) for x in ids_to_fetch]
            rows2 = self.client.retrieve(
                collection_name="text_chunks",
                ids=ids_str,
                with_payload=True,
                with_vectors=False,
            )
            id_to_text: Dict[str, str] = {}
            for r in rows2:
                pid = str(r.id) if r.id is not None else ""
                pl = dict(r.payload) if r.payload else {}
                id_to_text[pid] = (pl.get("text_content") or "").strip()
            return {
                "prev": id_to_text.get(str(prev_id), "") if prev_id else "",
                "next": id_to_text.get(str(next_id), "") if next_id else "",
            }
        except Exception as e:
            logger.debug(f"get_chunk_context_window_texts 失败: chunk_id={chunk_id}, e={e}")
            return {"prev": "", "next": ""}

    async def get_all_collections_stats(self) -> Dict[str, Any]:
        """获取所有集合统计信息"""
        try:
            collections_info = self.client.get_collections()
            
            stats = {}
            for collection in collections_info.collections:
                collection_name = collection.name
                stats[collection_name] = await self.get_collection_stats(collection_name)
            
            return stats
            
        except Exception as e:
            logger.error(f"获取所有集合统计失败: {str(e)}")
            return {}
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            collections = self.client.get_collections()
            
            return {
                "status": "healthy",
                "total_collections": len(collections.collections),
                "collections": [c.name for c in collections.collections]
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }