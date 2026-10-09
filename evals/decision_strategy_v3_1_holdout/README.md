# Decision v3.1 consistency holdout

This protocol freezes ten new Chinese/English cases before model calls. It follows the first 20-case diagnostic set in `../decision_strategy_v3/`, so it is design-informed and is not an independently adjudicated benchmark.

The v3.1 change applies a semantic implication: a required source must also be useful for fulfilling the request. `required >= .85`, `forbidden <= .15`, and `helpful >= .85` must agree before a requirement can alter retrieval. Positive required plus negative helpful is a conflict; uncertain helpful abstains. Agreement is **logical consistency**, not independent probabilistic evidence or a calibrated correctness guarantee. The prompt also distinguishes an independently retrieved source item from components inside another source file.

The gates are unchanged. Grounding remains an independent observed signal, and its uncertainty does not by itself block complete intent adoption. Complex tasks, missing context and other uncertain requirements retain the generative planner in adaptive mode and explicitly stop strict mode.

```sh
# Validate protocol, source and prompt hashes; no model calls.
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_strategy.py

# Run once per old/new policy and native Jev/Bailian route: 40 requests total.
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_strategy.py \
  --live --protocol evals/decision_strategy_v3_1_holdout/protocol.json \
  --output ops/decision-strategy-v3/new-holdout-run

# Offline only; output file must not exist. This reuses v3 signals and cannot
# measure the changed v3.1 prompt or serve as independent improvement evidence.
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_strategy.py \
  --replay-consistency ops/decision-strategy-v3/intent-live-v1 \
  --output ops/decision-strategy-v3/new-selection-analysis.json
```

The live runner never changes saved settings, original evaluation artifacts or labels. Failed calls remain in their denominators; there are no retries or substitute models. Provider-omitted usage is recorded as unknown, including Bailian output tokens and monetary cost. See `../../docs/research/decision-strategy-2026-10/intent-evaluation.md` for the observed results and remaining semantic errors.
