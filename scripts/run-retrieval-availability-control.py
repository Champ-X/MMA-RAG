#!/usr/bin/env python3
"""A separately recorded full reranker run that waits out admission cooldowns.

No failed query is retried and no original record is overwritten. This isolates
the observed cascade of immediate cooldown rejections from ranking quality.
"""
import argparse
import asyncio
import hashlib
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from evaluation.retrieval_models import DenseRetriever, ModelCalls
from evaluation.retrieval_runner import run_retrieval
from evaluation.retrieval_schema import RetrievalDataset


class AvailabilityCalls(ModelCalls):
    async def invoke(self, method, **kwargs):
        started = time.monotonic()
        while self.manager._blocked(kwargs["model"], "rerank"):
            await asyncio.sleep(1)
        result, receipt = await super().invoke(method, **kwargs)
        receipt["admission_wait_seconds"] = time.monotonic() - started - receipt["duration_seconds"]
        return result, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dataset = RetrievalDataset.load(args.dataset)
    retriever = DenseRetriever(dataset, args.index, profile="hybrid-rerank")
    retriever.calls = AvailabilityCalls()
    retriever.configuration["availability_control"] = {
        "policy": "wait before next query while the model is cooling down; never retry a failed query",
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "predecessor": "Original 300-query run retained: one transport error led to subsequent admission rejections",
    }
    report = asyncio.run(run_retrieval(dataset, retriever, args.output, concurrency=2,
                                       progress=lambda s: print(s, flush=True)))
    print({"cases": report["aggregate"]["total_cases"], "successes": report["aggregate"]["successful_cases"]})


if __name__ == "__main__":
    main()
