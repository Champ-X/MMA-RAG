# Tessmora CLI

终端优先的首次配置与运行管理。进入向导只需 Node.js **22.19+** 与 npm；Python 和应用依赖由容器提供。本机运行需要 Docker Engine / Docker Desktop 和 Compose **2.20+**，支持 `docker compose` 与独立 `docker-compose`。尚未准备 Docker 时，可先进入向导按步骤安装。首版面向 macOS、Linux、Windows WSL2；原生 Windows 尚未验收。

## 当前分发状态

这是仓库内可打包的开发版本。`@tessmora/cli` 为拟用 npm 包名，尚未发布；应用镜像目前由源码构建。下面的本地安装命令可以直接使用，不能把它描述为已经可从公共 npm / 镜像仓库安装。

```bash
# 在 Tessmora 仓库根目录
npm ci --prefix packages/cli
npm pack ./packages/cli --pack-destination /tmp
npm install -g /tmp/tessmora-cli-0.1.0.tgz
tessmora setup --source "$PWD"
```

也可以无需全局安装：`node packages/cli/bin/tessmora.js setup --source .`。

源码启动没有注册全局 `tessmora` 命令。中断后在仓库目录执行 `node packages/cli/bin/tessmora.js setup` 继续；界面会按实际启动方式生成指令，并保留自定义 `--home` / `--instance`。

正式发布镜像后，安装入口可使用 `npm install -g @tessmora/cli` / `npx @tessmora/cli setup`，并设置对应版本的 `--backend-image` 与 `--frontend-image`。npm 安装阶段不会启动服务、下载模型或收集凭证。源码构建与模型准备都发生在明确的 `setup` 中。

## 首次使用

1. 选择本机 Docker 运行，或只连接已有远程服务。
2. 选择文档问答、完整多模态，或自定义图片/音频/视频能力。
3. 检查 Docker，选择资料目录，解决端口冲突，准备完整运行环境。
4. 先确认 Qdrant 与 MinIO 可访问，再按当前模型路由遮罩输入所需凭证，真实测试后保存；默认 DeepSeek 负责对话，SiliconFlow 负责向量、重排与普通图片理解，音视频和 Pi 独立媒体能力按实际配置补充服务商。测试会产生少量服务商用量。
5. 检查存储并准备检索集合，再下载或复用所选能力的本地模型缓存，验证推理。存储与模型准备分别显示进度；重试保留已完成任务。
6. 打开网页，在首次使用卡片导入示例资料，提问并打开引用原文。

方向键选择，空格勾选，回车继续；各阶段提供返回入口。`Ctrl+C` 退出后重新执行 `tessmora` 或 `tessmora setup` 可继续。恢复时会检查服务的真实就绪状态；缺少模型缓存时继续准备，模型配置变化时重新验证。未通过测试的草稿凭证仅保留在当前进程内，退出后需要重新输入。

应用可在没有模型凭证时启动。服务可访问、模型连接测试通过、模型准备完成是独立状态，`status` 和 `doctor` 会明确显示尚未完成的部分。

`doctor` 会通过后端实际读取 Qdrant 集合和 MinIO 存储桶。即使网页可打开、知识库列表为空，存储连接失败也不会显示检查通过。遇到 `STORAGE_UNAVAILABLE`，按提示检查对应服务；已保存的模型配置和下载缓存会保留，无需重新填写密钥。模型缓存完整也不会掩盖本次存储准备失败。

已有源码安装更新此修复后，在原仓库运行 `git pull --ff-only`，再执行 `node packages/cli/bin/tessmora.js setup --rebuild` 重建应用镜像。原来使用了 `--home` / `--instance` 时须沿用；仅拉取代码不会更新已经运行的容器。无需删除数据目录或重新解析资料。

### Docker 尚未准备好时

向导分别识别 Docker 命令缺失、命令异常、引擎未连接、访问权限不足，以及 Compose 缺失或版本过低，并提供对应的步骤与官方链接：

- macOS：区分 Apple silicon / Intel；Docker Desktop 已安装时，可以选择启动应用。新安装的常见 Docker CLI 路径会补充到当前向导进程的 PATH，无需修改 shell 配置。
- Linux：识别常见发行版，给出官方 Engine / Compose 安装说明；服务未启动与当前用户权限不足分别处理。
- Windows / WSL：引导启用 WSL2 和 Docker Desktop 的 WSL Integration；原生 Windows 用户建议进入 WSL2 后运行项目。WSL 会尝试通过 Windows 浏览器打开指南，失败时保留可复制链接。
- 已有 Colima、自定义 context 或 `DOCKER_HOST`：沿用当前连接，显示对应检查步骤，不自动切换到另一个引擎。

菜单提供“打开官方安装 / 修复指南”“已完成，重新检测”“等待 Docker 就绪，自动继续”，以及返回与保存退出。等待每轮结束后间隔 3 秒检查，约 3 分钟后回到选择菜单；检查通过自动进入下一步。系统安装、管理员操作和 Docker 首次授权在系统或 Docker 窗口中完成，向导不会静默执行安装脚本或提权命令。

`--no-open` 隐藏浏览器打开选项；非交互模式失败时直接返回错误及系统对应的步骤，不启动桌面应用或等待交互。`doctor --json` 同样输出可操作的错误码与提示，并可在尚未完成运行环境配置时执行。

## 日常命令

### 环境准备进度与日志

环境准备分为检查本机、准备存储、准备应用镜像、启动服务、验证工作台五步。每步显示真实活动与耗时，完成项留在终端；长下载地址和构建输出不再反复刷屏。超过 15 秒没有新输出会显示等待时长，不把静默编译当作完成，也不虚构整体下载百分比。

完整脱敏日志保存在 `~/.tessmora/instances/<实例>/logs/setup-*.log`（自定义 `--home` 时随之变化），权限为 `0600`。界面会显示本次日志路径；可在另一个终端使用 `tail -f <该路径>` 观察详细输出。镜像仓库拒绝访问、下载限流、网络故障、磁盘不足与服务未就绪会分别给出处理建议。构建完成即保存检查点，后续启动失败重试时复用已有镜像。

默认 MinIO 保持 `RELEASE.2025-09-07T16-13-09Z`：存在本机同版本旧官方镜像时直接复用，否则在容器内从固定官方 Git commit 构建并校验源码 SHA256。无需宿主机 Go；第一次会增加依赖下载和编译时间。该路径不依赖已无法公开拉取的旧 Quay 镜像，也不会自动降级存储版本。已有可信镜像可通过 `setup --minio-image <引用>` 指定，建议使用同版本的固定标签或 digest；不会自动替换用户指定的镜像。

### 管理实例

```bash
tessmora start             # 启动并打开网页
tessmora stop              # 停止本实例，保留数据
tessmora status            # 应用和模型准备状态
tessmora logs --service backend --tail 100
tessmora logs --follow     # 持续查看日志
tessmora configure         # 调整能力、端口和模型凭证
tessmora doctor            # 检查 Docker、权限、容器和真实 HTTP 状态
tessmora open              # 重新打开网页并建立本机配置会话
```

`start --no-open` 适合无桌面环境。远程连接只读取健康和配置状态，不创建容器、不修改远程配置，也不允许远程 `stop` / `logs`。

连接已有源码服务时，CLI 区分“可以连接”和“服务报告模型已就绪”；不会把连通成功改写成模型测试通过，也不强制源码服务进入托管安装。模型设置继续由远端原有环境管理。

## 配置与数据

默认 CLI 状态在 `~/.tessmora/instances/default/`，资料在 `~/.tessmora/data/default/`。使用 `--home` 或 `TESSMORA_HOME` 修改状态根目录，使用 `--instance 名称` 管理独立实例，首次安装时使用 `--data-dir` 选择资料目录。

- `instance.json`：无凭证的连接信息与安装阶段，权限 600。
- `runtime.env`：随机生成的安装令牌和存储密码，权限 600；父目录权限 700。
- 数据目录内 `state/setup.json`：服务端保存的模型配置；终端与网页共用同一接口和配置。
- `minio/`、`qdrant/`、`redis/`、`backend-data/`、`pi-agent/`、`cache/`：各服务的独立持久化目录。

每个实例有独立的 Compose project。CLI 不执行 `down --volumes`，不会停止其他项目或重新解析已有资料。已有实例不允许直接换数据目录或运行模式，避免失去旧数据管理入口；新连接应使用另一个 `--instance`。迁移时需备份**完整资料目录和 CLI 状态目录**，并保留原存储密码。不要只备份 npm 安装位置。

本机网页通过 URL fragment 传递当前安装令牌，网页立即移除地址片段并仅在标签页会话内使用；地址片段不会发送给 Web 服务器。令牌属于当前实例，可重复用于打开会话。CLI 不在输出中打印该令牌 URL。日志会屏蔽已知凭证；分享原始服务日志前仍应自行复核。

## 自动化

非交互模式必须显式传入 `--yes`。凭证通过私有 JSON 文件或环境变量传入，避免进入命令历史。

```bash
# credentials.json 的格式：{"deepseek":"...","siliconflow":"..."}
chmod 600 /secure/path/credentials.json
tessmora setup --yes --source /path/to/Tessmora \
  --capabilities text --credential-file /secure/path/credentials.json \
  --no-open --json

tessmora setup --yes --instance server --mode remote \
  --url https://your-tessmora.example --no-open --json
```

环境变量为 `TESSMORA_DEEPSEEK_API_KEY`、`TESSMORA_SILICONFLOW_API_KEY`、`TESSMORA_ALIYUN_BAILIAN_API_KEY`、`TESSMORA_OPENROUTER_API_KEY`。`--json` 保证 stdout 为一个 JSON 结果，进度写 stderr；失败退出 1，用户取消退出 130。支持 `NO_COLOR=1`。

默认网页端口 3001、文件存储端口 9000，均绑定本机回环地址。冲突时引导选择空闲端口；非交互模式显式指定的端口冲突会报错，避免悄悄改变脚本约定。

向导与 `doctor` 会展示 Docker 可用内存和 CPU。内存少于 8 GiB 时给出资源建议，但不会修改或重启已有 Docker 引擎；完整多模态通常需要更多资源。

启动失败时，向导会自动记录本实例六个服务的状态、失败探针、异常服务最近 80 行日志；后端或任务服务异常时，还会检查容器到 Redis / MinIO / Qdrant 的 DNS 和 TCP 连接。错误页显示具体服务与关键原因，完整脱敏诊断写入当前安装日志。`doctor` 也提供这些诊断。再次运行 setup 时，仅对仍不健康的应用服务重新启动检查，健康服务与存储不重启。

网页可访问却显示 `frontend unhealthy` 时，可能是 Docker 注入的代理影响了回环探针。当前探针显式绕过代理；运行配置中的修复也适用于已有镜像。源码用户更新后可运行：

```bash
git pull --ff-only
npm --prefix packages/cli ci
node packages/cli/bin/tessmora.js setup --rebuild
```

沿用原来的 `--home` / `--instance`（如有）。`--rebuild` 会将后端连接超时等源码更新放入应用镜像，复用 Docker 缓存，保留模型与资料。Redis 自身健康不代表 worker 到 Redis 的网络可达；若诊断显示 `tcp_timeout` 或 `dns_failed`，需检查 Docker / WSL 网络与 VPN 路由。Redis 单次连接 / 读写等待限制为 5 秒，由 Celery 继续重试；这不会自动修改宿主网络。

本地模型默认从 `https://huggingface.co` 下载。如果所在网络无法访问，向导的“调整目录和端口”中可填写可信模型镜像，也可执行 `tessmora setup --model-endpoint https://your-trusted-model-mirror.example` 更新地址并从当前阶段继续。CLI 不会自行切换镜像；此选项只改变模型下载源，不改变模型服务商 API 地址。已有缓存会保留。

源码构建遇到网络问题时可使用 `--build-proxy http://容器可达的代理地址:端口` 或 `--debian-mirror https://可信Debian镜像站`。代理地址不能使用容器内不可达的宿主 `127.0.0.1`，也不接受 URL 内嵌账号密码；CLI 不会自动复制宿主机的代理设置。构建代理通过临时 build args 传入，不写入应用镜像环境。

如果 Docker 内无法访问模型服务商，使用 `tessmora setup --proxy http://容器可达的代理地址:端口` 设置运行代理并重试；`--proxy off` 关闭。此代理仅在明确指定后生效，内部 MinIO、Qdrant、Redis 和应用地址会绕过代理。

## 开发与验证

```bash
npm ci
npm test
npm pack --dry-run
```

测试覆盖私有状态权限、凭证脱敏、真实 HTTP 协议交互、错误凭证不保存、准备中断后的阶段恢复、端口冲突、数据目录归属及远程只读行为。测试中的服务和 Docker 响应是隔离替身；它们不能代替真实镜像构建、真实服务商调用、模型推理及浏览器引用验收。

本次实际安装与业务验收记录见仓库的 `docs/ONBOARDING_VERIFICATION.md`。
