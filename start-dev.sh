#!/bin/bash

# Multi-Modal RAG Agent 启动脚本
# 用于本地开发环境

set -e

echo "🚀 启动 Multi-Modal RAG Agent 开发环境..."

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
echo ""
echo "按 Ctrl+C 停止服务..."

# 等待中断信号
wait