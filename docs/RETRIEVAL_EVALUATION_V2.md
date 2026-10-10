# 检索评测

`./scripts/rag-eval retrieval` 提供公开 SciFact 语料和现有知识库的只读评测、证据级评分、逐题失败记录及成对比较。快速回归与生成 judge 见 [RAG 基线](RAG_EVALUATION.md)。

## 数据与指标

公开数据导入器从 [allenai/scifact](https://github.com/allenai/scifact) 下载并验证固定 SHA-256；归属和许可随生成 manifest 保存。默认使用全部摘要、每三个句子一个检索单元。这是自定义协议，不能等同于官方 BEIR 排行榜成绩。

本地快照只读取目录与 Qdrant payload，不复制向量、不重新解析或入库。标注须绑定冻结来源与精确引文，并区分必须证据、等价证据、模态/区间限制及无答案题。用户文档、媒体、标注和模型回答都留在本地。

| 指标 | 解释 |
| --- | --- |
| Document Recall/nDCG/MRR@K | 前 K 个交付片段中的文档相关性，重复文档只在第一次获得增益 |
| Evidence Group Recall@K | 必需证据组的覆盖；组内可替代方案为 OR，同方案多锚点为 AND |
| All Evidence Groups Hit@K | 是否找齐全部必需证据，不等同于最终答案正确 |
| 无答案行为 | 空结果、返回候选、执行失败分别记录；候选存在不等于错误回答 |

时间锚点要求至少 50% 区间覆盖，字符锚点要求至少 80% 且实际交付内容含精确引文。失败保留在分母中，不能删去失败题再算成绩。不完整 qrels 不能证明未判定资料不相关。

成对比较按来源关联组进行固定随机种子的 bootstrap。区间刻画查询组抽样，不代表服务商波动或重复运行可靠性。比较前核对数据指纹、任务集合、模型配置、Top K、阶段和预算，不能把 Pi 最终引用与 Direct 检索候选当成完全相同的排名任务。

## 公开数据示例

以下在仓库根目录、后端环境激活后运行。数据与输出不进入 Git；SciFact 下载需网络，BM25 评分不调用模型。

```bash
./scripts/rag-eval retrieval prepare-scifact \
  --output data/evaluation/scifact --cache data/evaluation/downloads
./scripts/rag-eval retrieval validate --dataset data/evaluation/scifact/manifest.json
./scripts/rag-eval retrieval run \
  --dataset data/evaluation/scifact/manifest.json --profile bm25 \
  --output evals/runs/scifact-bm25
```

`prepare-dense` 会调用配置的 embedding 服务并产生费用。`dense` / `hybrid` / `hybrid-rerank` 需要通过 `--index` 指定生成的向量索引；最后一项还调用重排服务。Hybrid 的 BM25 不能等同于生产的 BGE-M3 Sparse。

```bash
./scripts/rag-eval retrieval prepare-dense --help
./scripts/rag-eval retrieval run --help
./scripts/rag-eval retrieval compare --help
```

## 自有知识库与复核

1. `snapshot-local`：只读保存当前目录与索引。
2. 冻结人工核验的标注，用 `prepare-local` 生成版本化数据集。
3. 用 `direct`、`direct-http`、`legacy-agent` 或 `pi` 运行；它们有不同的编排、预算和时间口径。
4. `score` 离线复算；`comparison-readiness` 检查可比性，`compare --require-matched` 在要求严格配对时拒绝不匹配输入。
5. 标签修订使用 `revise-labels` 和 `replay-labels`，输出到新目录；`audit-pi` 分别核对研究观察与最终引用，并记录未核验媒体。

每个子命令的 `--help` 列出必填字段。缺题、重复记录、来源版本不符、非有限分数及未声明配置变化会被拒绝。失败、中断和原始回执保留，重跑使用新输出目录；模型配置、代码版本与数据哈希应随私有实验归档。

历史阶段报告不随源码分发，也不作为当前性能承诺。完整实验可存储在独立研究归档或发布资产中，主仓库只保留维护中的评测工具和明确用途的最小夹具。
