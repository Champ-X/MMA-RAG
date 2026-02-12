#!/bin/bash

# Multi-Modal RAG Agent 本地启动脚本（无 Docker）
# 依赖：本机已安装 Redis、MinIO、Qdrant（脚本会尝试自动启动未运行的服务）

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 启动 Multi-Modal RAG Agent（无 Docker）..."

# 确保 backend 能读到 .env（从项目根复制一份到 backend 若不存在）
if [ -f .env ] && [ ! -f backend/.env ]; then
    cp .env backend/.env
    echo "📋 已从项目根复制 .env 到 backend/"
fi

# 从 .env 读取 MinIO 账号（与后端一致），默认 minioadmin
minio_user="minioadmin"
minio_pass="minioadmin"
if [ -f backend/.env ]; then
    while IFS='=' read -r key value; do
        case "$key" in MINIO_ACCESS_KEY) minio_user="${value%%#*}" ;; MINIO_SECRET_KEY) minio_pass="${value%%#*}" ;; esac
    done < <(grep -E '^MINIO_ACCESS_KEY=|^MINIO_SECRET_KEY=' backend/.env 2>/dev/null || true)
fi
# 去除引号与空格
minio_user=$(echo "$minio_user" | tr -d '"' | tr -d "'" | xargs)
minio_pass=$(echo "$minio_pass" | tr -d '"' | tr -d "'" | xargs)

check_redis() {
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping 2>/dev/null | grep -q PONG; then
            echo "  ✅ Redis (localhost:6379)"
            return 0
        fi
    fi
    echo "  ❌ Redis 未运行"
    return 1
}

check_minio() {
    if curl -s --connect-timeout 2 http://localhost:9000/minio/health/live &>/dev/null || curl -s --connect-timeout 2 http://localhost:9001 &>/dev/null; then
        echo "  ✅ MinIO (localhost:9000 / 9001)"
        return 0
    fi
    echo "  ❌ MinIO 未运行"
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

# 尝试自动启动 Redis（macOS Homebrew）
start_redis_if_needed() {
    check_redis && return 0
    if command -v brew &>/dev/null; then
        echo "  ⏳ 尝试启动 Redis: brew services start redis ..."
        brew services start redis 2>/dev/null || true
        for i in 1 2 3 4 5; do sleep 1; check_redis && return 0; done
    fi
    return 1
}

# 尝试自动启动 MinIO
start_minio_if_needed() {
    check_minio && return 0
    if ! command -v minio &>/dev/null; then
        echo "  ❌ 未找到 minio 命令。请安装: brew install minio/stable/minio"
        return 1
    fi
    mkdir -p "$PROJECT_ROOT/minio_data"
    echo "  ⏳ 正在后台启动 MinIO ..."
    (
        cd "$PROJECT_ROOT"
        export MINIO_ROOT_USER="$minio_user"
        export MINIO_ROOT_PASSWORD="$minio_pass"
        nohup minio server ./minio_data --console-address ":9001" > minio.log 2>&1 &
        echo $! > minio.pid
    )
    for i in 1 2 3 4 5 6 7 8; do
        sleep 1
        if check_minio; then
            echo "  ✅ MinIO 已自动启动 (PID: $(cat "$PROJECT_ROOT/minio.pid" 2>/dev/null))"
            return 0
        fi
    done
    echo "  ❌ MinIO 启动超时，请查看 $PROJECT_ROOT/minio.log"
    return 1
}

# 尝试自动启动 Qdrant（仅当未使用 Qdrant Cloud 时）
start_qdrant_if_needed() {
    check_qdrant && return 0
    QDRANT_BIN=""
    if [ -n "$QDRANT_BIN" ]; then
        [ "${QDRANT_BIN#/}" = "$QDRANT_BIN" ] && QDRANT_BIN="$(cd "$PROJECT_ROOT" && command -v "$QDRANT_BIN")" || true
    elif command -v qdrant &>/dev/null; then
        QDRANT_BIN="$(command -v qdrant)"
    elif [ -x "$HOME/qdrant" ]; then
        QDRANT_BIN="$HOME/qdrant"
    elif [ -x "/Users/xiangqingping.1/qdrant" ]; then
        QDRANT_BIN="/Users/xiangqingping.1/qdrant"
    fi
    if [ -z "$QDRANT_BIN" ] || [ ! -x "$QDRANT_BIN" ]; then
        echo "  ⚠️  未找到 qdrant 可执行文件。若使用 Qdrant Cloud 可忽略；否则请从 https://github.com/qdrant/qdrant/releases 下载并设置 PATH 或 QDRANT_BIN"
        return 0
    fi
    QDRANT_CONFIG="$PROJECT_ROOT/qdrant_config.yaml"
    if [ ! -f "$QDRANT_CONFIG" ]; then
        echo "  ⚠️  未找到配置文件 $QDRANT_CONFIG，跳过自动启动 Qdrant"
        return 0
    fi
    echo "  ⏳ 正在后台启动 Qdrant ($QDRANT_BIN) ..."
    (
        cd "$PROJECT_ROOT"
        nohup "$QDRANT_BIN" --config-path "$QDRANT_CONFIG" > qdrant.log 2>&1 &
        echo $! > qdrant.pid
    )
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 1
        if curl -s --connect-timeout 2 http://localhost:6333 &>/dev/null; then
            echo "  ✅ Qdrant 已自动启动 (PID: $(cat "$PROJECT_ROOT/qdrant.pid" 2>/dev/null))"
            return 0
        fi
    done
    echo "  ❌ Qdrant 启动超时或未就绪。请查看日志: $PROJECT_ROOT/qdrant.log"
    if [ -f "$PROJECT_ROOT/qdrant.log" ]; then
        echo "  📄 最后几行日志:"
        tail -5 "$PROJECT_ROOT/qdrant.log" | sed 's/^/     /'
    fi
    return 0
}

# 先尝试自动启动依赖，再检查
echo "🔍 检查并自动启动依赖服务..."
start_redis_if_needed || true
start_minio_if_needed || true
start_qdrant_if_needed || true

echo ""
echo "🔍 最终依赖检查..."
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
