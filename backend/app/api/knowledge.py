"""
知识库管理API路由
处理知识库的CRUD操作
"""

import asyncio
from pathlib import Path
from urllib.parse import quote, unquote
import os
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from typing import List, Dict, Any, Optional
from app.core.logger import get_logger
from app.core.keyword_extract import extract_keywords_for_portrait
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.portraits import PortraitGenerator

router = APIRouter()
logger = get_logger(__name__)

# 服务实例
kb_service = KnowledgeBaseService()
portrait_generator = PortraitGenerator()


def _stats_for_frontend(statistics: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """将后端 statistics 格式转换为前端 stats 格式（含向量维度、音频数、视频数、CLAP 维度）"""
    if not statistics:
        return {
            "documents": 0,
            "chunks": 0,
            "images": 0,
            "audio": 0,
            "video": 0,
            "text_vector_dim": 4096,
            "image_vector_dim": 768,
            "audio_vector_dim": 512,
        }
    return {
        "documents": statistics.get("total_documents", 0),
        "chunks": statistics.get("total_chunks", 0),
        "images": statistics.get("total_images", 0),
        "audio": statistics.get("total_audio", 0),
        "video": statistics.get("total_video", 0),
        "text_vector_dim": statistics.get("text_vector_dim", 4096),
        "image_vector_dim": statistics.get("image_vector_dim", 768),
        "audio_vector_dim": statistics.get("audio_vector_dim", 512),
    }


@router.get("/")
async def list_knowledge_bases(user_id: Optional[str] = None):
    """获取知识库列表；若有图片则随机取一张作为 cover_url，若无图片但有视频关键帧则随机取一张关键帧作为封面。"""
    try:
        kbs = await kb_service.list_knowledge_bases(user_id=user_id)
        # 并行获取每个知识库的随机封面图
        cover_urls = await asyncio.gather(
            *[kb_service.get_random_cover_url(kb["id"]) for kb in kbs]
        )
        return {
            "knowledge_bases": [
                {
                    "id": kb["id"],
                    "name": kb.get("name") or kb["id"],
                    "description": kb.get("description", ""),
                    "created_at": kb["created_at"],
                    "updated_at": kb["updated_at"],
                    "stats": _stats_for_frontend(kb.get("statistics")),
                    "cover_url": cover_urls[i] if i < len(cover_urls) else None,
                }
                for i, kb in enumerate(kbs)
            ]
        }
    except Exception as e:
        logger.error(f"获取知识库列表失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def create_knowledge_base(data: Dict[str, Any]):
    """创建新的知识库"""
    try:
        name = data.get("name", "").strip()
        description = data.get("description", "").strip()
        tags = data.get("tags")
        if not name:
            raise HTTPException(status_code=400, detail="name 不能为空")
        metadata = {"tags": tags} if tags else None
        result = await kb_service.create_knowledge_base(
            name=name, description=description, metadata=metadata
        )
        stats = _stats_for_frontend({})
        return {
            "id": result["id"],
            "name": result["name"],
            "description": result.get("description", ""),
            "created_at": result["created_at"],
            "updated_at": result["updated_at"],
            "stats": stats,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建知识库失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/stats")
async def get_knowledge_base_stats(kb_id: str):
    """获取知识库在向量库中的统计信息（供前端展示数据源比例、主题统计）"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        stats = await kb_service._get_kb_statistics(kb_id)
        return _stats_for_frontend(stats)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取知识库统计失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}")
async def get_knowledge_base(kb_id: str):
    """获取特定知识库详情"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        return {
            "id": kb["id"],
            "name": kb["name"],
            "description": kb.get("description", ""),
            "created_at": kb["created_at"],
            "updated_at": kb["updated_at"],
            "stats": _stats_for_frontend(kb.get("statistics")),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取知识库详情失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/files")
async def list_kb_files(kb_id: str):
    """获取知识库下的文件列表"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        files = await kb_service.list_kb_files(kb_id)
        return {"files": files}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取文件列表失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/files/{file_id:path}/preview-asset")
async def get_file_preview_asset(
    kb_id: str,
    file_id: str,
    path: str = Query(..., description="URL 编码后的图片路径（md 中的本地绝对路径）"),
):
    """为 Markdown 预览提供本地路径图片：当 path 位于配置白名单内时返回图片字节，便于前端显示 md 内 ![](/path) 图片。"""
    try:
        from app.core.config import settings
        raw_path = unquote(path.strip())
        if not raw_path or (not raw_path.startswith("/") and not raw_path.lower().startswith("file://")):
            raise HTTPException(status_code=400, detail="path 须为绝对路径或 file://")
        if raw_path.lower().startswith("file://"):
            raw_path = unquote(raw_path[7:].lstrip("/"))
            if raw_path and not raw_path.startswith("/"):
                raw_path = os.path.abspath("/" + raw_path) if os.name != "nt" else raw_path
        allowed = getattr(settings, "markdown_local_image_allowed_base_paths", None) or []
        if not allowed:
            raise HTTPException(status_code=403, detail="未配置 Markdown 本地图片白名单")
        p = Path(raw_path).resolve()
        if not p.is_file():
            raise HTTPException(status_code=404, detail="文件不存在")
        real_str = str(p)
        allowed_flag = False
        for base in allowed:
            base_p = Path(base).resolve()
            base_str = str(base_p)
            if real_str == base_str or real_str.startswith(base_str + os.sep):
                allowed_flag = True
                break
        if not allowed_flag:
            raise HTTPException(status_code=403, detail="路径不在白名单内")
        content = p.read_bytes()
        ext = p.suffix.lower()
        media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}.get(ext.lstrip("."), "application/octet-stream")
        return Response(content=content, media_type=media)
    except HTTPException:
        raise
    except Exception as e:
        logger.debug("preview-asset 失败: {}", e)
        raise HTTPException(status_code=500, detail="读取图片失败")


@router.get("/{kb_id}/files/{file_id:path}/content")
async def get_file_content(kb_id: str, file_id: str):
    """获取文本类文件（md/txt）的原始内容，用于预览（避免 iframe 触发下载）"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        content = await kb_service.get_file_text_content(kb_id, file_id)
        if content is None:
            raise HTTPException(status_code=404, detail="文件不存在或无法读取")
        return {"content": content}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取文件内容失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/files/{file_id:path}/preview")
async def get_file_preview(kb_id: str, file_id: str):
    """获取文件预览详情：图片描述、文档分块、文本预览"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        details = await kb_service.get_file_preview_details(kb_id, file_id)
        return details
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取文件预览失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/files/{file_id:path}/stream")
async def stream_file_for_preview(kb_id: str, file_id: str):
    """流式返回文件内容，用于页面内预览。PDF 直接返回；PPTX/DOCX 转为 PDF 后返回以便像 PDF 一样在页内阅读。"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")
        info = await kb_service.get_file_stream_info(kb_id, file_id)
        if not info:
            raise HTTPException(status_code=404, detail="文件不存在")
        bucket_name, object_path, filename = info
        content = await kb_service.minio_adapter.get_file_content(bucket_name, object_path)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        # PPTX/DOCX：转为 PDF 后返回，前端用 PDF 预览组件即可直接阅读
        if ext in ("pptx", "docx"):
            try:
                from app.modules.ingestion.parsers.mineru_client import office_to_pdf_bytes
                pdf_bytes = office_to_pdf_bytes(content, ext)
            except Exception as e:
                logger.debug("Office 转 PDF 失败: {}", e)
                pdf_bytes = None
            if pdf_bytes:
                preview_filename = filename.rsplit(".", 1)[0] + ".pdf"
                try:
                    preview_filename.encode("ascii")
                    content_disp = f'inline; filename="{preview_filename}"'
                except UnicodeEncodeError:
                    content_disp = f"inline; filename*=UTF-8''{quote(preview_filename, safe='')}"
                return Response(
                    content=pdf_bytes,
                    media_type="application/pdf",
                    headers={"Content-Disposition": content_disp},
                )
            raise HTTPException(
                status_code=503,
                detail="PPTX/DOCX 页面内预览需要服务器安装 LibreOffice，当前不可用；请使用下方「分块」查看解析文本。",
            )
        if ext == "pdf":
            media_type = "application/pdf"
        else:
            # 常见音视频格式，便于前端 <audio>/<video> 正确解析
            media_type = {
                "mp3": "audio/mpeg",
                "wav": "audio/wav",
                "m4a": "audio/mp4",
                "aac": "audio/aac",
                "ogg": "audio/ogg",
                "flac": "audio/flac",
                "opus": "audio/opus",
                "wma": "audio/x-ms-wma",
                "mp4": "video/mp4",
                "webm": "video/webm",
                "ogv": "video/ogg",
            }.get(ext, "application/octet-stream")
        try:
            filename.encode("ascii")
            content_disp = f'inline; filename="{filename}"'
        except UnicodeEncodeError:
            content_disp = f"inline; filename*=UTF-8''{quote(filename, safe='')}"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": content_disp},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"流式预览失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{kb_id}/files/{file_id:path}")
async def delete_kb_file(kb_id: str, file_id: str):
    """删除知识库下的单个文件"""
    try:
        success = await kb_service.delete_kb_file(kb_id, file_id)
        if not success:
            raise HTTPException(status_code=404, detail="文件不存在")
        return {"message": "文件已删除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除文件失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{kb_id}/portrait")
async def get_knowledge_base_portrait(kb_id: str):
    """获取知识库画像（主题聚类），兼容多种 kb_id 格式"""
    try:
        portraits = await kb_service.get_kb_portraits_with_fallback(kb_id)
        clusters = []
        for i, p in enumerate(portraits):
            payload = p.get("payload", {}) if isinstance(p.get("payload"), dict) else {}
            topic_summary = payload.get("topic_summary", "")
            clusters.append({
                "cluster_id": str(payload.get("cluster_id", p.get("id", i))),
                "topic_summary": topic_summary,
                "cluster_size": payload.get("cluster_size", 0),
                "keywords": extract_keywords_for_portrait(topic_summary, top_k=10),
            })
        return {"clusters": clusters}
    except Exception as e:
        logger.error(f"获取知识库画像失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{kb_id}/portrait/regenerate")
async def regenerate_knowledge_base_portrait(
    kb_id: str,
    sync: bool = Query(False, description="为 true 时在 API 进程内同步执行，保证使用最新代码（含视频关键帧）；否则优先走 Celery 异步"),
):
    """触发知识库画像生成/更新。sync=true 时在 API 内同步执行（推荐手动触发时使用）；否则若 Celery 可用则异步执行。"""
    try:
        kb = await kb_service.get_knowledge_base(kb_id)
        if not kb:
            raise HTTPException(status_code=404, detail="知识库不存在")

        # 优先使用向量库中的实际 kb_id（兼容 JSON 与向量库 kb_id 不一致）
        effective_kb_id = kb_id
        try:
            discovered = await kb_service._discover_kb_id_from_bucket_async(kb_id)
            if discovered:
                effective_kb_id = discovered
                logger.debug(f"画像生成使用 discovered kb_id: {discovered}")
        except Exception as _:
            pass

        # sync=True 时强制在 API 进程内同步执行，确保使用当前代码（含视频关键帧统计）
        if not sync:
            try:
                from app.modules.knowledge.portraits import build_kb_portrait_task
                build_kb_portrait_task.delay(effective_kb_id, True)
                return {
                    "status": "triggered",
                    "message": "画像生成已启动，请稍后刷新页面查看。首次生成可能需要 1–2 分钟。",
                }
            except Exception as _:
                pass

        result = await portrait_generator.update_kb_portrait(effective_kb_id, force_update=True)
        if result.get("status") == "insufficient_data":
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "知识库数据量不足，至少需要约 10 条文本/图片/音频/视频关键帧才能生成画像"),
            )
        return {
            "status": "success",
            "message": "画像生成完成",
            "clusters": result.get("clusters", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成知识库画像失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{kb_id}")
async def update_knowledge_base(kb_id: str, data: Dict[str, Any]):
    """更新知识库"""
    try:
        result = await kb_service.update_knowledge_base(
            kb_id=kb_id,
            name=data.get("name"),
            description=data.get("description"),
            metadata=data.get("tags") and {"tags": data["tags"]},
        )
        if not result:
            raise HTTPException(status_code=404, detail="知识库不存在")
        kb_updated = await kb_service.get_knowledge_base(kb_id)
        stats = _stats_for_frontend(kb_updated.get("statistics") if kb_updated else None)
        return {
            "id": result["id"],
            "name": result["name"],
            "description": result.get("description", ""),
            "updated_at": result["updated_at"],
            "stats": stats,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新知识库失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{kb_id}")
async def delete_knowledge_base(kb_id: str):
    """删除知识库"""
    try:
        success = await kb_service.delete_knowledge_base(kb_id)
        if not success:
            raise HTTPException(status_code=404, detail="知识库不存在")
        return {"message": f"知识库 {kb_id} 已删除"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除知识库失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))