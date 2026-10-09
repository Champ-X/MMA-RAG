# 项目级 Decision 职责审查：来源与本轮契约

日期：2026-10-09。本文是源码研究和设计审查，不是已实现或质量提升报告。没有运行这些外部项目，也没有发起新的模型调用；仓库下载与官方文档快照保存在 `/tmp/mma-decision-research/`。此前的实验、回执和结论不被本文覆盖。

## 应首先改变什么

本轮最值得交付的是：**adaptive 先保留现有生成式规划；把补证判断移到原上下文构建、限额和压缩之后，让 Decision 对有身份的需求和实际可见证据做局部判断。** 原路径仍决定检索和原上下文，Decision 只能追加有界的补充材料并报告缺口。

当前实现存在三个职责错位：

1. `jev_intent.py` 的 `eligible` 同时要求任务类别通过、无需规划和上下文、三个模态均无不确定/冲突。`intent.py` 又在自适应弃权后串行运行原生成式规划。这会把一个无关字段的灰区扩大成全局弃权，并先付 Decision 延迟再付规划延迟。更合适的顺序是原规划先产出可核对对象，Decision 只在可产生具体操作时检查该对象。
2. `decision_evidence_incremental.py` 对完整检索基线做全局增量比较，但 `templates/multimodal_fmt.py` 的普通文档/转写只展示前 500 字符，`ContextBuilder` 还可再次压缩。完整 chunk 中存在的信息未必进入回答上下文。因而“源 chunk 已有”不等于“回答模型已看到”，扩大 12,000 字符上限不能修复这类错位。
3. 当前引用检查发生在生成后，最多覆盖八个可定位声明，且是 shadow。它能提供诊断，不能把已经流出的文本变成经过纠正的答案；不能用该功能抵消生成前证据缺口。

这不是移植某个仓库的完整 RAG 架构。下面的来源分别提供可迁移的方法，以及不应照搬的部分。

## 新来源 1：TypeSafe SDE cascade 的对象级验证与升级动作

已阅读 [SDE cascade 官方完整代码](https://docs.typesafe.ai/cookbooks/sde_cascade)。快照 SHA-256：`90ab0294cb0d83b0ece3343edf11c6d492ce0236f4e21b434bbdbcb7c5500b74`。

实际实现：

- `field_spec` 将 schema 中字段名、类型、描述、required 绑定成一个对象。
- `build_questions(record)` 对每个非空字段生成明确错误类型；空字段只询问 `absence_wrong`。不是不论输入都运行所有检查。
- `verify` 输入包含来源、schema 和已经生成的 extraction。判断对象是“这个字段值是否存在具体错误”，不是让 Decision 从开放任务重新规划。
- `any_flag` 排除整体 `__overall__::judge`，任一字段错误信号超过演示阈值才升级至 reasoning 模型。错误不能用平均分冲淡。

迁移：先有具体产物和证据，再用小判断触发有限动作。对代码文档是“此步骤是否适用于这个版本”；对事实问答是“此值是否被这段证据支持”；对 Agent 是“此子任务的产物是否满足已绑定约束”。

限制：该页使用 `jev-1.12`，演示阈值为 0.7；单例 cheap extraction 被明确硬编码以复现典型错误，100 条成本/质量图是供应商内部历史结果。不能拿它证明我们已有校准，不能照搬阈值、价格、收益数字，也不能把错误信号彼此当成统计独立。

## 新来源 2：TypeSafe pre-parsed extraction 的身份约束

已阅读 [Pre-parsed value extraction 完整代码](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)。快照 SHA-256：`a5242dbf4df6dcae3bbf374047026714c1801cdc126b39bc4bca99212dd1a1c9`。

`find` 由 regex 提供高召回候选，保留文档顺序并去重；`pick` 将实际发现的字符串用作 Choice 选项，并加入 `none`；代码复制被选字符串，再用 Decimal/phonenumbers 规范化。模型选择语义角色，代码控制值的身份和数值处理。

迁移：Decision 可以选择已有需求槽、已有来源 span、已有操作；不应生成无法回溯到用户或材料的事实、ID 和权限。证据记录需绑定 `source_id/source_hash/span_start/span_end/shown_text`，代码核对 span 与来源一致。来源窗口不完整时声明窗口边界，不能称为核对全文。

限制：regex 可覆盖的邮件、电话号码、金额与开放事实抽取不同。代码中某些后续示例直接操作选中值；真实系统仍需先处理 `none`、解析异常和候选遗漏。不能以候选选择取代所有任务分解。

## 新源码 3：RouteLLM 的预算阈值与质量阈值不是同一件事

仓库：[lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM)，实际下载 commit `0b64fdafe049e596a3f5657c219329f24af24198`。

- [`routers.py:32–45`](https://github.com/lm-sys/RouteLLM/blob/0b64fdafe049e596a3f5657c219329f24af24198/routellm/routers/routers.py#L32-L45)：路由器只输出用于路由的值，代码按 threshold 选择 strong/weak。
- [`calibrate_threshold.py:50–57`](https://github.com/lm-sys/RouteLLM/blob/0b64fdafe049e596a3f5657c219329f24af24198/routellm/calibrate_threshold.py#L50-L57)：所谓 threshold calibration 实际使用分位数，使期望 strong 模型调用比例达到目标。它控制调用比例，不证明被接受结果的错误率。
- [`benchmarks.py:77–114`](https://github.com/lm-sys/RouteLLM/blob/0b64fdafe049e596a3f5657c219329f24af24198/routellm/evals/benchmarks.py#L77-L114)：缓存同一批 router scores，离线扫描阈值，比较强弱模型已有结果与调用计数。
- [`controller.py:105–115`](https://github.com/lm-sys/RouteLLM/blob/0b64fdafe049e596a3f5657c219329f24af24198/routellm/controller.py#L105-L115)：只看最后一条消息，并明确注明路由器只训练过首轮数据，多轮尚需研究。

迁移：保存原始信号，开发集调策略、独立 holdout 评估；同时报告质量与成本。动作风险门槛和调用预算分开：保留原结果、追加证据、扩大检索、删除原证据的误判代价不同，不应共享一个 0.85。我们应先允许低破坏性的追加，未经验证的删除/压制不进入本轮。

限制：其路由器估计强弱模型的相对价值，不能拿来当本项目的引用可靠性分数；分位数阈值也不是概率校准。跨语言、Agent 多轮和多模态均需自己的验证。

## 新源码 4：Self-RAG 的检查点必须与动作绑定

仓库：[AkariAsai/self-rag](https://github.com/AkariAsai/self-rag)，实际下载 commit `1fcdc420e48f50a7d7ab1ece5494221b93252e99`。

- [`run_long_form_static.py:171–224`](https://github.com/AkariAsai/self-rag/blob/1fcdc420e48f50a7d7ab1ece5494221b93252e99/retrieval_lm/run_long_form_static.py#L171-L224)：对 retrieval/no-retrieval token 的归一化概率做分支，在后续生成节点再次执行有证据的 generation step。
- [`run_long_form_static.py:225–251`](https://github.com/AkariAsai/self-rag/blob/1fcdc420e48f50a7d7ab1ece5494221b93252e99/retrieval_lm/run_long_form_static.py#L225-L251)：生成候选节点保存对应 `ctx`、父节点和评分，按 beam width 控制工作量。
- [`run_long_form_static.py:276–295`](https://github.com/AkariAsai/self-rag/blob/1fcdc420e48f50a7d7ab1ece5494221b93252e99/retrieval_lm/run_long_form_static.py#L276-L295)：输出句段、使用的上下文和预测树保持对应关系。

迁移：判断应在可改变下一步的检查点出现，并保存“判断对象—证据—实际动作”，而不是只堆积事后分数。Agent 的新一轮只应响应某个明确未完成子任务，不能把“有视频候选”当成“问题已解决”。

限制：Self-RAG 依赖经过专门训练的生成/反思 token，并将 relevance/support/utility 加权到生成路径分数。不能把这些公式换成 Jev 概率就称为 Self-RAG，也不应把该加权搬进现有 Qwen 分数。其 static 文件使用预给定 `ctxs`，不能据此宣称代码实现了我们所需的动态多轮搜索。

## 新源码 5：Ragas 的声明对象与信息损失

仓库：[explodinggradients/ragas](https://github.com/explodinggradients/ragas)，通过 GitHub commit API 和该 commit 的 raw 文件读取 `298b68274234c060deacab3cf5fb52aa3a20e885`。

- [`faithfulness/util.py:10–49`](https://github.com/explodinggradients/ragas/blob/298b68274234c060deacab3cf5fb52aa3a20e885/src/ragas/metrics/collections/faithfulness/util.py#L10-L49)：先把回答拆成脱离代词也可理解的 statements。
- [`faithfulness/util.py:55–86`](https://github.com/explodinggradients/ragas/blob/298b68274234c060deacab3cf5fb52aa3a20e885/src/ragas/metrics/collections/faithfulness/util.py#L55-L86)：NLI 使用 statement/context 对象，要求返回原 statement、reason 和 verdict。
- [`faithfulness/metric.py:116–159`](https://github.com/explodinggradients/ragas/blob/298b68274234c060deacab3cf5fb52aa3a20e885/src/ragas/metrics/collections/faithfulness/metric.py#L116-L159)：先生成声明，再把全部 retrieved contexts 拼接进行 NLI，最后计算支持声明比例；没有声明返回 NaN。

迁移：声明分解和支持判断是不同任务；没有可核对对象不能算通过。把声明绑定具体证据，比对整答输出“可信度”更可复核。

限制：这是评测组件，生成式声明拆分自身会遗漏条件或改变含义；拼接所有上下文也不等于验证每个引用是否引用正确。我们不能直接以这个总分拦截线上回答。应保留回答原始 span、原引用 ID、适用条件，以及未能绑定的声明覆盖率；局部诊断不能给整份答案认证。

## 本轮可交付契约与后续方向

下列区分正在接线的 v1 实现与后续建议；没有新增通用“需求槽”的生成/匹配器，也没有把 Ragas/Self-RAG 安装进产品。实际完成情况仍以集成验收报告为准。

### A. 保留规划，删除全局接管前置门

本轮 v1：自适应模式不再以“所有维度均确定”为原生成式规划的前置条件。规划继续生成原有意图、改写和分解，同时可提出绑定当前用户逐字原话的来源动作。代码排除无依据、局部对象、重复标识或冲突动作，再以一次 Decision 请求核验可执行的全局媒体来源动作。没有可执行提议时零调用；失败或灰区保留原字段。此处目前只覆盖 image/audio/video 来源动作，并非通用任务槽或任意任务规划。严格模式仍作为独立诊断工具保留，不包装成日常更高质量模式。

### B. 用实际可见证据替代整套检索基线的全局 novelty

本轮 v1：先按原行为完成 ContextBuilder 选择、编号、格式化和压缩，以最终可见 context string 及其 hash 为本地重复检查依据。候选 span 保存原始 chunk ID、原文位置、原文/片段 hash、是否局部来源；尚未创建每个可见 span 的结构化清单。已有 chunk ID 不能直接排除，因为同一 chunk 未展示的后半段可能恰是有效补充。

checkpoint 接收查询、最终可见正文和同一授权召回池中的候选。代码定位完整有界段落并排除已展示的文字；Decision 只判断候选窗口的角色（回答信息、条件/例外、反证、不适用、无关或不确定），不再询问相对整套基线的全局信息增量。模型并未核验整个可见上下文；本地未发现重复也不能写成“相对全部来源全新”。过长候选选择完整段落时记录位置与局限，不能冒称核对全文。

原文本、引用编号和分数逐项不变；最多追加两项，追加的是经过检查的相同文本。失败、无合格候选或不确定均保留原结果。初版不允许 Decision 删除基线、扩大知识库/文件权限或自动新增搜索轮。Agent 在最终合并和显式材料绑定之后共用一次 checkpoint，避免每轮重复付费且检查最终看不到的内容。

后续建议：把可见正文进一步记录为结构化 span 清单，并在已有规划能够可靠产出需求对象时引入证据槽匹配。它们不是本轮已交付能力，不应出现在当前 UI 的成功声明中。

### C. 检查点具有明确的机会、预算和回执

本轮 v1：先用代码排除相同可见文本、重复候选 span、无候选、无可用来源等不产生操作的情形；按已有查询与完整段落的匹配选择有限候选。保留未检查/超界状态，不因为重复 chunk ID 丢掉隐藏段落；没有候选时不调用模型。

继续使用阶段总 deadline、候选/字节上限、最多两项追加、取消传播和无隐式重试。本轮把 Agent 补证移到最终上下文，避免子查询逐轮触发；原生客户端仍使用每路由/每进程额度，尚不是统一的账户或聊天金额预算。用量分别记录已发起、已返回、已完成判断、实际采用，部分回执成功不等于采用成功。统一整轮预算是后续工程方向。

本轮来源动作进一步按模型和用途拆分策略记录：要求来源与排除来源分别保存开发阈值、独立 holdout 状态，以及是否获准实际应用。达到模型信号门槛仍不等于生效；未获准用途可正常调用并记录判断，必须保持 `observe_only`，不能借统一高阈值代替验证。UI 展示具体动作回执中的门槛与实际应用结果，不内置通用 0.85。最终获准清单以独立 holdout 和准入回执为准，本文不预先声明某个模型已通过。最终上下文补证检查点的应用门槛单独记录，不继承来源动作的准入结果。调用比例优化仍不能代替错误率验证。

### D. 本轮引用仍是诊断，先校准对象再谈自动修复

本轮不修改引用诊断行为，保留 shadow 与当前单位、否定和歧义处理，不把流出答案无声改写。后续应区分“实际供给生成器的文本”与“来源完整内容”，不要将两者默认为同一审计范围；结构化可见证据清单就绪后再复用它校对 provenance。

本轮不交付自动重新生成、自动拒答或整答认证。若未来引入生成前 draft→局部检查→一次修复，必须另行定义流式发布时机、修复预算、失败时输出什么，以及修复后重新核对；它不是给现有 shadow 加一个开关即可完成。

## 可证伪的优先实验

冻结同一批文本事实、代码/版本文档、媒体派生文本和 Agent 多子任务样例，分开标注“基线已充分”与“实际可见上下文遗漏”。必须包含长 chunk 中关键事实在 500 字符之后、相关但重复、版本错误、反证、原文证据本身缺失，以及未能从媒体摘要判断原件内容的例子。

开发/校准集合与锁定 holdout 分离；按相同候选池比较 off、现有 v2 和新 checkpoint，另用少量真实端到端调用检查执行路径。先报告下面的事实，不用一个总分掩盖失败：

- 原上下文/编号/权限保留率；未完成或失败仍计入全部尝试。
- 有效需求覆盖新增、错误补入、重复补入、关键遗漏；各任务族分别报告。
- 检查到的材料比例、弃权率、采用率及采用项精确率。
- 每轮实际请求、token、费用可知性与完成等待；记录预算耗尽。
- 输出答案的有依据事实正确性与需求完整性，和模型判断标签分开。

若新检查点仍在可见上下文有缺口时系统性漏补，或增益仅来自扩大上下文配额，则应撤销“Decision 质量增益”结论。新增原始证据但不调用 Decision 的同配额控制组，可分离额外两项材料本身的效果。只有检查点相对该控制组带来可重复的有依据覆盖改善，并满足冻结的误补入/延迟容忍范围，才值得转为日常推荐。阈值、容忍范围和样本数应在新调用前写入协议；不要看完结果后再定义通过。
