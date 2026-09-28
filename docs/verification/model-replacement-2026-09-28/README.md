# 超时模型替换与查询等待上限

2026-09-28，基于[替换前审计](../model-availability-2026-09-28/README.md)实施。验收时后端 PID 86140，127.0.0.1:8000；前端 Vite 3001。已恢复重启前最新 37 个会话、70 条消息，API 可见历史逐项一致，Jev 设置不变。下述结果记录的是提交前的本地验收状态。

## 生效配置

| 阶段 | 新默认 / 备用 | 变化 |
|---|---|---|
| 常规意图识别 | DeepSeek Flash / 百炼 Qwen3.5-Flash | 替换曾等 90s 才超时的 Qwen3.5-Plus |
| 最终回答、Agent 规划 | DeepSeek Flash / 百炼 Qwen3.5-Flash | 替换曾等 100s 才超时的 Kimi-K2.6 |
| 文档分块 | DeepSeek Flash / 本地结构化规划器 | 替换 Kimi；保留禁止跨付费模型 fallback 的语义 |
| 知识库画像 | DeepSeek Flash / 百炼 Qwen3.5-Flash | 替换 Kimi |
| 查询改写 | DeepSeek Flash / 百炼 Qwen3.5-Flash | 原唯一备用 Kimi-K2.5 已禁用，现替换 |
| 图片理解 | 原百炼 Qwen3-VL-Plus / 两个已测 Qwen Omni | 移除已禁用 Kimi-K2.5，避免耗掉备用尝试名额 |
| 音频理解 | 原百炼 Qwen3-Omni-Flash / Qwen-Omni-Turbo | 移除两个返回 403 的 OpenRouter Gemini |
| 视频解析、Qwen 重排 | 保持已验证主备 | 本次未发现需要替换的故障 |
| 向量化 | 保持 Qwen3-Embedding-8B | 保持现有索引空间；查询单批等待上限 12s |

当前 Jev intent=force、rerank=force、citation=off，因此实际意图和重排仍走 Jev。这里常规意图模型的替换也覆盖将来关闭 Jev 时的路径。失效/慢模型仍可出现在实时模型目录，但不再作为上述默认或自动备用。

后端静态默认和持久化 overrides 同步；前端默认矩阵同步。Zustand v0→v1 一次迁移已知旧默认 task/model 组合，保留其他自选模型与参数。升级后重新手选旧模型不会再被强制改写。

## 等待限制与响应参数

- 常规意图、改写：单模型墙钟 12s，总调用预算 30s；非流式最终生成/Agent planner：单次 30s、总预算 75s。显式调用参数可覆盖默认，总预算仍限制整个主备过程。
- 流式回答每个候选须在 20s 内产出正文；reasoning、空 delta、心跳都不能续期。已经输出正文后不切模型，避免混接答案。长视频保留原长预算。
- 查询 embedding 单批 12s；本地等待耗尽返回 `query_timeout`，不触发入库共享的全局模型冷却。同一请求的后续分支不再为同一配置重复等待；成功缓存仍可复用。新查询和后台入库可继续调用。真实 provider 错误仍按原规则冷却。
- 12s 是一次查询向量批次的上限，不是整个 Agent 多轮请求的总上限；多轮检索和多个成功批次仍有各自成本。
- DeepSeek Flash 默认 `thinking: {type: disabled}`；百炼 Qwen3.5-Flash 默认 `enable_thinking: false`，普通和流式均真正发送该参数。显式选择思考模式仍会保留。
- Agent planner 使用原生 `response_format: {type: json_object}`，两家 provider 均透传，输出仍经过原有 action/query 解析校验。
- 文档分块/视频等长输入任务的显式预算保留；入库向量化不受 12s 查询限制。

## 真实查询验收

[整链证据](live-verification.json)，[运行配置与历史恢复](runtime.json)。同一问题为“简要介绍茶叶的驯化史，并引用资料。”，替换前后均未传模型覆盖，均返回 10 个来源。

| 指标 | 替换前 | 替换后 |
|---|---:|---:|
| 整体完成 | 59.346s | 7.475s |
| 首个正文 | 44.841s | 5.265s |
| 生成阶段 | 53.953s | 2.706s |
| 正文字符数 | 703 | 715 |
| 来源数 | 10 | 10 |
| 本次观察到的模型失败/切换 | 0 | 0 |

这是单样本前后结果，不是冻结大规模基准或 P95/SLA。替换前的慢调用本身没有失败；变更同时移除了历史上会耗满 90/100s 的自动路由。

Agent 请求“比较茶叶与玉米的驯化过程，结合资料简要说明。”在 21.164s 完成，3 轮规划、6 个子查询、28 个来源，无模型失败/切换。资料缺少玉米证据，最终明确说明无法完成比较；该结果用于验证实际多轮执行和缺证据处理，不宣称知识库覆盖了该问题。

验收窗口内有其他浏览器请求，ModelHealth 增量是进程窗口统计，不全部归属上述单个请求。运行日志已观察到客户端显式 `model` 从旧 Kimi 变成 `deepseek:deepseek-flash`，包括 direct/auto/agent 请求。浏览器自动化连接超时，因此未声称完成页面视觉验收。

## 任务契约与保留的失败

[候选调用](candidates.json)、[生产方法验收](service-contracts.json)、[原始批次](service-contracts-initial.json)、[最终原生 JSON 规划](planner-json-mode.json)。全部使用合成输入，无知识库写入。

| 最终配置任务 | 模型 | 结果 |
|---|---|---|
| 实际文档分块 | DeepSeek Flash | 0.889s，2 块，原文无损，0 次本地降级 |
| 实际画像摘要 | DeepSeek Flash | 1.189s，非保底结果 |
| 常规意图模型输出 | DeepSeek Flash | 1.927s，完整 JSON，无隐藏推理占额 |
| 备用意图输出 | Qwen3.5-Flash | 4.630s，完整 JSON |
| 备用改写 | Qwen3.5-Flash | 1.383s，JSON 与指代消解通过 |
| 备用流式回答 | Qwen3.5-Flash | 首字 0.576s，全程 0.970s |
| 原生 JSON Agent planner | DeepSeek Flash | 0.786s，合法 search + 3 查询 |
| 原生 JSON Agent planner | Qwen3.5-Flash | 1.654s，合法 search + 3 查询 |

没有删除失败样本：Qwen Flash 未关闭思考时意图/规划均达到 20s 诊断上限；DeepSeek Flash 未关闭思考时，意图 7.620s 后输出预算耗尽、JSON 截断；Qwen Flash 未开启原生 JSON 模式的生产规划调用 5 次中 1 次不可解析。最终响应参数针对这些实测问题调整，不能将后来成功倒算成原批次全通过。

发现但本轮未扩展修改的既有语义问题：常规意图处理器会因关键词把“不要音频/视频”覆盖成 explicit_demand，即使模型原始 JSON 正确。当前 Jev force 不经过此后处理。本次结构化与可调用性验证不等于完整语义质量验收。

OpenRouter 同名 Qwen3 embedding 的两条向量与现有 provider cosine 约 0.999917 / 0.999935，但同名与两个样本不足以证明整个空间和召回一致。因此没有直接切换现有向量空间或重建索引；使用有界查询等待控制尾延迟。

## 回归验证

- 后端 190 项定向测试通过：故障转移/总预算、首正文期限、流式取消与清理、正文后不切换、查询超时与入库隔离、缓存复用、provider 参数、Agent、Jev force、引用/阶段计时、分块与画像采样。
- 前端 28 项测试通过，含真实 Zustand persist rehydrate/版本迁移；TypeScript 与 Vite 构建通过。
- `git diff --check` 通过。前端 lint 无法运行：仓库缺少 ESLint 配置，命令在检查代码前退出；未为此引入全局配置。
- 没有运行整个仓库的全套测试，也未进行长文、生产负载或长期尾延迟基准。
