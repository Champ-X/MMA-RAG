# Nexus v2 Implementation Audit

审计基准：`docs/MULTIMODAL_AGENTIC_KNOWLEDGE_BASE_ARCHITECTURE_IMPLEMENTATION.md`<br>
审计日期：2026-07-20<br>
目标版本：2.0.0

## 结论

当前默认运行路径已完成从旧式 Chat/Knowledge/VectorStore 集合向 Nexus v2 的权威控制面重构，并通过真实 `standard` Compose 纵向闭环。PostgreSQL 是唯一业务权威，MinIO 保存不可变 Raw/Derived 对象，Qdrant 是可删除重建的多族投影，Redis/Celery 只负责至少一次协调。Quick、Research、Artifact、MCP、飞书和 Web 复用同一 Domain Service，不存在第二套知识或会话真相。

大规模删除总体合理，但合理性的前提不是“新代码更少”，而是每项产品能力已有替代、旧路径不再持有权威、且替代路径经过端到端验证。本轮 Review 发现并修正了最初重写中的三类真实风险：原生 CLIP/CLAP/BGE 依赖曾退化为代理、飞书实现曾被删而未迁移、索引重建曾在完整投影前切换 Alias。修正后才允许将旧目录标记为已替换。

## WP0–WP9 验收

| WP | 状态 | 实现与证据 |
|---|---|---|
| WP0 质量/契约 | 通过 | 版本化 Gate/Report、五模态 Compose Fixture、OpenAPI 漂移检查、Ruff/Pytest/ESLint/TS/Vitest/Build 统一入口 |
| WP1 运行底座 | 通过 | 固定 Compose 镜像、PostgreSQL 16.4、Qdrant 1.18、MinIO、Redis、OTel、Loopback 端口、非 Root/只读容器、Doctor/Migrate/Backup |
| WP2 权威控制面 | 通过 | Space/Source Version/Evidence/Job/Run/Event/Outbox/Tombstone/Artifact/Model/Tool Schema；Cursor、Idempotency、Fencing、Checkpoint |
| WP3 Model Gateway | 通过 | Provider/Deployment/Observation/Probe/Route、OpenAI/Anthropic/Gemini/Compatible 协议探测、参数治理、Run Snapshot、固定投影 Encoder Manifest |
| WP4 Raw-first Evidence | 通过 | Upload/Markdown/Folder/URL/RSS/Git；文档 MinerU-only；表格、图片、音频、视频 Locator；Raw 先落盘；失败显式 |
| WP5 检索 | 通过 | Exact + 四 Qdrant Family、Dense/Sparse/CLIP/CLAP、真并行通道、RRF、Remote Rerank、Scope PG Hydration、蓝绿 Release、Rebuild/Tombstone |
| WP6 Quick | 通过 | 持久 Run、Quality 默认、Stable Citation、T1–T3 Gate、Cursor SSE、暂停/恢复/取消、SPA 纵向切片 |
| WP7 Research/Tools | 通过 | Recoverable Harness、Plan/Evidence Gain/Safety Fuse、Ledger、T2/T3、Knowledge/Compare/Web/MCP/SQL 只读工具、Sandbox 边界 |
| WP8 Artifact/UI | 通过 | Canonical Block Document、JSON/Markdown/HTML/PDF/CSV/XLSX、乐观并发编辑、Refresh Proposal/Diff/Accept/Reject、用户块保护、全新路由 UI |
| WP9 生产门禁 | 通过 | 真实 Provider 与五模态 E2E、Redis/Qdrant 故障注入、PG+MinIO Backup/空根 Restore、Qdrant 重建策略、OTel Trace、Feishu Auth/Heartbeat |

架构文档明确列为首版之后的 Auto Wiki、完整 GraphRAG、外部写动作和第三方插件安装未被伪装成已交付；其 Port/Tool/Artifact 边界已经保留。

## 旧能力替换矩阵

| 旧能力/路径 | v2 替代 | 删除判断 |
|---|---|---|
| `backend/app/api/chat.py`、内存 Session/StreamManager | 持久 Quick/Research Run、Run Snapshot、Cursor SSE、Checkpoint | 合理；旧请求生命周期不再是任务生命周期 |
| `KnowledgeService`、MinIO 元数据、进程内状态 | PostgreSQL Space/Source/Version/Evidence/Link/Job | 合理；消除多权威和 ID 兼容扫描 |
| 巨型 `VectorStore` 与自动 Collection 管理 | `QdrantEvidenceIndex` 四族 Release/Generation/Manifest | 合理；Qdrant 只作可重建派生面 |
| Dense/BGE-M3/CLIP/CLAP/视频帧 | 固定 Qwen Dense、BGE-M3 Revision、CLIP Revision、CLAP Revision、FFmpeg 帧/音频预处理 | 不删除能力；真实模型已恢复，五模态 Gate 无代理退化 |
| One-pass Retrieval/RRF/Cross-Encoder | 独立通道并行、RRF、远端 Rerank、PG Hydration、Fast/Quality/Deep | 合理；失败和实际质量显式化 |
| ParserFactory/Fallback | Raw-first Router、MinerU Precision API、模态 Parser | 合理；文档失败不再静默伪装成功 |
| `backend/app/integrations/feishu_*` | `infrastructure/feishu/{worker,channel,parser}.py` | 旧代码删除合理，飞书产品渠道未删除 |
| 飞书专属 KB/Session/Pending Attachment | Space 命令、持久 Run、立即 Raw 摄取、Redis 协调 | 合理；不再维护 IM 平行权威 |
| 飞书 Post/CardKit 复杂状态机 | 默认 Markdown 静态富卡片，可切纯文本；Stable Evidence 引用 | 核心展示保留；旧流式卡片/回调是旧 Session UI 绑定，不进入 v2 权威路径 |
| 手写前端 API、四页常驻/hidden、巨型 Message/Knowledge 组件 | OpenAPI 生成类型、TanStack Query、真正路由与懒加载 Feature | 合理；运行/证据/健康状态来自服务端 |
| `static/` 构建产物与静态 OpenAPI | 前端镜像构建产物、`contracts/openapi/nexus-v1.json` | 合理；生成物不应成为源代码或第二份契约 |
| 旧 Provider 单例、Task Route JSON | Catalog/Probe/Route/Governed Gateway | 合理；模型身份、能力和 Fallback 可审计 |
| 热点/外部抓取的隐式写入 | URL/RSS/Git/Folder/News/Image Search Connector + 每日幂等 News 同步任务 + 默认关闭的外部只读 Tool | 能力保留且语义收紧；定时与手动内容都先进入 Raw/Source，不允许绕过证据化 |

## 2026-07-20 旧版功能退化专项复核

这轮复核不是按页面名称做“看起来有”，而是从旧版上传白名单、Parser、Chat、Retrieval、模型路由、热点任务和 KnowledgeList 逐项反查到当前 API、数据库对象、运行时与浏览器结果。发现的真实退化均已修正：

| 复核项 | 结论与恢复结果 |
|---|---|
| PDF/Office 文档图片 | MinerU `content_list` 已锚定图片继续生成页码/BBox Evidence；ZIP 中存在但未被 `content_list` 引用的图片不再只写 ObjectManifest，而是恢复为可引用 `document_image` Evidence，并标注 `parser_asset_without_content_anchor`，避免伪造精确页锚点。 |
| PDF 重解析 | 重解析不再重复插入相同 `object_key` 的派生视觉资产；视觉计数按唯一对象统计。真实 200-chunk PDF 重解析后仍为 13 个视觉资产而不是 26。 |
| PDF/资料查看 | PDF 原件内嵌查看，图片/表格视觉画廊可点击进入 Evidence，展示页码、BBox、SourceVersion、对象键与相邻分块。DOC/DOCX/PPT/PPTX 提供提取后文档阅读器；CSV/XLS/XLSX/XLSM 恢复为 Sheet 标签、表头、单元格网格及可引用 Cell Range。 |
| URL 导入 | 对连接建立、408/425/429/5xx 增加有界重试，且每次重试/重定向继续执行 SSRF 校验、下载上限与超时。异步导入在 Materials 页持续跟踪到终态，不再短暂显示 `stored / 0 evidence` 后停止刷新。 |
| 文件与附件格式 | 上传和问答附件均覆盖旧版清单：PDF、DOC/DOCX、PPT/PPTX、TXT/Markdown、CSV/XLS/XLSX/XLSM、常见图片、音频与视频；附件先形成不可变 SourceVersion，再进入本轮 Run 的冻结 Scope。 |
| 多轮与富媒体回答 | Follow-up 是持久子 Run，保存父子关系、改写结果、检索计划与每轮模型。图片、表格视觉、音频时间段和视频时间段按 Stable Evidence 引用插入正文位置，引用可回到原件锚点。 |
| 检索策略 | 意图识别、上下文查询改写、Exact/Dense/Sparse/原生图像/图像描述/原生音频/音频文本/视频帧/视频文本并行检索、RRF 与独立 Rerank 均有运行事件和测试，不以单路向量结果冒充多路。 |
| Space 路由与画像 | Space portrait、聚类样本、建议问题、自动路由候选和得分均由当前 Evidence 生成；选择结果与当前 SourceVersion 一起冻结进 Run Snapshot。 |
| 模型选择与任务路由 | 问题级模型选择覆盖已登记/可探测 Catalog；Quick、Research、Planning、Verification、Intent、Rewrite、Space Routing、图片、文档插图、视频帧、音频、视频音轨、Embedding、Rerank 分别治理。 |
| 热点定时导入 | 恢复旧版每日热点同步；目标 Space、查询、主题、时间范围、条数、全文开关和 UTC 时刻可配置。Celery Beat 只触发统一 News Connector，外部版本与幂等键保证重复投递不重复建版本。旧 `TAVILY_HOT_TOPICS_*` 配置名继续兼容。 |
| Space/资料视觉 | Space 和材料封面优先使用可引用的首个派生视觉；无图时按模态生成编辑化封面。材料抽屉同时提供原件、视觉、结构化表格/文档阅读和全部分块，不再只有同质占位卡。 |

## 关键可靠性修正

### 索引发布

新 Release 先创建物理 Collection，再按每个 Family 的必需 Vector Role 校验 Evidence 数。投影不完整、Sparse 缺失或原生媒体向量缺失时保持 `building`，旧 Release/物理 Collection 继续服务；全部校验通过后四个 Alias 批量切换，随后 PostgreSQL 将新 Release 标为 `active`、旧 Release 标为 `superseded`。失败/崩溃可从 `building/validated/activating` 状态重入。

API 与 Index Worker 冷启动时可能同时初始化 BGE-M3、CLIP、CLAP。当前实现先在单请求内串行预热查询 Encoder，再通过共享 Hugging Face Cache 上的文件锁跨进程串行加载重量模型，避免 PyTorch 并发初始化导致首次检索的瞬时通道失败；初始化失败仍会按通道显式降级，不会返回伪造向量。

### Source 更新与删除

新 Source Version 成功发布后，旧 Version/Evidence 进入 `superseded` 并固定可见上界；PG Hydration 立即排除，Outbox 驱动 Qdrant 最终删除。全局删除先 Tombstone Source/Version/Evidence、关闭 Link、取消活动 Job、标记 Claim stale，再投递索引删除。Artifact 不自动改写，而是产生持久 Refresh Proposal；接受时只有 Base Revision 仍是当前 Revision 才能创建新 Revision，用户块原样保留。

### 飞书

飞书 worker 启动时先调用官方租户令牌接口验证 App 凭证，认证成功后才发布 Ready 心跳。事件去重与聊天 Scope 映射使用 Redis，但断线会降级到进程内并自动重连；业务对象仍写 PostgreSQL。消息、图片、音频、视频和文件均进入 Nexus Run/Ingestion，不调用已删除的旧 Knowledge/Chat 服务。

## 实测证据

- 仓库门禁：Ruff 通过；后端 90 tests 全部通过；Alembic 空库 0001→0010；OpenAPI/生成 TS Client diff=0；前端 ESLint、TypeScript、20 tests、Production Build 通过。
- Compose E2E：7 Sources、11 Evidence；`text/table/image/audio/video` 五模态；10 个检索通道完成；Projection failures=0、degradations=0；Golden MRR=1.0，五类查询均 Rank@1。
- 原生角色：`visual=12`、`acoustic=4`、`frame_visual=4`，并包含 Dense/Sparse/Caption/Scene 全部必需角色。
- Quick 与 Research 均使用真实配置 Provider 完成 T3；Knowledge Search、只读 SQL、Artifact Revision 2、12 个持久 SSE Event 通过。
- Backup：PostgreSQL custom dump + 14 个 MinIO 对象，Hash 验证通过；恢复到临时空 PostgreSQL/Blob Root 后 Source/Version/Evidence/Run/Artifact 数量与对象一致，Search 明确要求重建。
- Redis 故障：待处理 Job 留在 PG；恢复后重复投递同一 Job，幂等完成。
- Qdrant 故障：Readiness 保持 Control Ready，Exact 继续返回；8 个向量通道显式失败；恢复后 10 个通道完成且无降级。
- 冷启动并发：全新 API/Index Worker 镜像启动后立即触发 g7 全量重建并并发发出首次 Quality 检索；15.48 秒内 10 个通道全部完成、`degraded=false`、目标文档 Rank@1。旧 g6 在构建期间持续服务；g7 对 49 条 Evidence 的全部必需向量角色校验完成后一次性切换四个 Alias，`failures=[]`、`degradations=[]`。
- 重启后 Quick：真实 Celery 执行调用 `Pro/moonshotai/Kimi-K2.5`，返回 PostgreSQL durable work value 88 和 `redis-recovery.md` Stable Evidence 引用；检索 Quality 无降级，Claim 验证为 T3/`supported`。固定 Setup Route 不写 Catalog Probe 表，因此 API 健康页的 `model_gateway=unprobed` 不能替代这条真实执行证据。
- MinerU：官方 API Adapter 合同测试与真实 Compose 调用均通过；真实 PDF 产出文本、表格、锚定图片和未锚定 ZIP 图片恢复 Evidence，且 Raw 始终先保存、失败无语义 Fallback。

机器可读结果见 `evals/reports/nexus-v2.0.0-smoke.json`（初始升级）与 `evals/reports/nexus-v2.0.0-regression-audit.json`（旧版功能退化专项复核）。

## 运维边界

- 默认 Compose 仅向 `127.0.0.1` 暴露 Web/API/MinIO Console；PG/Qdrant/Redis 不发布宿主端口。
- Qdrant 不进入权威备份；灾后由 PG+Blob 重建。该选择已做真实 Restore Drill，不是“假定可恢复”。
- OTel 当前默认输出到本地 Collector debug exporter；需要长期查询时可替换 Collector Exporter，不改变应用 Trace 协议。
- API 进程的模型对象与 Index Worker 的已加载模型是进程隔离的，但首次加载通过共享 Cache 文件锁协调；系统健康的权威索引证据是 Active Manifest、Projection Role Count 与 Worker Heartbeat，不用 API 进程内的 `loaded` 布尔值冒充远端 Worker 状态。
