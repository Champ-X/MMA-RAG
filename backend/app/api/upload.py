"""
文件上传API路由
处理文档和图片的上传
"""

import asyncio
import json
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from typing import List, Optional
import uuid
from app.core.logger import get_logger
from app.modules.ingestion.service import get_ingestion_service

router = APIRouter()
logger = get_logger(__name__)

ALLOWED_FILE_TYPES = {
    # 文档类型
    "pdf", "docx", "doc", "pptx", "txt", "md",
    # 表格类型
    "xlsx", "xls", "csv",
    # 图片类型
    "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif",
    # 音频类型
    "mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "opus",
    # 视频类型
    "mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v",
}


def _ingestion():
    return get_ingestion_service()


def _validate_source_type(source_type: Optional[str]) -> Optional[str]:
    if source_type is None:
        return None
    normalized = source_type.strip()
    if not normalized:
        return None
    allowed_source_types = {"manual_input"}
    if normalized not in allowed_source_types:
        raise HTTPException(status_code=400, detail=f"不支持的 source_type: {normalized}")
    return normalized

@router.post("/file")
async def upload_file(
    kb_id: str = Form(...),
    file: UploadFile = File(...),
    file_type: str = Form(...),
    source_type: Optional[str] = Form(None),
):
    """上传单个文件"""
    try:
        # 验证文件类型（与 config.allowed_extensions_str 保持一致）
        if file_type not in ALLOWED_FILE_TYPES:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")
        source_type = _validate_source_type(source_type)
        
        # 读取文件内容
        file_content = await file.read()
        file_size = len(file_content)
        
        if file_size == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")
        
        # 获取文件名
        filename = file.filename or f"uploaded_file.{file_type}"
        
        logger.info(f"开始处理文件上传: {filename}, 大小: {file_size} bytes, kb_id: {kb_id}")
        
        # 调用 IngestionService 处理文件上传
        # 该方法会自动完成：
        # 1. 解析文件内容
        # 2. 保存到MinIO
        # 3. 生成向量
        # 4. 存储到Qdrant
        result = await _ingestion().process_file_upload(
            file_content=file_content,
            file_path=filename,
            kb_id=kb_id,
            user_id=None,  # 如果需要用户ID，可以从请求中获取
            source_type=source_type,
        )
        
        logger.info(f"文件处理完成: {filename}, file_id: {result.get('file_id')}, status: {result.get('status')}")
        
        return {
            "file_id": result.get("file_id"),
            "kb_id": kb_id,
            "filename": filename,
            "file_type": result.get("file_type", file_type),
            "size": file_size,
            "status": result.get("status", "completed"),
            "processing_id": result.get("processing_id"),
            "message": "文件上传并处理成功",
            "details": {
                "chunks_processed": result.get("chunks_processed"),
                "vectors_stored": result.get("vectors_stored"),
                "caption": result.get("caption")  # 如果是图片，会包含描述
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e).strip() or repr(e) or type(e).__name__
        logger.error(
            "文件上传失败: %s (type=%s, filename=%s)",
            err_msg,
            type(e).__name__,
            getattr(file, "filename", ""),
        )
        logger.exception("上传异常堆栈")
        raise HTTPException(status_code=500, detail=err_msg or "文件上传处理失败，请查看服务端日志")


@router.post("/file/stream")
async def upload_file_stream(
    kb_id: str = Form(...),
    file: UploadFile = File(...),
    file_type: str = Form(...),
    source_type: Optional[str] = Form(None),
):
    """上传单个文件，响应为流式：先返回 processing_id，再持续推送 stage/progress/message，最后返回 result。"""
    try:
        if file_type not in ALLOWED_FILE_TYPES:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")
        source_type = _validate_source_type(source_type)
        file_content = await file.read()
        if len(file_content) == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")
        filename = file.filename or f"uploaded_file.{file_type}"
        processing_id = str(uuid.uuid4())
        logger.info("开始流式上传处理: {}, processing_id={}", filename, processing_id)

        # 任务由 IngestionService 持有，而不是绑定在 StreamingResponse 的协程上。
        # 用户刷新页面会断开流，但已接收的文件仍继续处理，状态可通过 Redis 恢复。
        _ingestion().start_file_upload(
            file_content=file_content,
            file_path=filename,
            kb_id=kb_id,
            user_id=None,
            processing_id=processing_id,
            source_type=source_type,
        )

        async def stream_gen():
            yield json.dumps({"processing_id": processing_id}) + "\n"
            while True:
                await asyncio.sleep(0.25)
                status = await _ingestion().get_processing_status(processing_id)
                if status is None:
                    break
                yield json.dumps(status) + "\n"
                if status.get("status") in ("completed", "failed"):
                    break
            final = await _ingestion().get_processing_status(processing_id)
            if final and final.get("result") is not None:
                yield json.dumps({"result": final["result"]}) + "\n"

        return StreamingResponse(
            stream_gen(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("upload_file_stream failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch/start", status_code=202)
async def start_upload_batch(
    kb_id: str = Form(...),
    files: List[UploadFile] = File(...),
    source_type: Optional[str] = Form(None),
):
    """一次接收全部文件并立即创建独立后台任务。

    与旧 `/batch` 的“文件 1 完成全链路后才处理文件 2”不同，本接口在请求成功后
    为每个文件登记持久化 processing_id。页面刷新不会丢掉尚未开始 MLLM 解析的
    其他视频；视频实际解析由服务端受控队列消费。
    """
    source_type = _validate_source_type(source_type)
    if not files:
        raise HTTPException(status_code=400, detail="至少需要一个文件")

    # 严格两阶段提交：在第一个后台任务可被调度前，先读取、校验并持久化登记
    # 所有有效文件。不能在循环内调用 start_file_upload；下一次 `await file.read()`
    # 会让已创建的第一个任务获得运行机会，进而可能被同步 MinIO I/O 阻塞。
    ingestion = _ingestion()
    results = []
    prepared_uploads = []
    for file in files:
        filename = file.filename or "uploaded_file"
        try:
            file_content = await file.read()
            file_size = len(file_content)
            if file_size == 0:
                raise ValueError("文件内容为空")
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if ext not in ALLOWED_FILE_TYPES:
                raise ValueError(f"不支持的文件类型: {ext or '未知'}")

            prepared = ingestion.prepare_file_upload(
                file_content=file_content,
                file_path=filename,
                kb_id=kb_id,
            )
            result_item = {
                "filename": filename,
                "size": file_size,
                "file_type": ext,
                "processing_id": prepared["processing_id"],
                "status": "queued",
            }
            results.append(result_item)
            prepared_uploads.append({
                "file_content": file_content,
                "file_path": filename,
                "processing_id": prepared["processing_id"],
                "result_item": result_item,
            })
        except Exception as e:
            logger.error("批量异步上传提交失败 filename={}: {}", filename, e)
            results.append({
                "filename": filename,
                "status": "failed",
                "error": str(e),
            })

    # 此时每个有效文件均已进入可恢复的队列；下面的 create_task 调用本身不让出
    # 事件循环，故直到全部任务都已建立，任何视频解析都不会开始。
    for prepared_upload in prepared_uploads:
        try:
            ingestion.launch_prepared_file_upload(
                file_content=prepared_upload["file_content"],
                file_path=prepared_upload["file_path"],
                kb_id=kb_id,
                processing_id=prepared_upload["processing_id"],
                user_id=None,
                source_type=source_type,
            )
        except Exception as e:
            logger.error(
                "批量异步上传任务启动失败 filename={}: {}",
                prepared_upload["file_path"],
                e,
            )
            prepared_upload["result_item"].update({
                "status": "failed",
                "error": str(e),
            })

    accepted_count = sum(1 for result in results if result.get("status") == "queued")
    return {
        "kb_id": kb_id,
        "total_files": len(files),
        "accepted_count": accepted_count,
        "failed_count": len(results) - accepted_count,
        "results": results,
        "message": "文件已提交到服务端处理队列，可安全刷新页面查看状态。",
    }


@router.post("/batch")
async def upload_batch(
    kb_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """批量上传文件"""
    results = []
    
    for file in files:
        try:
            # 读取文件内容
            file_content = await file.read()
            file_size = len(file_content)
            
            if file_size == 0:
                results.append({
                    "filename": file.filename,
                    "status": "failed",
                    "error": "文件内容为空"
                })
                continue
            
            filename = file.filename or "uploaded_file"
            
            logger.info(f"批量上传处理文件: {filename}, 大小: {file_size} bytes")
            
            # 调用 IngestionService 处理文件上传
            result = await _ingestion().process_file_upload(
                file_content=file_content,
                file_path=filename,
                kb_id=kb_id,
                user_id=None
            )
            
            results.append({
                "file_id": result.get("file_id"),
                "filename": filename,
                "status": result.get("status", "completed"),
                "processing_id": result.get("processing_id"),
                "size": file_size,
                "details": {
                    "chunks_processed": result.get("chunks_processed"),
                    "vectors_stored": result.get("vectors_stored")
                }
            })
            
        except Exception as e:
            logger.error(f"批量上传文件处理失败: {file.filename if file.filename else 'unknown'}, 错误: {str(e)}")
            results.append({
                "filename": file.filename if file.filename else "unknown",
                "status": "failed",
                "error": str(e)
            })
    
    return {
        "kb_id": kb_id,
        "total_files": len(files),
        "success_count": sum(1 for r in results if r.get("status") == "completed"),
        "failed_count": sum(1 for r in results if r.get("status") == "failed"),
        "results": results
    }

@router.get("/progress/{task_id}")
async def get_upload_progress(task_id: str):
    """获取上传处理进度（对接 ingestion 的 processing_status）"""
    status = await _ingestion().get_processing_status(task_id)
    if status.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="未找到该任务或任务已过期")
    return status


@router.post("/retry/{task_id}", status_code=202)
async def retry_upload_video(task_id: str):
    """从 MinIO 中保存的原视频重新入队 Scene–Shot 解析。

    仅适用于已经落盘、但因模型格式错误、服务重启或其他可恢复异常而失败的视频。
    不重新接收浏览器文件，因此不会产生新的 file_id 或重复原视频对象。
    """
    try:
        return _ingestion().retry_video_processing(task_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        logger.exception("重新入队视频失败 task_id={}", task_id)
        raise HTTPException(status_code=500, detail=str(error)) from error
