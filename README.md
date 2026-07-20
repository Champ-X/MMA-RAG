# MMA-RAG Nexus v2

Nexus 是一个证据优先、可恢复的本地多模态 Agentic Knowledge Base。系统把原始对象、不可变 Evidence Revision、Claim、Run Event 和 Artifact 作为一等领域对象；PostgreSQL 是业务真相，MinIO 保存 Raw/Derived 对象，Qdrant 只保存可重建索引投影，Redis 只承载瞬态协调。

实现基线见 [架构实施文档](docs/MULTIMODAL_AGENTIC_KNOWLEDGE_BASE_ARCHITECTURE_IMPLEMENTATION.md)，逐项替换证据和删除判断见 [Nexus v2 Implementation Audit](docs/architecture/NEXUS_V2_IMPLEMENTATION_AUDIT.md)，旧版/当前版/WeKnora 的产品体验对照见 [产品回归审计](docs/product/CURRENT_VS_LEGACY_PRODUCT_AUDIT.md)。旧 Chat Session、内存 StreamManager、旧 VectorStore/KnowledgeService、旧前端页面及静态 OpenAPI 已从运行路径和仓库中移除；它们对应的产品能力已迁入唯一的 v2 领域路径，而不是用删文件代替迁移。

## 核心流程

```text
Raw Source → Source Version → immutable Evidence + Locator
          → explicit-channel Retrieval → persistent Quick/Research Run
          → Evidence Ledger → Claim Gate → Canonical Artifact
```

- Raw-first：解析前先按 SHA-256 内容寻址保存原始字节。
- 文档不伪降级：PDF/DOC/DOCX/PPT/PPTX 只走 MinerU；未配置或失败时保留 Raw 并明确失败。
- 原生结构：Markdown/TXT、CSV/XLSX、图片、WAV 和视频元数据走各自结构真相。
- 显式检索：Exact、Dense、Sparse、Image、Audio、Video 通道独立报告 `completed`、`failed` 或 `unavailable`。
- 结果解释：根据冻结范围 Evidence 数、候选数和通道终态区分空范围、正常无匹配、检索不完整与投影不一致，并提供对应修复入口。
- Space 使用策略：Balanced、Multimodal、Research、Archive 模板实际控制自动路由、意图加权与 Run 默认深度，并随冻结范围写入可复现快照。
- 证据追问：回答后的相关问题来自该 Run 的冻结 Evidence Ledger，逐条说明“未展开证据/跨来源/媒体/引用细节”理由，点击后可编辑再发送。
- 会话资产：标题、置顶、归档和版本号由服务端权威保存；历史按活动时间游标分页，搜索覆盖标题与任意一轮问题，并在全局命令面板复用同一结果。
- 全局知识定位：命令面板同时搜索页面、Space、跨轮会话与全部已发布 Evidence 正文/来源名，命中 Evidence 可直接打开精确页码、字符、单元格或时间 Locator；移动端顶栏放大镜使用同一搜索，不再伪装成“新建研究”。
- 可浏览的已验证知识：每个 Space 只编译 T2/T3 Claim；Supported 与“冲突/部分支持/过期”分栏筛选，T0/T1 不进入知识视图，每条 Claim 可直达原始 Run 和精确 Evidence Revision Locator。
- 来源健康：每条材料区分 Raw 保留、Evidence 可搜索性与高级投影状态；连接来源可“检查上游”生成新版本，快照材料的“重解析现有原文”保持独立语义，失败可直达对应任务时间线。
- 持续同步：连接来源可按每小时至每周的频率自动检查上游；计划、租约和执行历史由服务端持久化，手动/定时检查共用幂等版本契约，未变化不会制造重复 Source Version，变化记录可直达任务时间线。
- 模型推荐配置：默认入口按回答、知识导航、视觉、音频和检索质量展示任务覆盖；只用已通过探测的能力一键补齐缺失路由，不覆盖已有自定义选择，无候选能力明确保持 fallback。
- 首次使用：空项目按真实状态引导“创建 Space → 添加原始材料 → 首次有引用回答”；引导可跳过也可从侧栏恢复，全局中英术语抽屉解释 Space、Source、Evidence、Run 和 Artifact。
- 主题与长时间阅读：恢复旧版 Light / Dark / System 三态外观；System 实时跟随操作系统，侧栏可一键切换，设置页提供可视化选择，偏好在当前浏览器持久化。
- 成果发布：Artifact Studio 汇总候选稿、已发布稿、待审项与 Evidence 覆盖率；发布/撤回使用 Revision 乐观锁，无 Evidence 或有待审 Source Refresh 时由后端阻止发布。Evidence brief、Decision memo、Review packet 模板只从原始可追溯成果派生，保留 Evidence ID，并在创建时采集真实人工审阅块；已发布成果提供稳定工作区链接和 Markdown/JSON/HTML/PDF 导出。
- 持久 Run：冻结 Space/Source/发布水位与索引发布；Event 使用单调 Cursor，可断线续读。
- T1–T3 验证：Quick 至少 T1、Research 至少 T2；数字、日期、版本和行动前提自动升为 T3。
- 原生多模态：固定 Revision 的 BGE-M3、CLIP 与 CLAP，视频经 FFmpeg 取代表帧、音频按 Locator 解码；模型失败不会写零向量或冒充原生搜索。
- 可恢复运维：Fencing、Checkpoint、幂等命令、Backup Manifest、空数据根 Restore Drill 和索引重建标记。
- Artifact Refresh：Source 更新或 Tombstone 只生成 Proposal/Diff，用户接受后才创建新 Revision，用户编辑块不会被自动覆盖。
- 飞书 IM：长连接、静态 Markdown 富卡片、Space 范围、Quick/Research、图片/音频/视频/文件入库全部复用 Nexus v2；配置见 [飞书说明](docs/FEISHU_BOT_SETUP.md)。

## 一键启动（推荐）

要求 Docker 与 Docker Compose。启动器不会安装系统依赖。

```bash
cp backend/.env.example backend/.env
./start-dev.sh --profile standard
```

访问：

- Web：<http://127.0.0.1:3000>
- API：<http://127.0.0.1:8000/docs>
- MinIO 控制台：<http://127.0.0.1:9001>

`lite`、`standard`、`full` Profile 使用同一权威 Schema；缺少 MinerU、生成 Provider 或原生媒体模型时控制面仍可启动，但健康页与每条 Source Readiness 会明确显示影响。`standard` 包含独立 Control/Index/Scheduler/Feishu 运行单元。未配置生成 Provider 时，系统使用有明确 `degraded` 元数据的确定性抽取式 Gateway，适合本地验证，不冒充 LLM。

### 无 Docker 的本地验证

先安装项目依赖（不会自动下载模型）：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e 'backend[dev,media,agents,tools]'
# 本机直接运行真实 BGE/CLIP/CLAP 时再安装 models extra：
.venv/bin/python -m pip install -e 'backend[models]'
corepack enable
cd frontend && pnpm install && cd ..
./start-dev.sh --local
```

本地模式使用 SQLite、文件对象存储和内存 Qdrant，保持领域契约一致，适合开发与 E2E；生产 Profile 使用 PostgreSQL、MinIO、Qdrant 和 Redis。

需要与已运行的 Compose 环境并行调试时，可覆盖本地端口：

```bash
NEXUS_API_PORT=8100 NEXUS_WEB_PORT=3100 ./start-dev.sh --local
```

## 配置

所有应用变量使用 `NEXUS_` 前缀。关键项见 [backend/.env.example](backend/.env.example)：

- `MINERU_TOKEN`：官方 MinerU Precision API 凭据，是页面布局文档唯一正式 Parser；
  适配器执行签名 URL 上传、异步轮询和结果 ZIP 解析，Token 不进入数据库或普通日志。
- `NEXUS_MINERU_BASE_URL/MODEL/LANGUAGE/TIMEOUT_SECONDS`：MinerU API 行为，默认 `vlm`。
- `NEXUS_GENERATION_ENDPOINT/API_KEY/MODEL`：OpenAI-compatible 生成路由。
- `NEXUS_EMBEDDING_*` / `NEXUS_RERANKER_*`：固定维度 Dense 与 Cross-Encoder 路由。
- `NEXUS_RESEARCH_RUNTIME_ENABLED`：Deep Research Kill Switch。
- `NEXUS_EXTERNAL_TOOLS_ENABLED`：外部 Web/MCP 默认关闭。
- `FEISHU_*` / `NEXUS_FEISHU_REPLY_FORMAT`：可选飞书长连接与 `card|text` 回复。

Provider Secret 只以环境变量或 `env://NAME` 引用保存，数据库不保存明文 Secret。

## 运维命令

```bash
cd backend
../.venv/bin/nexus doctor
../.venv/bin/nexus worker --once
../.venv/bin/nexus reconcile
../.venv/bin/nexus backup ../backups
../.venv/bin/nexus verify-backup ../backups/<backup-id>
../.venv/bin/nexus restore ../backups/<backup-id> \
  --target-database-url sqlite:////empty-root/nexus.db \
  --target-blob-root /empty-root/blobs
```

Restore 只允许写入空数据库和空对象根。Qdrant 默认不进入权威备份；恢复报告标记 `search: rebuild_required`，随后从 PostgreSQL + Blob 重建并 Reconcile。

## 验证

```bash
./scripts/verify-nexus.sh

# Docker Desktop 已运行且已配置真实 Provider 时：
.venv/bin/python scripts/verify-compose-e2e.py --mineru --timeout 1800
```

版本化 Smoke Corpus 位于 `evals/corpus/smoke`，质量门禁位于 `evals/gates`，真实运行报告位于 `evals/reports`。提交的 OpenAPI 合约是 `contracts/openapi/nexus-v1.json`，前端类型通过 `pnpm run generate:api` 生成；统一门禁验证生成结果无 Diff。

## 目录

```text
backend/src/nexus/
  modules/                 # framework-free Domain/Application/Ports
  infrastructure/          # PostgreSQL/Qdrant/MinIO/LangGraph/Provider adapters
  runtime/nexus/           # recoverable Quick/Research harness
  api/                     # REST + Cursor SSE
frontend/src/
  app/ features/ events/   # lazy SPA, server state, durable event client
contracts/openapi/         # committed API contract
evals/                     # corpus, gates and archived reports
```

## 安全边界

- API 默认只绑定 Loopback；数据库、Qdrant 和 Redis 不发布宿主机端口。
- 容器以非 root、`no-new-privileges` 和只读根文件系统运行。
- 外部 Tool 输出是不可信数据，不能扩大 Scope 或直接支持 Claim；首版外部写工具关闭。
- Raw Prompt、完整 Tool Output 和 Secret 不写普通日志。

详细威胁模型见 [SECURITY.md](SECURITY.md)。
