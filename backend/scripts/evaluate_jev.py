"""Real API paired reranking experiment; frozen inputs and resumable receipts.

Runs the project's Reranker candidate selection, score fusion and final selection.
Recall is controlled: lexical ordering of a fixed labeled pool, not live hybrid
retrieval. Failed experimental calls remain failures, never successful Jev scores.
"""
import argparse
import asyncio
import hashlib
import json
import math
from pathlib import Path
import random
import re
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def percentile(values, p):
    if not values:
        return None
    v = sorted(values)
    pos = (len(v) - 1) * p
    lo = int(pos)
    return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (pos - lo)


def metrics(ranking, docs, k=5):
    labels = {d["id"]: d["relevance"] for d in docs}
    if not any(labels.values()):
        raise ValueError("Ranking metrics undefined without a positive qrel")
    rel = [labels[i] for i in ranking[:k]]
    ideal = sorted(labels.values(), reverse=True)[:k]
    dcg = lambda values: sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(values))
    return {
        "ndcg5": dcg(rel) / dcg(ideal) if dcg(ideal) else 0,
        "recall5": sum(r > 0 for r in rel) / sum(r > 0 for r in labels.values()),
        "mrr5": next((1 / (i + 1) for i, r in enumerate(rel) if r), 0),
        "hit1": float(bool(rel and rel[0])),
    }


def coarse_candidates(case):
    def grams(text):
        s = re.sub(r"\s+", "", text.lower())
        return {s[i:i + 2] for i in range(max(1, len(s) - 1))}
    query = grams(case["query"])
    def overlap(doc):
        tokens = grams(doc["text"])
        return len(query & tokens) / max(1, len(query | tokens))
    docs = sorted(case["documents"], key=overlap, reverse=True)
    return [{"id": d["id"], "score": 1 / (60 + i + 1), "content_type": "doc",
             "payload": {"text_content": d["text"], "file_path": "evidence.txt", "file_id": d["id"]}}
            for i, d in enumerate(docs)]


async def run(args, cases, fingerprint):
    import os
    from dotenv import load_dotenv
    if args.provider_env:
        load_dotenv(args.provider_env, override=False)
    if args.jev_key_file:
        secret_text = args.jev_key_file.read_text().strip()
        key = re.split(r"[:=：]", secret_text, maxsplit=1)[-1].strip().strip("\"'")
    else:
        key = os.environ.get("TYPESAFE_API_KEY", "")
    from loguru import logger
    logger.remove()
    from app.modules.retrieval.reranker import Reranker
    from app.core.llm.jev import JevClient, JevError, PROMPT_VERSION
    from app.core.llm.manager import LLMCallResult
    import httpx
    logger.remove()

    class MeasuredQwen:
        """Exact SiliconFlow rerank request shape, retaining its usage receipt.

        Unlike the manager, the harness intentionally has no model fallback.
        """
        def __init__(self):
            self.receipt = None

        async def rerank(self, query, documents, **kwargs):
            start = time.perf_counter()
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post("https://api.siliconflow.cn/v1/rerank", headers={
                    "Authorization": "Bearer " + os.environ["SILICONFLOW_API_KEY"]}, json={
                    "model": "Qwen/Qwen3-Reranker-8B", "query": query,
                    "documents": [d.strip() for d in documents]})
            if response.status_code != 200:
                raise RuntimeError(f"qwen_http_{response.status_code}")
            data = response.json()
            scores = data.get("results", [])
            if len(scores) != len(documents) or {r["index"] for r in scores} != set(range(len(documents))):
                raise RuntimeError("qwen_incomplete_response")
            self.receipt = {"model": "Qwen/Qwen3-Reranker-8B", "usage": data.get("usage"),
                            "duration_s": time.perf_counter() - start, "scores": scores}
            return LLMCallResult(success=True, data=scores, model_used=self.receipt["model"])

    previous = [json.loads(line) for line in args.receipts.read_text().splitlines()] if args.receipts.exists() else []
    if any(row["fingerprint"] != fingerprint or row["prompt_version"] != PROMPT_VERSION for row in previous):
        raise ValueError("Receipt dataset/prompt mismatch")
    previous_used = sum(row.get("jev", {}).get("usage", {}).get("input_tokens", 0) for row in previous)
    failure_count = sum(bool(row.get('jev', {}).get('error')) for row in previous)
    if failure_count and not args.resume_after_error:
        raise ValueError("Failed receipts exist: inspect them, then explicitly resume with conservative billing reservation")
    # Client rejects payloads above this reservation. Treat every unknown billed
    # attempt as consuming the full ceiling; never erase or retry the failed row.
    previous_used += failure_count * 60_000
    scorer = JevClient(key, timeout_s=args.timeout, max_input_tokens=max(0, args.max_jev_input_tokens - previous_used))
    done = {row["id"] for row in previous}
    args.receipts.parent.mkdir(parents=True, exist_ok=True)
    pending = [c for c in cases if c["id"] not in done and (args.split == "all" or c["split"] == args.split)]
    for index, case in enumerate(pending[:args.max_cases]):
        raw = {"dense": coarse_candidates(case)}
        reranker = Reranker()
        reranker.final_top_k = 20  # Retain all for scoring; production limit is 10.
        reranker.jev_mode = "off"
        qwen = MeasuredQwen()
        reranker.llm_manager = qwen
        coarse = reranker._prepare_coarse_ranking(raw)
        selected = reranker._select_candidates_for_reranking(coarse, None)
        documents = [reranker._build_document_content(d) for d in selected]
        row = {"id": case["id"], "suite": case["suite"], "split": case["split"],
               "fingerprint": fingerprint, "prompt_version": PROMPT_VERSION,
               "candidate_ids": [d["id"] for d in selected],
               "input_sha256": hashlib.sha256(json.dumps([case["query"], documents], ensure_ascii=False).encode()).hexdigest(),
               "truncated_documents": sum(len(f"[文档片段] 来源: evidence.txt\n内容: {d['text']}") > 1000 for d in case["documents"]),
               "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

        async def baseline():
            start = time.perf_counter()
            result = await reranker.rerank(case["query"], raw)
            if qwen.receipt is None:
                row["qwen"] = {"error": "baseline_call_failed"}
                return
            row["qwen"] = {**qwen.receipt, "pipeline_duration_s": time.perf_counter() - start,
                           "ranking": [d["id"] for d in result["results"]]}
            # Omit provider echo of public documents; scores and IDs suffice.
            row["qwen"]["scores"] = [{"index": s["index"], "relevance_score": s["relevance_score"]} for s in qwen.receipt["scores"]]

        async def experiment():
            start = time.perf_counter()
            try:
                result = await scorer.score(case["query"], documents)
                proposed = reranker._merge_scores(case["query"], selected, result.scores)
                proposed.sort(key=lambda d: d["final_score"], reverse=True)
                proposed = reranker._apply_final_ranking_with_modality_protection(proposed, None)
                row["jev"] = {**result.metadata(), "scores": result.scores,
                              "pipeline_duration_s": time.perf_counter() - start,
                              "ranking": [d["id"] for d in proposed]}
            except JevError as exc:
                row["jev"] = {"error": str(exc), "duration_s": time.perf_counter() - start}

        if args.parallel_providers:
            ensemble_started = time.perf_counter()
            await asyncio.gather(baseline(), experiment())
            row['ensemble_parallel_duration_s'] = time.perf_counter() - ensemble_started
        else:
            # Sequential alternating order: avoid one provider always seeing cold network first.
            for operation in ([baseline, experiment] if index % 2 else [experiment, baseline]):
                await operation()
        with args.receipts.open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{case['id']}: Jev {row['jev'].get('duration_s', 0):.3f}s, Qwen {row['qwen'].get('duration_s', 0):.3f}s; tokens={previous_used + scorer.reserved_input_tokens}", flush=True)
        if any(row[k].get("error") for k in ("jev", "qwen")):
            print("Stopped after provider failure; inspect receipt. No automatic retry.", flush=True)
            break


def report(args, cases, fingerprint):
    rows = [json.loads(line) for line in args.receipts.read_text().splitlines()]
    case_map = {c["id"]: c for c in cases}
    assert len({r['id'] for r in rows}) == len(rows)
    assert all(r['fingerprint'] == fingerprint for r in rows)
    valid = [r for r in rows if all(not r[k].get('error') for k in ('jev', 'qwen'))]
    output = {"fingerprint": fingerprint, "cases_completed": len(rows), "paired_successes": len(valid),
              "failures": [{"id": r["id"], "jev": r["jev"].get("error"), "qwen": r["qwen"].get("error")}
                           for r in rows if r not in valid],
              "scope": "Real APIs; frozen capped candidates; project reranker fusion; not full retrieval or answer quality.",
              "jev_estimated_usd": sum(r['jev'].get('estimated_usd', 0) for r in rows),
              "jev_input_tokens": sum(r['jev'].get('usage', {}).get('input_tokens', 0) for r in rows),
              "qwen_usage": [r['qwen'].get('usage') for r in rows], "groups": {}}
    eligible = [r for r in valid if any(d['relevance'] for d in case_map[r['id']]['documents'])]
    output['ranking_ineligible_no_positive_qrels'] = [r['id'] for r in valid if r not in eligible]
    groups = sorted({(r['suite'], r['split']) for r in eligible}) + [('all', 'test')]
    for suite, split in groups:
        group = [r for r in eligible if r['split'] == split and (suite == 'all' or r['suite'] == suite)]
        if not group:
            continue
        values = {mode: [] for mode in ['lexical', 'qwen', 'jev', 'cascade', 'ensemble']}
        cascaded = 0
        for row in group:
            by_score = sorted(row['jev']['scores'], key=lambda s: s['relevance_score'], reverse=True)
            # Preregistered diagnostic policy, no fitting on test results.
            accept = by_score[0]['relevance_score'] >= .8 and (len(by_score) < 2 or by_score[0]['relevance_score'] - by_score[1]['relevance_score'] >= .3)
            cascaded += int(not accept)
            chosen = 'jev' if accept else 'qwen'
            for mode in values:
                if mode == 'ensemble':
                    score_maps = {k: {s['index']: s['relevance_score'] for s in row[k]['scores']} for k in ('qwen', 'jev')}
                    indices = sorted(range(len(row['candidate_ids'])), key=lambda i: .7 * (.5 * score_maps['qwen'][i] + .5 * score_maps['jev'][i]) + .3 / (61 + i), reverse=True)
                    ranking = [row['candidate_ids'][i] for i in indices]
                    duration = row.get('ensemble_parallel_duration_s', max(row[k]['pipeline_duration_s'] for k in ('qwen','jev')))
                else:
                    ranking = row['candidate_ids'] if mode == 'lexical' else row[chosen if mode == 'cascade' else mode]['ranking']
                    duration = 0 if mode == 'lexical' else row['jev']['pipeline_duration_s'] + (0 if accept else row['qwen']['pipeline_duration_s']) if mode == 'cascade' else row[mode]['pipeline_duration_s']
                values[mode].append({**metrics(ranking, case_map[row['id']]['documents']), 'duration_s': duration})
        summary = {'n': len(group), 'cascade_qwen_calls': cascaded}
        for mode, items in values.items():
            summary[mode] = {k: statistics.mean(v[k] for v in items) for k in ('ndcg5', 'recall5', 'mrr5', 'hit1')}
            summary[mode].update({f'latency_{name}_s': percentile([v['duration_s'] for v in items], p) for name, p in [('p50', .5), ('p95', .95)]})
        diffs = [j['ndcg5'] - q['ndcg5'] for j, q in zip(values['jev'], values['qwen'])]
        rng = random.Random(42)
        boot = [statistics.mean(rng.choices(diffs, k=len(diffs))) for _ in range(2000)]
        summary['jev_minus_qwen_ndcg5'] = {'mean': statistics.mean(diffs), 'bootstrap95': [percentile(boot, .025), percentile(boot, .975)]}
        diffs = [j['ndcg5'] - q['ndcg5'] for j, q in zip(values['ensemble'], values['qwen'])]
        boot = [statistics.mean(rng.choices(diffs, k=len(diffs))) for _ in range(2000)]
        summary['ensemble_minus_qwen_ndcg5'] = {'mean': statistics.mean(diffs), 'bootstrap95': [percentile(boot,.025),percentile(boot,.975)]}
        summary['ensemble_latency_measured'] = all('ensemble_parallel_duration_s' in r for r in group)
        output['groups'][f'{suite}/{split}'] = summary
    output['regressions'] = []
    for row in eligible:
        docs = case_map[row['id']]['documents']
        q, j = (metrics(row[k]['ranking'], docs) for k in ('qwen', 'jev'))
        if j['ndcg5'] < q['ndcg5']:
            output['regressions'].append({'id': row['id'], 'query': case_map[row['id']]['query'], 'qwen': q, 'jev': j})
    output['pair_diagnostics'] = {}
    for suite in sorted({r['suite'] for r in valid}):
        pairs = []
        for row in valid:
            if row['suite'] != suite or row['split'] != 'test':
                continue
            labels = {d['id']: int(d['relevance'] > 0) for d in case_map[row['id']]['documents']}
            pairs.extend((s['relevance_score'], labels[row['candidate_ids'][s['index']]]) for s in row['jev']['scores'])
        if not pairs:
            continue
        ece = 0
        for i in range(10):
            bucket = [(p, y) for p, y in pairs if min(9, int(p * 10)) == i]
            if bucket:
                ece += len(bucket) / len(pairs) * abs(statistics.mean(p for p, _ in bucket) - statistics.mean(y for _, y in bucket))
        output['pair_diagnostics'][suite] = {
            'pairs': len(pairs), 'brier': statistics.mean((p-y)**2 for p, y in pairs), 'ece10': ece,
            'threshold_0.5_accuracy': statistics.mean((p >= .5) == y for p, y in pairs),
            'caveat': 'Correlated pairs; incomplete public qrels; scores are not validated correctness probabilities.',
        }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k not in {'qwen_usage', 'regressions'}}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--provider-env', type=Path)
    parser.add_argument('--jev-key-file', type=Path)
    parser.add_argument('--split', choices=['dev', 'test', 'all'], default='dev')
    parser.add_argument('--max-cases', type=int, default=20)
    parser.add_argument('--max-jev-input-tokens', type=int, default=1_000_000)
    parser.add_argument('--timeout', type=float, default=3)
    parser.add_argument('--dataset', type=Path, default=ROOT / 'evals/jev_v1')
    parser.add_argument('--parallel-providers', action='store_true')
    parser.add_argument('--resume-after-error', action='store_true')
    parser.add_argument('--receipts', type=Path, default=ROOT / 'docs/research/jev/results/paired.jsonl')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/research/jev/results/summary.json')
    args = parser.parse_args()
    dataset = (args.dataset / 'cases.jsonl').read_bytes()
    fingerprint = hashlib.sha256(dataset).hexdigest()
    manifest = json.loads((args.dataset / 'manifest.json').read_text())
    assert manifest['sha256'] == fingerprint, 'Dataset fingerprint mismatch'
    cases = [json.loads(line) for line in dataset.splitlines()]
    if args.live:
        asyncio.run(run(args, cases, fingerprint))
    report(args, cases, fingerprint)


if __name__ == '__main__':
    main()
