# Maintained evaluation inputs

This directory contains only inputs with an ongoing regression or runtime-provenance purpose.

| Directory | Purpose and consumer |
| --- | --- |
| [`baseline_v1/`](baseline_v1/README.md) | Seven synthetic documents and eight questions used by `rag-eval` and `backend/tests/test_rag_evaluation.py`; no private corpus |
| [`baselines/`](baselines/README.md) | Two frozen reports used by comparison regressions in `test_rag_evaluation.py`; historical configurations, not current performance claims |
| `decision_plan_v2/` | Development/holdout signals, threshold selection and admission; their hashes are bound by the production `decision_plan_profiles.json` and checked by `backend/tests/test_decision_profiles.py` |
| `decision_plan_v2_holdout/` | The 24 independent cases, candidate profiles, frozen protocol and source snapshots needed to audit that admission |

The `sources/` files are historical audit inputs, not alternate application modules. The frozen holdout runner requires the original source hashes and intentionally rejects an evolved checkout; use the compact-evidence regression below to audit current profile admission without live model calls. New live admission work needs a new versioned protocol, rather than edits to the frozen evidence.

From the repository root:

```bash
./scripts/rag-eval validate
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests/test_rag_evaluation.py backend/tests/test_decision_profiles.py -q
```

See [Evaluation](../docs/RAG_EVALUATION.md) and [Contributing](../CONTRIBUTING.md). Generated predictions/reports belong in ignored `evals/runs/` and `evals/reports/`; downloaded corpora and private snapshots belong in ignored `data/evaluation/`. Output paths are explicit CLI arguments. Do not put new runs inside these maintained input directories or update frozen evidence merely to make an implementation pass.
