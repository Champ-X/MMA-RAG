# MMA-RAG 产品与能力回归审计

审计日期：2026-07-20<br>
比较对象：`main` 初始版本、当前 Nexus v2、Tencent/WeKnora v0.7.0<br>
方法：源码与 API 逐模块反查、旧版 README/截图对照、旧/新前端并行启动、真实浏览器桌面与 390×844 移动视口走查。

## 1. 结论

当前重构不是整体退化。它在数据正确性、证据可追溯、任务可恢复、多模态原子证据、模型治理和运维安全上明显超过旧版；Space 画像、材料预览、引用锚点和 Artifact 也比旧版更完整。

本轮开始前，真正的回归主要发生在产品入口层：旧版把“聊天、知识库、架构、设置”压缩成四个稳定心智模型，而重构一度把十三个领域/运维对象直接暴露在一级导航；持久 Run 已存在，却缺少用户能发现的会话历史；移动端侧栏没有完整遮罩与关闭路径；本地启动脚本依赖 Bash 4 的 `wait -n`，在 macOS 默认 Bash 3.2 上失败。这些问题会让底层能力更强、首屏感受反而更难用。

本轮已恢复上述高频入口，并把会话从“前端临时聚合”继续升级为服务端长期资产：新增会话历史、全局命令面板、标题/置顶/归档、游标分页与跨轮搜索，同时完成一级/高级导航分层、移动端导航闭环和可配置端口的 macOS 兼容启动器。材料经营也从原始 `ready/pending` 字段升级为来源级健康结果：区分 Raw、Evidence、Projection 三层，连接来源支持手动或持久计划检查上游，快照重解析保持独立语义，并显式展示 changed / no-change 历史。模型治理新增任务导向的推荐配置；知识浏览则新增 Claim Gate 约束的 Verified knowledge，只让 T2/T3 结论进入，同时不隐藏冲突与过期状态。后续工作不应复制 WeKnora 的页面，而应吸收其“任务优先、渐进披露、状态可解释、批量操作就地出现”的产品模式。

## 2. 分模块能力对比

| 模块 | 旧版优势或精心细节 | 当前实现 | 判断 | 下一步增强 |
|---|---|---|---|---|
| 原始资料与解析 | 文件白名单直观；文档内图片、音频、视频都有专门链路 | Raw-first、SourceVersion、不可变 Evidence、Locator、失败显式；支持文件/文件夹/URL/RSS/Git/新闻/图片搜索；来源健康与连接刷新可操作 | 当前显著更强 | 下一步增加导入前质量预检与受 Manifest 约束的结构策略，不让高级字段成为使用前提 |
| 知识库/Space | 知识库 CRUD 和画像路由概念简单，中文说明清楚 | Space、Collection、画像聚类、建议问题、来源封面、就绪度、冻结范围，以及只编译 T2/T3 Claim 的 Verified knowledge | 能力提升；可信知识浏览显著更强，命名仍有学习成本 | 继续补时间线/关系图与可访问的概念内联解释，不把生成文本自动升级为事实 |
| 检索 | One-pass 意图、Dense/Sparse/Visual、RRF+Rerank 的路径集中，思考链可见 | Exact、Dense、Sparse、原生图像/音频/视频与文本代理通道独立；失败/降级可观察；Fast/Quality/Deep | 当前显著更强 | 把技术通道状态翻译成用户语言；给出“为何找不到/为何回退”的结果级说明 |
| 对话与多轮 | 默认首页即对话，模型/文件/附件触手可及；Thinking Capsule 和引用悬浮形成强反馈 | Quick/Research、持久 Run、父子轮次、冻结 Scope、暂停/恢复/取消和引用详情更可靠 | 底层与长期经营能力提升；会话内侧栏仍可增强 | 已补服务端会话资产、跨轮搜索、重命名/置顶/归档和全局定位；下一步补消息/Evidence 语义检索与会话内侧栏 |
| 引用与多模态回答 | 引用编号、上下文窗口、图片灯箱、播放器直观 | Claim–Evidence、页码/BBox/Cell/时间段锚点、原件/派生视觉、内联媒体、相邻证据 | 当前显著更强 | 结果页默认展示简洁“答案+证据”，把 Trace 放入可展开的专家视图 |
| 长任务/Agent | 旧版更像单轮流式生成，状态依赖进程 | 持久 Event、Checkpoint、Ledger、安全熔断、部分结果、Artifact | 当前显著更强 | 增加面向用户的阶段进度、预计下一步、恢复原因和部分交付提示 |
| 模型与路由 | 设置入口少、任务路由集中 | Provider/Catalog/Probe/Route/Snapshot 分层治理；默认页按五类用户任务给出安全推荐与一键补齐 | 底层明显更强，工程细节已收入渐进披露 | 继续补实际 Provider 可用区域、成本/速度证据与路由比较，不用名称推断 |
| 数据源持续同步 | 文件、URL、热点和飞书已具备 | 统一 Connector、外部版本、幂等同步、RSS/Git/Folder/News/Image Search、飞书共用领域路径；保存无密钥 Sync Contract，支持持久同步计划、租约抢占、changed/no-change 执行历史和来源健康 | 当前显著更强；持续经营第一阶段已完成 | 增加内容级差异预览、重新授权和来源集合级聚合历史 |
| 成果复用 | 旧版主要输出聊天回答 | Canonical Artifact、多格式导出、Revision、Refresh Proposal、显式发布/撤回、稳定工作区链接、覆盖率与待审筛选 | 当前显著更强 | 下一步增加可复用模板与受权限控制的外部分享 |
| 运维与恢复 | 开发启动直观，但状态多在内存或服务日志 | PostgreSQL 权威、Backup/Restore Drill、Fencing、Tombstone、Reconcile | 当前显著更强 | 本轮修复 macOS 本地启动；后续做首次配置诊断和错误修复建议 |

## 3. 用户体验与视觉对比

### 3.1 已确认的体验退化

1. **信息架构过载**：十三个一级入口同时出现，用户必须理解 Agents、Tools、Models、System、Backups 等实现对象，才能找到常用任务。
2. **会话不可发现**：持久 Run 和 conversation API 已存在，但没有独立历史入口，用户只能通过首页最近项或已知 URL 返回任务。
3. **全局定位成本高**：Space、会话和操作分散；旧版入口少尚可承受，重构后没有同步增加全局查找。
4. **移动端导航不闭环**：窄屏侧栏需要清晰遮罩、Esc/点击关闭和路由后收起。
5. **本地启动在 macOS 失败**：默认 Bash 3.2 不支持 `wait -n`，与 README 的 macOS 支持承诺冲突。
6. **语言与术语门槛**：旧版中文界面对中文用户更直接；当前全英文且使用 Evidence、Run、Artifact 等领域术语。
7. **专家信息抢占结果**：当前 Trace、Scope、模型和证据状态很完整，但需要继续按“结论 → 依据 → 执行细节”做渐进披露。
8. **个性化能力退化**：本轮前当前版丢失了旧版主题切换；现已恢复 Light / Dark / System，并增加侧栏快捷切换、OS 实时跟随和完整暗色视觉检查。

### 3.2 当前已优于旧版的展示

- Space 卡片使用真实派生视觉或按模态生成的编辑化封面，不再全是同质占位图。
- Space 概览同时展示画像、聚类、推荐问题、Collection、材料和就绪状态，知识范围更容易被理解。
- 材料支持卡片/列表切换、批量重解析/删除、原件预览、视觉画廊、结构化表格/文档阅读器和 Evidence 账本。
- 材料总览直接汇总可搜索、完全就绪、需处理、处理中和仅精确搜索数量；每张卡及详情抽屉说明 Raw/Evidence/Projection 三层状态，并提供与原因匹配的操作。
- 引用可以返回 PDF 页码/BBox、表格 Cell Range、音视频时间段，并显示相邻证据；这比旧版的文档级引用更可信。
- Quick 与 Research 共用同一个会话工作台，任务状态、冻结范围、模型和引用不会在刷新或重启后丢失。
- 空项目不再同时抛出所有概念；首次使用只引导 Space、Source 和有引用 Run，并可从侧栏恢复。Space / Source / Evidence / Run / Artifact 的中英解释在全局术语抽屉内随时可查。
- Light / Dark / System 不再只是一个不生效的选项；暗色主题保留“纸张、台账、暗色控制面”层级，表单、证据阅读、材料导入、模型向导和诊断 JSON 都有专门的低眩光表面。
- Artifact Studio 不再只是导出文件列表：卡片直接显示发布状态、块级 Evidence 覆盖率和待审原因；成果页呈现发布就绪度、表格、用户编辑块和可点击 Evidence Register。
- Space 新增 Verified knowledge：Supported、Partially supported、Conflicted、Stale Claim 可浏览筛选；T0/T1 假设不进入页面，所有条目保留 Run 与 Evidence Revision 直达链接。

## 4. WeKnora 设计吸收矩阵

| WeKnora 模式 | 价值 | MMA-RAG 的应用方式 | 状态 |
|---|---|---|---|
| 全局命令面板 | 在功能增长后仍能快速找知识库、会话、证据和动作 | `⌘/Ctrl+K` 搜索目的地、Spaces、服务端会话与全部已发布 Evidence；会话命中任意一轮问题，Evidence 命中正文/来源并直达 Locator；方向键、Enter、Esc、焦点环 | 第一阶段完成；后续可在有稳定索引时叠加语义召回 |
| 会话搜索与置顶 | 把“做过的工作”变成可恢复资产 | 独立 Conversation 聚合保存标题、置顶、归档、Revision 与活动时间；搜索、分页和排序均由服务端执行 | 已完成；旧 localStorage 置顶会一次性迁移 |
| 文档卡片/列表与浮动批量栏 | 浏览和管理两种任务不互相牺牲 | 当前 Materials 已有卡片/列表、选择、批量重解析和删除 | 已吸收 |
| 每库解析/索引策略 | 不同资料使用不同结构策略 | 先映射为有真实运行语义的 Space 使用策略：自动路由资格、意图加权、默认 Quick/Research 与 Fast/Quality/Deep；继续保留 Evidence/Release 可审计边界 | 第一阶段完成；后续只增加受 Projection Manifest 约束的结构策略 |
| Pipeline 状态和无结果原因 | 用户能区分“没有知识”和“能力未配置/已降级” | 复用 Channel Event、Readiness、Projection failure，转换为结果级和来源级解释；材料可直达重试、时间线、上游检查或原文重解析 | 已完成第一轮结果与来源闭环 |
| Wiki 浏览与知识图谱 | 从问答升级为可浏览知识 | Verified knowledge 只从 T2/T3 Claim 编译，支持 Supported / Needs review 筛选，保留来源、陈旧和冲突状态并直达 Run/Locator；不把生成文本直接当真相 | 第一阶段 Claim ledger 已完成；后续补时间线和关系图 |
| 后续问题建议 | 降低下一轮提问成本 | 空会话由 Space 画像提供起始问题；回答后从本轮冻结 Evidence Ledger 生成未展开证据、跨来源比较与引用深挖问题 | 已完成；每条建议展示来源理由且可编辑后发送 |
| 数据源配置中心 | 持续同步能力可运营 | Materials 汇总 Connector、来源健康、失败重试、精确任务时间线和手动/定时上游检查；频率、暂停/恢复、下次检查和 changed/no-change 历史均在材料详情就地经营 | 持续同步第一阶段完成；后续补内容级差异与重新授权 |
| 推荐默认值与高级配置分层 | 新用户先完成任务，专家仍能审查具体选择 | Models 默认进入 Recommended setup；Provider、Catalog 和 Task routes 保留为同级高级视图，每个任务决策可展开检查 | 已完成第一阶段；只使用已验证能力 |
| 首次任务向导与概念解释 | 空状态不是文档链接，而是可直接完成的产品路径 | 首页按真实服务端状态推进 Space → Source → cited Run；全局双语术语抽屉解释知识流转 | 第一阶段完成；引导可跳过、可恢复 |
| 发布前质量门 | 成果不是生成完成就自动成为正式知识 | 用权威 Artifact 状态、Revision CAS、Evidence 覆盖率与 Source Refresh 阻断构成显式发布门；Studio 用筛选和摘要将风险前置 | 第一阶段完成；后续补模板与权限分享 |

## 5. 本轮实现

### 5.1 会话历史

- 新增权威 `Conversation` 聚合与 `20260720_0009` 迁移：历史 Run 自动回填首问标题、创建时间与最后活动时间，新 Run 创建/状态变化会更新对应会话，不修改冻结 Run。
- `/conversations` 支持标题与任意一轮问题搜索、Active/Archived 筛选、稳定游标分页，以及“置顶优先、活动时间倒序”的跨设备排序；不再受客户端最多 200 条 Run 的截断影响。
- `GET/PATCH /conversations/{id}` 提供标题、置顶、归档和 Revision；更新使用 `expected_revision`，多窗口/多设备并发修改不会静默覆盖。
- 从旧结果页继续已归档会话时，新 Run 会把会话自动恢复到 Active 并递增 Revision，正在进行的工作不会隐藏在归档筛选中。
- 历史页展示轮数、Space 范围、引用数、最新状态和活动时间，支持 `/` 聚焦、内联重命名、置顶、归档/恢复与加载更早会话；旧 localStorage 置顶会一次性迁移到服务端。
- 全局命令面板复用服务端会话搜索，因此即使用户已经改过标题，仍能用较早轮次的问题找到该会话。

### 5.2 全局命令面板与导航

- 一级导航收敛为 Workspace、Knowledge、Outputs；工程和运维入口折叠到 Advanced。
- `⌘/Ctrl+K` 搜索常用操作、Space 和最近会话，支持完整键盘操作。
- 命令面板锁定背景滚动，并用焦点环防止键盘焦点逃出 Dialog。
- 移动端增加遮罩、路由后自动关闭、Esc 关闭和 390px 视口布局。

### 5.3 本地开发体验

- 去除 Bash 4 专属的 `wait -n`，兼容 macOS 默认 Bash 3.2。
- 子进程退出时可靠清理 API/Web 进程。
- 支持 `NEXUS_API_PORT`、`NEXUS_WEB_PORT` 和 `VITE_API_PROXY_TARGET`，可在已有 Compose 环境旁启动隔离实例。
- 启动前显式检查 Node、pnpm 和 Python 环境，错误更早、更可操作。

### 5.4 结果页渐进披露

- 将事件流归并为“范围冻结、理解问题、研究计划、检索证据、核验结论、交付结果”五到六个用户阶段。
- 默认显示当前阶段、持久性说明、检索轮次和完成通道数；降级时直接说明使用了回退及原因。
- 原始事件、查询改写和研究子计划保留在可展开的 Execution details 中，不损失专家可观察性。

### 5.5 可行动的检索结果解释

- 后端基于冻结范围内的已发布 Evidence 数、索引候选数和通道终态生成稳定 Explanation，不由前端猜测失败原因。
- 明确区分：正常命中、降级命中、空范围、全部检索不可用、部分通道失败、索引候选与冻结范围不一致、正常但无相关证据。
- 向量或媒体通道失败时不再把零命中表述为“知识库没有答案”，而是提示搜索不完整并引导到系统状态或重试。
- 结果页展示范围 Evidence 数、完成通道数和与原因匹配的下一步；真实空 Space 的桌面、390px 移动端与“添加资料”跳转均已验证。

### 5.6 Space 使用策略

- 将原本几乎只是标签的 `searchable / multimodal / research / archive` 变为四个有实际运行语义的模板：Balanced search、Multimodal discovery、Deep research、Reference archive。
- 策略控制 Space 创建时的默认检索质量、推荐 Quick/Research 类型、自动路由资格，以及图像/音视频意图和研究意图的可解释加权；Archive 明确只允许手动选定，不再被自动路由误选。
- 发起 Run 时根据冻结的 Space 范围合并策略，并把策略快照写入 `request_context.scope_policy`；未显式指定执行参数的 REST/飞书请求会使用策略默认值，重放时不会受后来配置变化影响。
- 创建 Space 界面不再暴露抽象枚举，而是展示四张“使用契约”卡；Space 卡片、概览页与提问页显示当前策略、路由方式和建议执行深度。用户主动改过 Quick/Research 或检索深度时，手动选择优先于建议。
- 没有照搬任意“每库向量维度/Encoder/自由切块”配置。Source 是全局共享对象、Evidence Revision 不可变；在没有独立 per-link Projection 版本模型前，伪造逐 Space 切分旋钮会导致同一原件在不同 Space 中出现不可审计的身份分叉。

### 5.7 从证据继续追问

- 旧版推荐问题只出现在空会话开场，并依赖当前知识库画像/文件或一次额外 LLM 生成；当前版此前虽然有 Space 起始问题，但回答完成后没有低成本的下一步入口。
- 新增 `/runs/{id}/suggested-questions`，只读取该 Run 的不可变 Evidence Ledger 和引用账本，不进行第二次不透明生成。即使本地没有生成 Provider，建议仍稳定可用。
- 建议分为“检索到但本轮未展开”“跨独立来源比较”“原生媒体深挖”“引用细节核查”；每条都携带触发它的 Evidence ID、来源名称与模态，且显示冻结发布水位。
- Source 后续产生新 Revision 时，旧 Run 的建议继续引用旧 Ledger 中的 Revision，不会被当前知识内容悄悄重写；对应稳定性已有端到端测试。
- 结果页把三条建议放在追问编辑器上方，点击只填入可编辑问题，不会未经确认立即运行昂贵任务。

### 5.8 来源健康与连接刷新

- `SourceVersion` 现在返回最近 Ingestion Job、每项 Capability 细节、投影覆盖率、Sync Contract 摘要和稳定的来源健康结果；UI 不再用单个 `ready/pending` 猜测整条材料是否可用。
- 健康判定区分处理中、刷新失败但旧证据仍可搜索、完全失败、能力部分退化、高级投影未完成、仅精确 Evidence 搜索和完全就绪；每种结果携带可执行的下一步。
- Connector 在首次同步时保存无密钥的可复用契约。URL 只检查单一来源；RSS、Folder、Git、News 与 Image Search 明确标记为来源集合刷新，避免用户以为只会修改当前卡片。
- 新增 `POST /spaces/{space_id}/sources/{source_id}/sync` 检查上游并按外部版本/内容哈希幂等生成新 SourceVersion；“Reparse stored original”仍只解析保留的 Raw，两种操作在文案、API 和任务记录上完全分离。
- Qdrant Release 激活后会把解析阶段的 `text/image/visual/acoustic/frame` 投影能力从永久 `pending` 收敛到 `ready / not_configured / failed`，并记录 Release 与实际 Vector Role。
- Materials 增加健康汇总带、卡片级原因和就地动作；详情抽屉以 Raw → Evidence → Projection 三层展示，并可精确打开最近 Job。上游生成 v2/v3 后，证据缓存会同步失效，不再出现“版本已更新、Evidence 仍是旧内容”。
- 来源列表健康数据使用固定批量查询而非随来源数量线性增长的 N+1；测试用 6 条来源约束请求 SQL 数不超过 12。
- 真实浏览器已验证：桌面卡片/详情、上游 v1→v2→v3、证据与 Job ID 同步更新、带 `?job=` 的时间线精确选中，以及 390×844 下无横向溢出。

### 5.9 任务导向的模型推荐配置

- 新增 `GET /model-setup` 和 `POST /model-setup/apply`，把 14 个受治理 Runtime Role 翻译为回答与研究、知识导航、视觉理解、音频理解和检索质量五类用户任务。
- 推荐只从 `enabled` 且具有对应 `verified_capabilities` 的部署中产生；模型名称推断和未通过探测的声明能力都不能开启真实路由。
- 选择规则稳定可审计：显式 Runtime Role 匹配优先，其次是受管 Provider，再选验证能力集最窄的部署，最后用 Model ID 保证确定性。
- 一键应用只创建缺失路由，默认不替换任何活跃自定义选择，并且幂等；对没有音频、Embedding 或 Rerank 候选的任务，界面保留明确 fallback，不冒充完全就绪。
- Models 一级入口默认指向 Recommended setup，用三个检查点展示“连接凭据 → 验证能力 → 路由任务”；Provider、Catalog 和 Task routes 作为渐进披露保留。
- 真实浏览器已验证：用一个文本模型、一个视觉模型和预存自定义 Quick 路由，从 1/14 一键补齐到 10/14；预存路由 ID 不变，4 个无候选任务保持 fallback，390×844 无横向溢出。

### 5.10 首次有引用回答与中英术语层

- 首页新增三步引导：创建聚焦的 Space、添加保留 Raw 的原始材料、发起并检查首次有引用回答。进度来自实际 Space 数、Source 数与包含 Citation 的 Run，不使用只看过页面的虚假 checklist。
- 引导可跳过，且侧栏始终保留 Getting started 入口；显式 `?guide=1` 能跨越本地隐藏偏好重新打开，不需清理浏览器数据。
- 空项目首页主操作从会立刻遇到阻塞的“Start research”切换为“Create first Space”；有 Space 后再恢复研究入口。
- 全局 Concept guide 为 Space / 知识空间、Source / 原始材料、Evidence / 可引用证据、Run / 可恢复任务和 Artifact / 可复用成果提供双语产品定义，同时展示 Source → Evidence → Claim → Artifact 的知识流转。
- 术语抽屉带背景滚动锁定、初始焦点、Tab 焦点环和 Esc 关闭；不会为了中文层破坏 API/URL 中的稳定英文概念。
- 真实浏览器已验证：空项目显示 0/3，跳过后可从侧栏恢复，用 UI 创建 Space 后自动进入 1/3 并直达该 Space 的 Materials；桌面和 390×844 的引导/术语抽屉均无横向溢出。

### 5.11 外观偏好与低眩光暗色阅读

- 恢复旧版 `light / dark / system` 三态主题契约，默认跟随系统；System 模式监听 `prefers-color-scheme` 变化，不需刷新。
- 选择保存在当前浏览器，设置页用可视化预览选择 Light / Dark / System；侧栏 Theme 快捷键可在当前解析主题间一步切换。
- 主题使用语义变量重建画布、纸张、线条、文本、品牌色和状态色；暗色不是全局反色，仍保留编辑化层级和状态对比。
- 重点补齐了原本硬编码浅色的结果纸张、Artifact、表单、Materials Connector、Source Reader/Table、模型推荐、会话台账、进度和诊断 JSON；状态色也有暗色专用对比。
- Start / Terms / Theme 压缩为三列快捷区，和全局搜索分开，避免恢复主题后反而挤压 Advanced 导航。
- 真实浏览器已验证：暗色设置、首页引导、Space 卡、Materials 导入台和 Models 推荐页；侧栏切换后立即回到 Light，刷新仍保持 Dark，390×844 设置页无横向溢出。

### 5.12 Artifact 发布就绪度与成果经营

- Artifact 响应新增块级 Coverage：内容块总数、带 Evidence 的块数、覆盖率、权威 Evidence 数与用户编辑块数；列表通过批量 Revision/Refresh 查询提供这些字段，没有按卡片触发 N+1。
- 新增 Revision-safe 的 `candidate ↔ published` 生命周期接口。发布使用 `expected_revision_no` 防并发覆盖；无 Evidence 支持或仍有待审 Source Refresh Proposal 时由后端拒绝，不依赖前端按钮猜测。
- Studio 增加候选/发布/待审汇总、平均覆盖率、搜索与状态筛选；每张卡说明发布就绪度、Revision 与 Evidence 绑定数，成果经营不再需要逐个打开 JSON。
- 成果页按“发布决策 → 覆盖率与风险 → 版本元数据 → 正文”组织；候选稿可显式发布，已发布稿可复制稳定工作区链接或撤回为草稿。高级 Canonical JSON 编辑仍保留，但明确说明保存会创建新 Revision 并回到 Candidate。
- 页面补回 Canonical Table 渲染、Markdown 段落、用户编辑块标记、可点击的段落 Evidence Binding 与 Evidence Register；Markdown、Canonical JSON、HTML 和 PDF 收入单一 Export 菜单。
- 真实浏览器已用完整覆盖、部分覆盖和无证据三种数据验证：部分覆盖发布/复制链接/撤回闭环，无证据稿发布禁用，Studio 搜索/待审筛选，桌面 Light/Dark 与 390×844 均无横向溢出。
- Artifact Studio 新增 Evidence brief、Decision memo 和 Review packet 三种服务端权威模板。模板只重排原始 Artifact 的现有内容，复用同一组 Evidence Revision ID，不调用生成模型、不改写来源，也不允许从已派生模板递归套模板。
- Decision memo / Review packet 在创建时要求用户填写真实决策或审阅文字；该块以 `origin=user` 保存。系统占位提示不会进入正文、不会伪装成用户输入，来源 Artifact 保持不变。
- 无 Evidence、待审 Source Refresh 或模板派生稿不能作为模板来源；服务端和 UI 使用同一资格条件。真实浏览器验证了选择布局、人工块必填、派生 Decision memo 的 50% 覆盖率与 Evidence 保留，以及 Light/Dark、390×844 无横向溢出。

### 5.13 跨资产全局搜索与 Evidence 直达

- `GET /evidence` 新增服务端 `query`，在全部已发布 Evidence 的正文、规范化 `searchable_text` 与 Source 名称上执行不区分大小写的字面检索；`%`、`_` 和反斜杠均转义，不会变成 SQL 通配符。
- Evidence Browser 从“只过滤前端已加载的 50 条”改为服务端全目录搜索，同时保留 Space、Source、Modality 与游标契约；搜索结果继续打开稳定 Evidence Revision 和精确 Locator。
- 全局命令面板在输入至少两个字符后并行查询跨轮会话与 Evidence，结果明确标记资产类型、来源、模态和 Evidence 类型；Enter 或点击直接进入 `/runs/browser/evidence/{revision_id}`。
- 移动端顶栏原来的放大镜实际指向 New Research，图标与行为不一致。本轮将其改为直接打开全局搜索；Ask / Research 仍保留在主导航，不牺牲创建入口。
- 真实浏览器已验证：搜索 `Cobalt` 返回唯一 Evidence，Enter 打开 char-range 0–90；Evidence Browser 搜索跨目录正文返回同一 Revision；390×844 命令面板无横向溢出且长文本正确截断。

### 5.14 Claim Gate 约束的 Verified knowledge

- 新增 `GET /spaces/{space_id}/knowledge`，只查询当前 Space 活跃 Source 绑定所支撑、且验证级别为 T2/T3 的 Claim；T0/T1 即便状态被误标为 Supported 也不会进入知识视图。
- 状态筛选由服务端执行：Supported 作为可用结论；Partially supported、Conflicted、Stale 汇入 Needs review。风险不会因默认排序或前端裁剪被隐藏，列表使用 UUIDv7 稳定游标分页。
- Claim 批量携带 Evidence Revision、Source 名称、模态、Evidence 类型、Locator 类型、关系和 Support score；页面可一键进入精确 Evidence Locator 或 originating Run，不新增一份脱离来源的“Wiki 真相”。
- Space 概览新增明确入口；知识页用 Claim Gate 说明、已加载 Claim/Supported/需复核/来源摘要、状态色与编辑化 Claim 卡片建立浏览层级。空状态直接引导发起该 Space 的研究。
- 服务端测试验证 T1 排除、T2 冲突保留、T2/T3 约束和 Needs review 筛选；真实浏览器验证入口、筛选、Evidence 字符定位、低可信内容排除、Light/Dark 以及 390×844 无横向溢出。

### 5.15 持久计划同步与可见版本检查历史

- 新增 Space–Source 级 `SourceSyncSchedule` 与追加式 `SourceSyncExecution`。频率、启停、下次/上次执行、错误和 Revision 由服务端权威保存；配置更新使用 `expected_revision`，多窗口不会静默覆盖。
- 手动“检查上游”和计划任务复用同一无密钥 Sync Contract 与 Connector 幂等路径。执行前后比较当前 Source Version：上游未变化记为 `no_change` 且不制造重复版本，变化记为 `changed` 并保留新 Version 和 Job ID。
- 本地 inline worker 与生产 Celery 都使用有期限租约抢占到期计划；同一计划处于 queued/running 时不会重复执行，失败会释放租约、记录错误并推进下一次尝试，不依赖浏览器保持打开。
- Materials 卡片显示 `auto · every …`；详情抽屉把频率、下次检查、暂停/恢复、最近手动/定时结果和 Timeline 入口收在 Upstream automation 中。快照材料不展示伪自动化入口。
- 服务端覆盖乐观锁、changed/no-change、未来时间抢占、重复执行抑制和快照拒绝；真实浏览器用可变本地上游验证 6h→12h 保存、暂停/恢复、历史与任务直达，以及桌面 Light/Dark、390px 无横向溢出。

## 6. 后续优先级与验收标准

### P0：让强能力在结果页可理解

- 将 Run Trace 默认折叠为 4–6 个用户阶段：理解问题、选择范围、检索证据、核验、生成结果、完成/部分完成。
- 对空结果、降级和失败分别显示原因与下一步，不使用同一个“无结果”空状态。（第一阶段已完成）
- 验收：非开发用户能在 30 秒内回答“系统正在做什么、用了哪些资料、为什么可信、失败后怎么办”。

### P1：把会话与知识变成可经营资产

- 会话标题、置顶、归档、Revision、游标分页、跨轮问题搜索，以及 Evidence 正文/来源全局检索已完成；下一步在有稳定索引时叠加语义召回，并补会话内侧栏。
- Space 使用策略、来源健康和手动/计划同步第一阶段已完成；后续补受 Manifest 约束的结构解析模板、标签筛选、内容级版本差异与重新授权。
- Claim Gate 约束的 Verified knowledge 第一阶段已完成，明确“已验证、冲突、部分支持、过期”并保留证据直达；下一步补跨 Claim 时间线/关系图与 Evidence 不足的研究入口。
- 验收：2000+ 会话和 1000+ 来源时仍可通过搜索、筛选和批量操作在三步内定位。

### P2：完成产品化收口

- 中英双语术语层、首次使用向导和 Light / Dark / System 主题已完成第一阶段。
- 模型“推荐配置”第一阶段已完成：默认任务视图、安全一键补齐和可展开决策；后续只在有可验证数据时增加成本/速度比较。
- Artifact 模板、发布/撤回、工作区链接、成果库筛选与引用覆盖率摘要已完成第一阶段；下一步补受权限控制的外部分享。
- 验收：新用户从空库到首个有引用答案无需阅读架构文档，高级能力保持可发现但不抢占主流程。

## 7. 不采用的照搬方案

- 不把自动 Wiki 生成内容直接写成事实；必须经过 Claim–Evidence Gate，并可回溯到原始证据。
- 不允许每个知识库任意修改底层向量维度或 Encoder；策略可以模板化，但 Projection Manifest 必须固定、可重建、可审计。
- 不用“长思考文本”冒充可恢复 Agent；任务可靠性仍由持久 Event、Checkpoint、幂等、Fencing 和部分交付保证。
- 不把所有高级能力重新塞回一级导航；功能增长必须配合搜索、渐进披露和基于任务的信息架构。
