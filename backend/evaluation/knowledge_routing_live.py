"""Paired live retrieval diagnostics with frozen query vectors and real reranking.

Uses the production preplanned path (no LLM intent/rewrite), current content
indexes, local sparse/media models and the configured real reranker. Production
Qdrant mutations and MinIO writes are prohibited. Optional shadow prototypes use
one UUID-isolated temporary collection, removed after the run.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import json
import time
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import numpy as np

from .knowledge_routing import COLLECTIONS, coverage, load_snapshot, scroll, sha, write_json
from .retrieval_schema import digest, normalized, require


def evidence_coverage(case: dict, hits: list[dict]) -> dict:
    """A returned point must have the right KB identity AND still expose the quote."""
    groups = {}
    for group in case["groups"]:
        groups[group["id"]] = any(
            all(any(
                any(str(hit["id"]) == match["point_id"]
                    and hit["source"].get("knowledge_base_id") == match["kb_id"]
                    for match in anchor["matches"])
                and bool(normalized(anchor["original_anchor"].get("quote", "")))
                and normalized(anchor["original_anchor"].get("quote", "")) in normalized(hit["content"])
                for hit in hits)
                for anchor in alternative)
            for alternative in group["alternatives"])
    return {"group_recall": sum(groups.values()) / len(groups), "all_groups": all(groups.values()), "groups": groups}


async def run(snapshot: Path, output: Path, case_ids: list[str], *, repeats: int, timeout: float,
              qdrant_url: str = "http://127.0.0.1:6333", policies: list[dict] | None = None,
              prototype_topics: Path | None = None):
    from app.core.config import settings
    from app.core.llm.manager import LLMCallResult, llm_manager
    from app.modules.ingestion.storage.vector_store import VectorStore
    from app.modules.retrieval.service import RetrievalService
    from minio import Minio
    from qdrant_client import QdrantClient
    from .retrieval_models import ModelCalls, _observations
    from .retrieval_systems import system_fingerprint

    manifest, all_cases, portraits, queries, _ = load_snapshot(snapshot)
    cases_by_id = {c["id"]: c for c in all_cases}
    if case_ids == ["all"]:
        case_ids = list(cases_by_id)
    require(bool(case_ids) and set(case_ids) <= cases_by_id.keys(), "unknown case ID")
    require(len(set(case_ids)) == len(case_ids) and repeats > 0, "invalid repeat/case request")
    cases = [cases_by_id[key] for key in case_ids]
    policies = policies or [{"name": mode, "settings": {"knowledge_routing_score_mode": mode}}
                            for mode in ("legacy", "max")]
    require(len(policies) >= 2 and len({p["name"] for p in policies}) == len(policies), "need distinct paired policies")
    require(all(isinstance(p.get("settings"), dict) and p["settings"] for p in policies), "settings are required")
    setting_names = {name for policy in policies for name in policy["settings"]}
    require(all(hasattr(settings, name) and (name.startswith("knowledge_routing_") or name == "video_semantic_anchors_enabled")
                for name in setting_names), "only existing routing/video retrieval settings may be varied")
    old_settings = {name: getattr(settings, name) for name in setting_names}
    frozen = {case["query"]: query.tolist() for case, query in zip(all_cases, queries)}
    output.mkdir(parents=True, exist_ok=False)
    executed_source = {"system_source": system_fingerprint(),
                       "evaluation_source": {Path(__file__).name: sha(Path(__file__)),
                                             "knowledge_routing.py": sha(Path(__file__).with_name("knowledge_routing.py")),
                                             "knowledge_routing_prototypes.py": sha(Path(__file__).with_name("knowledge_routing_prototypes.py"))}}
    write_json(output / "source-fingerprint.json", executed_source)

    def current_index_digest():
        portrait_rows = scroll(qdrant_url, "kb_portraits", vectors=True)
        content_rows = [{"collection": collection, **row} for collection in COLLECTIONS
                        for row in scroll(qdrant_url, collection, vectors=False)]
        return {"portraits": digest(portrait_rows), "content": digest(content_rows)}

    frozen_index_digest = {"portraits": digest(portraits), "content": digest(json.loads((snapshot / "content.json").read_text()))}
    before_index_digest = current_index_digest()
    require(before_index_digest == frozen_index_digest, "live index differs from frozen labels/vectors; freeze a new fixture")
    calls = ModelCalls()  # installs response hooks, without triggering model calls
    model = calls.models["embedding"]
    require(calls.stack["embedding"] == {k: manifest["embedding"][k] for k in ("model", "provider", "raw_model")},
            "current embedding route differs from frozen queries")
    embedding_original = llm_manager.embed
    rerank_original = llm_manager.rerank
    extra_embeddings = []
    active_case = None

    async def embed_frozen(*args, **kwargs):
        texts = kwargs.get("texts", args[0] if args else [])
        if texts and all(text in frozen for text in texts) and kwargs.get("model", model) == model:
            return LLMCallResult(success=True, data=[copy.deepcopy(frozen[text]) for text in texts], model_used=model)
        extra_embeddings.append({"texts": texts, "model": kwargs.get("model", model)})
        return await embedding_original(*args, **kwargs)

    async def observe_rerank(*args, **kwargs):
        started = time.perf_counter()
        documents = kwargs.get("documents", [])
        bodies = [normalized(str(document)) for document in documents]
        required_quotes = sorted({normalized(anchor["original_anchor"].get("quote", ""))
                                 for group in (active_case or {}).get("groups", [])
                                 for alternative in group["alternatives"] for anchor in alternative} - {""})
        result = await rerank_original(*args, **kwargs)
        receipts = _observations.get()
        if receipts is not None:
            receipts.append({"kind": "model_call", "method": "rerank", "success": result.success,
                             "model_used": result.model_used, "fallback_used": result.fallback_used,
                             "duration_seconds": time.perf_counter() - started,
                             "document_count": len(documents),
                             "document_sha256": [digest(document) for document in documents],
                             "required_quote_count": len(required_quotes),
                             "required_quotes_visible": sum(any(quote in body for body in bodies) for quote in required_quotes),
                             "error_category": result.error_category, "status_code": result.status_code,
                             "tokens_used": result.tokens_used or None})
        return result

    init_original = VectorStore.__init__

    def init_read_only(instance, *args, **kwargs):
        kwargs["initialize_collections"] = False
        init_original(instance, *args, **kwargs)

    def forbidden(*args, **kwargs):
        raise RuntimeError("routing benchmark prohibits production index/storage writes")

    rows = []
    prototype_fixture = None
    with ExitStack() as stack:
        if prototype_topics is not None:
            from .knowledge_routing_prototypes import isolated_prototype_collection
            prototype_fixture = stack.enter_context(isolated_prototype_collection(qdrant_url, prototype_topics, portraits,
                                                                                 copy_payload_indexes=True))
            grouped_original = QdrantClient.query_points_groups
            points_original = QdrantClient.query_points

            def isolated_summary_query(client, *args, **kwargs):
                if kwargs.get("collection_name") == "kb_portraits" and settings.knowledge_routing_score_mode == "coverage":
                    kwargs["collection_name"] = prototype_fixture["collection"]
                return points_original(client, *args, **kwargs)

            def isolated_group_query(client, *args, **kwargs):
                if kwargs.get("collection_name") == "kb_portraits":
                    require("topic_prototype" in str(kwargs.get("query_filter")), "unexpected grouped portrait query")
                    kwargs["collection_name"] = prototype_fixture["collection"]
                started = time.perf_counter()
                result = grouped_original(client, *args, **kwargs)
                receipts = _observations.get()
                if receipts is not None:
                    receipts.append({"kind": "index_query", "method": "query_points_groups",
                                     "collection": kwargs.get("collection_name"),
                                     "duration_seconds": time.perf_counter() - started,
                                     "groups": len(getattr(result, "groups", []))})
                return result

            stack.enter_context(patch.object(QdrantClient, "query_points_groups", isolated_group_query))
            stack.enter_context(patch.object(QdrantClient, "query_points", isolated_summary_query))
        stack.enter_context(patch.object(VectorStore, "__init__", init_read_only))
        stack.enter_context(patch.object(llm_manager, "embed", embed_frozen))
        stack.enter_context(patch.object(llm_manager, "rerank", observe_rerank))
        for name in ("create_collection", "delete_collection", "update_collection", "upsert", "delete", "set_payload",
                     "overwrite_payload", "clear_payload", "delete_payload", "create_payload_index"):
            stack.enter_context(patch.object(QdrantClient, name, forbidden))
        for name in ("put_object", "make_bucket", "remove_object", "remove_objects", "set_bucket_tags"):
            stack.enter_context(patch.object(Minio, name, forbidden))
        # The API module creates a service at import time. Import it only after
        # the read-only guards are installed, including collection initialization.
        from app.api.retrieval import serialize_evidence_item
        service = RetrievalService()
        service.reranker.jev_mode = "off"
        # Deterministic local preplanning is frozen once for both policies.
        plans = {c["id"]: service._preprocess_preplanned_query(c["query"]) for c in cases}
        write_json(output / "preprocessing.json", plans)
        try:
            for repetition in range(repeats):
                for index, case in enumerate(cases):
                    active_case = case
                    # Rotate policies across cases and repetitions. Every policy
                    # sees each position equally when the
                    # number of cases is a multiple of the policy count.
                    offset = (index + repetition) % len(policies)
                    ordered = policies[offset:] + policies[:offset]
                    for policy in ordered:
                        mode = policy["name"]
                        for name, value in old_settings.items():
                            setattr(settings, name, value)
                        for name, value in policy["settings"].items():
                            setattr(settings, name, value)
                        receipts = []
                        token = _observations.set(receipts)
                        start = time.perf_counter()
                        try:
                            result = await asyncio.wait_for(service.search(case["query"], preplanned=True,
                                                                          preprocessing_result=plans[case["id"]]), timeout)
                            hits = [serialize_evidence_item(hit).model_dump() for hit in result.reranked_results]
                            raw = [serialize_evidence_item(hit).model_dump() for group in result.raw_results.values() for hit in group]
                            row = {"case_id": case["id"], "mode": mode, "repeat": repetition, "status": "success",
                                   "query": case["query"], "target_kb_ids": result.context.target_kb_ids,
                                   "route_coverage": coverage(case, result.context.target_kb_ids),
                                   "raw_evidence_coverage": evidence_coverage(case, raw),
                                   "raw_candidate_count": len(raw),
                                   "raw_unique_candidate_count": len({str(hit["id"]) for hit in raw}),
                                   "final_evidence_coverage": evidence_coverage(case, hits),
                                   "hits": hits, "debug_info": result.debug_info}
                            if any(r.get("method") == "rerank" and not r.get("success") for r in receipts):
                                row["status"] = "degraded"
                        except Exception as exc:
                            row = {"case_id": case["id"], "mode": mode, "repeat": repetition, "status": "error",
                                   "error_type": type(exc).__name__, "error": str(exc)}
                        finally:
                            _observations.reset(token)
                        row.update(duration_seconds=time.perf_counter() - start, provider_receipts=receipts,
                                   policy_settings={name: getattr(settings, name) for name in sorted(setting_names)})
                        rows.append(row)
                        with (output / "results.jsonl").open("a") as stream:
                            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                        print(json.dumps({k: row[k] for k in ("case_id", "mode", "repeat", "status", "duration_seconds")}
                                         | {"coverage": row.get("final_evidence_coverage")}, ensure_ascii=False), flush=True)
        finally:
            for name, value in old_settings.items():
                setattr(settings, name, value)
    aggregates = {}
    for mode in [policy["name"] for policy in policies]:
        subset = [r for r in rows if r["mode"] == mode]
        good = [r for r in subset if r["status"] == "success"]
        aggregates[mode] = {"attempts": len(subset), "successes": len(good), "errors": len(subset) - len(good),
            "route_all_groups": float(np.mean([r["route_coverage"]["all_groups"] for r in good])) if good else None,
            "raw_all_groups": float(np.mean([r["raw_evidence_coverage"]["all_groups"] for r in good])) if good else None,
            "final_all_groups": float(np.mean([r["final_evidence_coverage"]["all_groups"] for r in good])) if good else None,
            "final_group_recall": float(np.mean([r["final_evidence_coverage"]["group_recall"] for r in good])) if good else None,
            "latency_p50": float(np.quantile([r["duration_seconds"] for r in subset], .5)),
            "latency_p95": float(np.quantile([r["duration_seconds"] for r in subset], .95))}
    paired = []
    for repetition in range(repeats):
        for case in cases:
            pair = {r["mode"]: r for r in rows if r["case_id"] == case["id"] and r["repeat"] == repetition}
            baseline = policies[0]["name"]
            for policy in policies[1:]:
                candidate = policy["name"]
                if all(pair[name]["status"] == "success" for name in (baseline, candidate)):
                    paired.append({"case_id": case["id"], "repeat": repetition, "baseline": baseline, "candidate": candidate,
                                   "final_coverage_delta": pair[candidate]["final_evidence_coverage"]["group_recall"] - pair[baseline]["final_evidence_coverage"]["group_recall"],
                                   "latency_delta_seconds": pair[candidate]["duration_seconds"] - pair[baseline]["duration_seconds"]})
    after_index_digest = current_index_digest()
    report = {"schema_version": "knowledge-routing-live-1", "snapshot_manifest_sha256": sha(snapshot / "manifest.json"),
              "case_ids": case_ids, "repeats": repeats, "policies": policies,
              "preprocessing_sha256": sha(output / "preprocessing.json"),
              "results_sha256": sha(output / "results.jsonl"), "model_stack": calls.stack,
              **executed_source,
              "index_digest": {"before": before_index_digest, "after": after_index_digest,
                               "unchanged": before_index_digest == after_index_digest},
              "aggregates": aggregates, "pairs": paired, "extra_embedding_requests": extra_embeddings,
              "prototype_fixture": prototype_fixture,
              "limits": ["Targeted diagnostic subset, not a new blind holdout.",
                         "Preplanned local preprocessing; no LLM query rewrite or answer generation.",
                         "Real content retrieval and reranker, frozen original-query embedding vectors.",
                         "Cyclic balanced policy order; cold model/cache loading remains in reported samples.",
                         "Errors are separate from successful empty evidence; inspect raw receipts.",
                         "Existing media source descriptions/transcripts are not certified original-media truth."]}
    write_json(output / "report.json", report)
    return {"output": str(output), "aggregates": aggregates, "pairs": paired}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case-ids", nargs="+", required=True)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--qdrant-url", default="http://127.0.0.1:6333")
    parser.add_argument("--policies", type=Path, help="JSON list of named process-only settings; first is baseline")
    parser.add_argument("--prototype-topics", type=Path, help="Shadow topics JSON loaded into a temporary isolated Qdrant collection")
    args = parser.parse_args(argv)
    print(json.dumps(asyncio.run(run(args.snapshot, args.output, args.case_ids, repeats=args.repeats,
                                    timeout=args.timeout, qdrant_url=args.qdrant_url.rstrip("/"),
                                    policies=json.loads(args.policies.read_text()) if args.policies else None,
                                    prototype_topics=args.prototype_topics)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
