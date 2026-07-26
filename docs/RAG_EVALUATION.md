# RAG 评测基线

这套基线用于发现检索、重排、上下文组装或生成链的回归。默认数据集只有 7 份合成文档和 8 个问题，不含用户资料；数据指纹会覆盖 manifest、用例和语料正文，任何改动都必须显式升级数据集版本。

## 指标口径

| 指标 | 口径 |
|---|---|
| Recall@K | Top K 中命中的不同真值文档数 / 真值文档总数 |
| nDCG@K | 使用 1–3 级 qrel 增益；同一文档的重复结果只有第一次获得增益 |
| MRR@K | Top K 中第一个相关文档的倒数排名 |
| Faithfulness | judge 把回答拆成原子事实声明后，由上下文支持的声明比例 |
| Answer Relevance | judge 对回答是否直接、完整回应问题给出的 0–1 分 |
| Context Precision | 每个相关上下文所在排名的 Precision@rank 均值；有 judge 时使用语义标签，否则使用文档 qrel |

检索指标完全确定性。Faithfulness 与 Answer Relevance 需要独立 judge；未配置 judge 时报告中的两项为 `null`，同时保留 `evaluated_cases=0`，不会伪造分数。报告会记录生成模型、judge 模型、judge prompt 版本、Agent 模式、K 和数据指纹。

## 数据隔离

`docker-compose.eval.yml` 固定使用独立 Compose project，并为 MinIO、Qdrant、Redis 和 SQLite 使用独立命名卷，不挂载普通开发实例的 `minio_data/` 或 `qdrant_storage/`。模型权重不是用户知识数据，因此只读复用 `data/huggingface_cache`，确保 BGE-M3 Sparse 检索与普通实例口径一致。评测后端在 `/health` 返回 `evaluation_mode: true`；只有带这个标记的实例，`rag-eval` 才允许自动创建知识库和上传合成语料。

普通实例默认会被拒绝。如果确实已有专用评测 KB，可以同时传入 `--kb-id` 和 `--allow-shared-read-only`；runner 会验证 7 份合成文档齐全，并且不会创建 KB 或上传文件。

## 快速开始

先校验评测集和固定哈希：

```bash
./scripts/rag-eval validate
```

启动隔离实例。它读取现有 `backend/.env` 中的模型凭证，但所有知识数据均写入独立命名卷：

```bash
docker compose -f docker-compose.eval.yml up -d
curl http://127.0.0.1:18000/health
```

Compose 会优先复用本机已有的 `mma-rag-backend:latest` 依赖镜像，并把当前 `backend/app` 只读挂载进去；本机没有该镜像时才按 `backend/Dockerfile` 构建。

先跑不调用最终生成模型的检索基线：

```bash
./scripts/rag-eval run \
  --retrieval-only \
  --predictions-out evals/runs/direct-retrieval.jsonl \
  --report-out evals/reports/direct-retrieval.json
```

完整生成评测使用一个独立的 OpenAI-compatible judge。不要把密钥写入命令历史或仓库；推荐在当前 shell 临时注入：

```bash
export TESSMORA_EVAL_JUDGE_BASE_URL=https://judge.example.com/v1
export TESSMORA_EVAL_JUDGE_MODEL=judge-model-version
export TESSMORA_EVAL_JUDGE_API_KEY=replace-me

./scripts/rag-eval run \
  --judge openai-compatible \
  --predictions-out evals/runs/direct-full.jsonl \
  --report-out evals/reports/direct-full.json
```

judge 应使用明确版本而不是浮动别名。已生成答案可以离线换 judge 或升级 prompt，无需重新调用 Tessmora 的检索与生成链：

```bash
export TESSMORA_EVAL_JUDGE_MODEL=judge-model-fixed-version

./scripts/rag-eval judge \
  --predictions evals/runs/direct-full.jsonl \
  --predictions-out evals/runs/direct-full-rejudged.jsonl \
  --report-out evals/reports/direct-full-rejudged.json
```

`run` 会复用名称中带数据指纹的隔离 KB，只上传缺失语料。需要清空评测状态时，可停止 compose；只有确认要删除评测命名卷时才使用 `down -v`。

## 离线复算与回归门禁

当前有两份已确认基线：

- [`direct-hybrid-retrieval-v1.json`](../evals/baselines/direct-hybrid-retrieval-v1.json)：Direct 模式、Top 5、Dense + BGE-M3 Sparse + RRF + reranker；冻结检索指标和基于 qrel 的 Context Precision。
- [`direct-generation-qwen35-20260420-v1.json`](../evals/baselines/direct-generation-qwen35-20260420-v1.json)：相同链路的完整生成基线；生成模型为 `Pro/moonshotai/Kimi-K2.6`，独立 judge 固定为 `qwen3.5-plus-2026-04-20` 与 `ragas-like-judge-v1` prompt。

预测 JSONL 保存了检索结果、实际生成引用、回答、judge 判定和运行元数据。指标算法变化后可离线复算，不必再次调用模型：

```bash
./scripts/rag-eval score \
  --predictions evals/runs/direct-full.jsonl \
  --report-out evals/reports/direct-full-rescored.json
```

确认模型、judge、Agent 模式和数据指纹一致后，把一份人工复核过的报告作为基线。`compare` 会拒绝数据指纹、Agent 模式、K、生成模型或 judge 配置不一致的报告；候选指标任一项下降超过容差时返回非零退出码：

```bash
./scripts/rag-eval compare \
  --baseline evals/baselines/direct-hybrid-retrieval-v1.json \
  --candidate evals/reports/direct-retrieval.json \
  --max-regression 0.03
```

建议分别维护 `direct` 和 `agent` 基线，不在同一门禁中混比；检索配置或模型版本发生预期变化时，先保存候选报告和逐题差异，再人工决定是否更新基线。

## 文件合同

- 数据清单：`evals/baseline_v1/manifest.json`
- 问题、参考回答与 qrels：`evals/baseline_v1/cases.jsonl`
- 合成语料：`evals/baseline_v1/corpus/`
- 指标与 runner：`backend/evaluation/`
- 单一入口：`scripts/rag-eval`

运行产物默认放在被 Git 忽略的 `evals/runs/` 和 `evals/reports/`。只有经过人工确认、用于回归比较的报告才应放入 `evals/baselines/` 并提交。
