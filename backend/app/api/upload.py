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
        allowed_types = [
            # 文档类型
            "pdf", "docx", "doc", "pptx", "txt", "md",
            # 表格类型
            "xlsx", "xls", "csv",
            # 图片类型
            "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif",
            # 音频类型
            "mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "opus",
            # 视频类型
            "mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v"
        ]
        if file_type not in allowed_types:
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
        allowed_types = [
            # 文档类型
            "pdf", "docx", "doc", "pptx", "txt", "md",
            # 表格类型
            "xlsx", "xls", "csv",
            # 图片类型
            "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif",
            # 音频类型
            "mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "opus",
            # 视频类型
            "mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v"
        ]
        if file_type not in allowed_types:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")
        source_type = _validate_source_type(source_type)
        file_content = await file.read()
        if len(file_content) == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")
        filename = file.filename or f"uploaded_file.{file_type}"
        processing_id = str(uuid.uuid4())
        logger.info("开始流式上传处理: {}, processing_id={}", filename, processing_id)

        async def stream_gen():
            task = asyncio.create_task(
                _ingestion().process_file_upload(
                    file_content=file_content,
                    file_path=filename,
                    kb_id=kb_id,
                    user_id=None,
                    processing_id=processing_id,
                    source_type=source_type,
                )
            )
            yield json.dumps({"processing_id": processing_id}) + "\n"
            while True:
                await asyncio.sleep(0.25)
                status = await _ingestion().get_processing_status(processing_id)
                if status is None:
                    break
                yield json.dumps(status) + "\n"
                if status.get("status") in ("completed", "failed"):
                    break
            try:
                await task
            except Exception as e:
                logger.exception("流式上传后台任务异常")
                yield json.dumps({"status": "failed", "error": str(e)}) + "\n"
                return
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