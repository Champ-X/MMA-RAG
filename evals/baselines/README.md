# Checked baselines

这里只保存两份冻结的小型报告，同时作为 `backend/tests/test_rag_evaluation.py` 的比较器回归输入。它们记录历史模型配置，不代表当前默认配置、当前性能或完整可重跑的实验包；原始 predictions 不随仓库分发。新运行的 predictions 和临时报告放入被 Git 忽略的 `evals/runs/`、`evals/reports/`。

- `direct-hybrid-retrieval-v1.json`：Direct 模式、Top 5、Dense + BGE-M3 Sparse + RRF + reranker 的首份检索基线。
- `direct-generation-qwen35-20260420-v1.json`：同一数据集的完整生成基线；生成模型为 `Pro/moonshotai/Kimi-K2.6`，独立 judge 固定为 `qwen3.5-plus-2026-04-20`，prompt 为 `ragas-like-judge-v1`。
- 没有 judge 的检索报告仍会把 Faithfulness 与 Answer Relevance 保留为 `null`，不把缺失值当作零分。

`compare` 核对报告中已声明的配置；旧报告缺少的字段不能据此视为相同配置。新模型或协议的结果应另建有明确版本的基线，并保留逐题预测和运行配置供复核，不覆盖这两份历史报告。
