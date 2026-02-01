"""
MinIO存储适配器
处理原始文件的存储和检索
"""

from typing import Dict, List, Any, Optional, BinaryIO
import io
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import minio
from minio.error import S3Error

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

def _sanitize_bucket_name(kb_id: str) -> str:
    """将 kb_id 转为合法的 S3 存储桶名（小写、数字、连字符，3-63 字符）"""
    # UUID 等已是合规格式，仅做小写与替换非法字符
    s = kb_id.lower().replace("_", "-")
    return "".join(c for c in s if c in "abcdefghijklmnopqrstuvwxyz0-9-")[:63].strip("-") or "kb-default"


class MinIOAdapter:
    """MinIO存储适配器。约定：一个知识库对应一个 Bucket，该知识库下所有文档与图片均存于此 Bucket。"""

    @staticmethod
    def bucket_name_for_kb(kb_id: str) -> str:
        """返回知识库对应的存储桶名称。同一知识库的所有数据（文档+图片）均存于此桶。"""
        if not kb_id:
            return "kb-default"
        return f"kb-{_sanitize_bucket_name(kb_id)}"

    def get_bucket_for_kb(self, kb_id: str) -> str:
        """
        根据 kb_id 解析实际存储桶名。
        - 若 kb_id 本身是 MinIO 中存在的存储桶名，直接返回；
        - 否则按约定返回 kb-{sanitize(kb_id)}。
        """
        if not kb_id:
            return "kb-default"
        try:
            if self.client.bucket_exists(kb_id):
                return kb_id
        except Exception:
            pass
        return self.bucket_name_for_kb(kb_id)

    def __init__(self):
        self.client = minio.Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure
        )
        # 延迟初始化：不再预建全局 documents/images 桶，改为按知识库建桶
        try:
            self._ensure_buckets()
        except Exception as e:
            logger.warning(f"MinIO 初始化时无法连接，将在首次使用时重试: {str(e)}")
            logger.warning(f"MinIO 端点: {settings.minio_endpoint}")
            logger.warning("请确保 MinIO 服务正在运行，或检查网络连接")

    def _ensure_buckets(self):
        """兼容旧逻辑：不再预建 documents/images，按知识库建桶在 ensure_bucket_for_kb 中完成"""
        pass

    def ensure_bucket_for_kb(self, kb_id: str) -> None:
        """确保该知识库对应的存储桶存在；若不存在则创建。"""
        bucket_name = self.get_bucket_for_kb(kb_id)
        try:
            if not self.client.bucket_exists(bucket_name):
                self.client.make_bucket(bucket_name)
                logger.info(f"创建知识库存储桶: {bucket_name}")
        except Exception as e:
            error_msg = str(e)
            if any(k in error_msg.lower() for k in [
                "nodename nor servname provided",
                "failed to establish",
                "connection refused",
                "name or service not known",
            ]):
                raise
            logger.error(f"创建存储桶失败 {bucket_name}: {error_msg}")
    
    async def upload_file(
        self,
        file_content: bytes,
        file_path: str,
        kb_id: str,
        file_type: str
    ) -> Dict[str, Any]:
        """
        上传文件到 MinIO。同一知识库的所有数据（文档+图片）存于同一 Bucket。

        Args:
            file_content: 文件二进制内容
            file_path: 原始文件路径
            kb_id: 知识库ID
            file_type: 文件类型 (documents/images)，在桶内作为目录前缀区分

        Returns:
            上传结果信息，含 bucket、object_path（供向量 payload 与预签名 URL 使用）
        """
        try:
            file_id = str(uuid.uuid4())
            object_name = f"{file_type}/{file_id}_{Path(file_path).name}"

            bucket_name = self.get_bucket_for_kb(kb_id)
            self.ensure_bucket_for_kb(kb_id)

            self.client.put_object(
                bucket_name=bucket_name,
                object_name=object_name,
                data=io.BytesIO(file_content),
                length=len(file_content),
                content_type="application/octet-stream"
            )

            presigned_url = self.client.presigned_get_object(
                bucket_name=bucket_name,
                object_name=object_name,
                expires=timedelta(days=7)
            )

            logger.info(f"文件上传成功: {bucket_name}/{object_name}")

            return {
                "file_id": file_id,
                "bucket": bucket_name,
                "object_path": object_name,
                "presigned_url": presigned_url,
                "size": len(file_content),
                "uploaded_at": datetime.utcnow().isoformat()
            }
        except S3Error as e:
            logger.error(f"文件上传失败: {str(e)}")
            raise
    
    async def get_file_content(self, bucket: str, object_path: str) -> bytes:
        """从MinIO获取文件内容"""
        try:
            response = self.client.get_object(bucket, object_path)
            content = response.read()
            response.close()
            response.release_conn()
            return content
            
        except S3Error as e:
            logger.error(f"获取文件失败 {bucket}/{object_path}: {str(e)}")
            raise
    
    async def get_presigned_url(
        self, 
        bucket: str, 
        object_path: str, 
        expires_hours: int = 24
    ) -> str:
        """获取预签名URL"""
        try:
            return self.client.presigned_get_object(
                bucket_name=bucket,
                object_name=object_path,
                expires=timedelta(hours=expires_hours)
            )
        except S3Error as e:
            logger.error(f"生成预签名URL失败: {str(e)}")
            raise
    
    async def delete_file(self, bucket: str, object_path: str) -> bool:
        """删除文件"""
        try:
            self.client.remove_object(bucket, object_path)
            logger.info(f"文件删除成功: {bucket}/{object_path}")
            return True
        except S3Error as e:
            logger.error(f"文件删除失败 {bucket}/{object_path}: {str(e)}")
            return False
    
    def bucket_exists(self, bucket: str) -> bool:
        """检查存储桶是否存在"""
        try:
            return self.client.bucket_exists(bucket)
        except S3Error as e:
            logger.warning(f"检查存储桶存在性失败 {bucket}: {e}")
            return False

    def list_bucket_names(self) -> List[str]:
        """列出所有存储桶名称"""
        try:
            buckets = self.client.list_buckets()
            return [b.name for b in buckets]
        except Exception as e:
            logger.warning(f"列出存储桶失败: {e}")
            return []

    async def remove_bucket(self, bucket: str) -> bool:
        """删除空的存储桶"""
        try:
            self.client.remove_bucket(bucket)
            logger.info(f"存储桶已删除: {bucket}")
            return True
        except S3Error as e:
            logger.warning(f"删除存储桶失败 {bucket}: {e}")
            return False

    async def list_files(
        self,
        bucket: str,
        prefix: str = "", 
        max_keys: int = 1000
    ) -> List[Dict[str, Any]]:
        """列出文件（recursive=True 确保获取所有嵌套对象）"""
        try:
            objects = self.client.list_objects(
                bucket,
                prefix=prefix if prefix else None,
                recursive=True,
            )
            
            files = []
            for obj in objects:
                files.append({
                    "object_path": obj.object_name,
                    "size": obj.size,
                    "last_modified": obj.last_modified,
                    "etag": obj.etag
                })
            
            return files
            
        except S3Error as e:
            logger.error(f"列出文件失败: {str(e)}")
            return []
    
    async def get_bucket_stats(self, bucket: str) -> Dict[str, Any]:
        """获取存储桶统计信息"""
        try:
            # 获取存储桶中的对象列表
            objects = list(self.client.list_objects(bucket))
            
            # 计算总大小，过滤掉 None 值
            total_size = sum(obj.size or 0 for obj in objects if obj.size is not None)
            file_count = len(objects)
            
            # 存储大小使用总大小（MinIO 没有 stat_bucket 方法）
            storage_size = total_size
            
            return {
                "bucket": bucket,
                "file_count": file_count,
                "total_size_bytes": total_size,
                "storage_size_bytes": storage_size,
                "last_updated": datetime.utcnow().isoformat()
            }
            
        except S3Error as e:
            logger.error(f"获取存储桶统计失败: {str(e)}")
            return {}
    
    async def copy_file(
        self,
        source_bucket: str,
        source_path: str,
        dest_bucket: str,
        dest_path: str
    ) -> bool:
        """复制文件"""
        try:
            self.client.copy_object(
                dest_bucket,
                dest_path,
                f"{source_bucket}/{source_path}"
            )
            logger.info(f"文件复制成功: {source_bucket}/{source_path} -> {dest_bucket}/{dest_path}")
            return True
        except S3Error as e:
            logger.error(f"文件复制失败: {str(e)}")
            return False
    
    def get_file_url(self, bucket: str, object_path: str) -> str:
        """获取文件访问URL"""
        # 在实际部署中，这里应该返回CDN或负载均衡器的URL
        return f"https://storage.example.com/{bucket}/{object_path}"
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 尝试列出存储桶来检查连接
            buckets = self.client.list_buckets()
            
            return {
                "status": "healthy",
                "total_buckets": len(buckets),
                "buckets": [bucket.name for bucket in buckets]
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }