"""
知识库导入 API：从 URL 或多渠道搜索下载后写入知识库。
与 /api/upload 并列：upload=本地上传，import=从网络/搜索拉取并导入。
"""

import asyncio
import json
import threading
from queue import Empty, Queue
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, HttpUrl

from app.core.logger import get_logger
from app.modules.ingestion.service import IngestionService
from app.modules.ingestion.sources import UrlSource, MediaDownloaderSource

router = APIRouter()
logger = get_logger(__name__)

ingestion_service = IngestionService()


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


# ---------- 端点 ----------


@router.post("/url")
async def import_from_url(body: ImportUrlBody):
    """从单个 URL 下载文件并导入知识库。"""
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
                logger.warning("import_from_search_stream single file failed: %s", e)
        yield f"data: {json.dumps({'stage': 'done', 'success_count': success_count, 'failed_count': failed_count, 'total': len(results), 'message': f'成功 {success_count}，失败 {failed_count}'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
