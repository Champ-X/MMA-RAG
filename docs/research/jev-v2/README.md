# Jev 第二轮：独立扩展评估与语义意图快路径

日期：2026-09-22。分支：`feat/jev-optm-2`。保留[第一轮报告](../jev/README.md)，其 80 题结果只作为本轮开发依据，不再用作独立验证。

本轮实测否定了“用 Jev 替换 Qwen 重排”和“两个分数简单融合”的采用方案。代码新增的方向是 **Jev 判断简单查询的意图，复杂或不确定查询回退现有生成式处理器**。后续 QueryRewriter、知识库/文件范围、多模态证据保护和 Qwen 重排继续执行。

## 研究补充：哪些社区用法值得借鉴

Jev `jev-1.13.0` 是通过 `state + typed questions` 做窄语义决策的服务。Choice 返回选项与概率，Noul 返回二元判断分数，Score 对有序标准评分。它不负责生成完整回答、查询改写、向量嵌入或多跳推理；本轮没有把“能返回合法 JSON”当作“语义正确”。

本轮来源在 [sources.json](sources.json)，包含 URL、抓取时间、内容 SHA256 和本地快照。下列第三方数字均为作者自报，本项目没有重新跑他们的实验。

| 来源 | 读到的实际做法 | 对本系统的启发及证据边界 |
| --- | --- | --- |
| [官方 semantic_find](https://docs.typesafe.ai/cookbooks/semantic_find) | Choice 选择行号，另一个 Noul 判断答案是否存在 | 闭集强制选项不能表达无答案，必须另做可回答性判断；不能仅凭 argmax 返回证据 |
| [官方 skill_suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) / [hierarchical_classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) | 将路由拆成小决策，批量计算适配度或分层类别 | 适合媒体需求/是否需要生成式分析，而非替代所有预处理功能 |
| [官方 consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) | 临界分数会随重复请求越过阈值，建议设置不确定区间 | 本轮使用保守拒绝门，概率不是经过业务校准的正确率保证 |
| [官方 SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade) | 小模型抽取后进行窄任务检查，再决定升级 | 示例包含刻意构造的错误抽取；只能支持设计思路，不能当作本系统效果证据 |
| [onlyjq04/jev-agent-hooks](https://github.com/onlyjq04/jev-agent-hooks) | 实测 34 个技能建议轮次；cookbook 的 0.3 阈值迁移后会多推技能，二级 gate 区分不足 | 社区阈值不能直接照搬；要测覆盖率、误接管和额外请求开销 |
| [sutro-sh/jev-align](https://github.com/sutro-sh/jev-align) | 用 GEPA 与标注样本优化问题/选项描述，可留出 20% 评估集 | “选项描述”是模型接口的一部分；本轮只在开发集改提示词，并按语义家族分组留出 |
| [chopratejas/invalidate](https://github.com/chopratejas/invalidate) | 记忆有效性判断先筛选再复核；相似干扰项可能影响批量判断，破坏性失效判定需单独复核 | 不让 Jev 修改权限/删除证据；重排每个 passage 独立放在问题内。仓库多个适配器仅通过 mock SDK 测试，不能称为已验证生产集成 |
| [AHTOOOXA/jev-cyrillic-audit](https://github.com/AHTOOOXA/jev-cyrillic-audit) | 每任务 600 对英俄样本；XNLI 准确率 88.3%→77.3%，MASSIVE 则未发现显著差异；概率两位小数 | 语言和任务迁移风险不同，不能用英语分类成绩推断中文 RAG 收益；本轮本地门限不能推广为通用置信度 |
| [zhlei07/open-system-one](https://github.com/zhlei07/open-system-one) | 10,000 个分类任务、CPU 本地基线与 Cloudflare Jev；比较裸标签和扩展描述 | README 自报 Jev 扩展描述 macro 79.3%，149M NLI 裸标签 78.7%；不是 Jev 开源权重。检查 `data.py` 发现合并有标签的官方 splits 后重新划分，不是原官方 test；单 seed 无 CI，带标签温度校准也不对等。`out/REPORT.md` 与更新后 README 覆盖的模型不同，不能混合引用其“最佳结果” |

该社区仓库还测试了中文 TNEWS，但那一节评估的是 **Laya 英文/多语模型**，不是 Jev：英文模型自报置信度很高而准确率很低。不能把这张中文表错当作 Jev 的中文成绩。

有标注数据时，专用分类器/NLI 仍是合理候选。本轮没有额外训练本地分类器，也没有证明 Jev 优于一切廉价替代方案。当前基线使用生成式 `aliyun_bailian:qwen3.5-plus`，部分时间收益来自省去其开放式输出及推理开销。

## 数据、预先确定的策略与可重现性

本轮共 **432 道不同题目**，不把配对调用或失败重测计算成新题：

- **300 道公开检索题**：C-MTEB/T2Reranking，排除 v1 已见 query，seed `20260922`，60 开发 / 240 留出；3,650 个 query–passage 对，每题最多 2 正例与 18 负例。保留真实 hard negatives 和原标签，词面排序后进入项目候选选择、截断、0.7 精排 + 0.3 粗排融合。比较 Qwen、Jev、预先固定的 50:50 融合和诊断级 cascade。
- **120 道意图题**：102 道单轮 + 12 道历史对话 + 6 道附件；30 开发 / 90 留出。语义家族跨集合隔离，包含否定媒体、代码标识符、引用标题、中文/英文、隐式需求、文本输出仍需媒体来源、跨模态、多跳问题。标签在调用前编写，但没有独立人工双人标注。
- **12 道系统题 / 57 份文本 / 2 个隔离知识库**：相近项目名、旧版/正式版/草案限额冲突、跨文档审批与日志期限、另一租户同名事实、文件范围、非可信笔记中的排序指令、无答案字段。真实 Qwen 4096 维嵌入、真实 BGE-M3 稀疏编码、Qdrant、MinIO、RetrievalService、QueryRewriter 与 Qwen 重排；其中 3 题配对生成回答和引用。

三个数据集的 manifest 均包含内容哈希，位于 [`evals/jev_v2`](../../../evals/jev_v2)。120 MB 公共源 parquet 保存在忽略目录 `data/jev-v2`，SHA256 与发布文件核对，冻结的选中题目随分支保存。Mmarco 下载失败，**没有计入**本轮数据集或结论。

意图门限：四个 Choice 的选中概率均 ≥0.75，`is_complex` 与 `needs_context` 的 Noul 均 ≤0.20；已有历史、附件、空查询或超长查询不进入该快路径。版本 [`query-decisions-v2-dev2`](prompts/query-decisions-v2-dev2.json) 在留出评估全程保持不变（归档文件于进程启动后补写，未利用留出结果修改提示词/门限）。开发期只修改了“needs_context”描述，避免把“不知道答案”误判为“缺少对话指代”。没有根据留出集挑选新门限。

公开检索采用配对 bootstrap 95% CI；融合方案只有区间支持正收益才考虑采用。指标是 **冻结有限候选池上的排序质量**，不是官方完整榜单成绩，也不是全库召回率。公开 qrels 可能漏标相关段落。合成系统案例测试真实存储及检索，但文本块直接入库，没有验证文档解析、OCR、ASR、视频二进制摄取或前端 UI。

## 结果

### 公开检索：拒绝替换与简单融合

300 道均保留原始记录，298 道双边成功；一次 Jev 超时，一次超过客户端请求上限在发出前拒绝。240 道留出中有 239 道成功配对。

| 成功配对留出 n=239 | nDCG@5 | Recall@5 | P50 / P95（秒） |
| --- | ---: | ---: | ---: |
| Qwen3-Reranker-8B | 0.59394 | 0.73640 | 0.928 / 3.133 |
| Jev | 0.52643 | 0.66736 | 0.971 / 1.573 |
| 50:50 融合 | 0.57414 | 0.70502 | 1.078 / 3.133 |

Jev−Qwen nDCG@5 = **−0.06752**，95% CI **[−0.09998, −0.03391]**；融合−Qwen = **−0.01981**，CI **[−0.04126, −0.00083]**。长尾更短不能抵消本任务质量下降。也未采用先 Jev 再 Qwen 的 cascade，它在 239 题中仍需 227 次 Qwen，P50 反而约 1.91 秒。

[rerank-summary.json](results/rerank-summary.json) 提供成功配对细节；[v2-analysis.json](results/v2-analysis.json) 另列 **全部 240 道留出**的部署策略：Jev 失败回退 Qwen，并把失败等待计入延迟。融合的并行时间为实际测量；替换策略失败后的串行总延迟由两次实测相加估计，不冒充线上实测。

### 意图及真实系统

最终汇总由 `backend/scripts/report_jev_v2.py` 从不可变调用记录计算，见 [v2-analysis.json](results/v2-analysis.json)。`intent-holdout.jsonl` 保留首次运行，包括基线超时及其冷却期间的拒绝；`intent-holdout-repair*.jsonl` 保存明确补测，复用原 Jev 预测，未调整提示词/阈值。报告区分首次运行、成功配对、补测后的分类比较，避免将冷却期间的默认返回算作模型准确率。

基线首轮评估设了 90 秒上限，触发项目自带 15 秒冷却后，后续并发测试可能瞬间收到拒绝。已修正评估器，等待冷却并把后续基线预算设为与生产 manager 总预算一致的 180 秒（provider 单次 socket 超时仍为 90 秒）；首次失败不会删除。补测是稳态分类诊断，不代表消除了线上超时。意图“adaptive latency”由分阶段实测反事实相加；真实串行收益以 `system-paired.jsonl` 为准。

90 道留出中接管 **22 道（24.4%；72 道无历史/附件题中为 30.6%）**，18 道历史/附件全部保留生成式处理。9 道标注复杂问题中误接管为 0；这个分母仍小，不构成安全保证。接管的 22 题中仍有 4 题媒体三元组不符标签，例如视频请求多触发图片分支、地点描述漏判隐式图片需求；冻结门限并不保证每次判定正确。

对 72 道有媒体标签的留出题，补测后基线有 69 道真实成功响应：

| 成功响应配对 n=69 | 基线 | Jev 自适应策略 |
| --- | ---: | ---: |
| 媒体需求三项全对 | 27/69，39.1% | 35/69，50.7% |

准确率差 +11.59 个百分点，按题配对 bootstrap 95% CI 为 [+2.90, +20.29] 个百分点。考虑同一语义家族内样本相关，按 **12 个家族整组 bootstrap** 的区间为 **[0.00, +26.09]**，触及无收益，因此只报告本样本改善，不宣称稳健的普适质量提升。把 3 次失败后的默认输出也计算在内，72 题准确率为 40.3%→51.4%；明确媒体需求召回均为 11/12，多余媒体激活由 53/185 降到 41/185。

实际串行调用的系统结果（12 题 × 两种策略，不含生成耗时）：

| 指标 | 基线 | Jev 意图快路径 + 原 Qwen 重排 |
| --- | ---: | ---: |
| 检索耗时 P50 | 64.87 秒 | 10.11 秒 |
| 检索耗时均值 | 83.27 秒 | 38.49 秒 |
| 检索耗时 P95 | 147.96 秒 | 118.99 秒 |
| 意图阶段 P50 | 59.11 秒 | 0.77 秒 |
| Recall@5 | 95.83% | 95.83% |
| Recall@10 | 100% | 100% |
| 范围泄漏 | 0 | 0 |

自适应策略接管 9/12 道，三个多文档/多实体综合问题均回退原处理器。6 次真实 Kimi 回答均成功、引用 ID 均有效；逐条核对了版本限额 600、审批链与 48/365 天、以及未提供 `video_token` 默认值时明确拒绝补造。详见 [answer-review.json](results/answer-review.json)。这是 12 道合成场景的一次配对实测，不是业务负载 SLA 或大规模答案正确率估计。

意图模块的 90 题补测汇总另有 7 次基线失败（3 单轮、1 历史、3 附件），全部保留。按观测时间反事实组合的策略 P50 为 71.50→65.50 秒、P95 为 90.11→90.88 秒：由于只有 22/90 接管，不能把该模块在所有复杂问题上描述为“秒回”。这里与系统 12 题的查询分布、provider 状态不同，二者不应互相替代。


HTTP 范围测试额外调用 `/api/v1/retrieval/search`，记录在 [http-smoke.json](results/http-smoke.json)。返回了正确的单文件证据，但耗时 65.38 秒：当次远端 Qwen embedding 超时，真实 sparse 与 selected-file 分支仍成功。它证明接口和范围约束工作，**不作为速度提升证据**。系统对比中的 `system-07/adaptive` 等运行也遇到 embedding 超时，长尾如实保留。`system-08/off` 的两份必需材料只有一份进入前 5，另一份在第 9 位，因最终上下文取前 10，生成答案仍覆盖审批、48 小时与 365 天；因此分别报告 Recall@5 与 Recall@10，不能只用“最终答对”掩盖排序不足。

## 实现和启用

```dotenv
TYPESAFE_API_KEY=<从安全环境注入>
JEV_INTENT_MODE=adaptive
JEV_RERANK_MODE=off
JEV_TIMEOUT_S=5
JEV_MAX_INPUT_TOKENS=250000
```

默认仍为 `off`，设置上面的 `adaptive` 可启用本轮实现；隔离系统实验已实际启用，不只是离线计算。未通过验证的重排替换不作为推荐配置，原有 `shadow/replace` 仅保留用于可复现的研究对照。

- `IntentProcessor` 在入口调用闭集判断。通过门限才返回原查询与结构化意图；不会伪造改写或子问题，也不经过会按媒体关键词强制覆盖的旧校验器。
- 复杂性/上下文不确定、历史/附件、传输或类型错误、预算耗尽，均转入原生成式处理器。后续 QueryRewriter 始终执行，保留开放式改写和查询扩展。Agent 已规划子查询仍走已有路径。
- 直接与流式检索把 `jev_decision` 放入请求自己的 debug 信息；不会用实例全局字段交叉覆盖并发请求。
- Jev client 对 Choice/Noul/Score、概率范围、完整 ID、固定模型和 usage 做验证。意图与重排共用 worker 内预算、并发限制和冷却；整个调用含排队有 deadline，没有自动重试，取消向上传播。
- 未知计费的超时/取消保留预算预留。预算是单 worker 生命周期限额，重启会重置，多进程各自拥有额度；不是账户余额检查或跨进程限额。
- 知识库与文件范围由现有代码确定，Jev 没有权限决策权。只提交实际需要的查询（重排实验则提交候选文本），不提交密钥、附件或历史内容。

## 复现

使用项目 Python 环境，并从未入库的配置文件加载 provider credentials。下面的 `PROVIDER_ENV` / `KEY_FILE` 是使用者本机路径参数，不是仓库内的密钥文件。

```bash
python backend/scripts/build_jev_intent_dataset.py
python backend/scripts/build_jev_system_dataset.py

python backend/scripts/evaluate_jev.py --live --dataset evals/jev_v2/rerank \
  --provider-env "$PROVIDER_ENV" --jev-key-file "$KEY_FILE" \
  --split all --max-cases 300 --parallel-providers --timeout 5 \
  --max-jev-input-tokens 3000000 \
  --receipts /tmp/jev-rerank-new.jsonl --report /tmp/jev-rerank-new-summary.json

python backend/scripts/evaluate_jev_intent.py --live \
  --provider-env "$PROVIDER_ENV" --key-file "$KEY_FILE" \
  --split test --max-cases 90 --concurrency 3 --baseline-timeout 180 \
  --output /tmp/jev-intent-new.jsonl --report /tmp/jev-intent-new-summary.json

docker-compose -f docker-compose.eval.yml up -d qdrant minio redis
python backend/scripts/evaluate_jev_system.py \
  --provider-env "$PROVIDER_ENV" --key-file "$KEY_FILE"
python backend/scripts/report_jev_v2.py
```

扩展公开数据构建需要原 parquet，详见 `build_jev_rerank_v2.py` 和 manifest；日常复跑无需重新下载已冻结案例。不要覆盖已保存的证据。系统脚本校验评估端口/环境、使用自己创建的知识库并保存 seed；现有回执用于断点跳过，不自动重试失败付费请求。首次意图运行的缓存时间与补测时间均标识来源。

模型输出的语义错误、低覆盖率、复杂问题仍需生成式处理，以及公开/合成数据与真实业务分布的差异，都是本次实现的边界。不能从这些结果推导“Jev 普遍提升 RAG”或“所有意图判断都可替代”。

## 费用与完成检查

本轮 Jev 已报告输入费用 **$0.100471**；把两次未知计费失败和未暴露 usage 的 HTTP 调用按每次 60,000 token 上限计入，保守上界 **$0.108031**。补测只重跑生成式基线，复用 Jev 原预测，不重复计 Jev 费用。上述数字不包含 Qwen、DeepSeek、Kimi、embedding 费用或 v1 试验，不等于账户最终账单。分项见 `v2-analysis.json → jev_cost`。

[verification.json](results/verification.json) 记录 38 个来源条目校验、数据哈希、无 v1 查询重叠、77 个补测的 Jev 预测一致性、24 次系统检索、6 次生成和 HTTP 范围验证。相关回归 **101 项通过**，`git diff --check` 通过，未发现新增凭据泄漏。改动保留在当前工作分支，未提交或部署。临时评估服务与容器已停止，独立测试数据保留。
