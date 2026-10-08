"""Document, evidence, scope and reliability metrics without model judges."""
from __future__ import annotations

import math
import random
from collections import defaultdict
from statistics import fmean
from typing import Any

from .retrieval_schema import RetrievalDataset, digest, normalized, require

METRIC_VERSION = "retrieval-metrics-2.0"


def _coverage(interval: tuple[float, float], intervals: list[tuple[float, float]]) -> float:
    start, end = interval
    segments = sorted((max(start, a), min(end, b)) for a, b in intervals if b > start and a < end)
    total, right = 0.0, start
    for a, b in segments:
        total += max(0.0, b - max(a, right))
        right = max(right, b)
    return total / (end - start)


def anchor_hit(anchor: dict, hits: list[dict]) -> bool:
    matching = [h for h in hits if h["source_id"] == anchor["source_id"]
                and h.get("source_sha256") == anchor["source_sha256"]]
    if not matching:
        return False
    if "quote" in anchor:
        matching = [h for h in matching if normalized(anchor["quote"]) in normalized(h["content"])]
        if not matching:
            return False
    for start, end, threshold in (("start_seconds", "end_seconds", 0.5), ("start_char", "end_char", 0.8)):
        if start in anchor:
            intervals = [(h[start], h[end]) for h in matching if start in h and end in h]
            if _coverage((anchor[start], anchor[end]), intervals) < threshold:
                return False
    if "page" in anchor and not any(h.get("page") == anchor["page"] for h in matching):
        return False
    return True


def _scope_valid(case: dict, hit: dict) -> bool:
    scope = case.get("scope", {})
    return all(not scope.get(key) or hit.get(field) in scope[key] for key, field in (
        ("source_ids", "source_id"), ("kb_ids", "kb_id"), ("modalities", "modality")))


def score_case(case: dict, record: dict, ks: tuple[int, ...]) -> dict:
    success = record["status"] == "success"
    hits = record.get("hits", []) if success else []
    qrels = case["qrels"]
    positives = {sid: grade for sid, grade in qrels.items() if grade > 0}
    groups = case.get("evidence_groups", [])
    values: dict[str, float | None] = {"failure_rate": float(not success)}
    values["scope_violation_rate"] = float(any(not _scope_valid(case, h) for h in record.get("hits", [])))
    values["no_answer_result_rate"] = (float(bool(hits)) if case["answerability"] == "unanswerable" else None)
    values["no_answer_empty_success_rate"] = (float(success and not hits) if case["answerability"] == "unanswerable" else None)
    per_group = {}
    for k in ks:
        selected = hits[:k]
        seen, grades = set(), []
        for hit in selected:
            sid = hit["source_id"]
            grade = qrels.get(sid, 0) if sid not in seen and _scope_valid(case, hit) else 0
            grades.append(grade)
            seen.add(sid)
        if positives:
            values[f"document_recall@{k}"] = sum(g > 0 for g in grades) / len(positives)
            dcg = sum((2 ** g - 1) / math.log2(rank + 2) for rank, g in enumerate(grades))
            ideal = sum((2 ** g - 1) / math.log2(rank + 2) for rank, g in enumerate(sorted(positives.values(), reverse=True)[:k]))
            values[f"document_ndcg@{k}"] = dcg / ideal
            values[f"document_mrr@{k}"] = next((1 / rank for rank, grade in enumerate(grades, 1) if grade > 0), 0.0)
        else:
            for metric in ("recall", "ndcg", "mrr"):
                values[f"document_{metric}@{k}"] = None
        judged = sum(h["source_id"] in qrels or case["qrels_complete"] for h in selected)
        # Unknown qrels are surfaced, not silently advertised as confirmed negatives.
        values[f"judged_fraction@{k}"] = judged / len(selected) if selected else 0.0
        labels = [qrels.get(h["source_id"], 0) > 0 and _scope_valid(case, h) for h in selected
                  if h["source_id"] in qrels or case["qrels_complete"]]
        values[f"judged_precision@{k}"] = sum(labels) / len(labels) if labels else 0.0
        if groups:
            eligible = [h for h in selected if _scope_valid(case, h)]
            found = {g["id"]: any(all(anchor_hit(a, eligible) for a in alternative) for alternative in g["alternatives"]) for g in groups}
            values[f"evidence_group_recall@{k}"] = sum(found.values()) / len(groups)
            values[f"all_evidence_groups_hit@{k}"] = float(all(found.values()))
            per_group[str(k)] = found
        else:
            values[f"evidence_group_recall@{k}"] = None
            values[f"all_evidence_groups_hit@{k}"] = None
    return {"metrics": values, "groups": per_group, "status": record["status"], "duration_seconds": record.get("duration_seconds"),
            "tags": case["tags"], "cluster_id": case["cluster_id"], "returned_hits": len(hits),
            "recorded_hits_including_partial": len(record.get("hits", [])),
            "error_category": record.get("error", {}).get("category"),
            "native_status": record.get("diagnostics", {}).get("native_status"),
            "unscored_observations": len(record.get("diagnostics", {}).get("unscored", []))}


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    pos = (len(values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def aggregate(rows: list[dict]) -> dict:
    metric_names = sorted({m for row in rows for m in row["metrics"]})
    metrics = {}
    for metric in metric_names:
        present = [r["metrics"][metric] for r in rows if r["metrics"].get(metric) is not None]
        metrics[metric] = {"value": fmean(present) if present else None, "evaluated_cases": len(present), "total_cases": len(rows)}
    durations = [r["duration_seconds"] for r in rows if r.get("duration_seconds") is not None]
    return {"metrics": metrics, "latency": {"p50_seconds": _quantile(durations, .5), "p95_seconds": _quantile(durations, .95),
                                            "measured_cases": len(durations), "includes_failed_attempts": True},
            "successful_cases": sum(r["status"] == "success" for r in rows), "total_cases": len(rows)}


def score_run(dataset: RetrievalDataset, records: list[dict], *, split: str = "test", ks: tuple[int, ...] = (1, 5, 10, 50)) -> dict:
    require(bool(ks) and all(isinstance(k, int) and not isinstance(k, bool) and k > 0 for k in ks), "positive integer cutoffs required")
    ks = tuple(sorted(set(ks)))
    cases = {c["id"]: c for c in dataset.selected(split)}
    predictions = {}
    for record in records:
        cid = record.get("case_id")
        require(cid in cases and cid not in predictions, f"unknown or duplicate prediction: {cid}")
        require(record.get("dataset_fingerprint") == dataset.fingerprint, f"{cid}: prediction dataset mismatch")
        require(record.get("status") in {"success", "error", "timeout", "cancelled"}, f"{cid}: invalid status")
        require(isinstance(record.get("configuration"), dict) and bool(record["configuration"]), f"{cid}: configuration missing")
        require(record.get("configuration_fingerprint") == digest(record["configuration"]), f"{cid}: configuration hash mismatch")
        duration = record.get("duration_seconds")
        require(duration is None or isinstance(duration, (float, int)) and not isinstance(duration, bool) and math.isfinite(duration) and duration >= 0, f"{cid}: invalid duration")
        if record["status"] != "success":
            require(bool(record.get("error")), f"{cid}: failure receipt required")
        require(isinstance(record.get("hits"), list), f"{cid}: hits array required")
        hit_ids = set()
        for hit in record["hits"]:
            sid = hit.get("source_id")
            require(sid in dataset.sources, f"{cid}: hit source absent from frozen corpus: {sid}")
            require(isinstance(hit.get("content"), str) and bool(hit["content"].strip()), f"{cid}: nonempty hit content required")
            require(hit.get("source_sha256") == dataset.sources[sid]["text_sha256"], f"{cid}: hit source version mismatch")
            unit = next((u for u in dataset.sources[sid]["units"] if u["id"] == hit.get("id")), None)
            require(unit is not None, f"{cid}: unknown evidence unit")
            identity = (hit["id"], hit["content"])
            require(identity not in hit_ids, f"{cid}: duplicate evidence hit")
            hit_ids.add(identity)
            variants = [unit["text"], *unit.get("renderings", {}).values()]
            require(any(normalized(hit["content"]) in normalized(v) for v in variants), f"{cid}: hit content not in frozen source unit")
            if "score" in hit:
                require(isinstance(hit["score"], (int, float)) and not isinstance(hit["score"], bool) and math.isfinite(hit["score"]), f"{cid}: invalid hit score")
            for start, end in (("start_char", "end_char"), ("start_seconds", "end_seconds")):
                if start not in hit and end not in hit:
                    continue
                a, b = hit.get(start), hit.get(end)
                require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (a, b)), f"{cid}: invalid hit locator")
                require(start in unit and unit[start] <= a < b <= unit[end], f"{cid}: hit locator outside frozen unit")
                if start == "start_char":
                    require(isinstance(a, int) and isinstance(b, int) and normalized(dataset.sources[sid]["text"][a:b]) == normalized(hit["content"]), f"{cid}: hit character span does not match delivered text")
            if "page" in hit:
                require("page" in unit and hit["page"] == unit["page"], f"{cid}: hit page does not match frozen unit")
            require(hit.get("modality") == dataset.sources[sid]["modality"], f"{cid}: hit modality mismatch")
            expected_kb = dataset.sources[sid].get("metadata", {}).get("kb_id")
            if expected_kb is not None:
                require(hit.get("kb_id") == expected_kb, f"{cid}: hit scope identity mismatch")
        predictions[cid] = record
    require(predictions.keys() == cases.keys(), f"prediction coverage mismatch: missing={sorted(cases.keys() - predictions.keys())}")
    configurations = {r["configuration_fingerprint"] for r in records}
    require(len(configurations) == 1, "mixed run configurations")
    rows = {cid: score_case(cases[cid], predictions[cid], ks) for cid in cases}
    slices = {tag: aggregate([r for r in rows.values() if tag in r["tags"]]) for tag in sorted({tag for c in cases.values() for tag in c["tags"]})}
    usages = [r.get("usage", {}) for r in records]
    return {"schema_version": "retrieval-report-2", "metric_version": METRIC_VERSION,
            "dataset": {"name": dataset.manifest["name"], "fingerprint": dataset.fingerprint, "split": split, "cases": len(cases), "sources": len(dataset.sources)},
            "configuration": records[0]["configuration"], "configuration_fingerprint": records[0]["configuration_fingerprint"],
            "cutoffs": list(ks), "aggregate": aggregate(list(rows.values())), "slices": slices, "cases": rows,
            "usage": {"known_tokens": sum(u.get("known_tokens", 0) for u in usages),
                      "unknown_usage_calls": sum(u.get("unknown_usage_calls", 0) for u in usages),
                      "unreported_tasks": sum(not bool(u) or u.get("unreported_task_usage", False) for u in usages)},
            "limits": ["Document metrics count first K evidence units; repeated source documents have zero additional gain.",
                       "Unjudged sources get zero gain in conventional IR metrics; judged_fraction and judged_precision expose incomplete qrels.",
                       "Empty/failed outputs have zero judged_fraction and judged_precision; inspect these together with failure and no-answer metrics.",
                       "Evidence metrics apply only to annotated groups; no-answer and unknown-evidence cases have explicit separate denominators.",
                       "Latency includes all finished attempts; small samples do not establish a production SLA."]}


def compare_runs(baseline: dict, candidate: dict, *, bootstrap_samples: int = 2000, seed: int = 20261008,
                 allowed_changes: tuple[str, ...] = ()) -> dict:
    """Paired evidence, not an automatic promotion decision. Changes must be named."""
    require(baseline["schema_version"] == candidate["schema_version"] == "retrieval-report-2", "report schema mismatch")
    require(baseline["metric_version"] == candidate["metric_version"], "metric version mismatch")
    require(baseline["dataset"] == candidate["dataset"], "dataset or split mismatch")
    require(baseline["cutoffs"] == candidate["cutoffs"], "cutoff mismatch")
    require(baseline["cases"].keys() == candidate["cases"].keys(), "case coverage mismatch")
    require(bootstrap_samples >= 100, "at least 100 bootstrap samples required")
    for report in (baseline, candidate):
        require(digest(report["configuration"]) == report["configuration_fingerprint"], "report configuration fingerprint mismatch")
    changed = [k for k in baseline["configuration"].keys() | candidate["configuration"].keys()
               if baseline["configuration"].get(k) != candidate["configuration"].get(k)]
    require(set(changed) <= set(allowed_changes), f"undeclared configuration changes: {sorted(set(changed) - set(allowed_changes))}")
    rng = random.Random(seed)
    metrics = {}
    for metric in baseline["aggregate"]["metrics"]:
        groups = defaultdict(list)
        for cid, old in baseline["cases"].items():
            new = candidate["cases"][cid]
            require(old["cluster_id"] == new["cluster_id"], "cluster identity mismatch")
            a, b = old["metrics"][metric], new["metrics"].get(metric)
            require((a is None) == (b is None), f"metric coverage changed: {metric}/{cid}")
            if a is not None:
                require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (a, b)), f"invalid paired metric: {metric}/{cid}")
                groups[old["cluster_id"]].append(b - a)
        if not groups:
            continue
        clusters = list(groups.values())
        deltas = [d for group in clusters for d in group]
        sampled = []
        for _ in range(bootstrap_samples):
            draw = [d for _ in clusters for d in rng.choice(clusters)]
            sampled.append(fmean(draw))
        metrics[metric] = {"delta": fmean(deltas), "ci95": [_quantile(sampled, .025), _quantile(sampled, .975)],
                           "paired_cases": len(deltas), "independent_clusters": len(clusters),
                           "direction": "lower_is_better" if metric in {"failure_rate", "scope_violation_rate", "no_answer_result_rate"} else "higher_is_better"}
    return {"schema_version": "retrieval-comparison-2", "dataset": baseline["dataset"], "configuration_changes": sorted(changed),
            "bootstrap": {"samples": bootstrap_samples, "seed": seed, "unit": "query_cluster"}, "metrics": metrics,
            "automatic_promotion": False, "limits": "Intervals describe sampled query clusters, not repeated-run or provider variability. Inspect coverage, slices and failures before adoption."}
