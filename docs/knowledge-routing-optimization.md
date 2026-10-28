# Knowledge portraits and routing: controlled optimization

The core change represents each topic with both a summary and bounded content
prototypes, then uses strong disagreement between them to supplement KB
selection. A separate fixed-budget video candidate rule ensures that selected
speech evidence reaches the existing reranker. Explicit KB/file scopes retain
their boundaries. The initial evaluation preserved production portraits; the
subsequent user-authorized restart and rebuild are recorded below.

## Core topic representation and routing

`topic_prototypes.py` builds a normalized centroid, the nearest actual sample
(medoid), and up to two diverse real samples per existing KMeans cluster. Each
additional sample covers the largest remaining cosine-distance gap. Among
samples retaining at least 80% of that gap, a previously unrepresented known
source is preferred. Cosine-near-duplicates (>= 0.995) share one routing vector;
their source references survive deduplication. These are bounded coverage
heuristics, not relevance probabilities. No additional summary or embedding
model request is made.

The existing summary remains independently searchable. Prototype points share
the `kb_portraits` collection with `portrait_role=topic_prototype`; legacy
Top-30 queries and portrait display explicitly exclude them. A new grouped
query returns only the highest scoring prototype for each KB. Consequently
copies of one prototype cannot add votes or crowd other KBs out of point TopN.
This does not eliminate the statistical advantage of a genuinely more diverse
large KB; the supplementary decision rule is needed as well.

For `coverage` routing, the original summary route remains the anchor. A new
KB can occupy another existing slot only if its content-prototype score is at
least 0.50, exceeds the next KB by at least 0.04, and has a relative gap of at
least 0.12. The first summary-selected KB is never evicted. Unclear content
evidence leaves the summary route unchanged. These thresholds were fixed
before the complete end-to-end evaluation, but the corpus was inspected during
development; this is not a blind validation set.

The additional query reuses the primary query embedding and runs concurrently
with summary queries, with a 75 ms deadline and a 1 s SDK timeout. Missing,
failed or late content evidence falls back to the summary route. During gradual
portrait rebuilding, all existing baseline targets must have valid prototype
signals before the scope can change. Multi-requirement Decision requests allow
prototype supplementation only into unused slots; Agent exploration and Pi
retain their separate routing behavior. Diagnostics retain the chosen source,
raw score, gaps, inserted/evicted KBs and fallback status.

`evidence_routing.py` also protects strong caption/ASR first hits from being
discarded by four-way RRF before reranking. A semantic winner must score at
least 0.50 and at least 90% of the strongest semantic winner; at most two unique
winners replace the tail within the same candidate limit. The same protection
survives optional keyframe enrichment. Sparse/CLIP scores are not compared on
this cosine scale. Search calls, original scores and reranker candidate limits
are unchanged.

The same bounded protection continues through the global coarse-50 and
provider-20 candidate gates. It first replaces an ordinary video candidate and
otherwise respects the existing image/audio/video minimum quotas. It does not
force an anchor into the final 10: the real reranker must still select it.
Without this second gate, case 066 reaches the correct KB and raw results but
is lost again before the reranker sees its text.

### Core routing diagnostic

Production sampling and clustering of 12 current KBs produced 66 topics and
255 deduplicated prototype vectors. The frozen 40-question diagnostic yielded:

| Representation / selection | Required KB coverage | Mean selected KBs | Per-case regressions |
| --- | ---: | ---: | --- |
| Existing summary / legacy | 39/40 | 1.20 | baseline |
| Content prototypes / max | 37/40 | 1.25 | 008, 041, 044 |
| Summary + prototypes / max | 37/40 | 1.25 | 008, 041, 044 |
| Summary anchor + strong content supplement | 40/40 | 1.20 | none |

The simple maximum-score replacement was rejected. The supplementary strategy
changes only case 066 in this fixture, replacing its secondary food KB with
the film KB while preserving the original primary KB. Actual retrieval, rather
than routing coverage alone, determines the final adoption decision below.

Prototype coverage radii describe supplied samples, not all indexed material.
Current document/image/audio samplers do not supply file IDs, so their content
prototypes retain point references but cannot enforce file-level diversity;
video Scene samples carry file IDs. Historical content-vector model provenance
is unknown and is recorded as such. K selection and summary prompt generation
remain unchanged in this iteration.

## Earlier reliability and transport improvements

- Large corpora use full-cursor reservoir sampling with a per-KB deterministic
  RNG and bounded live vectors, rather than sampling the first `budget + 1`
  points. Existing corpora below 5,000 units retain their sampling behavior.
  Existing minority modalities get a minimum sample allocation. Large video
  inputs are sampled by source and Scene, with complete selected-Scene
  aggregation and a second pass for representative Shot readback.
- Missing source text, failed/blank/placeholder summaries, invalid embedding
  responses and incompatible returned models retain the actual semantic
  centroid. An unavailable summary is not embedded as a generic topic.
- Valid summaries support bounded embedding batches, preserving their input
  order. Individual requests remain the default after the live batch experiment
  failed its equivalence/performance criteria. Response cardinality, dimensions,
  finite/nonzero values and model identity are checked; failures retain each
  affected topic's centroid.
- Portrait counts and sampling reads propagate storage failures instead of
  treating them as empty content/end-of-stream. Failed reads do not delete or
  replace the old portraits. Blocking sampling/count I/O and CPU clustering
  run off the event loop so an API-side rebuild can coexist with online requests.
- Delta-triggered rebuilds use an atomic Redis claim and completion ACK.
  Dispatch no longer clears dirty state. Successful completion subtracts only
  the claimed count; concurrent changes survive, and stale acknowledgements
  cannot consume a newer claim. Workers verify/renew their claim before any
  build; an expired worker cannot start a replacement write. Threshold-triggered jobs force the rebuild,
  avoiding the former second count/age threshold that could skip queued work.
- Routing queries request only `kb_id` and `cluster_size` payload fields from
  Qdrant. Query vectors, ANN parameters, score aggregation and target selection
  remain unchanged. Relative similarity is explicitly distinguished from a
  calibrated probability in diagnostics.
- `max` aggregation is available only as an opt-in experiment. It has not been
  promoted to default based on a small routing-only evaluation.

## Controls

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `KNOWLEDGE_ROUTING_COMPACT_PAYLOAD` | `true` | Set `false` to restore full portrait payload transfer. |
| `KNOWLEDGE_ROUTING_SCORE_MODE` | `coverage` | Summary anchor plus strong content supplement; `legacy` restores summary-only selection, `max` remains experimental. |
| `VIDEO_SEMANTIC_ANCHORS_ENABLED` | `true` | Retain strong video semantic hits through fixed candidate budgets; `false` restores previous truncation. |
| `PORTRAIT_MAX_REPRESENTATIVES` | `3` | Real samples per topic including the medoid; the centroid is additional and near-duplicates share a vector. |
| `PORTRAIT_EMBEDDING_BATCH_SIZE` | `1` | Individual requests are the default; larger batches are experimental. |

These are process configuration controls. Restart the affected process when
changing environment variables. They do not alter stored user model routes.

Existing summary-only portraits remain compatible and retain their summary
route until rebuilt. Core source defaults are enabled. The experiments did not
restart or rewrite production; the subsequent rollout below did so explicitly.
To revert online policy, set `KNOWLEDGE_ROUTING_SCORE_MODE=legacy` and
`VIDEO_SEMANTIC_ANCHORS_ENABLED=false`; stored prototypes can remain in place
because legacy searches exclude them.

## Authorized production rollout, 2026-10-27

After the user requested restart and portrait regeneration, the project was
restarted with `./start-dev.sh restart --background --restored --port 3001`.
Backend health, frontend proxy, and the actual browser knowledge-library page
passed. All 12 KBs were then rebuilt through the synchronous portrait endpoint,
with a full ID/vector/payload backup taken before replacement.

The live collection now contains **66 summary points + 255 content prototypes**.
All 66 summaries report `ready`; each topic's stored prototype count and source
references were verified. Point IDs, payload hashes and counts in the five
document/media collections are unchanged. The production policies are now
`coverage` routing and enabled semantic evidence retention.

Read-only production routing acceptance covers all required KBs for 40/40
questions in each of three rounds: 120 successes, no errors or prototype-query
timeouts. These use frozen original query embeddings and do not test rewritten
queries or final answers. Regenerating summaries changes 12 route selections
or their ordering relative to the shadow experiment; mean target KBs are now
1.275, so the earlier 1.20 average and timing figures must not be attributed to
this rebuilt production snapshot.

Two additional unscoped CLI/API searches use actual preprocessing, fresh query
embeddings, content retrieval and the real reranker. Both the Tommy quote and
melon domestication evidence are present in the final ten results, with the
expected source Shot IDs and complete annotated quotations.

Backups and all rollout receipts are retained privately under
`data/knowledge-portrait-rollout-20261027/`. The combined receipt is
`rollout-summary.json`; no content reingestion, Git commit or push was performed.

## Core end-to-end evidence

The final comparison uses 40 independently authored questions repeated three
times, two policies, 240 actual retrieval executions. Queries, embeddings and
preplanning are frozen; content retrieval and the Qwen reranker are real.
There are still only 40 independent questions. Both policies succeeded in all
120 executions. Candidate policy tests use an isolated mixed collection with
the 65 existing summaries plus 255 real content prototypes. Production content
and portrait hashes match before/after, and temporary collections are deleted.

| Metric | Previous policy | Core coverage + evidence retention |
| --- | ---: | ---: |
| Required KB coverage, each round | 39/40 | 40/40 |
| Complete final evidence, each round | 38/40 | 40/40 |
| Mean selected KBs | 1.20 | 1.20 |
| Provider rerank candidate budget | unchanged | unchanged on every paired call |
| Retrieval P50, all 120 measurements | 1.388 s | 1.360 s |
| Retrieval P95, all 120 measurements | 3.155 s | 2.545 s |

There are no observed per-question evidence regressions. Case 054 requires
speech-view retention. Case 066 requires both the content-based KB supplement
and retention through the global rerank pool. The scorer receipts confirm its
annotated quote enters the same 20-document provider budget and is subsequently
selected by the real scorer; final results are not forced to contain it.

Latency needs a narrower conclusion than the headline percentiles. Routing
P50 increases from 11.6 to 26.4 ms because the extra content query has real cost.
Across all rounds, the case-clustered paired median latency ratio is 0.997
(bootstrap 95% interval 0.953–1.038). Excluding the complete first round yields
P50 1.385→1.357 s and P95 3.218→2.634 s, but paired median ratio 1.033 with a
wide interval 0.946–1.143; mean latency is 1.600→1.617 s. Provider tail variation
accounts for much of the P95 improvement. **This establishes a local evidence
quality gain, not an algorithmic speedup or a strict latency non-regression
guarantee.** The optional query's 75 ms deadline bounds its waiting contribution.

A no-provider comparison additionally copies the production collection's four
payload indexes into an isolated mixed collection. All returned hit IDs/order
remain identical; grouped query P50/P95 improves 13.54/15.93→12.14/14.48 ms.
This small difference does not remove the routing cost and is not extrapolated
into an end-to-end speedup.

The earlier four-way ablation (`live-ablation-v2`, before extending retention to
the global provider pool) yields 38/40 baseline, 38/40 coverage only, 39/40
Shot retention only, and 39/40 combined. It explains why merely improving route
coverage or the first retrieval stage was insufficient. The final three-round
result is in `data/knowledge-routing-core-20261027/live-paired-v3/report.json`;
paired uncertainty and timing breakdown are in `latency-analysis.json`.

Final source/default verification passes five representative questions with
the new defaults, including both recovered cases (`live-final-defaults-v1`).
Relative to the main paired run, only the default values and the final
coarse-50 modality guard changed. The one case with 55 raw hits has 45 unique
candidates; every other case has at most 50 raw hits, so that guard does not
change the main run's candidate selection. A fresh capture through the reusable
sampling CLI reproduces the frozen sample vectors, metadata and clustering.

Final code regression: **471 passed, 0 failed, 0 skipped**, including isolated
real Redis transactions, in-memory Qdrant storage/ranking tests, missing-index
and timeout fallback, mixed portrait migration, fixed candidate budgets,
explicit scopes and multi-requirement source preservation. Receipt:
`data/knowledge-routing-core-20261027/regressions-final.xml`. `git diff --check`
and the repository check pass. No Git commit or push was made.

Reproduce the core comparisons using new output directories:

```bash
PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_prototypes \
  --snapshot data/knowledge-routing-20261027/frozen-v1 \
  --capture-samples --output data/knowledge-routing-new/samples

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_prototypes \
  --snapshot data/knowledge-routing-20261027/frozen-v1 \
  --samples data/knowledge-routing-new/samples \
  --output data/knowledge-routing-new/prototypes

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_live \
  --snapshot data/knowledge-routing-20261027/frozen-v1 \
  --prototype-topics data/knowledge-routing-new/prototypes/topics.json \
  --policies data/knowledge-routing-core-20261027/paired-policies.json \
  --case-ids all --repeats 3 --output data/knowledge-routing-new/live
```

The policies file contains two records: `legacy_baseline` sets
`knowledge_routing_score_mode=legacy` and `video_semantic_anchors_enabled=false`;
`coverage_anchor` sets them to `coverage` and `true`, respectively. The live
evaluator creates and deletes only its new UUID-named collection, prevents
production writes, and verifies unchanged production content/portrait hashes.

## Source-grounded evaluation, 2026-10-27

Baseline checkout: `b5c412253c00214d4ad9795e6fcf1586da6f73fb`.
The local index contained 12 KBs and 65 portraits. The existing local-v3 set has
87 sources and 80 authored, posthoc-reviewed questions. Its KB/file identifiers
no longer match the live index. The new evaluator therefore relocates annotated
evidence quotes, restricted to the original modality, into current content.

40 questions have at least one complete current alternative for **every**
required evidence group; 40 are explicitly excluded. Original user scopes are
retained as provenance but removed for this automatic-routing diagnostic.
Alternative evidence is handled as OR-of-AND requirements, rather than treating
all relevant KBs as mandatory. This is not a blind holdout, nor a whole-product
accuracy claim. A preassigned source-connected split yields 37 dev / 3 test
cases; the test subset is too small to justify generalization.

The fixture freezes current content payloads, all portrait vectors, 40 actual
query embeddings, model receipts, source mapping and checksums. Snapshots retain
the complete mixed portrait collection for integrity checks; summary baselines
exclude content prototypes, and shadow fixtures copy only summary points before
adding newly generated prototypes. The transport benchmark applies the same
summary filter as production. Replay calls the production scoring and selection
methods with exact cosine candidates. It
excludes LLM rewriting, intent detection, modality supplementation and Agent
exploration. Historical portrait model provenance is incomplete; matching
dimensions alone does not establish identical embedding-space versions.

| Routing-only variant | All required groups covered | Mean selected KBs | Decision |
| --- | ---: | ---: | --- |
| Top 30 + legacy | 39/40 | 1.20 | Initial baseline |
| Top 30 + max | 40/40 | 1.25 | Opt-in; 10 selections changed |

There were no per-case coverage regressions for `max` in this fixture. That does
not prove downstream ranking or latency non-regression when more KBs are
searched. Expanding legacy aggregation to all 65 portraits also scored 39/40,
but **changed which question failed**. It was not adopted. A batch-query API
experiment was slower than the existing concurrent Qdrant calls and was also
not adopted.

The downstream follow-up executes the actual retrieval service with fixed
preplanned queries/embeddings, real content indexes and the real reranker:
13 questions (10 changed routes plus 3 controls), two policies, three alternating
rounds, 78 searches with no execution errors. Both policies hit all required
final evidence in 33/39 case-runs (11/13 questions), with no observed per-case
improvement or regression. `max` improves selected-KB coverage but does not
recover the missing annotated Shots in final results. Its P95 was also higher:
legacy 2.699 s versus max 2.865 s; after excluding the first round, 2.670 s
versus 2.785 s. Consequently `max` remains disabled by default. These timings
exclude query rewriting and use frozen query vectors; they are not full Chat
response latency.

The real summary-embedding experiment used four current portrait summaries,
three alternating sequential/batch pairs, and the same configured provider/model.
Cosines were at least about 0.99987, but strict vector equality/tolerance checks
failed (maximum absolute differences 0.00196–0.00365). Batch latency was faster
in two rounds and slower in one. Same-shape repeated controls were not run, so
the cause cannot be assigned uniquely to batching rather than provider variation.
No equivalence or general speedup is claimed, and the default batch size is 1.

## Measured online transport change

Same 40 frozen query vectors, alternating full/compact order, five repetitions,
fixed Top 30. The before/after portrait snapshot hashes match. Every measured
response has identical IDs, scores, KB IDs and cluster sizes.

| Qdrant lookup shape | Paired measurements | Full P50/P95 | Compact P50/P95 |
| --- | ---: | ---: | ---: |
| One query | 200 | 6.516 / 10.030 ms | 6.042 / 9.030 ms |
| Four concurrent queries | 50 | 10.390 / 13.826 ms | 9.688 / 11.760 ms |

Mean serialized payload size fell from 35,373 to 2,122 bytes (about 94%).
Paired-resampling 95% intervals for the compact/full median latency ratio were
0.872–0.957 and 0.907–0.959 respectively. This measures the portrait lookup
stage on the local service, **not** end-to-end answer latency. Raw observations
are retained for inspection; timing is not asserted in CI.

## Reproduce

Earlier verification: **281 passed, 0 failed, 0 skipped**, including the real
Redis transaction tests, existing routing/retrieval/scope/lifecycle regressions,
and the new portrait failure/coverage/responsiveness tests. The JUnit receipt is
`data/knowledge-routing-20261027/regressions-final.xml`. `git diff --check` and
the repository distribution check passed. No production process was restarted,
no existing portraits were regenerated, and no Git commit/push was performed.

From the repository root, use the existing virtual environment. Output
directories/files must be new so old receipts are not silently overwritten.

```bash
PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing freeze \
  --dataset data/retrieval-evaluation-20261008/review-v1/local-v3/manifest.json \
  --output data/knowledge-routing-new/frozen

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing replay \
  --snapshot data/knowledge-routing-new/frozen \
  --output data/knowledge-routing-new/replay --modes legacy max --repeats 30

PYTHONPATH=backend .venv/bin/python backend/scripts/benchmark_portrait_transport.py \
  --fixture data/knowledge-routing-new/frozen \
  --output data/knowledge-routing-new/transport.json --repeats 5

PYTHONPATH=backend .venv/bin/python -m pytest -q \
  backend/tests/test_portrait_generation_reliability.py \
  backend/tests/test_portrait_trigger_reliability.py \
  backend/tests/test_portrait_routing_controls.py \
  backend/tests/test_knowledge_routing_evaluation.py \
  backend/tests/test_knowledge_router.py \
  backend/test_video_portrait_sampling.py
```

Set `PORTRAIT_TRIGGER_TEST_REDIS_URL` to enable the Redis transaction tests.
They use UUID-isolated test keys, clean up only those keys, and never flush a
database. Otherwise these integration tests explicitly skip. The Qdrant ranking
test uses an isolated in-memory client. No test rebuilds production portraits.

Local evidence lives under `data/knowledge-routing-20261027/`, including
`frozen-v1`, `replay-top30-v1`, `replay-all65-v1`, and `transport-v1.json`.
The downstream runs are in `live-paired-v1` and `live-instrumented-v2`; the
rejected batch experiment is `portrait-embedding-batch-v1.json`.
Raw queries/content/vectors remain ignored local artifacts; do not publish them
as part of source code. The evaluator and small deterministic regression cases
are maintained source files.

The synthetic stress regression also exercises sampling → actual KMeans →
summary-outage centroid fallback → actual legacy routing. With a known topic
only in the suffix of 6,000 records, the former prefix representation selects
the distractor KB; repaired construction selects the answer-bearing KB. This
is a targeted failure-mode regression, not a real-query accuracy percentage.

## Boundaries

- Full-stream sampling deliberately reads more of a large corpus. Its offline
  scan time can increase; this fixes coverage and does not add online retrieval
  requests. The video path scans twice to avoid retaining every Shot vector.
- This iteration does not implement versioned atomic portrait publication,
  corpus revisions, dynamic content probing, automatic expansion, adaptive K,
  or learned score calibration. The current replacement write still has a
  delete/write window and should be addressed separately with versioned reads.
- Failed delta jobs retain their dirty count. Celery uses bounded retries;
  abandoned claims expire after one hour and a subsequent content change can
  retry. There is no new periodic recovery sweeper. Redis outages cannot
  durably record the initial increment. Manual/video forced rebuilds retain
  their existing trigger behavior.
- No universal accuracy or latency guarantee follows from 40 local cases.
  Core defaults reflect the local evidence-quality improvement. The measured
  routing overhead and end-to-end latency uncertainty remain explicit above.
