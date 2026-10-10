# Maintained evaluation inputs

This directory contains only inputs with an ongoing regression or runtime-provenance purpose.

| Directory | Purpose |
| --- | --- |
| `baseline_v1/` | Seven synthetic documents and eight questions; no private corpus |
| `baselines/` | Small frozen comparison reports; model and dataset identity must match before comparison |
| `decision_plan_v2/` | Compact signals reproducing the production Decision profile thresholds and admission |
| `decision_plan_v2_holdout/` | Independent cases, frozen protocol and small source snapshots needed to audit that admission |

See [Evaluation](../docs/RAG_EVALUATION.md) and [Contributing](../CONTRIBUTING.md). Generated runs, downloaded corpora and intermediate experiments are ignored by default. Do not update frozen evidence merely to make a changed implementation pass: define a new protocol and review its admission separately.
