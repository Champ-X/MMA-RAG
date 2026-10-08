"""Audit native Pi observations, cited evidence and answer judgments separately."""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from statistics import fmean

from .retrieval_metrics import anchor_hit, score_run
from .retrieval_review import reviewer, sha
from .retrieval_schema import digest, require, text
from .source_resolution import resolve_pi_evidence

STAGE_VERSION = "retrieval-stages-1"


def load_native_receipts(records: list[dict], directory: Path) -> dict:
    native = {}
    for row in records:
        path = directory / (digest(row["case_id"]) + ".evidence.json")
        require(sha(path) == row.get("native_observation_sha256"), "native observation file checksum mismatch")
        native[row["case_id"]] = json.loads(path.read_text())
    return native


def cited_ids(answer: str) -> list[int]:
    """Use the same numeric marker syntax as native submission validation."""
    return list(dict.fromkeys(int(number) for number in re.findall(r"\[(\d+)\]", answer)))


def validate_media_reviews(dataset, review: dict, root: Path, native: dict) -> dict:
    if not review:
        return {}
    require(review.get("schema_version") == "retrieval-media-review-1", "media review schema mismatch")
    require(review.get("dataset_fingerprint") == dataset.fingerprint, "media review dataset mismatch")
    reviewer(review.get("reviewer"))
    require(isinstance(review.get("observations"), list) and bool(review["observations"]), "media observations required")
    cases = {case["id"]: case for case in dataset.cases}
    validated = {}
    for entry in review.get("observations", []):
        cid = entry.get("case_id")
        require(cid in cases and cid in native, "unknown media review case")
        payload = native[cid]
        require(entry.get("native_receipt_sha256") == digest(payload), "media review receipt changed")
        item = next((item for item in payload["evidence"] if item["id"] == entry.get("evidence_id")), None)
        require(item is not None and item["observation"] == "media_observation", "reviewed item is not a media observation")
        require(item.get("source") == "knowledge", "media review must bind an indexed source")
        require(entry.get("observation_sha256") == digest(item), "media observation changed")
        source = dataset.sources.get(entry.get("source_id"))
        require(source is not None and source["modality"] == item["modality"], "media review source mismatch")
        metadata = source["metadata"]
        identity = hashlib.sha256(f"{metadata['kb_id']}\0{metadata['file_id']}".encode()).hexdigest()[:24]
        require(item["source_id"] == "src_" + identity, "native media identity does not match frozen source")
        asset = (root / text(entry.get("asset_path"), "asset_path")).resolve()
        require(root.resolve() in asset.parents, "media asset path escapes review directory")
        require(sha(asset) == entry.get("asset_sha256"), "original media bytes changed")
        # Content version is independently bound by the read-only original-object receipt.
        version = item.get("provenance", {}).get("source_version")
        require(version and entry.get("source_version") == version, "original media version mismatch")
        receipt = entry.get("asset_receipt", {})
        require(receipt.get("native_source_id") == item["source_id"] and receipt.get("source_version") == version
                and receipt.get("sha256") == entry["asset_sha256"], "original asset receipt mismatch")
        if re.fullmatch(r"[0-9a-f]{32}", version):
            require(hashlib.md5(asset.read_bytes()).hexdigest() == version, "original object content version changed")
        anchor = next((a for g in cases[cid]["evidence_groups"] for alt in g["alternatives"] for a in alt
                       if digest(a) == entry.get("anchor_sha256")), None)
        require(anchor is not None, "unknown reviewed evidence anchor")
        verdict = entry.get("verdict")
        require(verdict in {"supports", "does_not_support", "unknown"}, "invalid media verdict")
        if verdict == "supports":
            # Version 1 certifies still images only. Audio/video need separate
            # segment/frame coverage receipts before receiving media credit.
            require(source["modality"] == "image" and re.fullmatch(r"[0-9a-f]{32}", version),
                    "positive media review requires an original still image with a verifiable content version")
            require(not any(k in anchor for k in ("start_seconds", "start_char", "page")),
                    "media review cannot replace positional evidence without a locator mapping")
            require(anchor["source_id"] == source["id"], "media review cannot transfer credit between sources")
            scope = cases[cid].get("scope", {})
            require(all(not scope.get(k) or v in scope[k] for k, v in (
                ("source_ids", source["id"]), ("kb_ids", metadata["kb_id"]), ("modalities", source["modality"]))),
                "reviewed media outside query scope")
        text(entry.get("reason"), "media review reason")
        key = (cid, item["id"], digest(anchor))
        require(key not in validated, "duplicate media adjudication")
        validated[key] = verdict
    return validated


def evidence_coverage(case: dict, observations: list[dict], media: dict, *, success: bool) -> dict:
    hits = [o["hit"] for o in observations if o.get("hit")]
    scope = case.get("scope", {})
    hits = [h for h in hits if all(not scope.get(key) or h.get(field) in scope[key] for key, field in
            (("source_ids", "source_id"), ("kb_ids", "kb_id"), ("modalities", "modality")))]

    def matched(anchor):
        if anchor_hit(anchor, hits):
            return True
        return any(o["kind"] == "unscored" and media.get((case["id"], o["id"], digest(anchor))) == "supports"
                   for o in observations)

    groups = case.get("evidence_groups", [])
    found = {g["id"]: success and any(all(matched(a) for a in alt) for alt in g["alternatives"]) for g in groups}
    unknown = [o["id"] for o in observations if o["kind"] == "unscored" and not any(
        key[0] == case["id"] and key[1] == o["id"] and verdict != "unknown" for key, verdict in media.items())]
    return {"all_required_evidence": float(all(found.values())) if groups else None,
            "evidence_group_recall": fmean(found.values()) if groups else None,
            "groups": found, "observations": len(observations), "unjudged_observations": len(unknown)}


def answer_quality(case_rows: dict, judgments: dict, dataset_fingerprint: str) -> dict:
    """Missing semantic judgments stay unknown, never inferred from completed/status."""
    fields = ("answer_correctness", "citation_support", "abstention_correctness")
    reviews = {}
    if judgments:
        require(judgments.get("schema_version") == "retrieval-answer-review-1", "answer review schema mismatch")
        require(judgments.get("dataset_fingerprint") == dataset_fingerprint, "answer review dataset mismatch")
        reviewer(judgments.get("reviewer"))
        text(judgments.get("rubric_version"), "answer rubric_version")
        require(isinstance(judgments.get("judgments"), list) and bool(judgments["judgments"]), "answer judgments required")
        for entry in judgments.get("judgments", []):
            cid = entry.get("case_id")
            require(cid in case_rows and cid not in reviews, "unknown or duplicate answer judgment")
            row = case_rows[cid]
            require(entry.get("answer_sha256") == row["answer_sha256"] and
                    entry.get("native_receipt_sha256") == row["native_receipt_sha256"], "answer review receipt mismatch")
            text(entry.get("reason"), "answer review reason")
            for field in fields:
                value = entry.get(field)
                require(value is None or isinstance(value, (int, float)) and not isinstance(value, bool)
                        and math.isfinite(value) and 0 <= value <= 1, "invalid answer judgment value")
            require(row["answerability"] == "unanswerable" or entry.get("abstention_correctness") is None,
                    "abstention correctness applies only to no-answer cases")
            reviews[cid] = entry
    result = {}
    for field in fields:
        eligible = {cid: row for cid, row in case_rows.items()
                    if field != "abstention_correctness" or row["answerability"] == "unanswerable"}
        values = []
        adjudicated = failures = 0
        for cid, row in eligible.items():
            if row["task_status"] != "success":
                values.append(0.0)
                failures += 1
            elif reviews.get(cid, {}).get(field) is not None:
                values.append(reviews[cid][field])
                adjudicated += 1
        result[field] = {"value": fmean(values) if values and len(values) == len(eligible) else None,
                         "reviewed_plus_failure_mean": fmean(values) if values else None,
                         "adjudicated_cases": adjudicated, "failed_cases": failures,
                         "unknown_cases": len(eligible) - len(values), "total_cases": len(eligible)}
    return result


def audit_pi_stages(dataset, records: list[dict], native: dict, *, media_review: dict | None = None,
                    media_root: Path | None = None, answer_review: dict | None = None,
                    split: str = "test") -> tuple[dict, list[dict]]:
    """Full native evidence order retains unjudged observations as real top-K slots."""
    score_run(dataset, records, split=split)  # Validate measured records before any derived evaluation.
    cases = {case["id"]: case for case in dataset.selected(split)}
    require(native.keys() == cases.keys(), "native receipt coverage mismatch")
    media = validate_media_reviews(dataset, media_review or {}, media_root or Path("."), native)
    rows, packets = {}, []
    for record in records:
        cid = record["case_id"]
        case, payload = cases[cid], native[cid]
        run = payload["run"]
        require(run["id"] == record["diagnostics"]["run_id"], "native run identity mismatch")
        require(run["status"] == record["diagnostics"]["native_status"], "native terminal status mismatch")
        require(run["request"]["message"] == case["query"], "native question mismatch")
        require(run["status"] in {"completed", "partial", "needs_input", "cancelled", "failed"}, "native run is not terminal")
        require(record["status"] != "success" or run["status"] in {"completed", "partial", "needs_input"},
                "unsuccessful native run reported as success")
        raw = payload["evidence"]
        require(all(isinstance(item.get("id"), int) and not isinstance(item["id"], bool) and item["id"] > 0 for item in raw),
                "native evidence IDs must be positive integers")
        require(len({item["id"] for item in raw}) == len(raw), "duplicate native evidence IDs")
        indexed, resolution = resolve_pi_evidence(dataset, raw, top_k=record["configuration"].get("top_k", 50))
        require(not resolution["unresolved"] and indexed == record["hits"], "native indexed evidence differs from measured record")
        observations = []
        seen = set()
        by_id = {}
        for item in raw:
            hits, diagnostics = resolve_pi_evidence(dataset, [item])
            require(not diagnostics["unresolved"], "native indexed evidence is unresolved")
            observation = {"id": item["id"], "kind": "indexed" if hits else "unscored", "hit": hits[0] if hits else None}
            by_id[item["id"]] = observation
            identity = (hits[0]["id"], hits[0]["content"]) if hits else ("native", item["id"])
            if identity not in seen:
                observations.append(observation)
                seen.add(identity)
        state = run.get("state") or {}
        answer = state.get("answer") or ""
        require(isinstance(answer, str), "native answer must be a string")
        references = cited_ids(answer)
        citations = state.get("citations") or []
        require(len({item["id"] for item in citations}) == len(citations), "duplicate attached citations")
        attached = {item["id"]: item for item in citations}
        invalid = [number for number in references if number not in by_id or number not in attached]
        for number in references:
            if number in attached and number in by_id:
                original = next(item for item in raw if item["id"] == number)
                if (attached[number].get("source_id") != original["source_id"]
                        or attached[number].get("content") != original["content"]
                        or attached[number].get("pi_run_id") != run["id"]):
                    invalid.append(number)
        # Invalid markers occupy their position; do not silently shift later references into top 5.
        final = [by_id[number] if number not in invalid else {"id": number, "kind": "invalid", "hit": None}
                 for number in references]
        successful = record["status"] == "success"
        stage_rows = {}
        for stage, sequence in (("research_observations", observations), ("final_answer_citations", final)):
            stage_rows[stage] = {str(k): evidence_coverage(case, sequence[:k], media, success=successful) for k in (5, 50)}
            stage_rows[stage]["all"] = evidence_coverage(case, sequence, media, success=successful)
        row = {"task_status": record["status"], "native_status": run["status"], "answerability": case["answerability"],
               "cluster_id": case["cluster_id"], "answer_present": bool(answer), "answer_sha256": digest(answer),
               "native_receipt_sha256": digest(payload), "stages": stage_rows,
               "citation_markers": len(references), "invalid_citation_markers": len(set(invalid)),
               "answer_outcome": state.get("outcome"),
               "uncited_attached_evidence": len(set(attached) - set(references))}
        rows[cid] = row
        packets.append({"case_id": cid, "query": case["query"], "answerability": case["answerability"],
                        "answer": answer, "answer_sha256": row["answer_sha256"],
                        "native_receipt_sha256": row["native_receipt_sha256"], "status": record["status"],
                        "scope": case.get("scope", {}), "evidence_groups": case["evidence_groups"],
                        "cited_evidence": [item for item in raw if item["id"] in references],
                        "judgments": {k: None for k in ("answer_correctness", "citation_support", "abstention_correctness")}})
    stages = {}
    for stage in ("research_observations", "final_answer_citations"):
        stages[stage] = {}
        for cutoff in ("5", "50", "all"):
            selected = [r["stages"][stage][cutoff] for r in rows.values()]
            stages[stage][cutoff] = {}
            for field in ("all_required_evidence", "evidence_group_recall"):
                values = [r[field] for r in selected if r[field] is not None]
                stages[stage][cutoff][field] = {"value": fmean(values) if values else None,
                    "evaluated_cases": len(values), "total_cases": len(rows)}
            stages[stage][cutoff]["unjudged_observations"] = sum(r["unjudged_observations"] for r in selected)
    report = {"schema_version": STAGE_VERSION, "dataset_fingerprint": dataset.fingerprint, "split": split,
              "media_review_sha256": digest(media_review) if media_review else None,
              "answer_review_sha256": digest(answer_review) if answer_review else None,
              "cases": rows, "stages": stages, "semantic_quality": answer_quality(rows, answer_review or {}, dataset.fingerprint),
              "diagnostics": {"cases": len(rows), "native_statuses": dict(Counter(r["native_status"] for r in rows.values())),
                              "answers_present": sum(r["answer_present"] for r in rows.values()),
                              "invalid_citation_markers": sum(r["invalid_citation_markers"] for r in rows.values()),
                              "media_adjudications": len(media)},
              "limits": ["Native observation order and final citation order are separate stages, neither a reranked relevance list.",
                         "Unreviewed media/calculations remain unknown and occupy their observed positions.",
                         "Media credit applies only to individually reviewed anchors, not all claims in an observation.",
                         "Media review v1 certifies original still images only; audio/video observations await segment/frame review.",
                         "Evidence coverage and valid citation identity do not establish semantic answer correctness.",
                         "Historical Direct/legacy runs have no saved answers; do not invent zero scores for those stages.",
                         "Posthoc annotation repairs are diagnostic development evidence, not unseen holdout performance."]}
    return report, packets
