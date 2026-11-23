# 本地一键启动

`start-dev.sh` 在宿主机运行 FastAPI 和 Vite，并启动或复用 Docker 中的 MinIO、Qdrant 和 Redis。先按[源码开发](../README.md#从源码开发)安装依赖、填写 `backend/.env`。以下命令从仓库根目录运行。要运行包含 Celery worker 的完整安装，请使用[安装器](../packages/cli/README.md)。

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

## 启动或恢复知识库

| 当前存储 | 普通启动 | `--restored` |
| --- | --- | --- |
| 已有完整容器和有效数据 | 复用挂载与数据。 | 复用已有数据。 |
| 没有存储容器 | 优先使用仓库内完整的原存储目录，否则在稳定目录初始化。 | 要求已有可识别的存储数据。 |
| 原来三个容器完整，但 MinIO 或 Qdrant 的 bind 源已丢失或为空 | 停止并重命名旧容器，记录原路径及重启策略，另建独立实例和 Redis。 | 停止并提示恢复原数据。 |
| 旧容器不完整、挂载类型未知，或非空目录缺少预期标识 | 停止并报告冲突。 | 停止并报告冲突。 |

`doctor` 可查看挂载类型、宿主路径和容器内路径。它只读检查本机配置。普通启动还会读取 MinIO live、Qdrant healthz、Redis PING、后端 `/health` 及经前端代理的 `/api/knowledge/`。若要验证模型连通或引用，需发起相应的模型测试或问答。

旧容器的绝对挂载路径可能随旧工作区删除而失效。需要找回原知识库时，先从 `logs/dev/storage-preserved-*.json` 确认原挂载和容器身份，再从备份恢复。MinIO 的 `.minio.sys` 与 Qdrant 的 `collections` 用于识别目录，完整性仍需用实际资料核对。新建的空知识库只提供新的工作空间。

控制器把 Compose 覆盖文件和初始化记录放在 `logs/dev/`。重试会比对项目、路径和已知容器身份。若新旧路径重叠，需提供独立的 `MMA_STORAGE_ROOT`。请保留这些记录，后续恢复需要它们。

## 进程与端口

重复启动会检查本实例的进程身份与健康状态。端口已由其他程序使用时，按报错中的 `lsof` 命令核对 PID，再决定如何处理。停止、启动中断或就绪超时会清理本次管理的前后端进程组。存储容器独立运行。启动器选用指定的本地 Docker context，并在使用已有 Colima profile 时保持全局 context 设置。

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
