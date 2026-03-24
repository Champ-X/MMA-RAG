#!/bin/bash

# Multi-Modal RAG Agent 启动脚本
# 用于本地开发环境

set -e

# 检测 ffmpeg（视频切段、音频抽取等）与 LibreOffice（docx/pptx 转 PDF）；缺失时尝试自动安装
ensure_ffmpeg_and_libreoffice() {
    local need_ffmpeg=1 need_lo=1
    command -v ffmpeg &>/dev/null && need_ffmpeg=0
    if command -v libreoffice &>/dev/null || command -v soffice &>/dev/null; then
        need_lo=0
    fi

    if (( need_ffmpeg == 0 && need_lo == 0 )); then
        echo "✅ 已检测到 ffmpeg 与 LibreOffice（libreoffice/soffice）"
        return 0
    fi

    echo "📦 缺少本地依赖："
    (( need_ffmpeg )) && echo "   - ffmpeg（视频/音频处理）"
    (( need_lo )) && echo "   - LibreOffice（docx/pptx 转 PDF 等）"
    echo "   尝试自动安装…"

    local pkgs=()
    (( need_ffmpeg )) && pkgs+=(ffmpeg)
    (( need_lo )) && pkgs+=(libreoffice)

    set +e
    # Debian / Ubuntu / WSL
    if command -v apt-get &>/dev/null && ((${#pkgs[@]})); then
        export DEBIAN_FRONTEND=noninteractive
        if sudo -n true 2>/dev/null || sudo -v; then
            if sudo apt-get update -qq && sudo apt-get install -y "${pkgs[@]}"; then
                echo "✅ 已通过 apt 安装: ${pkgs[*]}"
                set -e
                return 0
            fi
        fi
    fi

    # macOS Homebrew
    if command -v brew &>/dev/null; then
        if (( need_ffmpeg )) && ! command -v ffmpeg &>/dev/null; then
            brew install ffmpeg
        fi
        if (( need_lo )) && ! command -v libreoffice &>/dev/null && ! command -v soffice &>/dev/null; then
            brew install --cask libreoffice
        fi
        if command -v ffmpeg &>/dev/null && ( command -v libreoffice &>/dev/null || command -v soffice &>/dev/null ); then
            echo "✅ 已通过 Homebrew 安装所需组件"
            set -e
            return 0
        fi
    fi

    # Fedora / RHEL 系
    if command -v dnf &>/dev/null && ((${#pkgs[@]})); then
        if sudo -n true 2>/dev/null || sudo -v; then
            if sudo dnf install -y "${pkgs[@]}"; then
                echo "✅ 已通过 dnf 安装: ${pkgs[*]}"
                set -e
                return 0
            fi
        fi
    fi

    set -e
    echo "⚠️  未能自动安装（无匹配包管理器、sudo 不可用或网络失败）。请手动安装："
    echo "   Ubuntu/Debian/WSL: sudo apt-get update && sudo apt-get install -y ffmpeg libreoffice"
    echo "   macOS: brew install ffmpeg && brew install --cask libreoffice"
    echo "   Fedora: sudo dnf install -y ffmpeg libreoffice"
    echo "   Arch:   sudo pacman -S --needed ffmpeg libreoffice-fresh"
    return 0
}

echo "🚀 启动 Multi-Modal RAG Agent 开发环境..."

ensure_ffmpeg_and_libreoffice

# 检查Docker是否运行
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装或未运行"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker 服务未运行"
    exit 1
fi

# 检查Docker Compose是否可用
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

# 启动数据库和存储服务
echo "📦 启动基础服务 (MinIO, Qdrant, Redis)..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d minio qdrant redis
else
    docker compose up -d minio qdrant redis
fi

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
echo "🔍 检查服务状态..."

# 检查 MinIO
if curl -s http://localhost:9001 > /dev/null; then
    echo "✅ MinIO 运行在 http://localhost:9001"
else
    echo "❌ MinIO 启动失败"
fi

# 检查 Qdrant
if curl -s http://localhost:6333 > /dev/null; then
    echo "✅ Qdrant 运行在 http://localhost:6333"
else
    echo "❌ Qdrant 启动失败"
fi

# 检查 Redis
if redis-cli ping | grep -q PONG; then
    echo "✅ Redis 运行在 localhost:6379"
else
    echo "❌ Redis 启动失败"
fi

# 启动后端服务
echo "🐍 启动后端服务..."
if command -v ss &> /dev/null && ss -tln 2>/dev/null | grep -qE ':8000\s'; then
    echo "❌ 端口 8000 已被占用（常见原因：上次 uvicorn 未退出）。请先结束占用进程后再运行本脚本。"
    echo "   排查: ss -tlnp | grep 8000"
    echo "   结束: pkill -f 'uvicorn app.main:app' 或 kill <PID>"
    exit 1
fi
cd backend
if command -v python3 &> /dev/null; then
    python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
else
    echo "❌ Python3 未安装"
    exit 1
fi

# 启动前端服务
echo "⚛️  启动前端服务..."
cd ../frontend
if command -v npm &> /dev/null; then
    # 典型报错：sh: 1: vite: not found
    # 原因通常是前端依赖未安装（node_modules 不存在或未包含 vite）
    if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
        echo "📦 检测到前端依赖未安装，正在执行 npm install ..."
        npm install
    fi
    npm run dev &
else
    echo "❌ npm 未安装"
    exit 1
fi

echo "🎉 开发环境启动完成!"
echo ""
echo "📋 服务地址:"
echo "  - 前端界面: http://localhost:3000"
echo "  - 后端API:  http://localhost:8000"
echo "  - API文档:  http://localhost:8000/docs"
echo "  - MinIO控制台: http://localhost:9001 (minioadmin/minioadmin)"
echo "  - Qdrant控制台: http://localhost:6333/dashboard"
echo ""
echo "💡 提示:"
echo "  - 使用 Ctrl+C 停止所有服务"
echo "  - 日志输出在前台，按 Ctrl+C 可查看实时日志"
echo "  - 首次部署预载 BGE-M3/CLIP/CLAP：在 backend/.env 设置 PRELOAD_LOCAL_MODELS_ON_STARTUP=true"
echo ""
echo "按 Ctrl+C 停止服务..."

# 等待中断信号
wait