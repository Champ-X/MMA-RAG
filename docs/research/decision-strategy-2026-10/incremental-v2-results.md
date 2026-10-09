# Incremental evidence v2: frozen native-provider pilot

Recorded 2026-10-09, 19:08:32–19:08:46 +08:00. This is a negative retrieval-gain result and a partial functional result. It does not establish better answer quality.

## Protocol and provenance

- Frozen protocol: `evals/decision_assist/incremental-protocol-v2.json`.
- Protocol SHA-256: `b47c81c7c0e5a9137be4aa5e5f0c8fa94f03e5f4cf8fdd8a918a744e9c0edec4`.
- Runner: `backend/scripts/evaluate_decision_incremental.py`.
- Raw receipts: `ops/decision-incremental-qa/public-and-functional-v2.jsonl`.
- Receipt SHA-256: `dbbdab841b39d909cc5d6d10958c3087daa61200eb04f5ade1f4f05f1dab8cb2`.
- Machine summary: `ops/decision-incremental-qa/public-and-functional-v2.summary.json`.
- Public inputs: the same 12 preselected pools as v1, using their original real Qwen score receipts. Candidate order and Qwen input hashes were checked. No fresh Qwen calls were made.
- Functional inputs: three new Chinese controlled cases, each with one baseline passage, two useful additions, one paraphrase, and one wrong-entity/version distractor. These are functional probes, not a retrieval benchmark.

Each provider received native Noul questions for two independent conditions: direct usefulness and information absent from the complete available baseline. Both thresholds stayed at 0.85. The stage deadline was 3 seconds; two candidates per microbatch, at most two concurrent requests, no retries, and at most two additions. Source/input hashes were checked before calls and source hashes again afterward. Saved settings were unchanged. Existing v1 results were not edited or rerun.

## Public pools

| Measure | TypeSafe Jev 1.13.0 | Bailian decision-model-preview |
| --- | ---: | ---: |
| Attempted cases | 12 | 12 |
| Cases evaluated through native requests | 7 | 7 |
| Cases skipped because the complete baseline exceeded 12,000 characters | 5 | 5 |
| Added passages | 0 | 0 |
| Mean recall before | 0.958333 | 0.958333 |
| Mean recall after | 0.958333 | 0.958333 |
| Provider/protocol/deadline failures | 0 | 0 |
| Original evidence objects, order and scores preserved | 12/12 | 12/12 |

The baseline already covered every labeled relevant passage in 11 of the 12 cases. The only case with remaining labeled relevant evidence, `t2v2-0432` (baseline recall 0.5), had 21,097 baseline characters and was skipped by the frozen complete-baseline bound. Thus this particular pilot offered no labeled recall gain opportunity among the seven cases actually evaluated. Zero additions is not evidence of improved quality or of a measured recall regression. The bound substantially limits coverage and must remain visible.

The other skipped cases were `t2v2-2325` (14,306 characters), `t2v2-1438` (21,508), `t2v2-5076` (31,000), and `t2v2-6113` (21,190). No truncated baseline was used to manufacture an incremental-evidence judgment.

## Controlled behavior

| Case | Expected additions | Jev actual additions | Bailian actual additions |
| --- | --- | --- | --- |
| Library rules | researcher-specific rules; overdue exception | overdue exception | none |
| Export restrictions | encrypted-record limitation; unsupported JSON | none | none |
| Germination conditions | saline condition; dark condition | dark condition | none |

Across the six expected additions, Jev adopted two and missed four; Bailian adopted none and missed six. Both rejected all six paraphrase/wrong-entity-or-version distractors. Neither provider produced the complete expected addition set on any of the three cases. Baselines were preserved in all six provider/case runs.

The receipts expose why candidates were excluded. Jev assigned the researcher rule direct usefulness 0.83 and incremental information 0.91; the saline result was 0.78/0.90, so each failed the frozen usefulness threshold. Bailian assigned the researcher rule 0.91/0.36 and the encrypted-record limitation 0.93/0.31, failing the incremental-information threshold. These scores do not establish calibrated probabilities. Lowering thresholds after observing this cohort would be post-hoc tuning and was not done.

This pilot therefore does not justify claiming that the incremental policy reliably captures exceptions or contrary evidence. It shows that the independent signals and conservative adoption contract execute correctly, while useful evidence is still missed. Provider-specific prompt robustness and independently frozen holdout validation remain necessary before quality claims or enabling the mode by default.

## Request and latency accounting

Each provider made 15 native requests across 10 evaluated stages, producing 27 candidate judgments (54 Noul answers). All 30 total requests returned valid results. Five skipped stages per provider remain in the 15 attempted-stage denominator.

| Observed latency | TypeSafe Jev | Bailian |
| --- | ---: | ---: |
| Request median | 0.821 s | 0.320 s |
| Request range | 0.734–1.254 s | 0.198–0.662 s |
| Evaluated-stage median | 0.872 s | 0.364 s |
| Evaluated-stage maximum | 2.108 s | 1.275 s |

Providers ran sequentially in the frozen order; there was one observation per case, and root-level pipeline verification was running separately. These values describe this run, not a stable provider ranking or an SLA. They exclude answer generation and fresh Qwen reranking. TypeSafe cost fields are labeled input estimates; Bailian cost was unavailable and was not treated as zero.

Reproduction requires new output paths and a new explicitly authorized live run; never append missing rows to these frozen receipts:

```sh
cd backend
../.venv-main/bin/python scripts/evaluate_decision_incremental.py \
  --live \
  --protocol ../evals/decision_assist/incremental-protocol-v2.json \
  --output ../ops/decision-incremental-qa/NEW-RUN.jsonl
```
