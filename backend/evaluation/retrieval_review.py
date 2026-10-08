"""Versioned annotation amendments and offline replay; never edit measured runs."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from pathlib import Path

from .retrieval_metrics import score_run
from .retrieval_schema import RetrievalDataset, create_dataset, digest, read_jsonl, require, text, write_jsonl


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def reviewer(value: dict) -> None:
    require(isinstance(value, dict), "reviewer provenance required")
    for field in ("identity", "method", "reviewed_at"):
        text(value.get(field), "reviewer." + field)
    require(isinstance(value.get("blind"), bool), "reviewer.blind must be explicit")


def _review_cases(parent: RetrievalDataset, review: dict) -> tuple[list[dict], int]:
    require(review.get("schema_version") == "retrieval-label-review-1", "label review schema mismatch")
    require(review.get("parent_fingerprint") == parent.fingerprint, "label review parent mismatch")
    reviewer(review.get("reviewer"))
    text(review.get("rationale"), "review rationale")
    changes = review.get("changes")
    require(isinstance(changes, list) and bool(changes), "nonempty annotation changes required")
    cases = copy.deepcopy(list(parent.cases))
    indexed = {case["id"]: case for case in cases}
    changed = set()
    for change in changes:
        case = indexed.get(change.get("case_id"))
        require(case is not None, "unknown reviewed case")
        group = next((g for g in case["evidence_groups"] if g["id"] == change.get("group_id")), None)
        require(group is not None, "unknown reviewed evidence group")
        key = (case["id"], group["id"])
        require(key not in changed, "duplicate group amendment")
        changed.add(key)
        text(change.get("reason"), "amendment reason")
        alternatives = change.get("add_alternatives")
        require(isinstance(alternatives, list) and bool(alternatives), "add_alternatives required")
        seen = {digest(alt) for alt in group["alternatives"]}
        for alternative in alternatives:
            require(digest(alternative) not in seen, "duplicate evidence alternative")
            seen.add(digest(alternative))
            group["alternatives"].append(alternative)
        case["annotation"]["revision_review_sha256"] = digest(review)
        case["annotation"]["posthoc_review"] = True
    return cases, len(changed)


def revise_labels(parent: RetrievalDataset, review: dict, destination: Path) -> RetrievalDataset:
    """Only add source-validated alternatives; retain all old labels and failures."""
    cases, changed_groups = _review_cases(parent, review)
    provenance = {**parent.manifest["provenance"], "annotation_revision": {
        "parent_fingerprint": parent.fingerprint, "review_sha256": digest(review),
        "reviewer": review["reviewer"], "changed_groups": changed_groups,
        "posthoc": True, "eligible_as_untouched_holdout": False,
        "policy": "Add equivalent source-bound evidence; apply identically to every mode; no new retrieval calls",
    }}
    # create_dataset validates quotes, source versions, scopes and conjunctions.
    result = create_dataset(destination, name=parent.manifest["name"], sources=list(parent.sources.values()),
                            cases=cases, provenance=provenance)
    write_json(destination / "label-review.json", review)
    return result


def replay_labels(parent: RetrievalDataset, revised: RetrievalDataset, original: Path, destination: Path) -> dict:
    require(not destination.exists(), "annotation replay output already exists; preserve it")
    revision = revised.manifest["provenance"].get("annotation_revision", {})
    require(revision.get("parent_fingerprint") == parent.fingerprint, "revision lineage mismatch")
    review = json.loads((revised.manifest_path.parent / "label-review.json").read_text())
    require(digest(review) == revision.get("review_sha256"), "annotation review receipt mismatch")
    expected_cases, _ = _review_cases(parent, review)
    require(list(revised.cases) == expected_cases, "revised cases differ from reviewed amendments")
    require(revised.sources == parent.sources, "annotation replay cannot change corpus")
    require([c["id"] for c in parent.cases] == [c["id"] for c in revised.cases], "annotation replay case set changed")
    for old, new in zip(parent.cases, revised.cases):
        for field in old.keys() | new.keys():
            if field not in {"annotation", "evidence_groups"}:
                require(old.get(field) == new.get(field), "annotation replay changed " + field)
        require([g["id"] for g in old["evidence_groups"]] == [g["id"] for g in new["evidence_groups"]], "group set changed")
        for a, b in zip(old["evidence_groups"], new["evidence_groups"]):
            require(b["alternatives"][:len(a["alternatives"])] == a["alternatives"], "old labels removed or rewritten")
    rows = read_jsonl(original / "predictions.jsonl")
    old_report = json.loads((original / "report.json").read_text())
    split, ks = old_report["dataset"]["split"], tuple(old_report["cutoffs"])
    require(score_run(parent, rows, split=split, ks=ks) == old_report, "original report differs from receipts")
    lineage = {"kind": "posthoc_annotation_replay", "parent_fingerprint": parent.fingerprint,
               "revised_fingerprint": revised.fingerprint, "review_sha256": revision["review_sha256"]}
    revised_rows = copy.deepcopy(rows)
    for old, row in zip(rows, revised_rows):
        row["annotation_parent_record_sha256"] = digest(old)
        row["dataset_fingerprint"] = revised.fingerprint
        row["configuration"]["annotation_replay"] = lineage
        row["configuration_fingerprint"] = digest(row["configuration"])
    report = score_run(revised, revised_rows, split=split, ks=ks)
    destination.mkdir(parents=True, exist_ok=False)
    write_jsonl(destination / "predictions.jsonl", revised_rows)
    write_json(destination / "report.json", report)
    changed = [cid for cid in report["cases"] if report["cases"][cid]["metrics"] != old_report["cases"][cid]["metrics"]]
    audit = {**lineage, "original_predictions_sha256": sha(original / "predictions.jsonl"),
             "changed_metric_cases": changed, "task_statuses_unchanged": True, "new_provider_calls": 0,
             "prediction_sha256": sha(destination / "predictions.jsonl"), "report_sha256": sha(destination / "report.json")}
    write_json(destination / "annotation-audit.json", audit)
    return audit


def comparison_readiness(baseline: dict, candidate: dict) -> dict:
    """Conservative gate for matched comparisons; a declared timeout is insufficient."""
    reasons = []
    if baseline.get("schema_version") != "retrieval-report-2" or candidate.get("schema_version") != "retrieval-report-2":
        reasons.append("report_schema_mismatch")
    if baseline.get("dataset") != candidate.get("dataset"):
        reasons.append("dataset_or_split_mismatch")
    if baseline.get("metric_version") != candidate.get("metric_version"):
        reasons.append("metric_version_mismatch")
    if baseline.get("cutoffs") != candidate.get("cutoffs"):
        reasons.append("cutoff_mismatch")
    required = ("stage", "ordering", "retrieval_tools_sha256", "model_stack", "budget", "concurrency")
    contracts = [r.get("configuration", {}).get("comparison_contract", {}) for r in (baseline, candidate)]
    contracts = [c if isinstance(c, dict) else {} for c in contracts]
    if baseline.get("cases", {}).keys() != candidate.get("cases", {}).keys():
        reasons.append("case_identity_mismatch")
    for label, report, contract in zip(("baseline", "candidate"), (baseline, candidate), contracts):
        if digest(report.get("configuration", {})) != report.get("configuration_fingerprint"):
            reasons.append(label + ":configuration_fingerprint_mismatch")
        for field in required:
            if not contract.get(field):
                reasons.append(label + ":missing_" + field)
        if (not all(isinstance(contract.get(k), str) and contract[k].strip() for k in ("stage", "ordering"))
                or not re.fullmatch(r"[0-9a-f]{64}", str(contract.get("retrieval_tools_sha256", "")))
                or not isinstance(contract.get("model_stack"), dict) or not contract.get("model_stack")
                or not isinstance(contract.get("concurrency"), int) or isinstance(contract.get("concurrency"), bool)
                or contract.get("concurrency", 0) < 1):
            reasons.append(label + ":invalid_controls")
        budget = contract.get("budget", {})
        budget = budget if isinstance(budget, dict) else {}
        keys = ("wall_seconds", "model_tokens", "tool_calls", "evidence_units")
        valid_budget = all(isinstance(budget.get(k), (int, float)) and not isinstance(budget[k], bool)
                           and math.isfinite(budget[k]) and budget[k] > 0 for k in keys)
        if not valid_budget:
            reasons.append(label + ":incomplete_budget")
        # Future collectors must produce per-case enforcement receipts, not just declarations.
        cases = report.get("cases", {})
        if not cases or len(cases) != report.get("dataset", {}).get("cases"):
            reasons.append(label + ":case_coverage_mismatch")
        for cid, row in cases.items():
            receipt = row.get("budget_receipt", {})
            if (not isinstance(receipt, dict) or not valid_budget
                    or receipt.get("case_id") != cid
                    or receipt.get("dataset_fingerprint") != report.get("dataset", {}).get("fingerprint")
                    or receipt.get("enforced") is not True or receipt.get("contract_sha256") != digest(contract)
                    or not all(isinstance(receipt.get(k), (int, float)) and not isinstance(receipt[k], bool)
                               and math.isfinite(receipt[k]) and 0 <= receipt[k] <= budget.get(k, -1) for k in keys)):
                reasons.append(label + ":missing_or_invalid_budget_receipts")
                break
    for field in required:
        if contracts[0].get(field) != contracts[1].get(field):
            reasons.append("different_" + field)
    return {"schema_version": "retrieval-comparison-readiness-1", "matched_comparison_ready": not reasons, "reasons": reasons,
            "historical_scores_unchanged": True,
            "limits": "A matching contract checks recorded controls; it does not prove causal gains or answer correctness."}
