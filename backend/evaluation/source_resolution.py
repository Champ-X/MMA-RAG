"""Resolve native source aliases using frozen point identity, never qrels."""
from collections import defaultdict

from .retrieval_schema import normalized, require

RESOLUTION_VERSION = "frozen-point-first-1"


class FrozenEvidenceResolver:
    def __init__(self, dataset):
        self.by_point = defaultdict(list)
        self.by_pair = {}
        for source in dataset.sources.values():
            self.by_pair[(source["metadata"]["kb_id"], source["metadata"]["file_id"])] = source
            for unit in source["units"]:
                self.by_point[unit["original_point_id"]].append((source, unit))

    def resolve(self, raw, *, canonical_kb_id):
        metadata, content = raw["source"], raw.get("content", "")
        require(isinstance(content, str) and bool(content.strip()), "live result has no inspectable evidence content")
        def matches(source, unit):
            return source["metadata"]["kb_id"] == canonical_kb_id and any(
                normalized(content) in normalized(value) for value in (unit["text"], *unit.get("renderings", {}).values()))
        # An immutable index point and its exact delivered text are more specific
        # than the file identity assigned to a PDF-extracted image by Pi's catalog.
        candidates = [(s, u) for s, u in self.by_point.get(str(raw["id"]), []) if matches(s, u)]
        if not candidates:
            source = self.by_pair.get((canonical_kb_id, metadata.get("file_id")))
            candidates = [(source, u) for u in source["units"] if matches(source, u)] if source else []
        require(len(candidates) == 1, "live result cannot be uniquely resolved to frozen point/content")
        source, unit = candidates[0]
        require(raw["modality"] == source["modality"], "native modality differs from frozen point")
        hit = {"id": unit["id"], "source_id": source["id"], "source_sha256": source["text_sha256"], "content": content,
               "kb_id": canonical_kb_id, "modality": source["modality"], "score": raw["score"]}
        if content in unit["text"]:
            offset = unit["text"].index(content)
            hit.update(start_char=unit["start_char"] + offset, end_char=unit["start_char"] + offset + len(content))
        for field in ("start_seconds", "end_seconds", "page"):
            if metadata.get(field) is not None:
                hit[field] = metadata[field]
        if source["metadata"]["file_id"] != metadata.get("file_id"):
            hit["native_source_file_alias"] = metadata.get("file_id")
        return hit


def resolve_pi_evidence(dataset, evidence, *, top_k=50):
    from .retrieval_local import canonical_kb
    resolver = FrozenEvidenceResolver(dataset)
    known_kbs = {source["metadata"]["kb_id"] for source in dataset.sources.values()}
    hits, seen, unscored, unresolved = [], set(), [], []
    for item in evidence:
        if item["observation"] in {"media_observation", "calculation"} or item["source"] != "knowledge":
            unscored.append({"id": item["id"], "observation": item["observation"]})
            continue
        locator, provenance = item["locator"], item["provenance"]
        raw = {"id": locator.get("point_id"), "content": item["content"], "score": 0.0, "modality": item["modality"],
               "source": {"knowledge_base_id": provenance.get("kb_id"), "file_id": provenance.get("file_id"),
                          "page": locator.get("page", locator.get("page_number")),
                          "start_seconds": locator.get("shot_start_time"), "end_seconds": locator.get("shot_end_time")}}
        try:
            hit = resolver.resolve(raw, canonical_kb_id=canonical_kb(provenance["kb_id"], known_kbs))
        except ValueError as error:
            unresolved.append({"id": item["id"], "reason": str(error)})
            continue
        identity = (hit["id"], hit["content"])
        if identity not in seen:
            hits.append(hit)
            seen.add(identity)
    return hits[:top_k], {"unscored": unscored, "unresolved": unresolved,
                          "resolved_source_aliases": sum("native_source_file_alias" in hit for hit in hits)}
