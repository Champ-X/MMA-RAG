"""Compare real single-summary and batch embedding without rebuilding any index.

Uses frozen existing summaries, not generated test questions. Both paths call the
same provider/model/options without a local embedding cache or model fallback.
This measures offline portrait embedding, not online retrieval or answer quality.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def run(args):
    from app.core.llm.manager import llm_manager

    rows = json.loads(args.portraits.read_text())
    texts, selected, kb_ids = [], [], set()
    for row in sorted(rows, key=lambda item: str(item["id"])):
        payload = row["payload"]
        summary = str(payload.get("topic_summary") or "").strip()
        if not summary or payload.get("kb_id") in kb_ids:
            continue
        texts.append(summary)
        selected.append({"portrait_id": row["id"], "summary_sha256": hashlib.sha256(summary.encode()).hexdigest()})
        kb_ids.add(payload.get("kb_id"))
        if len(texts) == args.count:
            break
    if len(texts) != args.count:
        raise ValueError("Insufficient distinct-KB summaries")

    model = llm_manager.registry.get_task_model("embedding")
    config = llm_manager.registry.get_model_config(model)
    options = config.get("embedding_options", {})
    dimensions = config["embedding_dimensions"]
    timings = {"sequential": [], "batch": []}
    rounds = []

    async def embed(values):
        result = await llm_manager.embed(texts=values, model=model, fallback=False,
                                         attempt_timeout=30, total_timeout=45, **options)
        matrix = np.asarray(result.data, dtype=np.float64) if result.success else np.asarray([])
        if (not result.success or result.model_used != model or matrix.shape != (len(values), dimensions)
                or not np.isfinite(matrix).all() or not (np.linalg.norm(matrix, axis=1) > 0).all()):
            raise RuntimeError(f"Invalid embedding result: {result.error_category or 'invalid_vectors_or_model'}")
        return matrix

    for index in range(args.rounds):
        vectors = {}
        order = ["sequential", "batch"] if index % 2 == 0 else ["batch", "sequential"]
        for mode in order:
            started = time.perf_counter()
            if mode == "sequential":
                vectors[mode] = np.concatenate([await embed([text]) for text in texts], axis=0)
            else:
                vectors[mode] = await embed(texts)
            timings[mode].append(time.perf_counter() - started)
        first, second = vectors["sequential"], vectors["batch"]
        similarities = np.sum(first * second, axis=1) / (np.linalg.norm(first, axis=1) * np.linalg.norm(second, axis=1))
        receipt = {"round": index + 1, "order": order,
                   "seconds": {mode: timings[mode][-1] for mode in timings},
                   "min_cosine": float(similarities.min()),
                   "max_absolute_difference": float(np.max(np.abs(first - second))),
                   "allclose_atol_1e_6_rtol_1e_5": bool(np.allclose(first, second, atol=1e-6, rtol=1e-5))}
        rounds.append(receipt)
        print(json.dumps(receipt), flush=True)

    report = {
        "schema_version": "portrait-embedding-batch-benchmark-1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_sha256": hashlib.sha256(args.portraits.read_bytes()).hexdigest(), "selected": selected,
        "model": model, "provider": config["provider"], "embedding_space": config.get("embedding_space"),
        "dimensions": dimensions, "embedding_options": options, "local_cache": False, "fallback": False,
        "requests_per_round": {"sequential": len(texts), "batch": 1},
        "median_seconds": {mode: statistics.median(values) for mode, values in timings.items()},
        "rounds": rounds,
        "all_vectors_equivalent": all(row["allclose_atol_1e_6_rtol_1e_5"] for row in rounds),
        "limits": ["Offline portrait embedding only; no online retrieval latency claim.",
                   "Small real-provider sample; network variance is not eliminated by alternating order.",
                   "No summary generation, index mutations or production portrait rebuilds."],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    if not report["all_vectors_equivalent"]:
        raise SystemExit("Batch equivalence check failed; keep the receipt and investigate")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portraits", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()
    if not 2 <= args.count <= 8 or not 2 <= args.rounds <= 5:
        parser.error("count must be 2-8 and rounds 2-5")
    if args.output.exists():
        parser.error("output already exists")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
