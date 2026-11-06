#!/usr/bin/env python3
"""Controlled Pi retrieval A/B, with real in-memory Qdrant and no model calls.

Baseline and candidate gateway source are frozen before either arm is loaded.
Fixtures deliberately supply query vectors: this measures retrieval/ranking,
not embedding-model quality, network latency, HNSW, or production end-to-end QA.
No artificial I/O delay is added. Existing receipts are never overwritten.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
import types
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm
from app.modules.pi_agent.catalog import Source, SourceCatalog, source_id
from app.modules.pi_agent.contracts import RunRequest
from app.modules.pi_agent.policy import AccessScope
from app.modules.pi_agent.query_vectors import QueryVectorUnavailable


GATEWAY = "backend/app/modules/pi_agent/gateway.py"
QUERY_VECTOR = [1., 0., 0., 0.]
COLLECTIONS = {"doc": "text_chunks_agentic", "image": "image_vectors", "audio": "audio_vectors"}
BASELINE_REF = "658b0d10080bdf2350e76be79e0bda1b461180f4"


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(encoded(value), encoding="utf-8")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def load_gateway(text, name, filename):
    module = types.ModuleType("app.modules.pi_agent." + name)
    module.__package__ = "app.modules.pi_agent"
    module.__file__ = str(filename)
    sys.modules[module.__name__] = module
    exec(compile(text, str(filename), "exec"), module.__dict__)
    return module.KnowledgeGateway


def vector(similarity):
    return [similarity, math.sqrt(max(0., 1. - similarity * similarity)), 0., 0.]


def original(file, modality="doc", kb="a"):
    suffix = {"doc": ".pdf", "image": ".png", "audio": ".wav"}[modality]
    return Source(source_id(kb, file), kb, file, "record-" + file + suffix, modality,
        "fixture-source-v1", 1024, "kb-" + kb, "fixture/" + file + suffix)


def point(identity, item, content, *, dense, sparse=None, native=None):
    vectors = {"dense" if item.modality == "doc" else "text_vec": vector(dense)}
    if sparse is not None:
        vectors["sparse"] = {"indices": [sparse[0]], "values": [sparse[1]]}
    if native is not None:
        vectors["clip_vec" if item.modality == "image" else "clap_vec"] = vector(native)
    field = {"doc": "text_content", "image": "caption", "audio": "description"}[item.modality]
    return {"id": identity, "vector": vectors,
        "payload": {"file_id": item.file_id, "kb_id": item.kb_id, field: content, "chunk_index": identity}}


def make_scenarios(size):
    cases = []
    relevant = {1, 2, 3, 4, 5, 10, 15, 20}
    for name in ("complete_sparse", "partial_sparse", "sparse_model_not_ready", "exact_substring"):
        sources = [original(f"doc-{n:03d}") for n in range(max(1, size // 20))]
        private = original("private", kb="b")
        rows = []
        exact = name == "exact_substring"
        for number in range(1, size + 1):
            wanted = number in relevant
            content = ("MixedCaseNeedleSuffix 原样短语，适用于现场条件。" if exact else
                "alphatarget is supported by this source's measured conditions.") if wanted else "Unrelated background record."
            missing = name == "partial_sparse" and number % 5 == 0
            rows.append(point(number, sources[(number - 1) % len(sources)], content,
                dense=.98 - number * .0001 if wanted else .65 - (number % 100) * .0001,
                sparse=None if missing else (7 if wanted else 100 + number % 31, 1. - number * .00001)))
        rows.append(point(size + 1, private, "alphatarget MixedCaseNeedleSuffix unauthorized canary", dense=1., sparse=(7, 2.)))
        cases.append({"id": name, "modality": "doc", "query": "caseneedle" if exact else "alphatarget",
            "mode": "exact" if exact else "hybrid", "result_unit": "passage", "k": 8,
            "sources": [*map(asdict, sources), asdict(private)], "points": rows,
            "qrels": {str(number): 1 for number in sorted(relevant)}, "qrel_unit": "point_id",
            "local_model_ready": name != "sparse_model_not_ready", "arms": ["baseline", "candidate_text"],
            "qrel_basis": "Authored fixture passages contain the queried statement; exact matches include an interior casefolded substring."})

    sources = [original(f"source-{n:02d}") for n in range(9)]
    rows = [point(number, sources[0], "Engineering measurements and operating conditions.",
                  dense=.99 - number * .00001, sparse=(7, 2. - number * .00001)) for number in range(1, size + 1)]
    rows += [point(size + n, item, "Engineering measurements and operating conditions.",
                   dense=.85 - n * .005, sparse=(7, .8 - n * .01)) for n, item in enumerate(sources[1:], 1)]
    cases.append({"id": "source_diversity", "modality": "doc", "query": "散热设计", "mode": "hybrid",
        "result_unit": "source", "k": 8, "sources": list(map(asdict, sources)), "points": rows,
        "qrels": {item.id: 1 for item in sources}, "qrel_unit": "source_id", "local_model_ready": True,
        "arms": ["baseline", "candidate_text"],
        "qrel_basis": "Nine fixture sources are relevant by supplied semantic vectors; one long source owns every top passage. Measures source diversity, not encoder semantics."})

    for modality in ("image", "audio"):
        sources = [original(f"{modality}-{n:04d}", modality) for n in range(1, size + 1)]
        private = original("private", modality, "b")
        positives = set(range(size - 3, size + 1))
        rows = []
        for number, item in enumerate(sources, 1):
            wanted = number in positives
            rows.append(point(number, item, "Automatically indexed generic media description.",
                dense=.2 + number * .000001 if wanted else .99 - number * .00001,
                sparse=(100 + number % 31, 1.) if modality == "audio" else None,
                native=.99 - (number - (size - 3)) * .001 if wanted else .5 - number * .00001))
        rows.append(point(size + 1, private, "Unauthorized media canary", dense=1.,
                          sparse=(7, 2.) if modality == "audio" else None, native=1.))
        cases.append({"id": "native_" + modality, "modality": modality,
            "query": "红色圆形的构图" if modality == "image" else "只有打击乐没有人声",
            "mode": "hybrid", "result_unit": "source", "k": 8,
            "sources": [*map(asdict, sources), asdict(private)], "points": rows,
            "qrels": {sources[number - 1].id: 1 for number in sorted(positives)}, "qrel_unit": "source_id",
            "local_model_ready": True, "arms": ["baseline", "candidate_text", "candidate_native"],
            "qrel_basis": "Four synthetic media identities have the requested attributes in authored qrels and native vectors, omitted from captions. No real images/audio or CLIP/CLAP inference were evaluated."})
    return cases


class FixedVectors:
    def __init__(self, ready):
        self.ready = ready
        self.calls = []

    async def encode(self, kind, query):
        self.calls.append(kind)
        if not self.ready:
            raise QueryVectorUnavailable("local_model_not_ready")
        return {7: 1.} if kind == "sparse" else list(QUERY_VECTOR)


class FixedModels:
    settings = types.SimpleNamespace(yield_to_legacy=False, max_concurrent_search_channels=2)

    async def embed(self, query, span):
        return list(QUERY_VECTOR)


class MeasuredIndex:
    """Observe real adapter calls. No sleep or simulated latency is introduced."""
    def __init__(self, client):
        self.client = client
        self.reset()

    def reset(self):
        self.calls = []
        self.active = self.peak = 0

    async def invoke(self, operation, *args, **kwargs):
        started = time.perf_counter_ns()
        self.active += 1
        self.peak = max(self.peak, self.active)
        entry = {"operation": operation, "collection": args[0], "using": kwargs.get("using")}
        try:
            value = await getattr(self.client, operation)(*args, **kwargs)
            if operation == "scroll":
                entry["returned_points"] = len(value[0])
            elif operation == "query_points":
                entry["returned_points"] = len(value.points)
            elif operation == "query_points_groups":
                entry["returned_points"] = sum(len(group.hits) for group in value.groups)
            elif operation == "count":
                entry["count"] = value.count
            return value
        except Exception as error:
            entry["error_type"] = type(error).__name__
            raise
        finally:
            self.active -= 1
            entry["duration_ms"] = (time.perf_counter_ns() - started) / 1e6
            self.calls.append(entry)

    async def scroll(self, *args, **kwargs):
        return await self.invoke("scroll", *args, **kwargs)

    async def count(self, *args, **kwargs):
        return await self.invoke("count", *args, **kwargs)

    async def get_collection(self, *args, **kwargs):
        return await self.invoke("get_collection", *args, **kwargs)

    async def query_points(self, *args, **kwargs):
        return await self.invoke("query_points", *args, **kwargs)

    async def query_points_groups(self, *args, **kwargs):
        return await self.invoke("query_points_groups", *args, **kwargs)


async def create_index(case):
    client = AsyncQdrantClient(location=":memory:")
    modality = case["modality"]
    names = {"doc": ["dense"], "image": ["text_vec", "clip_vec"], "audio": ["text_vec", "clap_vec"]}[modality]
    await client.create_collection(COLLECTIONS[modality],
        vectors_config={name: qm.VectorParams(size=4, distance=qm.Distance.COSINE) for name in names},
        sparse_vectors_config={"sparse": qm.SparseVectorParams()} if modality != "image" else None)
    await client.upsert(COLLECTIONS[modality], [qm.PointStruct.model_validate(item) for item in case["points"]])
    return client


def metrics(case, evidence):
    identities = [item.source_id if case["qrel_unit"] == "source_id" else str(item.locator["point_id"]) for item in evidence]
    relevance = case["qrels"]
    gains = [relevance.get(identity, 0) for identity in identities[:case["k"]]]
    dcg = sum((2 ** gain - 1) / math.log2(rank + 2) for rank, gain in enumerate(gains))
    ideal = sorted(relevance.values(), reverse=True)[:case["k"]]
    idcg = sum((2 ** gain - 1) / math.log2(rank + 2) for rank, gain in enumerate(ideal))
    return {"recall_at_k": len(set(identities[:case["k"]]) & set(relevance)) / len(relevance),
        "ndcg_at_k": dcg / idcg if idcg else 0., "returned": len(identities), "identities": identities,
        "scope_violations": sum(item.provenance.get("kb_id") != "a" for item in evidence)}


def quantile(values, probability):
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize(samples, cases):
    summary = []
    for case in cases:
        groups = {}
        for arm in case["arms"]:
            rows = [row for row in samples if row["case"] == case["id"] and row["arm"] == arm and not row["warmup"]]
            latencies = [row["duration_ms"] for row in rows]
            groups[arm] = {"samples": len(rows), "p50_ms": quantile(latencies, .5), "p95_ms": quantile(latencies, .95),
                "min_ms": min(latencies), "max_ms": max(latencies),
                "failures": sum(row["error"] is not None for row in rows),
                "recall_at_k": statistics.mean(row["quality"]["recall_at_k"] for row in rows),
                "ndcg_at_k": statistics.mean(row["quality"]["ndcg_at_k"] for row in rows),
                "scope_violations": sum(row["quality"]["scope_violations"] for row in rows),
                "mean_scanned_points": statistics.mean(row["io"]["scanned_points"] for row in rows),
                "mean_index_requests": statistics.mean(row["io"]["index_requests"] for row in rows),
                "mean_vector_queries": statistics.mean(row["io"]["vector_queries"] for row in rows),
                "mean_count_requests": statistics.mean(row["io"]["count_requests"] for row in rows),
                "mean_capability_requests": statistics.mean(row["io"]["capability_requests"] for row in rows),
                "fallback_codes": sorted({item["code"] for row in rows for item in row["report"].get("fallbacks", [])}),
                "statuses": sorted({row["report"].get("status", "error") for row in rows}),
                "deterministic_results": len({tuple(row["quality"]["identities"]) for row in rows}) == 1}
        for arm, result in groups.items():
            if arm != "baseline":
                result["p50_ratio_to_baseline"] = result["p50_ms"] / groups["baseline"]["p50_ms"]
                result["p95_ratio_to_baseline"] = result["p95_ms"] / groups["baseline"]["p95_ms"]
                result["recall_delta"] = result["recall_at_k"] - groups["baseline"]["recall_at_k"]
        summary.append({"case": case["id"], "k": case["k"], "qrel_count": len(case["qrels"]), "arms": groups})
    return summary


async def benchmark(args):
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise SystemExit(f"Refusing to overwrite existing benchmark receipts: {output}")
    output.mkdir(parents=True, exist_ok=True)
    baseline_sha = git("rev-parse", args.baseline).decode().strip()
    baseline_source = git("show", baseline_sha + ":" + GATEWAY)
    candidate_source = (ROOT / GATEWAY).read_bytes()
    baseline_file, candidate_file = output / "source/baseline_gateway.py", output / "source/candidate_gateway.py"
    baseline_file.parent.mkdir(parents=True)
    baseline_file.write_bytes(baseline_source)
    candidate_file.write_bytes(candidate_source)
    (output / "source/benchmark-pi-retrieval.py").write_bytes(Path(__file__).read_bytes())
    dependencies = []
    for relative in ("catalog.py", "contracts.py", "policy.py", "payloads.py", "text_origins.py", "query_vectors.py"):
        path = ROOT / "backend/app/modules/pi_agent" / relative
        contents = path.read_bytes()
        (output / "source" / relative).write_bytes(contents)
        try:
            old_hash = sha(git("show", baseline_sha + ":backend/app/modules/pi_agent/" + relative))
        except subprocess.CalledProcessError:
            old_hash = None
        dependencies.append({"path": str(path.relative_to(ROOT)), "candidate_sha256": sha(contents), "baseline_sha256": old_hash})
    cases = make_scenarios(args.points)
    dataset = {"version": 1, "dense_query": QUERY_VECTOR, "sparse_query": {"7": 1.},
               "native_query": QUERY_VECTOR, "cases": cases}
    write(output / "dataset.json", dataset)
    manifest = {"started_at": datetime.now(timezone.utc).isoformat(), "baseline_commit": baseline_sha,
        "candidate_git_head": git("rev-parse", "HEAD").decode().strip(),
        "baseline_gateway_sha256": sha(baseline_source), "candidate_gateway_sha256": sha(candidate_source),
        "benchmark_sha256": sha(Path(__file__).read_bytes()), "dataset_sha256": sha((output / "dataset.json").read_bytes()),
        "dependencies": dependencies, "python": sys.version, "platform": platform.platform(),
        "qdrant_client_version": importlib.metadata.version("qdrant-client"), "backend": "AsyncQdrantClient(location=':memory:')",
        "repeat": args.repeat, "warmup": args.warmup, "nominal_points_per_case": args.points,
        "order": "Alternating arm order after each repetition; all arms share the same immutable per-case index",
        "latency": "Measured wall clock, no artificial delays; index build and source preparation excluded",
        "encoder_boundary": "Fixed identical query vectors. No paid models, downloaded models, local encoder inference, network, disk, or HNSW measured.",
        "quality_boundary": "Seven authored synthetic fixtures. Recall/nDCG validate retrieval routes, source diversity and fallbacks; not answer quality or real multimodal semantic accuracy.",
        "source_boundary": "Both gateway snapshots use current shared data contracts/catalog/policy; their baseline/current hashes are recorded. No checkout/reset or product writes.",
        "status": "running"}
    write(output / "manifest.json", manifest)
    classes = {"baseline": load_gateway(baseline_source, "benchmark_baseline", baseline_file),
               "candidate": load_gateway(candidate_source, "benchmark_candidate", candidate_file)}
    samples = []
    raw_path = output / "raw.jsonl"
    with raw_path.open("x", encoding="utf-8") as raw:
        for case in cases:
            client = await create_index(case)
            try:
                sources = [Source(**item) for item in case["sources"]]
                catalog = SourceCatalog(sources, {"a": "Fixture sources", "b": "Excluded canary"})
                scope = AccessScope.from_request(RunRequest(client_request_id="benchmark", session_id="benchmark",
                    message=case["query"], knowledge_base_ids=["a"]), {"a", "b"})
                gateways, indexes, local_vectors = {}, {}, {}
                for arm in case["arms"]:
                    indexes[arm] = MeasuredIndex(client)
                    local_vectors[arm] = FixedVectors(case["local_model_ready"])
                    cls = classes["baseline" if arm == "baseline" else "candidate"]
                    gateways[arm] = cls(catalog, scope, indexes[arm], FixedModels(), asyncio.Semaphore(1),
                        **({"local_vectors": local_vectors[arm]} if arm != "baseline" else {}))
                for iteration in range(-args.warmup, args.repeat):
                    order = case["arms"] if iteration % 2 == 0 else list(reversed(case["arms"]))
                    for position, arm in enumerate(order):
                        index = indexes[arm]
                        index.reset()
                        local_vectors[arm].calls.clear()
                        options = {"query": case["query"], "mode": case["mode"], "modalities": [case["modality"]],
                            "knowledge_base_ids": [], "limit": case["k"], "span_id": "benchmark", "result_unit": case["result_unit"]}
                        if arm != "baseline":
                            options["retrieval_strategy"] = "native" if arm == "candidate_native" else "text"
                        started = time.perf_counter_ns()
                        evidence, report, error = [], {}, None
                        try:
                            evidence, report = await gateways[arm].search(**options)
                        except Exception as failure:
                            error = {"type": type(failure).__name__, "message": str(failure)}
                        elapsed = (time.perf_counter_ns() - started) / 1e6
                        sample = {"case": case["id"], "arm": arm, "iteration": iteration, "warmup": iteration < 0,
                            "position": position, "duration_ms": elapsed, "error": error, "report": report,
                            "quality": metrics(case, evidence), "local_vector_requests": list(local_vectors[arm].calls),
                            "io": {"index_requests": len(index.calls),
                                "scanned_points": sum(call.get("returned_points", 0) for call in index.calls if call["operation"] == "scroll"),
                                "vector_queries": sum(call["operation"] in {"query_points", "query_points_groups"} for call in index.calls),
                                "count_requests": sum(call["operation"] == "count" for call in index.calls),
                                "capability_requests": sum(call["operation"] == "get_collection" for call in index.calls),
                                "peak_concurrency": index.peak}, "calls": index.calls}
                        samples.append(sample)
                        raw.write(json.dumps(sample, ensure_ascii=False, sort_keys=True) + "\n")
                        raw.flush()
                print(f"Finished {case['id']}: {args.repeat} measured samples per arm", flush=True)
            finally:
                await client.close()
    summary = summarize(samples, cases)
    write(output / "summary.json", {"manifest": "manifest.json", "cases": summary})
    manifest.update(status="complete", finished_at=datetime.now(timezone.utc).isoformat(),
        measured_samples=sum(not sample["warmup"] for sample in samples),
        failures=sum(sample["error"] is not None for sample in samples),
        scope_violations=sum(sample["quality"]["scope_violations"] for sample in samples),
        raw_sha256=sha(raw_path.read_bytes()), summary_sha256=sha((output / "summary.json").read_bytes()))
    write(output / "manifest.json", manifest)
    print("case / arm / p50 ms / p95 ms / scanned / requests / Recall@K / nDCG@K", flush=True)
    for case in summary:
        for arm, values in case["arms"].items():
            print(f"{case['case']} / {arm} / {values['p50_ms']:.2f} / {values['p95_ms']:.2f} / "
                f"{values['mean_scanned_points']:.0f} / {values['mean_index_requests']:.0f} / "
                f"{values['recall_at_k']:.3f} / {values['ndcg_at_k']:.3f}", flush=True)
    print(f"Receipts: {output}", flush=True)
    return 1 if manifest["failures"] or manifest["scope_violations"] else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default=BASELINE_REF)
    parser.add_argument("--output", type=Path, default=ROOT / "data/pi-ab-20261106/retrieval")
    parser.add_argument("--points", type=int, default=1000)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--warmup", type=int, default=2)
    args = parser.parse_args()
    if args.points < 40 or args.repeat < 5 or args.warmup < 0:
        parser.error("Use at least 40 points, 5 repetitions and a nonnegative warmup count")
    raise SystemExit(asyncio.run(benchmark(args)))


if __name__ == "__main__":
    main()
