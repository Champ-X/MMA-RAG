#!/usr/bin/env python3
"""Verify the offline 2026-10-08 review and export aggregates without private bodies."""
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from evaluation.retrieval_metrics import score_run
from evaluation.retrieval_review import comparison_readiness, sha, write_json
from evaluation.retrieval_runner import source_fingerprint
from evaluation.retrieval_schema import RetrievalDataset, digest, read_jsonl, require
from evaluation.retrieval_stages import audit_pi_stages, load_native_receipts


def summarize(root: Path, review: Path, stage_dir: Path, output: Path) -> dict:
    require(not output.exists(), "review summary output already exists; preserve it")
    protected = json.loads((review / "frozen-inputs-before.json").read_text())
    require(all(sha(REPO / path) == expected for path, expected in protected.items()), "frozen original artifact changed")
    parent = RetrievalDataset.load(root / "local-v2/manifest.json")
    revised = RetrievalDataset.load(review / "local-v3/manifest.json")
    annotation = json.loads((review / "label-review.json").read_text())
    revision = revised.manifest["provenance"]["annotation_revision"]
    require(revision["parent_fingerprint"] == parent.fingerprint and revision["review_sha256"] == digest(annotation),
            "review dataset lineage mismatch")
    modes, reports = {}, {}
    for mode in ("direct", "legacy-agent", "pi"):
        original, replayed = root / f"local-{mode}-resolved-v1", review / f"local-{mode}-revised"
        rows = read_jsonl(replayed / "predictions.jsonl")
        old_rows = read_jsonl(original / "predictions.jsonl")
        before, after = [json.loads((p / "report.json").read_text()) for p in (original, replayed)]
        require(score_run(parent, old_rows) == before, "original score no longer reproduces")
        require(score_run(revised, rows) == after, "revised score no longer reproduces")
        audit = json.loads((replayed / "annotation-audit.json").read_text())
        require(audit["original_predictions_sha256"] == sha(original / "predictions.jsonl")
                and audit["prediction_sha256"] == sha(replayed / "predictions.jsonl")
                and audit["report_sha256"] == sha(replayed / "report.json"), "replay audit hash mismatch")
        require(len(rows) == len(old_rows), "replay case count changed")
        for old, new in zip(old_rows, rows):
            for key in old.keys() | new.keys():
                if key not in {"configuration", "configuration_fingerprint", "dataset_fingerprint", "annotation_parent_record_sha256"}:
                    require(old.get(key) == new.get(key), "annotation replay changed measured outcome")
        modes[mode] = {
            "original": before["aggregate"], "revised": after["aggregate"],
            "changed_metric_cases": len(audit["changed_metric_cases"]),
            "original_predictions_sha256": sha(original / "predictions.jsonl"),
            "revised_predictions_sha256": sha(replayed / "predictions.jsonl"),
            "revised_report_sha256": sha(replayed / "report.json"),
        }
        reports[mode] = after

    records = read_jsonl(review / "local-pi-revised/predictions.jsonl")
    native = load_native_receipts(records, root / "local-pi-v1/pi-attempts")
    media = json.loads((review / "media-review.json").read_text())
    stages, packets = audit_pi_stages(revised, records, native, media_review=media, media_root=review)
    stages["provenance"] = {"predictions_sha256": sha(review / "local-pi-revised/predictions.jsonl"),
        "native_receipts_sha256": digest(native), "evaluation_source": source_fingerprint(), "new_provider_calls": 0}
    require(stages == json.loads((stage_dir / "report.json").read_text()), "stage audit no longer reproduces")
    require(packets == read_jsonl(stage_dir / "answer-review-packets.jsonl"), "answer review packets changed")
    public_stages = {key: value for key, value in stages.items() if key != "cases"}
    require(public_stages == json.loads((stage_dir / "aggregate.json").read_text()), "stage aggregate differs from private report")

    summary = {"schema_version": "retrieval-posthoc-review-1", "kind": "offline_diagnostic_development_review",
        "dataset": {"parent_fingerprint": parent.fingerprint, "revised_fingerprint": revised.fingerprint,
                    "cases": len(revised.cases), "evidence_annotated_cases": sum(bool(c["evidence_groups"]) for c in revised.cases)},
        "annotation": {"review_sha256": digest(annotation), "changed_cases": len({c["case_id"] for c in annotation["changes"]}),
                       "changed_groups": len(annotation["changes"]), "reviewer": annotation["reviewer"],
                       "posthoc": True, "eligible_as_untouched_holdout": False},
        "modes": modes, "pi_stages": public_stages,
        "comparison_readiness": comparison_readiness(reports["legacy-agent"], reports["pi"]),
        "verification": {"protected_files_verified": len(protected), "original_reports_recomputed": 3,
                         "revised_reports_recomputed": 3, "native_pi_receipts_verified": len(native),
                         "answer_review_packets_verified": len(packets), "new_provider_calls": 0,
                         "script_sha256": sha(Path(__file__))},
        "limits": ["Annotation repairs are posthoc, unblinded development diagnostics, not new retrieval/model behavior or held-out gains.",
                   "Revised indexed-evidence scores retain each mode's historical ordering and unequal execution budgets.",
                   "Pi's final citation coverage is a separate stage; historical Direct/legacy runs have no saved final answers.",
                   "Two original-image anchor reviews do not verify all media or all answer claims.",
                   "Unknown semantic judgments remain null; completed run status is not correctness."]}
    output.mkdir(parents=True, exist_ok=False)
    write_json(output / "summary.json", summary)
    return {"ok": True, "output": str(output / "summary.json"), "protected_files_verified": len(protected)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Frozen evaluation root")
    parser.add_argument("--review", type=Path, required=True, help="New private review root")
    parser.add_argument("--stages", type=Path, required=True, help="Verified Pi stage audit directory")
    parser.add_argument("--output", type=Path, required=True, help="Fresh public aggregate directory")
    args = parser.parse_args()
    print(json.dumps(summarize(args.root, args.review, args.stages, args.output)))


if __name__ == "__main__":
    main()
