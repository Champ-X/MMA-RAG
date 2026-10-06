"""Independent, read-only retrieval. No legacy planner, reranker or health state."""
from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from dataclasses import replace

from qdrant_client.http import models as qm

from .catalog import SourceCatalog, Source
from .contracts import Evidence
from .policy import AccessScope, ToolError
from .store import fingerprint

COLLECTIONS = {
    "doc": ("text_chunks_agentic", ["dense"]),
    "image": ("image_vectors", ["text_vec"]),
    "audio": ("audio_vectors", ["text_vec"]),
    "video": ("video_shot_vectors", ["caption_dense", "asr_dense"]),
}


def point_text(payload: dict, modality: str) -> str:
    fields = {"doc": ("text_content",), "image": ("caption",),
              "audio": ("description", "transcript"), "video": ("caption", "asr_text")}[modality]
    labels = {"description": "索引描述", "transcript": "转写", "caption": "索引画面描述", "asr_text": "语音转写"}
    parts = []
    for key in fields:
        value = payload.get(key)
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        if value:
            parts.append((labels.get(key, "") + "：" if key in labels else "") + str(value))
    return "\n".join(parts)


def lexical_terms(query):
    terms = re.findall(r"[a-z0-9_]+|[\u3400-\u9fff]+", query.casefold())
    return set(term for token in terms for term in
               ([token] if not re.fullmatch(r"[\u3400-\u9fff]{3,}", token)
                else [token, *(token[i:i + 2] for i in range(len(token) - 1))]))


def evidence_for(source: Source, modality: str, point, *, max_chars=6000, text_offset=0) -> Evidence:
    payload = point.payload or {}
    metadata = payload.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            metadata = {}
    metadata = metadata if isinstance(metadata, dict) else {}
    text = point_text(payload, modality)
    locator = {"point_id": str(point.id), "collection": COLLECTIONS[modality][0]}
    for key in ("chunk_index", "shot_id", "scene_id", "shot_start_time", "shot_end_time"):
        if payload.get(key) is not None:
            locator[key] = payload[key]
    for key in ("page", "page_number", "section_path"):
        if metadata.get(key) is not None:
            locator[key] = metadata[key]
    chunking = metadata.get("chunking") or {}
    if isinstance(chunking, dict):
        for key in ("source_start", "source_end"):
            if key in chunking:
                locator[key] = chunking[key]
    record_version = fingerprint({"object": source.version, "text": text, "locator": locator})
    content = text[text_offset:text_offset + max_chars]
    locator["returned_chars"] = len(content)
    locator["total_chars"] = len(text)
    locator["text_start"] = text_offset
    locator["text_end"] = text_offset + len(content)
    observation = "parsed_text" if modality == "doc" else "transcript" if modality == "audio" else "caption"
    return Evidence(source_id=source.id, modality=modality, file_name=source.name, content=content,
                    version=fingerprint({"object": source.version, "text": text, "locator": locator}),
                    observation=observation, locator=locator,
                    provenance={"kb_id": source.kb_id, "file_id": source.file_id, "source_version": source.version,
                                "index_kb_id": payload.get("kb_id"), "record_version": record_version,
                                "truncated": text_offset > 0 or len(content) < len(text)},
                    citation={"type": source.modality, "file_name": source.name,
                              "debug_info": {"kb_id": source.kb_id, "chunk_id": str(point.id)},
                              **({"start_sec": payload["shot_start_time"]} if "shot_start_time" in payload else {}),
                              **({"end_sec": payload["shot_end_time"]} if "shot_end_time" in payload else {})})


class KnowledgeGateway:
    def __init__(self, catalog: SourceCatalog, scope: AccessScope, client, model_transport, search_gate):
        self.catalog, self.scope, self.client = catalog, scope, client
        self.models, self.search_gate = model_transport, search_gate

    def _filter(self, sources: list[Source], *, extra=None):
        # Empty MatchAny is never used as a wildcard. Callers short-circuit it.
        ids = sorted({s.file_id for s in sources if len(self.catalog.by_file.get(s.file_id, [])) == 1})
        return qm.Filter(must=[qm.Filter(should=[
            qm.FieldCondition(key="file_id", match=qm.MatchAny(any=ids)),
            qm.FieldCondition(key="source_file_id", match=qm.MatchAny(any=ids)),
        ]), *(extra or [])])

    async def _scroll(self, collection, filt, *, maximum=2000):
        points, cursor = [], None
        while len(points) < maximum:
            page, cursor = await self.client.scroll(collection, scroll_filter=filt, offset=cursor,
                limit=min(128, maximum - len(points)), with_payload=True, with_vectors=False)
            points.extend(page)
            if cursor is None:
                break
        return points, cursor is not None

    async def search(self, *, query: str, mode: str, modalities: list[str], knowledge_base_ids: list[str],
                     limit: int, span_id: str, source_ids: list[str] | None = None):
        kbs = self.scope.narrow_kbs(knowledge_base_ids)
        query_scope = self.scope
        if source_ids:
            # Validate the entire selection before storage or embedding I/O.
            # A source readable as input is not necessarily searchable.
            chosen = [self.catalog.get(identity, self.scope, search=True) for identity in dict.fromkeys(source_ids)]
            if any(source.kb_id not in kbs for source in chosen):
                raise ToolError("scope_conflict", "指定来源与本次查询的知识库范围冲突")
            query_scope = replace(self.scope, search_kbs=frozenset(s.kb_id for s in chosen),
                                  search_files=frozenset((s.kb_id, s.file_id) for s in chosen))
        sources = [s for s in self.catalog.visible(query_scope, search=True) if s.kb_id in kbs]
        if not sources:
            return [], {"status": "no_hits", "scope": query_scope.public(), "methods": [], "truncated": False}
        errors, truncated, rankings, records = [], False, [], {}
        async with self.search_gate:
            vector = None
            if mode == "hybrid":
                try:
                    vector = await self.models.embed(query, span_id)
                except ToolError as error:
                    errors.append({"method": "dense", "code": error.code, "message": str(error)})
            for modality in dict.fromkeys(modalities):
                # Documents can also own extracted images.
                selected = [s for s in sources if s.modality == modality or modality == "image" and s.modality == "doc"]
                if not selected:
                    continue
                collection, vectors = COLLECTIONS[modality]
                filt = self._filter(selected)
                try:
                    points, clipped = await self._scroll(collection, filt)
                    truncated |= clipped
                    ranked = []
                    terms = lexical_terms(query)
                    for point in points:
                        source = self.catalog.bind_point(point.payload or {}, query_scope, search=True)
                        if not source or source.kb_id not in kbs:
                            continue
                        text = (source.name + "\n" + point_text(point.payload or {}, modality)).casefold()
                        score = float(query.casefold() in text) * 10
                        if mode != "exact":
                            score += sum(term in text for term in terms) / max(1, len(terms))
                        if score > 0:
                            key = (modality, str(point.id))
                            records[key] = (source, point)
                            ranked.append((score, key))
                    rankings.append([key for _, key in sorted(ranked, key=lambda x: (-x[0], x[1]))[:limit * 3]])
                except Exception as error:
                    # No provider exception strings: they can contain credentials or URLs.
                    errors.append({"method": "lexical", "modality": modality, "code": type(error).__name__,
                                   "message": "该模态索引读取失败"})
                if vector is not None:
                    for using in vectors:
                        try:
                            result = await self.client.query_points(collection, query=vector, using=using,
                                query_filter=filt, limit=limit * 3, with_payload=True, with_vectors=False)
                            ranking = []
                            for point in result.points:
                                source = self.catalog.bind_point(point.payload or {}, query_scope, search=True)
                                if source and source.kb_id in kbs:
                                    key = (modality, str(point.id))
                                    records[key] = (source, point)
                                    ranking.append(key)
                            rankings.append(ranking)
                        except Exception as error:
                            errors.append({"method": "dense", "modality": modality, "code": type(error).__name__,
                                           "message": "该模态向量检索失败"})
        scores = defaultdict(float)
        for ranking in rankings:
            for rank, key in enumerate(ranking):
                scores[key] += 1 / (60 + rank + 1)
        keys = sorted(scores, key=lambda key: (-scores[key], key))[:limit]
        evidence = [evidence_for(records[k][0], k[0], records[k][1], max_chars=1400) for k in keys]
        if not evidence and errors and not rankings:
            raise ToolError("search_unavailable", "搜索服务未能完成查询，请稍后重试；这不代表没有相关内容", retryable=True)
        return evidence, {"status": "partial" if errors or truncated else "ok" if evidence else "no_hits",
                          "methods": ["exact" if mode == "exact" else "lexical", *(["dense"] if vector is not None else [])],
                          "errors": errors, "truncated": truncated, "scanned_point_limit_per_modality": 2000,
                          "scope": query_scope.public()}

    async def read(self, source: Source, *, start: int, limit: int, modality: str | None = None,
                   text_offset: int = 0, expected_record_version: str | None = None):
        if (text_offset or expected_record_version) and limit != 1:
            raise ToolError("ambiguous_text_offset", "续读单个索引片段时必须设置 limit=1")
        if source.attachment:
            raise ToolError("use_media_tool", "请使用 inspect_media 读取本机媒体附件")
        kind = modality or source.modality
        extra = [qm.FieldCondition(key="chunk_index", range=qm.Range(gte=start, lt=start + limit))] if kind == "doc" else []
        points, clipped = await self._scroll(COLLECTIONS[kind][0], self._filter([source], extra=extra), maximum=1000)
        points = [p for p in points if self.catalog.bind_point(p.payload or {}, self.scope) == source]
        if kind == "doc":
            points.sort(key=lambda p: (p.payload or {}).get("chunk_index", 0))
            selected = points[:limit]
            # A count distinguishes final chunks from gaps; no unscoped fallback.
            count = await self.client.count(COLLECTIONS[kind][0], count_filter=self._filter([source]), exact=True)
            remaining = await self.client.count(COLLECTIONS[kind][0], count_filter=self._filter([source], extra=[
                qm.FieldCondition(key="chunk_index", range=qm.Range(gte=start + limit))]), exact=True)
            has_more = remaining.count > 0
            total = count.count
        else:
            points.sort(key=lambda p: ((p.payload or {}).get("shot_start_time", 0), str(p.id)))
            selected = points[start:start + limit]
            total = len(points)
            has_more = start + limit < total or clipped
        if text_offset and selected and text_offset >= len(point_text(selected[0].payload or {}, kind)):
            raise ToolError("text_offset_out_of_range", "续读位置超出当前索引片段，请从 text_offset=0 重新读取并核对来源版本")
        observations = [evidence_for(source, kind, p, max_chars=max(1000, 12000 // max(1, limit)),
                                     text_offset=text_offset) for p in selected]
        if expected_record_version and observations and observations[0].provenance["record_version"] != expected_record_version:
            raise ToolError("index_record_changed", "索引片段版本已改变，请从头读取，不能将不同版本的文字拼接为同一原文")
        continuations = [{"source_id": source.id,
                          "start": evidence.locator["chunk_index"] if kind == "doc" else start + index,
                          "limit": 1, "text_offset": evidence.locator["text_end"],
                          "expected_record_version": evidence.provenance["record_version"]}
                         for index, evidence in enumerate(observations)
                         if evidence.locator["text_end"] < evidence.locator["total_chars"]]
        return observations, {
            "source": source.public(self.scope), "total_index_records": total,
            "next_start": start + limit if has_more else None, "truncated": clipped,
            "text_continuations": continuations,
            "status": "ok" if selected else "no_index_content",
        }
