"""Fresh Decision assistance against frozen pools and historical Qwen receipts.

The baseline is replayed, not a current provider measurement. Original datasets
and receipts are immutable. Run only with --live and an explicit frozen protocol.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).parent))


async def run(args):
    from evaluate_jev import coarse_candidates
    from app.core.llm.jev import get_decision_client
    from app.core.llm.manager import LLMCallResult
    from app.modules.retrieval.reranker import Reranker
    from app.modules.retrieval.decision_evidence import LEGACY_POLICY_VERSION
    from app.core.jev_settings import JevConfig, _request_config
    from loguru import logger
    logger.remove()

    protocol = json.loads(args.protocol.read_text())
    if protocol.get('protocol') != 'decision-assist-pilot-v1':
        raise ValueError('This frozen evaluator only supports decision-assist-pilot-v1')
    dataset = ROOT / "evals/jev_v2/rerank/cases.jsonl"
    baseline_path = ROOT / "docs/research/jev-v2/results/rerank-paired.jsonl"
    assert hashlib.sha256(dataset.read_bytes()).hexdigest() == protocol["dataset_sha256"]
    assert hashlib.sha256(baseline_path.read_bytes()).hexdigest() == protocol["baseline_receipts_sha256"]
    cases = {c["id"]: c for c in map(json.loads, dataset.read_text().splitlines())}
    baselines = {c["id"]: c for c in map(json.loads, baseline_path.read_text().splitlines())}
    config_path = ROOT / "backend/data/jev_settings.json"
    settings_hash = hashlib.sha256(config_path.read_bytes()).hexdigest()
    if args.output.exists():
        raise ValueError("Output exists; retain it and use a new protocol/output for a new run")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for selection in protocol["providers"]:
        decision_client = get_decision_client(selection["provider"], selection["model"])
        for case_id in protocol["cases"]:
            case, receipt = cases[case_id], baselines[case_id]
            ranker = Reranker()
            # Production now uses incremental evidence; this evaluator retains
            # the original policy and needs a new protocol for a new policy.
            ranker.decision_evidence_policy = LEGACY_POLICY_VERSION
            raw = {"dense": coarse_candidates(case)}
            selected = ranker._select_candidates_for_reranking(ranker._prepare_coarse_ranking(raw), None)
            assert [d["id"] for d in selected] == receipt["candidate_ids"]
            documents = [ranker._build_document_content(d) for d in selected]
            fingerprint = hashlib.sha256(json.dumps([case["query"], documents], ensure_ascii=False).encode()).hexdigest()
            assert fingerprint == receipt["input_sha256"], "Baseline input drift"

            class CachedBaseline:
                async def rerank(self, query, documents, **kwargs):
                    return LLMCallResult(success=True, data=receipt["qwen"]["scores"],
                                         model_used=receipt["qwen"]["model"])

            ranker.llm_manager = CachedBaseline()
            ranker.jev_mode = "off"
            baseline = await ranker.rerank(case["query"], raw)
            ranker.jev_mode = "assist"
            ranker.jev_client = decision_client
            started = time.perf_counter()
            token = _request_config.set(JevConfig(**selection, intent_mode="off", rerank_mode="assist",
                                                 citation_mode="off", citation_strategy="per_unit"))
            try:
                assisted = await ranker.rerank(case["query"], raw)
            finally:
                _request_config.reset(token)
            duration = time.perf_counter() - started
            base_rows, assisted_rows = baseline["results"], assisted["results"]
            assert assisted_rows[:len(base_rows)] == base_rows, "Baseline evidence changed"
            added = assisted_rows[len(base_rows):]
            assert len(added) <= 2
            qrels = {d["id"]: d["relevance"] > 0 for d in case["documents"]}
            positives = sum(qrels.values())
            relevant_before = sum(qrels[r["id"]] for r in base_rows)
            relevant_added = sum(qrels[r["id"]] for r in added)
            row = {"id": case_id, **selection, "query": case["query"],
                   "baseline_source": "frozen historical real Qwen scores", "baseline_input_sha256": fingerprint,
                   "baseline_ids": [r["id"] for r in base_rows], "baseline_preserved": True,
                   "added_ids": [r["id"] for r in added], "added_relevant": relevant_added,
                   "positive_count": positives,
                   "recall_before": relevant_before / positives if positives else None,
                   "recall_after": (relevant_before + relevant_added) / positives if positives else None,
                   "decision_stage_duration_s": duration, "scorer": assisted.get("scorer", {}),
                   "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
            rows.append(row)
            with args.output.open("a") as out:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(json.dumps({"id": case_id, "route": selection["provider"],
                              "status": row["scorer"].get("status"), "reason": row["scorer"].get("reason"),
                              "added": len(added), "relevant_added": relevant_added}), flush=True)

    groups = {}
    for selection in protocol["providers"]:
        group = [r for r in rows if r["provider"] == selection["provider"] and r["model"] == selection["model"]]
        added_count = sum(len(r["added_ids"]) for r in group)
        relevant_added = sum(r["added_relevant"] for r in group)
        groups[f"{selection['provider']}/{selection['model']}"] = {
            "cases": len(group), "baseline_preserved": all(r["baseline_preserved"] for r in group),
            "additional_documents": added_count, "additional_relevant": relevant_added,
            "addition_precision": relevant_added / added_count if added_count else None,
            "mean_recall_before": statistics.mean(r["recall_before"] for r in group if r["recall_before"] is not None),
            "mean_recall_after": statistics.mean(r["recall_after"] for r in group if r["recall_after"] is not None),
            "failures": [{"id": r["id"], "reason": r["scorer"].get("reason")} for r in group if r["scorer"].get("status") == "fallback"],
            "skipped": [{"id": r["id"], "reason": r["scorer"].get("reason")} for r in group if r["scorer"].get("status") == "skipped"],
        }
    summary = {"protocol": protocol, "groups": groups,
               "settings_unchanged": hashlib.sha256(config_path.read_bytes()).hexdigest() == settings_hash,
               "limitations": "Small fixed public sample; historical baseline replay; expanded recall uses up to 2 extra slots. No full retrieval, answer-quality, latency, calibrated-confidence, or production improvement claim."}
    args.output.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary["groups"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Explicitly authorize fresh provider calls")
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.live:
        parser.error("This script makes fresh provider calls; pass --live")
    asyncio.run(run(args))
