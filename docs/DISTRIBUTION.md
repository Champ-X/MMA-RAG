# Tessmora 容器分发

终端安装器使用 [`deploy/compose.yaml`](../deploy/compose.yaml) 启动完整安装：编译后的网页、Python API、Pi Node 运行时、Celery worker、MinIO、Qdrant 与 Redis。安装器的操作说明见 [CLI](../packages/cli/README.md)。现有根目录 `docker-compose.yml` 和开发启动流程保持独立。

真实安装、异常恢复、示例问答及引用验收见 [首次安装与使用验收](ONBOARDING_VERIFICATION.md)。

## 本地构建与安装

发布前可从源码构建。进入终端向导只需 Node.js 22.19+；完整运行需要 Docker Engine / Docker Desktop 和 Compose v2.20+（也支持独立的 `docker-compose`）。向导会检查并提供按系统分流的安装、启动与权限修复指引。macOS 的 Colima 可作为 Docker 引擎。建议 Docker 分配至少 8 GiB 内存、4 个 CPU，并为镜像、模型与知识库保留至少 20 GiB 空间；实际需求随资料和启用模型变化。

```bash
# 在仓库根目录构建应用与固定版本 MinIO 镜像；不会读取 backend/.env。
sh deploy/build.sh

# 从源码运行安装器。以 CLI 的 --help 为准。
npm --prefix packages/cli ci
node packages/cli/bin/tessmora.js setup --source .
```

镜像默认名为 `tessmora-backend:local` 和 `tessmora-frontend:local`，构建与运行均可通过 `TESSMORA_BACKEND_IMAGE`、`TESSMORA_FRONTEND_IMAGE` 指定版本。当前实现支持本地构建和 npm 打包；不能把尚未发布的 npm 包或镜像当作已上线版本。公开分发时需先构建、验证并发布对应平台镜像，再将准确版本写入 CLI 发布配置。

无源码的安装使用包内 Compose 运行文件；npm 包也包含 MinIO 的固定源码构建文件。应用源码构建额外加载 [`deploy/compose.build.yaml`](../deploy/compose.build.yaml)。应用源码构建命令是：

```bash
docker compose --env-file /path/to/private/runtime.env \
  -p tessmora-example \
  -f /path/to/MMA-RAG/deploy/compose.yaml \
  -f /path/to/MMA-RAG/deploy/compose.build.yaml build backend frontend
```

没有 `docker compose` 子命令时替换为 `docker-compose`。构建失败后可重试，Docker 会复用已完成的层。受网络环境影响时，可设置 `TESSMORA_DEBIAN_MIRROR=https://mirrors.ustc.edu.cn` 后构建，使用 Debian 镜像站；APT 仍验证发行版签名。构建不需要模型 API 凭证；模型权重也不内嵌在应用镜像中。

源码安装的 `setup` / `start` 会比较实际构建输入的内容指纹和 Docker 镜像 ID，源码更新或镜像被替换后自动增量构建，再更新应用容器。旧安装缺少版本记录时补建一次；源码和镜像均未变化时跳过构建。检查兼容没有 Git 历史的源码目录，排除密钥、资料、缓存和生成产物。构建成功但启动失败时保留构建记录，重试可直接继续；构建失败或构建期间源码发生变化时不记录新版本成功。

更新源码后运行 `node packages/cli/bin/tessmora.js setup` 即可继续原实例；`--rebuild` 仍可强制更新。源码模式的构建与启动均使用同一源码目录中的 Compose 文件，避免构建新代码却使用包内旧运行配置。维护 Dockerfile / `.dockerignore` 的复制范围时，需同步 `packages/cli/src/source-build.js` 的构建输入范围。

终端快捷命令通过 `npm --prefix packages/cli run register-command` 注册到 npm 全局目录；源码启动不会自动改写 PATH。注册与 PATH 排查见 [安装器说明](../packages/cli/README.md)。使用 `--no-open` 或 WSL 自动打开失败时，运行 `node packages/cli/bin/tessmora.js open --print-url` 获取带凭证的私有连接链接。裸地址不携带首次访问凭证，网页会提供连接恢复入口。

终端向导的网络选项允许显式指定模型下载镜像和构建代理，无需手改 `.env`。代理地址必须能从 Docker 容器内访问；宿主机的 `127.0.0.1` 在容器内指向容器本身。构建代理只用于下载依赖；`--proxy` 运行代理用于容器内模型请求与下载，内部服务通信会绕过代理。代理不能替代模型服务的 API 凭证。

运行配置同时覆盖大小写的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`，避免 Docker 客户端注入的旧代理或小写 `no_proxy` 覆盖应用设置。所有 Qdrant 客户端默认直连，包括安装检查、普通检索与 Pi 检索；不会更改模型服务的代理设置。SDK 自带的版本探测会忽略连接代理选项，因此统一关闭这一独立请求，实际连接检查通过 SDK 读取集合完成。自定义远程 Qdrant 部署确实需要代理时，可显式设置后端环境变量 `QDRANT_USE_ENV_PROXY=true`。

### MinIO 分发来源

2026-10-12 检查时，原 `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` 无法公开获取，Docker Hub 同版本不可用，官方历史二进制下载返回 410。[上游 README](https://github.com/minio/minio#source-only-distribution) 已说明社区版改为源码分发。登录 Docker 或重复拉取不能保证修复这一默认来源。

新默认镜像为 `tessmora-minio:RELEASE.2025-09-07T16-13-09Z`。CLI 优先复用本机已存在的同版本旧官方镜像；没有缓存时，通过 [`Dockerfile.minio`](../deploy/Dockerfile.minio) 构建官方 commit `07c3a429bfed433e49018cb0f78a52145d4bedeb`。源码 archive 的 SHA256 固定为 `8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2`；镜像保留源码归档、LICENSE / CREDITS 和来源标签。构建使用容器内 Go 与 BuildKit 缓存；限制编译并行度，避免占满初次安装机器。

首次构建需要访问 GitHub、Go 模块源和 Docker 基础镜像仓库。先准备 MinIO / Qdrant / Redis，再构建应用，可以尽早发现基础下载问题。`--minio-image` / `TESSMORA_MINIO_IMAGE` 可指定已有可信镜像；CLI 不会为自定义镜像私自更换来源或降级。原有开发 Compose 与存储数据不由此安装流程迁移。

## 安装器与 Compose 的约定

| 变量 | 作用 |
| --- | --- |
| `TESSMORA_DATA_DIR` | 本次安装的绝对数据目录，必须显式传入 |
| `TESSMORA_PORT` | 网页端口，默认 3001 |
| `TESSMORA_STORAGE_PORT` | 浏览器读取 MinIO 引用附件的端口，默认 9000 |
| `TESSMORA_SETUP_TOKEN` | 本次安装的随机管理凭证，安装器生成，禁止写入公开日志 |
| `TESSMORA_MINIO_USER` | 对象存储账号，默认 `tessmora` |
| `TESSMORA_MINIO_PASSWORD` | 本次安装的随机对象存储密码，安装器生成 |
| `TESSMORA_MINIO_IMAGE` | MinIO 镜像，默认固定版本本地构建；已有 CLI 实例可用 `setup --minio-image` 更新 |
| `TESSMORA_BACKEND_IMAGE` | 后端、Pi 与 worker 使用的同一镜像版本 |
| `TESSMORA_FRONTEND_IMAGE` | 已构建网页与 Nginx 镜像版本 |
| `TESSMORA_HF_ENDPOINT` | 本地模型下载服务，默认官方 Hugging Face，可显式选择镜像 |
| `TESSMORA_PROXY` | 运行时显式 HTTP/HTTPS 代理；内部存储与 API 通信绕过代理 |
| `TESSMORA_BUILD_PROXY` | 仅源码构建使用的 HTTP/HTTPS 代理，不写入应用镜像 |
| `TESSMORA_DEBIAN_MIRROR` | 源码构建使用的 Debian 软件包镜像 |

CLI 以私有 `--env-file` 和独立 `--project-name` 启动 Compose。私有文件权限为 `0600`，模型密钥通过遮罩输入或私有文件传递。不使用固定容器名或全局共享数据卷，避免覆盖开发环境和其他安装。所有宿主机端口仅绑定 `127.0.0.1`；后端、Qdrant、Redis、MinIO 管理控制台均不直接暴露。该默认配置用于本机单用户安装；远程模式连接已经由管理员部署、配置网络与访问控制的服务。

Nginx 代理 `/api/` 和 `/health`，支持流式输出及较长解析请求。`/setup` 等前端路径由 SPA 处理。Pi 使用与安装管理相同的本地凭证，网页完成引导后沿用已认证会话。

回环健康探针显式绕过代理：前端使用 BusyBox wget 的 `-Y off` 并执行 GET；后端与 MinIO 使用 curl 的 `--noproxy '*'`。不能仅依赖 `NO_PROXY`，Docker 客户端可能向容器注入小写代理变量。Compose 中也定义探针，更新 CLI 运行配置即可修正缓存镜像的探针。worker 保留 Celery ping 的退出码与原始输出；Redis 传输连接和读写超时为 5 秒，启动连接失败后继续重试，避免每次等待操作系统约两分钟的 TCP 超时。

安装失败会采集当前 Compose 项目的状态、退出码 / OOM、最近探针与异常服务日志，后端 / worker 还会探测内部 DNS 与 TCP。诊断有超时与长度限制，不读取容器完整环境；沿用配置凭证脱敏。再次执行 setup 仅重启仍不健康的应用服务以重新等待检查，不重启健康服务或存储。

`GET /api/setup/storage` 是只读存储检查，实际读取 Qdrant 集合和 MinIO 存储桶，分别返回结果；请求有超时限制，响应不包含凭证、地址、原始异常内容或存储清单。`doctor` 使用此接口，不再将空知识库列表视为存储健康。安装向导在模型测试前预检存储，第 5 步再次检查并初始化检索集合，存储失败会显示组件和 HTTP 状态等具体原因。托管安装只在准备步骤初始化集合；发现旧集合结构不兼容时保留数据并提示迁移，不自动删除重建。服务 `/health` 继续只表示 API 存活，不代表存储或模型已准备好。

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

Smoke 还会给前端注入一个不可用代理，验证旧探针失败而新探针与网页/API 均可用；通过 Redis 投递并执行真实 Celery 测试任务，并用不响应的 Redis 替身验证单次连接超时。随后通过配置 API 保存合成凭证，在大小写代理绕过列表冲突时执行真实存储初始化，验证六个集合创建、同步/异步读取及外部请求仍使用代理。它还会暂时停止隔离 Qdrant，确认存储检查准确报告故障并能恢复。合成凭证不用于模型调用，不下载模型。代理覆盖文件保留在该次证据目录，便于复查。

[Distribution images 工作流](../.github/workflows/distribution.yml)在原生 Linux amd64 / arm64 runner 上构建并执行此检查。该检查证明基础安装与重启；真实模型连接、下载恢复、资料入库、问答引用及浏览器视觉验收需要分别保留证据，不能用健康检查替代。

### 本次本地验证

2026-10-11 在 macOS / Colima 的 Linux arm64 环境实际构建并通过空安装检查：六个服务就绪；无模型凭证时网页和配置 API 可用；知识库为空；配置接口拒绝无 token 请求；Node 22.19、FFmpeg 5.1.9、LibreOffice 7.4.7、BGE-M3 / CLIP / CLAP 导入及文件类型检测可用；重启后持久目录标记保留。检查使用独立空目录和随机端口，结束后只移除测试项目容器，原有开发存储持续运行。

构建检查发现并修正了 PyArrow 26 与 NumPy 1.x 不兼容，以及 `python-magic` 缺少系统 `libmagic1` 的问题；完整依赖约束与运行导入检查已纳入分发。镜像环境未包含模型密钥、安装 token 或构建代理。当前验证不等于已发布到 npm/镜像仓库；Linux amd64 与托管 CI 执行结果需在实际运行后确认。
