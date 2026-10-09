# Decision 检索策略：来源审阅与设计依据

检索日期：2026-10-09。以下页面已打开阅读；GitHub 实例已下载源码并固定 commit。本文区分供应商协议、供应商演示、社区实现与本项目的设计推论。未安装这些项目，未调用模型，未读取凭据。

## 核心结论

Decision 的优势是对给定证据做多个小而明确的判断，让代码据此组织行为。它不应承担隐含的完整任务规划，也不应以一个总分替代需求覆盖、事实支持、主体一致性等不同判断。类型合法只证明输出符合协议；概率较高也不构成正确性保证。

对 Tessmora，值得迁移的是独立需求判断、显式弃权、按证据来源限定审计结论、有界批量和可重放的策略评测。现有检索路径可以保留为基线；Decision 负责补充信号，是否采用信号由统一策略层决定。

## 1. OpenAI 官方 Decisions 文档：输出是判断，不是计划

- [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)：重点阅读 “Choose a question type”“Ask multiple questions”“Interpret the answers”。
- [Create a decision API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)：逐问题 `refusal`、返回类型和输入约束。

官方定义 `predicate`、`choice`、`score`，分别表示条件概率、固定集合选项、有序等级。共享输入上的独立问题可以同请求；真正依赖先前结果的判断需要后续请求。阈值应由应用标注数据和误报/漏报成本决定。

**迁移：** 将“需要检索图像”“需要音频材料”等可同时成立的条件独立建模；“需要/不需要/不确定”的产品状态由概率和策略转换。不要把语义接管与协议成功混成一个布尔值。保留每个问题的拒答或无效状态。

**边界：** OpenAI 原生的 `input/questions[]/predicate` 与 OpenRouter 的 `state/questions{}/noul` 不是相同线协议。模型名也不同：原生使用 `gpt-6-luna`，OpenRouter 使用 `openai/gpt-6-luna-decisions`。官方文档的低延迟主张不等于本项目实测性能。

## 2. TypeSafe 官方原语与置信度：独立条件与单选不能混用

- [Primitives](https://docs.typesafe.ai/primitives)：问题类型、问题独立性、显式 state 路径、分解复杂判断。
- [Noul](https://docs.typesafe.ai/primitives/noul)：二元命题概率与不确定性。
- [Confidence](https://docs.typesafe.ai/confidence)：当前文档公开 Choice/Score 的计算方式。

Noul 的接近 0.5 表示不确定，不是中等强度；Choice 用于固定集合内选一项。TypeSafe Choice 的 confidence 来自同一概率分布，公式为 `(p_max - 1/n) / (1 - 1/n)`。因此 `p_max >= x` 与 `confidence >= y` 是关联门槛，不能称为两份独立验证。Score 的 confidence 还取决于有序等级的距离。

**迁移：** 给每个判断定义可观察条件与版本；阈值按任务和模型校验。范围过滤、权限、数字计算及引用定位继续由代码负责。保留完整原始分布供离线重放，不把另一供应商的 confidence 擅自按 Jev 公式重算。

**边界：** 多个问题计算上独立，不代表其错误统计独立；不得将多个 Noul 直接相乘并宣称获得已校准的联合正确率。Choice 选项数或语义改变后，旧阈值不能直接视为仍有效。

## 3. 官方开源实例：集合参数确实使用逐成员 Noul

仓库：[typesafe-ai/typesafe-public-examples](https://github.com/typesafe-ai/typesafe-public-examples)，commit `c3698912a6b40a1675d229cf2c90d9998e2e474d`。

- [`dispatch.py:67–91`](https://github.com/typesafe-ai/typesafe-public-examples/blob/c3698912a6b40a1675d229cf2c90d9998e2e474d/cookbooks/function_calling/dispatch.py#L67-L91)：单值枚举生成 Choice，集合枚举为每个成员生成 Noul。
- [`dispatch.py:181–192`](https://github.com/typesafe-ai/typesafe-public-examples/blob/c3698912a6b40a1675d229cf2c90d9998e2e474d/cookbooks/function_calling/dispatch.py#L181-L192)：代码分别判断是否纳入集合。
- [`dispatch.py:94–106`](https://github.com/typesafe-ai/typesafe-public-examples/blob/c3698912a6b40a1675d229cf2c90d9998e2e474d/cookbooks/function_calling/dispatch.py#L94-L106)：路由与可预先构造的参数判断同批发送。

**迁移：** 多模态需求是集合；分别识别后，代码检查各需求是否拥有实际检索路径与证据。不要用“有一个显式需求”代表需求集合完整。

**边界：** 该例的 0.5 成员阈值、参数概率乘积是演示策略，不是经过本项目验证的默认值。检索中漏掉一个模态与多搜一个模态的代价不同，应分别设定接纳、排除和弃权范围。

## 4. 官方 RAG cookbook：关系分解比单一相关分更有解释力

[Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) 对每个 query/passage 提问四个 Noul：相关性、回答证据、反驳问题前提、试图操控生成器。代码根据这些信号分配普通证据、冲突证据或排除。演示使用 81 篇片段、6 个问题及植入的对抗片段，结果记录于 `jev-1.12`。

**迁移：** 补证应区分可回答信息与对问题错误前提的纠正；负面证据同样有用。主体、时间和适用条件应能独立限制“相关即有用”的误判。保存决策信号与采用原因，使策略调整能离线重放。

**边界：** 该演示的四个阈值只适用于其案例；没有证明在本知识库优于 Qwen Reranker。对抗检测只是过滤信号，不是安全边界。把原基线整体过滤掉不符合本项目保留原路径的要求，可先用于补充候选与诊断。

## 5. 批量设计：同证据多问题，与无限扩大输入是两回事

[Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) 对同一约 5.4 万字符文档的 13 个问题重复 5 次，比较同批与逐题调用；页面报告 12.2 倍成本差、10.0 倍总耗时差。逐题耗时按串行累加，不能等同于并发调用的差距。

[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) 则说明无关上下文、间接推理、选项顺序、对抗数据和数字/时间处理的局限。

**迁移：** 同一短输入的多维判断应尽量合并；多证据项使用有界微批、明确索引、稳定 ID、逐项结果校验和超时预算。真正依赖新检索证据的检查应在证据到达后执行。

**边界：** 不依据该演示承诺本项目加速 10 倍，也不为追求单次请求把整个知识库打包。代码需要记录截断、未检查及拒答，避免把没评估当成低相关。对选项顺序与微批大小的敏感性应进入评测。

## 6. 引用关系与主体一致性：已阅读社区实际实现

仓库：[jkudish/jev-mcp](https://github.com/jkudish/jev-mcp)，commit `86eae7861c60ea99a1b2eab2881db0fb1164fcc0`。

- [`server.ts:215–290`](https://github.com/jkudish/jev-mcp/blob/86eae7861c60ea99a1b2eab2881db0fb1164fcc0/src/server.ts#L215-L290)：逐声明的关系 Choice 和同一主体 Noul 同批发送；异主体的矛盾改为缺乏支持并要求复核；缺失结果与真实“无支持”分开。
- [`server.ts:1591–1614`](https://github.com/jkudish/jev-mcp/blob/86eae7861c60ea99a1b2eab2881db0fb1164fcc0/src/server.ts#L1591-L1614)：检查选项集合、有限概率、范围、总和及选项是否为最大值；无 confidence 不假装为确定。

官方 [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check) 先用代码定位引用文本，再问所在段落与声明的关系。

**迁移：** 严格模式必须严格处理协议异常与语义弃权；诊断区分未提取、未评估、无支持、冲突和执行失败。精确引用身份检查先于模型判断。

**边界：** 社区实现不是独立准确率证据；其 same-subject 门槛也未在本项目校准。官方示例将精确匹配失败称为 fabricated，不适合直接用于允许转述的引用系统，需保留“未定位”的客观状态。

## 7. 多模态能力必须按模型和实际输入报告

[OpenRouter Multimodal Decisions](https://openrouter.ai/docs/guides/community/multimodal-decisions) 明确列出 Luna Decisions 的图像输入能力，Jev 仍为纯文本；图片需放在 state 顶层数组，以 base64 data URL 的 image part 传入。[Luna model page](https://openrouter.ai/openai/gpt-6-luna-decisions) 说明其可在同请求中判断多个问题。

**迁移：** 给审计输入标明 `source_text`、`image_description`、`audio_transcript`、`video_description` 或 `raw_image` 等证据类型。纯文本代理可核对回答是否忠于已提供的描述/转录，但 UI 应直接标明检查对象。

**边界：** “与图像描述一致”不能写成“原图已验证”；音频转录不能证明配乐风格，视频摘要不能证明未描述的画面。不能仅因供应商支持多模态，就在未发送原图时报告视觉审计。不同供应商的图片和 question 数量限制应由适配层掌握。

## 8. 评测优先的社区工具：复用方法，保留失败分母

仓库：[BYK/jev-mcp](https://github.com/BYK/jev-mcp)，commit `cee2e6d58112d006ccd3ebad1163a31083262ae9`。

- [`metrics.ts:72–98`](https://github.com/BYK/jev-mcp/blob/cee2e6d58112d006ccd3ebad1163a31083262ae9/src/metrics.ts#L72-L98)：概率校准误差。
- [`metrics.ts:160–217`](https://github.com/BYK/jev-mcp/blob/cee2e6d58112d006ccd3ebad1163a31083262ae9/src/metrics.ts#L160-L217)：Noul 阈值扫描、Brier、接受覆盖率与接受项准确率。
- [`evaluate.ts:228–289`](https://github.com/BYK/jev-mcp/blob/cee2e6d58112d006ccd3ebad1163a31083262ae9/src/tools/evaluate.ts#L228-L289)：同样本比较多个问题版本并保存结果。

**迁移：** 固定带标签的需求/证据/引用样例，同时报告语义错误、弃权率、接受覆盖率、实际任务覆盖和耗时；保留模型、协议、prompt、策略版本和原始回答。

**边界：** 此源码的质量指标只对有回答项计算，失败另行汇报；本项目应同时保留全部尝试分母和端到端成功率。不能在同一测试集选择最佳阈值后，再用该集合报告无偏质量提升。小样本的 ECE 或 Brier 也不是可靠性保证。

## 本项目的设计推论与验证要求

下列是本次来源审阅形成的设计判断，不是供应商已证明的结果：

1. **将执行方式与语义采用分离。** `off` 保留基线；观察模式记录；自适应模式按证据接纳；严格执行不能等于无条件相信低确定性判断。
2. **建立独立的需求集合。** 每个模态分别记录 required / unnecessary / uncertain，检查检索执行与最终证据覆盖，避免某一需求成功掩盖其他需求缺口。启用后的补救仍须遵守原授权知识库和材料范围。
3. **把补证变成有依据的增量。** 不改变基线顺序及引用身份；在有界候选中检查回答价值、主体/条件匹配、冲突价值及重复。没有合格补充则明确保持原结果。
4. **给审计设置证据边界。** 文本、描述、转录、原图分别说明；无可检查材料时显示未评估，不能以绿色通过替代。
5. **用分层证据验证设计。** 单元测试证明策略与回退；合同测试证明供应商协议；冻结的真实调用证明在样例上的语义行为；用户知识库配对测试才证明实际收益。失败和无提升结果同样保留。

本轮调研没有找到足以证明所有 Decision 模型在中文多模态 RAG 中可以共享阈值、共享置信度含义，或稳定优于现有精排器的公开数据。因此接入百炼等供应商时，应复用判断接口和评测协议，不复用未经验证的质量结论。
