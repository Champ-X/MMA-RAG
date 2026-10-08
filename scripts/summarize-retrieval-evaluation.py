#!/usr/bin/env python3
"""Export aggregate metrics and receipt hashes without private questions/content."""
import argparse
import hashlib
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from evaluation.retrieval_schema import read_jsonl, require

PUBLIC = ["bm25", "dense", "hybrid", "hybrid-rerank", "hybrid-rerank-availability"]
LOCAL = ["direct", "legacy-agent", "pi"]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(path):
    report = json.loads((path / "report.json").read_text())
    records = read_jsonl(path / "predictions.jsonl")
    require(len(records) == report["dataset"]["cases"], "incomplete run")
    attempts = [a for row in records for a in row.get("diagnostics", {}).get("model_attempts", [])]
    attempt_telemetry = any("model_attempts" in row.get("diagnostics", {}) for row in records)
    ledger_telemetry = any("model_requests" in row.get("diagnostics", {}).get("usage", {}) for row in records)
    buckets = Counter()
    for row in report["cases"].values():
        m = row["metrics"]
        if m["all_evidence_groups_hit@5"] is None:
            continue
        if row["status"] != "success":
            buckets["failed_execution"] += 1
        elif m["all_evidence_groups_hit@5"] == 1:
            buckets["complete_evidence_at_5"] += 1
        elif m["all_evidence_groups_hit@50"] == 1:
            buckets["complete_evidence_only_beyond_5"] += 1
        elif m["document_recall@50"] > 0:
            buckets["target_document_seen_but_evidence_incomplete_at_50"] += 1
        else:
            buckets["target_document_absent_from_delivered_50"] += 1
    names = {"doc", "image", "audio", "video", "cross_modal", "multi_evidence", "numeric", "scope", "no_answer", "hard_negative", "cross_lingual", "sentence_evidence", "no_rationale_annotation"}
    return {"dataset": report["dataset"], "configuration": report["configuration"],
            "aggregate": report["aggregate"], "usage": report["usage"],
            "usage_complete": report["usage"]["unknown_usage_calls"] == report["usage"]["unreported_tasks"] == 0,
            "slices": {key: value for key, value in report["slices"].items() if key in names},
            "evidence_error_buckets": dict(buckets),
            "diagnostics": {"native_statuses": dict(Counter(row.get("diagnostics", {}).get("native_status", "not_exposed") for row in records)),
                            "failed_execution_categories": dict(Counter(row.get("error", {}).get("category") for row in records if row["status"] != "success")),
                            "model_attempt_telemetry_available": attempt_telemetry,
                            "model_attempts": len(attempts) if attempt_telemetry else None,
                            "native_ledger_model_requests": sum(row.get("diagnostics", {}).get("usage", {}).get("model_requests", 0) for row in records) if ledger_telemetry else None,
                            "unsuccessful_model_attempt_categories": dict(Counter(a["error_category"] for a in attempts if not a["success"])),
                            "tasks_with_unsuccessful_model_attempts": sum(any(not a["success"] for a in row.get("diagnostics", {}).get("model_attempts", [])) for row in records) if attempt_telemetry else None,
                            "unscored_observations": sum(len(row.get("diagnostics", {}).get("unscored", [])) for row in records),
                            "delivered_evidence_units": {"min": min(len(row["hits"]) for row in records), "max": max(len(row["hits"]) for row in records)},
                            "source_aliases_resolved": sum(row.get("diagnostics", {}).get("resolved_source_aliases", 0) for row in records)},
            "receipt": {"directory": path.name, "report_sha256": sha(path / "report.json"), "predictions_sha256": sha(path / "predictions.jsonl")}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root
    public = {profile: summarize(root / f"public-{profile}-v1") for profile in PUBLIC}
    local = {profile: summarize(root / f"local-{profile}-resolved-v1") for profile in LOCAL}
    before = json.loads((root / "local-snapshot-v1/snapshot.json").read_text())
    after = json.loads((root / "local-snapshot-after-v1/snapshot.json").read_text())
    require(before["payload_sha256"] == after["payload_sha256"] and before["counts"] == after["counts"], "knowledge index payload changed")
    source_audit = json.loads((root / "minio-source-audit-v1.json").read_text())
    require(source_audit["readable"] == source_audit["objects"] and source_audit["all_modification_times_predate_execution"], "original source metadata audit failed")
    pi_audit = json.loads((root / "local-pi-resolved-v1/resolution-audit.json").read_text())
    dense = json.loads((root / "scifact-dense-v1/manifest.json").read_text())
    result = {"schema_version": "retrieval-evaluation-summary-1", "public": public, "local": local,
              "shared_embedding_preparation": {"model": dense["model"], "matrices": dense["matrices"], "usage": dense["usage"],
                                              "limits": "One shared preparation of 17031 corpus units and all 837 development/evaluation queries; excluded from warm search timing"},
              "preservation": {"qdrant_points": after["point_count"], "payload_sha256": after["payload_sha256"], "payload_unchanged": True,
                               "readable_minio_objects": source_audit["readable"], "object_modification_times_predate_execution": True,
                               "limits": source_audit["limits"]},
              "offline_resolution": {"version": pi_audit["lineage"]["resolution_version"], "corrected_cases": len(pi_audit["corrections"]),
                                     "adapter_errors_resolved": sum(c["before_status"] != c["after_status"] for c in pi_audit["corrections"]),
                                     "new_provider_calls": 0, "original_pi_predictions_sha256": pi_audit["original_predictions_sha256"]},
              "limits": ["Public custom SciFact protocol and existing parsed-content labels are not universal retrieval performance.",
                         "Local cases are source-checked agent-authored examples, not independent human-blind annotations.",
                         "Pi observation order and whole-run latency differ from retrieval-only Direct/legacy outputs.",
                         "Unknown provider usage prevents a complete token or monetary cost comparison.",
                         "No-answer candidate return rate is not false-answer rate.",
                         "Bootstrap covers query-cluster sampling, not run-to-run variability or multiple-comparison correction."]}
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    for path in sorted((root / "comparisons-v1").glob("*.json")):
        shutil.copyfile(path, args.output / path.name)
    print(json.dumps({"output": str(args.output), "public_runs": len(public), "local_runs": len(local), "preservation": result["preservation"]}))


if __name__ == "__main__":
    main()
