#!/bin/bash

# Multi-Modal RAG Agent 本地启动脚本（无 Docker）
# 依赖：本机已安装并启动 Redis、MinIO、Qdrant

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 启动 Multi-Modal RAG Agent（无 Docker）..."

# 确保 backend 能读到 .env（从项目根复制一份到 backend 若不存在）
if [ -f .env ] && [ ! -f backend/.env ]; then
    cp .env backend/.env
    echo "📋 已从项目根复制 .env 到 backend/"
fi

# 检查本机依赖服务是否可达
echo "🔍 检查依赖服务..."

check_redis() {
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping 2>/dev/null | grep -q PONG; then
            echo "  ✅ Redis (localhost:6379)"
            return 0
        fi
    fi
    echo "  ❌ Redis 未运行。请先执行: brew services start redis 或 redis-server"
    return 1
}

check_minio() {
    if curl -s --connect-timeout 2 http://localhost:9000/minio/health/live &>/dev/null || curl -s --connect-timeout 2 http://localhost:9001 &>/dev/null; then
        echo "  ✅ MinIO (localhost:9000 / 9001)"
        return 0
    fi
    echo "  ❌ MinIO 未运行。请参考 RUN_WITHOUT_DOCKER.md 启动 MinIO"
    return 1
}

check_qdrant() {
    if curl -s --connect-timeout 2 http://localhost:6333 &>/dev/null; then
        echo "  ✅ Qdrant (localhost:6333)"
        return 0
    fi
    echo "  ⚠️  Qdrant 未在 localhost:6333 运行（若使用 Qdrant Cloud 可忽略）"
    return 0
}

REDIS_OK=0
MINIO_OK=0
check_redis || REDIS_OK=1
check_minio || MINIO_OK=1
check_qdrant

if [ "$REDIS_OK" -ne 0 ] || [ "$MINIO_OK" -ne 0 ]; then
    echo ""
    echo "请先按 RUN_WITHOUT_DOCKER.md 安装并启动上述服务后再运行本脚本。"
    exit 1
fi

# 启动后端
echo ""
echo "🐍 启动后端..."
cd "$PROJECT_ROOT/backend"
if command -v python3 &> /dev/null; then
    python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!
else
    echo "❌ 未找到 python3"
    exit 1
fi

# 启动 Celery Worker（画像构建、文档解析等异步任务）
echo "📦 启动 Celery Worker..."
cd "$PROJECT_ROOT/backend"
CELERY_CMD=""
if command -v celery &> /dev/null; then
    CELERY_CMD="celery"
elif python3 -c "import celery" 2>/dev/null; then
    CELERY_CMD="python3 -m celery"
fi
if [ -n "$CELERY_CMD" ]; then
    $CELERY_CMD -A celery_app worker -Q knowledge,ingestion,retrieval -l info &
    CELERY_PID=$!
    echo "  ✅ Celery Worker 已启动 (PID: $CELERY_PID)"
else
    echo "  ⚠️  未找到 celery，画像异步构建将不会执行。安装: pip install celery"
    CELERY_PID=""
fi

# 启动前端
echo "⚛️  启动前端..."
cd "$PROJECT_ROOT/frontend"
if command -v npm &> /dev/null; then
    npm run dev &
    FRONTEND_PID=$!
else
    echo "❌ 未找到 npm"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🎉 开发环境已启动（无 Docker）"
echo ""
echo "📋 服务地址:"
echo "  - 前端:     http://localhost:5173"
echo "  - 后端 API: http://localhost:8000"
echo "  - API 文档: http://localhost:8000/docs"
echo ""
echo "💡 按 Ctrl+C 停止所有服务"
echo ""

# 捕获 Ctrl+C，清理子进程
cleanup() {
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    [ -n "$CELERY_PID" ] && kill $CELERY_PID 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM
wait
