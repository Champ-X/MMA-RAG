# Tessmora 容器分发

发行安装由六个容器组成。Nginx 提供网页并代理 `/api/` 和 `/health`，FastAPI 镜像包含 Pi Node 运行时，Celery worker 复用同一个镜像。MinIO、Qdrant 与 Redis 分别保存文件、索引和任务状态。日常安装和管理见[安装器手册](../packages/cli/README.md)，在宿主机运行 FastAPI 和 Vite 见[源码开发](LOCAL_STARTUP.md)。

## 构建方式

| 手头已有的内容 | 做法 |
| --- | --- |
| 源码 checkout | 在根目录运行 `npm --prefix packages/cli ci`，然后运行 `node packages/cli/bin/tessmora.js setup --source .`。向导使用同一 checkout 的运行和构建 Compose 文件。 |
| 打包后的 CLI 和已构建的应用镜像 | 运行 `tessmora setup`，按需传入 `--backend-image`、`--frontend-image`。CLI 包含运行清单和 MinIO 构建文件，构建应用镜像需要另行提供源码。 |
| 验证发行镜像 | 先用 `sh deploy/build.sh` 构建，再运行下方隔离测试。该脚本从仓库源码构建默认的 MinIO、后端和前端镜像。 |

源码安装会记录成功构建的输入指纹和镜像 ID。更新 checkout 后重新运行 `setup` 或 `start`，有变化的应用镜像会重新构建。构建成功而启动失败时，重试可以复用已有镜像。维护 Dockerfile 的 COPY 范围时同步检查[指纹计算](../packages/cli/src/source-build.js)、[构建覆盖文件](../deploy/compose.build.yaml)和[打包资源](../packages/cli/scripts/prepare-assets.js)。

### 镜像与网络

默认应用镜像名为 `tessmora-backend:local` 和 `tessmora-frontend:local`。后端包含 Python、Node、CPU PyTorch、FFmpeg、LibreOffice 和中日韩字体。本地模型在安装后按需下载。Python 依赖的版本约束见[发行约束](../deploy/constraints.txt)。

默认 MinIO 镜像为 `tessmora-minio:RELEASE.2025-09-07T16-13-09Z`。安装器可以复用同版本的本地官方镜像，否则从上游提交 `07c3a429bfed433e49018cb0f78a52145d4bedeb` 构建，校验源码归档 SHA-256，并随镜像保留对应源码与许可。首次构建需要访问基础镜像、GitHub 和 Go 模块源。已有可信镜像时可显式指定 `--minio-image`。Qdrant 固定为 `v1.16.2`。[MinIO 构建文件](../deploy/Dockerfile.minio) · [镜像准备](../packages/cli/src/runtime-images.js)

构建时可用 `--build-proxy` 或 `--debian-mirror`，运行时用 `--proxy`，模型下载源用 `--model-endpoint`。容器内的 `127.0.0.1` 指向容器本身。运行清单设置大小写两套代理环境变量，内部应用、存储地址和回环探针走直连。Qdrant 客户端默认直连，后端变量 `QDRANT_USE_ENV_PROXY=true` 可用于需要代理的外部 Qdrant。[运行清单](../deploy/compose.yaml)

## 配置、端口与备份

安装器按实例生成独立的 Compose 项目名和权限为 0600 的 `runtime.env`。其中 `TESSMORA_DATA_DIR` 是资料目录的绝对路径，`TESSMORA_SETUP_TOKEN` 和 `TESSMORA_MINIO_PASSWORD` 由安装器生成。模型服务商凭证保存在服务端私有状态中。

默认发布两个回环端口。网页使用 `TESSMORA_PORT`（3001），浏览器打开原件使用 `TESSMORA_STORAGE_PORT`（9000）。API、Qdrant、Redis 和 MinIO 控制台仅在容器网络内访问。网页使用 URL 片段中的安装令牌连接实例，手动连接使用 `tessmora open --print-url`。该链接含可复用凭证。[Nginx 配置](../deploy/nginx.conf) · [访问控制](../SECURITY.md)

| 资料目录 | 容器用途 |
| --- | --- |
| `state/` | 挂载到 `/state`，包含安装和模型配置、`data/` 后端状态及 `logs/`。 |
| `minio/`、`qdrant/`、`redis/` | 原文件、派生文件及文件元数据，向量索引和画像，Redis 持久状态。 |
| `pi-agent/` | Pi 任务账本、事件、附件与证据。 |
| `cache/huggingface/` | 下载的模型，后端和 worker 共用。 |
| `backend-data/`、`logs/` | 分别挂载到 `/app/backend/data` 和 `/app/backend/logs`，供兼容路径使用。 |

升级存储版本或迁移机器前，停止源实例，备份整个资料目录及 CLI 实例目录，再在独立目录试恢复。MinIO 密码在 CLI 的 `runtime.env` 中，丢失它会影响恢复。不要让两个运行中的实例同时写同一组目录。[安装器数据目录](../packages/cli/README.md#配置与数据)

## 验证发行镜像

在仓库根目录运行，需要 Docker 与 Compose。测试新版本时可以指定独立的镜像标签。

```bash
sh deploy/build.sh
python3 deploy/smoke.py
```

`deploy/smoke.py` 创建临时项目、空资料目录和空闲端口。它会检查以下行为。

- 通过 Nginx 读取网页与 API，验证安装权限、存储初始化、Qdrant 停止与恢复、回环探针和代理绕过规则。
- 通过 Redis 投递真实 Celery 任务，检查请求上下文按 greenlet 隔离，并用延迟响应验证 Redis 连接超时。
- 在镜像内实际生成并解析 PDF 和 XLSX，分别核对 PyMuPDF 解析路径及 openpyxl 使用的 defusedxml 读取器，同时检查 Pi SDK、媒体工具及字体。
- 写入测试对象和状态，重启 MinIO、后端、worker 和前端，再读回持久数据。

报告写在 `data/distribution-smoke/` 下的本次运行目录。默认清除隔离容器，保留报告和数据。`--keep` 保留容器供浏览器检查。`--backend-image`、`--frontend-image` 和 `--minio-image` 选择待测镜像。测试使用合成凭证。真实模型下载、推理和问答引用需要另行验收。[测试脚本](../deploy/smoke.py) · [Linux AMD64 / ARM64 工作流](../.github/workflows/distribution.yml)
