"""Existing multimodal data: immutable snapshots and real read-only search API."""
from __future__ import annotations

import asyncio
import hashlib
import json
import string
from collections import defaultdict
from pathlib import Path

from .retrieval_data import request_json
from .retrieval_schema import create_dataset, digest, normalized, read_jsonl, require


def canonical_kb(raw: str, known: set[str]) -> str:
    if raw in known:
        return raw
    # Same documented legacy sanitization as pi_agent.catalog.index_kb_matches.
    legacy = "".join(c for c in raw.lower().replace("_", "-") if c in string.ascii_lowercase + "0-9-").strip("-")
    require(legacy in known, f"index knowledge base has no current catalog identity: {raw}")
    return legacy


def payload_content(collection: str, payload: dict) -> str:
    if collection == "text_chunks_agentic":
        return payload.get("text_content") or payload.get("text") or ""
    if collection == "image_vectors":
        return payload.get("caption") or payload.get("description") or ""
    if collection == "audio_vectors":
        transcript, description = (str(payload.get(k) or "").strip() for k in ("transcript", "description"))
        return f"转写：{transcript}\n描述：{description}" if transcript and description and transcript != description else transcript or description
    parts = []
    for label, keys in (("场景", ("scene_summary",)), ("画面", ("caption", "shot_caption", "frame_description")), ("语音", ("asr_text",))):
        value = next((str(payload[k]).strip() for k in keys if payload.get(k)), "")
        if value:
            parts.append(f"{label}：{value}")
    return "\n".join(parts)


def local_sources(snapshot: Path) -> list[dict]:
    receipt = json.loads((snapshot / "snapshot.json").read_text())
    rows = read_jsonl(snapshot / "points.jsonl")
    require(digest(rows) == receipt["payload_sha256"], "snapshot payload changed")
    catalog = receipt["catalog"]["knowledge_bases"]
    known = {kb["id"] for kb in catalog}
    grouped = defaultdict(list)
    for row in rows:
        payload = row["payload"]
        content = payload_content(row["collection"], payload)
        if not content.strip():
            continue
        kb = canonical_kb(payload["kb_id"], known)
        file_id = payload.get("file_id")
        require(bool(file_id), "index point lacks source identity")
        grouped[(kb, file_id)].append((row, content))
    sources = []
    for (kb, file_id), group in sorted(grouped.items()):
        group.sort(key=lambda pair: (pair[0]["payload"].get("chunk_index", 0), pair[0]["payload"].get("shot_start_time", 0), pair[0]["collection"], pair[0]["id"]))
        collection = group[0][0]["collection"]
        modality = {"text_chunks_agentic": "doc", "image_vectors": "image", "audio_vectors": "audio"}.get(collection, "video")
        payload = group[0][0]["payload"]
        path = payload.get("file_path", "")
        units, chunks, offset = [], [], 0
        for row, content in group:
            unit = {"id": row["collection"] + ":" + row["id"], "original_point_id": row["id"], "collection": row["collection"],
                    "text": content, "start_char": offset, "end_char": offset + len(content)}
            p = row["payload"]
            # Preserve the exact Pi gateway serialization from these same frozen fields.
            # This is an alternate presentation, never a new model-generated observation.
            fields = {"doc": ("text_content",), "image": ("caption",), "audio": ("description", "transcript"), "video": ("caption", "asr_text")}[modality]
            labels = {"description": "索引描述", "transcript": "转写", "caption": "索引画面描述", "asr_text": "语音转写"}
            parts = []
            for key in fields:
                value = p.get(key)
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False)
                if value:
                    parts.append((labels.get(key, "") + "：" if key in labels else "") + str(value))
            if parts:
                unit["renderings"] = {"pi_gateway_v1": "\n".join(parts)}
            start = p.get("shot_start_time", p.get("start_time"))
            end = p.get("shot_end_time", p.get("end_time"))
            if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start >= 0:
                unit.update(start_seconds=start, end_seconds=end)
            metadata = p.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except ValueError:
                    metadata = {}
            page = next((v for v in (p.get("page"), p.get("page_number"), metadata.get("page"), metadata.get("page_number")) if isinstance(v, int) and not isinstance(v, bool)), None)
            if page is not None:
                unit["page"] = page
            units.append(unit)
            chunks.append(content)
            offset += len(content) + 2
        body = "\n\n".join(chunks)
        sources.append({"id": f"local:{kb}:{file_id}", "modality": modality, "text": body,
                        "text_sha256": hashlib.sha256(body.encode()).hexdigest(), "units": units,
                        "metadata": {"kb_id": kb, "file_id": file_id, "file_path": path, "title": path.rsplit("/", 1)[-1],
                                     "index_kb_ids": sorted({r["payload"]["kb_id"] for r, _ in group}),
                                     "evidence_origin": "existing parsed text" if modality == "doc" else "existing generated caption/transcript; original-media perception not certified"}})
    return sources


def prepare_local(snapshot: Path, annotations: Path, destination: Path):
    sources = local_sources(snapshot)
    cases = read_jsonl(annotations)
    receipt = json.loads((snapshot / "snapshot.json").read_text())
    return create_dataset(destination, name="tessmora-local-multimodal-retrieval", sources=sources, cases=cases, provenance={
        "snapshot_payload_sha256": receipt["payload_sha256"], "annotation_sha256": hashlib.sha256(annotations.read_bytes()).hexdigest(),
        "contains_private_data": True, "snapshot_operations": receipt["operations"],
        "limits": "Evidence retrieval over existing parsed/indexed content. Generated captions and ASR are not independently verified original-media truth. Authored source-grounded cases are not human-blind gold labels."})


class LocalAPIRetriever:
    def __init__(self, dataset, *, base_url: str, timeout_seconds: float = 180):
        self.dataset = dataset
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout_seconds
        self.known_kbs = {s["metadata"]["kb_id"] for s in dataset.sources.values()}
        from .source_resolution import FrozenEvidenceResolver
        self.resolver = FrozenEvidenceResolver(dataset)
        health = request_json(self.base_url + "/health")
        require(health.get("status") == "healthy", "Tessmora is not healthy")
        model_response = request_json(self.base_url + "/api/chat/models")
        # Public API schemas differ across releases; preserve only task route fields.
        routes = model_response.get("current_config") or model_response.get("task_config") or model_response.get("current_task_config")
        require(isinstance(routes, dict), "task model routes unavailable; cannot freeze configuration")
        self.configuration = {"backend": "tessmora_http", "profile": "direct", "api": "/api/v1/retrieval/search",
                              "model_stack": routes, "snapshot": dataset.manifest["provenance"]["snapshot_payload_sha256"],
                              "service_version": health.get("version"), "timing_scope": "Actual complete retrieval HTTP request, including rewrite/routing/search/rerank",
                              "limits": "Native server candidate/final limits retained; requested top_k is an output ceiling, not a guarantee of 50 candidates"}

    def _hit(self, raw: dict) -> dict:
        metadata = raw["source"]
        kb = canonical_kb(str(metadata["knowledge_base_id"]), self.known_kbs)
        return self.resolver.resolve(raw, canonical_kb_id=kb)

    async def search(self, case: dict, top_k: int) -> dict:
        scope = case.get("scope", {})
        body = {"query": case["query"], "knowledge_base_ids": scope.get("kb_ids", []), "top_k": min(top_k, 50),
                "modalities": scope.get("modalities", [])}
        if scope.get("source_ids"):
            body["selected_files"] = [{"kb_id": self.dataset.sources[sid]["metadata"]["kb_id"], "file_id": self.dataset.sources[sid]["metadata"]["file_id"]} for sid in scope["source_ids"]]
        response = await asyncio.to_thread(request_json, self.base_url + "/api/v1/retrieval/search", body, self.timeout)
        return {"hits": [self._hit(raw) for raw in response["results"]],
                "diagnostics": {key: response.get(key) for key in ("refined_query", "intent_type", "processing_time", "target_knowledge_bases")},
                "usage": {"known_tokens": 0, "unknown_usage_calls": 0, "unreported_task_usage": True}}
