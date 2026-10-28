"""Frozen, source-grounded KB-routing diagnostics; never mutate the live index.

This is an isolated routing replay, not an end-to-end retrieval benchmark. Existing
authored/posthoc labels are relocated by exact evidence quotes in a current index;
the former user scope is retained as provenance and deliberately removed for this
automatic-routing diagnostic. Unmatched questions are reported, never relabeled.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from .retrieval_schema import RetrievalDataset, canonical, digest, normalized, require

COLLECTIONS = {
    "text_chunks_agentic": "doc", "image_vectors": "image",
    "audio_vectors": "audio", "video_shot_vectors": "video",
}
TEXT_FIELDS = ("text_content", "embedding_text", "caption", "asr_text", "transcript",
               "description", "scene_summary", "video_summary")
LIMITS = [
    "Authored source-grounded, posthoc-reviewed labels; not a blind human holdout.",
    "Original user scopes are removed only for this automatic-routing diagnostic.",
    "Only fully relocated evidence groups are evaluated; excluded cases are reported.",
    "Raw queries only: no query-rewrite, intent, modality-coverage or Agent exploration calls.",
    "Exact cosine replay of frozen portraits; not an ANN or end-to-end retrieval latency claim.",
    "Existing portraits may lack embedding-model provenance; dimensions alone do not prove space compatibility.",
    "Local artifacts contain private queries, source content and vectors; do not publish raw inputs.",
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value) -> None:
    with path.open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def request(url: str, body=None):
    req = urllib.request.Request(url, data=canonical(body) if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)["result"]


def scroll(url: str, collection: str, *, vectors: bool) -> list[dict]:
    rows, offset = [], None
    while True:
        body = {"limit": 256, "with_payload": True, "with_vector": vectors}
        if offset is not None:
            body["offset"] = offset
        result = request(f"{url}/collections/{collection}/points/scroll", body)
        rows.extend(result["points"])
        offset = result.get("next_page_offset")
        if offset is None:
            break
    return sorted(rows, key=lambda row: str(row["id"]))


def relocate_cases(dataset, content: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep each evidence group's OR-of-AND structure, including replacement sources."""
    units = []
    for row in content:
        payload = row["payload"]
        units.append((row, normalized("\n".join(str(payload.get(k) or "") for k in TEXT_FIELDS))))
    kept, excluded = [], []
    for case in dataset.cases:
        groups = []
        for group in case.get("evidence_groups", []):
            alternatives = []
            for alternative in group["alternatives"]:
                relocated = []
                for anchor in alternative:
                    quote = normalized(anchor.get("quote", ""))
                    source = dataset.sources[anchor["source_id"]]
                    matches = [
                        {"kb_id": row["payload"]["kb_id"], "point_id": str(row["id"]),
                         "collection": row["collection"], "payload_sha256": digest(row["payload"])}
                        for row, body in units
                        if quote and quote in body and row["payload"].get("kb_id")
                        and COLLECTIONS[row["collection"]] == source["modality"]
                    ]
                    relocated.append({"original_anchor": anchor, "matches": matches})
                if relocated and all(anchor["matches"] for anchor in relocated):
                    alternatives.append(relocated)
            groups.append({"id": group["id"], "alternatives": alternatives})
        if not groups or not all(group["alternatives"] for group in groups):
            excluded.append({"case_id": case["id"], "reason": "missing_complete_current_evidence",
                             "unmatched_groups": [g["id"] for g in groups if not g["alternatives"]]})
            continue
        kept.append({"id": case["id"], "query": case["query"], "cluster_id": case["cluster_id"],
                     "tags": case.get("tags", []), "original_scope": case.get("scope", {}),
                     "original_split": case["split"], "groups": groups,
                     "scope_conversion": "original-scope-to-unscoped-routing-diagnostic"})
    return kept, excluded


def assign_splits(cases: list[dict]) -> None:
    """Split before policy inspection; keep shared annotated sources in one component."""
    parent = {case["id"]: case["id"] for case in cases}

    def find(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    owners = {}
    for case in cases:
        keys = {"cluster:" + case["cluster_id"]}
        keys.update("source:" + a["original_anchor"]["source_id"]
                    for g in case["groups"] for alt in g["alternatives"] for a in alt)
        for key in sorted(keys):
            if key in owners:
                a, b = find(case["id"]), find(owners[key])
                parent[max(a, b)] = min(a, b)
            owners[key] = case["id"]
    components = {}
    for case in cases:
        components.setdefault(find(case["id"]), []).append(case["cluster_id"])
    for case in cases:
        key = digest(sorted(set(components[find(case["id"])])))
        bucket = int(hashlib.sha256(("routing-split-v1:" + key).encode()).hexdigest(), 16) % 10
        case["split_group"] = key
        case["split"] = "dev" if bucket < 7 else "test"


def coverage(case: dict, selected: list[str]) -> dict:
    chosen = set(selected)
    groups = {
        group["id"]: any(all(any(m["kb_id"] in chosen for m in anchor["matches"])
                                  for anchor in alternative)
                             for alternative in group["alternatives"])
        for group in case["groups"]
    }
    return {"group_recall": sum(groups.values()) / len(groups),
            "all_groups": bool(groups) and all(groups.values()), "groups": groups}


async def freeze(dataset_path: Path, output: Path, qdrant_url: str) -> dict:
    from .retrieval_models import ModelCalls, _embed_batch

    dataset = RetrievalDataset.load(dataset_path)
    output.mkdir(parents=True, exist_ok=False)
    before = scroll(qdrant_url, "kb_portraits", vectors=True)
    content = [{"collection": collection, **row} for collection in COLLECTIONS
               for row in scroll(qdrant_url, collection, vectors=False)]
    after = scroll(qdrant_url, "kb_portraits", vectors=True)
    require(digest(before) == digest(after), "portraits changed during read-only snapshot; use a new output")
    cases, excluded = relocate_cases(dataset, content)
    require(bool(cases), "no fully relocated cases; cannot evaluate current portraits")
    assign_splits(cases)
    write_json(output / "portraits.json", before)
    write_json(output / "content.json", content)
    write_json(output / "cases.json", cases)
    write_json(output / "excluded.json", excluded)
    cache = output / "embedding-batches"
    cache.mkdir()
    calls = ModelCalls()
    arrays, receipts = [], []
    for start in range(0, len(cases), 16):
        values, receipt = await _embed_batch(calls, [c["query"] for c in cases[start:start + 16]], cache)
        arrays.append(values)
        receipts.append(receipt)
        print(f"embedded {min(start + 16, len(cases))}/{len(cases)}", flush=True)
    matrix = np.concatenate(arrays)
    with (output / "queries.npy").open("xb") as stream:
        np.save(stream, matrix, allow_pickle=False)
    write_json(output / "embedding-receipts.json", receipts)
    cfg = calls.manager.registry.get_model_config(calls.models["embedding"])
    backend = Path(__file__).resolve().parents[1]
    paths = [backend / "app/modules/knowledge/router.py", backend / "app/modules/knowledge/portraits.py",
             backend / "app/modules/ingestion/storage/vector_store.py", Path(__file__)]
    manifest = {
        "schema_version": "knowledge-routing-snapshot-1", "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset_path": str(dataset_path.resolve()), "dataset_fingerprint": dataset.fingerprint,
        "dataset_provenance": dataset.manifest["provenance"], "source_code": {str(p.relative_to(backend)): sha(p) for p in paths},
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "files": {name: sha(output / name) for name in ("portraits.json", "content.json", "cases.json", "excluded.json",
                                                        "queries.npy", "embedding-receipts.json")},
        "embedding": {**calls.stack["embedding"], **{k: cfg.get(k) for k in ("embedding_space", "embedding_dimensions", "embedding_options")}},
        "queries": len(cases), "excluded": len(excluded), "portraits": len(before),
        "splits": dict(Counter(c["split"] for c in cases)),
        "split_policy": "source-connected cluster components, sha256 routing-split-v1, buckets 0-6 dev and 7-9 test; assigned before policy evaluation",
        "limits": LIMITS,
    }
    write_json(output / "manifest.json", manifest)
    return {"output": str(output), "queries": len(cases), "excluded": len(excluded), "splits": manifest["splits"]}


def load_snapshot(path: Path):
    """Load the complete collection so live integrity checks include prototypes."""
    manifest = json.loads((path / "manifest.json").read_text())
    require(manifest["schema_version"] == "knowledge-routing-snapshot-1", "snapshot version mismatch")
    for filename, expected in manifest["files"].items():
        require(sha(path / filename) == expected, f"snapshot checksum mismatch: {filename}")
    cases = json.loads((path / "cases.json").read_text())
    portraits = json.loads((path / "portraits.json").read_text())
    queries = np.load(path / "queries.npy", allow_pickle=False)
    vectors = np.asarray([p["vector"] for p in portraits], dtype=np.float32)
    require(queries.ndim == vectors.ndim == 2 and queries.shape[0] == len(cases), "invalid matrix shape")
    require(queries.shape[1] == vectors.shape[1], "query/portrait dimensions differ")
    for matrix in (queries, vectors):
        require(np.isfinite(matrix).all() and (np.linalg.norm(matrix, axis=1) > 0).all(), "invalid vectors")
    return manifest, cases, portraits, queries, vectors


def summary_portraits(portraits: list[dict]) -> list[dict]:
    """Match production summary lookup, including legacy records without a role.

    Keep the frozen collection intact; apply this projection only when supplying
    a summary baseline or copying summaries into a new shadow collection.
    """
    return [row for row in portraits
            if (row.get("payload") or {}).get("portrait_role") != "topic_prototype"]


def portrait_hits(queries: np.ndarray, vectors: np.ndarray, portraits: list[dict], limit: int) -> list[list[dict]]:
    q = queries / np.linalg.norm(queries, axis=1, keepdims=True)
    v = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
    similarities = q @ v.T
    results = []
    for row in similarities:
        indices = np.argsort(-row, kind="stable")[:limit]
        results.append([{"id": str(portraits[i]["id"]), "kb_id": portraits[i]["payload"]["kb_id"],
                         "score": float(row[i]), "cluster_size": portraits[i]["payload"].get("cluster_size", 1)}
                        for i in indices])
    return results


def percentile(values: list[float], q: float) -> float:
    return float(np.quantile(values, q))


async def replay(snapshot: Path, output: Path, *, modes: list[str], top_n: int, max_targets: int, repeats: int) -> dict:
    from app.core.config import settings
    from app.core.logger import logger
    from app.modules.knowledge.router import KnowledgeRouter
    from threadpoolctl import threadpool_limits

    require(repeats >= 3 and max_targets in (1, 2, 3) and top_n >= 1, "invalid replay budget")
    manifest, cases, portraits, queries, vectors = load_snapshot(snapshot)
    portraits = summary_portraits(portraits)
    require(bool(portraits), "snapshot has no summary portraits")
    vectors = np.asarray([row["vector"] for row in portraits], dtype=np.float32)
    kb_ids = sorted({p["payload"]["kb_id"] for p in portraits})

    async def listing(**kwargs):
        return [{"id": kb_id, "name": kb_id} for kb_id in kb_ids]

    router = KnowledgeRouter.__new__(KnowledgeRouter)
    router.kb_service = SimpleNamespace(list_knowledge_bases=listing)
    old_mode = getattr(settings, "knowledge_routing_score_mode", None)
    require(old_mode is not None or modes == ["legacy"], "production score-mode setting is not implemented")
    output.mkdir(parents=True, exist_ok=False)
    policies = {}
    logger.disable("app.modules.knowledge.router")
    try:
        for mode in modes:
            require(mode in {"legacy", "max"}, "unknown routing policy")
            if old_mode is not None:
                settings.knowledge_routing_score_mode = mode
            times, records = [], []
            with threadpool_limits(limits=1):
                for repetition in range(repeats + 1):
                    start = time.perf_counter()
                    hits = portrait_hits(queries, vectors, portraits, top_n)
                    decisions = []
                    for nodes in hits:
                        scores = router._calculate_multi_signal_scores([nodes])
                        result = await router._apply_routing_strategy(scores, max_targets=max_targets)
                        decisions.append((scores, result))
                    elapsed = (time.perf_counter() - start) * 1000
                    if repetition:
                        times.append(elapsed)
            for case, nodes, (scores, result) in zip(cases, hits, decisions):
                candidate_ids = sorted({node["kb_id"] for node in nodes})
                records.append({"id": case["id"], "split": case["split"], "query": case["query"],
                                "candidate_kb_ids": candidate_ids, "target_kb_ids": result.target_kb_ids,
                                "routing_method": result.routing_method, "scores": scores,
                                "candidate_coverage": coverage(case, candidate_ids),
                                "selected_coverage": coverage(case, result.target_kb_ids)})
            aggregates = {}
            for split in ("all", "dev", "test"):
                subset = [r for r in records if split == "all" or r["split"] == split]
                aggregates[split] = {"cases": len(subset),
                    "candidate_all_groups": float(np.mean([r["candidate_coverage"]["all_groups"] for r in subset])) if subset else None,
                    "selected_all_groups": float(np.mean([r["selected_coverage"]["all_groups"] for r in subset])) if subset else None,
                    "selected_group_recall": float(np.mean([r["selected_coverage"]["group_recall"] for r in subset])) if subset else None,
                    "mean_target_kbs": float(np.mean([len(r["target_kb_ids"]) for r in subset])) if subset else None}
            policies[mode] = {"aggregates": aggregates, "latency": {"unit": "milliseconds_per_full_replay",
                "repeats": repeats, "warmup": 1, "blas_threads": 1, "p50": percentile(times, .5), "p95": percentile(times, .95), "samples": times}, "cases": records}
    finally:
        if old_mode is not None:
            settings.knowledge_routing_score_mode = old_mode
        logger.enable("app.modules.knowledge.router")
    comparisons = {}
    if "legacy" in policies:
        baseline = {r["id"]: r for r in policies["legacy"]["cases"]}
        for mode, policy in policies.items():
            if mode == "legacy":
                continue
            improved, regressed = [], []
            for row in policy["cases"]:
                delta = row["selected_coverage"]["group_recall"] - baseline[row["id"]]["selected_coverage"]["group_recall"]
                if delta > 0:
                    improved.append(row["id"])
                elif delta < 0:
                    regressed.append(row["id"])
            comparisons[mode] = {"improved": improved, "regressed": regressed,
                                 "no_observed_case_regression": not regressed,
                                 "selection_changed": [r["id"] for r in policy["cases"] if r["target_kb_ids"] != baseline[r["id"]]["target_kb_ids"]]}
    backend = Path(__file__).resolve().parents[1]
    report = {"schema_version": "knowledge-routing-report-1", "snapshot_manifest_sha256": sha(snapshot / "manifest.json"),
              "dataset_fingerprint": manifest["dataset_fingerprint"], "budget": {"top_n": top_n, "max_targets": max_targets, "query_signals": 1},
              "source_code": {str(p.relative_to(backend)): sha(p) for p in (backend / "app/modules/knowledge/router.py", backend / "app/core/config.py", Path(__file__))},
              "policies": policies, "comparisons": comparisons, "limits": LIMITS}
    write_json(output / "report.json", report)
    return {"output": str(output), "aggregates": {k: p["aggregates"] for k, p in policies.items()}, "comparisons": comparisons}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    capture = commands.add_parser("freeze")
    capture.add_argument("--dataset", type=Path, required=True)
    capture.add_argument("--output", type=Path, required=True)
    capture.add_argument("--qdrant-url", default="http://127.0.0.1:6333")
    run = commands.add_parser("replay")
    run.add_argument("--snapshot", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--modes", nargs="+", choices=("legacy", "max"), default=["legacy", "max"])
    run.add_argument("--top-n", type=int, default=30)
    run.add_argument("--max-targets", type=int, choices=(1, 2, 3), default=2)
    run.add_argument("--repeats", type=int, default=20)
    args = parser.parse_args(argv)
    if args.command == "freeze":
        result = asyncio.run(freeze(args.dataset, args.output, args.qdrant_url.rstrip("/")))
    else:
        result = asyncio.run(replay(args.snapshot, args.output, modes=args.modes, top_n=args.top_n,
                                   max_targets=args.max_targets, repeats=args.repeats))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
