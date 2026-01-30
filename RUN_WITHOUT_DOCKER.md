# 无 Docker 本地运行指南

当 Docker 不可用时，可通过本机安装依赖服务并直接运行后端与前端。

## 一、依赖服务（需先安装并启动）

项目依赖三个服务，均需在本机运行并监听对应端口：

| 服务   | 端口        | 用途           |
|--------|-------------|----------------|
| Redis  | 6379        | 缓存 / Celery |
| MinIO  | 9000, 9001  | 对象存储       |
| Qdrant | 6333, 6334  | 向量数据库     |

### 1. Redis（macOS 推荐用 Homebrew）

```bash
# 安装
brew install redis

# 启动（二选一）
brew services start redis   # 后台常驻
# 或
redis-server                # 前台运行，关终端即停
```

验证：`redis-cli ping` 应返回 `PONG`。

### 2. MinIO

```bash
# 安装
brew install minio/stable/minio

# 若已有 minio_data（例如之前用 Docker 起过），可跳过下面这行；没有则执行一次
mkdir -p ./minio_data

# 启动（在项目根目录执行；账号需与 .env 一致，若沿用 Docker 的 admin/admin123456 则原有桶可直接访问）
export MINIO_ROOT_USER=admin
export MINIO_ROOT_PASSWORD=admin123456
minio server ./minio_data --console-address ":9001"
```

- API：<http://localhost:9000>
- 控制台：<http://localhost:9001>（admin / admin123456）

保持该终端不关，或改用 `nohup`/launchd 后台运行。

### 3. Qdrant

macOS 无 Homebrew 公式，需用官方二进制或 Qdrant Cloud。

**方式 A：本机二进制（推荐）**

1. 打开 [Qdrant Releases](https://github.com/qdrant/qdrant/releases/latest)
2. 按架构下载（保存位置任意，如下载目录即可）：
   - Apple Silicon：`qdrant-aarch64-apple-darwin.tar.gz`
   - Intel：`qdrant-x86_64-apple-darwin.tar.gz`
3. 解压并运行。**新版 Qdrant 已取消 `--storage-path`**，需用配置文件或环境变量指定数据目录。项目内已提供 `qdrant_config.yaml`，将数据目录设为 `./qdrant_storage`。

   - **在项目根目录运行**（推荐）：
   ```bash
   cd /path/to/MMAA-agent
   mkdir -p ./qdrant_storage   # 若已有可跳过
   /path/to/qdrant --config-path ./qdrant_config.yaml
   ```
   - 或使用环境变量（二进制可在任意目录）：
   ```bash
   QDRANT__STORAGE__STORAGE_PATH=/path/to/MMAA-agent/qdrant_storage /path/to/qdrant
   ```

   **macOS 安全提示**：首次运行若出现「无法验证开发者」或进程被 kill，需放行未公证的二进制：
   - **推荐**：在 Finder 中右键 `qdrant` → 选择「打开」→ 弹窗里点「打开」，之后再在终端运行即可。
   - 或去掉隔离属性：`xattr -d com.apple.quarantine /path/to/qdrant`（把路径换成你的 qdrant 实际路径）。

   **控制台 /dashboard**：项目已包含 Qdrant Web UI 的构建产物（`static/` 目录）。请**在项目根目录**启动 Qdrant（例如 `qdrant --config-path ./qdrant_config.yaml`），然后访问 http://localhost:6333/dashboard 即可使用控制台。若之前未生成过 `static/`，可执行：`git clone --depth 1 https://github.com/qdrant/qdrant-web-ui.git _build_ui && cd _build_ui && npm install && npm run build-qdrant && mkdir -p ../static && cp -R dist/* ../static/ && cd .. && rm -rf _build_ui`（在项目根执行）。

**方式 B：Qdrant Cloud**

若使用云端实例，在项目根目录 `.env` 中修改：

- `QDRANT_HOST`：云实例 host（不含 `http://`）
- `QDRANT_PORT`：一般为 `6333`
- `QDRANT_API_KEY`：云控制台提供的 API Key

本机不再需要运行 Qdrant 进程。

---

## 二、环境与配置

1. **Python 3.9+** 与 **Node.js 18+** 已安装。
2. 项目根目录已有 `.env`（可从 `.env.example` 复制并填好 API Key）。
3. 无 Docker 时，`.env` 中应使用本机地址（通常已默认）：

```env
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=admin123456
QDRANT_HOST=localhost
QDRANT_PORT=6333
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

---

## 三、启动项目（无 Docker）

### 方式 1：使用脚本（推荐）

先确保 Redis、MinIO、Qdrant 均已启动，再执行：

```bash
chmod +x start-dev-no-docker.sh
./start-dev-no-docker.sh
```

脚本会检查上述三个服务是否可达，然后启动后端与前端。

### 方式 2：手动启动

**终端 1：后端**

```bash
cd backend
pip install -r requirements.txt   # 首次或依赖变更时
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**终端 2：前端**

```bash
cd frontend
npm install   # 首次或依赖变更时
npm run dev
```

**终端 3（可选）：Celery Worker**

需要异步任务（如知识库画像）时再开：

```bash
cd backend
celery -A celery_app worker -Q knowledge,ingestion,retrieval,celery --loglevel=info
```

---

## 四、访问地址

| 服务       | 地址                      |
|------------|---------------------------|
| 前端       | http://localhost:5173     |
| 后端 API   | http://localhost:8000     |
| API 文档   | http://localhost:8000/docs |
| MinIO 控制台 | http://localhost:9001   |
| Qdrant 控制台 | http://localhost:6333/dashboard |

---

## 五、常见问题

**Q: 后端报错连不上 MinIO / Qdrant / Redis？**  
A: 先确认三个服务已启动，且 `.env` 里为 `localhost` 与正确端口；用 `curl` 或浏览器访问对应端口看是否可连通。

**Q: 不想本机装 Qdrant？**  
A: 使用 [Qdrant Cloud](https://qdrant.cloud/) 创建实例，在 `.env` 中填 `QDRANT_HOST`、`QDRANT_PORT`、`QDRANT_API_KEY`，无需本地 Qdrant 进程。

**Q: Celery 不启动会怎样？**  
A: 聊天、检索、上传等核心功能可正常使用；依赖 Celery 的异步任务（如知识库画像更新）会不可用或延迟，按需再开 Worker。
