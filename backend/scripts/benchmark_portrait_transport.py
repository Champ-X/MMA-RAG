"""Read-only paired Qdrant benchmark on frozen real query embeddings.

Run with PYTHONPATH=backend .venv/bin/python backend/scripts/benchmark_portrait_transport.py
--fixture data/.../frozen-v1 --output data/.../transport.json
No model calls, collection writes, or timing assertions in CI.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from qdrant_client import QdrantClient, models

from app.core.config import settings


def identity(rows):
    records = sorted([r.model_dump(mode="json") for r in rows], key=lambda r: str(r["id"]))
    return hashlib.sha256(json.dumps(records, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def snapshot(client):
    rows, offset = [], None
    while True:
        page, offset = client.scroll("kb_portraits", offset=offset, limit=256, with_payload=True, with_vectors=True)
        rows.extend(page)
        if offset is None:
            return identity(rows)


def query_summaries(client, vector, payload):
    """Benchmark the production summary route while hashing the full index."""
    return client.query_points(
        "kb_portraits", query=vector, limit=30, with_payload=payload,
        query_filter=models.Filter(must_not=[models.FieldCondition(
            key="portrait_role", match=models.MatchValue(value="topic_prototype"),
        )]),
    )


def summarize(full, compact):
    a, b = np.asarray(full), np.asarray(compact)
    rng = np.random.default_rng(20261027)
    # Pair-level resampling preserves query/order pairing. These are transport
    # observations on this host, not independent end-user latency measurements.
    ratios = []
    for _ in range(2000):
        idx = rng.integers(0, len(a), len(a))
        ratios.append(float(np.median(b[idx]) / np.median(a[idx])))
    return {
        "pairs": len(a),
        "full_ms": {"p50": float(np.median(a)), "p95": float(np.quantile(a, .95))},
        "compact_ms": {"p50": float(np.median(b)), "p95": float(np.quantile(b, .95))},
        "paired_median_delta_ms": float(np.median(b - a)),
        "median_ratio_ci95": np.quantile(ratios, [.025, .975]).tolist(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    if args.output.exists():
        parser.error("refusing to overwrite an existing result")
    vectors = np.load(args.fixture / "queries.npy", allow_pickle=False)
    if vectors.ndim != 2 or not len(vectors) or not np.isfinite(vectors).all():
        raise ValueError("invalid frozen query matrix")
    cases = json.loads((args.fixture / "cases.json").read_text())
    if len(cases) != len(vectors):
        raise ValueError("query/case count mismatch")
    client = QdrantClient(**settings.get_qdrant_config(), https=False)
    before = snapshot(client)
    report = {"protocol": "portrait-payload-paired-v1", "queries": len(vectors),
              "query_sha256": hashlib.sha256((args.fixture / "queries.npy").read_bytes()).hexdigest(),
              "portrait_before": before, "repeats": args.repeats,
              "scope": "Qdrant summary-only portrait lookup; excludes embedding, rewrite, content search and reranking",
              "results": {}, "mismatches": [], "observations": []}
    payload_bytes = {"full": [], "compact": []}
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for concurrency in (1, 4):
                groups = [list(range(i, min(i + concurrency, len(vectors)))) for i in range(0, len(vectors), concurrency)]
                latencies = {"full": [], "compact": []}
                # Equal warmup outside measurements.
                for payload in (True, ["kb_id", "cluster_size"]):
                    query_summaries(client, vectors[0].tolist(), payload)
                for repeat in range(args.repeats):
                    for group_index, indices in enumerate(groups):
                        outputs, elapsed = {}, {}
                        order = ("full", "compact") if (repeat + group_index) % 2 == 0 else ("compact", "full")
                        for mode in order:
                            payload = True if mode == "full" else ["kb_id", "cluster_size"]

                            def search(index):
                                return query_summaries(client, vectors[index].tolist(), payload)

                            start = time.perf_counter()
                            outputs[mode] = list(pool.map(search, indices))
                            elapsed[mode] = (time.perf_counter() - start) * 1000
                            latencies[mode].append(elapsed[mode])
                            for result in outputs[mode]:
                                payload_bytes[mode].append(len(json.dumps([p.payload for p in result.points], ensure_ascii=False).encode()))
                        for index, full, compact in zip(indices, outputs["full"], outputs["compact"]):
                            def signature(result):
                                return [(str(p.id), float(p.score), p.payload.get("kb_id"), p.payload.get("cluster_size", 1)) for p in result.points]
                            if signature(full) != signature(compact):
                                report["mismatches"].append({"case_id": cases[index]["id"], "repeat": repeat, "concurrency": concurrency})
                        report["observations"].append({"concurrency": concurrency, "repeat": repeat, "case_ids": [cases[i]["id"] for i in indices], **elapsed})
                report["results"][str(concurrency)] = summarize(latencies["full"], latencies["compact"])
        report["portrait_after"] = snapshot(client)
        report["snapshot_unchanged"] = report["portrait_before"] == report["portrait_after"]
        report["mean_serialized_payload_bytes"] = {k: float(np.mean(v)) for k, v in payload_bytes.items()}
        report["equivalent"] = report["snapshot_unchanged"] and not report["mismatches"]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({k: v for k, v in report.items() if k != "observations"}, ensure_ascii=False, indent=2))
        if not report["equivalent"]:
            raise SystemExit("portrait snapshot/ranking changed; result is not acceptable")
    finally:
        client.close()


if __name__ == "__main__":
    main()
