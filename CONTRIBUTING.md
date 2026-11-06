# 参与贡献

**简体中文** · [English](CONTRIBUTING-en.md)

欢迎改进 Tessmora 的代码、文档、界面与评测。Issue 和 Pull Request 均可使用中文或英文。先了解 [项目与快速开始](README.md#快速开始)，再按改动范围准备环境和验证。

安全漏洞、泄露凭证或涉及私人资料的问题，请走 [安全报告流程](SECURITY.md#reporting)，不要在公开 Issue 中披露细节。

## 提出问题或建议

先搜索已有 [Issues](https://github.com/Champ-X/MMA-RAG/issues) 和 [Pull Requests](https://github.com/Champ-X/MMA-RAG/pulls)，避免遗漏正在处理的同类问题。

- **缺陷报告**：附提交 SHA、操作系统、Python / Node 版本、安装方式、使用模式（常规检索或 Pi）、最小复现、预期与实际结果。
- **模型或检索问题**：补充服务商与模型名、所用资料和搜索范围、失败阶段及可公开的最小样例。保留失败和降级情况，不只展示成功答案。
- **界面问题**：附脱敏截图、界面语言、主题和视口大小；说明是否影响键盘操作或媒体播放。
- **功能建议**：说明使用场景、现有阻碍和期望行为。较大的架构变更可先用 Issue 讨论取舍，再拆成可独立验证的修改。

不要粘贴 API Key、连接凭证、私有文件链接、完整用户会话或未脱敏日志。

## 从贡献分支开始

在 GitHub 上 fork 仓库，将下面的 `YOUR_GITHUB_USERNAME` 替换为自己的用户名：

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/MMA-RAG.git
cd MMA-RAG
git remote add upstream https://github.com/Champ-X/MMA-RAG.git
git switch -c feat/your-change
```

已有可写 checkout 时，先检查 `git status --short --branch`，保留未提交工作，再创建本次修改的分支。本文不要求改写既有历史。浅克隆的历史获取方式见 [仓库维护](docs/REPOSITORY.md)。

## 本地开发环境

只修改文档时，可直接编辑并进行链接、资源和暂存检查。运行应用时，macOS / Linux 使用下列源码流程；Windows 可使用 WSL2。

| 依赖 | 用途 |
| --- | --- |
| Python 3.11 或 3.12 | 后端与 Python 测试；以下示例使用 3.12 |
| Node.js ≥22.19、npm | 前端、Pi 工作进程与安装管理 CLI |
| Docker / Compose | 本地 MinIO、Qdrant、Redis；完整安装器要求 Compose 2.20+ |
| FFmpeg / ffprobe、LibreOffice | 音视频处理与 Office 转换；Linux 中文文档建议安装 `fonts-noto-cjk` |

在仓库根目录准备依赖；已有 `backend/.env` 时保留现有文件：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix agent-runtime ci
npm --prefix packages/cli ci
cp -n backend/.env.example backend/.env
```

编辑 `backend/.env`，填写所需凭证并清空未使用服务的占位值。文本问答的默认路由使用 DeepSeek 和 SiliconFlow，默认图片、音频、视频能力还使用阿里云百炼；完整配置见 [README](README.md#从源码开发)。不要将真实凭证写进测试夹具或前端变量。

```bash
./start-dev.sh doctor
./start-dev.sh
```

脚本在本机运行前后端，只从根 Compose 启动或复用 MinIO / Qdrant / Redis。Web 默认 `http://localhost:3001`，后端及 OpenAPI 为 `http://localhost:8000/docs`；完整容器安装是另一条路径，使用 `deploy/compose.yaml`。重启、端口和恢复数据见 [本地启动](docs/LOCAL_STARTUP.md)。

示例配置启用本地模型预加载，首次启动可能下载模型并占用较多内存；真实模型调用可能传出内容和产生费用。使用专用开发资料和凭证。涉及 Pi 恢复或存储的修改，使用独立 `PI_AGENT_DATA_DIR`，不要让多个宿主共用同一运行目录；详见 [Pi Durable](docs/pi-agent-durable.md)。

## 工作目录

| 目录 | 维护内容 |
| --- | --- |
| `frontend/src/`、`frontend/public/`、`frontend/tests/` | Web 界面、发布资源与前端回归 |
| `backend/app/` | API、入库、素材收集、检索、生成、模型与存储适配 |
| `backend/app/modules/pi_agent/`、`agent-runtime/` | Pi Python 宿主、来源工具、运行账本、Node / Durable 循环与协议回归 |
| `backend/tests/`、`backend/test_*.py` | 后端回归、测试夹具及历史测试入口 |
| `packages/cli/` | `tessmora` 安装、配置、诊断和实例管理 |
| `deploy/` | 完整容器分发、Nginx、镜像构建与隔离安装 smoke |
| `skills/mma-rag/` | `mma-rag` 知识库 CLI 与 Codex Skill |
| `backend/evaluation/`、`evals/` | 评测工具与明确保留的最小数据 |
| `scripts/`、`backend/scripts/`、`docs/` | 运维与验证工具、当前使用及架构文档 |

## 验证

从仓库根目录执行与改动相关的检查。行为修复应覆盖实际失败路径；界面和模型行为还需相应的人工或真实链路验收。不要为文案调整机械地运行全部应用测试。

| 改动范围 | 建议验证 |
| --- | --- |
| 文档、资源或分发文件 | `git diff --check`；精确暂存后运行 `python3 scripts/check_repository.py` |
| 前端 | `npm --prefix frontend test`、`npm --prefix frontend run test:dom`、`npm --prefix frontend run build` |
| Pi Node 运行时、工具协议或 Durable | `npm --prefix agent-runtime test`，再选择对应 Python 宿主回归 |
| Python 后端 | 用项目虚拟环境运行受影响模块的 pytest；示例见下方 |
| 安装管理 CLI | `npm --prefix packages/cli test`；在 `packages/cli/` 中运行 `npm pack --dry-run` |
| 本地启动控制器 | `python3 scripts/test_dev.py`；该测试使用替身，不启动真实 Docker 或模型 |
| Nginx / 部署路由 | `python3 scripts/test_deploy_nginx.py`；需要 Docker，会创建并清理隔离 Nginx 容器 |
| 检索、索引或评测 | `./scripts/rag-eval validate` 校验合成基线；再按 [评测指南](docs/RAG_EVALUATION.md) 验证受影响行为 |

`npm pack --dry-run` 会执行 `prepack`，把分发资产同步到 `packages/cli/assets/`；检查这些变化是否属于本次修改。前端 DOM 回归使用 React / jsdom，不能代替浏览器：涉及交互时核对相关流程、窄屏、深浅主题、键盘焦点与媒体状态。

以 Durable 宿主回归为例，选择与修改对应的文件运行：

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests/test_pi_durable_recovery.py -q
```

需要完整后端回归时，可使用：

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests backend/test_*.py -q
```

部分模块在导入时初始化存储客户端，完整收集需要可达的本地 MinIO / Qdrant。`test-only` 只是非秘密占位值，不是网络隔离开关；测试通常替换模型调用，但手工脚本和 live 评测可能访问真实服务。缺少前提时运行可独立完成的模块，并说明未覆盖范围。卡住、中断或未收集到测试都不能记为通过。

### CI 实际覆盖什么

- [Repository checks](.github/workflows/checks.yml) 在 `main` push 和 PR 上运行：仓库规则、启动控制器、Nginx 路由、差异格式、前端测试 / DOM / 构建、Pi Node 测试、安装器测试及 npm 打包预检。工作流使用 Python 3.12 与 Node 22.19.0。
- [Distribution images](.github/workflows/distribution.yml) 在相关路径的 PR 或手动触发时，在 Ubuntu x64 / ARM 上构建镜像并执行不使用真实模型凭证的隔离安装和重启 smoke。
- 完整后端 pytest、真实模型 / 语料评测和浏览器验收不属于上述自动检查。合成基线的 `validate` 只检查数据结构与指纹，不测在线检索质量；更多边界见 [Pi 评测说明](docs/pi-agent-durable.md#对比评测与已知问题)。

## 提交约定

代码、必要测试、小型夹具和当前文档应随修改一起交付。更新外部依赖时同步对应 lockfile；修改行为时同步技术文档与中英文 README，不将实验候选写成已交付能力。

| 内容 | 放置与提交规则 |
| --- | --- |
| 临时脚本、原始截图、日志、逐次模型回执 | 放入被忽略的 `ops/`；不随产品源码提交 |
| 下载语料、用户知识、模型缓存、Pi 数据库与附件 | 放入被忽略的 `data/` 或配置的私有数据目录；不提交 |
| 评测运行结果与报告 | 放入 `evals/runs/` / `evals/reports/`；新增维护数据须明确用途、许可、哈希、测试消费者，并更新检查器白名单 |
| 密钥与可变配置 | 不提交 `.env`、真实凭证、`backend/data/llm_task_overrides.json`、`backend/data/jev_settings.json`；`.env.example` 仅放无秘密示例 |
| 发布所需图片、视频、图表或文档样例 | 放入明确的发布目录，检查来源、许可与脱敏情况；保留必要清单，避免重复大文件 |
| 依赖、构建和缓存 | 不提交 `node_modules/`、`frontend/dist/`、虚拟环境或模型权重 |

仓库检查器按 **Git 索引中的文件清单** 检查当前工作区文件与文档链接。新增文件须精确暂存后再检查，否则会被视为缺少分发目标；这不等于要求提交全部工作区。单文件默认上限 5 MiB，目前仅两段 README 介绍视频有 24 MiB 例外。新大文件优先使用独立发布资产，必要时明确调整具体文件规则。

把下面的示例路径替换为本次实际修改的文件，逐项审阅暂存内容：

```bash
git status --short
git diff --check
git add -- path/to/changed-file path/to/new-file
git diff --cached --name-status
git diff --cached --check
python3 scripts/check_repository.py
git diff --cached
```

`.gitignore` 不会移除已经跟踪的文件。不要为清理本次改动删除其他人的工作、覆盖冻结评测输入或改写共享历史；历史与大文件处理见 [仓库维护](docs/REPOSITORY.md)。

## 提交 Pull Request

从自己的分支向上游 `main` 提交聚焦的 PR。标题与说明描述具体问题和最终行为；需要继续工作的变更可以先开 Draft PR。

- **改了什么、为什么**：给出触发条件和改动后的行为，附相关 Issue；避免把讨论过程写成最终设计。
- **如何验证**：列出实际执行的命令、结果、所用环境；区分通过、失败、跳过和未执行，记录会影响结论的警告。
- **证据与边界**：界面修改附脱敏截图；检索 / 模型变化附输入、来源版本、模式、覆盖和失败情况，比较性能时同时报告质量与成本边界。
- **兼容与风险**：说明配置、接口或数据格式变化；涉及持久化时说明迁移、备份与回退条件，不把“构建通过”写成完整验收。

示例报告可以写：“前端单元、DOM 与构建通过；已核对 390px / 1280px 深浅主题和引用预览。未运行完整后端与真实模型评测，本次仅修改前端排版。”请按实际检查结果填写，不复制未执行的结论。

当前仓库尚未提供开源许可证；贡献流程不改变现有授权范围，见 [许可证说明](README.md#许可证)。
