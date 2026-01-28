# 重启服务或重新加载环境变量指南

## 📋 方法概览

根据你的运行方式，选择对应的重启方法：

---

## 🐳 方法 1: Docker Compose 部署（生产环境）

### 重启所有服务
```bash
# 停止所有服务
docker-compose down

# 重新启动所有服务（会重新加载 .env 文件）
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 仅重启后端服务（推荐，更快）
```bash
# 重启后端容器（会重新加载环境变量）
docker-compose restart backend

# 如果还有 Celery Worker，也需要重启
docker-compose restart celery_worker
```

### 查看日志确认重启成功
```bash
# 查看后端日志
docker-compose logs -f backend

# 查看所有服务日志
docker-compose logs -f
```

---

## 🛠️ 方法 2: 开发模式（使用 start-dev.sh）

### 如果后端服务正在运行

#### 方式 A: 手动停止并重启
```bash
# 1. 找到并停止后端进程
ps aux | grep uvicorn | grep -v grep
# 找到进程ID (PID)，然后：
kill <PID>

# 2. 重新启动后端服务
cd backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 方式 B: 使用 Ctrl+C 停止后重启
```bash
# 1. 在运行 start-dev.sh 的终端按 Ctrl+C 停止所有服务

# 2. 重新运行启动脚本
./start-dev.sh
```

### 如果后端服务未运行
```bash
# 直接启动后端服务（会自动加载 .env 文件）
cd backend
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🔄 方法 3: 仅重新加载环境变量（不重启服务）

**注意**：Python 应用在启动时加载环境变量，修改 `.env` 后**必须重启服务**才能生效。

### 为什么需要重启？
- Python 的 `load_dotenv()` 和 Pydantic Settings 只在应用启动时读取 `.env` 文件
- 运行中的进程不会自动检测 `.env` 文件的变化
- 即使使用 `--reload`，uvicorn 也只会在代码文件变化时重载，不会重载环境变量

### 验证环境变量是否生效
```bash
# 方法 1: 查看日志中的模型配置
# 重启后，查看日志应该显示：
# "使用主模型: Pro/deepseek-ai/DeepSeek-R1 (任务类型: final_generation)"

# 方法 2: 调用 API 测试
curl http://localhost:8000/api/debug/config  # 如果这个端点存在
```

---

## ✅ 快速检查清单

1. ✅ 已修改 `.env` 文件中的 `DEFAULT_CHAT_MODEL=Pro/deepseek-ai/DeepSeek-R1`
2. ✅ 已重启后端服务（Docker 容器或 uvicorn 进程）
3. ✅ 检查日志确认主模型已更新
4. ✅ 测试 API 调用确认使用正确的模型

---

## 🐛 常见问题

### Q: 修改了 .env 但模型还是旧的？
**A**: 必须重启服务！环境变量只在启动时加载。

### Q: Docker 容器重启后还是旧配置？
**A**: 检查 `.env` 文件路径是否正确，Docker Compose 会从项目根目录读取 `.env`。

### Q: 如何确认环境变量已生效？
**A**: 
- 查看应用启动日志
- 检查 LLM Manager 的日志输出（应该显示 "使用主模型: Pro/deepseek-ai/DeepSeek-R1"）
- 调用 API 并观察日志中的模型调用记录

---

## 📝 当前配置状态

根据你的 `.env` 文件：
- `DEFAULT_CHAT_MODEL=Pro/deepseek-ai/DeepSeek-R1` ✅

重启后，系统应该：
1. 首先尝试调用 `Pro/deepseek-ai/DeepSeek-R1`
2. 如果失败，按顺序尝试 fallback 模型
3. 日志会清晰显示主模型调用和故障转移过程
