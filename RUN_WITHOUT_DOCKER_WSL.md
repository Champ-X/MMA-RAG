## 适用于 WSL (Ubuntu) 的无 Docker 运行指南

当你在 **WSL（Ubuntu）环境** 下开发，且 **不使用 Docker** 时，可以在 WSL 内直接安装依赖服务并运行本项目的后端与前端。

---

## 一、依赖服务（需先在 WSL 内安装并启动）

项目依赖三个服务，均需在 **WSL Ubuntu 内** 运行并监听对应端口：

| 服务     | 端口         | 用途            |
| ------ | ---------- | ------------- |
| Redis  | 6379       | 缓存 / Celery  |
| MinIO  | 9000, 9001 | 对象存储          |
| Qdrant | 6333, 6334 | 向量数据库         |

> **注意**：  
> - 所有命令默认在 **WSL 终端（Ubuntu）** 中执行。  
> - 浏览器访问可以在 Windows 侧使用 `http://localhost:xxxx` 直接访问 WSL 服务（默认网络互通）。

---

### 1. 在 WSL 中安装与启动 Redis

#### 安装 Redis

```bash
sudo apt update
sudo apt install -y redis-server
```

#### 启动与开机自启

```bash
# 启动 redis
sudo systemctl start redis-server

# 设置为开机自启（可选）
sudo systemctl enable redis-server
```

#### 验证

```bash
redis-cli ping
# 若返回 PONG 即正常
```

---

### 2. 在 WSL 中安装与启动 MinIO

> WSL 无法直接用 `brew`，推荐在 WSL 中使用官方二进制。

#### 下载与安装 MinIO Server

在 WSL 中执行（以 Linux AMD64 为例，若是 ARM 请替换架构）：

```bash
# 在 WSL 的某个目录（例如 /usr/local/bin）安装 minio
cd /usr/local/bin

# 下载 Linux 版本 minio（x86_64）
sudo wget https://dl.min.io/server/minio/release/linux-amd64/minio -O minio
sudo chmod +x minio
```

#### 创建数据目录

在你的项目根目录（`/home/champ/MMAA-RAG`）下：

```bash
cd /home/champ/MMAA-RAG
mkdir -p ./minio_data
```

#### 启动 MinIO（账号需与 `.env` 一致）

```bash
cd /home/champ/MMAA-RAG

export MINIO_ROOT_USER=admin
export MINIO_ROOT_PASSWORD=admin123456

# 在当前终端前台运行
minio server ./minio_data --console-address ":9001"
```

- API：`http://localhost:9000`
- 控制台：`http://localhost:9001`（默认 `admin / admin123456`）

> **提示**：  
> - 在 WSL 终端保持此进程不关，或用 `tmux` / `screen` / `nohup` 等方式后台运行。  
> - Windows 上打开浏览器访问上述地址即可（`localhost` 会自动映射到 WSL）。

---

### 3. 在 WSL 中安装与启动 Qdrant

WSL 下推荐使用 **Linux 官方二进制**。

#### 下载 Qdrant 二进制

在 WSL 中执行（以 x86_64 为例）：

```bash
cd /usr/local/bin

# 打开最新版本发布页面，找到 linux-x86_64 对应链接
# 下面示例使用通用写法，请根据实际最新版本替换 URL 中的版本号
sudo wget https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-gnu.tar.gz -O qdrant.tar.gz

sudo mkdir -p /opt/qdrant
sudo tar -xzf qdrant.tar.gz -C /opt/qdrant
sudo ln -sf /opt/qdrant/qdrant /usr/local/bin/qdrant

rm qdrant.tar.gz
```

> 你也可以手动从 Qdrant Releases 页面复制最新的 Linux 下载链接再执行 `wget`。

#### 使用项目内配置文件启动 Qdrant

项目内已提供 `qdrant_config.yaml`，数据目录会设为 `./qdrant_storage`。

在 **项目根目录** 启动（推荐）：

```bash
cd /home/champ/MMAA-RAG

# 确保存在数据目录（若不存在会按配置自动创建）
qdrant --config-path ./qdrant_config.yaml
```

保持该终端不关闭，即可通过：

- Qdrant API：`http://localhost:6333`
- 控制台 / dashboard：`http://localhost:6333/dashboard`

> 若发现 `static/` 目录不存在或访问 `/dashboard` 报错，可按 `RUN_WITHOUT_DOCKER.md` 中的命令在项目根重新构建 Qdrant Web UI。

---

### 4. 使用 Qdrant Cloud（可选）

若不想在 WSL 本机安装 Qdrant，可使用云端实例：

在项目根 `.env` 中修改：

- `QDRANT_HOST`：云实例 host（不含 `http://`）
- `QDRANT_PORT`：一般为 `6333`
- `QDRANT_API_KEY`：云控制台提供的 API Key

这样本机无需再启动 Qdrant 进程。

---

## 二、环境与配置（WSL 特别说明）

1. **Python 3.9+ 与 Node.js 18+** 需安装在 **WSL Ubuntu 内**（不是仅 Windows 安装）。  
   - Python：`sudo apt install python3 python3-venv python3-pip`  
   - Node.js：推荐使用 `nvm` 安装 Node 18+。
2. **LibreOffice（建议安装）**：用于 `pptx/docx` 页内预览（后端会将 Office 文件转换为 PDF）。

```bash
sudo apt-get update
sudo apt-get install -y libreoffice
```
3. **FFmpeg（建议安装）**：用于视频切段与音频提取（视频模态处理依赖）。

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

4. 项目根目录已有 `.env`（请直接编辑并填好 API Key）：

```bash
cd /home/champ/MMAA-RAG
# 若缺失可手动创建 .env，并保证关键配置与 backend/.env 一致
```

5. 无 Docker 且服务运行在 WSL 本机时，`.env` 中应使用本机地址（通常已默认）：

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

> **注意**：  
> - WSL 内访问使用 `localhost` 即可。  
> - Windows 浏览器访问 WSL 服务，同样使用 `http://localhost:端口`。

---

## 三、启动项目（WSL 无 Docker）

### 方式 1：使用脚本（推荐）

在 WSL 内先确认 Redis、MinIO、Qdrant 均已启动，再执行：

```bash
cd /home/champ/MMAA-RAG

chmod +x start-dev-no-docker.sh
./start-dev-no-docker.sh
```

脚本会检查上述三个服务是否可达，然后在 WSL 内启动后端、Celery Worker 和前端。  
知识库画像异步构建依赖 Celery，脚本会自动启动 Worker。

> 前端启动在 `localhost:3000`（对 WSL 和 Windows 都是同一个地址）。

---

### 方式 2：手动启动

#### 终端 1：后端（在 WSL）

```bash
cd /home/champ/MMAA-RAG/backend

# 推荐使用虚拟环境（可选）
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt   # 首次或依赖变更时

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 终端 2：前端（在 WSL）

```bash
cd /home/champ/MMAA-RAG/frontend

npm install   # 首次或依赖变更时
npm run dev   # 默认 3000 端口
```

#### 终端 3（可选）：Celery Worker（在 WSL）

若使用 `start-dev-no-docker.sh`，Celery 会随脚本自动启动。若手动启动各服务，需要异步任务（如知识库画像）时再开：

```bash
cd /home/champ/MMAA-RAG/backend
source .venv/bin/activate   # 若使用了虚拟环境

celery -A celery_app worker -Q knowledge,ingestion,retrieval,celery --loglevel=info
```

---

## 四、访问地址（在 Windows 或 WSL 浏览器中）

| 服务         | 地址                                                                 |
| ---------- | ------------------------------------------------------------------ |
| 前端         | `http://localhost:3000`                                           |
| 后端 API     | `http://localhost:8000`                                           |
| API 文档     | `http://localhost:8000/docs`                                     |
| MinIO 控制台  | `http://localhost:9001`                                           |
| Qdrant 控制台 | `http://localhost:6333/dashboard`                                |

> 无论在 Windows 还是 WSL 内开启浏览器，使用 `http://localhost:端口` 即可访问这些服务。

---

## 五、WSL 常见问题

- **Q: 在 Windows 浏览器访问不了 WSL 里的服务？**  
  **A:**  
  - 确认服务在 WSL 内监听的是 `0.0.0.0` 或 `localhost`，且端口和 `.env` 一致。  
  - 默认 WSL 与 Windows 之间 `localhost:端口` 是互通的，如仍无法访问，可检查防火墙或端口冲突。

- **Q: 后端报错连不上 MinIO / Qdrant / Redis？**  
  **A:**  
  - 在 WSL 内用 `curl` 或 `redis-cli` 等工具测试：  
    - `curl http://localhost:9000`  
    - `curl http://localhost:6333`  
    - `redis-cli ping`  
  - 确认 `.env` 中为 `localhost` 与正确端口，且服务进程正在 WSL 内运行。

- **Q: 不想在 WSL 内安装 Qdrant？**  
  **A:** 使用 Qdrant Cloud，在 `.env` 中填 `QDRANT_HOST`、`QDRANT_PORT`、`QDRANT_API_KEY`，本机不再需要 Qdrant 进程。

- **Q: Celery 不启动会怎样？**  
  **A:** 聊天、检索、上传等核心功能可正常使用；依赖 Celery 的异步任务（如知识库画像更新）会不可用或延迟，按需再开 Worker。

- **Q: PPTX/DOCX 在预览弹窗中显示异常或无法按页预览？**  
  **A:** 这是 Office 转 PDF 依赖缺失导致。请在 WSL 安装 LibreOffice：  
  `sudo apt-get update && sudo apt-get install -y libreoffice`  
  安装后重启后端服务，再打开文件预览。若仍失败，可先使用「分块」查看解析文本。

- **Q: 视频上传后解析失败，日志提示 `ffmpeg 未找到`？**  
  **A:** 请在 WSL 安装 FFmpeg：  
  `sudo apt-get update && sudo apt-get install -y ffmpeg`  
  若已安装但仍报错，在 `.env` 或 `backend/.env` 中显式设置：  
  `FFMPEG_PATH=/usr/bin/ffmpeg`（以实际路径为准），然后重启后端。

