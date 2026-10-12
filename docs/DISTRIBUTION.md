# Tessmora 容器分发

终端安装器使用 [`deploy/compose.yaml`](../deploy/compose.yaml) 启动完整安装：编译后的网页、Python API、Pi Node 运行时、Celery worker、MinIO、Qdrant 与 Redis。安装器的操作说明见 [CLI](../packages/cli/README.md)。现有根目录 `docker-compose.yml` 和开发启动流程保持独立。

真实安装、异常恢复、示例问答及引用验收见 [首次安装与使用验收](ONBOARDING_VERIFICATION.md)。

## 本地构建与安装

发布前可从源码构建，系统需安装 Node.js 22.19+、Docker Engine / Docker Desktop 和 Compose v2.20+（也支持独立的 `docker-compose`）。macOS 的 Colima 可作为 Docker 引擎。建议 Docker 分配至少 8 GiB 内存、4 个 CPU，并为镜像、模型与知识库保留至少 20 GiB 空间；实际需求随资料和启用模型变化。

```bash
# 在仓库根目录构建两个本地镜像；不会读取 backend/.env。
sh deploy/build.sh

# 从源码运行安装器。以 CLI 的 --help 为准。
npm --prefix packages/cli ci
node packages/cli/bin/tessmora.js setup --source .
```

镜像默认名为 `tessmora-backend:local` 和 `tessmora-frontend:local`，构建与运行均可通过 `TESSMORA_BACKEND_IMAGE`、`TESSMORA_FRONTEND_IMAGE` 指定版本。当前实现支持本地构建和 npm 打包；不能把尚未发布的 npm 包或镜像当作已上线版本。公开分发时需先构建、验证并发布对应平台镜像，再将准确版本写入 CLI 发布配置。

无源码的安装只使用 Compose 运行文件，源码构建额外加载 [`deploy/compose.build.yaml`](../deploy/compose.build.yaml)。源码构建命令是：

```bash
docker compose --env-file /path/to/private/runtime.env \
  -p tessmora-example \
  -f /path/to/MMA-RAG/deploy/compose.yaml \
  -f /path/to/MMA-RAG/deploy/compose.build.yaml build
```

没有 `docker compose` 子命令时替换为 `docker-compose`。构建失败后可重试，Docker 会复用已完成的层。受网络环境影响时，可设置 `TESSMORA_DEBIAN_MIRROR=https://mirrors.ustc.edu.cn` 后构建，使用 Debian 镜像站；APT 仍验证发行版签名。构建不需要模型 API 凭证；模型权重也不内嵌在应用镜像中。

终端向导的网络选项允许显式指定模型下载镜像和构建代理，无需手改 `.env`。代理地址必须能从 Docker 容器内访问；宿主机的 `127.0.0.1` 在容器内指向容器本身。构建代理只用于下载依赖；`--proxy` 运行代理用于容器内模型请求与下载，内部服务通信会绕过代理。代理不能替代模型服务的 API 凭证。

## 安装器与 Compose 的约定

| 变量 | 作用 |
| --- | --- |
| `TESSMORA_DATA_DIR` | 本次安装的绝对数据目录，必须显式传入 |
| `TESSMORA_PORT` | 网页端口，默认 3001 |
| `TESSMORA_STORAGE_PORT` | 浏览器读取 MinIO 引用附件的端口，默认 9000 |
| `TESSMORA_SETUP_TOKEN` | 本次安装的随机管理凭证，安装器生成，禁止写入公开日志 |
| `TESSMORA_MINIO_USER` | 对象存储账号，默认 `tessmora` |
| `TESSMORA_MINIO_PASSWORD` | 本次安装的随机对象存储密码，安装器生成 |
| `TESSMORA_BACKEND_IMAGE` | 后端、Pi 与 worker 使用的同一镜像版本 |
| `TESSMORA_FRONTEND_IMAGE` | 已构建网页与 Nginx 镜像版本 |
| `TESSMORA_HF_ENDPOINT` | 本地模型下载服务，默认官方 Hugging Face，可显式选择镜像 |
| `TESSMORA_PROXY` | 运行时显式 HTTP/HTTPS 代理；内部存储与 API 通信绕过代理 |
| `TESSMORA_BUILD_PROXY` | 仅源码构建使用的 HTTP/HTTPS 代理，不写入应用镜像 |
| `TESSMORA_DEBIAN_MIRROR` | 源码构建使用的 Debian 软件包镜像 |

CLI 以私有 `--env-file` 和独立 `--project-name` 启动 Compose。私有文件权限为 `0600`，模型密钥通过遮罩输入或私有文件传递。不使用固定容器名或全局共享数据卷，避免覆盖开发环境和其他安装。所有宿主机端口仅绑定 `127.0.0.1`；后端、Qdrant、Redis、MinIO 管理控制台均不直接暴露。该默认配置用于本机单用户安装；远程模式连接已经由管理员部署、配置网络与访问控制的服务。

Nginx 代理 `/api/` 和 `/health`，支持流式输出及较长解析请求。`/setup` 等前端路径由 SPA 处理。Pi 使用与安装管理相同的本地凭证，网页完成引导后沿用已认证会话。

## 数据与重启

数据目录内各部分独立保存：

```text
state/              安装配置、模型凭证与准备任务进度
state/data/         模型任务路由等后端持久状态
state/logs/         托管安装的运行日志
backend-data/       旧路径兼容卷
pi-agent/           Pi 会话和执行记录
cache/huggingface/   按需下载的本地模型
minio/              原始文件和解析产物
qdrant/             向量、稀疏索引及知识库元数据
redis/              持久化任务队列
logs/               旧路径兼容日志卷
```

应用与 worker 共用相同配置目录；后台模型下载复用持久缓存。`stop` 和容器重建保留以上目录。worker 在执行新任务前重新读取已保存的模型配置。不要将已有开发环境的 Qdrant 或 MinIO 数据目录同时挂载给另一个正在运行的实例；迁移前应停止源实例并完整备份，不能只移动其中一个存储。

升级应用镜像前，停止本次安装并备份整个数据目录及安装器私有配置。版本升级涉及 Qdrant 存储格式时应单独评估，发行 Compose 将 Qdrant 固定在 `v1.16.2`，不会默认跟随 `latest`。

## 构建边界与验证

生产后端使用 Python 3.11、Node 22.19、CPU PyTorch，Python 依赖版本由 `deploy/constraints.txt` 固定，并包含 FFmpeg、LibreOffice 和 Noto 中日韩字体。Docker 构建上下文采用 `.dockerignore` 白名单，仅复制应用源码和必要构建资源；不会发送 `backend/.env`、用户知识库、本地模型缓存或开发虚拟环境。

```bash
# 验证全新空目录启动、网页/API 代理、运行工具和重启持久化。
python3 deploy/smoke.py

# 留下隔离实例用于浏览器验收（控制台给出 URL 和证据目录）。
python3 deploy/smoke.py --keep

# 验证指定镜像，避免覆盖当前 local 标签。
python3 deploy/smoke.py --backend-image tessmora-backend:review --frontend-image tessmora-frontend:review
```

脚本使用随机项目名、空数据目录、空模型配置和空闲端口，不操作已有安装。退出时默认停止且移除本次隔离容器，保留报告与数据，便于检查；不执行 `down -v`。报告不包含管理 token、存储密码或模型密钥。`--keep` 实例检查完毕后，使用输出目录内的 `runtime.env`、报告内 `project`，对同一 Compose 文件执行 `down`。

[Distribution images 工作流](../.github/workflows/distribution.yml)在原生 Linux amd64 / arm64 runner 上构建并执行此检查。该检查证明基础安装与重启；真实模型连接、下载恢复、资料入库、问答引用及浏览器视觉验收需要分别保留证据，不能用健康检查替代。

### 本次本地验证

2026-10-11 在 macOS / Colima 的 Linux arm64 环境实际构建并通过空安装检查：六个服务就绪；无模型凭证时网页和配置 API 可用；知识库为空；配置接口拒绝无 token 请求；Node 22.19、FFmpeg 5.1.9、LibreOffice 7.4.7、BGE-M3 / CLIP / CLAP 导入及文件类型检测可用；重启后持久目录标记保留。检查使用独立空目录和随机端口，结束后只移除测试项目容器，原有开发存储持续运行。

构建检查发现并修正了 PyArrow 26 与 NumPy 1.x 不兼容，以及 `python-magic` 缺少系统 `libmagic1` 的问题；完整依赖约束与运行导入检查已纳入分发。镜像环境未包含模型密钥、安装 token 或构建代理。当前验证不等于已发布到 npm/镜像仓库；Linux amd64 与托管 CI 执行结果需在实际运行后确认。
