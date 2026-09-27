# Jev 强制模式（2026-09-27）

设置页 → Jev 语义判断 → 一键强制测试 → 保存 Jev 设置。也可分别选择意图识别或检索结果重排的“强制 Jev（不回退）”。按钮只更新草稿，保存后对新请求生效；现有请求使用开始时的配置快照。开发验收使用隔离配置，未替用户启用全局强制模式。

## 行为与范围

- `intent_mode=force`：越过 adaptive 的概率、复杂度和上下文资格门槛，采用 Jev 意图判断；不会回退生成式意图模型或本地默认意图。历史、附件描述会一同传给 Jev。已有问候/空库快捷路径不能绕过强制意图阶段。
- `rerank_mode=force`：有候选时必须由 Jev 评分，不能回退 CrossEncoder；缺分、非法评分、预处理或排序异常也不得伪装成成功。无候选时明确记录 `skipped/no_candidates`，没有可重排对象时不调用模型。
- 强制仅作用于所选择的 Jev 阶段；查询改写、向量化、Agent 规划和最终回答继续使用原模型。Agent 已规划子查询原本无需重复意图分析，此优化保留，但强制阶段一旦失败，Agent 不得使用已有证据掩盖失败继续完成。
- 超时、限额、缺密钥、无效返回均明确停止当前请求。HTTP SSE 返回带 `jev_required_failed`、阶段和净化原因的 error，不能再发送 complete 或保存成功回答；普通聊天和检索 HTTP 接口返回 502。
- 保留原有 off/adaptive/shadow/replace 行为，force 不改变全局默认值、输入预算、超时或取消处理。
- 强制意图接受当前问题最多 4000 字符，以及最多 12 条历史、历史与附件描述合计 8000 字符；超过当前阶段输入边界会明确失败，不会为强行成功而丢弃上下文或更换模型。上游已有会话上下文构造规则不变。

## 真实验证

真实本地索引和真实模型 API，查询“介绍一下茶叶的驯化史”，直接检索，最终回答使用 `deepseek:deepseek-flash`：

| 指标 | 强制 Jev |
| --- | ---: |
| Jev 意图调用 | 0.513 s |
| 意图原 adaptive 资格 | 不满足（复杂度概率 0.42） |
| 实际采用 | `forced=true, accepted=true, eligible=false` |
| Jev 重排调用 | 0.588 s，force/ok |
| 完整检索阶段 | 9.776 s |
| 完整回答 | 33.02 s |
| 来源 | 10 个茶叶驯化史视频片段 |

引用编号完整，历史 API 保存了实际模式与阶段诊断，服务器日志中无生成式意图或 CrossEncoder 调用。本次单次耗时不能视为稳定延迟基准。

另启动无 Jev 密钥的隔离测试服务，真实 HTTP SSE 返回 `missing_key` 且 `fallback_used=false`，无正文与 complete；未向外部提供商发送无效密钥请求。

前端 TypeScript/生产构建及 scoped React Hooks lint 通过。后端覆盖模式配置、上下文、异常透传、Agent 部分失败、候选/评分异常、取消、旧模式兼容及引用合同。浏览器插件连接超时，未完成浏览器视觉验收。

本地证据（忽略目录）：`data/jev-force-test/live-events.jsonl`、`live-summary.json`、`live-answer.md`、`missing-key-events.json`、`all-tests.log`。

本阶段验收回归：181 项通过。当时已更新 8000 本机服务，17 个现有会话的历史 API 内容逐条恢复核对一致。该阶段验收未改用户配置，当时保留 `adaptive + replace`；后端 OpenAPI 已验证接受两个阶段的 `force`。用户随后启用 `force + force` 的阶段耗时验收见 [新会话推荐与直接检索阶段耗时](chat-recommendations-and-stage-timing.md)。运行配置以设置页为准。

真实强制测试会话可直接查看：`http://localhost:3001/chat/ccbf2ff9-0805-4b98-9dab-fa65d9581d42`。临时 8002/8003 测试服务均已停止。
