"""Append-only retrieval experiments with no writes to production knowledge data."""
from __future__ import annotations

import fcntl
import hashlib
import heapq
import json
import math
import os
import platform
import random
import re
import time
from datetime import datetime, timezone
from collections import Counter, defaultdict
from pathlib import Path

from .retrieval_metrics import score_run
from .retrieval_schema import RetrievalDataset, canonical, digest, read_jsonl, require


def tokenize(value: str) -> list[str]:
    """Explicit diagnostic baseline: lowercase words and CJK character bigrams."""
    words = re.findall(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", value.casefold())
    for sequence in re.findall(r"[\u3400-\u9fff]+", value):
        words.extend(sequence[i:i + 2] for i in range(max(1, len(sequence) - 1)))
    return words


def unit_hits(dataset: RetrievalDataset) -> list[dict]:
    hits = []
    for sid, source in dataset.sources.items():
        for unit in source["units"]:
            hit = {"id": unit["id"], "source_id": sid, "source_sha256": source["text_sha256"], "content": unit["text"],
                   "modality": source["modality"], "kb_id": source.get("metadata", {}).get("kb_id")}
            hit.update({k: unit[k] for k in ("start_char", "end_char", "start_seconds", "end_seconds", "page") if k in unit})
            hits.append(hit)
    return hits


def allowed(case: dict, hit: dict) -> bool:
    scope = case.get("scope", {})
    return all(not scope.get(key) or hit.get(field) in scope[key] for key, field in
               (("source_ids", "source_id"), ("kb_ids", "kb_id"), ("modalities", "modality")))


class BM25Retriever:
    def __init__(self, dataset: RetrievalDataset, *, k1: float = 1.2, b: float = .75):
        self.hits = unit_hits(dataset)
        self.k1, self.b = k1, b
        self.postings = defaultdict(list)
        self.lengths = []
        for i, hit in enumerate(self.hits):
            title = dataset.sources[hit["source_id"]].get("metadata", {}).get("title", "")
            tokens = tokenize(title + "\n" + hit["content"])
            self.lengths.append(len(tokens))
            for term, tf in Counter(tokens).items():
                self.postings[term].append((i, tf))
        self.mean_length = sum(self.lengths) / len(self.lengths)
        self.configuration = {"backend": "offline_component", "profile": "bm25", "k1": k1, "b": b,
                              "tokenizer": "ascii-words-cjk-bigrams-v1", "input_policy": "title-plus-original-unit-v1",
                              "unit_count": len(self.hits), "query_rewrite": False, "model_stack": {},
                              "limits": "Diagnostic lexical baseline; not Tessmora BGE-M3 sparse retrieval or the full RAG pipeline"}

    async def search(self, case: dict, top_k: int) -> dict:
        scores = defaultdict(float)
        for term in set(tokenize(case["query"])):
            postings = self.postings.get(term, [])
            idf = math.log(1 + (len(self.hits) - len(postings) + .5) / (len(postings) + .5))
            for i, tf in postings:
                if allowed(case, self.hits[i]):
                    scores[i] += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * self.lengths[i] / self.mean_length))
        ranked = heapq.nsmallest(top_k, scores, key=lambda i: (-scores[i], self.hits[i]["id"]))
        return {"hits": [{**self.hits[i], "score": scores[i]} for i in ranked],
                "usage": {"known_tokens": 0, "unknown_usage_calls": 0}, "diagnostics": {"matched_units": len(scores)}}


def source_fingerprint() -> dict:
    root = Path(__file__).resolve().parent
    files = sorted([*root.glob("retrieval_*.py"), root / "source_resolution.py"])
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in files}


class RetrievalAttemptError(Exception):
    """A failed attempt may still have real observations and usage to preserve."""
    def __init__(self, category: str, result: dict):
        super().__init__(category)
        self.category, self.result = category, result


class RunLedger:
    """One process owns a run. Interrupted paid attempts are preserved, never retried."""
    def __init__(self, directory: Path, protocol: dict):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.lock = (directory / ".lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise ValueError("This run is already owned by another live process")
        manifest = directory / "run.json"
        try:
            if manifest.exists():
                require(json.loads(manifest.read_text()) == protocol, "run protocol changed; use a new output directory")
            else:
                manifest.write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + "\n")
            self.path = directory / "predictions.jsonl"
            self.records = read_jsonl(self.path) if self.path.exists() else []
            ids = [row["case_id"] for row in self.records]
            require(len(ids) == len(set(ids)), "duplicate persisted run records")
            self.pending = directory / "pending"
            self.pending.mkdir(exist_ok=True)
        except BaseException:
            self.close()
            raise

    def begin(self, record: dict) -> None:
        with (self.pending / (digest(record["case_id"]) + ".json")).open("x") as stream:
            stream.write(canonical(record).decode() + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    def append(self, record: dict) -> None:
        with self.path.open("a") as stream:
            stream.write(canonical(record).decode() + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        self.records.append(record)
        (self.pending / (digest(record["case_id"]) + ".json")).unlink(missing_ok=True)

    def close(self) -> None:
        self.lock.close()


async def run_retrieval(dataset: RetrievalDataset, retriever, output: Path, *, split: str = "test", top_k: int = 50,
                        timeout_seconds: float = 180, concurrency: int = 1, progress=print) -> dict:
    import asyncio
    require(top_k > 0 and math.isfinite(timeout_seconds) and timeout_seconds > 0, "invalid run limits")
    require(isinstance(concurrency, int) and 1 <= concurrency <= 4, "concurrency must be between 1 and 4")
    cases = list(dataset.selected(split))
    random.Random(20261008).shuffle(cases)
    configuration = {**retriever.configuration, "top_k": top_k, "timeout_seconds": timeout_seconds,
                     "evaluation_source": source_fingerprint(), "python": platform.python_version(), "concurrency": concurrency,
                     "query_order": {"method": "seeded_shuffle", "seed": 20261008}}
    protocol = {"schema_version": "retrieval-run-2", "dataset_fingerprint": dataset.fingerprint,
                "case_ids": [c["id"] for c in cases], "split": split, "configuration": configuration,
                "configuration_fingerprint": digest(configuration)}
    ledger = RunLedger(output, protocol)
    try:
        done = {r["case_id"] for r in ledger.records}
        require(done <= set(protocol["case_ids"]), "stored records outside frozen case set")
        for pending_path in sorted(ledger.pending.glob("*.json")):
            pending = json.loads(pending_path.read_text())
            if pending["case_id"] not in done:
                ledger.append({**pending, "status": "error", "error": {"category": "interrupted_unconfirmed", "message": "Prior process ended with an outstanding attempt; no automatic retry"},
                               "hits": [], "duration_seconds": None, "usage": {"known_tokens": 0, "unknown_usage_calls": 1}})
                done.add(pending["case_id"])
            else:
                pending_path.unlink()
        semaphore = asyncio.Semaphore(concurrency)
        async def one(index, case):
            if case["id"] in done:
                return
            async with semaphore:
                await attempt(index, case)
        async def attempt(index, case):
            row = {"schema_version": "retrieval-prediction-2", "case_id": case["id"], "dataset_fingerprint": dataset.fingerprint,
                   "configuration": configuration, "configuration_fingerprint": protocol["configuration_fingerprint"],
                   "started_at": datetime.now(timezone.utc).isoformat()}
            ledger.begin(row)
            started = time.perf_counter()
            try:
                result = await asyncio.wait_for(retriever.search(case, top_k), timeout=timeout_seconds)
                require(isinstance(result, dict) and isinstance(result.get("hits"), list), "backend violated retrieval result contract")
                row.update(result)
                row.update(status="success", duration_seconds=time.perf_counter() - started)
            except Exception as exc:
                # Full private provider messages are intentionally not copied into publishable receipts.
                if isinstance(exc, RetrievalAttemptError):
                    row.update(exc.result)
                row.update(status="timeout" if isinstance(exc, TimeoutError) else "error", hits=[],
                           duration_seconds=time.perf_counter() - started,
                           error={"category": type(exc).__name__, "message": "Retrieval attempt failed; retained in denominator"})
                if isinstance(exc, RetrievalAttemptError):
                    row["hits"] = exc.result.get("hits", [])
                    row["error"]["category"] = exc.category
                    if exc.category == "deadline_exceeded":
                        row["status"] = "timeout"
            row["finished_at"] = datetime.now(timezone.utc).isoformat()
            ledger.append(row)
            progress(f"[{index}/{len(cases)}] {case['id']} {row['status']} hits={len(row['hits'])} seconds={row['duration_seconds']:.3f}")
        await asyncio.gather(*(one(index, case) for index, case in enumerate(cases, 1)))
        require(source_fingerprint() == configuration["evaluation_source"], "evaluation code changed during run; preserve receipts and use a new candidate")
        report = score_run(dataset, ledger.records, split=split, ks=tuple(k for k in (1, 5, 10, 50) if k <= top_k))
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        return report
    finally:
        ledger.close()
