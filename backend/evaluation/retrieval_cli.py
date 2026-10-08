"""`rag-eval retrieval`: versioned, evidence-level retrieval experiments."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .retrieval_data import prepare_scifact, snapshot_local
from .retrieval_metrics import compare_runs, score_run
from .retrieval_runner import BM25Retriever, run_retrieval
from .retrieval_schema import RetrievalDataset, read_jsonl


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="rag-eval retrieval")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare-scifact")
    prepare.add_argument("--output", type=Path, required=True)
    prepare.add_argument("--cache", type=Path, required=True)
    prepare.add_argument("--sentences-per-unit", type=int, default=3)
    snapshot = commands.add_parser("snapshot-local")
    snapshot.add_argument("--output", type=Path, required=True)
    snapshot.add_argument("--base-url", default="http://127.0.0.1:8000")
    snapshot.add_argument("--qdrant-url", default="http://127.0.0.1:6333")
    local = commands.add_parser("prepare-local")
    local.add_argument("--snapshot", type=Path, required=True)
    local.add_argument("--annotations", type=Path, required=True)
    local.add_argument("--output", type=Path, required=True)
    dense = commands.add_parser("prepare-dense")
    dense.add_argument("--dataset", type=Path, required=True)
    dense.add_argument("--output", type=Path, required=True)
    dense.add_argument("--batch-size", type=int, default=32)
    dense.add_argument("--concurrency", type=int, default=2)
    for command in ("validate", "run", "score"):
        sub = commands.add_parser(command)
        sub.add_argument("--dataset", type=Path, required=True)
        if command in ("run", "score"):
            sub.add_argument("--split", choices=("dev", "test", "regression", "all"), default="test")
            sub.add_argument("--output", type=Path, required=True)
        if command == "run":
            sub.add_argument("--profile", choices=("bm25", "dense", "hybrid", "hybrid-rerank", "direct", "direct-http", "legacy-agent", "pi"), default="bm25")
            sub.add_argument("--index", type=Path)
            sub.add_argument("--base-url", default="http://127.0.0.1:8000")
            sub.add_argument("--top-k", type=int, default=50)
            sub.add_argument("--timeout", type=float, default=180)
            sub.add_argument("--concurrency", type=int, default=1)
        if command == "score":
            sub.add_argument("--predictions", type=Path, required=True)
            sub.add_argument("--k", type=int, nargs="+", default=[1, 5, 10, 50])
    compare = commands.add_parser("compare")
    compare.add_argument("--baseline", type=Path, required=True)
    compare.add_argument("--candidate", type=Path, required=True)
    compare.add_argument("--allow-change", action="append", default=[])
    compare.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare-scifact":
            dataset = prepare_scifact(args.output, args.cache, sentences_per_unit=args.sentences_per_unit)
            result = {"ok": True, "manifest": str(dataset.manifest_path), "fingerprint": dataset.fingerprint,
                      "sources": len(dataset.sources), "cases": len(dataset.cases)}
        elif args.command == "snapshot-local":
            receipt = snapshot_local(args.output, base_url=args.base_url, qdrant_url=args.qdrant_url)
            result = {"ok": True, "output": str(args.output), "point_count": receipt["point_count"], "payload_sha256": receipt["payload_sha256"]}
        elif args.command == "prepare-local":
            from .retrieval_local import prepare_local
            dataset = prepare_local(args.snapshot, args.annotations, args.output)
            result = {"ok": True, "manifest": str(dataset.manifest_path), "fingerprint": dataset.fingerprint,
                      "sources": len(dataset.sources), "cases": len(dataset.cases)}
        elif args.command == "prepare-dense":
            from .retrieval_models import prepare_dense
            dataset = RetrievalDataset.load(args.dataset)
            summary = asyncio.run(prepare_dense(dataset, args.output, batch_size=args.batch_size, concurrency=args.concurrency,
                                                progress=lambda message: print(message, file=sys.stderr, flush=True)))
            result = {"ok": True, "output": str(args.output / "manifest.json"), "usage": summary["usage"]}
        elif args.command == "compare":
            result = compare_runs(json.loads(args.baseline.read_text()), json.loads(args.candidate.read_text()), allowed_changes=tuple(args.allow_change))
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            result = {"ok": True, "output": str(args.output)}
        else:
            dataset = RetrievalDataset.load(args.dataset)
            if args.command == "validate":
                result = {"ok": True, "fingerprint": dataset.fingerprint, "sources": len(dataset.sources), "cases": len(dataset.cases),
                          "units": sum(len(s["units"]) for s in dataset.sources.values()),
                          "splits": {split: sum(c["split"] == split for c in dataset.cases) for split in ("dev", "test", "regression")}}
            elif args.command == "score":
                report = score_run(dataset, read_jsonl(args.predictions), split=args.split, ks=tuple(args.k))
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
                result = {"ok": True, "output": str(args.output)}
            else:
                if args.profile == "bm25":
                    retriever = BM25Retriever(dataset)
                elif args.profile == "direct-http":
                    from .retrieval_local import LocalAPIRetriever
                    retriever = LocalAPIRetriever(dataset, base_url=args.base_url, timeout_seconds=args.timeout)
                elif args.profile in {"direct", "legacy-agent", "pi"}:
                    from .retrieval_systems import LocalCoreRetriever, PiRetriever
                    retriever = (PiRetriever(dataset, base_url=args.base_url, journal=args.output / "pi-attempts", deadline_seconds=max(1, args.timeout - 10))
                                 if args.profile == "pi" else LocalCoreRetriever(dataset, base_url=args.base_url, profile=args.profile))
                else:
                    if args.index is None:
                        raise ValueError("--index is required for dense/hybrid profiles")
                    from .retrieval_models import DenseRetriever
                    retriever = DenseRetriever(dataset, args.index, profile=args.profile)
                report = asyncio.run(run_retrieval(dataset, retriever, args.output, split=args.split, top_k=args.top_k,
                                                  timeout_seconds=args.timeout, concurrency=args.concurrency,
                                                  progress=lambda message: print(message, file=sys.stderr, flush=True)))
                result = {"ok": report["aggregate"]["successful_cases"] == report["aggregate"]["total_cases"], "output": str(args.output / "report.json"),
                          "cases": report["aggregate"]["total_cases"], "successes": report["aggregate"]["successful_cases"]}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0 if result.get("ok") else 1
    except (ValueError, OSError) as exc:
        print(f"rag-eval retrieval: {exc}", file=sys.stderr)
        return 2
