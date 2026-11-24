"""Signed, read-only desktop object delivery through the desktop API proxy."""
from __future__ import annotations

from email.utils import format_datetime
import mimetypes
from pathlib import PurePosixPath
import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from minio.error import S3Error

from app.modules.ingestion.storage.local_objects import (
    LocalObjectClient, desktop_storage_enabled, verify_object_signature,
)

router = APIRouter()


@router.api_route("/{bucket}/{object_path:path}", methods=["GET", "HEAD"])
def read_object(bucket: str, object_path: str, request: Request):
    # The outer desktop gate permits only GET/HEAD on this route. Each capability
    # is limited to one exact object and expires; no access token appears in URLs.
    if not desktop_storage_enabled():
        raise HTTPException(404, "Object endpoint is unavailable")
    if not verify_object_signature(bucket, object_path, request.query_params.get("expires", ""),
                                   request.query_params.get("signature", "")):
        raise HTTPException(403, "Object link is invalid or expired")
    client = LocalObjectClient()
    try:
        info = client.stat_object(bucket, object_path)
        media_type = info.content_type
        if media_type == "application/octet-stream":
            media_type = mimetypes.guess_type(object_path)[0] or media_type
        inline = media_type in {"application/pdf", "text/plain"} or (
            media_type.startswith(("image/", "audio/", "video/")) and media_type != "image/svg+xml")
        headers = {
            "Accept-Ranges": "bytes", "ETag": f'"{info.etag}"',
            "Last-Modified": format_datetime(info.last_modified, usegmt=True),
            "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Content-Disposition": ("inline" if inline else "attachment") + "; filename*=UTF-8''" + quote(PurePosixPath(object_path).name),
        }
        start, end, status = 0, info.size - 1, 200
        requested = request.headers.get("range")
        if_range = request.headers.get("if-range")
        if requested and (not if_range or if_range in {headers["ETag"], headers["Last-Modified"]}):
            match = re.fullmatch(r"bytes=([0-9]{0,18})-([0-9]{0,18})", requested)
            if not match or not any(match.groups()):
                raise HTTPException(416, "Unsupported object range", headers={"Content-Range": f"bytes */{info.size}"})
            left, right = match.groups()
            if left:
                start, end = int(left), min(int(right), info.size - 1) if right else info.size - 1
            else:
                start = max(0, info.size - int(right))
            if not 0 <= start <= end < info.size:
                raise HTTPException(416, "Object range is outside the file", headers={"Content-Range": f"bytes */{info.size}"})
            headers["Content-Range"] = f"bytes {start}-{end}/{info.size}"
            status = 206
        headers["Content-Length"] = str(end - start + 1)
        if request.method == "HEAD":
            return Response(status_code=status, headers=headers, media_type=media_type)
        # Open before returning so a concurrent replacement cannot mix an old
        # Content-Length with new bytes. Existing Pi downloads use the same check.
        source = client.get_object(bucket, object_path, offset=start, length=end - start + 1,
                                   request_headers={"If-Match": info.etag})
        def chunks():
            try:
                yield from source.stream(256 * 1024)
            finally:
                source.close()
        from starlette.background import BackgroundTask
        return StreamingResponse(chunks(), status_code=status, headers=headers, media_type=media_type,
                                 background=BackgroundTask(source.close))
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchBucket"}:
            raise HTTPException(404, "Object not found") from None
        if error.code == "PreconditionFailed":
            raise HTTPException(409, "Object changed; retry the request") from None
        raise HTTPException(503, "Object storage is unavailable") from None
