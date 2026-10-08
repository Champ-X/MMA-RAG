#!/usr/bin/env python3
"""Offline correction of native source aliases, with immutable receipt lineage."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from evaluation import source_resolution
from evaluation.retrieval_metrics import score_run
from evaluation.retrieval_schema import RetrievalDataset, digest, read_jsonl, require, write_jsonl
from evaluation.source_resolution import RESOLUTION_VERSION, resolve_pi_evidence


def replay(dataset, original, destination):
    require(not destination.exists(), "resolved output already exists; preserve it")
    rows = read_jsonl(original / "predictions.jsonl")
    require(len(rows) == len(dataset.selected()), "collection is not complete")
    lineage = {"resolution_version": RESOLUTION_VERSION,
               "resolver_sha256": hashlib.sha256(Path(source_resolution.__file__).read_bytes()).hexdigest(),
               "replay_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "policy": "Offline source identity correction only; no model calls, new evidence, changed qrels, or failure retries"}
    changes, resolved = [], []
    for before in rows:
        row = json.loads(json.dumps(before))
        row["collection_record_sha256"] = digest(before)
        row["collection_status"] = before["status"]
        row["collection_configuration_fingerprint"] = before["configuration_fingerprint"]
        row["configuration"]["postprocessing"] = lineage
        row["configuration_fingerprint"] = digest(row["configuration"])
        if before["configuration"]["profile"] == "pi":
            path = original / "pi-attempts" / (digest(before["case_id"]) + ".evidence.json")
            if path.exists():
                observation = json.loads(path.read_text())
                require(observation["run"]["id"] == before["diagnostics"]["run_id"], "Pi raw evidence run identity mismatch")
                row["native_observation_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
                hits, diagnostics = resolve_pi_evidence(dataset, observation["evidence"], top_k=before["configuration"]["top_k"])
                row["hits"] = hits
                row["diagnostics"].update(diagnostics)
                if (before.get("error", {}).get("category") == "evidence_resolution_failed" and not diagnostics["unresolved"]
                        and observation["run"]["status"] in {"completed", "partial", "needs_input"}):
                    row["status"] = "success"
                    row.pop("error", None)
                if row["hits"] != before["hits"] or row["status"] != before["status"]:
                    changes.append({"case_id": before["case_id"], "before_status": before["status"], "after_status": row["status"],
                                    "before_hits": len(before["hits"]), "after_hits": len(hits), **diagnostics})
        resolved.append(row)
    report = score_run(dataset, resolved)
    destination.mkdir(parents=True)
    write_jsonl(destination / "predictions.jsonl", resolved)
    (destination / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    audit = {"original": str(original), "original_predictions_sha256": hashlib.sha256((original / "predictions.jsonl").read_bytes()).hexdigest(),
             "dataset_fingerprint": dataset.fingerprint, "lineage": lineage, "corrections": changes, "new_provider_calls": 0}
    (destination / "resolution-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    return {"output": str(destination), "cases": len(resolved), "corrected_cases": len(changes), "successes": report["aggregate"]["successful_cases"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(replay(RetrievalDataset.load(args.dataset), args.original, args.output)))


if __name__ == "__main__":
    main()
