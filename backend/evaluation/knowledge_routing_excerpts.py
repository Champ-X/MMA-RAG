"""Deterministic current-corpus excerpt attribution diagnostic, not natural QA.

Queries are verbatim excerpts sampled across KBs, fields and source files without
observing policy scores. Labels accept every current indexed copy of that excerpt.
These easy, source-derived probes supplement human/authored questions; never pool
their scores with a natural-query benchmark or call them a blind holdout.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

import numpy as np

from .knowledge_routing import TEXT_FIELDS, load_snapshot, sha, write_json
from .retrieval_schema import digest, normalized, require

FIELDS = {"text_chunks_agentic": ("text_content",), "image_vectors": ("caption",),
          "audio_vectors": ("transcript", "description"), "video_shot_vectors": ("asr_text", "caption")}


def excerpt_cases(content: list[dict], per_kb: int = 8) -> list[dict]:
    require(1 <= per_kb <= 32, "invalid per-KB quota")
    buckets = defaultdict(lambda: defaultdict(list))
    searchable = [(row, normalized("\n".join(str(row["payload"].get(field) or "") for field in TEXT_FIELDS)))
                  for row in content]
    for row in content:
        payload = row["payload"]
        kb = payload.get("kb_id")
        if not kb:
            continue
        for field in FIELDS.get(row["collection"], ()):
            query = " ".join(str(payload.get(field) or "").split())[:160]
            if len(query) < 48:
                continue
            key = (row["collection"], field, str(payload.get("file_id") or row["id"]))
            buckets[kb][key].append((digest(["routing-excerpt-v1", row["id"], field]), query, row, field))
    cases, seen = [], set()
    for kb, groups in sorted(buckets.items()):
        ordered_groups = [sorted(groups[key]) for key in sorted(groups, key=lambda key: digest(["routing-excerpt-group-v1", key]))]
        selected = []
        while len(selected) < per_kb and any(ordered_groups):
            for group in ordered_groups:
                if not group or len(selected) >= per_kb:
                    continue
                _, query, row, field = group.pop(0)
                if normalized(query) in seen:
                    continue
                seen.add(normalized(query))
                selected.append((query, row, field))
        for query, row, field in selected:
            quote = normalized(query)
            matches = [{"kb_id": candidate["payload"]["kb_id"], "point_id": str(candidate["id"]),
                        "collection": candidate["collection"], "payload_sha256": digest(candidate["payload"])}
                       for candidate, body in searchable if candidate["payload"].get("kb_id") and quote in body]
            require(bool(matches), "excerpt lost its source")
            cases.append({"id": f"excerpt-{len(cases) + 1:03d}", "query": query, "split": "diagnostic",
                          "cluster_id": str(row["payload"].get("file_id") or row["id"]),
                          "tags": ["verbatim-source-excerpt", row["collection"], field], "source_kb_id": kb,
                          "groups": [{"id": "indexed_excerpt", "alternatives": [[{
                              "original_anchor": {"source_id": str(row["id"]), "quote": query, "source_sha256": digest(row["payload"])},
                              "matches": matches}]]}]})
    return cases


async def freeze(source: Path, output: Path, per_kb: int = 8):
    from .retrieval_models import ModelCalls, _embed_batch

    source_manifest, *_ = load_snapshot(source)
    content = json.loads((source / "content.json").read_text())
    cases = excerpt_cases(content, per_kb)
    require(bool(cases), "no qualifying source excerpts")
    output.mkdir(parents=True, exist_ok=False)
    for filename in ("content.json", "portraits.json"):
        shutil.copyfile(source / filename, output / filename)
    write_json(output / "cases.json", cases)
    write_json(output / "excluded.json", [])
    calls = ModelCalls()
    require(calls.stack["embedding"] == {key: source_manifest["embedding"][key] for key in ("model", "provider", "raw_model")},
            "source query embedding model changed")
    cache = output / "embedding-batches"
    cache.mkdir()
    vectors, receipts = [], []
    for start in range(0, len(cases), 16):
        array, receipt = await _embed_batch(calls, [case["query"] for case in cases[start:start + 16]], cache)
        vectors.append(array)
        receipts.append(receipt)
        print(f"embedded excerpts {min(start + 16, len(cases))}/{len(cases)}", flush=True)
    with (output / "queries.npy").open("xb") as stream:
        np.save(stream, np.concatenate(vectors), allow_pickle=False)
    write_json(output / "embedding-receipts.json", receipts)
    manifest = {**source_manifest, "source_snapshot_manifest_sha256": sha(source / "manifest.json"),
                "created_at": datetime.now(timezone.utc).isoformat(), "dataset_path": str(source.resolve()),
                "dataset_fingerprint": digest(cases), "dataset_provenance": "deterministic current-index excerpt attribution; not natural QA or blind holdout",
                "queries": len(cases), "excluded": 0, "splits": {"diagnostic": len(cases)}, "source_code": {__file__: sha(Path(__file__))},
                "split_policy": "diagnostic only; no train/test split or heldout claim",
                "sampling": {"per_kb": per_kb, "maximum_characters": 160, "minimum_characters": 48,
                             "policy": "stable content-point hashes, round robin across source file and content field; no score-based selection"},
                "files": {name: sha(output / name) for name in ("content.json", "portraits.json", "cases.json", "excluded.json", "queries.npy", "embedding-receipts.json")},
                "limits": ["Verbatim indexed excerpts are easy source-attribution probes, not natural user queries.",
                           "All indexed copies containing the exact normalized excerpt are accepted.",
                           "Labels refer to current indexed descriptions/transcripts, not independently verified original-media truth.",
                           "Report separately from the natural-query diagnostic; never pool their accuracy."]}
    write_json(output / "manifest.json", manifest)
    return {"output": str(output), "cases": len(cases), "source_kbs": len({case["source_kb_id"] for case in cases})}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-kb", type=int, default=8)
    args = parser.parse_args(argv)
    print(json.dumps(asyncio.run(freeze(args.source_snapshot, args.output, args.per_kb)), indent=2))


if __name__ == "__main__":
    main()
