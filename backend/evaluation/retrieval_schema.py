"""Strict, source-anchored contracts for retrieval evaluation (independent of v1)."""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .schema import EvaluationDataError

MODALITIES = {"doc", "image", "audio", "video"}


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def normalized(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvaluationDataError(message)


def text(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value.strip()), f"{label}: nonempty string required")
    return value


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except ValueError as exc:
            raise EvaluationDataError(f"{path}:{line_number}: invalid JSON") from exc
        require(isinstance(row, dict), f"{path}:{line_number}: object required")
        rows.append(row)
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        for row in rows:
            stream.write(canonical(row).decode() + "\n")


def _interval(value: Mapping, start: str, end: str, label: str) -> None:
    if start not in value and end not in value:
        return
    a, b = value.get(start), value.get(end)
    require(all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (a, b)), f"{label}: invalid interval")
    require(0 <= a < b, f"{label}: invalid interval bounds")


@dataclass(frozen=True)
class RetrievalDataset:
    manifest_path: Path
    manifest: dict
    sources: dict[str, dict]
    cases: tuple[dict, ...]
    fingerprint: str

    @classmethod
    def load(cls, path: str | Path) -> "RetrievalDataset":
        path = Path(path).resolve()
        manifest = json.loads(path.read_text())
        require(manifest.get("schema_version") == "retrieval-2", "expected retrieval-2 schema")
        text(manifest.get("name"), "manifest.name")
        text(manifest.get("version"), "manifest.version")
        require(isinstance(manifest.get("provenance"), dict), "manifest.provenance required")
        rows = {}
        for key in ("corpus", "cases"):
            spec = manifest.get(key, {})
            filename = text(spec.get("path"), f"manifest.{key}.path")
            target = (path.parent / filename).resolve()
            require(path.parent in target.parents, f"{key}: path escapes dataset")
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
            require(actual == spec.get("sha256"), f"{key}: SHA-256 mismatch")
            rows[key] = read_jsonl(target)
            require(len(rows[key]) == spec.get("count"), f"{key}: row count mismatch")
        sources = {}
        unit_ids = set()
        for source in rows["corpus"]:
            sid = text(source.get("id"), "source.id")
            require(sid not in sources, f"duplicate source: {sid}")
            require(source.get("modality") in MODALITIES, f"{sid}: invalid modality")
            body = text(source.get("text"), f"{sid}.text")
            require(source.get("text_sha256") == hashlib.sha256(body.encode()).hexdigest(), f"{sid}: text hash mismatch")
            require(isinstance(source.get("metadata", {}), dict), f"{sid}: metadata must be an object")
            units = source.get("units")
            require(isinstance(units, list) and bool(units), f"{sid}: retrieval units required")
            for unit in units:
                uid = text(unit.get("id"), "unit.id")
                require(uid not in unit_ids, f"duplicate unit: {uid}")
                unit_ids.add(uid)
                unit_text = text(unit.get("text"), f"{uid}.text")
                require(normalized(unit_text) in normalized(body), f"{uid}: unit text missing from source")
                _interval(unit, "start_char", "end_char", uid)
                if "start_char" in unit:
                    require(all(isinstance(unit[k], int) for k in ("start_char", "end_char")), f"{uid}: character offsets must be integers")
                    require(body[unit["start_char"]:unit["end_char"]] == unit_text, f"{uid}: character anchor mismatch")
                _interval(unit, "start_seconds", "end_seconds", uid)
                renderings = unit.get("renderings", {})
                require(isinstance(renderings, dict) and all(isinstance(k, str) and isinstance(v, str) and v.strip() for k, v in renderings.items()), f"{uid}: invalid source renderings")
                if "page" in unit:
                    require(isinstance(unit["page"], int) and not isinstance(unit["page"], bool) and unit["page"] >= 0, f"{uid}: invalid page")
            sources[sid] = source
        case_ids, query_splits, cluster_splits = set(), {}, {}
        for case in rows["cases"]:
            cid = text(case.get("id"), "case.id")
            require(cid not in case_ids, f"duplicate case: {cid}")
            case_ids.add(cid)
            query = normalized(text(case.get("query"), f"{cid}.query"))
            split = case.get("split")
            require(split in {"dev", "test", "regression"}, f"{cid}: invalid split")
            cluster = text(case.get("cluster_id"), f"{cid}.cluster_id")
            for value, seen in ((query, query_splits), (cluster, cluster_splits)):
                require(value not in seen or seen[value] == split, f"{cid}: query or cluster leaks across splits")
                seen[value] = split
            require(isinstance(case.get("tags"), list) and all(isinstance(t, str) and t for t in case["tags"]), f"{cid}: tags required")
            require(case.get("answerability") in {"answerable", "unanswerable", "unknown"}, f"{cid}: explicit answerability required")
            require(isinstance(case.get("qrels_complete"), bool), f"{cid}: qrels_complete required")
            require(isinstance(case.get("annotation"), dict) and case["annotation"].get("origin"), f"{cid}: annotation provenance required")
            qrels = case.get("qrels")
            require(isinstance(qrels, dict), f"{cid}: source-id qrels object required")
            for sid, grade in qrels.items():
                require(sid in sources, f"{cid}: unknown qrel source {sid}")
                require(isinstance(grade, int) and not isinstance(grade, bool) and 0 <= grade <= 3, f"{cid}: invalid qrel")
            positive = {sid for sid, grade in qrels.items() if grade > 0}
            if case["answerability"] == "answerable":
                require(bool(positive), f"{cid}: answerable case needs positive qrels")
            if case["answerability"] == "unanswerable":
                require(not positive and case["qrels_complete"], f"{cid}: no-answer label needs complete nonpositive qrels")
            scope = case.get("scope", {})
            require(isinstance(scope, dict), f"{cid}: scope must be object")
            for key in ("kb_ids", "source_ids", "modalities"):
                require(isinstance(scope.get(key, []), list) and all(isinstance(v, str) and v for v in scope.get(key, [])), f"{cid}: invalid scope.{key}")
            require(set(scope.get("modalities", [])) <= MODALITIES, f"{cid}: invalid scope modality")
            require(set(scope.get("source_ids", [])) <= sources.keys(), f"{cid}: unknown scope source")
            for sid in positive:
                source = sources[sid]
                require(not scope.get("source_ids") or sid in scope["source_ids"], f"{cid}: positive source outside scope")
                require(not scope.get("kb_ids") or source.get("metadata", {}).get("kb_id") in scope["kb_ids"], f"{cid}: positive knowledge base outside scope")
                require(not scope.get("modalities") or source["modality"] in scope["modalities"], f"{cid}: positive modality outside scope")
            groups = case.get("evidence_groups", [])
            require(isinstance(groups, list), f"{cid}: invalid evidence groups")
            require(len({g.get("id") for g in groups}) == len(groups), f"{cid}: duplicate evidence group")
            for group in groups:
                text(group.get("id"), f"{cid}.group.id")
                alternatives = group.get("alternatives")
                require(isinstance(alternatives, list) and bool(alternatives), f"{cid}: alternatives required")
                for alternative in alternatives:
                    require(isinstance(alternative, list) and bool(alternative), f"{cid}: anchor conjunction required")
                    for anchor in alternative:
                        sid = anchor.get("source_id")
                        require(sid in positive, f"{cid}: evidence anchor must reference a positive qrel")
                        require(anchor.get("source_sha256") == sources[sid]["text_sha256"], f"{cid}: anchor source version mismatch")
                        if "quote" in anchor:
                            quote = normalized(text(anchor["quote"], f"{cid}.anchor.quote"))
                            require(quote in normalized(sources[sid]["text"]), f"{cid}: evidence quote missing from source")
                        _interval(anchor, "start_seconds", "end_seconds", cid)
                        _interval(anchor, "start_char", "end_char", cid)
                        require(any(k in anchor for k in ("quote", "start_char", "start_seconds", "page")), f"{cid}: evidence anchor has no locator")
                        if "start_char" in anchor:
                            a, b = anchor["start_char"], anchor["end_char"]
                            require(all(isinstance(v, int) and not isinstance(v, bool) for v in (a, b)) and b <= len(sources[sid]["text"]), f"{cid}: character anchor outside source")
                            if "quote" in anchor:
                                require(normalized(anchor["quote"]) in normalized(sources[sid]["text"][a:b]), f"{cid}: quote does not match character anchor")
                        if "start_seconds" in anchor:
                            require(any(u.get("start_seconds", float("inf")) <= anchor["start_seconds"] < anchor["end_seconds"] <= u.get("end_seconds", -1) for u in sources[sid]["units"]), f"{cid}: time anchor outside indexed source")
                        if "page" in anchor:
                            require(any(u.get("page") == anchor["page"] for u in sources[sid]["units"]), f"{cid}: unknown page anchor")
            if case["answerability"] == "unanswerable":
                require(not groups, f"{cid}: no-answer case cannot have required evidence")
        require(bool(sources) and bool(case_ids), "dataset must contain sources and cases")
        return cls(path, manifest, sources, tuple(rows["cases"]), digest(manifest))

    def selected(self, split: str = "test") -> tuple[dict, ...]:
        result = tuple(c for c in self.cases if split == "all" or c["split"] == split)
        require(bool(result), f"empty split: {split}")
        return result


def create_dataset(destination: Path, *, name: str, sources: list[dict], cases: list[dict], provenance: dict) -> RetrievalDataset:
    """Never overwrite a frozen dataset; hashes cover full source and case files."""
    destination.mkdir(parents=True, exist_ok=False)
    manifest = {"schema_version": "retrieval-2", "name": name, "version": "1.0.0", "provenance": provenance}
    for key, records in (("corpus", sources), ("cases", cases)):
        path = destination / f"{key}.jsonl"
        write_jsonl(path, records)
        manifest[key] = {"path": path.name, "count": len(records), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return RetrievalDataset.load(destination / "manifest.json")
