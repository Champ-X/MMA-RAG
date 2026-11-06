# Pi Durable 运行、恢复与回退

Tessmora 的 Pi 模式默认使用 Pi Durable。它保存 Agent 的会话、模型轮次、工具意图和应用状态，使进程中断后可以继续研究。Python 宿主仍负责来源授权、工具执行、证据编号、用量账本和最终答案接收；Durable 不替代这些边界，也不自动提高检索或答案的语义正确率。

本实现基于 2026-11-02 发布的 Pi **1.5.0**，`pi-agent-core`、`pi-ai`、`pi-durable`、`pi-schema` 和 `chord` 使用精确版本锁定，要求 Node ≥22.19。上游 Durable 仍标为 **Experimental**，API 可能跨版本变化。升级时必须同时审查 lockfile、适配器和存储兼容性，不能把 `main` 上的未发布能力当作已安装版本的能力。

## 运行结构

```mermaid
flowchart LR
  UI[Pi 界面] --> API[/api/pi]
  API --> Host[Python 宿主]
  Host <--> Ledger[(runs.sqlite3)]
  Host <--> Worker[单运行 Node 工作进程]
  Worker --> Harness[Pi Durable Harness]
  Harness <--> Durable[(durable/run_id.sqlite3)]
  Worker --> RPC[宿主工具 RPC]
  RPC --> Tools[授权检索与媒体观察]
  Tools <--> Cache[(media-observations.sqlite3)]
```

`agent-runtime/src/durable.mjs` 使用上游 `Harness`、`GenerationTask`、`ToolTask` 和 SQLite 存储。`runtime.mjs` 继续提供共同的系统提示词、上下文投影、回答计划、工具适配、事件和无进展停止策略；`core` 运行路径也使用该文件。

原有严格工具契约保留：`schema.mjs` 在 SDK 参数处理前通过 `pi-schema` 检查原始参数，不把 `null`、字符串或错误类型自动转换为合法参数。宿主仍执行 Pydantic 严格验证、当前来源权限和最终交付检查。没有增加 Shell、任意代码执行、自动网络抓取或通用文件系统工具。

Durable 内置自动摘要压缩关闭，继续使用 Tessmora 的证据投影和归档策略，保留已交付证据、工具调用/返回配对及可复读导航。回答计划、已登记要求、模型轮次和无进展计数随 Durable 文档保存；新一轮用户回复清除上一轮终结状态和单轮要求，保留研究计划和证据。

## 数据与单写者约束

`PI_AGENT_DATA_DIR` 默认是仓库的 `data/pi-agent`；配置应用状态目录时使用该目录下的 `pi-agent`。

| 存储 | 责任 |
| --- | --- |
| `runs.sqlite3` | 运行、事件、证据、产物，以及工具操作回执、用户输入和模型请求尝试。 |
| `durable/<run_id>.sqlite3` | 单运行的原生 Durable 会话、模型/工具任务、输入去重及运行时策略状态。 |
| `media-observations.sqlite3` | 同一可信身份和授权范围下可复用的成功媒体观察。不是执行队列，也不保存跨运行通用证据编号。 |
| 附件与预览目录 | 私有输入材料及对应预览，沿用现有历史保留策略。 |

三个存储职责不同，不构成跨数据库分布式事务。宿主操作回执是工具重放的接收依据；恢复时以已接受的宿主最终结果为准，可以直接完成任务而不再次请求模型。不要单独删除某个 Durable 文件并期待宿主自动重建同一运行。

一个数据目录只允许一个 Python 宿主持有文件锁，一个运行只允许一个 Node 工作进程打开其 Durable 数据库。上游存储没有跨进程写锁协调；不能以多个 API worker 共用目录代替应用层单写者安排。Durable SQLite 使用 WAL 和 `synchronous=NORMAL`，能够覆盖进程崩溃恢复，但断电或主机故障可能丢失最新提交，仍需要备份。

密钥在每次启动工作进程时由当前宿主解析，不写入运行配置或 Durable 策略文档。恢复保留原模型名称、辅助模型路线、功能开关和来源范围，当前凭证及来源权限仍需有效；不会因修改默认模型而默默切换已有任务。运行记录代码、提示词、工具契约和配置指纹，用于诊断版本差异，不代表任意版本之间已验证兼容。

## 中断与恢复

| 情况 | 行为及限制 |
| --- | --- |
| 浏览器断线或刷新 | 后台继续运行；前端按事件序号恢复过程、证据和输入回执。 |
| 正常服务关闭、工作进程收到 `shutdown`、stdin EOF 或 SIGTERM | Durable 工作进程挂起并关闭存储，保留待处理任务。它们不等于用户取消。 |
| 工作进程意外退出或服务重启 | 在 Durable 配置下重新排队，打开同一运行存储。连续无进展恢复有次数上限；成功工具回执会清除该恢复失败计数。 |
| 工具结果已被宿主提交，Node 尚未确认时崩溃 | 使用稳定 `tool_call_id` 和参数指纹返回原回执，不再次追加同一操作的证据或最终结果。相同 ID 携带不同参数会被拒绝。 |
| 模型流中途崩溃 | 清除界面临时答案草稿，重新请求模型并分配新的宿主轮次。先前请求可能已经计费，用量未知不会记为零。 |
| 媒体供应商调用已发出但完成情况未确认 | 返回明确的 `operation_interrupted`，不盲目重复同一未知付费观察。已完成的可验证观察仍可保留。 |
| 用户点击停止或删除会话 | 显式取消为永久状态，不因重启而恢复；已完成过程和证据按现有保留策略处理。 |

工具声明 `replay: 'safe'` 的前提是宿主的操作去重和未知状态处理。它不保证外部供应商“恰好执行一次”；在远端成功、本地尚未提交的窗口内，本地无法凭空判断外部调用结果。成功观察缓存同样不能解决这个窗口。

瞬时模型错误由 Durable 进行最多两次重试，基础等待 250ms、等待上限 5s；底层传输设置 `maxRetries: 0`，避免隐藏的嵌套重试。每次真实尝试都经过宿主准入，并在向供应商发出请求前持久化轮次。配额/计费耗尽等不可重试错误沿用 SDK 分类，输出截断和既有无进展保护仍然有效。

## 持续输入

接口是 `POST /api/pi/runs/{run_id}/inputs`，字段为 `request_id`、`message` 和 `mode`。当前公开模式只有：

- `steer`：运行中补充或纠正当前问题，在后续模型请求中应用。不会撤回已经发出的供应商请求。
- `reply`：仅在 `needs_input` 时回答澄清，继续同一个 run 和 Durable 会话，沿用事件流、计划及证据。

网络结果未确认时重试应复用原 `request_id`。宿主输入账本和 Durable `requestId` 共同去重；Durable 在同一事务里接纳输入并保存回执元数据。`input.accepted` 表示已持久接纳，`input.applied` 表示已进入实际模型请求上下文，两者不能混为一谈。重开运行会重发已应用回执，宿主按 ID 去重。

有尚未应用的 steer 时，宿主不接受提前终结任务的 `submit_answer` 或 `ask_user`。界面保留排队、待应用、已应用、未应用等状态；重载后按服务端记录恢复。恢复原任务期间不能切换模型、材料或搜索范围；这些变化需要新任务。

## 媒体观察与检索

跨运行缓存只接收非空且完整返回的成功 `media_observation`。查询缓存前仍验证当前来源权限和版本。缓存空间绑定可信 owner 与原授权范围；键精确包含来源版本、通道、实际问题、页码/时间范围、语言、实际模型路线和提示词/采样版本，不进行问题语义近似匹配。缓存复用时由当前运行重新分配证据编号。

未完成或失败的观察不会变成缓存条目；损坏或不兼容的缓存内容视为未命中。视频长区间的成功观察包可独立保留，但不能把尚未完成的包视作完整观察。

检索现支持已有索引的稀疏向量分支，并在缺少覆盖或本地编码器未就绪时保留词面回退。`retrieval_strategy=native` 可增加图片 CLIP 和音频 CLAP 特征召回；使用已经加载的本地编码器，不在搜索中静默下载或启动模型。多分支受宿主并发容量控制，降级与覆盖情况由实际工具结果说明。

**尚未实现原生视频向量检索**。请求原生视频会报告 `native_video_not_supported` 并回退描述/ASR 文本检索。视频深入观察仍是采样帧和独立音频包，不能代表逐帧观看、原生视频模型理解或完整时序证明。原生图片/音频召回命中也仍需按问题使用 `inspect_media` 核实。

**没有上线语义蕴含验证器**。引用、计划和协议检查验证身份及结构一致性，不证明结论为真，也不证明每句话都被来源蕴含。本变更没有提供生产数据上的 Recall、答案质量或延迟改善结论；多分支与缓存的收益需用固定来源、问题和覆盖条件评测。

## 用量与成本

主模型原始 `Usage` 随每次宿主请求尝试保存。Pi 1.5 的 `usage.cost.totalFromProvider` 是**布尔来源标记**；金额在 `usage.cost.total`，不能把布尔值累加为金额。

当前汇总账本统计请求数、Token 和未知用量尝试，尚未形成覆盖主模型、嵌入与媒体模型的完整美元费用汇总。辅助模型账本主要保存 Token，总价信息若服务商返回则仍在原始事件中。自定义模型配置中的零价格是占位值；`cost_known=false` 表示未知价格，不能解释为免费。服务商实际账单与退款/失败请求计费规则仍是费用依据。

## 验证与回退

安装锁定依赖并执行离线回归：

```bash
npm --prefix agent-runtime ci
npm --prefix agent-runtime test
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_pi_durable_recovery.py backend/tests/test_pi_durable_host_review.py backend/tests/test_pi_media_observation_store.py backend/tests/test_pi_agent_indexed_search.py backend/tests/test_pi_agent_query_vectors.py
```

Node 回归覆盖真实 Harness/SQLite、子进程 SIGKILL、流中断、稳定工具 ID、关闭/EOF/SIGTERM、永久取消、澄清回复、steer 去重和应用时机、严格参数、重试与用量轮次。宿主回归覆盖操作回执、证据事务、恢复模型/范围和观察缓存；这些测试使用模拟模型或本地协议服务，不产生真实模型账单，也不替代浏览器及真实语料验收。

2026-11-06 本地验证结果：后端相关回归 490 项通过，独立宿主恢复审查 11 项通过（其中 5 项包含在前述回归中）；Node 110 项、前端单元测试 345 项、DOM 测试 219 项通过，前端生产构建通过，运行时 `npm audit` 无已知漏洞。真实配置模型 `deepseek:deepseek-flash` 的一次 API 验收完成了 `needs_input → 重启服务 → 同一 run 回复 → completed`，输入回执为 `applied`，答案为“二〇二六年”，共 4 次模型请求且没有未知用量项。验收 run 为 `8dda2900-2037-43ff-9db9-9993e3039cda`。API 健康检查及前端 `/api` 代理通过；浏览器控制不可用、原生 Chrome 操作被工具拦截，未完成真实浏览器验收。以上短回路不构成真实语料检索或性能基准。

上线前应在隔离数据目录做完整路径验收：创建研究任务，在工具执行和模型流不同阶段中断进程并恢复，核对工具回执、证据编号、用量未知项和草稿重置；再验证 steer、澄清回复、刷新、取消与会话删除。对检索和缓存，用相同索引版本和问题集比较覆盖、引用正确率、模型请求量及延迟，不能用一次成功调用替代结果。

### 对比评测与已知问题

仓库提供四个独立入口，参数见各脚本的 `--help`。默认历史基线为 `658b0d1`（Pi 1.0.3）；运行时和真实模型脚本要求预先准备该版本的独立 checkout，并按其 lockfile 安装 Node 依赖。不要让新旧代码共用运行数据库。

| 入口 | 测量范围 |
| --- | --- |
| [`benchmark-pi-runtime.py`](../scripts/benchmark-pi-runtime.py) | 真实宿主、Node worker 与 SQLite，使用固定本地模型响应；比较正常开销、模型流/工具回执中断和同任务回复。 |
| [`benchmark-pi-media.py`](../scripts/benchmark-pi-media.py) | 真实媒体缓存与证据存储，模拟下载、解码和观察服务；比较并发、跨运行复用及权限/版本变化。 |
| [`benchmark-pi-retrieval.py`](../scripts/benchmark-pi-retrieval.py) | 内存 Qdrant、固定向量与合成相关性标注；比较扫描量、召回、排序和回退，不测编码器质量或生产网络延迟。 |
| [`benchmark-pi-live.py`](../scripts/benchmark-pi-live.py) | 真实模型与只读索引，交替运行旧/新版；需要本地环境文件和符合脚本协议的两篇文档、六题输入，会产生供应商调用费用。 |

使用项目 `.venv/bin/python`，输出放入新的 `data/` 子目录。脚本保留源码/输入指纹和运行回执；真实语料、凭证、数据库及逐次回答不提交到仓库。真实模型输入只包含问题和授权范围，不包含评审参考答案。历史回执使用当时保存的脚本快照解释，后续脚本改进不能追溯改变旧结果。

耗时应分别报告失败率和双方成功的配对样本，不能把提前失败当成更快交付。模型请求/Token 汇总包含嵌入及失败尝试，不代表美元费用。评审应分别检查要点、实际引用支持、正确拒答和字数遵从，不能仅以 `completed` 判断效果。

2026-11-06 的小样本 A/B 已验证受控中断恢复与媒体缓存复用，但未证明真实问答整体提速或质量提升。以下问题仍未修复：

- 模型输出非法工具 JSON 时，参数预检查可能遮蔽 SDK 的原始解析错误，降低后续纠错能力。
- 回答计划中的 `current_candidates` 需要来源 ID；模型混用文件 ID 时会导致计划失败，计划前置检查也可能阻碍 `list_sources`。
- 原生图片/音频分支找到的相关候选可能被等权融合排序挤出最终结果；增加分支不保证最终 Recall 提升。
- 默认关闭实验回答检查时，用户提出的字数上限未被可靠执行；现有实验检查也不能当作已验证的语义修复方案。

### 运行时回退

`PI_AGENT_RUNTIME=core` 保留旧循环，用于新任务的运行时回退。已有 Durable 任务不能被降级为 core 会话；未完成任务在 core 配置下保留为 `queued`，记录 `runtime_paused=true`，不消耗崩溃恢复次数；`needs_input` 状态也保留。core 或禁用 Pi 时拒绝继续输入且不改变原任务，恢复 durable 配置后再继续。切换前先停止宿主并备份整个 `PI_AGENT_DATA_DIR`，保留当前代码与 lockfile；不要让两个进程同时打开它。

回退应用版本时，**不要让旧版本代码打开本次更新后的 Durable 或宿主数据库**。可使用完整的升级前备份配合相应旧版本，或者用独立空数据目录验证 core；仅改环境变量不等于存储迁移。不要独立替换某个 SQLite 主文件或忽略其 WAL 状态。恢复备份会放弃备份之后的本地进度，不能撤回已经发生的供应商调用或费用。

## 源码与上游依据

- 运行适配：[durable.mjs](../agent-runtime/src/durable.mjs)、[runtime.mjs](../agent-runtime/src/runtime.mjs)、[worker.mjs](../agent-runtime/src/worker.mjs)、[schema.mjs](../agent-runtime/src/schema.mjs)。
- 宿主与存储：[supervisor.py](../backend/app/modules/pi_agent/supervisor.py)、[store.py](../backend/app/modules/pi_agent/store.py)、[media_observation_store.py](../backend/app/modules/pi_agent/media_observation_store.py)。
- 上游 [Durable 1.5.0 README](https://github.com/earendil-works/pi/blob/v1.5.0/packages/durable/README.md)、[Agent changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/agent/CHANGELOG.md)、[AI changelog](https://github.com/earendil-works/pi/blob/v1.5.0/packages/ai/CHANGELOG.md)。固定 tag 对应提交 `f9a26365568127461c47a07a37dcb42c140a3ac5`。
