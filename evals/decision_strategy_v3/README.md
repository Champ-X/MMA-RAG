# Decision intent strategy paired check

This is a small, frozen diagnostic comparison of two **intent policies**, not an end-to-end retrieval or model-ranking benchmark.

- `old-questions.json` is the exact `intent_questions()` output from commit `69e227c246c3887767fdb299ed509fd0cb3074f9`. Its old adaptive gate uses selected Choice probability ≥ .75, complexity ≤ .20 and unresolved-context signal ≤ .20. Its strict mode accepted every valid response.
- `new-questions.json` uses independent required, forbidden and helpful predicates for image, audio and video. Signals ≥ .85 are positive, ≤ .15 negative, and the middle band abstains. A conflict abstains. Task-category Choice still requires .75; its confidence is recorded, not counted as a second correctness estimate.
- `cases.json` contains 20 human-labelled cases frozen before calling either model. Chinese/English, compound requests, negation scope, quoted titles, code words, factual grounding and style-only selection are covered. These labels have not been independently adjudicated. Helpful enrichment has no exact gold label.
- Both policies run once on native TypeSafe Jev and native Bailian Decision. Request order alternates, concurrency is 1, production timeout is 3 seconds, and there are no retries, replacement calls or fallback models.
- `protocol.json` stores file/source hashes, route IDs, gates, order, limits and metrics. The runner refuses changed prompts, labels or candidate code and refuses an existing output directory. A changed candidate needs a separately frozen protocol and a fresh run; never repair old receipts.

The source snapshot is preserved as `candidate_v3_frozen.py`. Current production
code has advanced to v3.1, so verifying this historical protocol against current
source is expected to refuse a mismatch. Reproduce it only in an isolated
checkout containing the frozen source. The runner's default now targets the
new v3.1 holdout; it does not silently rerun these 20 cases.

Verify a checkout of the frozen v3 source without model calls:

```sh
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_strategy.py \
  --protocol evals/decision_strategy_v3/protocol.json
```

Run using configured backend credentials and a **new** output directory:

```sh
PYTHONPATH=backend .venv-main/bin/python backend/scripts/evaluate_decision_strategy.py \
  --live --protocol evals/decision_strategy_v3/protocol.json \
  --output ops/decision-strategy-v3/fresh-run
```

The runner does not change saved Decision settings or call the generative planner, retrieval, or answer generation. Credentials stay in memory and are omitted from receipts. Every successful native answer and every sanitized failure is retained in `receipts.jsonl`; aggregate counts, timings, reported usage, and failure cases appear in `summary.json`.

Interpret `partial_required_eligible` as a potential additive requirement. It does **not** prove that the original generative planner missed it, because that planner is deliberately not simulated. Complete-adoption correctness covers the labelled required/forbidden/planning contract only, not all task semantics. Raw required recall counts abstained requirements as undetected; adopted misses and abstentions are reported separately. Old `unnecessary` cannot distinguish no demand from explicit exclusion, so no exclusion capability is attributed to that schema.
