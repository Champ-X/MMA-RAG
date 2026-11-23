# Tessmora CLI

`tessmora` 安装、配置和管理自托管实例。需要 Node.js 22.19+ 和 npm。本机安装还需要 Docker Engine（或 Docker Desktop、Colima）及 Compose 2.20+。Windows 用户可以在 WSL2 中运行。Python、Pi 运行时和媒体工具随应用镜像提供。

## 从源码安装

在仓库根目录运行以下命令。向导会构建需要的镜像，提示选择资料目录、端口和模型能力。

```bash
npm --prefix packages/cli ci
node packages/cli/bin/tessmora.js setup --source .
```

默认使用本机网页端口 3001 和 MinIO 对象端口 9000。向导先检查 Docker 与存储，再按所选能力请求模型凭证、测试连接，并下载或复用本地模型。连接测试会向所选服务商发送合成样例并产生少量用量。中断后在同一仓库重新运行 `node packages/cli/bin/tessmora.js setup`，沿用原来的 `--home` 和 `--instance` 即可继续。

下文使用快捷命令 `tessmora`。可以一直用 `node packages/cli/bin/tessmora.js` 代替，也可以在仓库根目录注册命令。

```bash
npm --prefix packages/cli run register-command
tessmora --version
```

注册通过 npm link 指向当前源码目录。找不到命令时，确认 `npm prefix -g` 对应的 `bin` 目录在 PATH 中。也可以安装当前版本的本地 npm 包。

```bash
npm pack ./packages/cli --pack-destination /tmp
npm install -g /tmp/tessmora-cli-0.1.0.tgz
tessmora setup --source "$PWD"
```

包内包含运行用的 Compose 文件及固定版本 MinIO 的构建文件。构建前后端镜像要提供源码目录。已有可访问的应用镜像时，可用 `--backend-image`、`--frontend-image` 指定。构建参数和验证方法见仓库中的 `docs/DISTRIBUTION.md`。

## 管理实例

| 命令 | 用途 |
| --- | --- |
| `tessmora start` | 启动本实例并打开网页。无桌面环境可加 `--no-open`。 |
| `tessmora open` | 在浏览器中重新连接工作区。 |
| `tessmora open --print-url` | 向当前终端显示私有连接链接，适用于 WSL 或无桌面环境。 |
| `tessmora status` | 查看容器、服务和模型准备状态。 |
| `tessmora doctor` | 检查 Docker、目录、容器、HTTP 和存储连通性。 |
| `tessmora logs --service backend --tail 100` | 读取后端日志。加 `--follow` 可持续查看。 |
| `tessmora configure` | 调整端口、模型能力或凭证。 |
| `tessmora stop` | 停止本实例，保留资料和配置。 |

本机连接链接的 URL 片段含实例凭证，请只在自己的浏览器中打开。`open` 默认交给浏览器处理，只有显式使用 `open --print-url` 才会在终端显示链接。网页读入凭证后清除片段。Pi 接口验证凭证后可以签发有效期六小时的 HttpOnly 会话 cookie。

远程模式只连接已经部署的服务。使用 `tessmora setup --mode remote --url https://your-tessmora.example`，并为该连接选择独立的 `--instance`。模型配置、服务器日志和停止服务等操作在部署机器上管理。

## 配置与数据

默认实例的 CLI 状态在 `~/.tessmora/instances/default/`，资料在 `~/.tessmora/data/default/`。用 `--home` 或 `TESSMORA_HOME` 选择 CLI 根目录，用 `--instance` 区分实例。首次安装时可用 `--data-dir` 指定资料目录。

| 位置 | 内容 |
| --- | --- |
| 实例目录下的 `instance.json`、`runtime.env` | 实例地址、安装进度、存储密码和安装令牌。凭证写在权限为 0600 的 `runtime.env` 中。 |
| 资料目录下的 `state/` | 服务端安装与模型配置、准备进度及后端状态。`state/setup.json` 可含服务商密钥。 |
| `minio/`、`qdrant/`、`redis/` | 原文件与派生物、检索索引和任务状态。 |
| `pi-agent/`、`cache/` | Pi 账本、证据、私有附件和下载的模型。 |

迁移前停止实例，备份**整个资料目录和 CLI 实例目录**，保留原存储密码。源码安装更新后，在原仓库运行 `npm --prefix packages/cli ci` 和 `node packages/cli/bin/tessmora.js setup`。安装器按构建输入指纹和镜像 ID 决定是否重建。需要强制重建时加 `--rebuild`。

## 自动化

在无人值守的安装中指定 `--yes`。凭证使用私有 JSON 文件，如 `{"deepseek":"…","siliconflow":"…"}`，也可使用 `TESSMORA_DEEPSEEK_API_KEY`、`TESSMORA_SILICONFLOW_API_KEY`、`TESSMORA_ALIYUN_BAILIAN_API_KEY`、`TESSMORA_OPENROUTER_API_KEY`。

```bash
chmod 600 /secure/path/credentials.json
tessmora setup --yes --source /path/to/MMA-RAG \
  --capabilities text --credential-file /secure/path/credentials.json \
  --no-open --json
```

`--json` 将结果写到 stdout，进度写到 stderr。失败的退出码为 1，用户取消为 130。`open --print-url` 需单独使用，不能与 `--json` 组合。

## 排查安装问题

- **网页能打开，但还不能提问。** 运行 `tessmora status` 看模型是否准备完成，再运行 `tessmora doctor`。存储检查会实际读取 Qdrant 集合和 MinIO 桶。失败时可在实例目录的 `logs/setup-*.log` 查看具体服务、探针和最近的错误。
- **Docker 或端口不可用。** 按向导检查引擎、Compose 版本、当前用户权限和端口。显式指定 `--port` 或 `--storage-port` 可以避开冲突。WSL2 还需启用 Docker Desktop 对该发行版的集成。
- **构建或模型下载失败。** `--build-proxy` 和 `--debian-mirror` 用于构建，`--model-endpoint` 设置模型下载地址，`--proxy` 设置运行代理（`--proxy off` 关闭）。代理地址必须能从容器访问。重新运行 setup 会复用已完成的镜像构建和下载缓存。
- **只想检查安装器。** 在 CLI 源码目录运行 `npm ci`、`npm test` 和 `npm pack --dry-run`。打包会同步发行资源。真实镜像的隔离测试从仓库根目录运行 `python3 deploy/smoke.py`，需事先构建镜像。
