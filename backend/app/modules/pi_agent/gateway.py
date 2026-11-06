"""Independent, read-only retrieval. No legacy planner, reranker or health state."""
from __future__ import annotations

from .language import translate_prompt

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
from .payloads import source_navigation
from .text_origins import document_text_origin, TEXT_ORIGIN_VERSION
from .query_vectors import LocalQueryVectors, QueryVectorUnavailable

COLLECTIONS = {
    "doc": ("text_chunks_agentic", ["dense"]),
    "image": ("image_vectors", ["text_vec"]),
    "audio": ("audio_vectors", ["text_vec"]),
    "video": ("video_shot_vectors", ["caption_dense", "asr_dense"]),
}
SPARSE_VECTORS = {"doc": ("sparse",), "audio": ("sparse",), "video": ("caption_sparse", "asr_sparse")}
NATIVE_VECTORS = {"image": ("clip", "clip_vec"), "audio": ("clap", "clap_vec")}


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


def distinct_sources(keys, records):
    seen, selected = set(), []
    for key in keys:
        identity = records[key][0].id
        if identity not in seen:
            seen.add(identity)
            selected.append(key)
    return selected


def evidence_for(source: Source, modality: str, point, *, max_chars=6000, text_offset=0,
                 annotate_text_origins=False) -> Evidence:
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
    for key in ("chunk_index", "shot_id", "scene_id", "shot_start_time", "shot_end_time", "duration_seconds"):
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
    origin_version = {"text_origin_version": TEXT_ORIGIN_VERSION} if annotate_text_origins and modality == "doc" else {}
    record_version = fingerprint({"object": source.version, "text": text, "locator": locator, **origin_version})
    content = text[text_offset:text_offset + max_chars]
    origin = {"text_origin": document_text_origin(text, text_offset, len(content))} if origin_version else {}
    locator["returned_chars"] = len(content)
    locator["total_chars"] = len(text)
    locator["text_start"] = text_offset
    locator["text_end"] = text_offset + len(content)
    observation = "parsed_text" if modality == "doc" else "transcript" if modality == "audio" else "caption"
    return Evidence(source_id=source.id, modality=modality, file_name=source.name, content=content,
                    version=fingerprint({"object": source.version, "text": text, "locator": locator, **origin_version}),
                    observation=observation, locator=locator,
                    provenance={"kb_id": source.kb_id, "file_id": source.file_id, "source_version": source.version,
                                "index_kb_id": payload.get("kb_id"), "record_version": record_version,
                                "truncated": text_offset > 0 or len(content) < len(text),
                                "content_types": [kind for field, kind in {
                                    "text_content": "parsed_text", "caption": "indexed_visual_description",
                                    "description": "indexed_audio_description", "transcript": "indexed_transcript",
                                    "asr_text": "indexed_asr_transcript"}.items()
                                    if payload.get(field) and field in {
                                        "doc": {"text_content"}, "image": {"caption"},
                                        "audio": {"description", "transcript"}, "video": {"caption", "asr_text"}}[modality]], **origin},
                    citation={"type": source.modality, "file_name": source.name,
                              "debug_info": {"kb_id": source.kb_id, "chunk_id": str(point.id)},
                              **({"start_sec": payload["shot_start_time"]} if "shot_start_time" in payload else {}),
                              **({"end_sec": payload["shot_end_time"]} if "shot_end_time" in payload else {})})


class KnowledgeGateway:
    def __init__(self, catalog: SourceCatalog, scope: AccessScope, client, model_transport, search_gate, *,
                 annotate_text_origins=False, local_vectors=None):
        self.catalog, self.scope, self.client = catalog, scope, client
        self.models, self.search_gate = model_transport, search_gate
        self.annotate_text_origins = annotate_text_origins
        settings = getattr(model_transport, "settings", None)
        self.search_channels = max(1, int(getattr(settings, "max_concurrent_search_channels", 2)))
        self.channel_gate = asyncio.Semaphore(self.search_channels)
        self.local_vectors = local_vectors or LocalQueryVectors()

    def _evidence(self, source: Source, modality: str, point, **kwargs) -> Evidence:
        parent = self.catalog.parent_document(point.payload or {}, self.scope) if modality == "image" else None
        link = parent.public(self.scope) if parent else None
        if link:
            # Navigation shares the existing excerpt allowance. Otherwise eight
            # long image hits can overflow a tool result that previously fitted.
            navigation_chars = len(json.dumps({"parent_document": link}, ensure_ascii=False))
            allowance = kwargs.get("max_chars", 6000)
            if navigation_chars < allowance:
                kwargs["max_chars"] = allowance - navigation_chars
            else:
                link = None  # Oversized display metadata is optional navigation.
        evidence = evidence_for(source, modality, point, annotate_text_origins=self.annotate_text_origins, **kwargs)
        if link:
            evidence.provenance["parent_document"] = link
            # Keep the image observation intact. A changed navigation binding
            # must not be merged with old evidence or spliced into a continuation.
            evidence.version = fingerprint({"observation": evidence.version, "parent_document": link})
            evidence.provenance["record_version"] = fingerprint({
                "record": evidence.provenance["record_version"], "parent_document": link})
        return evidence

    def _filter(self, sources: list[Source], *, extra=None):
        # Empty MatchAny is never used as a wildcard. Callers short-circuit it.
        ids = sorted({s.file_id for s in sources if len(self.catalog.by_file.get(s.file_id, [])) == 1})
        return qm.Filter(must=[qm.Filter(should=[
            qm.FieldCondition(key="file_id", match=qm.MatchAny(any=ids)),
            qm.FieldCondition(key="source_file_id", match=qm.MatchAny(any=ids)),
        ]), *(extra or [])])

    async def _scroll(self, collection, filt):
        points, cursor = [], None
        while True:
            page, cursor = await self.client.scroll(collection, scroll_filter=filt, offset=cursor,
                limit=128, with_payload=True, with_vectors=False)
            points.extend(page)
            if cursor is None:
                break
        return points, cursor is not None

    async def search(self, *, query: str, mode: str, modalities: list[str], knowledge_base_ids: list[str],
                     limit: int, span_id: str, source_ids: list[str] | None = None, result_unit="passage",
                     retrieval_strategy="text"):
        if retrieval_strategy not in {"text", "native"}:
            raise ToolError("invalid_search_strategy", translate_prompt("未知检索策略"))
        kbs = self.scope.narrow_kbs(knowledge_base_ids)
        query_scope = self.scope
        if source_ids:
            # Validate the entire selection before storage or embedding I/O.
            # A source readable as input is not necessarily searchable.
            chosen = [self.catalog.get(identity, self.scope, search=True) for identity in dict.fromkeys(source_ids)]
            if any(source.kb_id not in kbs for source in chosen):
                raise ToolError("scope_conflict", translate_prompt("指定来源与本次查询的知识库范围冲突"))
            query_scope = replace(self.scope, search_kbs=frozenset(s.kb_id for s in chosen),
                                  search_files=frozenset((s.kb_id, s.file_id) for s in chosen))
        sources = [s for s in self.catalog.visible(query_scope, search=True) if s.kb_id in kbs]
        if not sources:
            return [], {"status": "no_hits", "scope": query_scope.public(), "methods": [], "truncated": False}
        errors, fallbacks, rankings, records, methods = [], [], [], {}, []
        performance = {"index_requests": 0, "scroll_requests": 0, "scanned_points": 0,
                       "query_requests": 0, "count_requests": 0, "capability_requests": 0,
                       "max_concurrent_channels": self.search_channels}

        async def request(operation, *args, **kwargs):
            async with self.channel_gate:
                performance["index_requests"] += 1
                performance[{"scroll": "scroll_requests", "query_points": "query_requests", "query_points_groups": "query_requests",
                             "count": "count_requests", "get_collection": "capability_requests"}[operation]] += 1
                return await getattr(self.client, operation)(*args, **kwargs)

        async def scan(collection, filt):
            points, cursor = [], None
            while True:
                page, cursor = await request("scroll", collection, scroll_filter=filt, offset=cursor,
                    limit=128, with_payload=True, with_vectors=False)
                performance["scanned_points"] += len(page)
                points.extend(page)
                if cursor is None:
                    return points

        def bind(points, modality):
            bound = {}
            for point in points:
                source = self.catalog.bind_point(point.payload or {}, query_scope, search=True)
                if source and source.kb_id in kbs:
                    bound[(modality, str(point.id))] = (source, point)
            return bound

        def lexical(points, modality):
            bound, ranked = bind(points, modality), []
            terms = lexical_terms(query)
            for key, (source, point) in bound.items():
                text = (source.name + "\n" + point_text(point.payload or {}, modality)).casefold()
                score = float(query.casefold() in text) * 10
                if mode != "exact":
                    score += sum(term in text for term in terms) / max(1, len(terms))
                if score > 0:
                    ranked.append((score, key))
            ordered = [key for _, key in sorted(ranked, key=lambda item: (-item[0], item[1]))]
            if result_unit == "source":
                ordered = distinct_sources(ordered, bound)
            return bound, ordered[:limit * 3]

        async def vector_query(collection, filt, modality, using, vector, method):
            try:
                if result_unit == "source" and modality != "image" and callable(getattr(self.client, "query_points_groups", None)):
                    # A long document must not consume the entire candidate
                    # window before source deduplication. Extracted images keep
                    # their lexical route because file_id can name a child.
                    result = await request("query_points_groups", collection, group_by="file_id", group_size=1,
                        query=vector, using=using, query_filter=filt, limit=limit * 3,
                        with_payload=True, with_vectors=False)
                    points = [point for group in result.groups for point in group.hits]
                else:
                    result = await request("query_points", collection, query=vector, using=using,
                        query_filter=filt, limit=limit * 3, with_payload=True, with_vectors=False)
                    points = result.points
                bound = bind(points, modality)
                # Preserve provider rank, but never trust it to enforce scope.
                return bound, list(bound), None, method
            except Exception as error:
                return {}, [], {"method": method, "modality": modality, "code": type(error).__name__,
                    "message": translate_prompt("该模态向量检索失败")}, method

        async def capabilities(collection):
            if not callable(getattr(self.client, "get_collection", None)):
                return None
            try:
                info = await request("get_collection", collection)
                return info.config.params
            except Exception:
                # Capability inspection failing does not disable the established
                # text routes. Never guess that an unseen native vector exists.
                return None

        async def local_vector(kind):
            # Local inference has the same bounded channel admission as index
            # work. Its own cache merges repeated exact queries within this run.
            async with self.channel_gate:
                try:
                    return await self.local_vectors.encode(kind, query)
                except QueryVectorUnavailable:
                    raise
                except Exception:
                    raise QueryVectorUnavailable("local_encoding_failed") from None

        async def modality_search(modality, selected, dense_vector):
            collection, dense_names = COLLECTIONS[modality]
            filt = self._filter(selected)
            local_errors, local_fallbacks, local_rankings, local_records, local_methods = [], [], [], {}, []
            dense_tasks = []
            if dense_vector is not None:
                dense_tasks = [asyncio.create_task(vector_query(collection, filt, modality, name, dense_vector, "dense"))
                               for name in dense_names]
            try:
                params = await capabilities(collection) if mode == "hybrid" else None
                sparse_names = [name for name in SPARSE_VECTORS.get(modality, ())
                                if name in (getattr(params, "sparse_vectors", None) or {})]
                sparse_ok = False
                if mode == "hybrid" and SPARSE_VECTORS.get(modality):
                    if not sparse_names:
                        local_fallbacks.append({"method": "sparse", "modality": modality,
                            "code": "sparse_index_unavailable", "fallback": "lexical"})
                    else:
                        try:
                            sparse = await local_vector("sparse")
                            sparse_vector = qm.SparseVector(indices=list(sparse), values=list(sparse.values()))
                            results = await asyncio.gather(*(vector_query(collection, filt, modality, name, sparse_vector, "sparse")
                                                             for name in sparse_names))
                            for bound, ranking, error, method in results:
                                if error:
                                    local_errors.append(error)
                                else:
                                    local_records.update(bound); local_rankings.append(ranking); local_methods.append(method)
                            # Any failed channel restores the complete lexical
                            # route, including content lacking that sparse view.
                            sparse_ok = all(error is None for _, _, error, _ in results)
                            if not sparse_ok:
                                local_fallbacks.append({"method": "sparse", "modality": modality,
                                    "code": "sparse_query_failed", "fallback": "lexical"})
                        except QueryVectorUnavailable as error:
                            local_fallbacks.append({"method": "sparse", "modality": modality,
                                "code": error.code, "fallback": "lexical"})

                scan_filter = filt
                if sparse_ok:
                    # Some ingestion paths intentionally allow absent sparse
                    # vectors. Query that uncovered subset, never assume a named
                    # vector means every source has actually been indexed.
                    missing = qm.Filter(must=[filt], must_not=[qm.Filter(must=[
                        qm.HasVectorCondition(has_vector=name) for name in SPARSE_VECTORS[modality]])])
                    try:
                        missing_count = (await request("count", collection, count_filter=missing, exact=True)).count
                        name_terms = lexical_terms(query)
                        named_sources = [source for source in selected if query.casefold() in source.name.casefold()
                                         or any(term in source.name.casefold() for term in name_terms)]
                        filters = ([missing] if missing_count else []) + ([self._filter(named_sources)] if named_sources else [])
                        scan_filter = qm.Filter(must=[filt], should=filters) if filters else None
                        if missing_count:
                            local_fallbacks.append({"method": "sparse", "modality": modality,
                                "code": "sparse_coverage_incomplete", "fallback": "lexical_missing_vectors",
                                "uncovered_points": missing_count})
                    except Exception:
                        local_fallbacks.append({"method": "sparse", "modality": modality,
                            "code": "sparse_coverage_unverified", "fallback": "lexical"})
                if scan_filter is not None:
                    try:
                        bound, ranking = lexical(await scan(collection, scan_filter), modality)
                        local_records.update(bound); local_rankings.append(ranking)
                        local_methods.append("exact" if mode == "exact" else "lexical")
                    except Exception as error:
                        local_errors.append({"method": "lexical", "modality": modality, "code": type(error).__name__,
                                             "message": translate_prompt("该模态索引读取失败")})

                if mode == "hybrid" and retrieval_strategy == "native" and modality in NATIVE_VECTORS:
                    kind, name = NATIVE_VECTORS[modality]
                    vectors = getattr(params, "vectors", None)
                    specification = vectors.get(name) if isinstance(vectors, dict) else None
                    try:
                        if specification is None:
                            raise QueryVectorUnavailable("native_index_unavailable")
                        native = await local_vector(kind)
                        if len(native) != getattr(specification, "size", None):
                            raise QueryVectorUnavailable("native_vector_dimension_mismatch")
                        bound, ranking, error, method = await vector_query(collection, filt, modality, name, native, kind)
                        if error:
                            local_errors.append(error)
                            raise QueryVectorUnavailable("native_query_failed")
                        local_records.update(bound); local_rankings.append(ranking); local_methods.append(method)
                    except QueryVectorUnavailable as error:
                        local_fallbacks.append({"method": kind, "modality": modality, "code": error.code,
                                                "fallback": "text"})
                elif mode == "hybrid" and retrieval_strategy == "native" and modality == "video":
                    local_fallbacks.append({"method": "native", "modality": modality,
                        "code": "native_video_not_supported", "fallback": "text"})
                for bound, ranking, error, method in await asyncio.gather(*dense_tasks):
                    if error:
                        local_errors.append(error)
                    else:
                        local_records.update(bound); local_rankings.append(ranking); local_methods.append(method)
                return local_records, local_rankings, local_errors, local_fallbacks, local_methods
            finally:
                for task in dense_tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*dense_tasks, return_exceptions=True)
        # Yield before acquiring the shared search slot, never while holding it.
        settings = getattr(self.models, "settings", None)
        if settings and settings.yield_to_legacy:
            from .admission import legacy_activity
            await legacy_activity.wait(self.models.emit, parent_span_id=span_id, resource="search",
                max_wait_seconds=getattr(settings, "legacy_priority_grace_seconds", 1.0))
        async with self.search_gate:
            vector = None
            if mode == "hybrid":
                try:
                    vector = await self.models.embed(query, span_id)
                except ToolError as error:
                    errors.append({"method": "dense", "code": error.code, "message": str(error)})
            tasks = []
            for modality in dict.fromkeys(modalities):
                selected = [s for s in sources if s.modality == modality or modality == "image" and s.modality == "doc"]
                if selected:
                    tasks.append(asyncio.create_task(modality_search(modality, selected, vector)))
            try:
                # gather preserves declared modality order regardless of network
                # completion order, so RRF and tie breaking remain reproducible.
                for bound, ranked, failures, degraded, used_methods in await asyncio.gather(*tasks):
                    records.update(bound); rankings.extend(ranked); errors.extend(failures)
                    fallbacks.extend(degraded); methods.extend(used_methods)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        scores = defaultdict(float)
        for ranking in rankings:
            for rank, key in enumerate(ranking):
                scores[key] += 1 / (60 + rank + 1)
        keys = sorted(scores, key=lambda key: (-scores[key], key))
        if result_unit == "source":
            keys = distinct_sources(keys, records)
        keys = keys[:limit]
        evidence = [self._evidence(records[k][0], k[0], records[k][1], max_chars=1400) for k in keys]
        if not evidence and errors and not rankings:
            raise ToolError("search_unavailable", translate_prompt("搜索服务未能完成查询，请稍后重试；这不代表没有相关内容"), retryable=True)
        native_degraded = any(item["fallback"] == "text" for item in fallbacks)
        return evidence, {"status": "partial" if errors or native_degraded else "ok" if evidence else "no_hits",
                          "methods": list(dict.fromkeys(methods)),
                          "errors": errors, "truncated": False, "retrieval_strategy": retrieval_strategy,
                          "fallbacks": fallbacks, "performance": performance,
                          "result_unit": result_unit,
                          "returned_source_count": len({e.source_id for e in evidence}),
                          "scope": query_scope.public()}

    async def read(self, source: Source, *, start: int, limit: int, modality: str | None = None,
                   text_offset: int = 0, expected_record_version: str | None = None, excerpt_chars: int | None = None):
        if (text_offset or expected_record_version) and limit != 1:
            raise ToolError("ambiguous_text_offset", translate_prompt("续读单个索引片段时必须设置 limit=1"))
        if source.attachment:
            raise ToolError("use_media_tool", translate_prompt("请使用 inspect_media 读取本机媒体附件"))
        kind = modality or source.modality
        extra = [qm.FieldCondition(key="chunk_index", range=qm.Range(gte=start, lt=start + limit))] if kind == "doc" else []
        points, clipped = await self._scroll(COLLECTIONS[kind][0], self._filter([source], extra=extra))
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
            raise ToolError("text_offset_out_of_range", translate_prompt("续读位置超出当前索引片段，请从 text_offset=0 重新读取并核对来源版本"))
        observations = [self._evidence(source, kind, p, max_chars=excerpt_chars or max(1000, 12000 // max(1, limit)),
                                     text_offset=text_offset) for p in selected]
        if expected_record_version and observations and observations[0].provenance["record_version"] != expected_record_version:
            raise ToolError("index_record_changed", translate_prompt("索引片段版本已改变，请从头读取，不能将不同版本的文字拼接为同一原文"))
        continuations = [{"source_id": source.id,
                          "start": evidence.locator["chunk_index"] if kind == "doc" else start + index,
                          "limit": 1, "text_offset": evidence.locator["text_end"],
                          "expected_record_version": evidence.provenance["record_version"]}
                         for index, evidence in enumerate(observations)
                         if evidence.locator["text_end"] < evidence.locator["total_chars"]]
        return observations, {
            "source": source_navigation(source, self.scope), "total_index_records": total,
            "next_start": start + limit if has_more else None, "truncated": clipped,
            "text_continuations": continuations,
            "status": "ok" if selected else "no_index_content",
        }

    async def overview(self, source: Source, *, start: int, limit: int,
                       text_offset: int = 0, expected_record_version: str | None = None):
        """A paged, verbatim index preview; no new media inference or summary."""
        if text_offset or expected_record_version:
            raise ToolError("invalid_overview", translate_prompt("索引概览不接受片段续读参数，请使用content视图续读原文。"))
        evidence, result = await self.read(source, start=start, limit=limit, excerpt_chars=400)
        return evidence, {**result, "view": "overview", "preview_only": True,
                          "direct_media_observation": False,
                          "navigation": [{"source_id": source.id, "start":
                              item.locator.get("chunk_index", start + index), "limit": 1,
                              "view": "content", "locator": item.locator}
                              for index, item in enumerate(evidence)]}
