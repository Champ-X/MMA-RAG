"""
知识库管理API路由
处理知识库的CRUD操作
"""

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from app.core.logger import get_logger
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.portraits import PortraitGenerator

router = APIRouter()
logger = get_logger(__name__)

# 服务实例
kb_service = KnowledgeBaseService()
portrait_generator = PortraitGenerator()


def _stats_for_frontend(statistics: Optional[Dict[str, Any]]) -> Dict[str, int]:
    """将后端 statistics 格式转换为前端 stats 格式"""
    if not statistics:
        return {"documents": 0, "chunks": 0, "images": 0}
    return {
        "documents": statistics.get("total_documents", 0),
        "chunks": statistics.get("total_chunks", 0),
        "images": statistics.get("total_images", 0),
    }


@router.get("/")
async def list_knowledge_bases(user_id: Optional[str] = None):
    """获取知识库列表"""
    try:
        kbs = await kb_service.list_knowledge_bases(user_id=user_id)
        return {
            "knowledge_bases": [
                {
                    "id": kb["id"],
                    "name": kb.get("name") or kb["id"],
                    "description": kb.get("description", ""),
                    "created_at": kb["created_at"],
                    "updated_at": kb["updated_at"],
                    "stats": _stats_for_frontend(kb.get("statistics")),
                }
                for kb in kbs
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


@router.get("/{kb_id}/files/{file_id}/content")
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


@router.get("/{kb_id}/files/{file_id}/preview")
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


@router.delete("/{kb_id}/files/{file_id}")
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
            clusters.append({
                "cluster_id": str(payload.get("cluster_id", p.get("id", i))),
                "topic_summary": payload.get("topic_summary", ""),
                "cluster_size": payload.get("cluster_size", 0),
            })
        return {"clusters": clusters}
    except Exception as e:
        logger.error(f"获取知识库画像失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{kb_id}/portrait/regenerate")
async def regenerate_knowledge_base_portrait(kb_id: str):
    """触发知识库画像生成/更新。若 Celery 可用则异步执行，否则同步执行（可能较慢）。"""
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
                detail=result.get("message", "知识库数据量不足，至少需要约 10 条文本/图片才能生成画像"),
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