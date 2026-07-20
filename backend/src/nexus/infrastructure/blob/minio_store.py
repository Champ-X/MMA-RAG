from __future__ import annotations

import hashlib
import io
from typing import BinaryIO

from minio import Minio
from minio.error import S3Error

from nexus.shared.domain.errors import ConflictError, NotFoundError


class MinioBlobStore:
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool,
    ) -> None:
        self.client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        self.bucket = bucket

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(self.bucket):
            self.client.make_bucket(self.bucket)

    def put(self, key: str, data: bytes, *, content_type: str, content_hash: str) -> None:
        actual_hash = hashlib.sha256(data).hexdigest()
        if actual_hash != content_hash:
            raise ConflictError("Blob hash does not match manifest")
        self.ensure_bucket()
        try:
            existing = self.client.stat_object(self.bucket, key)
            if existing.metadata.get("x-amz-meta-sha256") == content_hash:
                return
            raise ConflictError("Existing content-addressed object has a different hash")
        except S3Error as exc:
            if exc.code not in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                raise
        self.client.put_object(
            self.bucket,
            key,
            io.BytesIO(data),
            len(data),
            content_type=content_type,
            metadata={"sha256": content_hash},
        )

    def get(self, key: str) -> bytes:
        try:
            response = self.client.get_object(self.bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                raise NotFoundError("Blob not found", details={"key": key}) from exc
            raise

    def open(self, key: str) -> BinaryIO:
        return io.BytesIO(self.get(key))

    def exists(self, key: str) -> bool:
        try:
            self.client.stat_object(self.bucket, key)
            return True
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                return False
            raise

    def delete(self, key: str) -> None:
        self.client.remove_object(self.bucket, key)

    def list_keys(self) -> list[str]:
        if not self.client.bucket_exists(self.bucket):
            return []
        return [item.object_name for item in self.client.list_objects(self.bucket, recursive=True)]
