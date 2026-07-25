# Tessmora Omni-Modal Agentic Retrieval Platform 升级设计

> 调研基线：Tencent/WeKnora `main`，commit
> [`c64a48647cd6f7eb8b0fb020b2e8fec74ee375fb`](https://github.com/Tencent/WeKnora/commit/c64a48647cd6f7eb8b0fb020b2e8fec74ee375fb)，
> 版本 `v0.7.1`，2026-07-24。

## 1. 结论

Tessmora 与 WeKnora 的优势并不重合。

- Tessmora 的护城河是原生多模态数据面：文档、图片、音频、视频各自采用适合该模态的解析单元、命名向量、检索权重与可播放引用，再通过画像路由、RRF 和 Cross-Encoder 汇合。
- WeKnora 更成熟的部分是 Agent 运行时与平台治理：有界 ReAct、分工明确的知识工具、Skills、MCP、人工审批、Wiki、可观测性、权限作用域和后台任务治理。

因此正确升级方式不是替换 Tessmora 的检索器，而是让现有检索器成为 Agent 的第一等只读工具，并逐步补齐精确检索、深读、图谱、Skills、审批、Wiki 和评估体系。

## 2. WeKnora 源码级发现

### 2.1 有界 ReAct，而不是无限“自主”

`internal/agent/engine.go` 把 Agent 明确建模为 `think → analyze → act → observe` 循环：

- `MaxIterations` 限制轮数；
- 支持并行工具调用；
- 检测空响应和重复响应，防止卡死；
- 达到轮数上限时，使用已获得的工具结果强制合成最终回答；
- 请求取消时尽量保留已有步骤和证据；
- Engine 本身跨轮无状态，会话历史由调用方重建。

可借鉴点是“自主性必须被预算、停止条件和降级路径包住”。本项目第一阶段采用相同原则，但只开放现有多模态知识检索这一项只读工具。

### 2.2 检索能力被拆成互补工具

WeKnora 没有把所有信息需求塞进一个笼统的 `search`：

| 工具 | 职责 | 适合问题 |
|---|---|---|
| `knowledge_search` | 语义/向量检索，多查询、重排、MMR | 概念、机制、解释、对比 |
| `grep_chunks` | 数据库侧正则/关键词精确检索 | 实体、编号、错误码、原文定位 |
| `list_knowledge_chunks` | 按文档或 chunk 深读、分页 | 搜索命中后的全文核验 |
| `query_knowledge_graph` | 图关系检索 | 实体关系、多跳问题 |
| `data_analysis` | DuckDB 数据分析 | 表格、统计、聚合 |

`knowledge_search` 还会记录同一会话已返回的 chunk，避免重复把全文塞回上下文，并在重排后用 MMR 控制冗余。这启发了本项目的“证据账本”：跨子查询按 Point ID 去重，重复命中转化为置信增强。

### 2.3 每轮作用域与引用别名是 Agent 安全性的基础

WeKnora 会把当轮绑定的知识库、文档、MCP 和 Skill 写入仅对当前轮有效的 runtime context，并再次校验工具调用是否仍在作用域内。它还用请求级资源注册表把长 ID 压缩为稳定别名，降低 token 成本并避免模型改坏资源引用。

本项目现有的 `kb_id` / `file_id` 过滤和引用 Map 已具备良好基础。Agent 层必须继续复用这些过滤条件，不能允许子查询逸出用户选定的知识库或文件范围。

### 2.4 上下文不是简单截断

WeKnora 同时使用 API usage 与本地估算结合的 token 预算、LLM memory consolidation、超预算后的结构化压缩、工具输出长度上限，以及已见证据的紧凑表示。

本项目当前已有按完整轮次与字符预算的聊天上下文。下一阶段应增加 Agent 工具结果的 token 预算、证据摘要以及“原始证据仍可按 ID 深读”的 Small-to-Big 机制。

### 2.5 Skills 使用渐进式披露

WeKnora 的 Skill 分三级加载：

1. System Prompt 只放名称与简述；
2. 匹配任务后读取 `SKILL.md`；
3. 真正需要时才读取附属资源或在沙箱执行脚本。

这比把全部说明常驻 Prompt 更省 token，也更适合企业把 SOP、报告模板、合规检查、数据分析流程沉淀为可复用能力。

### 2.6 MCP 必须和审批、作用域、沙箱一起设计

WeKnora 的敏感 MCP 工具支持 Human-in-the-loop：Agent 暂停，前端显示参数，用户可修改后批准或拒绝；多实例可通过 Redis Pub/Sub 唤醒。源码中工具注册使用 first-wins，避免同名工具劫持，参数执行前做 Schema 校验，输出做长度限制。

本项目当前阶段只自动执行只读工具。未来引入 MCP 或写操作时，必须先落地：

- `read / write / external_side_effect / destructive` 风险分级；
- 用户、会话、知识库、文件四层作用域；
- 参数 Schema 与服务端再次校验；
- 审批等待状态持久化；
- 网络访问 SSRF 防护、密钥隔离与沙箱；
- 完整审计日志。

### 2.7 Wiki 把知识库从“被查询”推进到“自维护”

WeKnora Wiki Mode 会把原始文档提炼成互链页面，并提供写页、替换、重命名、问题标记、溯源读取等专用 Agent 工具。相关任务具备异步队列、重试、锁、去重、引用追踪和失败恢复，而不是一次 Prompt 生成静态摘要。

这是本项目未来最有价值的边界扩展之一：从检索知识升级到持续整理、发现冲突、标记过期、维护专题页。

### 2.8 可观测性与平台治理决定能否生产化

WeKnora v0.7.1 已把 Agent、LLM、工具、异步任务追踪迁移到 Langfuse OTLP/OTel，并通过 W3C `traceparent` 跨服务传播；同时具备 per-model 并发治理、分阶段 worker pool、失败任务检查与重试、细粒度 API key、每 KB 活动审计。

本项目已有日志、SSE 思考过程和检索 debug info，下一步应把每次 Agent Run 形成统一 Trace：

`request → planner round → tool call → retrieval routes → rerank → context build → generation → citation validation`

## 3. 第一阶段：已实现

### 3.1 三态模式、零退化

- `自动`：根据对比、分步、跨模态、研究深度、问题长度与多文件范围等可解释信号选择执行路径。
- `直接检索`：保持原来的单次 RAG 流程。
- `Agent 深研`：在原流程上增加有界规划与证据收敛。
- 三种选择最终都进入同一 `GenerationService`、`ContextBuilder`、ReferenceMap 和 SSE 引用链。

### 3.2 Agent 运行时

代码位于 `backend/app/modules/agent/`：

- `planner.py`：provider-neutral JSON 决策协议；
- `tools.py`：first-wins 只读工具注册表；
- `service.py`：规划、并发执行、观察、停止与结果合并；
- `models.py`：决策、Trace 与运行结果契约。

默认预算：

| 配置 | 默认值 | 目的 |
|---|---:|---|
| `AGENT_MAX_ROUNDS` | 3 | 限制规划轮数 |
| `AGENT_MAX_QUERIES_PER_ROUND` | 3 | 限制单轮 fan-out |
| `AGENT_MAX_TOTAL_QUERIES` | 6 | 限制总检索成本 |
| `AGENT_MAX_EVIDENCE` | 30 | 限制最终证据池 |

停止原因包括：证据充分、查询预算耗尽、无新查询、无新证据、工具失败、规划器降级和最大轮数。

### 3.3 多模态证据账本

每个子查询仍完整经过：

`One-Pass 意图 → KB 画像路由 → Dense/Sparse/Visual/Audio/Video → RRF → Cross-Encoder`

Agent 对多轮结果执行：

- `content_type + point_id` 去重；
- 记录命中次数、最佳名次和来源检索；
- 重复命中增加有限置信分；
- 合并所有目标 KB 和已选文件模态；
- 取各次检索中更强的 visual/audio/video intent；
- 把所有 Agent 子查询写回 `search_strategies.agent_queries`。

### 3.4 降级保证

- 规划器首次不可用：用原问题执行保底检索；
- 已有证据后规划器失败：停止迭代并基于已有证据生成；
- 子查询部分失败：保留成功结果并把错误写入 Trace；
- 全部工具失败且没有任何证据：明确失败，不伪造回答；
- Agent 模式未传入：后端保持旧行为，兼容已有客户端。

## 4. 后续演进路线

### Phase 2：Evidence Agent

1. **精确检索工具**：BGE Sparse/关键词/正则专路，用于型号、错误码、条款、数字。
2. **文档深读工具**：按 `file_id + chunk_index` 分页，支持邻接窗口与父子块 Small-to-Big。
3. **证据充分度与矛盾检测**：按问题子目标维护 coverage；发现冲突时主动补查并在回答中呈现分歧。
4. **Agent 评测集**：覆盖文本、图、音、视频、跨库、跨模态、冲突和无答案；指标包含工具选择、证据覆盖、引用正确率、成本和延迟。
5. **OpenTelemetry Trace**：每轮 planner/tool/retrieval/rerank 形成可检索 Span。

### Phase 3：Tool & Skill Platform

1. GraphRAG 查询工具和实体关系视图；
2. DuckDB 表格分析工具；
3. Web Search / Fetch 作为显式外部来源，和知识库引用分栏；
4. `SKILL.md` 渐进式披露、白名单与版本管理；
5. MCP Stdio/HTTP/SSE 接入；
6. 风险分级、人工审批、参数修改、超时拒绝、审计与沙箱。

### Phase 4：Living Knowledge Base

1. **Self-maintaining Wiki**：专题页、双向链接、来源追踪；
2. **Knowledge Freshness Agent**：发现过期政策、失效链接和模型版本漂移；
3. **Conflict Watch**：新导入内容与现有结论冲突时创建待处理事项；
4. **Incremental Connectors**：飞书、语雀、Notion、网盘、代码仓库的增量同步；
5. **Knowledge Health Score**：覆盖率、时效性、重复率、孤立内容、解析失败率和检索盲区。

## 5. 能力边界扩展构想

| 能力 | 价值 | 依赖 |
|---|---|---|
| 跨模态时间线 | 把视频 Shot、音频转写、文档事件按时间统一成可跳转时间轴 | 实体/时间抽取、视频引用 |
| 证据地图 | 显示结论由哪些库、文档和模态支撑，哪里仍缺证据 | Evidence ledger、Graph |
| 冲突裁判 | 对政策版本、实验结论、FAQ 冲突做并列证据与差异解释 | 精确检索、版本元数据 |
| 多媒体策展 Agent | 为主题自动挑选海报、配乐、视频片段与解说，并解释选择 | 原生图/音/视频检索 |
| 数据分析 Agent | 从 Excel/CSV 深读到可复现 SQL、统计表与结论 | DuckDB、沙箱 |
| 学习路径生成 | 从知识图谱和媒体素材生成分层课程、测验与复习计划 | Wiki、Skills、Graph |
| 决策档案 | 为复杂决策持续维护假设、证据、反证、风险与更新记录 | Living Wiki、审计 |
| 知识库数字园丁 | 主动发现重复、孤岛、缺引用、过期内容并提出可审批修复 | Health Score、写工具审批 |

## 6. 不应照搬的设计

- 不把 WeKnora 偏文档中心的检索模型替换进 Tessmora 的多模态数据面；
- 不用单一文本 caption 取代 CLIP/CLAP/视频 Shot 专用向量；
- 不在没有审批与沙箱时开放任意脚本、MCP 写操作或网络访问；
- 不把“思考过程”原样暴露给用户，只展示规划摘要、工具、证据数量和可验证结果；
- 不让 Agent 子查询突破用户指定的 KB/File 范围；
- 不用 Wiki 摘要替代原始证据，Wiki 只能作为可追溯的派生知识层。

## 7. 参考源码

- [WeKnora Agent engine](https://github.com/Tencent/WeKnora/tree/main/internal/agent)
- [WeKnora knowledge tools](https://github.com/Tencent/WeKnora/tree/main/internal/agent/tools)
- [Agent Skills](https://github.com/Tencent/WeKnora/blob/main/docs/agent-skills.md)
- [Adaptive chunking](https://github.com/Tencent/WeKnora/blob/main/docs/CHUNKING.md)
- [MCP 人工审批](https://github.com/Tencent/WeKnora/blob/main/docs/zh/mcp-approval.md)
- [WeKnora changelog](https://github.com/Tencent/WeKnora/blob/main/CHANGELOG.md)
