# Checked baselines

这里只保存经过人工确认、可用于 `rag-eval compare` 的小型报告。原始 predictions 和临时报告位于被 Git 忽略的 `evals/runs/`、`evals/reports/`。

- `direct-hybrid-retrieval-v1.json`：Direct 模式、Top 5、Dense + BGE-M3 Sparse + RRF + reranker 的首份检索基线。
- `direct-generation-qwen35-20260420-v1.json`：同一数据集的完整生成基线；生成模型为 `Pro/moonshotai/Kimi-K2.6`，独立 judge 固定为 `qwen3.5-plus-2026-04-20`，prompt 为 `ragas-like-judge-v1`。
- 没有 judge 的检索报告仍会把 Faithfulness 与 Answer Relevance 保留为 `null`，不把缺失值当作零分。

更新基线前应确认数据指纹、模型栈、Agent 模式、judge 模型和 prompt 版本均符合预期，并检查逐题差异。
