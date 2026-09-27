# open-system-one

**An independent, reproducible benchmark of TypeSafe's [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) against open, CPU-only alternatives.**

This is *not* an open-source implementation of Jev, and it does not claim to beat it.
It is a measurement: 10,000 classification/routing decisions, one machine, one set of
option descriptions, run through six different stacks — and an honest account of
which ideas worked, which didn't, and what each one costs in latency, RAM and CPU.

**Write-up** — [the full story, with the eight approaches that failed](https://huggingface.co/blog/dylantom2012/i-benchmarked-jev-against-open-cpu-only-stacks-it)

**Artifacts** — [model (8 floats)](https://huggingface.co/dylantom2012/fly-head-potion-8m) ·
[per-item predictions](https://huggingface.co/datasets/dylantom2012/open-system-one-bench) ·
[results explorer](https://huggingface.co/spaces/dylantom2012/open-system-one) ·
[live demo](https://huggingface.co/spaces/dylantom2012/open-system-one-demo)

中文版：[README.zh.md](README.zh.md) · 详细报告：[REPORT.md](out/REPORT.md)

---

## What Jev is, and the hypothesis we tested

Jev is a "System One Model": it doesn't generate text. You send it a `state` plus a set
of typed questions whose options (`criteria`) are supplied **at request time**, and it
returns a choice with calibrated probabilities. TypeSafe reports 40–200× faster and
40–400× cheaper than frontier LLMs on classification.

The community's first guess — and ours — was:

> Jev ≈ a fast text encoder + a very small decision head.

The API shape supports it: because `criteria` arrive per request, Jev cannot be a
fixed-output classifier head. It has to score *(state, option)* pairs and rank them.

So we built exactly that, from open parts, and measured the gap.

## The benchmark

10,000 tasks, 2,500 from each of four public datasets, chosen to span a difficulty range
rather than to flatter any single method:

| dataset | options | what it tests |
|---|---|---|
| SST-2 | 2 | sentiment — lexical cues are strong |
| AG News | 4 | topic — abstract, terse category names |
| Emotion | 6 | fine-grained affect — label names carry little meaning |
| BANKING77 | 77 | intent routing — many mutually confusable options |

Splits are rebuilt deterministically from a fixed seed (`data.py`), so every row is
reproducible. No dataset text is redistributed — see [DATA_LICENSES.md](DATA_LICENSES.md).

All local numbers: **Apple M5 Pro, CPU only, batch = 1**, each model measured in its own
process. Jev is called through Cloudflare Workers AI (`typesafe/jev`).

## Results

Every stack was run twice: once with **bare label names** as the options
(`card_arrival`, `Sci/Tech`) and once with **enriched one-sentence descriptions**
([`descriptions.py`](descriptions.py)) — the *same* descriptions for every stack.
Both conditions are reported, because neither is neutral (see below).

| stack | sst2 (2) | ag_news (4) | emotion (6) | banking77 (77) | macro |
|---|---|---|---|---|---|
| typesafe/jev — bare label names | 89.8 % | 88.3 % | 58.6 % | 78.4 % | **78.8 %** |
| typesafe/jev — enriched descriptions | 91.6 % | 88.6 % | 59.0 % | 77.8 % | **79.3 %** |
| Cross-encoder base — bare label names | 85.5 % | 84.4 % | 76.2 % | 68.8 % | **78.7 %** |
| Cross-encoder base — enriched descriptions | 84.5 % | 84.6 % | 71.7 % | 56.9 % | **74.4 %** |
| Bi-encoder + head — bare label names | 81.1 % | 66.3 % | 43.6 % | 63.2 % | **63.6 %** |
| Bi-encoder + head — enriched descriptions | 82.8 % | 80.0 % | 50.8 % | 65.8 % | **69.9 %** |

**Best result per stack, zero-shot, no labels on either side:**

| | best macro | best condition | p50 latency | RAM |
|---|---|---|---|---|
| `typesafe/jev` (cloud) | **79.3 %** | enriched | 381 ms † | cloud |
| Cross-encoder, ModernBERT-base-zeroshot (149M) | **78.7 %** | bare | 50–616 ms * | — |
| Bi-encoder + 8-float head | 69.9 % | enriched | 15.7 ms | 490 MB |
| Qwen2.5-0.5B, generative | 49.6 % | bare | 112 ms | 2382 MB |

**A 149M open model on a CPU lands 0.6 pp behind Jev.**

\* scales linearly with option count: 50 ms at 2 options, 616 ms at 77 (shortlisted to 20).
† dominated by network round-trip; see Limitations.

### There is no neutral set of option descriptions

The single most useful thing we learned. The same edit — replacing terse labels with
one-sentence descriptions — moves the three architectures in **different directions**:

| reaction to enriched descriptions | sst2 | ag_news | emotion | banking77 | mean |
|---|---|---|---|---|---|
| `typesafe/jev` | +1.8 | +0.4 | +0.4 | −0.5 | **+0.5** |
| Bi-encoder (cosine) | +1.7 | **+13.7** | +7.2 | +2.5 | **+6.3** |
| Cross-encoder (NLI) | −1.0 | +0.2 | −4.5 | **−11.9** | **−4.3** |

- **Cosine similarity cannot expand a label's meaning.** `World / Sports / Business /
  Sci-Tech` carries almost no signal for a dot product, so the bi-encoder gains +13.7 pp
  on AG News once you spell the categories out.
- **The cross-encoder and Jev already do that expansion internally**, so they gain
  nothing — and the cross-encoder is actively hurt by long hypotheses.
- **The BANKING77 collapse (−11.9 pp) is our fault, and instructive**: 70+ of our 77
  descriptions begin with *"The customer …"*. That shared prefix makes the options
  near-identical as NLI hypotheses. With 2 options a shared prefix is harmless; with 77
  it is fatal.

So "give every system the same text" is **not** the same as "be fair". Verbaliser design
is a per-architecture tuning knob, and we publish `descriptions.py` precisely so someone
can write better ones and re-run.

### With 2,000 labels per task — **not comparable to Jev**

Jev receives no labels, so this is a different problem, not a win.

| stack | macro acc | p50 latency | RAM |
|---|---|---|---|
| ModernBERT-embed + linear head | **82.6 %** | 15.8 ms | 490 MB |
| MiniLM-L6 + linear head | 79.5 % | 2.8 ms | 452 MB |
| **potion-base-8M (static embedding) + linear head** | **78.2 %** | **0.1 ms** | **82 MB** |

Per task, ModernBERT-embed + head vs Jev: **BANKING77 88.8 % vs 77.8 % (+11.0)**,
AG News +0.9, Emotion +7.2, SST-2 −5.8.

The last row is the result we find most interesting: an 8M-parameter static embedding
(pure lookup — no attention, no matrix multiply in the forward pass) plus a decision head
whose entire parameter count is **eight floats**, reaching the accuracy of a cloud
decision model at 0.1 ms and 82 MB. The head trains in 0.1 s.

## Update — Laya, and a fourth architecture

A week after Jev, [Laya](https://huggingface.co/convaiinnovations/laya) shipped: an
Apache-2.0 System One model, ModernBERT-large + a decision head, 421M params. It answers
every option in **one forward pass** by scoring each option at its own `[MASK]` token —
the thing our cross-encoder cannot do, and the reason our latency scales with option count.

We ran it through the same 10,000 items, same bare label names, same measurement discipline.
**As far as we know this is the first time Laya and Jev have been measured on identical items.**
(Laya's own README compares against third-party published Jev numbers on different samples
and 72 vs 77 labels; our Jev column is directly measured.)

| stack | sst2 | ag_news | emotion | banking77 | macro | p50 latency |
|---|---|---|---|---|---|---|
| `typesafe/jev` (enriched) | 91.6 % | 88.6 % | 59.0 % | 77.8 % | **79.3 %** | 381 ms |
| Cross-encoder 149M (bare) | 85.5 % | 84.4 % | **76.2 %** | 68.8 % | **78.7 %** | 50–616 ms |
| **Laya 421M (bare)** | 86.5 % | **93.9 %** | 58.2 % | 54.3 % | **73.2 %** | 19–86 ms *(MPS)* / **60–309 ms** *(CPU)* |
| bi-encoder + head, 2k labels | 85.8 % | 89.5 % | 66.2 % | **88.8 %** | **82.6 %** | 15.8 ms |

Three things fall out of this:

**Laya wins AG News outright** — 93.9 %, 5.3 pp above Jev. Its own README claims 0.950 there;
we measure 0.939. Its published Emotion figure (0.595) matches our 0.582. **Its self-reported
numbers hold up**, which is worth saying plainly.

**Its high-cardinality weakness is real, and we partially fixed it.** Laya's docs explain the
failure honestly: 77 options share a fixed `head_max_len`, so each label gets 3–4 tokens and
the texts stop being distinguishable. They recommend *"split large option sets into a two-step
coarse-to-fine hierarchical choice"* — but do not implement it. We had independently built
exactly that for our own cross-encoder, so we bolted it on:

| BANKING77, 77 options | accuracy | p50 (MPS) | p50 (CPU) |
|---|---|---|---|
| Laya, all 77 options | 54.3 % | 86.3 ms | 309.0 ms |
| **Laya + our zero-shot bi-encoder shortlist to top-20** | **60.8 %** | **39.8 ms** | **169.9 ms** |
| *(shortlist ceiling, recall@20)* | *97.8 %* | — | — |

*(CPU column measured on a 250-item sample, `laya_cpu.py` / `LAYA_DEVICE=cpu`; it scores
53.6 % and 62.0 % on that sample, consistent with the full-set 54.3 % / 60.8 %.)*

**+6.5 pp and latency cut in half.** Still 17 pp behind Jev on this task, so the token-budget
problem is mitigated rather than solved — but the fix costs one cheap bi-encoder pass and is
the only thing here that made both accuracy and latency better at once.

**Correction — Laya's original latencies were Apple GPU, not CPU.** We first published these
as CPU numbers. They were not. `laya.load()` auto-selects `cuda > mps > cpu` and silently
chose **mps** on this Mac, while every other stack in this repo is pure CPU, batch=1. Re-measured
like-for-like, Laya costs 59.5 ms (SST-2) / 78.0 ms (AG News) / 61.9 ms (Emotion) / **309.0 ms**
(BANKING77) on CPU — roughly 3× its MPS figures. That mostly removes Laya's apparent latency win
over Jev on the hardest task (309 ms vs 381 ms) while it still scores 54.3 % against Jev's 77.8 %.
It also makes the shortlist worth more, not less: on CPU it cuts 309 ms to 170 ms.

The lesson generalises past this one number — we had strict discipline about RAM (one model per
process) but none about **device**. Anything auto-selected (device, dtype, thread count, batch)
has to be written into the result file, not remembered. `laya_bench.py` and `laya_shortlist.py`
now record `device` and accept `LAYA_DEVICE`.

**The three architectures fail in three different ways.** Bi-encoder: no interaction between
text and option, so abstract labels kill it. Cross-encoder: one forward pass per option, so
latency scales with cardinality. Single-pass option markers: all options share one token
budget, so cardinality destroys accuracy instead of speed. There is no free lunch; pick the
failure mode you can live with.

## Update — the decision head's objective was wrong

Laya is trained with RLCD against strictly proper scoring rules. That prompted us to look at
our own objective, which was `0.7 × mean accuracy + 0.3 × worst-task accuracy` — a rule that
gives **zero credit for reporting honest probabilities**. We swapped it for the log score,
with the temperature optimised inside each evaluation.

| ES objective | macro accuracy | mean ECE | mean NLL |
|---|---|---|---|
| accuracy (before) | 82.6 % | 0.018 | 0.490 |
| **strictly proper (log score)** | **83.6 %** | 0.018 | **0.462** |

The result is not what we expected. **Calibration did not move** (ECE 0.018 either way) —
temperature scaling on a held-out dev split was already doing that job, so the missing
calibration term had not actually been costing us anything. What improved was **accuracy**,
by 1.0 pp, biggest on SST-2 (+1.8) and Emotion (+2.0).

The explanation is about optimisation, not calibration: accuracy is a step function, so the
(1+λ)-ES searches a landscape of plateaus. The log score is smooth and rewards margin, which
gives an evolution strategy something like a gradient to follow. **We went looking for better
probabilities and found a better search signal instead.**

## Update — Chinese, and a confidence trap

Laya ships a multilingual checkpoint (mmBERT-base, 322M, 100+ languages). Its own benchmarks
cover MASSIVE and XNLI; we tested something it does not: **CLUE/TNEWS**, Chinese news-headline
classification, 15 classes, 600 items.

| checkpoint | accuracy | mean confidence | overconfidence gap | p50 |
|---|---|---|---|---|
| `laya-multilingual` | **39.2 %** | 0.756 | +0.365 | 14.3 ms |
| `laya` (English root) | 22.5 % | **0.968** | **+0.743** | 42.5 ms |
| *random* | *6.7 %* | — | — | — |

The English checkpoint on Chinese is the dangerous case: **22.5 % right while 96.8 % confident.**
This reproduces, in Chinese, the failure Laya documents for Khmer — *"the model stays confident
while being wrong, so confidence gating cannot save you."* If you serve mixed-language traffic,
route on script before the forward pass; do not rely on confidence thresholds to catch it.

The multilingual checkpoint is usable — 6× random at 14 ms — but it is **also overconfident by
0.365**. Fit your own temperature on your own data before trusting any probability it gives you.

## What did not work

Eight ideas we tested and would otherwise have guessed were wins. These cost us a day;
they are the part of this repo most likely to save you one.

| idea | result |
|---|---|
| Template ensembling (3 NLI hypotheses), base backbone | **0.0 pp** — the three templates' errors are highly correlated |
| Evolutionary search over decision-head weights, honest LODO transfer | **−1.5 pp** — negative transfer; only helps when the underlying signal is weak |
| Scaling the cross-encoder 149M → 395M | **+2.8 / −3.2 / +0.2 pp** across three tasks — no net gain for 3× the cost |
| Listwise re-ranking with Qwen2.5-1.5B over the top-5 | **−1.0 pp** vs the cross-encoder alone |
| Column-centering the NLI scores | **0.0 pp** macro — helps BANKING77 +2.6, hurts Emotion −3.1 |
| Asymmetric `search_query:`/`search_document:` prefixes | **−1.8 pp** — classification-by-similarity is not retrieval |
| Distilling the cross-encoder into the bi-encoder head | **−5.4 pp** vs the teacher; collapses on Emotion (−18.8 pp) |
| Raw `ModernBERT-base` (MLM) as a sentence encoder | **35.0 %**, worse than an 8M static embedding — training objective dominates scale |

The one thing that *did* work was architectural: scoring *(text, option)* **jointly**
(cross-encoder) instead of embedding them separately and comparing cosines. That single
change is worth **+12 to +24 pp** depending on the task, and it is the reason a 149M
open model lands within 0.1 pp of Jev.

## How this was built

**The repository owner does not program.** The contribution was a hunch and a set of
judgement calls:

> *"The hyped Jev model is probably just a fast text encoder in front of a small
> decision head. Can we reproduce it with a static embedding, MiniLM, and ModernBERT?"*

Every experiment, measurement and analysis here was designed and run by **Claude Code
(Opus 5)** in a single working session — including the eight ideas that failed and two
measurement bugs it introduced and then caught (a latency run contaminated by concurrent
HTTP traffic, and a results file it overwrote).

That is not the same as "the AI did it all". Three interventions from the owner changed
the outcome, and none of them required writing a line of code:

1. **"Drop Qwen."** The agent had started ensembling a generative model into a stack
   whose whole premise was cheap local parts, for a gain that turned out to be negative.
2. **"Test under genuinely fair conditions. We need the real numbers before we decide."**
   This forced the enriched-description re-run — which produced the most interesting
   finding in this repo.
3. **"Are you sure the task hasn't drifted?"** It had. That question pulled a day's work
   back onto its original question.

All raw outputs are committed, so the numbers can be **checked rather than trusted**.
We think that is how a benchmark should be published: not "believe our table", but
"here is every file we produced, find our mistakes".

## Where this goes next

The gap in the zero-shot setting is small and the latency advantage is real. Neither is
the end of the line. Things we have **not** tried, roughly in order of expected value —
PRs welcome:

- **Quantisation / ONNX export** of the cross-encoder — expected 3–5× lower latency at
  the same accuracy. This is the single cheapest win available.
- **Stronger cross-encoder backbones**: `deberta-v3-large-zeroshot`, `bge-reranker-v2`.
  Our 149M → 395M scaling test was a wash, but those are different model families.
- **Hybrid shortlisting** (BM25 + dense) for many-option tasks. On BANKING77 our dense
  shortlist already reaches 98.1 % recall@20; the bottleneck is the re-ranker, not recall.
- **Listwise re-ranking with a stronger model** than the 1.5B we tried, which failed.
- **Fine-tuning a cross-encoder on diverse classification data.** This is the honest path
  to actually beating Jev zero-shot, and it is a training project, not a prompt tweak.
- **Batched / GPU serving**, which changes the cost picture entirely for offline work.
- **More datasets and more languages.** Four English datasets is a narrow slice.

## Cost

Jev, measured: 6,764,108 input tokens for 10,000 decisions = **$0.284**
($0.042 per million input tokens, output free), 0 failures, 0 invalid outputs.

## Reproduce

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python \
  torch transformers sentence-transformers model2vec datasets scikit-learn psutil
.venv/bin/python data.py
./encode_isolated.sh
.venv/bin/python run.py heads
.venv/bin/python cross_v2.py --model base --ds sst2,emotion,ag_news --n 2500 --templates 1
.venv/bin/python cross_v2.py --model base --ds banking77 --n 2500 --templates 1 --topk 20
.venv/bin/python frontier.py
```

Jev columns need Cloudflare credentials — see [.env.example](.env.example).

## Limitations

1. **Jev's latency is almost entirely network.** 2 options and 77 options both take
   ~381 ms from our location (input tokens differ 5×, latency differs 5%). Jev's own
   compute time is too small for us to measure. "Local is 7× faster" means we skipped a
   round trip, not that we out-computed it.
2. **Single seed, single machine, one run per configuration.** No confidence intervals.
   Sub-sample checks moved results by up to ±2 pp.
3. **Calibration (ECE) is not compared fairly.** Our temperatures are fitted on 1,000
   labeled dev examples; Jev gets none.
4. **We are not TypeSafe.** Jev is a black box to us; we only observe its API.
   If we have mis-configured it, please open an issue — we will re-run and correct.

## License

Code: MIT. Datasets and models retain their own licenses — see
[DATA_LICENSES.md](DATA_LICENSES.md).
