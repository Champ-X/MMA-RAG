# MMA-RAG 升级方案：从多模态 RAG 到 Multi-Modal Agentic Knowledge Base

> 基于对 `feat/agentic` 分支的深度阅读，以及 Tencent/WeKnora、RAGFlow、LangGraph、ColPali、GraphRAG、Self-RAG/CRAG 等参考项目的横向调研，形成本升级方案。核心原则：**不损失既有多模态与检索能力**、**以能力砖块的方式增量重构**、**用 Agent 循环把已有"局部智能"串联成整体智能**。

---

## 一、当前状态快照

`feat/agentic` 分支已经具备的能力（属于业界中上水位）：

- **五路并行混合检索**：Dense(Qwen3-Embedding-8B) + Sparse(BGE-M3) + Visual(CLIP) + Audio(CLAP) + Video(Shot+Keyframe)，`search_engine.py::HybridSearchEngine` 用 RRF 融合，`reranker.py` 用 Cross-Encoder 精排 [[1]](https://github.com/Tencent/WeKnora)。
- **KB 画像 + 语义路由**：`knowledge/portraits.py` 用 K-Means 生成画像，`router.py` 做在线跨库路由。
- **Agentic Chunker**：`splitters/agentic.py` 用 LLM 只输出 unit_id 计划、服务端无损物化，是分支主要贡献。
- **One-Pass Intent**：`processors/intent.py` 单次 LLM 调用同时产出改写/关键词/多视角/三档视听意图。
- **完整多模态摄取**：MinerU 云 → 本地 → PaddleOCR-VL → PyMuPDF 阶梯降级，Office→PDF、视频 Scene-Shot-ASR。

但同时存在的**关键缺口**：

1. 分支名叫 agentic，但**没有真正的 Agent 循环**——检索是一次性 pipeline，没有"检索→评估→追问→复检"的反思闭环。
2. RRF 权重、Rerank 融合系数(0.7/0.3)、路由阈值(0.08/0.3) **硬编码**，调参需改代码。
3. **多模态配额不对称**：Rerank 仅对图片做隐式增强配额，音/视频未覆盖。
4. **无 tool router / function-calling 编排**：检索通道之间是"并行全跑"，不是"Agent 挑着调"。
5. **无长期记忆、无子问题分解、无引用回跳可视化**、会话与检索统计放在**进程内 dict**（`api/chat.py::sessions`、`RetrievalService._retrieval_stats`）。
6. **视频 pipeline 强绑 dashscope/Qwen-Omni 单一供应商**，无解析层降级。
7. **无长期驻留的评估回路**，改动难以量化。

---

## 二、升级总体思路

沿三个维度做叠加式升级，遵循**"能力砖块 + 显式状态图 + 可观测评估"**的组合拳：

- **纵向增强**：把已有的 5 个检索通道、1 个 chunker、1 个 intent、1 个 router，全部升级为可组合、可观测、可配置的能力砖块。
- **横向 Agent 化**：把这些砖块作为 Tool，用 LangGraph 风格的**显式有状态图**串起来，实现 Plan-Retrieve-Critic-Refine 闭环。
- **能力外扩**：叠加 ColPali 视觉页检索、GraphRAG 社区图谱、跨模态引用溯源、主动澄清、Wiki 反哺、MCP 工具融合等新砖块。

设计原则：

| 原则 | 落地要求 |
|---|---|
| **不损失既有能力** | 现有五路检索、Agentic Chunker、KB 路由保持默认路径可用；新能力以 feature flag 开关灰度接入 |
| **可插拔** | 检索通道、解析器、Chunker、Rerank、Agent 节点全部走注册中心；配置替代硬编码 |
| **可观测** | 所有 Agent 步骤/工具调用/token 走统一 tracing（Langfuse 或本地实现） |
| **可评估** | 内建 golden set + RAGAS/命中率回归，改动前后必须过阈值 |
| **多模态一等公民** | 引用、Rerank 配额、Agent 决策都同时覆盖 text/image/audio/video/table |

---

## 三、目标架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       API / SSE (chat, upload, kb)              │
├─────────────────────────────────────────────────────────────────┤
│                    Agent Runtime (LangGraph-style)              │
│   Planner ─▶ Router ─▶ Retriever ─▶ Grader ─▶ Reflector ─▶ Gen │
│      ▲          │          │           │           │            │
│      └── Memory (short/long-term) ────┴───── Trace/Eval ────────│
├─────────────────────────────────────────────────────────────────┤
│                     Tool Registry (MCP-compatible)              │
│  KBRouter │ TextRetrieve │ VisualPage(ColPali) │ Audio │ Video  │
│  TableSQL │ GraphRAG-Local │ GraphRAG-Global │ WebSearch │ ...  │
├─────────────────────────────────────────────────────────────────┤
│                     Capability Bricks                           │
│  Parsers(DeepDoc) │ AdaptiveChunker+ParentChild │ Embeddings    │
│  VectorStore(Qdrant+Named) │ Rerank(CE+Quota) │ KGBuilder      │
├─────────────────────────────────────────────────────────────────┤
│           Storage: Qdrant  MinIO  Redis  Postgres  Graph(Neo4j) │
└─────────────────────────────────────────────────────────────────┘
```

关键增量层：**Agent Runtime**（新增，替代 `retrieval/service.py` 的一次性 pipeline）、**Tool Registry**（新增）、**KG 层**（新增 Neo4j 或 NebulaGraph）、**Postgres**（承接会话/统计的持久化）。

---

## 四、分层升级方案

### 4.1 解析层：从"阶梯降级"到"DeepDoc 化 + 服务化"

**问题**：`parsers/factory.py` 依赖 `MINERU_TOKEN`，本地降级链长；未把版面标签、表格结构、公式作为一等公民。

**升级动作**：

1. **抽出 `DocReader` 独立服务**（参考 WeKnora `docreader/` 微服务模式）：Python + gRPC，让主应用可以横向扩容解析容器，避免解析卡死主流程 [[2]](https://github.com/Tencent/WeKnora/tree/main/docreader)。
2. **DeepDoc 化解析**：保留 MinerU/PaddleOCR-VL，同时引入 **RAGFlow DeepDoc** 或 **Docling** 作为可选解析器；输出统一 IR（含 heading level、bbox、table cell、figure caption、page image URI），供下游 chunker/引用溯源共用 [[3]](https://github.com/infiniflow/ragflow)。
3. **表格独立通道**：表格转 Markdown + 结构化 JSON 双写；Qdrant 增加 `table_vectors` 集合，同时 Postgres 存表格原始行以支持后续 **Text-to-SQL** 工具。
4. **视频解析多供应商**：把 Qwen-Omni 抽象为 `VideoAnalyzer` 接口，增加 **Gemini 1.5/2.5 Video**、**开源 VideoLLaMA** 作为兜底，解决单点依赖。

### 4.2 分块层：从 Agentic Chunker 到 "Adaptive + Parent-Child + Template"

**问题**：现有 Agentic Chunker 已经很好，但没有 Parent-Child 结构，也没有按文档类型走模板。

**升级动作**：

1. **保留 Agentic Chunker 为默认**，包一层 **`AdaptiveChunker` 路由**：先跑 Document Profiler（heading 密度、表格占比、代码块占比），选 `agentic` / `heading` / `template` / `heuristic` 四条路径，坏切分校验失败自动回退（参考 WeKnora Adaptive 三层） [[4]](https://raw.githubusercontent.com/Tencent/WeKnora/main/docs/CHUNKING.md)。
2. **Parent-Child 双粒度**：小 child（≈300–400 token）参与向量匹配，大 parent（≈2000–4000 token）返回给 LLM。解决"embedding 精度 vs 生成上下文"的天然冲突，对长文档提升明显 [[4]](https://raw.githubusercontent.com/Tencent/WeKnora/main/docs/CHUNKING.md)。
3. **Template Chunker**：为论文、合同、PPT、日报等文档类型注册专属模板（章节/条款/页/日期），KB 级配置。
4. **移除 `experiments/agentic_chunker/` 与生产版重复实现**，统一走 `modules/ingestion/splitters/`。

### 4.3 检索层：从"五路并跑 + RRF"到"Tool 化 + 多通道 + ColPali"

**问题**：现有五路每次都全跑、权重硬编码、缺少视觉页级检索、缺少图谱/表格 SQL 检索。

**升级动作**：

1. **权重与阈值统一进 `settings`**：`ROUTING_ALL_LOW_THRESHOLD`、`ROUTING_GAP_DOMINANT`、RRF 权重、Rerank 融合系数 0.7/0.3 全部走配置中心，支持 KB 级覆盖。
2. **新增 ColPali/ColQwen2 视觉页检索通道**：对 PDF 每页存一张页面图 + late-interaction embedding，用 Qdrant `MultiVector`（原生支持）存 patch 向量；对表格/公式/多栏版面显著优于 OCR 文本。集成难度中高，但收益极大。
3. **新增 GraphRAG 通道（两模式）**：
   - **Local search**：按查询实体展开 1–2 跳邻居 + 相关 chunk
   - **Global search**：按社区摘要回答跨文档主题问题（"这批文档里对 X 的观点演化是什么"）
   - 增量 KG 构建走 Celery 队列，实体归一用 embedding + LLM 判重。
4. **表格 SQL 通道**：表格入 Postgres 后暴露 `TableSQL` 工具，Agent 可对结构化数据直接跑 Text-to-SQL。
5. **Rerank 配额对称化**：对 audio/video/table 增加 `implicit_enrichment` 配额位（现在只有 image 有）；Rerank 结果按模态分档 top-N，避免长尾模态被文本淹没。
6. **多路召回 + 融合精排**（沿用 RAGFlow 思路）：Agent 决定跑哪几路后，融合前把每路取 top-30，Cross-Encoder 一次 rerank 到 top-10，融合系数走配置 [[3]](https://github.com/infiniflow/ragflow)。

### 4.4 Agent Runtime：本次升级的**灵魂**

**从"一次性 pipeline"升级到 LangGraph 风格显式状态图**，节点如下：

| 节点 | 职责 | 对应现有代码 |
|---|---|---|
| **Planner** | 意图分类、复杂度判定（简单/多跳/全局/需要动作） | 复用 `processors/intent.py` 输出 |
| **SubQuestioner** | 复杂 query 分解为子问题（LlamaIndex 模式） | **新增** |
| **KB Router** | 挑 KB 子集 | 复用 `knowledge/router.py` |
| **Tool Router** | 从工具注册表挑 1–N 个检索工具 | **新增** |
| **Retriever(fan-out)** | 并行调工具 | 复用 `search_engine.py` |
| **Grader** | 每个 chunk 打相关性/支撑性分（CRAG） | **新增** |
| **Reflector** | 若证据不足→触发追问/换工具/web fallback | **新增** |
| **Generator** | 流式生成 + 引用绑定 | 复用 `generation/*` |
| **Critic** | 生成后 self-critique（可选，高准确率场景开启） | **新增** |

关键实现：

- **技术选型**：**LangGraph** 直接引入（Python 原生、显式状态、支持 checkpoint/human-in-the-loop）；不引入 LangChain 全家桶，只取图运行时。
- **状态持久化**：Agent State 写 Redis + Postgres，支持中断/恢复（对付长任务）。
- **短期记忆**：对话轮次上下文压缩后放 Redis。
- **长期记忆**：抽取"用户偏好/常查主题/术语表"写 Postgres，进入下轮 Planner 提示。
- **人在环 (HITL)**：证据不足或需要执行破坏性动作时，Agent 通过 SSE 推送 `clarify_card` 让用户确认（可复用 `mira-generative-ui` 的候选卡片模式）。

### 4.5 生成层与引用溯源：**Cross-Modal Citation Grounding**

**问题**：现有 `context_builder.py` 已有 ReferenceMap，但引用只到 chunk id，未到"页面 bbox / 表格 cell / 视频时间戳 / 音频区段"。

**升级动作**：

1. **多模态引用协议**：`Citation` 增加 `locator` 字段：
   - text → `chunk_id + char_offset[a,b]`
   - image → `page_id + bbox[x,y,w,h]`（含 ColPali 高亮 patch）
   - table → `page_id + cell(row,col)`
   - video → `file_id + [t_start, t_end] + shot_id`
   - audio → `file_id + [t_start, t_end]`
2. **前端"点击回跳"**：SSE 事件中同步推送 locator，前端可跳到 PDF 页面高亮、视频跳转、音频跳段。
3. **答案句级绑定**：让 Generator 用 XML 标签把每句证据带上，后处理解析生成 UI 结构（避免让 LLM 直接输出 JSON 卡壳）。

### 4.6 KB 生命周期：Wiki 反哺 + 增量 KG

**新增能力**：

1. **Wiki 模式**：Agent 在检索后不仅回答用户，同时把"稳定共识事实"写入 KB 自维护 Wiki 页面（新一类文档），下次直接命中，形成"文档→回答→Wiki→再检索"的自我强化闭环（借鉴 WeKnora Wiki Mode） [[5]](https://github.com/Tencent/WeKnora)。
2. **增量 KG**：新文档入库→异步实体/关系抽取→合并到全局图谱→触发受影响社区摘要重算；KG 是 GraphRAG 通道的底座。
3. **KB 画像触发升级**：`portrait_trigger.py` 从"数量阈值"升级为"内容漂移检测"（新入文档与画像语义距离超阈值即刻触发）；Celery 失败不再走 HTTP 自调，直接持久化到队列表由 worker 消费。

### 4.7 平台侧：可观测、可评估、可扩展

1. **Tracing**：接入 **Langfuse**（本地部署可选），覆盖 Agent 节点、工具调用、token、耗时；解析阶段也做 stage-by-stage timeline，用户可在 UI 看到当前进度并"停止解析"。
2. **评估回路**：内建 **RAGAS** + 命中率 + BLEU/ROUGE + 人工评审队列；每个 KB 挂 golden set；CI 跑回归。
3. **Worker Pool 分级**：core / post-process(embedding/rerank) / enrichment(KG/Wiki/画像) / maintenance 四池 + 弹性共享池（参考 WeKnora）[[6]](https://github.com/Tencent/WeKnora/blob/main/docs/worker-pool-governance.md)。
4. **持久化会话**：`api/chat.py::sessions` 与 `RetrievalService._retrieval_stats` 迁到 Postgres/Redis。
5. **配置中心**：新增 `settings.yaml` + 环境变量分层，KB 级可覆盖检索权重/rerank 系数/开关。
6. **MCP 工具协议**：把 Tavily/SerpAPI/Pixabay、外部数据库、内部 CRM/CMS 等外部能力用 **MCP** 协议接入，支持 stdio/SSE/HTTP、OAuth、human-in-the-loop 审批。

---

## 五、六大创新扩展方向（Multi-Modal Agentic KB 独有）

在上述"稳态升级"之外，建议纳入以下**具有产品差异化**的能力：

1. **Agent 自主选择检索模态**：ReAct 循环里把"文本 dense / BM25 / ColPali 视觉页 / GraphRAG / TableSQL / 音频 / 视频 / Web / MCP"作为并列 tool，模型按 query 自己组合调用；比"并行全跑"节省 40–70% token，同时提升长尾模态命中。
2. **主动澄清 + 候选卡片双向对话**：证据不足或指代模糊时，Agent 用 GenUI 卡片把候选项预填出来（哪个知识库？哪个附件？哪个时间范围？），用户点选代替打字。
3. **跨模态引用溯源可视化**：点答案任一句 → 同时高亮 PDF bbox / 视频段 / 表格 cell / 音频区段；对合规/审计/toB 场景是刚需。
4. **任务型 Agent（RAG + Action）**：把"查检索"和"执行动作"（发飞书消息、创建 Meego 工单、跑 SQL、调外部 API）在同一图中融合。已具备 `integrations/feishu_*.py` 底座，扩展到 MCP 更自然。
5. **多 KB 语义联邦**：用 `router.py` 的画像思路扩展到"跨租户/跨领域 KB 联邦"，让 Agent 在一次对话内跨若干 KB 智能取证并**分别标注引用来源**。
6. **视频/音频"时间轴问答"**：结合 Shot + ASR + CLAP，支持"帮我在这个 3 小时视频里找到讲 X 的段落并给出证据剪辑"，输出带时间戳的引用片段和自动剪辑清单。

---

## 六、实施路线图（建议按季度切三期）

| 阶段 | 时长 | 目标 | 关键交付 | 风险控制 |
|---|---|---|---|---|
| **Phase 1：地基与 Agent 骨架** | 4–6 周 | 不改变对外行为，把"能配置化的都配置化"，搭 Agent Runtime 骨架 | 配置中心；LangGraph 集成；Tracing/评估集；会话/统计持久化；Rerank 配额对称化；解析器抽 gRPC | 每步过 golden set 回归；老 pipeline 灰度切换 |
| **Phase 2：能力砖块补齐** | 6–8 周 | 补齐 ColPali、GraphRAG、TableSQL、Parent-Child、DeepDoc、CRAG 反思、SubQuestion | 三条新检索通道；Adaptive+Parent-Child Chunker；Grader/Reflector 节点；引用 locator 协议 | Feature flag 灰度；每砖块独立评估 |
| **Phase 3：产品化创新** | 6–8 周 | 交付 6 大创新方向 | Agent 自主选通道；澄清卡片；跨模态引用 UI；Wiki 反哺 + 增量 KG；MCP 工具接入；视频时间轴问答 | 与产品/前端并行；引用可视化最先落 |

---

## 七、风险与取舍

1. **ColPali 存储/算力成本高**：单页存 patch 向量比文本 chunk 大 10–100 倍。策略：只对"图表密集/OCR 效果差"的文档启用，KB 级配置。
2. **GraphRAG 构建成本**：抽取实体/社区摘要开销大。策略：仅对"沉淀型 KB"（Wiki 模式）自动启用，其它 KB 手动开关。
3. **LangGraph 引入依赖**：需谨慎裁剪只取运行时。可先自研 mini 状态图 200 行代码，验证收益后再决定是否引入。
4. **人在环体验节奏**：过多澄清会降低响应速度。策略：Grader 打分阈值可调，简单查询直答，只有低置信度时才澄清。
5. **多供应商解耦**：视频/LLM/embedding 抽象接口带来适配成本。策略：接口先只覆盖"当前已用 + 兜底一家"，避免过度抽象。
6. **评估集冷启动**：golden set 需要人工准备。策略：先用现有对话样本 + LLM-as-Judge 自动生成，再让业务同学纠偏。

---

## 八、一句话总结

**这次升级的核心不是加更多模型，而是把 `feat/agentic` 分支已经具备的"局部智能"用一张显式状态图串成整体智能，同时补齐 ColPali/GraphRAG/表格 SQL/引用溯源四块业界短板，最终让 MMA-RAG 从"多模态 RAG"升级为真正意义上的"Multi-Modal Agentic Knowledge Base"——能自主选通道、能反思修正、能跨模态引用、能主动澄清、能沉淀 Wiki、能执行动作。**

如果你希望，我可以基于本方案的任意一个模块（例如"Agent Runtime 骨架"或"ColPali 集成方案"或"引用协议 v2"）出一份**可以直接开工的详细技术设计（含目录结构、接口定义、迁移步骤）**。

## References
1. [Tencent/WeKnora](https://github.com/Tencent/WeKnora)
2. [DocReader Service](https://github.com/Tencent/WeKnora/tree/main/docreader)
3. [RAGFlow README](https://github.com/infiniflow/ragflow)
4. [Chunking Guide](https://raw.githubusercontent.com/Tencent/WeKnora/main/docs/CHUNKING.md)
5. [WeKnora README](https://github.com/Tencent/WeKnora)
6. [worker-pool governance](https://github.com/Tencent/WeKnora/blob/main/docs/worker-pool-governance.md)