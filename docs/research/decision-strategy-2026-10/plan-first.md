# Decision plan-first：执行契约与验证边界

2026-10-09，当前执行策略 `decision-plan-v2`。普通 `adaptive` 改为先完成原生成式规划，再核验有限的来源动作提案；执行权限按实际模型版本和用途校准、准入。`off` 保留原路径；`force` 暂保留独立的 v3.1 Decision 前置实验契约。本改动没有修改用户保存配置，也没有重建索引。

## 为什么调整架构

v3.1 将完整接管资格和来源需求绑定在同一批 13 个判断。新的 10 题 holdout 中 Jev 完整接管 0/10，百炼 1/10，大多数请求仍需继续运行原生成式规划；重写阶段原本也不会被跳过。百炼还存在一个通过 required/helpful/forbidden 一致性检查的错误图片需求。此前 partial 仅增不减，无法纠正原模型误开启被排除来源的问题。

这些结果说明不能把更多独立分数相交视作语义正确保证。方案改为“提出具体动作 → 判定该动作是否被当前请求支持 → 确定性执行”，不继续针对既有失败样例调整提示词或阈值。旧 v3.1 源码、协议、原生回执和负结果保留，详见 [意图评估](intent-evaluation.md)。

## 分层责任

- 原生成式模型负责类别、指代、查询计划和拆解。仅在 adaptive 启用时，在同一次 planner 请求中附加 `source_proposals` 输出要求；不为提案增加一次生成式请求。
- Decision 只核验已有提案，不再完整重做任务分类和三种媒体的 13 个信号。不提供任意新查询、知识库 ID 或文件 ID。
- 本地程序检查提案结构、当前用户原文字面位置、适用范围和互相冲突；再根据核验结果应用有限的模态变更。
- 知识库/文件选择、ACL 等范围由已有系统负责。模型提案不能扩大授权范围。引用材料和附件内容不能自行变成当前用户指令。

启用模式的 planner 提示词增加了提案字段，实际生成输出可能随之变化。这里的 baseline snapshot 是**这一次生成式规划已经产生并经过原验证器的结果**；不能把它说成另一场“关闭 Decision”请求必然生成的相同计划。配对端到端比较仍需记录两组真实规划。

仅 adaptive 路径会保留生成式模型已经给出的合法媒体枚举，不再被旧关键词规则强制覆盖；缺失或非法字段仍使用原验证器的补全结果。off 的关键词行为未修改。这是单独的规划语义修复，不应把它带来的变化归因于 Decision 判得更准。

## 提案与单批核验

每个提案包含：

```json
{
  "id": "p1",
  "target": {"modality": "image", "scope": "global", "description": "图片来源"},
  "action": "forbid",
  "source_span": "不要使用图片",
  "provenance": "current_user"
}
```

本版本最多处理 6 个提案、4,000 字符当前查询、600 字符原话片段；超过界限不截断后继续执行。只有 `image/audio/video`、`require/forbid`、合法唯一 ID、`current_user` 出处以及原话确实出现在当前用户消息中的提案才具备资格。`object` 级限制保留在记录里，不能误编译为整个模态排除。同一模态出现相反全局动作时，整组不采用，不按返回顺序或概率决定谁覆盖谁。

一条原句限制多个媒体时，各项提案必须复用包含并列词的完整原句。不会把“不搜索任何图片、音频或视频”自动改写为原文不存在的“不搜索任何音频”，也不使用模糊匹配修复出处。此问题已在首轮真实 planner 中观察到，因此附加输出协议明确了通用的原句复用规则。

原文字面命中只证明出处位置，**不证明语义上是当前指令**。引文、代码、回答形式、局部对象限制仍由 Decision 根据完整当前用户请求进行判断。输入不包含历史或附件；当前用户没有重新明确提出的旧限制不由此机制提取。依赖缺失指代的提案应弃权，原 planner 仍可按原流程使用会话上下文。

所有具备资格的提案在同一请求中各对应一个 Choice：

- `verified`：当前用户请求明确支持这个动作和作用范围；
- `contradicted`：请求不支持该动作，例如引述数据、呈现形式或被过度扩展的限制；
- `unresolved`：指代、条件或范围缺失，无法判断。

只有模型与用途的 profile 已准入、选中 `verified` 且概率达到该 profile 门槛的动作才应用。模型身份必须同时匹配 route、requested_model、实际返回 model 及完整 verifier 模板哈希；新返回版本、未知路由及未通过准入的用途均只观察，不能继承其他模型的执行权限。`confidence` 只记录。整个响应必须先通过完整协议检查，才应用任何动作。未通过的局部动作不阻止其他已通过动作。最多 1 次请求，整个核验阶段最多 3 秒，也不超过客户端更短的 timeout；取消传播并回收当前请求，不重试、不重跑 planner。

## 生效行为与集成字段

`require` 将对应意图设为 `explicit_demand`；`forbid` 设为 `unnecessary` 并产生已采用排除约束。任务类别、复杂度、重写内容、子查询及检索范围不由核验器改写。确认一个原本已为 `unnecessary` 的 forbid 仍记作 `applied=true, changed=false`，因为约束必须继续阻止后续文件绑定或 Agent 子查询重新开启它。

完整记录位于 `jev_decision.plan`，同时在 intent 返回值的 `decision_plan` 提供同一记录：

- `baseline_snapshot` / `baseline_sha256`：动作应用前的规划字段；
- `actions[]`：原提案、资格拒绝原因、模型关系、信号、`applied`、`changed`、`before/after`；
- 每项 `profile`：实际模型、用途、阈值、准入状态和 `execution=apply|observe_only`；`meets_profile_threshold` 只是达到候选阈值，不能代替 `applied`；
- `request_count`：调用客户端 evaluate 的尝试次数，0 或 1。客户端的本地拒绝也属于尝试，不等于上游 HTTP 成功次数；
- `status` / `reason` / `applied_ids`：实际执行结果；
- `baseline_plan_preserved=true`：原类别、拆解和查询计划保留，模态变化另有记录。

`jev_decision.strategy=plan_first`；`accepted=false` 表示没有整体接管 planner，不能在界面显示为“决策未执行”。`partially_applied` 表示至少一个动作已采用，具体变化看各动作的 `changed`。`decision_requirements.modalities` 只包含已采用动作，继续使用 `status=required|forbidden`、`action=adopted`、`effective_intent` 供已有执行器消费。新策略不携带旧 `planning.grounding_state`，因此不会意外触发旧 grounding 推断。

来源排除会改变最终生效证据，这是纠正原模型误开启来源的必要行为。保留原查询计划、原排序算法和 baseline 快照，不等于宣称最终结果完全不变。约束从原问题向子查询及最终证据的传播由检索/Agent 集成层负责，不能仅根据本模块的 `applied` 记录宣称整条链路已执行成功。

## 模式兼容

| 模式 | 行为 |
| --- | --- |
| off | 原 planner 模板、调用顺序和返回行为；没有新提案要求，没有 Decision 调用。 |
| adaptive | 原生成式调用一次；有可执行提案才核验一次；无提案零调用；异常/弃权保留已完成规划。 |
| force | 继续调用冻结 v3.1 前置分类；语义不确定或调用失败即停止，不生成式回退；不会被静默改成 plan-first。 |

旧 force/v3.1 历史诊断按其原契约解释。当前策略不是“更强的强制接管”，也没有通过设置迁移把用户原选择自动切换。

## 验证与冻结原生入口

确定性测试覆盖：规划快照不变、同时 require/forbid 的独立动作、同值排除的约束效力、引文原话不等于授权、对象/历史/附件提案拒绝、完整批次验证、单批失败回退、局部弃权、超时取消、off 原模板、force 原契约、模型版本/用途隔离，以及信号为 1 仍不能越过观察权限。还包含使用已跟踪紧凑信号重新计算开发阈值和 holdout 准入的离线测试。

第一版人工诊断集与协议保留在 `evals/decision_plan_v1/`，18 题、39 次实际原生请求、三模型。统一 .85 导致 Jev 仅采用 2/9 正向动作、Luna 0/9；百炼错误采用 7 项，而且错误信号可以达到 .98–1。该结果否定统一概率阈值可提供通用执行资格的假设。v1 原协议、源码快照和回执保留，已明确作为**开发集**，不再当作独立验证集。

开发选择算法在新 holdout 调用前固定：每个模型、每种用途分别遍历 `.50,.55,...,1.00`；要求 `choice=verified`、开发集 FP=0、TP>0 且正例覆盖至少 50%；在可行候选中最大化 TP，并列取最高门槛，无可行候选则只观察。这里将错误生效放在召回之前，二者不能用一个平均分抵消。由此选定 Jev require=.50 / forbid=.70，Luna require=.55 / forbid=.50；百炼两个用途均无可行阈值。

新 `evals/decision_plan_v2_holdout/` 在调用前冻结了 24 个未见请求，每个用途 6 正 6 负；三模型共 72 次，全部获得原生回执，没有重试或补填。独立准入门槛为每用途 FP=0 且 TP≥4/6，观察状态的 production applied 与候选阈值命中分开统计。结果如下：

| 实际模型 | 用途 | 固定门槛 | 候选 TP / 正例 | 候选 FP / 负例 | 执行权限 |
| --- | --- | --- | --- | --- | --- |
| Jev 1.13.0 | require | .50 | 6/6 | 0/6 | 本用途准入 |
| Jev 1.13.0 | forbid | .70 | 5/6 | 0/6 | 本用途准入 |
| Luna Decisions 20261006 | require | .55 | 5/6 | 0/6 | 本用途准入 |
| Luna Decisions 20261006 | forbid | .50 | 4/6 | 0/6 | 本用途准入 |
| 百炼 decision-model-preview | require / forbid | 无可行开发阈值 | 未授予动作执行 | 未授予动作执行 | 仅观察 |

百炼 holdout 的原始 Choice 在 require 的 6 个负例中错判 5 个 verified，在 forbid 的 6 个负例中错判全部 6 个；不能把观察模式的“实际错误生效为零”解释成模型判得正确。Jev/Luna 的遗漏仍保留，不再降低门槛。本次 6 个负例未出现错误，并不证明总体错误率接近零；这是小样本、单一标注者的用途准入试验，不是可靠性保证。

已跟踪、可在 clone 后复核的紧凑证据位于 `evals/decision_plan_v2/`：开发和 holdout 的 case ID、金标、模型身份、原始 Choice 概率，完整选择网格与准入结果。执行 registry 的 `evidence` 字段记录这些文件哈希；完整大回执仍在 `ops/decision-plan-v1/native-v1/` 和 `ops/decision-plan-v2/holdout-v1/`。这些输入是预先编写的 planner 提案，**不能证明真实生成式模型会提出这些提案，也不能证明真实检索或答案质量提升**。

```sh
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_plan_profiles.py
PYTHONPATH=backend .venv-main/bin/python -m pytest backend/tests/test_decision_profiles.py -q
```

默认命令只验证协议、标签、输入和生产源码哈希；测试重算紧凑证据，无模型调用。需要新的原生观察时显式使用 `--live --output` 全新目录；不得复用或补齐已冻结回执。报告中的客户端尝试数不能当成网络成功数。首次离线 promotion 使用相对输出路径触发路径错误，尚未写 registry；随后以绝对路径读取同一批回执完成准入，没有重发请求。真实 planner 提案覆盖和端到端收益须另外观察；旧样例失败不删除，不调整门槛重新包装为新策略成功。

## 真实 Agent 最终上下文验收

`ops/decision-project-v1/agent-live-v2/` 在调用前冻结源码、配置、同一论文知识库范围和问题，两组各一次：全关闭；Jev adaptive + assist。最多 2 轮、3 个子查询、12 条合并证据，每组 240 秒上限。使用独立进程内 `_request_config`，未修改保存配置、会话、文档或索引。原 `agent-live-v1` 在协调者要求暂停后停止，off 回执和 Jev 中断日志保留；v2 是源码/准入变更后的新协议，没有补填 v1。

| 观测 | off | Jev adaptive + assist |
| --- | --- | --- |
| 真实预规划子检索 | 3 | 3 |
| 最终上下文 | 5 图片 | 12 文档 |
| 原问题来源核验 | 无 | 1 次，三项禁止均采用 |
| 各子检索证据判断 | 无 | 全部 deferred |
| 最终上下文 checkpoint | 无 | 仅 1 次，10 候选，无采用补证 |
| 端到端耗时 | 19.57 秒 | 43.61 秒 |

Jev 组真实生成式模型对三个禁止来源都复用了完整原句，三项已采用约束均 `changed=false`：原 planner 已给出合法 `unnecessary`，核验结果负责维持后续约束，并非 Decision 把错误原始枚举全部纠正。原锚点和三个子 run 的重排均 deferred，合并后才真实调用一次 `candidate-evidence-role-v1`，符合最终上下文 checkpoint 的调用位置要求。两次 Decision 观测耗时分别为 .838 秒和 .733 秒。

off 沿用原关键词覆盖，Agent 还按被强启的原问题模态添加音频/图片查询，最终只提供图片而无法回答文本限定问题。Jev 组保持文本来源，但第二轮发生 12 秒 query embedding deadline，最终文档多为参考文献和标题；回答明确说明证据不足，未完成完整分工概括和取舍比较，且暴露了向量化失败造成的覆盖不完整。**这次证明约束传播和单次最终 checkpoint 可执行，没有证明最终答案已充分满足任务，更没有证明开启后更快。** 两组受到随机规划、不同候选和嵌入长尾影响，不能把效果差异单独归因于 Decision 模型。

协议 `01d671ca2390d115fef5dcd771e7405abf922bfd9259b3a8cf0bc803c3816c15`；结束时源码哈希无漂移，保存设置哈希未变。最终相关 142 项后端测试通过，`git diff --check` 通过。
