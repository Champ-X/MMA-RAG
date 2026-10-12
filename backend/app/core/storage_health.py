"""Bounded, read-only storage probes and credential-free failure details.

Keep this independent of VectorStore: checking availability must not create
collections, import a model, or turn a storage exception into an empty KB list.
"""
from __future__ import annotations

import httpx
import urllib3
from minio import Minio
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException

from app.core.config import settings

LABELS = {"qdrant": "Qdrant 向量存储", "minio": "MinIO 文件存储"}


class StorageUnavailable(RuntimeError):
    def __init__(self, detail: dict):
        self.detail = detail
        super().__init__(detail["message"])


class StorageSchemaMismatch(ValueError):
    """Existing user data needs an explicit migration, not onboarding deletion."""


def storage_failure(component: str, error: Exception) -> dict:
    """Classify without copying URLs, response bodies, headers or exception text."""
    source = error.source if isinstance(error, ResponseHandlingException) else error
    response = getattr(source, "response", None)
    status = getattr(source, "status_code", None) or getattr(response, "status_code", None) or getattr(response, "status", None)
    status = status if type(status) is int and 100 <= status <= 599 else None
    code = getattr(source, "code", None)
    label = LABELS[component]
    if status in (401, 403) or code in {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
        reason, message = "authentication", f"{label}拒绝访问，请检查存储凭证与权限。"
    elif status:
        reason, message = "http_error", f"{label}返回 HTTP {status}。"
    elif isinstance(source, (httpx.TimeoutException, urllib3.exceptions.TimeoutError, TimeoutError)) and not isinstance(source, urllib3.exceptions.NewConnectionError):
        reason, message = "timeout", f"{label}连接或响应超时。"
    elif isinstance(source, (httpx.ConnectError, urllib3.exceptions.NewConnectionError, ConnectionError, OSError)):
        reason, message = "connection", f"无法连接{label}，请检查容器网络与服务状态。"
    elif isinstance(source, StorageSchemaMismatch):
        reason, message = "schema_mismatch", f"{label}现有集合结构与当前版本不兼容，已停止初始化并保留原集合。"
    else:
        reason, message = "unavailable", f"{label}检查失败。"
    hint = f"运行 tessmora doctor 或 tessmora logs --service {component} 检查；修复后重新运行 tessmora setup，已保存配置与下载缓存会保留。"
    if status in (502, 503, 504):
        hint = "请检查存储服务及代理绕过设置，容器内部服务应直连。" + hint
    if reason == "schema_mismatch":
        hint = "请备份现有知识库并确认迁移方案，或用新的 --instance 创建独立安装。重试不会删除或重建现有集合。"
    return {"name": component, "success": False, "error_code": reason,
            "error_type": type(source).__name__, "message": message, "hint": hint,
            **({"http_status": status} if status else {})}


def check_qdrant() -> dict:
    client = None
    try:
        client = QdrantClient(**settings.get_qdrant_config(), https=False, timeout=5)
        client.get_collections()
        return {"name": "qdrant", "success": True, "message": "Qdrant 集合读取正常"}
    except Exception as error:
        return storage_failure("qdrant", error)
    finally:
        if client is not None:
            client.close()


def check_minio() -> dict:
    # urllib3 PoolManager connects directly; no env proxy or SDK retry loop.
    pool = urllib3.PoolManager(timeout=urllib3.Timeout(connect=3, read=5), retries=False)
    try:
        client = Minio(settings.minio_endpoint, access_key=settings.minio_access_key,
                       secret_key=settings.minio_secret_key, secure=settings.minio_secure,
                       region=settings.minio_region or "us-east-1", http_client=pool)
        client.list_buckets()
        return {"name": "minio", "success": True, "message": "MinIO 存储桶读取正常"}
    except Exception as error:
        return storage_failure("minio", error)
    finally:
        pool.clear()


def check_storage() -> dict:
    checks = [check_qdrant(), check_minio()]
    return {"success": all(row["success"] for row in checks), "checks": checks}
