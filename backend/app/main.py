"""
Multi-Modal RAG Agent 主应用入口
FastAPI 应用配置文件
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import uvicorn
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


class _SuppressProgressPollAccessLog(logging.Filter):
    """过滤 uvicorn 对 /api/upload/progress 的访问日志，避免前端轮询产生大量重复 200 OK 日志。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            msg = getattr(record, "msg", "") or ""
        if "/upload/progress" in msg or "/api/upload/progress" in msg:
            return False
        return True


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    from app.core.config import settings
    from app.core.model_preload import preload_local_inference_models_sync
    from app.integrations import feishu_state
    from app.integrations.feishu_ws import start_feishu_ws_thread

    if settings.preload_local_models_on_startup:
        # 模型加载为同步阻塞 + 可能长时间下载，放到线程池避免卡住事件循环
        await asyncio.to_thread(preload_local_inference_models_sync)

    feishu_state.main_loop = asyncio.get_running_loop()
    start_feishu_ws_thread()
    yield


# 创建 FastAPI 应用实例
app = FastAPI(
    title="Multi-Modal RAG Agent API",
    description="基于多模态智能路由的可扩展知识库RAG系统",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=_app_lifespan,
)

# 配置 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境中应该设置为具体的域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 导入路由模块
from app.api import chat, knowledge, upload, debug, import_api, feishu
from app.core.logger import setup_logger

# 设置日志
logger = setup_logger()

# 抑制进度轮询的访问日志（前端每 1.5s 轮询一次，LLM 整理阶段会持续数十秒，产生大量重复 200 OK）
logging.getLogger("uvicorn.access").addFilter(_SuppressProgressPollAccessLog())

# 注册路由
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(debug.router, prefix="/api/debug", tags=["debug"])
app.include_router(import_api.router, prefix="/api/import", tags=["import"])
app.include_router(feishu.router, prefix="/api/feishu", tags=["feishu"])

# 全局异常处理
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"全局异常处理: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "内部服务器错误", "error": str(exc)}
    )

# 健康检查端点
@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "healthy",
        "service": "Multi-Modal RAG Agent",
        "version": "1.0.0"
    }

# 根路径
@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "Multi-Modal RAG Agent API",
        "docs": "/docs",
        "health": "/health"
    }

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", 8000)),
        reload=os.getenv("API_DEBUG", "false").lower() == "true",
        log_level="info"
    )