# Knowledge portraits and routing

This document describes the maintained automatic KB-routing path in
`backend/app/modules/knowledge/`. Explicit user KB/file scopes remain binding.
Conventional Agent exploration and Pi use their own orchestration paths.
Defaults come from `backend/app/core/config.py`; process-local overrides and
existing portrait versions determine a running instance's behavior.

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
evidence leaves the summary route unchanged. These thresholds are bounded heuristics, not calibrated relevance probabilities.

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



Prototype coverage radii describe supplied samples, not every indexed item.
Document/image/audio samples currently retain point references without file IDs;
video Scene samples carry file IDs. Dimensions alone do not establish matching
embedding-model provenance.

## Portrait reliability and transport

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
  order. Individual requests remain the default; batch equivalence and performance require separate validation. Response cardinality, dimensions,
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
- `max` aggregation is available only as an opt-in experiment. It is not the production default.

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
route until rebuilt. The source defaults above are enabled; a particular running instance may override them.
To revert online policy, set `KNOWLEDGE_ROUTING_SCORE_MODE=legacy` and
`VIDEO_SEMANTIC_ANCHORS_ENABLED=false`; stored prototypes can remain in place
because legacy searches exclude them.

## Reusable diagnostics

The tools below require a locally prepared, source-grounded
[retrieval dataset](RETRIEVAL_EVALUATION_V2.md), the matching live index and model
configuration. `freeze` can make embedding calls; `knowledge_routing_live` uses
real content retrieval and the configured reranker. Neither is a free, bundled
benchmark. The placeholders below must be replaced with your own dataset and
new output directories.

```bash
PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing freeze \
  --dataset /path/to/dataset/manifest.json --output data/routing-run/frozen

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing replay \
  --snapshot data/routing-run/frozen --output data/routing-run/replay \
  --modes legacy max --repeats 30

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_prototypes \
  --snapshot data/routing-run/frozen --capture-samples \
  --output data/routing-run/samples

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_prototypes \
  --snapshot data/routing-run/frozen --samples data/routing-run/samples \
  --output data/routing-run/prototypes

PYTHONPATH=backend .venv/bin/python -m evaluation.knowledge_routing_live \
  --snapshot data/routing-run/frozen \
  --prototype-topics data/routing-run/prototypes/topics.json \
  --policies /path/to/policies.json --case-ids all --repeats 3 \
  --output data/routing-run/live
```

`policies.json` is a list; its first entry is the baseline. For example:

```json
[
  {"name": "legacy", "settings": {"knowledge_routing_score_mode": "legacy", "video_semantic_anchors_enabled": false}},
  {"name": "coverage", "settings": {"knowledge_routing_score_mode": "coverage", "video_semantic_anchors_enabled": true}}
]
```

The freeze step relocates evidence quotes into the current index and explicitly
excludes questions with incomplete evidence groups. It removes original scopes
only for the automatic-routing diagnostic, retaining them as provenance. Replay
uses frozen query vectors and exact cosine candidates; it excludes LLM rewriting,
intent detection, modality supplementation and Agent exploration. The live tool
uses a UUID-named temporary prototype collection and checks production index
hashes before and after. It does not generate final answers.

Keep source hashes, case exclusions, raw failed attempts, paired results and
model receipts together in the ignored output directory. A private corpus result
is not a repository-wide performance guarantee. Do not publish raw source text,
query vectors or user KB identifiers as routine source changes.

## Regression checks

```bash
PYTHONPATH=backend .venv/bin/python -m pytest -q \
  backend/tests/test_portrait_generation_reliability.py \
  backend/tests/test_portrait_trigger_reliability.py \
  backend/tests/test_portrait_routing_controls.py \
  backend/tests/test_knowledge_routing_evaluation.py \
  backend/tests/test_knowledge_router.py \
  backend/test_video_portrait_sampling.py
```

Set `PORTRAIT_TRIGGER_TEST_REDIS_URL` to enable the real Redis transaction
checks. They use isolated keys and clean up only those keys; without that
setting the integration checks explicitly skip. These tests do not rebuild
production portraits. For transport measurements, see
`backend/scripts/benchmark_portrait_transport.py --help`; matching IDs, scores,
scopes and source fingerprints are required before comparing timings.

## Boundaries

- Full-stream sampling deliberately reads more of a large corpus. Its offline
  scan time can increase; this fixes coverage and does not add online retrieval
  requests. The video path scans twice to avoid retaining every Shot vector.
- The current implementation does not provide versioned atomic portrait publication,
  corpus revisions, dynamic content probing, automatic expansion, adaptive K,
  or learned score calibration. The current replacement write still has a
  delete/write window and should be addressed separately with versioned reads.
- Failed delta jobs retain their dirty count. Celery uses bounded retries;
  abandoned claims expire after one hour and a subsequent content change can
  retry. There is no new periodic recovery sweeper. Redis outages cannot
  durably record the initial increment. Manual/video forced rebuilds retain
  their existing trigger behavior.
- Routing coverage does not establish final evidence coverage or answer quality.
  Added content queries have real cost; evaluate downstream ranking, failure
  rate and end-to-end latency before claiming a quality or performance gain.
