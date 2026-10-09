# Decision 辅助检索 v1 验收（历史记录）

本文记录 v1 Choice 补证策略的当时验收，不代表当前生产策略或用户保存配置。当前双 Noul 增量策略及负结果见 [v2 评估](../research/decision-strategy-2026-10/incremental-v2-results.md)，当前配置说明见 [Decision 模型](../DECISION_MODELS.md)。

日期：2026-10-09。工作区：MMA-RAG / main。本次新增可选的 `rerank_mode=assist`，验证范围为普通直搜和现有 Agent；Pi 继续使用独立流程。没有修改知识库数据或重建索引，验收后持久配置仍为 TypeSafe Jev、三个模式全部关闭。

## 行为与边界

- 原召回、Cross-Encoder、最终排序和模态保护先完整执行。Decision 从同一授权召回池中检查至多 8 个未入选的完整文本，最多在原结果后附加 2 条，不改原结果、分数或顺序。
- Choice 同时检查实体、条件、时间，以及支持、相反和否定证据。所选 `answer_bearing` 概率与置信信号均须达到 0.85；这不是经过校准的业务正确率。
- 单条文本最多 4,000 字符，请求数据最多 40 KB。超限和非文本候选明确跳过；超时、无效响应和内部异常保留原结果，取消继续传播。
- Agent 的规划种子、分解预算、新证据和停滞计数只使用原结果。最终合并额外保留至多 2 条不同补证；同一 chunk 若被用户 `@` 绑定，则按显式输入处理。
- 原上下文先完成文档/媒体限额、引用编号与压缩，再附加完整补证，避免新增材料挤占原上下文或丢失第 500 字符之后的关键信息。
- 聊天正文下方的折叠「Decision 记录」展示实际执行、响应模型、跳过/回退、原排序与补证，以及引用声明、冲突和未覆盖情况。流式、非流式和历史共用诊断结构。引用诊断不改写答案。
- 「填入辅助检索组合」只填入草稿，保存后才开启自适应意图、补充证据和批量引用诊断。开启会增加模型调用与等待。

## 工程与浏览器验证

后端相关回归 **431 项通过**，覆盖 Decision/Jev 配置与契约、聊天、Agent、附件、引用分数和模态保护；日志为 `ops/decision-assist-qa/backend-regression.log`。重点新增回归验证原结果逐项一致、完整上下文不变、原引用编号不变、补证不影响规划、失败与取消、严格失败及诊断持久化。

最终复核修正了流式请求在绑定 `@` 材料之前计算补证数量的问题：GET/POST × direct/Agent 四种新增用例在旧顺序下全部失败，修复后通过。该轮针对性测试 **38 项通过**，验证补证统计、原始提案及 SSE/历史记录一致性；这组测试与上面的广泛回归部分重叠，不相加计数。

前端 **200 项测试通过**、生产构建通过，另外 2 项真实 SSE/React DOM 集成通过。Chrome 验收覆盖 SSE → store/localStorage → 展开记录、键盘 Enter、证据对照、引用冲突、历史恢复、严格选项，以及草稿与保存边界。桌面及 390px 浅/深主题均无水平溢出，无页面运行错误。浏览器使用受控 API 响应，未改变真实配置或发起上游模型调用。

实际运行服务也完成独立验证：前后端重启后健康，前端 HTTP 200；全关闭状态的真实问候请求成功结束，沿用无需检索的原路径，历史与 SSE 的诊断一致。这项冒烟测试没有覆盖真实知识库完整检索。

本地证据：

- `ops/decision-behavior-qa/decision-record-browser-results.json`
- `ops/decision-behavior-qa/decision-record-{collapsed,desktop-light,mobile-light,mobile-dark}.png`
- `ops/decision-behavior-qa/decision-settings-{desktop,mobile-light,mobile-dark}.png`
- `ops/decision-assist-qa/live-server-off-smoke.json`

## 真实模型：功能可以触发

事先冻结 4 个中文合成问题，每题包含人为保留的 10 条背景基线，以及支持、相反、错实体、错日期、错条件、提示注入候选。生产 Reranker 与 Choice 补证代码未替换，基线分数明确为受控值，Decision 使用真实响应。

| 路由 | 成功题数 | 原 10 条完全保留 | 补入支持与相反证据 | 误补充 |
|---|---:|---:|---:|---:|
| TypeSafe `jev-1.13.0` | 4/4 | 4/4 | 4/4 对 | 0 |
| OpenRouter `inception/mercury-decide:free` | 4/4 | 4/4 | 4/4 对 | 0 |

两模型共 32 次干扰候选判断均未通过双阈值，不是仅被“最多 2 条”截掉。TypeSafe 两条错条件候选选择了 `answer_bearing`，但概率/置信信号分别仅为 `.41/.11`、`.48/.22`，因此正确阻止补入。无重试、调整阈值或改写原始结果。

独立调用当前实际 `Qwen/Qwen3-Reranker-8B` 一次，成功且没有回退；它已将首题支持与相反证据排在前两位。因此，这组实验只证明补证功能和选择约束可工作，**不证明真实基线漏检或质量提升**。

完整证据：`ops/decision-assist-qa/functional-live-report.md`、`functional-protocol.json`、`functional-cases.json`、`functional-live.jsonl`、`functional-live.summary.json`。

## 公开样本：未观察到召回增益

从现有冻结测试集按文件顺序，选择前 12 个候选数大于 10 且存在成功历史 Qwen 回执的案例。选样不读取相关性标签或模型预测；协议固定后回放原始真实 Qwen 分数和输入哈希，再分别调用 Jev 与 Mercury。24 次尝试都计入，未删除超时。

| 路由 | 案例数 | 原结果保留 | 新增证据 | 平均召回率：前 → 后 | 失败 |
|---|---:|---|---:|---|---|
| TypeSafe Jev | 12 | 全部 | 0 | 95.83% → 95.83% | 1 次超时 |
| OpenRouter Mercury | 12 | 全部 | 0 | 95.83% → 95.83% | 0 |

TypeSafe 超时案例为 `t2v2-6113`，保留原结果。没有新增项，因此新增证据精确率无定义。该试验使用历史基线回放，规模小、只覆盖固定候选池，也没有评估答案质量、当前 Qwen 延迟或完整知识库检索；不能据此给出普遍质量或提速结论。保持可选与默认关闭，不降低阈值来制造收益。

冻结协议已纳入仓库：[protocol.json](../../evals/decision_assist/protocol.json)。原始回执保留在忽略目录 `ops/decision-assist-qa/public-pilot.jsonl` 与 `public-pilot.summary.json`。复现使用已有项目凭据，会产生真实 Decision 请求；指定新的输出路径，脚本拒绝覆盖已有回执：

```sh
.venv-main/bin/python backend/scripts/evaluate_decision_assist.py \
  --live \
  --protocol evals/decision_assist/protocol.json \
  --output ops/decision-assist-qa/public-pilot-new.jsonl
```

脚本检查原数据、历史回执及每个基线输入的哈希，不修改持久配置。新运行必须保留原协议与全部失败记录；功能合成样本不能混入这组质量统计。
