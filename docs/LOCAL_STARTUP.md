# 本地一键启动

在仓库任意工作区使用根目录 `start-dev.sh`；脚本会自行定位仓库，调用路径也可为绝对路径。`scripts/start-restored.sh` 是同一控制器的恢复入口，额外要求已有存储数据。

```bash
./start-dev.sh                       # 前台启动，Ctrl+C 停止前后端
./start-dev.sh --reload              # 后端自动重载，前端始终支持 HMR
./start-dev.sh start --background    # 后台启动，关闭终端后继续运行
./start-dev.sh restart --background  # 停止本入口管理的实例，再启动前后端
./start-dev.sh status                # 进程身份、API 健康和前端 /api 代理
./start-dev.sh logs                  # 三份日志各最后 30 行
./start-dev.sh stop                  # 停止前后端及其子进程，存储容器保持运行
./start-dev.sh doctor                # 只检查依赖和 Docker 可达性
```

`status` 全部正常时返回 0，否则返回 1；启动失败和端口冲突返回非零。后台启动会等待完整就绪后才返回成功。重复 `start` 会验证并复用已管理的健康实例；改变端口或重载选项需执行 `restart`。

## 环境与选项

| 项目 | 默认值 / 行为 |
| --- | --- |
| 后端 Python | `MMA_PYTHON` → 仓库 `.venv/bin/python` → 系统 Python；启动要求 3.11 / 3.12 且已安装 `backend/requirements.txt` |
| Node.js | ≥22.19；检查 Vite 和 Pi SDK 依赖，缺失时执行对应目录的 `npm ci` |
| 后端配置 | 必须有 `backend/.env`，不输出该文件内容，不覆盖已有配置 |
| 前端端口 | `--port` → `FRONTEND_PORT` → 3001；严格绑定，不顺延 |
| API 端口 | 固定 8000，与现有 Vite `/api` 代理一致 |
| 应用就绪等待 | `--timeout` → `MMA_START_TIMEOUT` → 每个服务 300 秒；首次模型加载可延长 |
| Docker context | `MMA_DOCKER_CONTEXT` → 已有 `colima-mma-rag` → 当前 context；只接受本地 Unix socket |
| Colima | 选中 `colima-mma-rag` 且 daemon 不可用时执行 `colima start --profile mma-rag --activate=false` |
| FFmpeg / LibreOffice | 检测并提示缺失，不在每次启动时自动安装系统软件 |

```bash
MMA_PYTHON=/path/to/venv/bin/python ./start-dev.sh restart --background
FRONTEND_PORT=3010 MMA_START_TIMEOUT=600 ./start-dev.sh restart --background
./scripts/start-restored.sh restart --background --port 3001
```

新环境需先创建虚拟环境、安装后端依赖并填写配置，见 README。媒体工具可在 macOS 使用 `brew install ffmpeg` 和 `brew install --cask libreoffice`；Ubuntu/Debian 使用 `sudo apt-get install ffmpeg libreoffice fonts-noto-cjk`。

## 数据与进程管理

- 优先复用 `mmrag_minio` / `mmrag_qdrant` / `mmrag_redis`，启动前确认 MinIO/Qdrant 的本地持久化挂载存在，输出实际路径。不会用当前工作区的空目录替换其他工作区的数据挂载。
- 三个容器都不存在时，普通入口才使用当前仓库目录创建存储服务；恢复入口要求对应 `minio_data` 和 `qdrant_storage/collections` 已存在。只存在部分容器时明确报错，保留已有数据供排查。
- Docker 命令使用同一指定 context，不修改用户的全局 context，也不继承 `DOCKER_HOST` / `COMPOSE_FILE` 等可能冲突的设置。存储健康检查使用 MinIO live、Qdrant healthz 和容器内 Redis `PING`。
- 启动后检查 Tessmora `/health`、Vite 页面和经前端代理的 `/api/knowledge/` 真实响应；这不代表所有模型服务商、上传解析和检索路径都已通过验收。
- 本地状态保存在忽略跟踪的 `logs/dev/`。停止前核对 PID、用户、启动时间和参数，避免误杀其他项目或 PID 复用后的进程；不使用全局 `pkill`。IPv4/IPv6 端口冲突会给出排查命令。
- 前后端运行于各自进程组；启动中断、就绪超时或任一服务退出时会清理应用进程。存储容器保持运行，不启动 Celery、重新解析或重新向量化。

已有旧脚本或手动启动的服务不会被自动接管。若启动报告端口占用，先用提示中的 `lsof` 检查 PID 和命令，停止确认属于该项目的旧进程，再启动新入口。

## 日志与脚本验证

日志保留并追加启动分隔行：

- `logs/dev/supervisor.log`：依赖、Docker、存储与就绪阶段。
- `logs/restored-backend.log`：FastAPI。
- `logs/restored-frontend.log`：Vite。

```bash
bash -n start-dev.sh scripts/start-restored.sh
.venv/bin/python scripts/test_dev.py -v
```

回归检查使用临时目录和临时进程，覆盖端口冲突、进程身份、进程组清理、并发锁、代理响应、恢复数据保护和失败清理，不操作真实知识库或调用模型。
