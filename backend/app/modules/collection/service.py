"""Bounded discovery and durable per-material ingestion orchestration.

One process owns each state directory. The lifetime file lock must be acquired
before recovery, so a second API worker cannot interrupt or resume live writes.
Deploy with one API worker per state directory; shared multi-worker execution
requires an external worker/queue rather than multiple in-process supervisors.
"""
from __future__ import annotations

import asyncio
import fcntl
import hashlib
import inspect
import json
import re
import time
import uuid
from pathlib import Path

from .models import ACTIVE_STATUSES, Candidate, CreateRun, public_run
from .store import CollectionConflict, CollectionNotFound, CollectionStore, canonical_url, now

MAX_SEARCH_CALLS = 4
MAX_TOTAL_BYTES = 50 * 1024 * 1024
MAX_ITEM_BYTES = 20 * 1024 * 1024
MAX_CANDIDATES = 40
RANK_WINDOW = 30


class CollectionExecutionError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


async def resolve(value):
    return await value if inspect.isawaitable(value) else value


class CollectionService:
    def __init__(self, store=None, *, providers=None, planner=None, bridge=None, kb_check=None,
                 poll_interval=1.0, processing_timeout=900, max_total_bytes=MAX_TOTAL_BYTES):
        if store is None:
            from app.core.runtime_paths import backend_data_dir
            store = CollectionStore(backend_data_dir() / "collection" / "runs.sqlite3")
        self.store = store
        self._supervisor_lock = store.path.with_suffix(".supervisor.lock").open("a")
        try:
            fcntl.flock(self._supervisor_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._supervisor_lock.close()
            raise CollectionConflict("已有服务进程持有采集任务账本；请使用单个 API worker，或为独立实例配置不同状态目录。") from None
        self.providers, self.planner, self.bridge = providers, planner, bridge
        self.kb_check = kb_check
        self.poll_interval, self.processing_timeout = poll_interval, processing_timeout
        self.max_total_bytes = max_total_bytes
        self.jobs = {}
        self.owned_ingestions = set()
        self.lock = asyncio.Lock()
        self.ingestion_lock = asyncio.Lock()
        self.closed = False
        try:
            self.store.recover()
        except BaseException:
            self._supervisor_lock.close()
            raise

    def dependencies(self):
        if self.providers is None:
            from . import providers
            self.providers = providers
        if self.planner is None:
            from . import planner
            self.planner = planner
        if self.bridge is None:
            from . import ingestion_bridge
            self.bridge = ingestion_bridge

    async def validate_kb(self, kb_id):
        if self.kb_check:
            exists = await resolve(self.kb_check(kb_id))
        else:
            from app.modules.knowledge.service import KnowledgeBaseService
            exists = await KnowledgeBaseService().get_knowledge_base_metadata(kb_id)
        if not exists:
            raise CollectionNotFound("目标素材空间不存在")

    async def capabilities(self):
        self.dependencies()
        return {"channels": await resolve(self.providers.capabilities()), "limits": {
            "max_items": 20, "max_search_calls": MAX_SEARCH_CALLS,
            "max_total_bytes": self.max_total_bytes, "max_item_bytes": MAX_ITEM_BYTES}}

    async def create(self, request: CreateRun):
        if self.closed:
            raise CollectionConflict("采集服务正在停止")
        await self.validate_kb(request.kb_id)
        async with self.lock:
            run, created = self.store.create(request.model_dump())
            if created:
                self.launch(run["id"], self.discover_run)
            return public_run(run)

    async def get(self, run_id):
        return public_run(self.store.get(run_id))

    async def list(self, kb_id):
        await self.validate_kb(kb_id)
        return {"runs": [public_run(run) for run in self.store.list(kb_id)]}

    def launch(self, run_id, operation):
        if run_id in self.jobs:
            raise CollectionConflict("任务正在执行")
        task = asyncio.create_task(self.run_guard(run_id, operation), name=f"collection:{run_id}")
        self.jobs[run_id] = task
        task.add_done_callback(lambda finished: self.jobs.pop(run_id, None))

    async def run_guard(self, run_id, operation):
        try:
            self.dependencies()
            await operation(run_id)
        except asyncio.CancelledError:
            run = self.store.get(run_id)
            if run["status"] != "cancelled":
                self.store.update(run_id, status="interrupted", message="采集已中断，可从已保存进度继续。")
            raise
        except Exception as error:
            run = self.store.get(run_id)
            if run["status"] not in {"cancelled", "interrupted"}:
                self.store.update(run_id, status="failed", message=self.error_message(error),
                                  error_code=getattr(error, "code", "collection_failed"))

    @staticmethod
    def error_message(error):
        # Adapters expose intentionally sanitized messages, never raw httpx URLs.
        from .providers import CollectionProviderError
        if isinstance(error, CollectionProviderError):
            return error.message[:500]
        if isinstance(error, (ValueError, CollectionConflict, CollectionNotFound)):
            return str(error)[:500]
        return "采集服务暂时不可用，已保存进度；请稍后重试。"

    def active(self, run_id):
        return not self.closed and self.store.get(run_id)["status"] not in {"cancelled", "interrupted"}

    def warnings(self, run_id, messages):
        run = self.store.get(run_id)
        self.store.update(run_id, warnings=list(dict.fromkeys([*run["warnings"], *[str(m)[:500] for m in messages if m]])))

    @staticmethod
    def known_urls(prompt, candidates=()):
        urls = re.findall(r"https?://[^\s<>]+", prompt)
        urls += [value for item in candidates for value in (item.get("url"), item.get("download_url")) if value]
        known = {}
        for value in urls:
            value = value.rstrip(".,，;；。!?！？]）")
            try:
                known[canonical_url(value)] = value
            except (TypeError, ValueError):
                continue
        return known

    @staticmethod
    def unique_candidates(candidates):
        unique = {}
        for candidate in candidates:
            try:
                key = canonical_url(candidate.get("download_url") or candidate["url"])
                canonical_url(candidate["url"])
            except (KeyError, TypeError, ValueError):
                continue
            unique.setdefault(key, candidate)
        return unique

    @staticmethod
    def query_key(query):
        return json.dumps({k: v for k, v in query.items() if not k.startswith("_")}, sort_keys=True, ensure_ascii=False)

    def executable_queries(self, proposed, available, known):
        result, seen = [], set()
        for query in proposed:
            if not isinstance(query, dict) or query.get("channel") not in available or not query.get("query"):
                continue
            channel = query["channel"]
            kind = query.get("kind") or ("webpage" if channel in {"tavily", "open_web"} else "image")
            if kind not in available[channel].get("kinds", []):
                continue
            clean = {k: v for k, v in query.items() if k in {"channel", "query", "kind", "time_range", "domains"}}
            clean.update(kind=kind, query=str(query["query"])[:600])
            if kind == "document":
                if query.get("required_format") == "pdf":
                    clean["required_format"] = "pdf"
                if query.get("material_intent") == "paper":
                    clean["material_intent"] = "paper"
            seeds = []
            for seed in query.get("seed_urls", []):
                try:
                    identity = canonical_url(seed)
                except (TypeError, ValueError):
                    continue
                if identity in known:
                    seeds.append(known[identity])
            if seeds:
                clean["seed_urls"] = list(dict.fromkeys(seeds))[:3]
            if channel == "open_web" and not seeds:
                continue
            key = self.query_key(clean)
            if key not in seen:
                result.append(clean)
                seen.add(key)
        return result

    async def search_batch(self, run_id, queries, raw, *, call_limit):
        for query in queries:
            current = self.store.get(run_id)
            key = self.query_key(query)
            executed = current.get("_executed_queries", [])
            if key in executed:
                continue
            if not self.active(run_id) or current["_search_calls"] >= min(MAX_SEARCH_CALLS, call_limit):
                break
            remaining = self.max_total_bytes - current["_bytes"]
            if remaining <= 0:
                self.warnings(run_id, ["本次网络读取总量已达到上限，已停止继续发现资源。"])
                break
            self.store.update(run_id, _search_calls=current["_search_calls"] + 1,
                              _executed_queries=[*executed, key],
                              message="正在访问公开来源并发现可下载素材")
            try:
                found = await resolve(self.providers.discover({**query, "_remaining_bytes": remaining},
                    min(20, max(current["max_items"] * 2, 5))))
            except BaseException as error:
                self.store.account_download(run_id, None, getattr(error, "downloaded_bytes", 0))
                if not isinstance(error, Exception):
                    raise
                self.warnings(run_id, [f"{query['channel']} 搜索未完成：{self.error_message(error)}"])
                continue
            consumed = sum(item.get("_discovery_bytes", 0) for item in found)
            self.store.account_download(run_id, None, consumed)
            fresh = []
            for item in found:
                item = dict(item)
                item.pop("_discovery_bytes", None)
                # Delivery constraints come from the request, not the ranker's
                # description of a result. Preserve them across all adapters.
                if query.get("required_format"):
                    item["required_format"] = query["required_format"]
                if query.get("material_intent"):
                    item["material_intent"] = query["material_intent"]
                fresh.append(item)
            snapshot = self.store.get(run_id)
            accepted = set(snapshot.get("_accepted_urls", []))
            rejected = set(snapshot.get("_rejected_urls", []))
            previous = self.unique_candidates(raw)
            # Rejected candidates must not occupy the window used by a repair
            # search. Retain accepted identities, then admit newly observed hits.
            merged = self.unique_candidates([*[item for key, item in previous.items() if key in accepted],
                                             *fresh, *previous.values()])
            raw[:] = [item for key, item in merged.items() if key not in rejected][:MAX_CANDIDATES]
            self.store.update(run_id, _discovered=raw)
            if consumed > remaining:
                self.warnings(run_id, ["资源发现读取已触及本次总量上限，后续下载将停止。"])
                break
        return raw

    async def rank_discovery(self, run_id, raw, target):
        run = self.store.get(run_id)
        rejected = set(run.get("_rejected_urls", []))
        pool = {key: value for key, value in self.unique_candidates(raw).items() if key not in rejected}
        if not pool:
            return [], False
        # A repair search supplements verified selections. It must not ask the
        # model to reselect them and lose good papers through answer variance.
        accepted = [item for key, item in self.unique_candidates(run.get("_accepted_candidates", [])).items()
                    if key in pool and item.get("ranking_status") != "unavailable"][:target]
        selected = set(self.unique_candidates(accepted))
        unavailable = False
        entries = [(key, item) for key, item in pool.items() if key not in selected]
        for offset in range(0, len(entries), RANK_WINDOW):
            remaining = target - len(accepted)
            if remaining <= 0:
                break
            # Match the planner's visible window; never reject unseen metadata.
            window = dict(entries[offset:offset + RANK_WINDOW])
            try:
                ranked = await resolve(self.planner.rank_candidates(run["prompt"], list(window.values()), remaining))
            except Exception:
                ranked = [{**item, "ranking_status": "unavailable", "selection_reason": "等待确认相关性"}
                          for item in list(window.values())[:remaining]]
                self.warnings(run_id, ["智能筛选暂不可用，请先检查候选并选择要收录的素材。"])
            unavailable = any(item.get("ranking_status") == "unavailable" for item in ranked)
            for item in ranked:
                try:
                    identity = canonical_url(item.get("download_url") or item["url"])
                except (KeyError, TypeError, ValueError):
                    continue
                if identity in window and identity not in selected and len(accepted) < target:
                    accepted.append(item)
                    selected.add(identity)
            if not unavailable:
                for url in getattr(ranked, "rejected_urls", []):
                    try:
                        identity = canonical_url(url)
                    except (TypeError, ValueError):
                        continue
                    if identity in window and identity not in selected:
                        rejected.add(identity)
            self.store.update(run_id, _rejected_urls=sorted(rejected), _accepted_urls=sorted(selected),
                              _accepted_candidates=[item for item in accepted if item.get("ranking_status") != "unavailable"])
            if unavailable:
                break
        return accepted, unavailable

    async def discover_run(self, run_id):
        from .planner import apply_requirements
        run = self.store.get(run_id)
        await self.validate_kb(run["kb_id"])
        seed_urls = self.known_urls(run["prompt"])
        only_urls = bool(seed_urls) and re.sub(r"https?://[^\s<>]+", "", run["prompt"]).strip(" \t\n,，;；") == ""
        raw = list(run.get("_discovered", []))
        review_required = False
        if only_urls:
            urls = list(seed_urls.values())[:run["max_items"]]
            plan = {"summary": "按提供的链接直接导入", "queries": [], "direct_urls": urls, "target_count": len(urls)}
            self.store.update(run_id, plan=plan)
            raw = [{"title": url, "url": url, "source": "url", "kind": "webpage", "description": "用户提供的链接"} for url in urls]
            ranked = raw
        else:
            channels = (await self.capabilities())["channels"]
            available = {name: value for name, value in channels.items() if value.get("available")}
            if not available:
                raise ValueError("当前没有可用的网络发现能力。可以提供公开网页链接，或配置搜索入口。")
            plan = run.get("plan") or await resolve(self.planner.plan_request(run["prompt"], run["max_items"], available))
            plan = apply_requirements(plan, run["prompt"], available)
            proposed = list(plan.get("queries", []))
            if seed_urls and "open_web" in available and not any(q.get("channel") == "open_web" for q in proposed if isinstance(q, dict)):
                kind = next((q.get("kind") for q in proposed if isinstance(q, dict) and q.get("kind") in available["open_web"].get("kinds", [])), "webpage")
                proposed.insert(0, {"channel": "open_web", "kind": kind, "query": run["prompt"][:600], "seed_urls": list(seed_urls.values())})
            # Seeded public pages work independently of search-engine API keys.
            proposed.sort(key=lambda q: 0 if isinstance(q, dict) and q.get("channel") == "open_web" else 1)
            known = self.known_urls(run["prompt"], raw)
            queries = self.executable_queries(proposed, available, known)[:MAX_SEARCH_CALLS - 1]
            if not queries:
                raise ValueError("请提供可访问的公开网页链接，或配置搜索入口以发现更多网站。")
            plan = {**plan, "queries": queries,
                    "target_count": min(run["max_items"], max(1, int(plan.get("target_count") or run["max_items"])))}
            self.store.update(run_id, plan=plan, status="searching", message="正在搜索公开来源与可下载资源")
            self.warnings(run_id, plan.get("warnings", []))
            await self.search_batch(run_id, queries, raw, call_limit=MAX_SEARCH_CALLS - 1)
            if not self.active(run_id):
                return
            ranked, review_required = await self.rank_discovery(run_id, raw, plan["target_count"])
            current = self.store.get(run_id)
            if not review_required and len(ranked) < plan["target_count"] and current["_search_calls"] < MAX_SEARCH_CALLS and not current.get("_refine_done"):
                self.store.update(run_id, _refine_done=True, message="候选尚不充分，正在调整搜索方式")
                known = self.known_urls(run["prompt"], raw)
                feedback = {"target_count": plan["target_count"], "accepted_count": len(ranked),
                            "rejected": [{k: item.get(k) for k in ("title", "url", "kind")} for key, item in self.unique_candidates(raw).items()
                                         if key in set(current.get("_rejected_urls", []))][:15],
                            "not_selected": [{k: item.get(k) for k in ("title", "url", "kind")} for key, item in self.unique_candidates(raw).items()
                                             if key not in set(current.get("_rejected_urls", [])) | set(current.get("_accepted_urls", []))][:15],
                            "observed_urls": list(known.values())[:30], "warnings": current["warnings"][-4:]}
                refined = []
                if hasattr(self.planner, "refine_queries"):
                    try:
                        refined = await resolve(self.planner.refine_queries(run["prompt"], queries, feedback, available))
                    except Exception:
                        self.warnings(run_id, ["本次搜索调整未完成，保留已找到的相关候选。"])
                if not refined:
                    # A deterministic channel change is allowed; source invention is not.
                    used = {(q["channel"], q["query"]) for q in queries}
                    for query in queries:
                        other = next((name for name, capability in available.items()
                                      if name != "open_web" and query["kind"] in capability.get("kinds", []) and (name, query["query"]) not in used), None)
                        if other:
                            refined = [{**query, "channel": other}]
                            break
                refined = apply_requirements({"queries": refined}, run["prompt"], available).get("queries", [])
                extra = [q for q in self.executable_queries(refined, available, known)
                         if self.query_key(q) not in self.store.get(run_id).get("_executed_queries", [])]
                extra = extra[:MAX_SEARCH_CALLS - self.store.get(run_id)["_search_calls"]]
                if extra:
                    plan["queries"] = [*queries, *extra]
                    self.store.update(run_id, plan=plan)
                    self.warnings(run_id, ["候选数量或相关性不足，已调整查询并补充搜索。"])
                    await self.search_batch(run_id, extra, raw, call_limit=MAX_SEARCH_CALLS)
                    if not self.active(run_id):
                        return
                    ranked, review_required = await self.rank_discovery(run_id, raw, plan["target_count"])
        if not self.active(run_id):
            return
        unique = self.unique_candidates(raw)
        if not unique:
            if plan.get("requirements", {}).get("document_format") == "pdf":
                raise CollectionExecutionError("pdf_unavailable", "没有找到可公开获取的 PDF 原文；未将摘要网页替代收录。可调整关键词或提供论文链接后重试。")
            raise CollectionExecutionError("no_results", "没有找到可用素材。可调整关键词或提供更明确的链接后重试。")
        if not ranked:
            raise CollectionExecutionError("no_relevant_results", "已搜索并调整查询，但没有符合需求的候选；请调整需求后重试。")
        candidates, seen = [], set()
        for data in ranked[:MAX_CANDIDATES]:
            try:
                identity = canonical_url(data.get("download_url") or data["url"])
                original = unique[identity]
            except (KeyError, TypeError, ValueError):
                continue
            if identity in seen:
                continue
            seen.add(identity)
            safe = {k: v for k, v in original.items() if k in Candidate.model_fields and k not in {
                "id", "status", "file_id", "processing_id", "error", "error_code"}}
            safe.update(id=str(uuid.uuid4()), status="candidate", reason=data.get("selection_reason") or data.get("reason"),
                        ranking_status=data.get("ranking_status"))
            safe["warnings"] = list(dict.fromkeys([*original.get("warnings", []), *data.get("warnings", [])]))
            self.warnings(run_id, safe["warnings"])
            safe.setdefault("title", safe.get("url", "素材"))
            safe.setdefault("source", "url")
            candidate = Candidate.model_validate(safe).model_dump()
            candidate["_provider_metadata"] = original.get("provider_metadata", {})
            candidates.append(candidate)
        if not candidates:
            raise CollectionExecutionError("no_relevant_results", "没有通过来源校验的候选素材，请调整需求。")
        if review_required:
            plan["review_required_reason"] = "智能筛选暂不可用，请先确认候选的相关性再收录。"
        self.store.update(run_id, plan=plan, candidates=candidates, _phase="collection", status="review",
                          message=plan.get("review_required_reason") or "已找到候选素材，选择后开始收录。")
        if run["mode"] == "auto" and not review_required and self.active(run_id):
            self.select_items(run_id, [c["id"] for c in candidates[:plan.get("target_count", run["max_items"])]])
            await self.collect_run(run_id)

    def select_items(self, run_id, ids):
        run = self.store.get(run_id)
        unique = set(ids)
        existing = {item["id"] for item in run["candidates"]}
        if not unique or not unique <= existing or len(unique) > run["max_items"]:
            raise CollectionConflict("请选择当前任务内的候选，且不要超过收录数量上限")
        items = [{**item, "_selected": item["id"] in unique,
                  "status": item["status"] if item["id"] in unique or item["status"] in {"ready", "duplicate"} else "skipped"}
                 for item in run["candidates"]]
        return self.store.update(run_id, candidates=items, status="collecting", message="正在下载、解析并收录素材")

    async def collect(self, run_id, ids):
        async with self.lock:
            run = self.store.get(run_id)
            await self.validate_kb(run["kb_id"])
            if run["status"] != "review" or run_id in self.jobs:
                raise CollectionConflict("此任务当前不能选择素材")
            run = self.select_items(run_id, ids)
            self.launch(run_id, self.collect_run)
            return public_run(run)

    async def duplicate(self, run, item, kind, identity):
        other = self.store.claim(run["kb_id"], kind, identity, run["id"], item["id"])
        if not other:
            return False
        if item.get("required_format") == "pdf" and other.get("_format_verified") != "pdf":
            # A legacy webpage receipt (or metadata claiming PDF) cannot fulfill
            # a PDF request. Do not overwrite that receipt's ingestion identity.
            payload = Path(other["_payload"]) if other.get("_payload") else None
            if not payload or not payload.is_file() or not self.pdf_delivery(
                    payload.read_bytes(), other.get("_filename", ""), other.get("_content_type")):
                raise CollectionExecutionError("duplicate_format_unverified", "已有素材未通过 PDF 原文校验，不能作为本次论文收录结果。请重新查找原文。")
        if other.get("file_id"):
            receipt = await resolve(self.bridge.inspect_ingestion(run["kb_id"], other.get("file_id"), other.get("processing_id")))
            if receipt.get("status") in {"not_found", "deleted"}:
                self.store.release_claim(run["kb_id"], kind, identity, other["id"])
                return await self.duplicate(run, item, kind, identity)
            if receipt.get("status") not in {"completed", "ready"}:
                code = "duplicate_processing" if receipt.get("status") in {"queued", "processing", "pending", "running"} else "duplicate_unavailable"
                self.store.item(run["id"], item["id"], status="failed", error_code=code,
                                error="相同素材的原采集任务尚未完成，请先继续或重试原任务；未重复写入。")
                return True
        elif other.get("status") != "ready":
            self.store.item(run["id"], item["id"], status="failed", error_code="duplicate_processing",
                            error="其他任务正在收录相同素材；完成后可重试核验。")
            return True
        self.store.item(run["id"], item["id"], status="duplicate", file_id=other.get("file_id"),
                        processing_id=other.get("processing_id"), reason="当前素材空间已有相同素材或正在收录，已跳过重复写入。")
        return True

    async def collect_run(self, run_id):
        run = self.store.get(run_id)
        await self.validate_kb(run["kb_id"])
        self.store.update(run_id, status="collecting", message="正在下载、解析并收录素材")
        for original in run["candidates"]:
            if not self.active(run_id):
                return
            item = next(i for i in self.store.get(run_id)["candidates"] if i["id"] == original["id"])
            if not item.get("_selected") or item["status"] in {"ready", "duplicate"}:
                continue
            try:
                async with self.ingestion_lock:
                    await self.collect_item(run_id, item)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                if self.active(run_id):
                    self.store.item(run_id, item["id"], status="failed", error=self.error_message(error),
                                    error_code=getattr(error, "code", "collection_failed"))
        if self.active(run_id):
            self.finish(run_id)

    async def collect_item(self, run_id, item):
        from app.modules.ingestion.sources.base import ContentSourceResult
        from .planner import request_requirements
        run = self.store.get(run_id)
        await self.validate_kb(run["kb_id"])
        requirements = request_requirements(run["prompt"])
        # Older review tasks have no format fields. Apply the user's contract
        # when collecting them, but never relabel an already-ingested webpage.
        if requirements.get("document_format") == "pdf" and (
                item.get("kind") == "document" or requirements.get("requested_kinds") == ["document"]):
            contract = {"required_format": "pdf"}
            if requirements.get("academic_papers"):
                contract["material_intent"] = "paper"
            item = self.store.item(run_id, item["id"], **contract)
        payload = Path(item["_payload"]) if item.get("_payload") else None
        if item.get("_ingest_started") and item.get("required_format") == "pdf":
            if not payload or not payload.is_file() or not self.pdf_delivery(
                    payload.read_bytes(), item.get("_filename", ""), item.get("_content_type")):
                raise CollectionExecutionError("delivery_format_mismatch", "旧处理记录不是已验证的 PDF 原文，请重新查找以获取论文 PDF。")
        if item.get("_ingest_started"):
            receipt = await resolve(self.bridge.inspect_ingestion(run["kb_id"], item.get("file_id"), item.get("processing_id")))
            if receipt.get("status") in {"completed", "ready", "queued", "pending", "processing", "running"}:
                self.owned_ingestions.add((run_id, item["id"]))
                await self.wait_ingestion(run_id, item, receipt)
                return
        claim_kind = "url:pdf" if item.get("required_format") == "pdf" else "url"
        if await self.duplicate(run, item, claim_kind, canonical_url(item.get("download_url") or item["url"])):
            return
        if payload and payload.is_file() and item.get("required_format") == "pdf" and not self.pdf_delivery(
                payload.read_bytes(), item.get("_filename", ""), item.get("_content_type")):
            # No ingestion has started: an old HTML/Markdown checkpoint is not
            # reusable, but the item can safely fetch its required original.
            payload = None
        if payload and payload.is_file():
            content = ContentSourceResult(payload.read_bytes(), item["_filename"], item.get("_content_type"), item.get("_meta", {}))
        else:
            remaining = self.max_total_bytes - run["_bytes"]
            if remaining <= 0:
                raise ValueError("本次下载总量已达到上限；已收录素材保留。")
            self.store.item(run_id, item["id"], status="downloading", error=None, error_code=None)
            candidate = {k: v for k, v in item.items() if not k.startswith("_")}
            candidate["provider_metadata"] = item.get("_provider_metadata", {})
            download_limit = min(MAX_ITEM_BYTES, remaining)
            try:
                content = await resolve(self.providers.fetch_candidate(candidate, download_limit))
            except BaseException as error:
                # Adapters attach consumed bytes even when extraction, streaming
                # or cancellation fails. Charge before propagating the failure.
                self.store.account_download(run_id, item["id"], getattr(error, "downloaded_bytes", 0))
                raise
            downloaded = (content.meta or {}).get("download_bytes", len(content.content))
            self.store.account_download(run_id, item["id"], downloaded)
            if not self.active(run_id):
                return
            if not content.content or len(content.content) > download_limit or downloaded > download_limit:
                raise ValueError("素材内容为空或超过本次下载大小上限")
            self.validate_delivery(item, content)
            # Only JSON metadata is persisted; source bytes never enter planner calls.
            meta = json.loads(json.dumps(content.meta, default=lambda _: None))
            meta["collected_at"] = now()
            content.meta = meta
            item_warnings = list(dict.fromkeys([*item.get("warnings", []), *meta.get("warnings", [])]))
            self.warnings(run_id, item_warnings)
            path = self.store.save_payload(item["id"], content.content)
            item = self.store.item(run_id, item["id"], _payload=path, _filename=content.suggested_filename,
                            _content_type=content.content_type, _meta=meta, warnings=item_warnings,
                            title=meta.get("title") or item["title"],
                            author=meta.get("author") or item.get("author"),
                            published_at=meta.get("published_at") or item.get("published_at"),
                            license=meta.get("license") or item.get("license"),
                            download_url=meta.get("download_url") or item.get("download_url"),
                            _format_verified="pdf" if self.pdf_delivery(content.content, content.suggested_filename, content.content_type) else None,
                            kind=meta.get("kind") or item["kind"],
                            width=meta.get("width") or item.get("width"), height=meta.get("height") or item.get("height"))
        self.validate_delivery(item, content)
        digest = hashlib.sha256(content.content).hexdigest()
        if await self.duplicate(run, item, "sha256", digest):
            return
        if not self.active(run_id):
            return
        file_id, processing_id = self.bridge.ingestion_ids(run["kb_id"], item["id"])
        self.store.item(run_id, item["id"], _ingest_started=True, _sha256=digest,
                        file_id=file_id, processing_id=processing_id, status="processing", error=None, error_code=None)
        self.owned_ingestions.add((run_id, item["id"]))
        provenance = {"collection_run_id": run_id, "collection_item_id": item["id"], "source_url": item["url"],
                      "source_channel": item["source"], "content_sha256": digest,
                      "required_format": item.get("required_format"), "material_intent": item.get("material_intent"),
                      "author": item.get("author"), "license": item.get("license"), "published_at": item.get("published_at")}
        receipt = await resolve(self.bridge.ingest_item(content, run["kb_id"], item["id"], provenance))
        item = self.store.item(run_id, item["id"], file_id=receipt.get("file_id") or file_id,
                               processing_id=receipt.get("processing_id") or processing_id)
        await self.wait_ingestion(run_id, item, receipt)

    @staticmethod
    def pdf_delivery(content, filename, content_type):
        from .providers import is_pdf_content
        return (is_pdf_content(content) and Path(filename).suffix.lower() == ".pdf"
                and (content_type or "").split(";", 1)[0].strip().lower() == "application/pdf")

    @classmethod
    def validate_delivery(cls, item, content):
        if item.get("required_format") == "pdf" and not cls.pdf_delivery(
                content.content, content.suggested_filename, content.content_type):
            raise CollectionExecutionError("delivery_format_mismatch", "未取得有效 PDF 原文，摘要页或其他格式不会作为论文 PDF 收录。")

    async def wait_ingestion(self, run_id, item, receipt):
        started = time.monotonic()
        run = self.store.get(run_id)
        while self.active(run_id):
            status = receipt.get("status")
            if status in {"completed", "ready"}:
                self.store.item(run_id, item["id"], status="ready", error=None, error_code=None)
                return
            if status in {"failed", "cancelled", "not_found", "deleted", "interrupted", "error"}:
                self.store.item(run_id, item["id"], status="failed", error=receipt.get("error") or receipt.get("message") or "解析未完成，可重试。", error_code=receipt.get("error_code") or str(status))
                return
            self.store.item(run_id, item["id"], status="processing")
            if time.monotonic() - started >= self.processing_timeout:
                stopped = await resolve(self.bridge.cancel_ingestion(run["kb_id"], item["processing_id"])) or {}
                if stopped.get("status") in {"completed", "ready"}:
                    self.store.item(run_id, item["id"], status="ready", error=None, error_code=None)
                    return
                self.store.item(run_id, item["id"], status="failed", error="本次解析等待已达到上限，可继续未完成的处理。", error_code="processing_timeout")
                self.store.update(run_id, status="interrupted", message="已停止超时处理并保存任务编号；继续时会先核验处理进度。")
                return
            await asyncio.sleep(self.poll_interval)
            receipt = await resolve(self.bridge.inspect_ingestion(run["kb_id"], item.get("file_id"), item.get("processing_id")))

    def finish(self, run_id):
        run = self.store.get(run_id)
        selected = [i for i in run["candidates"] if i.get("_selected")]
        good = sum(i["status"] in {"ready", "duplicate"} for i in selected)
        status = "completed" if selected and good == len(selected) else "partial" if good else "failed"
        target = run.get("plan", {}).get("target_count", len(selected)) if run["mode"] == "auto" else len(selected)
        if good and good < target:
            status = "partial"
        counts = public_run(run)["counts"]
        self.store.update(run_id, status=status,
                          message=f"已收录 {counts['ready']} 项，跳过重复 {counts['duplicate']} 项，失败 {counts['failed']} 项。"
                                  + (f"本次目标 {target} 项，尚缺 {target - good} 项。" if good < target else ""))

    async def cancel(self, run_id):
        async with self.lock:
            run = self.store.get(run_id)
            if run["status"] in {"completed", "cancelled"}:
                return public_run(run)
            self.store.update(run_id, status="cancelled", message="采集已停止，已收录素材保留。")
            job = self.jobs.get(run_id)
            if job:
                job.cancel()
                await asyncio.gather(job, return_exceptions=True)
            self.dependencies()
            for item in self.store.get(run_id)["candidates"]:
                if item.get("processing_id") and item["status"] == "processing":
                    try:
                        stopped = await resolve(self.bridge.cancel_ingestion(run["kb_id"], item["processing_id"])) or {}
                        completed = stopped.get("status") in {"completed", "ready"}
                        self.store.item(run_id, item["id"], status="ready" if completed else "failed",
                                        error=None if completed else "采集已取消；可继续未完成的处理。",
                                        error_code=None if completed else "cancelled")
                    except Exception:
                        self.store.item(run_id, item["id"], status="failed", error="停止请求已保存，处理状态暂时无法核验；继续时将先核验原任务。", error_code="cancel_unverified")
                elif item["status"] == "downloading":
                    self.store.item(run_id, item["id"], status="failed", error="下载已取消", error_code="cancelled")
            return public_run(self.store.get(run_id))

    async def retry(self, run_id):
        async with self.lock:
            run = self.store.get(run_id)
            await self.validate_kb(run["kb_id"])
            if run_id in self.jobs or run["status"] not in {"failed", "partial", "cancelled", "interrupted"}:
                raise CollectionConflict("此任务当前不能重试")
            selected = [item for item in run["candidates"] if item.get("_selected")]
            if run["status"] == "partial" and selected and all(item["status"] in {"ready", "duplicate"} for item in selected):
                raise CollectionConflict("已选素材均已收录或确认重复，本次候选数量不足；请调整需求后重新查找。")
            if any(i.get("_selected") for i in run["candidates"]):
                run = self.store.update(run_id, status="collecting", error_code=None, message="正在核验已有素材并继续未完成项")
                self.launch(run_id, self.collect_run)
            elif run["candidates"]:
                run = self.store.update(run_id, status="review", message="选择素材后继续收录")
            else:
                # Explicit retries receive a fresh bounded discovery allowance.
                run = self.store.update(run_id, status="planning", error_code=None, message="正在继续搜索素材",
                                        _search_calls=0, _executed_queries=[], _refine_done=False)
                self.launch(run_id, self.discover_run)
            return public_run(run)

    async def shutdown(self):
        self.closed = True
        try:
            await self._settle_shutdown()
        finally:
            self._supervisor_lock.close()

    async def _settle_shutdown(self):
        tasks = list(self.jobs.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        # Parsing is owned by the ingestion service, so stopping the runner alone
        # does not stop its child task. Settle those writes before app shutdown.
        for run_id, item_id in self.owned_ingestions:
            run = self.store.get(run_id)
            item = next(i for i in run["candidates"] if i["id"] == item_id)
            if item["status"] in {"ready", "duplicate"} or not item.get("processing_id"):
                continue
            try:
                receipt = await resolve(self.bridge.cancel_ingestion(run["kb_id"], item["processing_id"])) or {}
                completed = receipt.get("status") in {"completed", "ready"}
                self.store.item(run_id, item_id, status="ready" if completed else "failed",
                                error=None if completed else "服务已停止；继续时会核验并恢复未完成项。",
                                error_code=None if completed else "host_stopped")
            except Exception:
                self.store.item(run_id, item_id, status="failed", error="服务已停止，原处理状态待恢复时核验。", error_code="stop_unverified")
            if run["status"] != "cancelled":
                self.store.update(run_id, status="interrupted", message="服务已停止，采集进度已保存；可继续未完成项。")


_service = None


def get_collection_service():
    global _service
    if _service is None or _service.closed:
        _service = CollectionService()
    return _service


async def stop_collection_service():
    global _service
    if _service:
        await _service.shutdown()
        _service = None
