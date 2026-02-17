"""
知识库导入 API：从 URL 或多渠道搜索下载后写入知识库。
与 /api/upload 并列：upload=本地上传，import=从网络/搜索拉取并导入。
"""

import asyncio
import json
import threading
from pathlib import Path
from queue import Empty, Queue
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, HttpUrl

from app.core.config import settings
from app.core.logger import get_logger
from app.modules.ingestion.service import get_ingestion_service
from app.modules.ingestion.sources import UrlSource, MediaDownloaderSource, FolderSource

router = APIRouter()
logger = get_logger(__name__)
ingestion_service = get_ingestion_service()


# ---------- 请求体 ----------


class ImportUrlBody(BaseModel):
    url: HttpUrl
    kb_id: str = Field(..., min_length=1)
    filename: Optional[str] = None


class ImportSearchBody(BaseModel):
    kb_id: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    source: str = Field(..., description="google_images | pixabay | internet_archive")
    quantity: int = Field(5, ge=1, le=20)
    pixabay_image_type: Optional[str] = "photo"
    pixabay_order: Optional[str] = "popular"
    archive_sort: Optional[str] = "relevance"
    randomize: Optional[bool] = True


class ImportFolderBody(BaseModel):
    folder_path: str = Field(..., min_length=1)
    kb_id: str = Field(..., min_length=1)
    recursive: bool = True
    extensions: Optional[List[str]] = None
    exclude_patterns: Optional[List[str]] = None
    max_files: int = Field(500, ge=1, le=2000)


def _validate_folder_path_allowed(folder_path: str) -> Path:
    """校验 folder_path 在配置的白名单目录下，返回解析后的绝对路径。否则抛出 ValueError。"""
    allowed = settings.import_folder_allowed_base_paths or []
    if not allowed:
        raise ValueError("未配置文件夹导入白名单（IMPORT_FOLDER_ALLOWED_BASE_PATHS），不允许从本地文件夹导入。")
    resolved = Path(folder_path).resolve()
    for base_str in allowed:
        base_resolved = Path(base_str).resolve()
        try:
            if resolved == base_resolved or resolved.is_relative_to(base_resolved):
                return resolved
        except AttributeError:
            if resolved == base_resolved or (resolved.parts[: len(base_resolved.parts)] == base_resolved.parts):
                return resolved
    raise ValueError(f"路径不在允许的白名单内，请使用以下目录之一或其子目录: {allowed}")


# ---------- 端点 ----------


@router.post("/url/start")
async def import_from_url_start(body: ImportUrlBody):
    """从 URL 下载文件并异步导入知识库。先下载，再在后台执行解析/向量化，立即返回 processing_id 供前端轮询进度。"""
    import uuid
    try:
        url_source = UrlSource()
        result = await url_source.fetch_async(str(body.url))
        filename = body.filename or result.suggested_filename
        content = result.content
        kb_id = str(body.kb_id)
        processing_id = str(uuid.uuid4())
        ingestion_service.register_processing_initial(processing_id, filename, kb_id)

        async def run_ingest():
            try:
                await ingestion_service.process_file_upload(
                    file_content=content,
                    file_path=filename,
                    kb_id=kb_id,
                    user_id=None,
                    processing_id=processing_id,
                )
            except Exception as e:
                logger.exception("import_from_url background ingest failed: %s", e)

        asyncio.create_task(run_ingest())
        return JSONResponse(
            status_code=202,
            content={
                "processing_id": processing_id,
                "kb_id": kb_id,
                "filename": filename,
                "message": "已开始处理，请轮询 /api/upload/progress/{processing_id} 获取进度",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("import_from_url_start failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/url")
async def import_from_url(body: ImportUrlBody):
    """从单个 URL 下载文件并同步导入知识库（保留以兼容旧调用，推荐使用 /url/start + 轮询进度）。"""
    try:
        url_source = UrlSource()
        result = await url_source.fetch_async(str(body.url))
        filename = body.filename or result.suggested_filename
        ingest_result = await ingestion_service.process_file_upload(
            file_content=result.content,
            file_path=filename,
            kb_id=body.kb_id,
            user_id=None,
        )
        return {
            "file_id": ingest_result.get("file_id"),
            "kb_id": body.kb_id,
            "filename": filename,
            "status": ingest_result.get("status", "completed"),
            "processing_id": ingest_result.get("processing_id"),
            "message": "从 URL 导入成功",
            "details": {
                "chunks_processed": ingest_result.get("chunks_processed"),
                "vectors_stored": ingest_result.get("vectors_stored"),
                "caption": ingest_result.get("caption"),
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("import_from_url failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def import_from_search(body: ImportSearchBody):
    """按关键词从选定渠道搜索图片并导入知识库（每个文件依次调用 ingestion）。"""
    allowed_sources = ("google_images", "pixabay", "internet_archive")
    if body.source not in allowed_sources:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的渠道: {body.source}，可选: {list(allowed_sources)}",
        )
    try:
        downloader = MediaDownloaderSource()
        # 阻塞的搜索+下载放到线程中执行
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: downloader.fetch_image_search(
                body.query,
                body.source,
                body.quantity,
                pixabay_image_type=body.pixabay_image_type or "photo",
                pixabay_order=body.pixabay_order or "popular",
                archive_sort=body.archive_sort or "relevance",
                randomize=body.randomize if body.randomize is not None else True,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("import_from_search fetch failed")
        raise HTTPException(status_code=500, detail=str(e))

    if not results:
        return {
            "kb_id": body.kb_id,
            "total": 0,
            "success_count": 0,
            "failed_count": 0,
            "results": [],
            "message": "未获取到任何可导入的图片，请检查关键词与渠道或 API 配置（SERPAPI_KEY / PIXABAY_API_KEY）。",
        }

    success_count = 0
    failed_count = 0
    out_results = []
    for r in results:
        try:
            ingest_result = await ingestion_service.process_file_upload(
                file_content=r.content,
                file_path=r.suggested_filename,
                kb_id=body.kb_id,
                user_id=None,
            )
            success_count += 1
            out_results.append({
                "file_id": ingest_result.get("file_id"),
                "filename": r.suggested_filename,
                "status": ingest_result.get("status", "completed"),
                "processing_id": ingest_result.get("processing_id"),
            })
        except Exception as e:
            failed_count += 1
            logger.warning(f"导入单文件失败 {r.suggested_filename}: {e}")
            out_results.append({"filename": r.suggested_filename, "status": "failed", "error": str(e)})

    return {
        "kb_id": body.kb_id,
        "total": len(results),
        "success_count": success_count,
        "failed_count": failed_count,
        "results": out_results,
        "message": f"搜索导入完成：成功 {success_count}，失败 {failed_count}。",
    }


@router.post("/folder")
async def import_from_folder(body: ImportFolderBody):
    """从指定本地文件夹遍历文件并导入知识库（路径须在配置的白名单内）。"""
    try:
        resolved_path = _validate_folder_path_allowed(body.folder_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        folder_source = FolderSource()
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: folder_source.fetch_folder(
                str(resolved_path),
                recursive=body.recursive,
                extensions=body.extensions,
                exclude_patterns=body.exclude_patterns,
                max_files=body.max_files,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (OSError, PermissionError) as e:
        logger.warning("import_from_folder fetch_folder failed: {}", e)
        raise HTTPException(status_code=403, detail=f"无法访问该目录: {e}")
    except Exception as e:
        logger.exception("import_from_folder fetch_folder failed")
        raise HTTPException(status_code=500, detail=str(e))

    if not results:
        return {
            "kb_id": body.kb_id,
            "total": 0,
            "success_count": 0,
            "failed_count": 0,
            "results": [],
            "message": "该文件夹下没有符合条件的文件。",
        }

    # 构建 path -> bytes，供 Markdown 解析相对路径图片（如 ![](./images/fig.png)）
    asset_map = {r.suggested_filename: r.content for r in results}
    success_count = 0
    failed_count = 0
    out_results = []
    for r in results:
        try:
            ingest_result = await ingestion_service.process_file_upload(
                file_content=r.content,
                file_path=r.suggested_filename,
                kb_id=body.kb_id,
                user_id=None,
                asset_map=asset_map,
            )
            success_count += 1
            out_results.append({
                "file_id": ingest_result.get("file_id"),
                "filename": r.suggested_filename,
                "status": ingest_result.get("status", "completed"),
                "processing_id": ingest_result.get("processing_id"),
            })
        except Exception as e:
            failed_count += 1
            logger.warning("导入单文件失败 {}: {}", r.suggested_filename, e)
            out_results.append({"filename": r.suggested_filename, "status": "failed", "error": str(e)})

    return {
        "kb_id": body.kb_id,
        "total": len(results),
        "success_count": success_count,
        "failed_count": failed_count,
        "results": out_results,
        "message": f"文件夹导入完成：成功 {success_count}，失败 {failed_count}。",
    }


@router.get("/folder/stream")
async def import_from_folder_stream(
    folder_path: str,
    kb_id: str,
    recursive: bool = True,
    extensions: Optional[str] = None,
    exclude_patterns: Optional[str] = None,
    max_files: int = 500,
):
    """从指定本地文件夹导入知识库，通过 SSE 推送进度（scanning -> importing -> done）。"""
    try:
        resolved_path = _validate_folder_path_allowed(folder_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    progress_queue: Queue = Queue()
    results_container: list = []

    def run_scan() -> None:
        try:
            folder_source = FolderSource()
            res = folder_source.fetch_folder(
                str(resolved_path),
                recursive=recursive,
                extensions=[x.strip() for x in extensions.split(",") if x.strip()] if extensions else None,
                exclude_patterns=[x.strip() for x in exclude_patterns.split(",") if x.strip()] if exclude_patterns else None,
                max_files=min(2000, max(1, max_files)),
            )
            results_container.append(res)
            progress_queue.put({"stage": "scan_complete", "total": len(res)})
        except Exception as e:
            progress_queue.put({"stage": "error", "message": str(e)})

    async def event_stream():
        yield f"data: {json.dumps({'stage': 'scanning', 'message': '正在扫描文件夹…'})}\n\n"
        loop = asyncio.get_event_loop()
        thread = threading.Thread(target=run_scan)
        thread.start()
        event = None
        while True:
            try:
                event = await loop.run_in_executor(None, lambda: progress_queue.get(timeout=0.3))
            except Empty:
                if not thread.is_alive():
                    break
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("stage") in ("scan_complete", "error"):
                break
        thread.join()

        if event is None or event.get("stage") == "error":
            return
        results = results_container[0] if results_container else []
        if not results:
            yield f"data: {json.dumps({'stage': 'done', 'success_count': 0, 'failed_count': 0, 'total': 0, 'message': '该文件夹下没有符合条件的文件'})}\n\n"
            return
        asset_map = {r.suggested_filename: r.content for r in results}
        success_count = 0
        failed_count = 0
        for i, r in enumerate(results):
            yield f"data: {json.dumps({'stage': 'importing', 'current': i + 1, 'total': len(results), 'message': r.suggested_filename})}\n\n"
            try:
                await ingestion_service.process_file_upload(
                    file_content=r.content,
                    file_path=r.suggested_filename,
                    kb_id=kb_id,
                    user_id=None,
                    asset_map=asset_map,
                )
                success_count += 1
            except Exception as e:
                failed_count += 1
                logger.warning("import_from_folder_stream single file failed: {}", e)
        yield f"data: {json.dumps({'stage': 'done', 'success_count': success_count, 'failed_count': failed_count, 'total': len(results), 'message': f'成功 {success_count}，失败 {failed_count}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/search/stream")
async def import_from_search_stream(
    kb_id: str,
    query: str,
    source: str,
    quantity: int = 5,
    pixabay_image_type: Optional[str] = "photo",
    pixabay_order: Optional[str] = "popular",
    archive_sort: Optional[str] = "relevance",
    randomize: bool = True,
):
    """按关键词搜索图片并导入知识库，通过 SSE 推送进度（searching -> downloading -> importing -> done）。"""
    allowed_sources = ("google_images", "pixabay", "internet_archive")
    if source not in allowed_sources:
        raise HTTPException(status_code=400, detail=f"不支持的渠道: {source}")

    progress_queue: Queue = Queue()
    results_container: list = []

    def run_search() -> None:
        def cb(stage: str, cur: int, total: int, msg: str) -> None:
            progress_queue.put({"stage": stage, "current": cur, "total": total, "message": msg})

        downloader = MediaDownloaderSource()
        try:
            res = downloader.fetch_image_search(
                query,
                source,
                min(20, max(1, quantity)),
                pixabay_image_type=pixabay_image_type or "photo",
                pixabay_order=pixabay_order or "popular",
                archive_sort=archive_sort or "relevance",
                randomize=randomize,
                progress_callback=cb,
            )
            results_container.append(res)
            progress_queue.put({"stage": "search_complete"})
        except Exception as e:
            progress_queue.put({"stage": "error", "message": str(e)})

    async def event_stream():
        loop = asyncio.get_event_loop()
        thread = threading.Thread(target=run_search)
        thread.start()
        event = None
        while True:
            try:
                event = await loop.run_in_executor(None, lambda: progress_queue.get(timeout=0.3))
            except Empty:
                if not thread.is_alive():
                    break
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("stage") in ("search_complete", "error"):
                break
        thread.join()

        if event is None or event.get("stage") == "error":
            return
        results = results_container[0] if results_container else []
        success_count = 0
        failed_count = 0
        for i, r in enumerate(results):
            yield f"data: {json.dumps({'stage': 'importing', 'current': i + 1, 'total': len(results), 'message': r.suggested_filename})}\n\n"
            try:
                await ingestion_service.process_file_upload(
                    file_content=r.content,
                    file_path=r.suggested_filename,
                    kb_id=kb_id,
                    user_id=None,
                )
                success_count += 1
            except Exception as e:
                failed_count += 1
                logger.warning("import_from_search_stream single file failed: {}", e)
        yield f"data: {json.dumps({'stage': 'done', 'success_count': success_count, 'failed_count': failed_count, 'total': len(results), 'message': f'成功 {success_count}，失败 {failed_count}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
