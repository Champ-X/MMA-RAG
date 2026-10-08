"""Pinned public-data import and immutable read-only local index snapshots."""
from __future__ import annotations

import hashlib
import io
import json
import tarfile
import urllib.request
from collections import Counter
from pathlib import Path

from .retrieval_schema import canonical, create_dataset, digest, normalized, require, write_jsonl

SCIFACT_URL = "https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz"
SCIFACT_SHA256 = "11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be"


def request_json(url: str, payload: dict | None = None, timeout: float = 60) -> dict:
    req = urllib.request.Request(url, data=canonical(payload) if payload is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def prepare_scifact(destination: Path, cache: Path, *, sentences_per_unit: int = 3):
    require(sentences_per_unit >= 1, "positive sentence window required")
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / "data.tar.gz"
    if not archive.exists():
        with urllib.request.urlopen(SCIFACT_URL, timeout=120) as response:
            blob = response.read(20 * 1024 * 1024 + 1)
        require(len(blob) <= 20 * 1024 * 1024, "unexpected archive size")
        require(hashlib.sha256(blob).hexdigest() == SCIFACT_SHA256, "upstream archive changed; freeze a new dataset version")
        archive.write_bytes(blob)
    blob = archive.read_bytes()
    require(hashlib.sha256(blob).hexdigest() == SCIFACT_SHA256, "cached archive hash mismatch")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in {"corpus.jsonl", "claims_dev.jsonl", "claims_train.jsonl"}:
                files[name] = [json.loads(line) for line in tar.extractfile(member).read().splitlines() if line.strip()]
    require(set(files) == {"corpus.jsonl", "claims_dev.jsonl", "claims_train.jsonl"}, "unexpected archive members")
    sources, original = [], {}
    for doc in files["corpus.jsonl"]:
        sid = "scifact:" + str(doc["doc_id"])
        body = doc["title"] + "\n" + " ".join(doc["abstract"])
        offsets, position = [], len(doc["title"]) + 1
        for sentence in doc["abstract"]:
            offsets.append((position, position + len(sentence)))
            position += len(sentence) + 1
        units = []
        for i in range(0, len(offsets), sentences_per_unit):
            start, end = offsets[i][0], offsets[min(i + sentences_per_unit, len(offsets)) - 1][1]
            units.append({"id": f"{sid}:s{i}", "text": body[start:end], "start_char": start, "end_char": end})
        source = {"id": sid, "text": body, "text_sha256": hashlib.sha256(body.encode()).hexdigest(), "modality": "doc",
                  "metadata": {"title": doc["title"], "original_doc_id": str(doc["doc_id"]), "language": "en"}, "units": units}
        sources.append(source)
        original[sid] = (source, doc, offsets)
    test_claims = files["claims_dev.jsonl"]
    test_queries = {normalized(c["claim"]) for c in test_claims}
    test_docs = {str(d) for c in test_claims for d in c["cited_doc_ids"]}
    dev_claims = [c for c in files["claims_train.jsonl"] if normalized(c["claim"]) not in test_queries
                  and not set(map(str, c["cited_doc_ids"])) & test_docs]
    cases = []
    for split, claims in (("dev", dev_claims), ("test", test_claims)):
        # Source-connected claims share a bootstrap cluster, even if their wording differs.
        parent = {}
        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        for claim in claims:
            ids = sorted(map(str, claim["cited_doc_ids"]))
            for doc_id in ids[1:]:
                a, b = find(ids[0]), find(doc_id)
                parent[max(a, b)] = min(a, b)
        for claim in claims:
            qrels = {"scifact:" + str(d): 3 for d in claim["cited_doc_ids"]}
            alternatives, labels = [], set()
            for raw_id, annotations in claim["evidence"].items():
                sid = "scifact:" + raw_id
                source, doc, offsets = original[sid]
                for annotation in annotations:
                    labels.add(annotation["label"])
                    anchors = []
                    for sentence in annotation["sentences"]:
                        start, end = offsets[sentence]
                        anchors.append({"source_id": sid, "source_sha256": source["text_sha256"],
                                        "quote": doc["abstract"][sentence], "start_char": start, "end_char": end})
                    if anchors:
                        alternatives.append(anchors)
            tags = ["public", "en", "doc", "scientific_claim", "sentence_evidence" if alternatives else "no_rationale_annotation"]
            tags += ["refute" if "CONTRADICT" in labels else "support"] if labels else []
            if len(qrels) > 1:
                tags.append("multiple_relevant_documents")
            cases.append({"id": "scifact-" + str(claim["id"]), "query": claim["claim"], "split": split,
                          "cluster_id": f"scifact-{split}-source-{find(str(claim['cited_doc_ids'][0]))}", "tags": tags,
                          "answerability": "answerable" if alternatives else "unknown", "qrels": qrels,
                          "qrels_complete": False, "evidence_groups": [{"id": "claim_rationale", "alternatives": alternatives}] if alternatives else [],
                          "annotation": {"origin": "SciFact original human annotations", "source_split": "train" if split == "dev" else "dev",
                                         "labels": sorted(labels), "unannotated_rationale_is_not_no_answer": True}})
    return create_dataset(destination, name="scifact-full-corpus-sentence-retrieval", sources=sources, cases=cases, provenance={
        "url": SCIFACT_URL, "sha256": SCIFACT_SHA256, "original_project": "https://github.com/allenai/scifact",
        "license_reference": "https://huggingface.co/datasets/BeIR/scifact", "license": "CC-BY-SA-4.0 (BEIR dataset card)",
        "citation": "Wadden et al., Fact or Fiction: Verifying Scientific Claims, EMNLP 2020",
        "corpus_selection": "all original abstracts", "unit_policy": f"nonoverlapping {sentences_per_unit}-sentence windows; original offsets retained",
        "qrels_policy": "cited document IDs are positive; support and contradiction rationales are both relevant; unknown sources stay unjudged",
        "split_policy": "Original dev claims frozen as evaluation; original train filtered by normalized query and cited source overlap",
        "excluded_train_claims": len(files["claims_train.jsonl"]) - len(dev_claims), "test_claims": len(test_claims),
        "evidence_policy": "One complete annotated rationale is sufficient; sentences within each alternative are jointly required",
        "limits": "English biomedical claim retrieval using custom sentence windows; not an official BEIR/SciFact leaderboard score. No-rationale claims are not labeled unanswerable."})


def snapshot_local(destination: Path, *, base_url: str, qdrant_url: str) -> dict:
    """Read-only HTTP calls. No vectors, uploads, deletion or re-indexing."""
    destination.mkdir(parents=True, exist_ok=False)
    health = request_json(base_url.rstrip("/") + "/health")
    require(health.get("status") == "healthy", "Tessmora health failed")
    catalog = request_json(base_url.rstrip("/") + "/api/knowledge/")
    collections = ["text_chunks_agentic", "image_vectors", "audio_vectors", "video_shot_vectors", "video_keyframe_vectors"]
    inventory, rows = {}, []
    for collection in collections:
        url = qdrant_url.rstrip("/") + "/collections/" + collection
        before = request_json(url)["result"]
        offset = None
        while True:
            body = {"limit": 256, "with_payload": True, "with_vector": False}
            if offset is not None:
                body["offset"] = offset
            batch = request_json(url + "/points/scroll", body)["result"]
            for point in batch["points"]:
                rows.append({"collection": collection, "id": str(point["id"]), "payload": point.get("payload", {})})
            offset = batch.get("next_page_offset")
            if offset is None:
                break
        after = request_json(url)["result"]
        require(before.get("points_count") == after.get("points_count"), f"{collection}: collection changed during snapshot")
        inventory[collection] = {"points_count": after.get("points_count"), "vectors_count": after.get("vectors_count"),
                                 "config": after.get("config"), "status": after.get("status")}
    rows.sort(key=lambda row: (row["collection"], row["id"]))
    write_jsonl(destination / "points.jsonl", rows)
    receipt = {"health": health, "catalog": catalog, "collections": inventory, "point_count": len(rows),
               "payload_sha256": digest(rows), "counts": dict(Counter(r["collection"] for r in rows)),
               "operations": ["GET health", "GET knowledge/", "GET collection metadata", "POST points/scroll (read-only)"],
               "contains_private_data": True, "vectors_copied": False}
    (destination / "snapshot.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    return receipt
