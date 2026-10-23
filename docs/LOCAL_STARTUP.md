# 本地一键启动

在仓库任意工作区使用根目录 `start-dev.sh`；脚本会自行定位仓库，调用路径也可为绝对路径。`scripts/start-restored.sh` 是同一控制器的恢复入口，额外要求已有存储数据。

```bash
./start-dev.sh                       # 前台启动，Ctrl+C 停止前后端
./start-dev.sh --reload              # 后端自动重载，前端始终支持 HMR
./start-dev.sh start --background    # 后台启动，关闭终端后继续运行
./start-dev.sh restart --background  # 停止本入口管理的实例，再启动前后端
./start-dev.sh status                # 进程身份、API 健康和前端 /api 代理
./start-dev.sh logs                  # 三份日志各最后 30 行
./start-dev.sh stop                  # 停止前后端及其子进程，不操作存储容器
./start-dev.sh doctor                # 只读检查依赖、Docker 和已有存储挂载
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
| Docker context | `MMA_DOCKER_CONTEXT` → 已有 `colima-mma-rag` context 或 `mma-rag` Docker profile → 当前 context；只接受本地 Unix socket |
| Colima | 选中 `colima-mma-rag` 且 daemon 不可用时，只在确认 `mma-rag` Docker profile 已存在后执行 `colima start --profile mma-rag --activate=false`，不创建未知 profile |
| 新存储目录 | `MMA_STORAGE_ROOT` → `~/.local/share/tessmora/dev-storage`；使用 `minio_data`、`qdrant_storage`、`redis_data` 子目录，与 Orca 工作区生命周期分开 |
| FFmpeg / LibreOffice | 检测并提示缺失，不在每次启动时自动安装系统软件 |

```bash
MMA_PYTHON=/path/to/venv/bin/python ./start-dev.sh restart --background
FRONTEND_PORT=3010 MMA_START_TIMEOUT=600 ./start-dev.sh restart --background
./scripts/start-restored.sh restart --background --port 3001
```

新环境需先创建虚拟环境、安装后端依赖并填写配置，见 README。媒体工具可在 macOS 使用 `brew install ffmpeg` 和 `brew install --cask libreoffice`；Ubuntu/Debian 使用 `sudo apt-get install ffmpeg libreoffice fonts-noto-cjk`。

Colima 停止后可能移除 Docker context。启动器会通过只读的 `colima list --json` 识别已有 `mma-rag` Docker profile，正常启动时继续使用它，并在启动后再次校验 context 是本地 Unix socket。`doctor` 遇到这种状态会明确报告 profile 尚未启动或 context 不可用，不会启动它或修改全局 context。

## 数据与进程管理

- 有效的 `mmrag_minio` / `mmrag_qdrant` / `mmrag_redis` 优先原样复用，保留实际挂载。已有 MinIO/Qdrant 数据通常通过 `.minio.sys` / `collections` 标识检查；这不等于完整的数据校验。
- 普通 `./start-dev.sh` 不要求先恢复丢失的旧知识库。三个旧容器完整、但 MinIO/Qdrant 的 bind 源明确缺失或为空时，会停止并重命名保留这三个旧容器，再以独立 Compose project 创建新存储，随后启动前后端。旧容器、原卷和原 Redis 数据均不删除；原来启用的自动重启策略会禁用并记入恢复记录，避免旧容器再次抢占端口。新 Redis 也使用独立持久化目录，不继承旧任务队列。
- 没有存储容器时，新实例默认使用上述稳定目录；若当前仓库仍有完整的 `minio_data` / `qdrant_storage`，优先复用它们。若新目录与被保留容器的源路径重叠，改用稳定根目录下独立的 `instances/<project>/`；检查会解析软链接并比较父子目录，如果仍有重叠则停止，要求选择独立的 `MMA_STORAGE_ROOT`，避免旧容器接触新数据。不会覆盖非空的未知目录。
- `--restored` / `scripts/start-restored.sh` 严格要求已有数据，缺失时继续失败，不切换空库。未知挂载类型、非空但缺少标识的数据，以及不完整的旧容器组也会停止并给出诊断，普通入口不会盲目重置。
- 新实例的 Compose overlay 和初始化记录保存在 `logs/dev/storage-compose-*.json`、`storage-bootstrap.json`。首次启动被打断后，只有 project、路径和已知容器 ID 与记录匹配的实例可以续接同一初始化。新 MinIO 尚无 bucket、因而缺少 `.minio.sys` 时，不会被反复当作旧库丢失。保留旧容器的 ID、原名称、挂载及重启策略记录位于 `logs/dev/storage-preserved-*.json`，不记录环境变量或凭证。
- `doctor` 始终只读，报告具体挂载类型、宿主机 `Source` 和容器内 `Destination`，不启动或重命名容器，也不验证存储 API 健康。它报告旧挂载缺失，不代表普通启动无法创建独立的新实例。
- Docker 命令使用同一指定 context，不修改用户的全局 context，也不继承 `DOCKER_HOST` / `COMPOSE_FILE` 等可能冲突的设置。存储健康检查使用 MinIO live、Qdrant healthz 和容器内 Redis `PING`。
- 启动后检查 Tessmora `/health`、Vite 页面和经前端代理的 `/api/knowledge/` 真实响应；这不代表所有模型服务商、上传解析和检索路径都已通过验收。
- 本地状态保存在忽略跟踪的 `logs/dev/`。停止前核对 PID、用户、启动时间和参数，避免误杀其他项目或 PID 复用后的进程；不使用全局 `pkill`。IPv4/IPv6 端口冲突会给出排查命令。
- 前后端运行于各自进程组；启动中断、就绪超时或任一服务退出时会清理应用进程。清理不会操作存储容器，不启动 Celery、重新解析或重新向量化；停止提示不代表存储容器当前已运行。

Docker 容器保留创建时的绝对挂载路径；删除旧工作区会使其 bind 源失效，部分 Docker 检查还可能重新创建同名空目录。要继续使用应用，直接运行普通启动入口；要恢复原知识库，先根据 `storage-preserved-*.json` 找到旧容器和数据路径，核对备份完整性后再恢复。不要创建空目录或伪造初始化标识来冒充旧数据。新空库启动成功不代表原数据已经恢复。

已有旧脚本或手动启动的服务不会被自动接管。若启动报告端口占用，先用提示中的 `lsof` 检查 PID 和命令，停止确认属于该项目的旧进程，再启动新入口。

## 日志与脚本验证

日志保留并追加启动分隔行。启动失败时终端只展示本次启动的 supervisor 日志，避免旧 Colima 日志混入当前故障；`logs` 命令仍可查看日志文件末尾：

- `logs/dev/supervisor.log`：依赖、Docker、存储与就绪阶段。
- `logs/restored-backend.log`：FastAPI。
- `logs/restored-frontend.log`：Vite。

```bash
bash -n start-dev.sh scripts/start-restored.sh
.venv/bin/python scripts/test_dev.py -v
```

回归检查使用临时目录和临时进程，覆盖端口冲突、进程身份、进程组清理、并发锁、代理响应、缺失或断链挂载、doctor 诊断、旧容器保留、新实例隔离、初始化重试、恢复数据保护、失败清理和本次日志边界，不操作真实 Docker、知识库或模型。
