"""
Multi-Modal RAG Agent 主应用入口
FastAPI 应用配置文件
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import uvicorn
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 创建 FastAPI 应用实例
app = FastAPI(
    title="Multi-Modal RAG Agent API",
    description="基于多模态智能路由的可扩展知识库RAG系统",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
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
from app.api import chat, knowledge, upload, debug
from app.core.logger import setup_logger

# 设置日志
logger = setup_logger()

# 注册路由
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(debug.router, prefix="/api/debug", tags=["debug"])

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