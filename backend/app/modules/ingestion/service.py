"""
数据输入处理服务
协调文件上传、解析、向量化、存储的完整流程
"""

from typing import Dict, List, Any, Optional, TYPE_CHECKING, Tuple
import asyncio
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import base64
from io import BytesIO
import warnings
import os
import redis
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
    from transformers import CLIPModel, CLIPProcessor, ClapModel, ClapProcessor

from .parsers.factory import ParserFactory, FileType, normalize_text_newlines
from .storage.minio_adapter import MinIOAdapter
from .storage.vector_store import (
    TEXT_CHUNK_COLLECTION,
    VIDEO_SHOT_COLLECTION,
    VectorStore,
)
from .splitters.agentic import AgenticDocumentChunker
from .video_scene_shot import (
    SCHEMA_VERSION,
    build_previous_context,
    extract_json_object,
    iter_shots,
    merge_chunk_analyses,
    normalize_video_analysis,
    shift_video_analysis,
)
from app.core.config import settings
from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine
from app.core.sparse_encoder import get_sparse_encoder
from app.core.logger import get_logger, audit_log

logger = get_logger(__name__)

PROCESSING_STATUS_KEY_PREFIX = "ingestion:processing:task:"
PROCESSING_STATUS_KB_KEY_PREFIX = "ingestion:processing:kb:"
PROCESSING_STATUS_FILE_KEY_PREFIX = "ingestion:processing:file:"

_ingestion_service_instance: Optional["IngestionService"] = None


def get_ingestion_service() -> "IngestionService":
    """返回全局单例 IngestionService，保证 upload 与 import 等路由共用同一实例，轮询进度一致。"""
    global _ingestion_service_instance
    if _ingestion_service_instance is None:
        _ingestion_service_instance = IngestionService()
    return _ingestion_service_instance


class IngestionService:
    """数据输入处理服务"""
    
    def __init__(self):
        self.parser_factory = ParserFactory()
        self.minio_adapter = MinIOAdapter()
        self.vector_store = VectorStore()
        self.llm_manager = llm_manager
        self.agentic_document_chunker = AgenticDocumentChunker(self.llm_manager)
        self.sparse_encoder = get_sparse_encoder()  # BGE-M3 稀疏向量编码器
        self._clip_model: Optional["CLIPModel"] = None
        self._clip_processor: Optional["CLIPProcessor"] = None
        self._clap_model: Optional["ClapModel"] = None
        self._clap_processor: Optional["ClapProcessor"] = None
        
        # 处理状态存储（生产环境应使用Redis或数据库）
        self._processing_status: Dict[str, Dict[str, Any]] = {}
        # 后台任务由服务实例持有，避免 NDJSON 客户端断开（例如刷新页面）时任务被
        # StreamingResponse 的生命周期意外带走。
        self._background_upload_tasks: Dict[str, asyncio.Task[Any]] = {}
        self._video_processing_semaphore: Optional[asyncio.Semaphore] = None
        self._processing_status_redis_client: Optional[redis.Redis] = None

    def _processing_status_ttl_seconds(self) -> int:
        return max(
            60,
            int(getattr(settings, "upload_processing_status_ttl_seconds", 7 * 24 * 60 * 60) or 60),
        )

    def _processing_lease_timeout_seconds(self) -> int:
        """后台上传任务多久未心跳后可判定为已失联。"""
        return max(
            5,
            int(getattr(settings, "upload_processing_lease_timeout_seconds", 300) or 300),
        )

    def _processing_lease_heartbeat_interval_seconds(self) -> float:
        """在租约超时前多次续约，同时避免过高频 Redis 写入。"""
        timeout = self._processing_lease_timeout_seconds()
        return max(1.0, min(30.0, timeout / 3.0))

    @staticmethod
    def _parse_status_datetime(value: Any) -> Optional[datetime]:
        """兼容旧状态的 naive ISO 字符串和带时区 ISO 字符串。"""
        if not value:
            return None
        try:
            raw = str(value).strip()
            if raw.endswith("Z"):
                raw = f"{raw[:-1]}+00:00"
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is not None:
                return parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except (TypeError, ValueError):
            return None

    def _status_recency_timestamp(self, status: Dict[str, Any]) -> float:
        """返回状态最近更新时间，供重复 file_id 的重试任务稳定排序。"""
        for field in ("updated_at", "lease_heartbeat_at", "submitted_at", "started_at"):
            parsed = self._parse_status_datetime(status.get(field))
            if parsed is not None:
                return parsed.timestamp()
        return 0.0

    @staticmethod
    def _is_active_processing_status(status: Dict[str, Any]) -> bool:
        return str(status.get("status") or "") in {"queued", "processing"}

    def _is_processing_lease_expired(
        self,
        status: Dict[str, Any],
        *,
        now: Optional[datetime] = None,
    ) -> bool:
        """判断活跃任务的租约是否已超时。

        lease 记录缺少专用 heartbeat 时会退化为 updated_at/submitted_at，
        兼容早期已登记但尚未进入后台 runner 的任务状态。
        """
        if not self._is_active_processing_status(status):
            return False
        heartbeat_at = (
            status.get("lease_heartbeat_at")
            or status.get("heartbeat_at")
            or status.get("updated_at")
            or status.get("submitted_at")
            or status.get("started_at")
        )
        heartbeat = self._parse_status_datetime(heartbeat_at)
        if heartbeat is None:
            # 没有可验证的时间戳时不贸然把可能仍在运行的任务标失败。
            return False
        current = now or datetime.utcnow()
        return (current - heartbeat).total_seconds() > self._processing_lease_timeout_seconds()

    def _refresh_processing_lease(self, processing_id: str, lease_id: str) -> bool:
        """仅由租约持有者续约；返回 False 表示任务已终态或租约归属已变。"""
        if not processing_id or not lease_id:
            return False
        # Redis 优先，避免当前 worker 的陈旧内存覆盖另一 worker 的更新。
        status = self._load_persisted_processing_status(processing_id)
        if status is None:
            status = getattr(self, "_processing_status", {}).get(processing_id)
        if not isinstance(status, dict):
            return False
        if str(status.get("lease_id") or "") != str(lease_id):
            return False
        if not self._is_active_processing_status(status):
            return False

        now = datetime.utcnow()
        status["lease_heartbeat_at"] = now.isoformat()
        status["lease_expires_at"] = (
            now + timedelta(seconds=self._processing_lease_timeout_seconds())
        ).isoformat()
        status["updated_at"] = now.isoformat()
        self._processing_status[processing_id] = status
        self._persist_processing_status(status)
        return True

    def _acquire_processing_lease(self, processing_id: str, lease_id: str) -> bool:
        """为即将启动的后台任务建立唯一 lease。"""
        if not processing_id or not lease_id:
            return False
        status = self._load_persisted_processing_status(processing_id)
        if status is None:
            status = getattr(self, "_processing_status", {}).get(processing_id)
        if not isinstance(status, dict) or not self._is_active_processing_status(status):
            return False
        now = datetime.utcnow()
        status.update({
            "lease_id": lease_id,
            "lease_heartbeat_at": now.isoformat(),
            "lease_expires_at": (
                now + timedelta(seconds=self._processing_lease_timeout_seconds())
            ).isoformat(),
            "updated_at": now.isoformat(),
        })
        self._processing_status[processing_id] = status
        self._persist_processing_status(status)
        return True

    async def _heartbeat_processing_lease(self, processing_id: str, lease_id: str) -> None:
        """让后台任务在整个生命周期（含 semaphore 排队）持续续约。"""
        try:
            while True:
                await asyncio.sleep(self._processing_lease_heartbeat_interval_seconds())
                if not self._refresh_processing_lease(processing_id, lease_id):
                    return
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # 心跳异常不能中断实际上传；后续一次成功状态更新仍会延长 Redis TTL。
            logger.debug("上传任务心跳失败 processing_id={}: {}", processing_id, e)

    def _get_processing_status_redis_client(self) -> Optional[redis.Redis]:
        """返回上传状态 Redis 客户端；不可用时降级内存，不阻塞上传主链路。"""
        cached = getattr(self, "_processing_status_redis_client", None)
        if cached is not None:
            return cached
        try:
            client = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=0.25,
                socket_timeout=0.25,
            )
            self._processing_status_redis_client = client
            return client
        except Exception as e:
            logger.debug("初始化上传状态 Redis 客户端失败，降级进程内状态: {}", e)
            return None

    @staticmethod
    def _processing_status_key(processing_id: str) -> str:
        return f"{PROCESSING_STATUS_KEY_PREFIX}{processing_id}"

    @staticmethod
    def _processing_status_kb_key(kb_id: str) -> str:
        return f"{PROCESSING_STATUS_KB_KEY_PREFIX}{kb_id}"

    @staticmethod
    def _processing_status_file_key(file_id: str) -> str:
        return f"{PROCESSING_STATUS_FILE_KEY_PREFIX}{file_id}"

    def _persist_processing_status(self, status: Dict[str, Any]) -> None:
        """把可恢复的上传任务状态写到 Redis；失败时保留内存降级。"""
        processing_id = str(status.get("processing_id") or "")
        if not processing_id:
            return
        client = self._get_processing_status_redis_client()
        if client is None:
            return
        ttl = self._processing_status_ttl_seconds()
        try:
            payload = json.dumps(status, ensure_ascii=False, default=str, separators=(",", ":"))
            client.setex(self._processing_status_key(processing_id), ttl, payload)
            for kb_id in {
                str(status.get("source_kb_id") or ""),
                str(status.get("kb_id") or ""),
            }:
                if not kb_id:
                    continue
                key = self._processing_status_kb_key(kb_id)
                client.sadd(key, processing_id)
                client.expire(key, ttl)
            file_id = str(status.get("file_id") or "")
            if file_id:
                client.setex(self._processing_status_file_key(file_id), ttl, processing_id)
        except Exception as e:
            logger.debug("持久化上传状态失败 processing_id={}: {}", processing_id, e)

    def _load_persisted_processing_status(self, processing_id: str) -> Optional[Dict[str, Any]]:
        client = self._get_processing_status_redis_client()
        if client is None or not processing_id:
            return None
        try:
            raw = client.get(self._processing_status_key(processing_id))
            if not raw:
                return None
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception as e:
            logger.debug("读取持久化上传状态失败 processing_id={}: {}", processing_id, e)
            return None

    def _lease_expired_failure_status(self, status: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        failed = status.copy()
        failed.update({
            "status": "failed",
            "stage": "error",
            "message": "后台处理租约已超时，任务可能因服务重启或异常退出而未完成。",
            "error": "processing lease expired",
            "failed_at": now,
            "lease_expired_at": now,
            "updated_at": now,
        })
        return failed

    def _recover_expired_processing_status(
        self,
        status: Dict[str, Any],
    ) -> Dict[str, Any]:
        """读取状态时回收失联任务，避免重启后永久显示“排队中/处理中”。

        只回收由后台上传链路创建、带有 lease_id 的任务。当前实例中仍运行的
        task 永远不会被本实例回收；跨 worker 的竞态由 Redis WATCH 再读一次状态
        处理，只有心跳仍然超时才写入 failed。
        """
        processing_id = str(status.get("processing_id") or "")
        if not processing_id or not status.get("lease_id"):
            return status
        if not self._is_processing_lease_expired(status):
            return status

        local_task = getattr(self, "_background_upload_tasks", {}).get(processing_id)
        if local_task is not None and not local_task.done():
            return status

        client = self._get_processing_status_redis_client()
        if client is not None and hasattr(client, "pipeline"):
            key = self._processing_status_key(processing_id)
            # WATCH 避免把另一 worker 刚续约的 lease 误标为失败。
            for _ in range(2):
                pipeline = None
                try:
                    pipeline = client.pipeline()
                    pipeline.watch(key)
                    raw = pipeline.get(key)
                    if not raw:
                        try:
                            pipeline.unwatch()
                        except Exception:
                            pass
                        return status
                    current = json.loads(raw)
                    if not isinstance(current, dict):
                        try:
                            pipeline.unwatch()
                        except Exception:
                            pass
                        return status
                    if not current.get("lease_id") or not self._is_processing_lease_expired(current):
                        try:
                            pipeline.unwatch()
                        except Exception:
                            pass
                        self._processing_status[processing_id] = current
                        return current
                    failed = self._lease_expired_failure_status(current)
                    pipeline.multi()
                    pipeline.setex(
                        key,
                        self._processing_status_ttl_seconds(),
                        json.dumps(failed, ensure_ascii=False, default=str, separators=(",", ":")),
                    )
                    pipeline.execute()
                    self._processing_status[processing_id] = failed
                    return failed
                except Exception as e:
                    # redis-py 的 WatchError 表示另一 worker 更新了状态；重新读取即可。
                    if type(e).__name__ == "WatchError":
                        continue
                    logger.debug("回收过期上传租约失败 processing_id={}: {}", processing_id, e)
                    break
                finally:
                    if pipeline is not None:
                        try:
                            pipeline.reset()
                        except Exception:
                            pass

        # Redis 不支持事务（例如单元测试 FakeRedis）或不可用时，退化为单进程更新。
        # 真正跨 worker 的场景会走上面的 WATCH 分支。
        latest = self._load_persisted_processing_status(processing_id) or status
        if not latest.get("lease_id") or not self._is_processing_lease_expired(latest):
            return latest
        failed = self._lease_expired_failure_status(latest)
        self._processing_status[processing_id] = failed
        self._persist_processing_status(failed)
        return failed

    def list_processing_statuses_for_kb(self, kb_id: str) -> List[Dict[str, Any]]:
        """列出某知识库尚可见的后台任务，供刷新后的文件列表补齐排队项。"""
        if not kb_id:
            return []
        statuses: Dict[str, Dict[str, Any]] = {}
        for status in list(getattr(self, "_processing_status", {}).values()):
            processing_id = str(status.get("processing_id") or "")
            if processing_id and str(status.get("source_kb_id") or status.get("kb_id") or "") == str(kb_id):
                statuses[processing_id] = status.copy()

        client = self._get_processing_status_redis_client()
        if client is not None:
            try:
                ids = client.smembers(self._processing_status_kb_key(str(kb_id))) or set()
                for processing_id in ids:
                    item = self._load_persisted_processing_status(str(processing_id))
                    if item:
                        statuses[str(processing_id)] = item
            except Exception as e:
                logger.debug("读取知识库上传任务集合失败 kb_id={}: {}", kb_id, e)
        recovered = [
            self._recover_expired_processing_status(status)
            for status in statuses.values()
        ]
        return sorted(recovered, key=self._status_recency_timestamp, reverse=True)

    def _get_video_processing_semaphore(self) -> asyncio.Semaphore:
        semaphore = getattr(self, "_video_processing_semaphore", None)
        if semaphore is None:
            concurrency = max(
                1,
                int(getattr(settings, "video_processing_concurrency", 1) or 1),
            )
            semaphore = asyncio.Semaphore(concurrency)
            self._video_processing_semaphore = semaphore
        return semaphore
        
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
            
            # 从桶内收集所有 kb_id 及其数据量（含 text/image/audio/video，以便纯视频/纯音频库一致使用 Qdrant 中的 kb_id）
            try:
                from qdrant_client.http.models import Filter, FieldCondition, MatchValue
                from collections import defaultdict
                
                raw = list(
                    self.minio_adapter.client.list_objects(
                        bucket_name, prefix=None, recursive=True
                    )
                )
                
                kb_id_counts = defaultdict(lambda: {"text": 0, "image": 0, "audio": 0, "video": 0})
                sampled_file_ids = set()
                
                for obj in raw[:80]:  # 采样前 80 个文件（含 videos/uuid/keyframes/ 下多条）
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
                            collection_name=TEXT_CHUNK_COLLECTION,
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
                            discovered_kb_id = p.get("kb_id")
                            if discovered_kb_id:
                                kb_id_counts[discovered_kb_id]["image"] += 1
                    except Exception:
                        pass
                    
                    # audio_vectors
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
                            discovered_kb_id = p.get("kb_id")
                            if discovered_kb_id:
                                kb_id_counts[discovered_kb_id]["audio"] += 1
                    except Exception:
                        pass
                    
                    # 纯视频库时桶内仅有 videos/uuid/keyframes/，需据此反查 kb_id。
                    try:
                        res = self.vector_store.client.scroll(
                            collection_name=VIDEO_SHOT_COLLECTION,
                            scroll_filter=filt,
                            limit=1,
                            with_payload=True,
                        )
                        points = res[0] if res else []
                        if points:
                            p = getattr(points[0], "payload", None) or {}
                            discovered_kb_id = p.get("kb_id")
                            if discovered_kb_id:
                                kb_id_counts[discovered_kb_id]["video"] += 1
                    except Exception:
                        pass
                
                # 选择数据量最大的 kb_id（优先 text > image > audio > video）
                if kb_id_counts:
                    best_kb_id = max(
                        kb_id_counts.items(),
                        key=lambda x: (x[1]["text"], x[1]["image"], x[1]["audio"], x[1]["video"])
                    )[0]
                    
                    if best_kb_id != kb_id:
                        total = sum(kb_id_counts[best_kb_id].values())
                        logger.info(
                            f"桶 {bucket_name} 发现数据量最大的 kb_id: {best_kb_id} "
                            f"(text:{kb_id_counts[best_kb_id]['text']}, image:{kb_id_counts[best_kb_id]['image']}, "
                            f"audio:{kb_id_counts[best_kb_id]['audio']}, video:{kb_id_counts[best_kb_id]['video']})"
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
        asset_map: Optional[Dict[str, bytes]] = None,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        处理文件上传完整流程
        
        Args:
            file_content: 文件二进制内容
            file_path: 文件路径
            kb_id: 知识库ID
            user_id: 用户ID
            processing_id: 可选，由流式上传接口传入以便前端轮询/流式读取进度
            asset_map: 可选，路径 -> 字节 映射，供 Markdown 解析相对路径图片（如文件夹导入时传入）
            source_type: 上传来源标记（如 manual_input），用于前端可编辑判定
            
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
        
        # 初始化处理状态。批量异步入口会先登记 queued 状态；这里转换为实际执行中的
        # processing 状态时保留其文件大小、提交时间等刷新恢复所需的信息。
        previous_status = (
            getattr(self, "_processing_status", {}).get(processing_id)
            or self._load_persisted_processing_status(processing_id)
            or {}
        )
        status_payload = {
            "processing_id": processing_id,
            "status": "processing",
            "progress": 0,
            "stage": "initializing",
            "message": "开始处理文件上传",
            "file_path": file_path,
            # kb_id 是 Qdrant 中实际沿用的 ID；source_kb_id / bucket 用于定位用户原文件。
            "kb_id": actual_kb_id,
            "source_kb_id": kb_id,
            "user_id": user_id,
            "source_type": source_type,
            "file_size": previous_status.get("file_size"),
            "submitted_at": previous_status.get("submitted_at") or datetime.utcnow().isoformat(),
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "error": None
        }
        # 后台 runner 在启动前已取得 lease；转换 queued -> processing 时必须保留它，
        # 否则心跳会失去所有权，重启恢复也无法区分活跃任务。
        for lease_field in ("lease_id", "lease_heartbeat_at", "lease_expires_at"):
            if previous_status.get(lease_field):
                status_payload[lease_field] = previous_status[lease_field]
        self._processing_status[processing_id] = status_payload
        self._persist_processing_status(status_payload)
        
        try:
            # 更新状态：解析中
            self._update_processing_status(processing_id, {
                "progress": 10,
                "stage": "parsing",
                "message": "正在解析文件..."
            })
            
            # 1. 解析文件（asset_map 供 Markdown 相对路径图片解析，如文件夹导入时传入）
            parse_kwargs = dict(asset_map=asset_map) if asset_map else {}
            parse_result = await self.parser_factory.parse_file(file_content, file_path, **parse_kwargs)
            if source_type:
                metadata = parse_result.get("metadata") or {}
                parse_result["metadata"] = {**metadata, "source_type": source_type}
            file_type = parse_result["file_type"]

            # 视频必须先拿到可信时长，才允许写入对象存储并进入 Scene–Shot 解析。
            # 这样 ffprobe/OpenCV 环境异常不会制造“MinIO 有原文件、向量库无索引”的孤儿记录。
            if file_type == "video":
                try:
                    video_duration = float(parse_result.get("duration") or 0.0)
                except (TypeError, ValueError):
                    video_duration = 0.0
                if video_duration <= 0:
                    parse_error = str((parse_result.get("metadata") or {}).get("parse_error") or "未能读取视频时长")
                    raise ValueError(
                        "视频元数据解析失败，文件未写入对象存储："
                        f"{parse_error}。请确认视频文件完整且服务端 ffmpeg/ffprobe 可用。"
                    )
            
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
            
            # 2. 上传到MinIO（若文件名无扩展名则用解析得到的 file_type 补全，便于列表按格式显示如 PDF）
            upload_file_path = file_path
            if not Path(file_path).suffix and file_type:
                upload_file_path = f"{file_path.rstrip('.')}.{file_type}"
            
            # 确定文件类型对应的存储目录
            if file_type in ["pdf", "docx", "pptx", "txt", "md", "excel"]:
                storage_file_type = "documents"
            elif file_type == "image":
                storage_file_type = "images"
            elif file_type == "audio":
                storage_file_type = "audios"
            elif file_type == "video":
                storage_file_type = "videos"
            else:
                storage_file_type = "documents"  # 默认
            
            storage_result = await self.minio_adapter.upload_file(
                file_content=file_content,
                file_path=upload_file_path,
                kb_id=kb_id,
                file_type=storage_file_type
            )

            # 原文件一旦落到 MinIO，就把其稳定 file_id 写入任务状态。文件列表可据此区分
            # “正在解析 / 已失败但原文件可恢复 / 已就绪”，不再把仅存在对象存储中的视频误标为就绪。
            self._update_processing_status(processing_id, {
                "file_id": storage_result.get("file_id"),
                "object_path": storage_result.get("object_path"),
                "bucket": storage_result.get("bucket"),
                "file_type": file_type,
                "storage_persisted": True,
            })
            
            audit_log(
                f"文件上传完成: {storage_result['file_id']}",
                processing_id=processing_id,
                file_id=storage_result["file_id"],
                storage_size=storage_result["size"]
            )
            
            # 3. 根据文件类型处理（使用反查得到的实际 kb_id）
            if file_type in ["pdf", "docx", "pptx", "txt", "md", "excel"]:
                self._update_processing_status(processing_id, {
                    "progress": 40,
                    "stage": "processing",
                    "message": f"正在处理{file_type}文件..."
                })
                result = await self._process_document(
                    parse_result=parse_result,
                    storage_result=storage_result,
                    kb_id=actual_kb_id,
                    processing_id=processing_id,
                    file_path=file_path
                )
            elif file_type == "image":
                self._update_processing_status(processing_id, {
                    "progress": 40,
                    "stage": "processing",
                    "message": "正在处理image文件..."
                })
                result = await self._process_image(
                    parse_result=parse_result,
                    storage_result=storage_result,
                    kb_id=actual_kb_id,
                    processing_id=processing_id
                )
            elif file_type == "audio":
                self._update_processing_status(processing_id, {
                    "progress": 40,
                    "stage": "processing",
                    "message": "正在处理audio文件..."
                })
                result = await self._process_audio(
                    parse_result=parse_result,
                    storage_result=storage_result,
                    kb_id=actual_kb_id,
                    processing_id=processing_id,
                    file_content=file_content
                )
            elif file_type == "video":
                # 多视频批量提交时，原文件已经各自落入 MinIO；重型 MLLM + 关键帧
                # 链路按受控并发消费。后续任务明确显示“排队中”，而不是在刷新后消失。
                self._update_processing_status(processing_id, {
                    "status": "queued",
                    "progress": 40,
                    "stage": "queued",
                    "message": "视频已上传，等待 Scene–Shot 解析队列…",
                })
                # 原文件已安全写入 MinIO，释放请求体大字节；视频处理会从 MinIO 回读。
                file_content = b""
                async with self._get_video_processing_semaphore():
                    self._update_processing_status(processing_id, {
                        "status": "processing",
                        "progress": 40,
                        "stage": "processing",
                        "message": "正在执行 Scene–Shot 多模态解析…",
                    })
                    result = await self._process_video(
                        parse_result=parse_result,
                        storage_result=storage_result,
                        kb_id=actual_kb_id,
                        processing_id=processing_id,
                        file_content=file_content,
                    )
            else:
                raise ValueError(f"不支持的文件类型: {file_type}")

            # 4. 画像触发：视频以 Scene–Shot 为索引，短视频往往少于通用 Chunk 阈值。
            # 因此只要成功写入 Shot 就强制异步刷新画像；其他模态保持原来的增量阈值策略。
            try:
                if file_type == "video":
                    from app.core.portrait_trigger import trigger_portrait_rebuild

                    shots_count = int(result.get("shots_count", 0) or 0)
                    if shots_count > 0:
                        trigger_portrait_rebuild(actual_kb_id, reason="video_ingested")
                else:
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

            # 5. 推荐问题入池：文件入库后基于该文件生成一批问题并写入知识库问题池
            try:
                from app.modules.knowledge.suggested_questions import generate_questions_for_file_and_store
                generated_file_id = str(result.get("file_id") or "")
                generated_file_name = str(file_path or "")
                if generated_file_id:
                    asyncio.create_task(
                        generate_questions_for_file_and_store(
                            kb_id,
                            generated_file_id,
                            file_name=generated_file_name,
                            max_questions=20,
                            use_llm=True,
                        )
                    )
            except Exception as e:
                logger.warning("推荐问题入池触发失败 kb_id=%s: %s", actual_kb_id, e)
            
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
        if parse_result.get("file_type") in ["pdf", "docx", "pptx", "md"] and "extracted_images" in parse_result:
            extracted_images = parse_result.get("extracted_images", [])
            if extracted_images:
                logger.info(f"发现 {len(extracted_images)} 张从文档提取的图片，开始处理")
                self._update_processing_status(processing_id, {
                    "stage": "processing_images",
                    "progress": 25,
                    "message": f"正在处理文档中的 {len(extracted_images)} 张图片..."
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
                        image_source_type = "markdown_extracted" if parse_result.get("file_type") == "md" else "pdf_extracted"
                        image_result = await self._process_image(
                            parse_result=image_parse_result,
                            storage_result=image_storage_result,
                            kb_id=kb_id,
                            processing_id=processing_id,
                            image_source_type=image_source_type,
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
                        logger.info(f"文档内图片处理完成: {image_filename}, 向量数: {image_result.get('vectors_stored', 0)}")
                        
                    except Exception as e:
                        logger.error(f"处理 PDF 图片失败 (第 {img_info.get('page', '?')} 页第 {img_info.get('image_index', '?')} 张): {str(e)}", exc_info=True)
                        continue
                
                logger.info(f"文档内图片处理完成: {extracted_images_count}/{len(extracted_images)} 张图片成功处理")
        
        # 1. 用「补全后的 markdown」做文本分块：将 VLM 图注插回占位符后再 chunk
        # 按原文位置从后往前替换，避免图注内容中若含其它图片的 ref 串时被误替换导致重复/嵌套
        parse_result_for_chunking = parse_result
        if caption_replacements and parse_result.get("markdown"):
            full_md = parse_result["markdown"]
            search_start = 0
            items: List[tuple] = []  # (pos, ref, replacement)
            for ref, vlm_caption in caption_replacements:
                pos = full_md.find(ref, search_start)
                if pos < 0:
                    continue
                replacement = f"\n\n[图注：{vlm_caption}]\n\n"
                items.append((pos, ref, replacement))
                search_start = pos + len(ref)
            items.sort(key=lambda x: x[0], reverse=True)
            enriched_markdown = full_md
            for pos, ref, replacement in items:
                enriched_markdown = enriched_markdown[:pos] + replacement + enriched_markdown[pos + len(ref) :]
            parse_result_for_chunking = {**parse_result, "markdown": enriched_markdown}
            logger.info("已将 {} 条 VLM 图注插回 Markdown，使用补全后的文本进行分块", len(items))
        # Excel/CSV 保留其行块/列画像专用策略；其余文档进入 Agentic
        # Chunker。模型只规划原子单元范围，原文由服务端无损物化。
        if parse_result_for_chunking.get("file_type") == "excel" and parse_result_for_chunking.get("sheets"):
            chunks = await self._build_excel_chunks(parse_result_for_chunking)
        else:
            chunks = await self.agentic_document_chunker.chunk_parse_result(
                parse_result_for_chunking
            )
        
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
        logger.info("开始 CLIP 图片向量化 (processing_id={})", processing_id)
        clip_input_data = {
            "image_bytes": image_bytes,
            "width": parse_result.get("width"),
            "height": parse_result.get("height"),
            "format": parse_result.get("format")
        }
        clip_result = await self._vectorize_with_clip(clip_input_data, processing_id)
        logger.info("CLIP 图片向量化完成: 维度={} (processing_id={})", clip_result.get("vector_dim", 768), processing_id)
        
        # 3. 文本向量化描述（空描述用占位符，避免部分 API 对空输入返回 5xx）
        caption = (caption_result.get("caption") or "").strip()
        text_to_embed = caption if caption else " "
        self._update_processing_status(processing_id, {"message": "文本向量化"})
        logger.info("开始文本向量化（图片描述） (processing_id={})", processing_id)
        text_vector_result = await self._vectorize_text([text_to_embed])
        logger.info("文本向量化完成: 向量数={} (processing_id={})", len(text_vector_result.get("vectors", [])), processing_id)
        
        # 4. 存储到向量数据库（PDF 解析图写入 source_file_id，markdown_ref 供预览时替换为可访问图片 URL）
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
        if markdown_ref is not None:
            image_data[0]["markdown_ref"] = markdown_ref
        
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
    
    async def _process_audio(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_content: bytes
    ) -> Dict[str, Any]:
        """处理音频文件"""
        try:
            self._update_processing_status(processing_id, {
                "stage": "transcribing",
                "progress": 30,
                "message": "音频转文本(ASR)...",
            })
            
            # 1. 音频转文本(ASR)；一步 MLLM 可同时返回 transcript + description
            audio_format = parse_result.get("format", "mp3")
            transcript_result = await self._transcribe_audio(file_content, audio_format, processing_id)
            transcript = transcript_result.get("transcript", "")
            description = transcript_result.get("description")
            
            # 2. 若一步 MLLM 未返回 description，则回退到基于 transcript 的文本 LLM 生成描述
            if not description or not description.strip():
                self._update_processing_status(processing_id, {
                    "stage": "describing",
                    "progress": 50,
                    "message": "生成音频描述...",
                })
                description = await self._generate_audio_description(
                    file_content,
                    transcript,
                    audio_format,
                    processing_id
                )
            
            # 3. 文本向量化（transcript + description）
            self._update_processing_status(processing_id, {
                "stage": "vectorizing",
                "progress": 70,
                "message": "音频文本向量化...",
            })
            
            combined_text = f"{transcript}\n{description}".strip()
            if not combined_text:
                combined_text = "音频文件"  # 占位符
            
            # 生成密集向量
            embed_result = await self.llm_manager.embed(
                texts=[combined_text],
                task_type="embedding"
            )
            if not embed_result.success:
                raise ValueError(f"音频文本向量化失败: {embed_result.error}")
            
            text_vector = embed_result.data[0] if isinstance(embed_result.data, list) else embed_result.data
            
            # 生成稀疏向量（与 text chunk 一致：存 Dict[int, float]）
            sparse_result = self.sparse_encoder.encode_query(combined_text)
            sparse_vector = sparse_result.get("sparse") if sparse_result else None
            
            # 3.5 CLAP 声学特征（与 text_vec 同点存储）
            self._update_processing_status(processing_id, {
                "stage": "clap",
                "progress": 78,
                "message": "提取音频声学特征(CLAP)...",
            })
            loop = asyncio.get_event_loop()
            try:
                clap_vector = await loop.run_in_executor(
                    None,
                    lambda: self._extract_audio_clap_features(file_content, audio_format),
                )
            except Exception as e:
                logger.warning("CLAP 特征提取失败，使用零向量占位: {}", e)
                clap_vector = [0.0] * 512
            
            # 4. 存储到Qdrant（同一 Point：text_vec + clap_vec + sparse）
            self._update_processing_status(processing_id, {
                "stage": "storing",
                "progress": 85,
                "message": "存储音频向量...",
            })
            
            audio_data = {
                "file_id": storage_result["file_id"],
                "file_path": storage_result["object_path"],
                "transcript": transcript,
                "description": description,
                "duration": parse_result.get("duration", 0.0),
                "audio_format": audio_format,
                "sample_rate": parse_result.get("sample_rate", 0),
                "channels": parse_result.get("channels", 0),
                "bitrate": parse_result.get("bitrate", 0),
                "source_type": "standalone_file",
                "text_vector": text_vector,
                "clap_vector": clap_vector,
            }
            if sparse_vector:
                audio_data["sparse_vector"] = sparse_vector
            
            vector_storage_result = await self.vector_store.upsert_audio_vectors(
                kb_id=kb_id,
                audios=[audio_data]
            )
            
            return {
                "processing_id": processing_id,
                "status": "completed",
                "file_id": storage_result["file_id"],
                "transcript": transcript,
                "description": description,
                "vectors_stored": vector_storage_result["points_inserted"],
                "file_type": "audio"
            }
            
        except Exception as e:
            try:
                err_msg = str(e)
            except (KeyError, TypeError, AttributeError):
                err_msg = repr(e)[:500]
            logger.error("音频处理失败: %s", err_msg, exc_info=True)
            raise
    
    async def _process_video(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_content: bytes
    ) -> Dict[str, Any]:
        """处理视频文件：Omni 联合理解画面和音频，Shot 为主检索单元。"""
        try:
            return await self._process_video_scene_shot(
                parse_result=parse_result,
                storage_result=storage_result,
                kb_id=kb_id,
                processing_id=processing_id,
                file_content=file_content,
            )
        except Exception as e:
            logger.error("视频处理失败: {}", e, exc_info=True)
            raise

    async def _process_video_scene_shot(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_content: bytes,
    ) -> Dict[str, Any]:
        """Scene–Shot–ASR 视频入库。

        Qwen Omni 在同一次视频调用内理解画面和音频；不再先抽取 MP3 再单独转写，避免
        ASR 与视觉片段的时间轴错位。长视频按窗口解析，最终只将 Shot 写入主检索集合。
        """
        duration = max(0.0, float(parse_result.get("duration", 0.0) or 0.0))
        file_id = storage_result["file_id"]
        file_path = storage_result["object_path"]
        # Qdrant 的 kb_id 可能因历史迁移与前端/MinIO 桶名不同。派生 manifest、关键帧
        # 必须跟原视频写入 storage_result 所在的同一个桶，否则文件列表、封面和删除会分裂。
        storage_kb_id = str(storage_result.get("bucket") or kb_id)
        video_format = parse_result.get("format", "mp4")
        resolution = parse_result.get("resolution", "")
        fps = float(parse_result.get("fps", 0.0) or 0.0)
        has_audio = bool(parse_result.get("has_audio", False))
        if duration <= 0:
            raise ValueError("视频时长无效，无法执行 Scene–Shot 解析")

        self._update_processing_status(processing_id, {
            "stage": "parsing",
            "progress": 20,
            "message": "Qwen Omni 正在联合解析视频画面、场景、镜头与语音…",
        })

        video_bytes = file_content or b""
        if len(video_bytes) < 1000:
            try:
                bucket = storage_result.get("bucket")
                object_path = storage_result.get("object_path")
                if bucket and object_path:
                    video_bytes = await self.minio_adapter.get_file_content(bucket, object_path)
            except Exception as e:
                logger.warning("从 MinIO 回读视频用于 Scene–Shot 解析失败: {}", e)

        import tempfile

        full_video_path: Optional[str] = None
        fd = -1
        try:
            if video_bytes:
                fd, full_video_path = tempfile.mkstemp(suffix=f".{video_format or 'mp4'}")
                # os.write 允许部分写入；视频文件较大时必须通过文件对象保证完整落盘。
                with os.fdopen(fd, "wb") as temp_video:
                    fd = -1
                    temp_video.write(video_bytes)
        except Exception as e:
            logger.warning("写入视频临时文件失败，将尝试 URL 解析: {}", e)
            if full_video_path:
                try:
                    os.unlink(full_video_path)
                except OSError:
                    pass
            full_video_path = None
        finally:
            if fd >= 0:
                try:
                    os.close(fd)
                except Exception:
                    pass

        video_url: Optional[str] = None
        if not full_video_path:
            try:
                bucket = storage_result.get("bucket")
                object_path = storage_result.get("object_path")
                if bucket and object_path:
                    video_url = await self.minio_adapter.get_presigned_url(bucket, object_path, expires_hours=2)
            except Exception as e:
                logger.warning("获取视频 presigned URL 失败: {}", e)

        configured_window = float(getattr(settings, "video_chunk_window_seconds", 240.0) or 240.0)
        configured_max = float(getattr(settings, "video_max_chunk_duration_seconds", 240.0) or 240.0)
        max_chunk = max(30.0, min(configured_window, configured_max))
        configured_threshold = float(getattr(settings, "video_long_threshold_seconds", max_chunk) or max_chunk)
        chunk_threshold = max(30.0, min(configured_threshold, max_chunk))
        overlap = max(0.0, min(60.0, float(getattr(settings, "video_chunk_overlap_seconds", 15.0) or 15.0)))
        source_video_fps = min(2, max(1, int(fps))) if fps > 0 else 2
        # 长视频的语义切分不需要把每秒两张画面都传给 Omni。降低到 1fps 能显著
        # 缩短窗口请求的输入规模；Shot 内的关键帧仍由 MLLM 基于实际视觉变化决定。
        long_video_fps = max(
            1,
            min(
                source_video_fps,
                int(getattr(settings, "video_long_parsing_fps", 1) or 1),
            ),
        )
        video_fps = long_video_fps if duration > chunk_threshold else source_video_fps
        analysis: Optional[Dict[str, Any]] = None

        try:
            if duration <= chunk_threshold or not full_video_path:
                # 本地文件优先；没有可落盘内容时，仍可让 provider 尝试可访问的 presigned URL。
                analysis = await self._parse_video_scene_shot_mllm(
                    duration=duration,
                    processing_id=processing_id,
                    video_local_path=full_video_path,
                    video_url=video_url,
                    video_fps=video_fps,
                    previous_segments_summary=None,
                )
            else:
                analyses: List[Dict[str, Any]] = []
                failed_chunks: List[Tuple[float, float]] = []
                step = max(1.0, max_chunk - overlap)
                chunk_start = 0.0
                chunk_index = 0
                previous_context = "（本段为视频首段，无前文。）"
                while chunk_start < duration:
                    chunk_duration = min(max_chunk, duration - chunk_start)
                    if chunk_duration <= 0:
                        break
                    # 精确转码切段会阻塞；放在线程中避免阻塞上传 API 的事件循环。
                    segment_path = await asyncio.to_thread(
                        self._extract_video_segment_to_file,
                        full_video_path,
                        chunk_start,
                        chunk_duration,
                    )
                    if not segment_path:
                        logger.warning("Scene–Shot 长视频切段失败: start={:.1f} duration={:.1f}", chunk_start, chunk_duration)
                        failed_chunks.append((chunk_start, chunk_start + chunk_duration))
                        chunk_start += step
                        chunk_index += 1
                        continue
                    try:
                        self._update_processing_status(processing_id, {
                            "stage": "parsing",
                            "progress": min(65, 20 + int(45 * min(1.0, (chunk_start + chunk_duration) / duration))),
                            "message": f"Qwen Omni 正在解析第 {chunk_index + 1} 段（{chunk_start:.0f}–{chunk_start + chunk_duration:.0f} 秒）…",
                        })
                        local_analysis = await self._parse_video_scene_shot_mllm(
                            duration=chunk_duration,
                            processing_id=processing_id,
                            video_local_path=segment_path,
                            video_url=None,
                            video_fps=video_fps,
                            previous_segments_summary=previous_context,
                        )
                        if local_analysis:
                            shifted = shift_video_analysis(local_analysis, chunk_start)
                            analyses.append(shifted)
                            previous_context = build_previous_context(shifted)
                        else:
                            logger.warning("Scene–Shot 长视频第 {} 段未获得有效模型结果", chunk_index + 1)
                            failed_chunks.append((chunk_start, chunk_start + chunk_duration))
                    finally:
                        try:
                            os.unlink(segment_path)
                        except OSError:
                            pass
                    chunk_start += step
                    chunk_index += 1
                if failed_chunks:
                    ranges = ", ".join(f"{start:.0f}–{end:.0f} 秒" for start, end in failed_chunks[:3])
                    suffix = "…" if len(failed_chunks) > 3 else ""
                    raise RuntimeError(
                        "视频 Scene–Shot 解析不完整，未写入任何检索向量；"
                        f"失败片段：{ranges}{suffix}。请稍后重试。"
                    )
                if analyses:
                    analysis = merge_chunk_analyses(
                        analyses,
                        duration=duration,
                        overlap_seconds=overlap,
                        max_keyframes_per_shot=max(
                            1,
                            int(getattr(settings, "video_max_keyframes_per_shot", 4) or 4),
                        ),
                        keyframe_min_gap_seconds=max(
                            0.0,
                            float(getattr(settings, "video_keyframe_min_gap_seconds", 1.0) or 0.0),
                        ),
                    )
        finally:
            if full_video_path and os.path.exists(full_video_path):
                try:
                    os.unlink(full_video_path)
                except OSError:
                    pass

        if not analysis or not analysis.get("scenes"):
            # 不能用通用单 Shot 伪装为已解析：那会让列表显示 ready，却没有真实视觉/ASR 证据。
            raise RuntimeError(
                "视频多模态解析未返回有效的 Scene–Shot 结果，原始视频已保留；请稍后重试。"
            )

        self._update_processing_status(processing_id, {
            "stage": "vectorizing",
            "progress": 72,
            "message": "正在构建 Shot 的四路向量并提取关键帧…",
        })
        manifest_path = f"videos/{file_id}/analysis/{SCHEMA_VERSION}.json"
        vector_data = await self._build_video_scene_shot_points(
            video_bytes=video_bytes,
            analysis=analysis,
            file_id=file_id,
            file_path=file_path,
            manifest_path=manifest_path,
            storage_kb_id=storage_kb_id,
            duration=duration,
            video_format=video_format,
            resolution=resolution,
            fps=fps,
            has_audio=has_audio,
            processing_id=processing_id,
        )

        if not vector_data["shot_points"]:
            raise RuntimeError("视频 Scene–Shot 解析未生成可检索 Shot，未写入向量。")

        manifest = {
            "schema_version": SCHEMA_VERSION,
            "file_id": file_id,
            "file_path": file_path,
            "duration": duration,
            "analysis": analysis,
        }
        await self.minio_adapter.upload_file(
            file_content=json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            file_path=f"{file_id}_scene_shot_asr.json",
            kb_id=storage_kb_id,
            file_type="videos",
            custom_object_path=manifest_path,
            file_id_override=file_id,
        )

        self._update_processing_status(processing_id, {
            "stage": "storing",
            "progress": 90,
            "message": "正在存储 Scene–Shot 与关键帧向量…",
        })
        # 重试前清除同文件的 Shot 与关键帧，避免同一视频的处理结果累积。删除失败时
        # 保留旧索引并失败退出，不能让新旧结果混杂后误报 ready。
        if not self.vector_store.delete_video_points_by_file_id(kb_id, file_id):
            raise RuntimeError("清理旧视频索引失败，未写入新的 Scene–Shot 向量。")
        try:
            shot_storage = await self.vector_store.upsert_video_shot_vectors(
                kb_id, vector_data["shot_points"]
            )
            frame_storage = await self.vector_store.upsert_video_keyframe_vectors(
                kb_id, vector_data["keyframe_points"]
            )
        except Exception:
            # Qdrant 无跨 collection 事务；写入任一集合失败时补偿清理本次残留，
            # 让状态明确为 failed，而不是留下部分 Shot/关键帧并被列表误判 ready。
            if not self.vector_store.delete_video_points_by_file_id(kb_id, file_id):
                logger.error("补偿清理失败: kb_id={} file_id={}", kb_id, file_id)
            raise
        await self._cleanup_stale_video_keyframes(
            storage_kb_id,
            file_id,
            {
                str(point.get("payload", {}).get("frame_image_path") or "")
                for point in vector_data["keyframe_points"]
            },
        )
        shots_count = len(vector_data["shot_points"])
        frames_count = len(vector_data["keyframe_points"])
        summary = (analysis.get("video_summary") or "")[:300]
        return {
            "processing_id": processing_id,
            "status": "completed",
            "file_id": file_id,
            "description": summary,
            "schema_version": SCHEMA_VERSION,
            "scene_count": len(analysis.get("scenes") or []),
            "shots_count": shots_count,
            "key_frames_count": frames_count,
            "manifest_path": manifest_path,
            "vectors_stored": shot_storage.get("points_inserted", 0) + frame_storage.get("points_inserted", 0),
            "file_type": "video",
        }

    async def _cleanup_stale_video_keyframes(
        self,
        storage_kb_id: str,
        file_id: str,
        active_paths: set[str],
    ) -> None:
        """在新索引成功后移除重试遗留的关键帧对象，避免封面取到过期帧。"""
        try:
            bucket = self.minio_adapter.get_bucket_for_kb(storage_kb_id)
            prefix = f"videos/{file_id}/keyframes/"
            objects = await self.minio_adapter.list_files(bucket=bucket, prefix=prefix, max_keys=10000)
            for obj in objects:
                object_path = str(obj.get("object_path") or "")
                if object_path.startswith(prefix) and object_path not in active_paths:
                    await self.minio_adapter.delete_file(bucket, object_path)
        except Exception as cleanup_error:
            # 索引已成功，清理失败不应让视频从 ready 回退；下次重试仍会再次尝试收敛。
            logger.warning("清理视频旧关键帧失败 file_id={}: {}", file_id, cleanup_error)

    async def _parse_video_scene_shot_mllm(
        self,
        duration: float,
        processing_id: str,
        *,
        video_local_path: Optional[str] = None,
        video_url: Optional[str] = None,
        video_fps: int = 2,
        previous_segments_summary: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """调用 MLLM 并将 v4 JSON 规范化为稳定的 Scene–Shot 结构。"""
        previous_context = (previous_segments_summary or "").strip() or "（本段为视频首段，无前文。）"
        prompt_text = prompt_engine.render_template(
            "video_scene_shot_parsing",
            chunk_duration_seconds=round(float(duration), 3),
            previous_segments_summary=previous_context,
        )
        if video_local_path and os.path.exists(video_local_path):
            source = "video_local"
            source_content: Dict[str, Any] = {"type": "video_local", "path": video_local_path, "fps": video_fps}
        elif video_url:
            source = "video_url"
            source_content = {"type": "video_url", "video_url": {"url": video_url}, "fps": video_fps}
        else:
            logger.warning("Scene–Shot 解析未提供视频文件或 URL")
            return None
        retry_attempts = max(0, int(getattr(settings, "video_parsing_retry_attempts", 1) or 0))
        for attempt in range(retry_attempts + 1):
            retry_instruction = ""
            if attempt:
                retry_instruction = (
                    "\n\n# 格式恢复重试\n"
                    "上一次结果不是完整 JSON。请减少非必要 Scene/Shot 的拆分和描述长度，"
                    "但保留完整语句边界与 ASR；务必在输出上限内闭合全部 JSON 括号。"
                )
            content: List[Dict[str, Any]] = [
                source_content,
                {"type": "text", "text": f"{prompt_text}{retry_instruction}"},
            ]
            try:
                result = await self.llm_manager.chat(
                    messages=[{"role": "user", "content": content}],
                    task_type="video_parsing",
                    timeout=600,
                    max_tokens=getattr(settings, "video_parsing_max_tokens", 16000),
                    temperature=getattr(settings, "video_parsing_temperature", 0.1),
                )
            except Exception as e:
                logger.warning(
                    "Scene–Shot MLLM 调用失败（{}，第 {}/{} 次）: {}",
                    source,
                    attempt + 1,
                    retry_attempts + 1,
                    e,
                )
                continue
            if not result.success or not result.data:
                logger.warning(
                    "Scene–Shot MLLM 调用未成功（{}，第 {}/{} 次）: {}",
                    source,
                    attempt + 1,
                    retry_attempts + 1,
                    result.error,
                )
                continue
            raw = result.data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if isinstance(raw, list):
                raw = "".join(
                    (part.get("text") or part.get("content") or str(part)) if isinstance(part, dict) else str(part)
                    for part in raw
                )
            data = extract_json_object(raw)
            if data and isinstance(data.get("scenes"), list):
                return normalize_video_analysis(
                    data,
                    duration,
                    max_keyframes_per_shot=max(
                        1,
                        int(getattr(settings, "video_max_keyframes_per_shot", 4) or 4),
                    ),
                    keyframe_min_gap_seconds=max(
                        0.0,
                        float(getattr(settings, "video_keyframe_min_gap_seconds", 1.0) or 0.0),
                    ),
                )
            logger.warning(
                "Scene–Shot MLLM JSON 解析失败（{}，第 {}/{} 次），返回前 500 字符: {}",
                source,
                attempt + 1,
                retry_attempts + 1,
                (str(raw)[:500] + "...") if raw else "(空)",
            )
        return None

    @staticmethod
    def _select_video_keyframes_for_processing(
        shot_rows: List[Tuple[Dict[str, Any], Dict[str, Any]]],
        max_keyframes: int,
    ) -> List[Tuple[int, Dict[str, Any], Dict[str, Any], int, Dict[str, Any]]]:
        """在全视频预算内公平选择 MLLM 已选关键帧。

        不是按时间直接截断（那会让后半段视频完全没有视觉证据）。先遍历每个
        Shot 的第 1 张帧，再遍历每个 Shot 的第 2 张帧，以此类推；因此预算足够
        时每个 Shot 都至少有一张关键帧，预算不足时也会尽量均匀覆盖整段视频。
        """
        limit = max(1, int(max_keyframes or 1))
        per_shot_frames: List[List[Tuple[int, Dict[str, Any]]]] = []
        max_frames_in_shot = 0
        for _scene, shot in shot_rows:
            frames = [
                (frame_index, frame)
                for frame_index, frame in enumerate(shot.get("keyframes") or [])
                if isinstance(frame, dict)
            ]
            per_shot_frames.append(frames)
            max_frames_in_shot = max(max_frames_in_shot, len(frames))

        first_frames: List[Tuple[int, Dict[str, Any], Dict[str, Any], int, Dict[str, Any]]] = []
        for row_index, (scene, shot) in enumerate(shot_rows):
            if not per_shot_frames[row_index]:
                continue
            original_index, frame = per_shot_frames[row_index][0]
            first_frames.append((row_index, scene, shot, original_index, frame))

        # Shot 数本身超过预算时，不能简单取前 N 个，否则长视频后半段完全没有
        # 视觉证据。沿时间轴等距保留代表 Shot，优先保证全片覆盖。
        if len(first_frames) > limit:
            if limit == 1:
                return [first_frames[len(first_frames) // 2]]
            selected_indices: List[int] = []
            previous_index = -1
            last_index = len(first_frames) - 1
            for selected_index in range(limit):
                desired = round(selected_index * last_index / (limit - 1))
                index = max(previous_index + 1, min(last_index, desired))
                selected_indices.append(index)
                previous_index = index
            return [first_frames[index] for index in selected_indices]

        selected = list(first_frames)
        for round_index in range(1, max_frames_in_shot):
            for row_index, (scene, shot) in enumerate(shot_rows):
                frames = per_shot_frames[row_index]
                if round_index >= len(frames):
                    continue
                original_index, frame = frames[round_index]
                selected.append((row_index, scene, shot, original_index, frame))
                if len(selected) >= limit:
                    return selected
        return selected

    async def _build_video_scene_shot_points(
        self,
        video_bytes: bytes,
        analysis: Dict[str, Any],
        file_id: str,
        file_path: str,
        manifest_path: str,
        storage_kb_id: str,
        duration: float,
        video_format: str,
        resolution: str,
        fps: float,
        has_audio: bool,
        processing_id: str,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """由规范化分析构建 Shot 四路向量和其从属关键帧向量。"""
        shot_rows = list(iter_shots(analysis))
        if not shot_rows:
            return {"shot_points": [], "keyframe_points": []}
        captions = [str(shot.get("caption") or scene.get("scene_summary") or "视频片段内容。") for scene, shot in shot_rows]
        caption_vectors = await self._embed_video_texts(captions, label="Shot caption")
        vector_dimension = len(caption_vectors[0]) if caption_vectors else 4096
        if vector_dimension <= 0:
            vector_dimension = 4096

        asr_vectors: List[List[float]] = [[0.0] * vector_dimension for _ in shot_rows]
        asr_positions = [index for index, (_, shot) in enumerate(shot_rows) if (shot.get("asr_text") or "").strip()]
        if asr_positions:
            try:
                returned = await self._embed_video_texts(
                    [str(shot_rows[index][1].get("asr_text") or "") for index in asr_positions],
                    label="Shot ASR",
                )
                for position, vector in zip(asr_positions, returned):
                    asr_vectors[position] = vector
            except Exception as asr_embed_error:
                logger.warning("Shot ASR 向量化失败，保留 caption 检索及无 ASR 向量: {}", asr_embed_error)

        caption_sparse: List[Dict[int, float]] = [{} for _ in shot_rows]
        asr_sparse: List[Dict[int, float]] = [{} for _ in shot_rows]
        try:
            caption_sparse_raw = await asyncio.to_thread(self.sparse_encoder.encode_corpus, captions)
            for index, item in enumerate(caption_sparse_raw or []):
                caption_sparse[index] = (item or {}).get("sparse", {}) or {}
            if asr_positions:
                asr_sparse_raw = await asyncio.to_thread(
                    self.sparse_encoder.encode_corpus,
                    [str(shot_rows[index][1].get("asr_text") or "") for index in asr_positions],
                )
                for position, item in zip(asr_positions, asr_sparse_raw or []):
                    asr_sparse[position] = (item or {}).get("sparse", {}) or {}
        except Exception as e:
            # 稀疏编码器是召回增强而不是写入硬依赖；密集向量仍保证视频可用。
            logger.warning("Shot 稀疏向量化失败，本次仅写入 dense 向量: {}", e)

        # MLLM 可按每个 Shot 的视觉变化选择多张帧，但长视频的 Shot 数量很大时，
        # 不能无上限地把「Shot 数 × 每 Shot 帧数」送入 CLIP。预算选择器优先保留
        # 所有 Shot 的首帧，再公平补充额外帧，避免只覆盖视频前半段。
        all_mllm_keyframes = sum(
            len([frame for frame in (shot.get("keyframes") or []) if isinstance(frame, dict)])
            for _scene, shot in shot_rows
        )
        keyframe_budget = max(
            1,
            int(getattr(settings, "video_max_keyframes_per_video", 192) or 192),
        )
        selected_frame_candidates = self._select_video_keyframes_for_processing(
            shot_rows,
            keyframe_budget,
        )
        if all_mllm_keyframes > len(selected_frame_candidates):
            logger.info(
                "视频关键帧应用全局预算: MLLM 选择 {} 张，实际处理 {} 张（预算 {}）",
                all_mllm_keyframes,
                len(selected_frame_candidates),
                keyframe_budget,
            )

        # 所有关键帧共用同一个临时视频文件。此前每抽一帧都写一次完整视频，长视频会产生
        # 成倍的磁盘 I/O，且容易让入库耗时随 Shot 数量线性恶化。
        frame_source_path: Optional[str] = None
        if video_bytes:
            try:
                import tempfile

                with tempfile.NamedTemporaryFile(delete=False, suffix=f".{video_format or 'mp4'}") as temp_video:
                    frame_source_path = temp_video.name
                    temp_video.write(video_bytes)
            except Exception as source_error:
                logger.warning("写入关键帧提取临时视频失败: {}", source_error)

        frame_rows: List[Dict[str, Any]] = []
        total_selected_frames = len(selected_frame_candidates)
        if total_selected_frames:
            self._update_processing_status(processing_id, {
                "stage": "extracting_keyframes",
                "progress": 72,
                "message": f"正在抽取并保存 MLLM 选择的关键帧（0/{total_selected_frames}）…",
            })

        async def _extract_and_upload_frame(
            candidate: Tuple[int, Dict[str, Any], Dict[str, Any], int, Dict[str, Any]],
        ) -> Optional[Dict[str, Any]]:
            row_index, scene, shot, frame_index, frame = candidate
            try:
                fallback_timestamp = (float(shot.get("start_time", 0) or 0) + float(shot.get("end_time", 0) or 0)) / 2
                try:
                    timestamp = float(frame.get("timestamp", fallback_timestamp))
                except (TypeError, ValueError):
                    timestamp = fallback_timestamp
                frame_description = str(frame.get("description") or shot.get("caption") or "视频关键帧。")
                frame_bytes = (
                    await asyncio.to_thread(
                        self._extract_frame_at_timestamp_from_path,
                        frame_source_path,
                        timestamp,
                    )
                    if frame_source_path
                    else None
                )
                if not frame_bytes:
                    return None

                safe_timestamp = f"{timestamp:.3f}".replace(".", "_")
                frame_path = (
                    f"videos/{file_id}/keyframes/"
                    f"{scene.get('scene_id')}_{shot.get('shot_id')}_{frame_index}_{safe_timestamp}.jpg"
                )
                try:
                    await self.minio_adapter.upload_file(
                        file_content=frame_bytes,
                        file_path="frame.jpg",
                        kb_id=storage_kb_id,
                        file_type="videos",
                        custom_object_path=frame_path,
                        file_id_override=file_id,
                    )
                except Exception as upload_error:
                    logger.warning("视频关键帧上传失败: {}", upload_error)
                    return None

                # 只有帧真正提取并上传成功时，才将其作为可检索视觉证据写入。
                # 否则会留下空路径/零 CLIP 向量，检索命中后无法展示。
                frame["timestamp"] = timestamp
                frame["description"] = frame_description
                frame["frame_image_path"] = frame_path
                return {
                    "row_index": row_index,
                    "scene": scene,
                    "shot": shot,
                    "frame": frame,
                    "frame_bytes": frame_bytes,
                }
            except Exception as frame_error:
                logger.warning("视频关键帧抽取失败: {}", frame_error)
                return None

        try:
            concurrency = max(
                1,
                int(getattr(settings, "video_keyframe_processing_concurrency", 4) or 4),
            )
            for batch_start in range(0, total_selected_frames, concurrency):
                batch = selected_frame_candidates[batch_start: batch_start + concurrency]
                results = await asyncio.gather(
                    *(_extract_and_upload_frame(candidate) for candidate in batch),
                    return_exceptions=False,
                )
                frame_rows.extend(row for row in results if row is not None)
                completed = min(total_selected_frames, batch_start + len(batch))
                self._update_processing_status(processing_id, {
                    "stage": "extracting_keyframes",
                    "progress": min(79, 72 + int(7 * completed / max(1, total_selected_frames))),
                    "message": (
                        f"正在抽取并保存 MLLM 选择的关键帧（{completed}/{total_selected_frames}，"
                        f"成功 {len(frame_rows)}）…"
                    ),
                })
                # 即使底层 I/O 极快，也给心跳、进度接口和其他请求一个调度机会。
                await asyncio.sleep(0)
        finally:
            if frame_source_path:
                try:
                    os.unlink(frame_source_path)
                except OSError:
                    pass

        frame_vectors: List[List[float]] = []
        if frame_rows:
            self._update_processing_status(processing_id, {
                "stage": "embedding_keyframes",
                "progress": 80,
                "message": f"正在生成 {len(frame_rows)} 张关键帧的文本向量…",
            })
            try:
                frame_vectors = await self._embed_video_texts(
                    [str(row["frame"].get("description") or "") for row in frame_rows],
                    label="视频关键帧描述",
                )
            except Exception as frame_embed_error:
                logger.warning("视频关键帧描述向量化失败，回退所属 Shot caption: {}", frame_embed_error)
                frame_vectors = [caption_vectors[row["row_index"]] for row in frame_rows]

        clip_vectors: List[List[float]] = [[0.0] * 768 for _ in frame_rows]
        if frame_rows:
            try:
                clip_vectors = await self._vectorize_video_keyframe_clip_batches(
                    [bytes(row["frame_bytes"]) for row in frame_rows],
                    processing_id=processing_id,
                )
            except Exception as clip_batch_error:
                # CLIP 是视觉召回增强；单批失败时保留 frame_vec，不能让已完成的
                # Scene–Shot/ASR 入库整体失败。
                logger.warning("视频关键帧 CLIP 批量向量化失败，保留零 CLIP 向量: {}", clip_batch_error)

        keyframe_points: List[Dict[str, Any]] = []
        for frame_index, row in enumerate(frame_rows):
            frame = row["frame"]
            clip_vec = (
                clip_vectors[frame_index]
                if frame_index < len(clip_vectors) and clip_vectors[frame_index]
                else [0.0] * 768
            )
            scene, shot = row["scene"], row["shot"]
            keyframe_points.append({
                "point_id": str(uuid.uuid4()),
                "frame_vec": frame_vectors[frame_index] if frame_index < len(frame_vectors) else caption_vectors[row["row_index"]],
                "clip_vec": clip_vec,
                "payload": {
                    "schema_version": SCHEMA_VERSION,
                    "file_id": file_id,
                    "file_path": file_path,
                    "manifest_path": manifest_path,
                    "scene_id": scene.get("scene_id"),
                    "shot_id": shot.get("shot_id"),
                    "scene_start_time": scene.get("start_time", 0.0),
                    "scene_end_time": scene.get("end_time", 0.0),
                    "shot_start_time": shot.get("start_time", 0.0),
                    "shot_end_time": shot.get("end_time", 0.0),
                    "scene_summary": scene.get("scene_summary", ""),
                    "shot_caption": shot.get("caption", ""),
                    "asr_text": shot.get("asr_text", ""),
                    "frame_timestamp": frame.get("timestamp", 0.0),
                    "frame_description": frame.get("description", ""),
                    "frame_image_path": frame.get("frame_image_path", ""),
                    "duration": duration,
                    "video_format": video_format,
                    "resolution": resolution,
                    "fps": fps,
                    "has_audio": has_audio,
                },
            })

        shot_points: List[Dict[str, Any]] = []
        for index, (scene, shot) in enumerate(shot_rows):
            shot_points.append({
                "point_id": str(uuid.uuid4()),
                "caption_dense": caption_vectors[index] if index < len(caption_vectors) else caption_vectors[0],
                "asr_dense": asr_vectors[index],
                "caption_sparse": caption_sparse[index],
                "asr_sparse": asr_sparse[index],
                "payload": {
                    "schema_version": SCHEMA_VERSION,
                    "file_id": file_id,
                    "file_path": file_path,
                    "manifest_path": manifest_path,
                    "video_summary": analysis.get("video_summary", ""),
                    "scene_id": scene.get("scene_id"),
                    "scene_start_time": scene.get("start_time", 0.0),
                    "scene_end_time": scene.get("end_time", 0.0),
                    "scene_summary": scene.get("scene_summary", ""),
                    "shot_id": shot.get("shot_id"),
                    "shot_start_time": shot.get("start_time", 0.0),
                    "shot_end_time": shot.get("end_time", 0.0),
                    "caption": shot.get("caption", ""),
                    "asr_status": shot.get("asr_status", "no_speech"),
                    "asr_text": shot.get("asr_text", ""),
                    "speech_boundary": shot.get("speech_boundary", {}),
                    "keyframes": [
                        dict(frame)
                        for frame in (shot.get("keyframes") or [])
                        if frame.get("frame_image_path")
                    ],
                    "duration": duration,
                    "video_format": video_format,
                    "resolution": resolution,
                    "fps": fps,
                    "has_audio": has_audio,
                },
            })
        return {"shot_points": shot_points, "keyframe_points": keyframe_points}

    async def _embed_video_texts(self, texts: List[str], label: str, batch_size: int = 64) -> List[List[float]]:
        """分批执行视频解析衍生文本的 dense embedding，避免长视频一次请求过大。"""
        vectors: List[List[float]] = []
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            result = await self.llm_manager.embed(texts=batch, task_type="embedding")
            if not result.success or not result.data:
                raise ValueError(f"{label} 向量化失败: {result.error}")
            values = result.data if isinstance(result.data, list) else [result.data]
            if len(values) != len(batch):
                raise ValueError(f"{label} 向量数量异常: 期望 {len(batch)}，实际 {len(values)}")
            vectors.extend(values)
        return vectors

    async def _process_video_short(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_content: bytes,
        duration: float,
        file_id: str,
        file_path: str,
        video_format: str,
        resolution: str,
        fps: float,
        has_audio: bool,
    ) -> Dict[str, Any]:
        """短视频：与长视频一致，关键帧由 MLLM 场景解析产出（单 chunk），再按时间戳截帧、向量化、入库。"""
        audio_file_id = None
        if has_audio:
            self._update_processing_status(processing_id, {
                "stage": "extracting_audio",
                "progress": 20,
                "message": "提取视频音频...",
            })
            audio_result = await self._extract_video_audio(
                file_content, file_id, kb_id, processing_id
            )
            if audio_result:
                audio_file_id = audio_result.get("audio_file_id")

        self._update_processing_status(processing_id, {
            "stage": "parsing",
            "progress": 40,
            "message": "MLLM 场景与关键帧解析（单段）...",
        })
        # 优先本地上传（video_local），避免 MinIO presigned URL 从外网不可达导致主模型/备用模型 400
        video_local_path: Optional[str] = None
        if file_content:
            import tempfile
            fd = -1
            try:
                fd, video_local_path = tempfile.mkstemp(suffix=".mp4")
                os.write(fd, file_content)
            except Exception as e:
                logger.warning("写入视频临时文件失败: {}", e)
                video_local_path = None
            finally:
                if fd >= 0:
                    try:
                        os.close(fd)
                    except Exception:
                        pass
        video_url: Optional[str] = None
        if not video_local_path:
            try:
                bucket = storage_result.get("bucket")
                object_path = storage_result.get("object_path")
                if bucket and object_path:
                    video_url = await self.minio_adapter.get_presigned_url(bucket, object_path, expires_hours=2)
            except Exception as e:
                logger.warning("获取视频 presigned URL 失败: {}", e)
        video_fps = min(2, int(fps)) if fps and fps > 0 else 2
        try:
            scenes = await self._parse_video_scenes_mllm(
                file_content=file_content,
                duration=duration,
                processing_id=processing_id,
                window_seconds=max(duration, 1.0),
                overlap_seconds=0.0,
                video_url=video_url,
                video_local_path=video_local_path,
                video_fps=video_fps,
            )
        finally:
            if video_local_path and os.path.exists(video_local_path):
                try:
                    os.unlink(video_local_path)
                except Exception:
                    pass
        if not scenes:
            # 解析失败时兜底：单场景、单关键帧（中点），避免空写入
            scenes = [{
                "start_time": 0.0,
                "end_time": duration,
                "scene_summary": "视频内容，解析未返回场景。",
                "keyframes": [{"timestamp": duration / 2.0, "description": "视频画面"}],
            }]

        self._update_processing_status(processing_id, {
            "stage": "vectorizing",
            "progress": 70,
            "message": "提取关键帧并向量化...",
        })
        keyframe_points = await self._build_keyframe_points_from_scenes(
            file_content=file_content,
            scenes=scenes,
            file_id=file_id,
            file_path=file_path,
            kb_id=kb_id,
            duration=duration,
            video_format=video_format,
            resolution=resolution,
            fps=fps,
            has_audio=has_audio,
            audio_file_id=audio_file_id,
            processing_id=processing_id,
        )

        self._update_processing_status(processing_id, {
            "stage": "storing",
            "progress": 90,
            "message": "存储视频向量...",
        })
        # 旧私有入口不再写入已移除的旧版集合；若被直接调用，最多保留
        # 关键帧兼容写入。正式入口始终走 _process_video_scene_shot。
        vector_storage_result = await self.vector_store.upsert_video_keyframe_vectors(
            kb_id=kb_id,
            keyframe_points=keyframe_points,
        )
        first_summary = scenes[0].get("scene_summary", "") if scenes else ""
        return {
            "processing_id": processing_id,
            "status": "completed",
            "file_id": file_id,
            "description": first_summary[:200] + ("..." if len(first_summary) > 200 else ""),
            "key_frames_count": len(keyframe_points),
            "vectors_stored": vector_storage_result["points_inserted"],
            "file_type": "video",
        }

    async def _process_video_long(
        self,
        parse_result: Dict[str, Any],
        storage_result: Dict[str, Any],
        kb_id: str,
        processing_id: str,
        file_content: bytes,
        duration: float,
        file_id: str,
        file_path: str,
        video_format: str,
        resolution: str,
        fps: float,
        has_audio: bool,
    ) -> Dict[str, Any]:
        """长视频：超过 8 分钟则按 8 分钟分段，每段视频交给 MLLM 解析（不固定抽帧）；≤8 分钟则整段一次交给 MLLM。"""
        window = getattr(settings, "video_chunk_window_seconds", 480.0)
        overlap = getattr(settings, "video_chunk_overlap_seconds", 10.0)
        max_chunk = getattr(settings, "video_max_chunk_duration_seconds", 480.0)
        video_fps = min(2, int(fps)) if fps and fps > 0 else 2
        self._update_processing_status(processing_id, {
            "stage": "parsing",
            "progress": 25,
            "message": "长视频语义解析（分段交给 MLLM）...",
        })

        if duration <= max_chunk:
            # ≤8 分钟：整段视频一次交给 MLLM，优先本地上传（避免 presigned URL 外网不可达）
            video_local_path_long: Optional[str] = None
            if file_content:
                import tempfile
                fd_long = -1
                try:
                    fd_long, video_local_path_long = tempfile.mkstemp(suffix=".mp4")
                    os.write(fd_long, file_content)
                except Exception as e:
                    logger.warning("写入视频临时文件失败: {}", e)
                    video_local_path_long = None
                finally:
                    if fd_long >= 0:
                        try:
                            os.close(fd_long)
                        except Exception:
                            pass
            video_url_arg: Optional[str] = None
            if not video_local_path_long:
                try:
                    bucket = storage_result.get("bucket")
                    object_path = storage_result.get("object_path")
                    if bucket and object_path:
                        video_url_arg = await self.minio_adapter.get_presigned_url(bucket, object_path, expires_hours=2)
                except Exception as e:
                    logger.warning("获取视频 presigned URL 失败: {}", e)
            try:
                scenes = await self._parse_video_scenes_mllm(
                    file_content=file_content,
                    duration=duration,
                    processing_id=processing_id,
                    window_seconds=window,
                    overlap_seconds=overlap,
                    video_url=video_url_arg,
                    video_local_path=video_local_path_long,
                    video_fps=video_fps,
                )
            finally:
                if video_local_path_long and os.path.exists(video_local_path_long):
                    try:
                        os.unlink(video_local_path_long)
                    except Exception:
                        pass
        else:
            # >8 分钟：按段切分，每段视频交给 MLLM，不做固定抽帧（方案：滑动窗口 480s + 重叠 10s）
            import tempfile
            step = max(1.0, max_chunk - overlap)
            num_chunks_expected = max(1, int((duration - overlap) / step) + (1 if (duration - overlap) % step > 0 else 0))
            logger.info(
                f"长视频分段: duration={duration:.1f}s, window={max_chunk:.0f}s, overlap={overlap:.0f}s, 预计 {num_chunks_expected} 段 MLLM 调用"
            )
            fd_full = -1
            full_path: Optional[str] = None
            try:
                fd_full, full_path = tempfile.mkstemp(suffix=".mp4")
                if file_content and len(file_content) >= 1000:
                    os.write(fd_full, file_content)
                else:
                    # 流式上传等场景可能未带完整 body，从 MinIO 拉取
                    bucket = storage_result.get("bucket")
                    object_path = storage_result.get("object_path")
                    if bucket and object_path:
                        try:
                            content = await self.minio_adapter.get_file_content(bucket, object_path)
                            if content and len(content) >= 1000:
                                os.write(fd_full, content)
                                logger.info(f"长视频从 MinIO 拉取完整文件用于分段: {len(content)} bytes")
                        except Exception as e:
                            logger.warning("长视频从 MinIO 拉取失败: %s", e)
            except Exception as e:
                logger.warning("长视频写入临时文件失败: %s", e)
                full_path = None
            finally:
                if fd_full >= 0:
                    try:
                        os.close(fd_full)
                    except Exception:
                        pass
            scenes = []
            all_scenes: List[Dict[str, Any]] = []
            chunk_start = 0.0
            chunk_index = 0
            try:
                if full_path and os.path.exists(full_path) and os.path.getsize(full_path) >= 1000:
                    while chunk_start < duration:
                        chunk_dur = min(max_chunk, duration - chunk_start)
                        if chunk_dur <= 0:
                            break
                        segment_path = self._extract_video_segment_to_file(full_path, chunk_start, chunk_dur)
                        if not segment_path:
                            logger.warning(f"长视频段 {chunk_index} 提取失败: start={chunk_start:.1f}, dur={chunk_dur:.1f}")
                            chunk_start += step
                            chunk_index += 1
                            continue
                        try:
                            # 后段解析时传入前段场景描述，便于 MLLM 理解叙事连贯性
                            prev_summary_text: Optional[str] = None
                            if chunk_index > 0 and all_scenes:
                                prev_summary_text = "\n\n".join(
                                    f"[前段场景{i+1}] {s.get('scene_summary', '').strip()}"
                                    for i, s in enumerate(all_scenes)
                                )
                            logger.info(f"长视频段 {chunk_index}: start={chunk_start:.1f}, dur={chunk_dur:.1f}, 调用 MLLM")
                            scenes_chunk = await self._parse_video_scenes_mllm(
                                file_content=b"",
                                duration=chunk_dur,
                                processing_id=processing_id,
                                window_seconds=chunk_dur,
                                overlap_seconds=0.0,
                                video_url=None,
                                video_local_path=segment_path,
                                video_fps=video_fps,
                                previous_segments_summary=prev_summary_text,
                            )
                            logger.info(f"长视频段 {chunk_index} MLLM 返回 {len(scenes_chunk) if scenes_chunk else 0} 个场景")
                            for s in scenes_chunk or []:
                                all_scenes.append({
                                    "start_time": float(s.get("start_time", 0)) + chunk_start,
                                    "end_time": float(s.get("end_time", 0)) + chunk_start,
                                    "scene_summary": s.get("scene_summary", ""),
                                    "keyframes": [
                                        {"timestamp": float(kf.get("timestamp", 0)) + chunk_start, "description": kf.get("description", "")}
                                        for kf in (s.get("keyframes") or [])
                                        if isinstance(kf, dict)
                                    ],
                                })
                        finally:
                            if segment_path and os.path.exists(segment_path):
                                try:
                                    os.unlink(segment_path)
                                except Exception:
                                    pass
                        chunk_start += step
                        chunk_index += 1
                    all_scenes = self._merge_overlapping_scenes(all_scenes, overlap)
                    scenes = all_scenes
                else:
                    reason = "临时文件不存在或为空" if not full_path else "临时文件大小不足"
                    logger.warning("长视频分段未执行: %s (请确认上传为完整文件或 MinIO 可访问)", reason)
            finally:
                if full_path and os.path.exists(full_path):
                    try:
                        os.unlink(full_path)
                    except Exception:
                        pass

        if not scenes:
            logger.warning("长视频 MLLM 未返回场景，回退为短视频流程")
            return await self._process_video_short(
                parse_result=parse_result,
                storage_result=storage_result,
                kb_id=kb_id,
                processing_id=processing_id,
                file_content=file_content,
                duration=duration,
                file_id=file_id,
                file_path=file_path,
                video_format=video_format,
                resolution=resolution,
                fps=fps,
                has_audio=has_audio,
            )

        audio_file_id = None
        if has_audio:
            self._update_processing_status(processing_id, {
                "stage": "extracting_audio",
                "progress": 50,
                "message": "提取视频音频...",
            })
            audio_result = await self._extract_video_audio(
                file_content, file_id, kb_id, processing_id
            )
            if audio_result:
                audio_file_id = audio_result.get("audio_file_id")

        self._update_processing_status(processing_id, {
            "stage": "vectorizing",
            "progress": 70,
            "message": "提取关键帧并向量化...",
        })
        keyframe_points = await self._build_keyframe_points_from_scenes(
            file_content=file_content,
            scenes=scenes,
            file_id=file_id,
            file_path=file_path,
            kb_id=kb_id,
            duration=duration,
            video_format=video_format,
            resolution=resolution,
            fps=fps,
            has_audio=has_audio,
            audio_file_id=audio_file_id,
            processing_id=processing_id,
        )

        self._update_processing_status(processing_id, {
            "stage": "storing",
            "progress": 90,
            "message": "存储视频向量...",
        })
        # 同上：禁止旧分支重新创建或依赖旧版视频集合。
        vector_storage_result = await self.vector_store.upsert_video_keyframe_vectors(
            kb_id=kb_id,
            keyframe_points=keyframe_points,
        )
        first_summary = scenes[0].get("scene_summary", "") if scenes else ""
        return {
            "processing_id": processing_id,
            "status": "completed",
            "file_id": file_id,
            "description": first_summary[:200] + ("..." if len(first_summary) > 200 else ""),
            "key_frames_count": sum(len(s.get("keyframes", [])) for s in scenes),
            "vectors_stored": vector_storage_result["points_inserted"],
            "file_type": "video",
        }

    @staticmethod
    def merge_adjacent_chunks_up_to_max(
        chunks: List[Dict[str, Any]],
        max_chunk_size: int,
        separator: str = "\n\n",
    ) -> List[Dict[str, Any]]:
        """在不超过 max_chunk_size 的前提下贪婪合并相邻块（用于无 Markdown # 标题结构的纯文本类文档，减少过碎 chunk）。

        注意：调用方可传入小于「递归切分上限」的值，避免把多条高密度短段打成一个过大的向量单元。
        """
        if len(chunks) <= 1:
            return chunks
        merged: List[Dict[str, Any]] = []
        i = 0
        while i < len(chunks):
            parts = [chunks[i]["text"]]
            meta = dict(chunks[i].get("metadata", {}))
            j = i + 1
            while j < len(chunks):
                candidate = separator.join(parts + [chunks[j]["text"]])
                if len(candidate) > max_chunk_size:
                    break
                parts.append(chunks[j]["text"])
                nmeta = chunks[j].get("metadata", {})
                if nmeta.get("has_code"):
                    meta["has_code"] = True
                j += 1
            merged.append({"text": separator.join(parts).strip(), "metadata": meta})
            i = j
        return merged

    async def _split_text_into_chunks(self, parse_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """将文本分割成块"""
        chunks = []
        file_type = parse_result["file_type"]
        source_type = (parse_result.get("metadata") or {}).get("source_type")
        # 无 ATX 标题的纯文本式文档在初切后做相邻合并；含 # 的 Markdown 保持按段粒度，不合并
        coalesce_adjacent_chunks = False

        # Excel/CSV：自定义三类 chunk（sheet 摘要 / 行块 / 列画像），不走通用 markdown 分支也不应用 overlap
        # 行块 chunk 中表头随每个 chunk 复制，避免 Dense 召回时丢失列上下文；
        # sheet 摘要由 LLM 1～2 句生成（失败降级），列画像写入 dtype/统计/示例供「字段含义类」查询命中
        if file_type == "excel" and parse_result.get("sheets"):
            return await self._build_excel_chunks(parse_result)

        # PDF / docx / pptx / md 有 markdown 时按 markdown 分块（md 含内联 base64 图注插回后也走此分支）
        if file_type in ["pdf", "docx", "pptx", "md"] and "markdown" in parse_result and parse_result["markdown"]:
            logger.info("使用解析生成的完整 Markdown 进行分块 (file_type={})", file_type)
            markdown_text = normalize_text_newlines(parse_result["markdown"])
            from .parsers.factory import MarkdownParser
            markdown_parser = MarkdownParser()
            lines = markdown_text.split("\n")
            headers = []
            for line in lines:
                if line.startswith("#"):
                    headers.append({
                        "level": len(line) - len(line.lstrip("#")),
                        "text": line.lstrip("#").strip()
                    })
            # 仅纯文本 / md 做相邻合并；pdf 等仍按段保留，避免无 # 时跨页大块粘连
            coalesce_adjacent_chunks = len(headers) == 0 and file_type in ("txt", "md")
            paragraphs = markdown_parser._build_smart_paragraphs(markdown_text, headers)
            for paragraph in paragraphs:
                if paragraph.get("text", "").strip():
                    chunk_metadata = {
                        "file_type": file_type,
                        "parser": parse_result.get("metadata", {}).get("parser", "pymupdf"),
                    }
                    if source_type:
                        chunk_metadata["source_type"] = source_type
                    if paragraph.get("header"):
                        header = paragraph["header"]
                        chunk_metadata["header_level"] = header.get("level")
                        chunk_metadata["header_text"] = header.get("text")
                    if paragraph.get("has_code"):
                        chunk_metadata["has_code"] = True
                    chunks.append({
                        "text": paragraph["text"].strip(),
                        "metadata": chunk_metadata
                    })
        elif file_type == "pdf":
            # PDF 无 markdown 时按页分块（PyMuPDF 解析结果）
            logger.info("使用按页分块逻辑（PyMuPDF 解析结果）")
            for page in parse_result.get("pages", []):
                if page.get("text", "").strip():
                    chunks.append({
                        "text": page["text"].strip(),
                        "metadata": {
                            "page": page["page"],
                            "file_type": "pdf",
                            "parser": parse_result.get("metadata", {}).get("parser", "pymupdf"),
                            **({"source_type": source_type} if source_type else {}),
                        }
                    })
        elif file_type in ["docx", "pptx", "txt", "md"]:
            # 段落处理（无上方 markdown 分支时的 docx/pptx/txt 等）
            # 检查是否有 paragraphs 字段
            if "paragraphs" in parse_result:
                for paragraph in parse_result["paragraphs"]:
                    if isinstance(paragraph, dict) and paragraph.get("text", "").strip():
                        # 构建chunk元数据
                        chunk_metadata = {
                            "file_type": parse_result["file_type"]
                        }
                        if source_type:
                            chunk_metadata["source_type"] = source_type
                        
                        # 如果是markdown且有标题信息，添加到元数据
                        if parse_result["file_type"] == "md" and paragraph.get("header"):
                            header = paragraph["header"]
                            chunk_metadata["header_level"] = header.get("level")
                            chunk_metadata["header_text"] = header.get("text")
                        
                        chunks.append({
                            "text": paragraph["text"].strip(),
                            "metadata": chunk_metadata
                        })
                if file_type == "txt":
                    coalesce_adjacent_chunks = True
                elif file_type == "md":
                    coalesce_adjacent_chunks = not any(
                        isinstance(p, dict) and p.get("header")
                        for p in (parse_result.get("paragraphs") or [])
                    )
                else:
                    coalesce_adjacent_chunks = True
            # 如果没有 paragraphs，尝试使用 content 字段
            elif "content" in parse_result:
                # 按段落分割内容（归一化换行，避免 CRLF 整篇成一段）
                content = normalize_text_newlines(parse_result["content"])
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                for para in paragraphs:
                    if para.strip():
                        chunks.append({
                            "text": para.strip(),
                            "metadata": {
                                "file_type": parse_result["file_type"],
                                **({"source_type": source_type} if source_type else {}),
                            }
                        })
                if file_type == "txt":
                    coalesce_adjacent_chunks = True
                elif file_type == "md":
                    coalesce_adjacent_chunks = True
                else:
                    coalesce_adjacent_chunks = True
            else:
                logger.warning(f"无法从解析结果中提取文本块: {parse_result.keys()}")
        
        # 实现更智能的分块策略
        # - 递归分块：如果块太大，继续分割
        # - 重叠窗口：相邻块之间有重叠，保持上下文连贯性
        
        # 配置参数
        max_chunk_size = 900  # 递归切分等使用的最大块大小（字符数）
        merge_pack_max_size = 500  # 仅相邻合并打包上限，宜小于 max_chunk_size，减轻检索时语义稀释
        chunk_overlap = 150    # 重叠窗口大小（字符数）
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

        if coalesce_adjacent_chunks and len(processed_chunks) > 1:
            processed_chunks = self.merge_adjacent_chunks_up_to_max(
                processed_chunks,
                max_chunk_size=merge_pack_max_size,
            )
        
        # 对相邻块应用重叠窗口（如果块数大于1）
        if len(processed_chunks) > 1:
            processed_chunks = self._apply_overlap_window(
                processed_chunks,
                overlap_size=chunk_overlap
            )
        
        return processed_chunks

    async def _build_excel_chunks(self, parse_result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """为 Excel/CSV 构造三类 chunk：sheet 摘要 / 行块 / 列画像。

        - 行块按字符预算切分（默认 ≤ EXCEL_ROW_CHUNK_MAX_CHARS）；表头随每个 chunk 复制
        - 不应用相邻重叠（表头会被反复拼接成错位表格）
        - sheet 摘要由 LLM 生成（失败降级为「（未生成）」），不阻塞主流程
        """
        sheets: List[Dict[str, Any]] = parse_result.get("sheets") or []
        if not sheets:
            return []

        try:
            row_block_max_chars = int(getattr(settings, "excel_row_chunk_max_chars", 900))
        except Exception:
            row_block_max_chars = 900
        if row_block_max_chars < 200:
            row_block_max_chars = 200

        try:
            llm_summary_enabled = bool(getattr(settings, "excel_sheet_llm_summary_enabled", True))
        except Exception:
            llm_summary_enabled = True

        all_chunks: List[Dict[str, Any]] = []

        for sheet in sheets:
            sheet_name: str = str(sheet.get("name") or "Sheet")
            headers: List[str] = [str(h) for h in (sheet.get("headers") or [])]
            rows: List[List[str]] = sheet.get("rows") or []
            n_rows: int = int(sheet.get("n_rows") or len(rows))
            n_cols: int = int(sheet.get("n_cols") or len(headers))
            column_profiles: List[Dict[str, Any]] = sheet.get("column_profiles") or []

            # 1) Sheet 摘要 chunk：含表头 / 规模 / LLM 摘要 / 列名清单
            llm_summary = ""
            if llm_summary_enabled and headers and rows:
                try:
                    llm_summary = await self._generate_excel_sheet_summary(
                        sheet_name=sheet_name,
                        headers=headers,
                        sample_rows=rows[:5],
                        n_rows=n_rows,
                        n_cols=n_cols,
                    )
                except Exception as e:
                    logger.warning("Excel sheet 摘要生成失败 sheet={} : {}", sheet_name, e)
                    llm_summary = ""

            summary_text_lines = [
                f"# {sheet_name}",
                f"规模：{n_rows} 行 × {n_cols} 列",
                f"列名：{' | '.join(headers) if headers else '（无）'}",
                f"摘要：{llm_summary or '（未生成）'}",
            ]
            all_chunks.append({
                "text": "\n".join(summary_text_lines).strip(),
                "metadata": {
                    "file_type": "excel",
                    "excel_chunk_type": "sheet_summary",
                    "sheet_name": sheet_name,
                    "n_rows": n_rows,
                    "n_cols": n_cols,
                    "headers": headers,
                    "no_overlap": True,
                },
            })

            # 2) 行块 chunk：每 chunk 复制表头，按字符预算分批；空 sheet 跳过
            if headers and rows:
                row_chunks = self._build_excel_row_blocks(
                    sheet_name=sheet_name,
                    headers=headers,
                    rows=rows,
                    max_chars=row_block_max_chars,
                )
                all_chunks.extend(row_chunks)

            # 3) 列画像 chunk：每列 1 条；空列也保留以便「有哪些字段」类查询命中
            for col in column_profiles:
                col_name = str(col.get("name") or "")
                if not col_name:
                    continue
                dtype = col.get("dtype") or "text"
                n_null = int(col.get("n_null") or 0)
                n_unique = int(col.get("n_unique") or 0)
                examples = [str(e) for e in (col.get("examples") or [])]
                numeric_stats = col.get("numeric_stats")

                lines = [
                    f"# {sheet_name}.{col_name}",
                    f"类型：{dtype}；非空：{max(0, n_rows - n_null)}/{n_rows}；唯一值：{n_unique}",
                ]
                if examples:
                    lines.append(f"示例：{' | '.join(examples)}")
                if isinstance(numeric_stats, dict) and numeric_stats:
                    lines.append(
                        f"统计：min={numeric_stats.get('min', '')} "
                        f"max={numeric_stats.get('max', '')} "
                        f"mean={numeric_stats.get('mean', '')}"
                    )

                all_chunks.append({
                    "text": "\n".join(lines).strip(),
                    "metadata": {
                        "file_type": "excel",
                        "excel_chunk_type": "column_portrait",
                        "sheet_name": sheet_name,
                        "column_name": col_name,
                        "dtype": dtype,
                        "no_overlap": True,
                    },
                })

        logger.info(
            "Excel 分块完成：sheets={} chunks={}（含摘要/行块/列画像三类）",
            len(sheets),
            len(all_chunks),
        )
        return all_chunks

    def _build_excel_row_blocks(
        self,
        sheet_name: str,
        headers: List[str],
        rows: List[List[str]],
        max_chars: int,
    ) -> List[Dict[str, Any]]:
        """按字符预算把 rows 切分成「带表头的 Markdown 行块 chunk」，1-based 行号写入 metadata。"""
        if not headers or not rows:
            return []

        def _esc(cell: str) -> str:
            return (cell or "").replace("|", "\\|").replace("\n", " ")

        header_line = "| " + " | ".join(_esc(h) for h in headers) + " |"
        sep_line = "|" + "|".join(["---"] * len(headers)) + "|"
        header_overhead = len(header_line) + len(sep_line) + 2  # 两个换行
        # 最少要给行体留 200 字符；如果表头本身占满，使用一行一 chunk 兜底
        body_budget = max(200, max_chars - header_overhead)

        chunks: List[Dict[str, Any]] = []
        buffer_lines: List[str] = []
        buffer_chars = 0
        block_start = 0  # 0-based

        for idx, row in enumerate(rows):
            padded = list(row) + [""] * max(0, len(headers) - len(row))
            row_md = "| " + " | ".join(_esc(c) for c in padded[: len(headers)]) + " |"
            row_size = len(row_md) + 1
            if buffer_lines and buffer_chars + row_size > body_budget:
                chunks.append(self._compose_excel_row_block(
                    sheet_name=sheet_name,
                    header_line=header_line,
                    sep_line=sep_line,
                    body_lines=buffer_lines,
                    row_start=block_start,
                    row_end=idx,
                ))
                buffer_lines = []
                buffer_chars = 0
                block_start = idx

            buffer_lines.append(row_md)
            buffer_chars += row_size

        if buffer_lines:
            chunks.append(self._compose_excel_row_block(
                sheet_name=sheet_name,
                header_line=header_line,
                sep_line=sep_line,
                body_lines=buffer_lines,
                row_start=block_start,
                row_end=len(rows),
            ))
        return chunks

    def _compose_excel_row_block(
        self,
        sheet_name: str,
        header_line: str,
        sep_line: str,
        body_lines: List[str],
        row_start: int,
        row_end: int,
    ) -> Dict[str, Any]:
        title = f"# {sheet_name}（第 {row_start + 1}–{row_end} 行）"
        text = "\n".join([title, header_line, sep_line, *body_lines])
        return {
            "text": text,
            "metadata": {
                "file_type": "excel",
                "excel_chunk_type": "row_block",
                "sheet_name": sheet_name,
                "row_start": row_start + 1,
                "row_end": row_end,
                "no_overlap": True,
            },
        }

    async def _generate_excel_sheet_summary(
        self,
        sheet_name: str,
        headers: List[str],
        sample_rows: List[List[str]],
        n_rows: int,
        n_cols: int,
    ) -> str:
        """调用 LLM 为单个 sheet 生成 1-2 句摘要。失败时返回空串由调用方降级。

        提示词刻意控制在 < 500 字符，仅传 5 行采样，避免大表把上下文撑爆。
        """
        try:
            def _truncate(s: str, n: int = 30) -> str:
                s = (s or "").strip()
                return s if len(s) <= n else s[: n - 1] + "…"

            header_str = " | ".join(_truncate(h, 24) for h in headers[:20])
            sample_md_lines: List[str] = []
            for row in sample_rows[:5]:
                cells = [_truncate(str(c), 24) for c in (row[:20] if row else [])]
                if cells:
                    sample_md_lines.append("| " + " | ".join(cells) + " |")

            sample_md = "\n".join(sample_md_lines) if sample_md_lines else "（无数据）"

            user_prompt = (
                f"下面是表格 `{sheet_name}`（{n_rows} 行 × {n_cols} 列）的列名与前 5 行采样数据。\n"
                f"请用 1-2 句中文概括该表的主题、记录的实体类型与主要字段，不要逐行复述、不要超过 80 字。\n\n"
                f"列名：{header_str}\n\n"
                f"采样：\n{sample_md}"
            )

            messages = [
                {"role": "system", "content": "你是表格内容摘要助手，输出极简的中文摘要，不带前后缀。"},
                {"role": "user", "content": user_prompt},
            ]

            result = await self.llm_manager.chat(
                messages=messages,
                task_type="kb_portrait_generation",
                fallback=True,
                temperature=0.2,
            )

            if not result or not result.success:
                return ""

            data = result.data or {}
            if isinstance(data, dict):
                choices = data.get("choices") or []
                if choices:
                    msg = choices[0].get("message") or {}
                    content = (msg.get("content") or "").strip()
                    return content[:200] if content else ""
            return ""
        except Exception as e:
            logger.warning("Excel sheet 摘要 LLM 调用异常 sheet={} : {}", sheet_name, e)
            return ""

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
        """对相邻块应用重叠窗口

        若 chunk metadata 中 `no_overlap=True`（如 Excel 三类 chunk），则该 chunk 自身不接受
        前后重叠，避免把表头/列画像粘连成错乱表格；前后相邻 chunk 仍按各自策略处理。
        """
        if len(chunks) <= 1:
            return chunks
        
        overlapped_chunks = []
        for i, chunk in enumerate(chunks):
            text = chunk["text"]
            chunk_no_overlap = bool((chunk.get("metadata") or {}).get("no_overlap"))

            if not chunk_no_overlap:
                # 如果不是第一个块，添加前一个块的末尾作为重叠
                if i > 0:
                    prev_chunk = chunks[i - 1]
                    prev_no_overlap = bool((prev_chunk.get("metadata") or {}).get("no_overlap"))
                    if not prev_no_overlap:
                        prev_text = prev_chunk["text"]
                        if len(prev_text) > overlap_size:
                            overlap_text = prev_text[-overlap_size:]
                            text = overlap_text + "\n\n" + text

                # 如果不是最后一个块，添加后一个块的开头作为重叠
                if i < len(chunks) - 1:
                    next_chunk = chunks[i + 1]
                    next_no_overlap = bool((next_chunk.get("metadata") or {}).get("no_overlap"))
                    if not next_no_overlap:
                        next_text = next_chunk["text"]
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
            # Dense retrieval receives section/title context generated from the
            # validated plan; sparse retrieval remains on raw source text to
            # preserve exact lexical matches and avoid duplicated headings.
            texts = [chunk["text"] for chunk in chunks]
            embedding_texts = [chunk.get("embedding_text") or chunk["text"] for chunk in chunks]
            
            # 1. 使用LLM管理器进行密集向量化（Qwen3-Embedding-8B）
            dense_result = await self.llm_manager.embed(texts=embedding_texts)
            
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
            if fmt == "PNG":
                mime = "png"
            elif fmt in ("JPEG", "JPG"):
                mime = "jpeg"
            elif fmt == "WEBP":
                mime = "webp"
            elif fmt in ("TIFF", "TIF"):
                mime = "tiff"
            else:
                mime = "png"
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
            logger.info("VLM 图片描述调用返回: success={}", result.success)
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
    
    def _load_clap_model(self):
        """懒加载 CLAP 模型和处理器（laion/clap-htsat-fused），用于提取音频声学特征。"""
        if self._clap_model is None or self._clap_processor is None:
            try:
                import torch
                model_name = "laion/clap-htsat-fused"
                logger.info("正在加载 CLAP 模型: {}", model_name)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    from transformers import ClapModel, ClapProcessor
                    loaded_model = ClapModel.from_pretrained(model_name)
                    loaded_processor = ClapProcessor.from_pretrained(model_name)
                loaded_model.eval()
                if torch.cuda.is_available():
                    loaded_model.to(torch.device("cuda"))  # type: ignore[call-arg]
                    logger.info("CLAP 模型已加载到 GPU")
                else:
                    logger.info("CLAP 模型已加载到 CPU")
                self._clap_model = loaded_model
                self._clap_processor = loaded_processor
            except Exception as e:
                logger.error("CLAP 模型加载失败: {}", e)
                raise
    
    def _extract_audio_clap_features(
        self,
        audio_bytes: bytes,
        audio_format: str,
    ) -> List[float]:
        """从音频字节中提取 CLAP 声学特征向量（512 维），用于与 text_vec 同点存储。"""
        import torch
        import numpy as np
        self._load_clap_model()
        if self._clap_model is None or self._clap_processor is None:
            raise RuntimeError("CLAP 模型未加载")
        # 将字节解码为波形：librosa 支持从 bytes，并统一到 48kHz（CLAP 期望）
        try:
            import librosa
            waveform, sr = librosa.load(BytesIO(audio_bytes), sr=48000, mono=True)
        except Exception as e:
            logger.warning("librosa 加载失败，尝试 soundfile: {}", e)
            import soundfile as sf
            data, sr = sf.read(BytesIO(audio_bytes))
            if data.ndim > 1:
                data = data.mean(axis=1)
            import librosa
            waveform = librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=48000)
            sr = 48000
        # 直接调用 feature_extractor（ClapProcessor 继承自 ProcessorMixin），避免对 __call__ kwargs 的类型误报
        extractor = getattr(self._clap_processor, "feature_extractor")
        inputs = extractor(
            [waveform],
            sampling_rate=48000,
            return_tensors="pt",
        )
        device = next(self._clap_model.parameters()).device
        inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}
        with torch.no_grad():
            audio_features = self._clap_model.get_audio_features(**inputs)
        if audio_features is None:
            raise ValueError("CLAP get_audio_features 返回空")
        # 归一化（与 CLIP 一致，便于相似度计算）
        audio_features = audio_features / audio_features.norm(dim=-1, keepdim=True)
        vec = audio_features.cpu().numpy()[0].tolist()
        # laion/clap-htsat-fused 输出 512 维
        if len(vec) != 512:
            logger.warning("CLAP 输出维度为 {}，将截断或补零至 512", len(vec))
            vec = (vec + [0.0] * 512)[:512]
        return vec
    
    def _get_clap_text_vector(self, text: str) -> List[float]:
        """用 CLAP 文本编码器将查询文本编码为 512 维向量，用于与 audio_vectors 的 clap_vec 做相似度检索。"""
        import torch
        import numpy as np
        self._load_clap_model()
        if self._clap_model is None or self._clap_processor is None:
            raise RuntimeError("CLAP 模型未加载")
        inputs = self._clap_processor(text=[text])
        device = next(self._clap_model.parameters()).device

        def _to_device_tensor(v: Any) -> Any:
            if hasattr(v, "to"):
                return v.to(device)
            if isinstance(v, list):
                return torch.tensor(v, device=device)
            if isinstance(v, np.ndarray):
                return torch.tensor(v, device=device)
            return v

        inputs = {k: _to_device_tensor(v) for k, v in inputs.items()}
        with torch.no_grad():
            text_features = self._clap_model.get_text_features(**inputs)
        if text_features is None:
            raise ValueError("CLAP get_text_features 返回空")
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        vec = text_features.cpu().numpy()[0].tolist()
        if len(vec) != 512:
            vec = (vec + [0.0] * 512)[:512]
        return vec
    
    async def get_clap_text_vector_for_query(self, text: str) -> Optional[List[float]]:
        """异步封装：在 executor 中生成查询文本的 CLAP 向量，供检索双路 RRF 使用。"""
        if not text or not text.strip():
            return None
        try:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, lambda: self._get_clap_text_vector(text.strip()))
        except Exception as e:
            logger.warning("CLAP 文本向量生成失败: {}", str(e))
            return None
    
    @staticmethod
    def _image_from_clip_input(image_data: Dict[str, Any]) -> Image.Image:
        """从兼容的图片输入构造 RGB PIL 图像（在线程中调用）。"""
        if image_data.get("image_bytes"):
            return Image.open(BytesIO(image_data["image_bytes"])).convert("RGB")
        if image_data.get("base64_content"):
            base64_str = str(image_data["base64_content"])
            if base64_str.startswith("data:image"):
                base64_str = base64_str.split(",", 1)[1]
            return Image.open(BytesIO(base64.b64decode(base64_str))).convert("RGB")
        if image_data.get("image_path"):
            return Image.open(str(image_data["image_path"])).convert("RGB")
        raise ValueError("image_data中必须包含image_bytes、base64_content或image_path")

    def _vectorize_clip_images_sync(self, images: List[Image.Image]) -> List[List[float]]:
        """同步 CLIP 批量推理；调用方必须通过线程执行，不能占住 API 事件循环。"""
        if not images:
            return []
        self._load_clip_model()
        if self._clip_model is None or self._clip_processor is None:
            raise RuntimeError("CLIP模型未加载")

        import numpy as np
        import torch

        # transformers 的类型定义在部分版本中遗漏了 return_tensors；运行时均支持。
        try:
            inputs = self._clip_processor(images=images, return_tensors="pt")
        except TypeError:
            inputs = self._clip_processor(images=images)
        pixel_values = inputs.get("pixel_values")
        if pixel_values is None:
            raise ValueError("CLIP处理器未返回pixel_values")
        if not isinstance(pixel_values, torch.Tensor):
            # 不要直接 torch.tensor(list_of_ndarray)：它会逐元素复制并产生严重性能警告。
            pixel_values = torch.from_numpy(np.asarray(pixel_values))
        if torch.cuda.is_available():
            pixel_values = pixel_values.to(torch.device("cuda"))

        with torch.inference_mode():
            image_features = self._clip_model.get_image_features(pixel_values=pixel_values)  # type: ignore
            if image_features is None:
                raise ValueError("CLIP get_image_features 返回空")
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            vectors = image_features.detach().cpu().numpy().tolist()

        if len(vectors) != len(images):
            raise ValueError(f"CLIP输出数量错误: 期望{len(images)}，实际{len(vectors)}")
        for vector in vectors:
            if len(vector) != 768:
                raise ValueError(f"CLIP向量维度错误: 期望768，实际{len(vector)}")
        return vectors

    def _vectorize_clip_image_data_sync(self, image_data: Dict[str, Any]) -> List[float]:
        return self._vectorize_clip_images_sync([self._image_from_clip_input(image_data)])[0]

    def _vectorize_clip_image_bytes_batch_sync(self, image_bytes_batch: List[bytes]) -> List[List[float]]:
        images = [Image.open(BytesIO(image_bytes)).convert("RGB") for image_bytes in image_bytes_batch]
        return self._vectorize_clip_images_sync(images)

    async def _vectorize_video_keyframe_clip_batches(
        self,
        image_bytes_list: List[bytes],
        *,
        processing_id: str,
    ) -> List[List[float]]:
        """以小批量在线程内执行关键帧 CLIP，持续让出事件循环并更新细粒度进度。"""
        if not image_bytes_list:
            return []
        batch_size = max(1, int(getattr(settings, "video_clip_batch_size", 4) or 4))
        total = len(image_bytes_list)
        vectors: List[List[float]] = []
        self._update_processing_status(processing_id, {
            "stage": "vectorizing_keyframes",
            "progress": 84,
            "message": f"正在批量计算关键帧 CLIP 向量（0/{total}）…",
        })
        for batch_start in range(0, total, batch_size):
            batch = image_bytes_list[batch_start: batch_start + batch_size]
            try:
                batch_vectors = await asyncio.to_thread(
                    self._vectorize_clip_image_bytes_batch_sync,
                    batch,
                )
                if len(batch_vectors) != len(batch):
                    raise ValueError(f"CLIP批量结果数量错误: 期望{len(batch)}，实际{len(batch_vectors)}")
            except Exception as clip_error:
                logger.warning("视频关键帧 CLIP 批量失败（{}–{} / {}）: {}", batch_start + 1, batch_start + len(batch), total, clip_error)
                batch_vectors = [[0.0] * 768 for _ in batch]
            vectors.extend(batch_vectors)
            completed = min(total, batch_start + len(batch))
            self._update_processing_status(processing_id, {
                "stage": "vectorizing_keyframes",
                "progress": min(89, 84 + int(5 * completed / max(1, total))),
                "message": f"正在批量计算关键帧 CLIP 向量（{completed}/{total}）…",
            })
            await asyncio.sleep(0)
        return vectors

    async def _vectorize_with_clip(
        self,
        image_data: Dict[str, Any],
        processing_id: str,
    ) -> Dict[str, Any]:
        """使用 CLIP 向量化单图，同时避免同步 Torch 推理阻塞 API 事件循环。"""
        try:
            logger.info("CLIP 图片向量化: 开始 (processing_id={})", processing_id)
            clip_vector = await asyncio.to_thread(self._vectorize_clip_image_data_sync, image_data)
            logger.info("CLIP 图片向量化: 完成, 维度=768 (processing_id={})", processing_id)
            return {
                "clip_vector": clip_vector,
                "model_used": "openai/clip-vit-large-patch14",
                "vector_dim": 768,
            }
        except Exception as e:
            logger.error("CLIP向量化失败: {}", e, exc_info=True)
            raise
    
    async def _vectorize_text(self, texts: List[str]) -> Dict[str, Any]:
        """向量化文本"""
        try:
            logger.info("文本向量化: 开始, 文本数={}", len(texts))
            result = await self.llm_manager.embed(texts=texts)
            if not result.success:
                raise Exception(f"文本向量化失败: {result.error}")
            
            # 检查数据是否存在
            if result.data is None:
                raise Exception("文本向量化返回的数据为空")
            logger.info("文本向量化: 完成, 向量数={}", len(result.data))
            return {
                "vectors": result.data,
                "model_used": result.model_used
            }
            
        except Exception as e:
            logger.error(f"文本向量化失败: {str(e)}")
            raise
    
    def register_processing_initial(
        self,
        processing_id: str,
        file_path: str,
        kb_id: str,
        *,
        file_size: Optional[int] = None,
        queued: bool = False,
        lease_id: Optional[str] = None,
    ) -> None:
        """预注册处理状态，供刷新后的页面在后台任务启动前也能发现每个文件。"""
        now_at = datetime.utcnow()
        now = now_at.isoformat()
        status = {
            "processing_id": processing_id,
            "status": "queued" if queued else "processing",
            "progress": 0,
            "stage": "queued" if queued else "initializing",
            "message": "已提交，等待处理队列…" if queued else "正在准备…",
            "file_path": file_path,
            "file_size": file_size,
            "kb_id": kb_id,
            "source_kb_id": kb_id,
            "submitted_at": now,
            "updated_at": now,
        }
        if lease_id:
            status.update({
                "lease_id": lease_id,
                "lease_heartbeat_at": now,
                "lease_expires_at": (
                    now_at + timedelta(seconds=self._processing_lease_timeout_seconds())
                ).isoformat(),
            })
        self._processing_status[processing_id] = status
        self._persist_processing_status(status)

    def prepare_file_upload(
        self,
        *,
        file_content: bytes,
        file_path: str,
        kb_id: str,
        processing_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """持久化登记一个上传任务，但不启动任何后台处理。

        批量上传需要先为所有有效文件完成这一步，才能启动第一个任务。这样即使
        第一个视频在 MinIO 或 MLLM 阶段耗时很长，后续视频也已经有可恢复的
        processing_id，不会因浏览器刷新而从列表中消失。
        """
        task_id = processing_id or str(uuid.uuid4())
        # 即使进程在“登记全部文件”和“逐个启动后台任务”之间退出，该 lease 也会
        # 在超时后被查询方安全回收，而不会永远显示为排队中。
        lease_id = str(uuid.uuid4())
        self.register_processing_initial(
            task_id,
            file_path,
            kb_id,
            file_size=len(file_content),
            queued=True,
            lease_id=lease_id,
        )
        return {
            "processing_id": task_id,
            "status": "queued",
            "filename": file_path,
            "size": len(file_content),
        }

    def launch_prepared_file_upload(
        self,
        *,
        file_content: bytes,
        file_path: str,
        kb_id: str,
        processing_id: str,
        user_id: Optional[str] = None,
        asset_map: Optional[Dict[str, bytes]] = None,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """启动一个已通过 :meth:`prepare_file_upload` 登记的后台上传任务。"""
        existing_task = self._background_upload_tasks.get(processing_id)
        if existing_task is not None and not existing_task.done():
            return {
                "processing_id": processing_id,
                "status": "queued",
                "filename": file_path,
                "size": len(file_content),
            }

        lease_id = str(uuid.uuid4())
        if not self._acquire_processing_lease(processing_id, lease_id):
            raise ValueError(f"上传任务不可启动或已结束: {processing_id}")

        async def _run_upload_with_lease() -> Dict[str, Any]:
            # 心跳独立于具体解析阶段运行，故视频等待 semaphore 时也不会失去租约。
            heartbeat_task = asyncio.create_task(
                self._heartbeat_processing_lease(processing_id, lease_id),
                name=f"ingestion-upload-heartbeat-{processing_id}",
            )
            try:
                return await self.process_file_upload(
                    file_content=file_content,
                    file_path=file_path,
                    kb_id=kb_id,
                    user_id=user_id,
                    processing_id=processing_id,
                    asset_map=asset_map,
                    source_type=source_type,
                )
            finally:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass

        try:
            task = asyncio.create_task(
                _run_upload_with_lease(),
                name=f"ingestion-upload-{processing_id}",
            )
        except Exception as e:
            self._update_processing_status(processing_id, {
                "status": "failed",
                "stage": "error",
                "message": "后台上传任务启动失败。",
                "error": str(e),
            })
            raise
        self._background_upload_tasks[processing_id] = task

        def _on_done(completed_task: asyncio.Task[Any]) -> None:
            self._background_upload_tasks.pop(processing_id, None)
            try:
                if completed_task.cancelled():
                    self._update_processing_status(processing_id, {
                        "status": "failed",
                        "stage": "error",
                        "message": "服务重启或任务取消，处理未完成。",
                        "error": "background task cancelled",
                    })
                    return
                error = completed_task.exception()
                if error:
                    # process_file_upload 已把业务失败写入状态；这里消费异常，避免出现
                    # “Task exception was never retrieved”，同时保留运维日志。
                    logger.warning("后台上传任务结束异常 processing_id={}: {}", processing_id, error)
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.debug("读取后台上传任务结果失败 processing_id={}: {}", processing_id, e)

        task.add_done_callback(_on_done)
        return {
            "processing_id": processing_id,
            "status": "queued",
            "filename": file_path,
            "size": len(file_content),
        }

    def start_file_upload(
        self,
        *,
        file_content: bytes,
        file_path: str,
        kb_id: str,
        user_id: Optional[str] = None,
        processing_id: Optional[str] = None,
        asset_map: Optional[Dict[str, bytes]] = None,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """提交一个由服务端托管的上传任务。

        任务不再绑定 NDJSON 连接；浏览器刷新只会断开显示层，不会让已经接收的文件
        停在前端内存。状态在创建任务前即写入 Redis，以便文件列表补出排队项。
        """
        prepared = self.prepare_file_upload(
            file_content=file_content,
            file_path=file_path,
            kb_id=kb_id,
            processing_id=processing_id,
        )
        return self.launch_prepared_file_upload(
            file_content=file_content,
            file_path=file_path,
            kb_id=kb_id,
            processing_id=prepared["processing_id"],
            user_id=user_id,
            asset_map=asset_map,
            source_type=source_type,
        )

    async def _reprocess_persisted_video(
        self,
        *,
        processing_id: str,
        status: Dict[str, Any],
    ) -> Dict[str, Any]:
        """从 MinIO 原视频重新执行 Scene–Shot 管道，不重新上传也不生成新的 file_id。"""
        bucket = str(status.get("bucket") or "")
        object_path = str(status.get("object_path") or "")
        file_id = str(status.get("file_id") or "")
        file_path = str(status.get("file_path") or Path(object_path).name or "video.mp4")
        source_kb_id = str(status.get("source_kb_id") or status.get("kb_id") or "")
        actual_kb_id = str(status.get("kb_id") or source_kb_id)
        if not bucket or not object_path or not file_id or not source_kb_id:
            raise ValueError("原视频存储信息不完整，无法重新处理")

        self._update_processing_status(processing_id, {
            "status": "processing",
            "stage": "reading_source",
            "progress": 10,
            "message": "正在从对象存储读取原视频以重新解析…",
            "error": None,
        })
        file_content = await self.minio_adapter.get_file_content(bucket, object_path)
        parse_result = await self.parser_factory.parse_file(file_content, file_path)
        if parse_result.get("file_type") != "video":
            raise ValueError("原任务不是可重新处理的视频文件")
        try:
            video_duration = float(parse_result.get("duration") or 0.0)
        except (TypeError, ValueError):
            video_duration = 0.0
        if video_duration <= 0:
            parse_error = str((parse_result.get("metadata") or {}).get("parse_error") or "未能读取视频时长")
            raise ValueError(f"重新处理时视频元数据解析失败：{parse_error}")

        storage_result = {
            "file_id": file_id,
            "bucket": bucket,
            "object_path": object_path,
            "size": int(status.get("file_size") or len(file_content)),
        }
        # parse_file 已消费完原始字节；下面的 Scene–Shot 管道会按需从 MinIO 读取，
        # 避免重试期间同时持有两份大视频内存。
        del file_content
        self._update_processing_status(processing_id, {
            "status": "queued",
            "stage": "queued",
            "progress": 40,
            "message": "原视频已就绪，等待 Scene–Shot 重新解析队列…",
        })
        async with self._get_video_processing_semaphore():
            self._update_processing_status(processing_id, {
                "status": "processing",
                "stage": "processing",
                "progress": 40,
                "message": "正在重新执行 Scene–Shot 多模态解析…",
            })
            result = await self._process_video(
                parse_result=parse_result,
                storage_result=storage_result,
                kb_id=actual_kb_id,
                processing_id=processing_id,
                file_content=b"",
            )

        try:
            from app.core.portrait_trigger import trigger_portrait_rebuild

            if int(result.get("shots_count", 0) or 0) > 0:
                trigger_portrait_rebuild(actual_kb_id, reason="video_reprocessed")
        except Exception as portrait_error:
            logger.warning("视频重新处理后触发画像失败 kb_id={}: {}", actual_kb_id, portrait_error)

        self._update_processing_status(processing_id, {
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "message": "视频重新处理完成",
            "completed_at": datetime.utcnow().isoformat(),
            "result": result,
        })
        return result

    def retry_video_processing(self, processing_id: str) -> Dict[str, Any]:
        """重新入队一个已落盘但失败的视频任务。

        原视频和稳定 ``file_id`` 均保留在 MinIO，因此不要求用户重新上传，也不会在
        文件列表里生成重复文件。只允许失败/已失联的 video 任务重试，运行中的任务
        不会被抢占或中断。
        """
        if not processing_id:
            raise ValueError("缺少 processing_id")
        existing_task = self._background_upload_tasks.get(processing_id)
        if existing_task is not None and not existing_task.done():
            raise ValueError("视频任务仍在运行，不能重复入队")

        status = self._load_persisted_processing_status(processing_id) or self._processing_status.get(processing_id)
        if not isinstance(status, dict):
            raise LookupError("未找到上传任务或任务状态已过期")
        if str(status.get("file_type") or "") != "video":
            raise ValueError("仅支持重新处理已落盘的视频任务")
        if str(status.get("status") or "") in {"queued", "processing"}:
            raise ValueError("视频任务仍在运行，不能重复入队")
        if not all(status.get(field) for field in ("file_id", "bucket", "object_path")):
            raise ValueError("原视频尚未成功保存到对象存储，无法重新处理")

        now = datetime.utcnow().isoformat()
        retry_count = max(0, int(status.get("retry_count") or 0)) + 1
        status.update({
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "message": "已从原视频重新入队，等待处理…",
            "error": None,
            "failed_at": None,
            "lease_expired_at": None,
            "retry_count": retry_count,
            "retried_at": now,
            "updated_at": now,
        })
        self._processing_status[processing_id] = status
        self._persist_processing_status(status)

        lease_id = str(uuid.uuid4())
        if not self._acquire_processing_lease(processing_id, lease_id):
            raise RuntimeError("无法为重新处理的视频取得执行租约")

        async def _run_retry_with_lease() -> Dict[str, Any]:
            heartbeat_task = asyncio.create_task(
                self._heartbeat_processing_lease(processing_id, lease_id),
                name=f"ingestion-video-retry-heartbeat-{processing_id}",
            )
            try:
                return await self._reprocess_persisted_video(
                    processing_id=processing_id,
                    status=status,
                )
            except Exception as retry_error:
                self._update_processing_status(processing_id, {
                    "status": "failed",
                    "stage": "error",
                    "progress": 0,
                    "message": f"视频重新处理失败: {retry_error}",
                    "error": str(retry_error),
                    "failed_at": datetime.utcnow().isoformat(),
                })
                raise
            finally:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass

        task = asyncio.create_task(
            _run_retry_with_lease(),
            name=f"ingestion-video-retry-{processing_id}",
        )
        self._background_upload_tasks[processing_id] = task

        def _on_done(completed_task: asyncio.Task[Any]) -> None:
            self._background_upload_tasks.pop(processing_id, None)
            if completed_task.cancelled():
                self._update_processing_status(processing_id, {
                    "status": "failed",
                    "stage": "error",
                    "message": "服务重启或任务取消，视频重新处理未完成。",
                    "error": "background retry task cancelled",
                })
                return
            try:
                error = completed_task.exception()
                if error:
                    logger.warning("视频重新处理结束异常 processing_id={}: {}", processing_id, error)
            except asyncio.CancelledError:
                pass

        task.add_done_callback(_on_done)
        return {
            "processing_id": processing_id,
            "status": "queued",
            "file_id": str(status["file_id"]),
            "retry_count": retry_count,
            "message": "已从对象存储重新入队视频解析。",
        }

    def _update_processing_status(
        self, 
        processing_id: str, 
        updates: Dict[str, Any]
    ):
        """更新处理状态，并同步 Redis 使刷新后的文件列表可恢复。"""
        if processing_id not in self._processing_status:
            persisted = self._load_persisted_processing_status(processing_id)
            if persisted:
                self._processing_status[processing_id] = persisted
        if processing_id in self._processing_status:
            self._processing_status[processing_id].update(updates)
            self._processing_status[processing_id]["updated_at"] = datetime.utcnow().isoformat()
            self._persist_processing_status(self._processing_status[processing_id])

    def update_processing_status(self, processing_id: str, **updates: Any) -> None:
        """供外部（如热点导入编排）更新处理状态，便于前端轮询到拉取/整理等阶段。"""
        self._update_processing_status(processing_id, updates)
    
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
                persisted = self._load_persisted_processing_status(processing_id)
                if persisted:
                    self._processing_status[processing_id] = persisted
            if processing_id not in self._processing_status:
                return {
                    "processing_id": processing_id,
                    "status": "not_found",
                    "message": "处理ID不存在"
                }

            status = self._recover_expired_processing_status(self._processing_status[processing_id])
            return status.copy()
            
        except Exception as e:
            logger.error(f"获取处理状态失败: {str(e)}")
            return {
                "processing_id": processing_id,
                "status": "error",
                "error": str(e)
            }

    def get_file_processing_status(
        self,
        file_id: str,
        kb_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """按已落盘 file_id 查询进程内上传状态，供文件列表避免把未索引视频显示为“就绪”。

        该状态是最佳努力的 UX 信号，不是索引完成的唯一依据：服务重启后仍会由 Qdrant
        Shot 是否存在来判断最终就绪状态。
        """
        if not file_id:
            return None
        try:
            candidates = list(self._processing_status.values())
            if kb_id:
                candidates.extend(self.list_processing_statuses_for_kb(kb_id))
            else:
                client = self._get_processing_status_redis_client()
                if client is not None:
                    task_id = client.get(self._processing_status_file_key(str(file_id)))
                    if task_id:
                        item = self._load_persisted_processing_status(str(task_id))
                        if item:
                            candidates.append(item)
            matches = []
            for status in candidates:
                status = self._recover_expired_processing_status(status)
                if str(status.get("file_id") or "") != str(file_id):
                    continue
                stored_kb_id = str(status.get("kb_id") or "")
                source_kb_id = str(status.get("source_kb_id") or "")
                storage_bucket = str(status.get("bucket") or "")
                if kb_id and str(kb_id) not in {stored_kb_id, source_kb_id, storage_bucket}:
                    continue
                matches.append(status)
            if matches:
                # 同一 file_id 重试时，状态可能来自内存与 Redis 两份候选；按实际
                # 更新时间挑选，不能依赖 dict 插入顺序，否则旧 failed 会覆盖新任务。
                return max(matches, key=self._status_recency_timestamp).copy()
        except Exception as e:
            logger.debug("按 file_id 查询上传状态失败 file_id={}: {}", file_id, e)
        return None
    
    def _parse_audio_mllm_json(self, content: str) -> Optional[Dict[str, Any]]:
        """从 MLLM 返回的文本中解析出 transcript + description 的 JSON，失败返回 None。"""
        if not content or not content.strip():
            return None
        raw = content.strip()
        # 尝试去掉 ```json ... ``` 包裹
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
        if json_match:
            raw = json_match.group(1).strip()
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and "transcript" in obj:
                transcript = obj.get("transcript")
                description = obj.get("description")
                if transcript is None:
                    transcript = ""
                if not isinstance(transcript, str):
                    transcript = str(transcript) if transcript else ""
                if description is not None and not isinstance(description, str):
                    description = str(description) if description else ""
                return {"transcript": transcript, "description": description if isinstance(obj.get("description"), str) else None}
            return None
        except (json.JSONDecodeError, TypeError):
            return None

    async def _transcribe_audio(
        self,
        audio_bytes: bytes,
        audio_format: str,
        processing_id: str
    ) -> Dict[str, Any]:
        """音频转文本(ASR)；若 MLLM 支持一步输出，则同时返回 description，否则 description 为 None 由调用方回退到文本 LLM 生成。"""
        try:
            # 将音频转换为 base64（OpenRouter 要求 base64，不支持直接 URL）
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            # 使用「转写 + 描述」一步输出的 prompt（能处理音频的 MLLM 一次产出 transcript + description）
            prompt_text = prompt_engine.render_template("audio_transcription_with_description")
            
            # 构建多模态消息：OpenRouter 使用 input_audio 类型（见 https://openrouter.ai/docs/features/multimodal/audio）
            format_for_api = (audio_format or "mp3").lower()
            if format_for_api == "mpeg":
                format_for_api = "mp3"
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {
                            "type": "input_audio",
                            "input_audio": {"data": audio_base64, "format": format_for_api}
                        }
                    ]
                }
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="audio_transcription",
                model=None
            )
            
            if not result.success:
                logger.warning(f"音频转文本失败，使用占位符: {result.error}")
                return {"transcript": "音频转文本失败，请查看原始文件。", "description": None}
            
            data = result.data
            content = (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "") if data else ""
            if not content:
                return {"transcript": "音频转文本结果为空", "description": None}
            
            # 尝试解析为 JSON（transcript + description 一步输出）
            parsed = self._parse_audio_mllm_json(content)
            if parsed is not None:
                transcript = (parsed.get("transcript") or "").strip() or "音频转文本结果为空"
                description = (parsed.get("description") or "").strip() or None
                if description:
                    logger.debug("音频一步 MLLM 同时返回 transcript 与 description")
                return {"transcript": transcript, "description": description}
            
            # 回退：模型未返回合法 JSON，整段视为 transcript
            logger.debug("音频 MLLM 未返回 JSON，整段作为 transcript，description 将回退到文本 LLM 生成")
            return {"transcript": content.strip() or "音频转文本结果为空", "description": None}
            
        except Exception as e:
            logger.error(f"音频转文本失败: {str(e)}")
            return {"transcript": f"音频转文本处理失败: {str(e)}", "description": None}
    
    async def _generate_audio_description(
        self,
        audio_bytes: bytes,
        transcript: str,
        audio_format: str,
        processing_id: str
    ) -> str:
        """生成音频描述"""
        try:
            # 如果已有transcript，基于transcript生成描述
            if transcript and len(transcript.strip()) > 10:
                prompt = f"""请基于以下音频转写文本，生成一段简洁的音频内容描述，包括：
1. 音频的主要内容
2. 说话人的语气和情感
3. 场景或背景信息

转写文本：
{transcript}

描述："""
                
                messages = [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
                
                result = await self.llm_manager.chat(
                    messages=messages,
                    task_type="final_generation"
                )
                
                if result.success and result.data is not None:
                    data = result.data
                    description = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    if description:
                        return description
            
            # 如果转写失败或为空，返回默认描述
            return "音频文件，内容待处理"
            
        except Exception as e:
            logger.error(f"音频描述生成失败: {str(e)}")
            return "音频文件"
    
    async def _extract_key_frames(
        self,
        video_bytes: bytes,
        processing_id: str,
        interval: float = 10.0
    ) -> List[Dict[str, Any]]:
        """提取视频关键帧"""
        try:
            import cv2
            import numpy as np
            import tempfile
            import os
            
            # 保存到临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_file:
                tmp_file.write(video_bytes)
                tmp_path = tmp_file.name
            
            try:
                cap = cv2.VideoCapture(tmp_path)
                if not cap.isOpened():
                    raise ValueError("无法打开视频文件")
                
                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                duration = frame_count / fps if fps > 0 else 0
                
                key_frames = []
                frame_interval = int(fps * interval)  # 每interval秒提取一帧
                
                frame_index = 0
                while frame_index < frame_count:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                    ret, frame = cap.read()
                    
                    if not ret:
                        break
                    
                    # 转换为RGB
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    
                    # 转换为base64
                    from PIL import Image
                    pil_image = Image.fromarray(frame_rgb)
                    buffer = BytesIO()
                    pil_image.save(buffer, format='JPEG')
                    frame_bytes = buffer.getvalue()
                    frame_base64 = base64.b64encode(frame_bytes).decode('utf-8')
                    
                    timestamp = frame_index / fps if fps > 0 else 0
                    
                    key_frames.append({
                        "timestamp": float(timestamp),
                        "frame_index": int(frame_index),
                        "base64_content": f"data:image/jpeg;base64,{frame_base64}",
                        "image_bytes": frame_bytes,
                        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                        "description": ""  # 稍后填充
                    })
                    
                    frame_index += frame_interval
                
                cap.release()
                
                return key_frames
                
            finally:
                try:
                    os.unlink(tmp_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"关键帧提取失败: {str(e)}")
            return []
    
    async def _extract_video_audio(
        self,
        video_bytes: bytes,
        video_file_id: str,
        kb_id: str,
        processing_id: str
    ) -> Optional[Dict[str, Any]]:
        """提取视频中的音频轨道"""
        try:
            import subprocess
            import tempfile
            import os
            
            # 保存视频到临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_video:
                tmp_video.write(video_bytes)
                tmp_video_path = tmp_video.name
            
            # 提取音频到临时文件
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_audio:
                tmp_audio_path = tmp_audio.name
            
            try:
                # 使用ffmpeg提取音频
                # 注意：需要系统安装ffmpeg
                result = subprocess.run(
                    [
                        "ffmpeg", "-i", tmp_video_path,
                        "-vn", "-acodec", "libmp3lame",
                        "-y", tmp_audio_path
                    ],
                    capture_output=True,
                    timeout=300  # 5分钟超时
                )
                
                if result.returncode != 0:
                    logger.warning(f"ffmpeg提取音频失败: {result.stderr.decode()}")
                    return None
                
                # 读取提取的音频
                with open(tmp_audio_path, "rb") as f:
                    audio_bytes = f.read()
                
                # 上传音频到MinIO
                audio_storage_result = await self.minio_adapter.upload_file(
                    file_content=audio_bytes,
                    file_path=f"{video_file_id}_audio.mp3",
                    kb_id=kb_id,
                    file_type="audios"
                )
                
                # 处理音频（转文本）
                audio_transcript_result = await self._transcribe_audio(
                    audio_bytes,
                    "mp3",
                    processing_id
                )
                
                return {
                    "audio_file_id": audio_storage_result["file_id"],
                    "transcript": audio_transcript_result.get("transcript", "")
                }
                
            finally:
                try:
                    os.unlink(tmp_video_path)
                    if os.path.exists(tmp_audio_path):
                        os.unlink(tmp_audio_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"视频音频提取失败: {str(e)}")
            return None

    def _extract_frame_at_timestamp(self, video_bytes: bytes, timestamp_sec: float) -> Optional[bytes]:
        """从视频字节中截取指定时间戳的一帧，返回 JPEG 字节。"""
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                tmp.write(video_bytes)
                tmp_path = tmp.name
            try:
                return self._extract_frame_at_timestamp_from_path(tmp_path, timestamp_sec)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        except Exception as e:
            logger.debug("_extract_frame_at_timestamp 失败: %s", e)
            return None

    def _extract_frame_at_timestamp_from_path(self, video_path: str, timestamp_sec: float) -> Optional[bytes]:
        """从已落盘视频取一帧，供批量关键帧抽取复用同一源文件。"""
        try:
            import cv2

            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                return None
            try:
                fps = cap.get(cv2.CAP_PROP_FPS) or 1.0
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                # 先按毫秒 seek；部分编码的时间 seek 不稳定时按帧索引重试。
                cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp_sec) * 1000)
                ret, frame = cap.read()
                if (not ret or frame is None) and total_frames > 0:
                    frame_index = min(int(max(0.0, timestamp_sec) * fps), total_frames - 1)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_index))
                    ret, frame = cap.read()
            finally:
                cap.release()
            if not ret or frame is None:
                return None
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(frame_rgb)
            buffer = BytesIO()
            pil_image.save(buffer, format="JPEG")
            return buffer.getvalue()
        except Exception as e:
            logger.debug("_extract_frame_at_timestamp_from_path 失败: %s", e)
            return None

    def _extract_video_segment_to_file(
        self, full_video_path: str, start_sec: float, duration_sec: float
    ) -> Optional[str]:
        """精确转码切出 [start_sec, start_sec+duration_sec] 段，供模型以 0 秒为起点解析。

        不能用快速 seek + ``-c copy``：GOP 非关键帧处会让生成片段实际早于
        ``start_sec``，随后按请求时间平移会造成 Shot/ASR 时间轴整体偏移。
        """
        import subprocess
        import tempfile
        from app.core.config import settings
        if duration_sec <= 0:
            return None
        if not os.path.exists(full_video_path) or os.path.getsize(full_video_path) == 0:
            logger.warning(f"_extract_video_segment_to_file: 源文件不存在或为空 {full_video_path}")
            return None
        ffmpeg_bin = (getattr(settings, "ffmpeg_path", None) or "").strip() or "ffmpeg"
        segment_path: Optional[str] = None
        fd, segment_path = tempfile.mkstemp(suffix=".mp4")
        try:
            os.close(fd)
            # 把 -ss 放到输入后并重编码，使片段时间 0 准确对应原视频的 start_sec。
            result = subprocess.run(
                [
                    ffmpeg_bin, "-y",
                    "-i", full_video_path,
                    "-ss", str(start_sec),
                    "-t", str(duration_sec),
                    "-map", "0:v:0?",
                    "-map", "0:a?",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "20",
                    "-c:a", "aac",
                    "-movflags", "+faststart",
                    segment_path,
                ],
                capture_output=True,
                timeout=120,
            )
            if result.returncode != 0 or not os.path.exists(segment_path) or os.path.getsize(segment_path) == 0:
                stderr = (result.stderr or b"").decode("utf-8", errors="replace").strip()
                msg = stderr[-800:] if len(stderr) > 800 else stderr
                logger.warning(
                    f"ffmpeg 切段失败 start={start_sec:.1f} dur={duration_sec:.1f} returncode={result.returncode}: {msg or '(无 stderr)'}"
                )
                if os.path.exists(segment_path):
                    try:
                        os.unlink(segment_path)
                    except Exception:
                        pass
                return None
            return segment_path
        except subprocess.TimeoutExpired:
            logger.warning(f"ffmpeg 切段超时 start={start_sec:.1f} dur={duration_sec:.1f}")
            try:
                if segment_path and os.path.exists(segment_path):
                    os.unlink(segment_path)
            except Exception:
                pass
            return None
        except FileNotFoundError:
            logger.warning(
                "ffmpeg 未找到（当前使用: %s）。请安装 ffmpeg（如 macOS: brew install ffmpeg）或在本机 .env 中设置 FFMPEG_PATH 为可执行文件完整路径。",
                ffmpeg_bin,
            )
            try:
                if segment_path and os.path.exists(segment_path):
                    os.unlink(segment_path)
            except Exception:
                pass
            return None
        except Exception as e:
            logger.debug("_extract_video_segment_to_file 失败: %s", e)
            try:
                if segment_path and os.path.exists(segment_path):
                    os.unlink(segment_path)
            except Exception:
                pass
            return None

    async def _parse_video_scenes_mllm(
        self,
        file_content: bytes,
        duration: float,
        processing_id: str,
        window_seconds: float = 480.0,
        overlap_seconds: float = 10.0,
        *,
        video_url: Optional[str] = None,
        video_local_path: Optional[str] = None,
        video_fps: int = 2,
        previous_segments_summary: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        视频场景+关键帧解析。仅支持将视频交给 MLLM 解析（video_local_path 或 video_url），
        不做固定关键帧抽帧。优先本地上传（file://），避免 MinIO presigned URL 外网不可达导致 400。
        previous_segments_summary：长视频多段时，前几段已解析的场景描述拼接文本，供 MLLM 理解连贯性。
        参见 docs/视频模态技术方案.md 3.2 / 3.3。
        """
        prev_summary = (previous_segments_summary or "").strip()
        if not prev_summary:
            prev_summary = "（本段为视频首段，无前文。）"
        # 优先：本地上传（百炼 MultiModalConversation file://），单次调用覆盖全片；不依赖 URL 被外网访问
        if video_local_path and os.path.exists(video_local_path):
            prompt_text = prompt_engine.render_template(
                "video_scene_parsing",
                chunk_duration_seconds=int(duration),
                previous_segments_summary=prev_summary,
            )
            msg_content = [
                {"type": "video_local", "path": video_local_path, "fps": video_fps},
                {"type": "text", "text": prompt_text},
            ]
            logger.info("video_parsing 使用 video_local 本地上传（fps={}）", video_fps)
            result = await self.llm_manager.chat(
                messages=[{"role": "user", "content": msg_content}],
                task_type="video_parsing",
            )
            if not result.success or not result.data:
                return []
            raw = result.data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not raw:
                return []
            # content 可能是 str 或从 list 拼出的 str，统一按 str 处理
            if isinstance(raw, list):
                raw = "".join(
                    (p.get("text") or p.get("content") or str(p)) if isinstance(p, dict) else str(p)
                    for p in raw
                )
            arr = self._extract_scenes_json_array(raw)
            if not arr:
                logger.warning(
                    "video_parsing video_local 返回内容解析为场景数组失败，raw 前 500 字符: {}",
                    (raw[:500] + "..." if len(raw) > 500 else raw) if raw else "(空)",
                )
                return []
            return [
                {
                    "start_time": float(s.get("start_time", 0)),
                    "end_time": float(s.get("end_time", 0)),
                    "scene_summary": s.get("scene_summary", ""),
                    "keyframes": [
                        {"timestamp": float(kf.get("timestamp", 0)), "description": kf.get("description", "")}
                        for kf in (s.get("keyframes") or [])
                        if isinstance(kf, dict)
                    ],
                }
                for s in arr
                if isinstance(s, dict)
            ]

        # 备选：传视频 URL（需 URL 可被模型服务拉取，MinIO 内网时易 400）
        if video_url:
            prompt_text = prompt_engine.render_template(
                "video_scene_parsing",
                chunk_duration_seconds=int(duration),
                previous_segments_summary=prev_summary,
            )
            msg_content = [
                {"type": "video_url", "video_url": {"url": video_url}, "fps": video_fps},
                {"type": "text", "text": prompt_text},
            ]
            logger.info("video_parsing 使用 video_url 单次调用（fps={}）", video_fps)
            result = await self.llm_manager.chat(
                messages=[{"role": "user", "content": msg_content}],
                task_type="video_parsing",
            )
            if result.success and result.data:
                raw = result.data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if raw:
                    arr = self._extract_scenes_json_array(raw)
                    if arr:
                        return [
                            {
                                "start_time": float(s.get("start_time", 0)),
                                "end_time": float(s.get("end_time", 0)),
                                "scene_summary": s.get("scene_summary", ""),
                                "keyframes": [
                                    {"timestamp": float(kf.get("timestamp", 0)), "description": kf.get("description", "")}
                                    for kf in (s.get("keyframes") or [])
                                    if isinstance(kf, dict)
                                ],
                            }
                            for s in arr
                            if isinstance(s, dict)
                        ]
        logger.warning(
            "video_parsing 未提供 video_url 或 video_local_path，无法将视频交给 MLLM 解析（不做固定关键帧抽帧）"
        )
        return []

    @staticmethod
    def _extract_scenes_json_array(raw: str):  # -> Optional[List[Any]]
        """
        从 MLLM 返回文本中抽取场景 JSON 数组。兼容被 markdown 代码块或前后说明文字包裹的情况。
        """
        import re
        import json as json_lib
        if not raw or not raw.strip():
            return None
        text = raw.strip()
        # 1) 去掉 ```json ... ``` 或 ``` ... ```
        for pattern in (r"^```(?:json)?\s*\n?", r"\n?\s*```\s*$"):
            text = re.sub(pattern, "", text)
        text = text.strip()
        # 2) 去掉首部说明文字，从第一个 [ 开始（兼容「以下是…」「根据视频…」等前缀）
        first_bracket = text.find("[")
        if first_bracket > 0:
            text = text[first_bracket:]
        # 3) 容忍尾部逗号（部分模型会输出 ,] 或 ,}）
        text = re.sub(r",\s*]", "]", text)
        text = re.sub(r",\s*}", "}", text)
        # 4) 直接解析
        try:
            arr = json_lib.loads(text)
            return arr if isinstance(arr, list) else [arr]
        except json_lib.JSONDecodeError:
            pass
        # 5) 找第一个 '[' 起、括号匹配的 JSON 数组子串
        start = text.find("[")
        if start == -1:
            return None
        depth = 0
        in_string = None
        escape = False
        for i in range(start, len(text)):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == "\\" and in_string:
                escape = True
                continue
            if in_string:
                if c == in_string:
                    in_string = None
                continue
            if c in ('"', "'"):
                in_string = c
                continue
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    try:
                        arr = json_lib.loads(text[start : i + 1])
                        return arr if isinstance(arr, list) else [arr]
                    except json_lib.JSONDecodeError:
                        break
        return None

    def _merge_overlapping_scenes(
        self,
        scenes: List[Dict[str, Any]],
        overlap_seconds: float,
    ) -> List[Dict[str, Any]]:
        """相邻场景在重叠区内交叉且摘要相似则合并为一（方案 3.3 可选）。"""
        if len(scenes) <= 1:
            return scenes
        scenes = sorted(scenes, key=lambda s: s.get("start_time", 0))
        merged: List[Dict[str, Any]] = [scenes[0]]
        for s in scenes[1:]:
            prev = merged[-1]
            prev_end = prev.get("end_time", 0)
            curr_start = s.get("start_time", 0)
            curr_end = s.get("end_time", 0)
            prev_sum = (prev.get("scene_summary") or "")[:80]
            curr_sum = (s.get("scene_summary") or "")[:80]
            # 时间在重叠区内交叉：上一段 end 与当前 start 的间隙小于重叠时长，或存在重叠
            in_overlap = (curr_start - prev_end) < overlap_seconds or curr_start < prev_end
            # 简单相似：前缀一致或较长公共子串（避免过度合并）
            similar = prev_sum == curr_sum or (len(prev_sum) > 20 and prev_sum[:20] == curr_sum[:20])
            if in_overlap and similar:
                prev["end_time"] = max(prev_end, curr_end)
                prev["keyframes"] = (prev.get("keyframes") or []) + (s.get("keyframes") or [])
                prev["scene_summary"] = prev.get("scene_summary") or s.get("scene_summary", "")
            else:
                merged.append(s)
        return merged

    async def _build_keyframe_points_from_scenes(
        self,
        file_content: bytes,
        scenes: List[Dict[str, Any]],
        file_id: str,
        file_path: str,
        kb_id: str,
        duration: float,
        video_format: str,
        resolution: str,
        fps: float,
        has_audio: bool,
        audio_file_id: Optional[str],
        processing_id: str,
    ) -> List[Dict[str, Any]]:
        """
        根据 MLLM 解析出的场景列表：按时间戳截帧、上传关键帧图、计算 scene_vec/frame_vec/clip_vec，组装 keyframe_points。
        """
        keyframe_points: List[Dict[str, Any]] = []
        scene_summaries = [s.get("scene_summary", "") for s in scenes]
        embed_scene = await self.llm_manager.embed(texts=scene_summaries, task_type="embedding")
        if not embed_scene.success:
            raise ValueError("场景摘要向量化失败")
        scene_vectors = embed_scene.data if isinstance(embed_scene.data, list) else [embed_scene.data]
        for seg_idx, scene in enumerate(scenes):
            scene_vec = scene_vectors[seg_idx] if seg_idx < len(scene_vectors) else scene_vectors[0]
            scene_start = float(scene.get("start_time", 0))
            scene_end = float(scene.get("end_time", 0))
            scene_summary = scene.get("scene_summary", "")
            segment_id = f"seg_{seg_idx}"
            kfs = scene.get("keyframes") or []
            if not kfs:
                ts = (scene_start + scene_end) / 2
                kfs = [{"timestamp": ts, "description": scene_summary[:100]}]
            frame_descriptions = [k.get("description", "") for k in kfs]
            embed_frames = await self.llm_manager.embed(texts=frame_descriptions, task_type="embedding")
            if not embed_frames.success:
                frame_vecs = [scene_vec] * len(kfs)
            else:
                frame_vecs = embed_frames.data if isinstance(embed_frames.data, list) else [embed_frames.data]
            for i, kf in enumerate(kfs):
                ts = float(kf.get("timestamp", 0))
                desc = kf.get("description", "")
                frame_bytes = self._extract_frame_at_timestamp(file_content, ts)
                frame_image_path = ""
                clip_vec = [0.0] * 768
                if frame_bytes:
                    seg_ts = f"{segment_id}_{ts:.1f}".replace(".", "_")
                    custom_path = f"videos/{file_id}/keyframes/{seg_ts}.jpg"
                    await self.minio_adapter.upload_file(
                        file_content=frame_bytes,
                        file_path="frame.jpg",
                        kb_id=kb_id,
                        file_type="videos",
                        custom_object_path=custom_path,
                        file_id_override=file_id,
                    )
                    frame_image_path = custom_path
                    clip_input = {
                        "image_bytes": frame_bytes,
                        "width": 1920,
                        "height": 1080,
                        "format": "jpg",
                    }
                    try:
                        clip_result = await self._vectorize_with_clip(clip_input, processing_id)
                        clip_vec = clip_result["clip_vector"]
                    except Exception as e:
                        logger.debug("关键帧 CLIP 向量化失败: %s", e)
                payload = {
                    "file_id": file_id,
                    "file_path": file_path,
                    "segment_id": segment_id,
                    "scene_start_time": scene_start,
                    "scene_end_time": scene_end,
                    "scene_summary": scene_summary,
                    "frame_timestamp": ts,
                    "frame_description": desc,
                    "frame_image_path": frame_image_path,
                    "duration": duration,
                    "video_format": video_format,
                    "resolution": resolution,
                    "fps": fps,
                    "has_audio": has_audio,
                }
                if audio_file_id:
                    payload["audio_file_id"] = audio_file_id
                keyframe_points.append({
                    "scene_vec": scene_vec,
                    "frame_vec": frame_vecs[i] if i < len(frame_vecs) else scene_vec,
                    "clip_vec": clip_vec,
                    "payload": payload,
                })
        return keyframe_points

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
