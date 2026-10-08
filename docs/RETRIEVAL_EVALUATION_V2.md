# 检索评测 v2

v1 的 7 份合成文档、8 道题继续用于快速回归。v2 增加公开全文语料、证据级真值、现有多模态知识库的只读评测和真实模式对照，用于判断优化是否找回了回答所需的证据。

冻结设计见 [`protocol.json`](../evals/retrieval_v2/protocol.json)，本次执行配置见 [`execution-20261008.json`](../evals/retrieval_v2/execution-20261008.json)。这些实验结果不能替代最终回答正确性、引用蕴含关系或原始媒体理解能力的评测。

已执行结果见 [2026-10-08 评估报告](RETRIEVAL_EVALUATION_20261008.md)。汇总的初版和修订版均保留，修订版将未暴露的请求计数标为未知，并展示 Pi 自身的请求台账，检索分数未改变。

## 数据与适用范围

| 数据 | 本次范围 | 标签来源与限制 |
|---|---|---|
| SciFact | 全部 5,183 篇摘要，17,031 个不重叠的三句片段；300 道测试声明 | `cited_doc_ids` 映射的目标文档和人工句子 rationale；188 题有句子证据，112 题证据标签未知，不能当无答案题 |
| SciFact 开发集 | 从原 train 筛出的 537 题 | 排除与测试集相同的规范化问题及引用文档；本次未据测试结果调参 |
| 现有知识库 | 1,661 条索引记录、87 个索引来源、80 道题 | 依据冻结内容编写并核对；不是独立人工盲标，媒体描述和 ASR 可能存在错误 |

本地题目包含 24 道文本、16 道图片、12 道音频、20 道视频、4 道跨模态和 4 道限定来源的无答案题。共享来源及跨来源问题合并后为 35 个 bootstrap 样本组；80 道题不等于 80 个独立样本。图片来源包括 PDF 提取图，87 个索引来源也不等于 87 份独立上传资料。

公开语料来自 [allenai/scifact](https://github.com/allenai/scifact)，下载地址和固定 SHA-256 在 importer 中。归属及许可元数据保存在数据 manifest。支持和反驳声明的 rationale 都是相关检索证据。本实验使用自定义片段检索协议，不是官方 BEIR 排行榜成绩。

本地快照只调用知识目录与 Qdrant scroll，不复制向量，不解析、上传或重新向量化已有资料。快照、标注、原始模型回执、Pi 运行证据和抽查的原始媒体保存在被 Git 忽略的 `data/retrieval-evaluation-20261008/`。对外仅发布必要的汇总和哈希。

## 指标

- **Document Recall/nDCG/MRR@K**：前 K 个实际交付片段中的文档相关性。重复文档只在首次出现时得到增益，不能与“前 K 个去重文档”的分数混比。
- **Evidence Group Recall@K**：已找回的必需证据组比例。组内某个可接受方案的全部锚点都满足才算命中；多种正确证据方案之间为 OR，同一方案内部为 AND。
- **All Evidence Groups Hit@K**：全部必需证据组是否找齐。命中正确文件、错误段落不能得证据分。
- 锚点绑定冻结来源版本和精确引文；需要时间片段时，还要求所交付区间覆盖至少 50%。字符区间要求至少 80%，同时引文必须出现于相应交付内容。跨度跨多个片段而单个片段均未包含完整引文时，当前规则保守计为未命中。
- 无答案题不进入文档 Recall 分母。分别记录是否返回候选、是否成功返回空结果；失败不能算成功拒答。**返回候选率不等于错误回答率**。
- 失败保留在应答题的分母中，主指标按零计分；失败前已有的观察、用量和原因仍保存在回执中。
- qrels 不完整时，未判定文档在常规 IR 指标中按零增益处理，但不能据此声称已确认为不相关。另报 judged fraction/precision；空输出的这两项按零记，须结合失败率和无答案指标解释。
- 成对比较使用 2,000 次固定种子的来源关联组 bootstrap，给出差值的 95% 区间。它刻画查询组抽样的不确定性，不估计重复运行或服务商波动。

评分拒绝缺题、重复记录、混合配置、内容/来源版本不匹配、伪造位置、非有限分数和未声明的对照配置变化。原有 v1 比较也增加了模型栈、有效评测覆盖率及数值有效性检查。

## 对照的含义

| 模式 | 实际运行内容 | 时间口径 |
|---|---|---|
| BM25 | 完整公开语料；英文词与中文二字词诊断基线 | 已建索引后的本地查询 |
| Dense | 生产 embedding 路由，隔离 NumPy 精确余弦检索 | 预计算查询向量后的本地查询 |
| Hybrid | Dense + BM25，固定 RRF 参数 | 同上；BM25 不等于生产 BGE-M3 Sparse |
| Hybrid + rerank | 上述候选的前 20 条调用生产 reranker，其余保留 | 本地查询加真实重排请求；不含预计算 embedding |
| Direct / legacy-agent | Chat 使用的真实检索服务类，原生配置和 fallback，读取现有索引 | 包含预处理、检索与最终证据选择，不含回答生成和 HTTP 开销 |
| Pi | `/api/pi/runs` 的真实持久任务，收集本次实际观察的证据 | 包含规划、工具、回答/检查；170 秒后取消，外层 180 秒预算 |

Pi 按首次取得证据的顺序评分，去掉完全重复的观察；这不是最终答案的引用顺序。新媒体观察或计算结果没有冻结的文本金标准，明确计入未评分观察数量。Pi 的时间不能直接当成同预算的检索延迟，与 Direct/legacy 的差异也不能全部归因于检索算法。

原始媒体的少量抽查只证明对应样本的观察，不会自动把整套媒体标注升级为已验证真值。Pi 原生目录可把 PDF 图片关联到父文档；评测以冻结 point ID、知识库和实际交付内容定位真实索引来源，保留原生文件别名，不能只凭父文档 ID 给图表加原文证据分。

本次本地三种模式分别以并发 2 在同一机器执行，服务和存储共享；公开重排也使用并发 2。因此时间为该负载下的描述性测量，不作为隔离条件下的因果性能比较或 SLA。记录实际 token 回执，不把缺失用量填成真实零成本，也不按不确定价格虚构金额。

## 运行与复算

所有命令在仓库根目录运行。准备数据使用新的输出目录；冻结产物禁止原地替换。

```bash
.venv/bin/python scripts/rag-eval retrieval prepare-scifact \
  --output data/my-retrieval-eval/scifact \
  --cache data/my-retrieval-eval/download

.venv/bin/python scripts/rag-eval retrieval validate \
  --dataset data/my-retrieval-eval/scifact/manifest.json

.venv/bin/python scripts/rag-eval retrieval prepare-dense \
  --dataset data/my-retrieval-eval/scifact/manifest.json \
  --output data/my-retrieval-eval/dense --batch-size 32 --concurrency 2

.venv/bin/python scripts/rag-eval retrieval run \
  --dataset data/my-retrieval-eval/scifact/manifest.json \
  --profile hybrid-rerank --index data/my-retrieval-eval/dense \
  --output data/my-retrieval-eval/run-hybrid-rerank --concurrency 2
```

`--profile bm25` 不需要 `--index`。Dense、Hybrid 与重排复用同一批向量。Embedding 的共享语料/查询准备时间和用量单列，不将其平均摊入某个模式冒充端到端时间。

```bash
.venv/bin/python scripts/rag-eval retrieval snapshot-local \
  --output data/my-retrieval-eval/snapshot

.venv/bin/python scripts/rag-eval retrieval prepare-local \
  --snapshot data/my-retrieval-eval/snapshot \
  --annotations data/my-retrieval-eval/reviewed-cases.jsonl \
  --output data/my-retrieval-eval/local

.venv/bin/python scripts/rag-eval retrieval run \
  --dataset data/my-retrieval-eval/local/manifest.json \
  --profile direct --output data/my-retrieval-eval/direct
```

本地可将模式改为 `legacy-agent` 或 `pi`。`direct-http` 提供已运行实例的检索 API 测量，原生 API 未暴露全部 token 用量，报告将标明缺口。标注每题应含独立性组、范围、answerability、qrels 完整性和来源版本绑定的证据组。无答案标注必须对有限范围做完整核验；没有句子标签不等于没有答案。

```bash
.venv/bin/python scripts/rag-eval retrieval score \
  --dataset data/my-retrieval-eval/local/manifest.json \
  --predictions data/my-retrieval-eval/direct/predictions.jsonl \
  --output data/my-retrieval-eval/direct/recomputed.json

.venv/bin/python scripts/rag-eval retrieval compare \
  --baseline data/my-retrieval-eval/direct/report.json \
  --candidate data/my-retrieval-eval/agent/report.json \
  --allow-change profile --output data/my-retrieval-eval/comparison.json
```

比较只允许显式列出的配置变化，不会自动宣布候选上线。各题的集群身份与指标有效分母必须一致。

## 中断、故障与审计

运行目录有进程锁、冻结协议、每题 pending 和追加写入的 JSONL。重启同一命令会跳过完成记录；未确认的付费尝试保留为中断失败，不自动重试。Embedding 缓存保存输入指纹、向量校验和、实际模型和服务回执；未确认/已失败批次要求显式检查，不能悄悄覆盖。

首轮公开重排出现了传输错误及其引发的健康冷却拒绝。该轮全部 300 题与失败原样保留。`scripts/run-retrieval-availability-control.py` 另跑完整测试集，在下一题开始前等待冷却结束，不重试本题失败；这是明确标注的可用性控制实验，不把零耗时拒绝当成重排计算速度。

采集层发现的来源别名问题，可以基于已保存的原始 Pi 证据离线重新解析。修正版必须另存，并记录原始回执哈希、采集状态、规范化版本和具体修正；不能重调模型来替换失败，也不能改变真值标签。

本轮的可复算工具为 `scripts/replay-local-evidence.py` 和 `scripts/summarize-retrieval-evaluation.py`，分别生成来源规范化审计及不包含私有问题/证据正文的汇总。它们均要求新的输出目录。

```bash
cd backend
../.venv/bin/python -m pytest tests/test_rag_evaluation.py tests/test_retrieval_evaluation_v2.py -q
```

下一阶段的数据建设应优先增加独立知识来源、真实用户问题、人工复核证据和原始媒体核验，再扩大同一来源上的改写题。预留从未参与调参的持续保留集，按真实失败归因追加回归样本，并把候选池覆盖、重排前后变化、引用正确性和最终回答质量分层评估。
