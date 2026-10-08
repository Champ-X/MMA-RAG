"""Actual local retrieval modes; no replacement search for Agent observations."""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import time
from pathlib import Path

from .retrieval_local import LocalAPIRetriever
from .retrieval_runner import RetrievalAttemptError
from .retrieval_schema import digest, require

_native_attempts = contextvars.ContextVar("retrieval_eval_native_attempts", default=None)


def observe_native_manager(manager):
    """Instrument only this evaluation process; preserve primary/fallback behavior."""
    if getattr(manager, "_retrieval_eval_native_observer", False):
        return
    original = manager._call_with_model
    async def observed(method, model, params):
        attempts = _native_attempts.get()
        started = time.monotonic()
        result = None
        try:
            result = await original(method, model, params)
            return result
        finally:
            if attempts is not None:
                usage = result.data.get("usage", {}) if result and isinstance(result.data, dict) else {}
                attempts.append({"method": method, "model": model, "success": bool(result and result.success),
                                 "duration_seconds": time.monotonic() - started,
                                 "error_category": result.error_category if result else "cancelled",
                                 "known_tokens": usage.get("total_tokens")})
    manager._call_with_model = observed
    manager._retrieval_eval_native_observer = True


def native_usage(attempts, observations):
    chat = [a for a in attempts if a["method"] == "chat_completion"]
    other = [r for r in observations if r["endpoint"].endswith(("/embeddings", "/rerank"))]
    counts = [a.get("known_tokens") for a in chat] + [(r.get("usage") or {}).get("total_tokens") for r in other]
    known = [n for n in counts if isinstance(n, int) and not isinstance(n, bool) and n >= 0]
    unknown = sum(n is None or not isinstance(n, int) or isinstance(n, bool) or n < 0 for n in counts)
    unknown += max(0, sum(a["method"] != "chat_completion" for a in attempts) - len(other))
    return {"known_tokens": sum(known), "unknown_usage_calls": unknown, "model_attempts": len(attempts)}


def system_fingerprint() -> dict:
    backend = Path(__file__).resolve().parents[1]
    files = [*backend.joinpath("app/modules/retrieval").rglob("*.py"),
             *backend.joinpath("app/modules/agent").rglob("*.py"),
             *backend.joinpath("app/modules/pi_agent").rglob("*.py"),
             *backend.joinpath("app/core/llm").rglob("*.py"), backend / "app/core/config.py"]
    runtime = backend.parent / "agent-runtime"
    files += [p for p in runtime.joinpath("src").rglob("*") if p.is_file() and p.suffix in {".ts", ".js", ".mjs"}]
    files += [p for p in (runtime / "package.json", runtime / "package-lock.json") if p.exists()]
    return {str(p.relative_to(backend.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}


def selected_files(dataset, case):
    scope = case.get("scope", {})
    return [{"kb_id": dataset.sources[sid]["metadata"]["kb_id"], "file_id": dataset.sources[sid]["metadata"]["file_id"]}
            for sid in scope.get("source_ids", [])]


class LocalCoreRetriever(LocalAPIRetriever):
    """Call the same Direct/legacy services as Chat, before answer generation."""
    def __init__(self, dataset, *, base_url, profile):
        super().__init__(dataset, base_url=base_url)
        from app.core.config import settings
        from app.core.llm.manager import llm_manager
        from app.modules.retrieval.service import RetrievalService
        from app.modules.agent.service import AgenticRetrievalService
        from .retrieval_models import ModelCalls
        self.model_observer = ModelCalls()
        observe_native_manager(llm_manager)
        self.profile = profile
        self.core = RetrievalService()
        self.agent = AgenticRetrievalService(self.core) if profile == "legacy-agent" else None
        local_routes = {task: {"model": llm_manager.registry.get_task_model(task),
                              "provider": llm_manager.registry.get_model_config(llm_manager.registry.get_task_model(task))["provider"]}
                        for task in self.configuration["model_stack"]}
        require(local_routes == self.configuration["model_stack"], "local task routes differ from live API configuration")
        config_fields = [k for k in settings.model_fields if k.startswith(("agent_", "jev_")) or k in {"max_retrieval_results", "rerank_top_k", "min_relevance_score"}]
        self.configuration.update(profile=profile, backend="tessmora_native_retrieval_core", api=None,
            system_source=system_fingerprint(), retrieval_settings={k: getattr(settings, k) for k in config_fields},
            timing_scope="Actual native retrieval service through final evidence selection; excludes answer generation and HTTP overhead",
            limits="Same retrieval services imported by Chat. Default route, fallback and native candidate limits retained. Separate process shares existing read-only storage.")

    async def search(self, case, top_k):
        from .retrieval_models import _observations
        attempts, observations = [], []
        attempt_token = _native_attempts.set(attempts)
        observation_token = _observations.set(observations)
        result, error = None, None
        try:
            result = await self._search(case, top_k)
        except RetrievalAttemptError as exc:
            result, error = exc.result, exc.category
        except asyncio.CancelledError:
            result, error = {"hits": [], "diagnostics": {}}, "deadline_exceeded"
        except Exception as exc:
            result, error = {"hits": [], "diagnostics": {}}, type(exc).__name__
        finally:
            _native_attempts.reset(attempt_token)
            _observations.reset(observation_token)
        result["usage"] = native_usage(attempts, observations)
        result["diagnostics"].update(model_attempts=attempts, provider_receipts=observations)
        if error:
            raise RetrievalAttemptError(error, result)
        return result

    async def _search(self, case, top_k):
        from app.api.retrieval import serialize_evidence_item
        files = selected_files(self.dataset, case)
        scope = case.get("scope", {})
        context = {"kb_ids": list(scope.get("kb_ids", [])), "kb_names": [], "selected_files": files} if scope.get("kb_ids") or files else None
        if self.agent:
            result = await self.agent.search(query=case["query"], kb_context=context)
            retrieval = result.retrieval_result
            native = {"stop_reason": result.stop_reason, "executed_queries": result.executed_queries,
                      "rounds": len(result.trace), "steps": [{k: v for k, v in step.to_dict().items() if k != "reason"} for step in result.trace]}
        else:
            retrieval = await self.core.search(query=case["query"], kb_context=context)
            native = {}
        raw = [serialize_evidence_item(item).model_dump() for item in retrieval.reranked_results or []]
        if scope.get("modalities"):
            raw = [item for item in raw if item["modality"] in scope["modalities"]]
        raw = raw[:top_k]
        hits, unresolved = [], []
        for item in raw:
            try:
                hits.append(self._hit(item))
            except ValueError as error:
                unresolved.append({"id": item.get("id"), "source": item.get("source"), "content": item.get("content"), "reason": str(error)})
        result = {"hits": hits, "usage": {"known_tokens": 0, "unknown_usage_calls": 0, "unreported_task_usage": True},
                  "diagnostics": {**native, "native_processing_time": retrieval.processing_time, "unresolved": unresolved,
                                  "refined_query": retrieval.context.refined_query,
                                  "retrieval_debug": getattr(retrieval, "debug_info", {})}}
        if unresolved:
            raise RetrievalAttemptError("evidence_resolution_failed", result)
        return result


class PiRetriever(LocalAPIRetriever):
    """Collect the evidence actually observed by a durable Pi run; cancel deadlines."""
    def __init__(self, dataset, *, base_url, journal: Path, deadline_seconds: float = 175):
        super().__init__(dataset, base_url=base_url)
        from app.modules.pi_agent.config import get_pi_settings
        from .retrieval_data import request_json
        self.settings = get_pi_settings()
        self.deadline = deadline_seconds
        self.journal = journal
        journal.mkdir(parents=True, exist_ok=True)
        # Config endpoint has no secret fields. Token-authenticated installations are
        # read through the async client below; current local workspace is loopback.
        public_config = request_json(self.base_url + "/api/pi/config")
        self.configuration.update(profile="pi", backend="tessmora_pi_http", api="/api/pi/runs",
            pi_config=public_config, system_source=system_fingerprint(), deadline_seconds=deadline_seconds,
            pi_models={k: getattr(self.settings, k) for k in ("model", "embedding_model", "vision_model", "audio_model")},
            evidence_order="first-observed, exact duplicates removed; not final-answer citation order",
            timing_scope="Whole native Pi run including planning, tools, generation/checks; deadline cancellation included",
            limits="Indexed-evidence scores exclude new media observations/calculations without frozen text gold. Pi latency is not equivalent to retrieval-only Direct/legacy latency.")

    async def search(self, case, top_k):
        import httpx
        headers = {"Authorization": "Bearer " + self.settings.api_token.get_secret_value()} if self.settings.api_token else {}
        async with httpx.AsyncClient(base_url=self.base_url, headers=headers, timeout=30, trust_env=False) as client:
            async def request(method, path, body=None):
                response = await client.request(method, path, json=body)
                response.raise_for_status()
                return response.json()
            reference_path = self.journal / (digest(case["id"]) + ".json")
            require(not reference_path.exists(), "Pi attempt already exists; preserve and inspect its run id, never automatically replay")
            scope = case.get("scope", {})
            files = selected_files(self.dataset, case)
            if not files and scope.get("modalities"):
                files = [{"kb_id": s["metadata"]["kb_id"], "file_id": s["metadata"]["file_id"]} for s in self.dataset.sources.values()
                         if s["modality"] in scope["modalities"] and (not scope.get("kb_ids") or s["metadata"]["kb_id"] in scope["kb_ids"])]
            key = digest({"dataset": self.dataset.fingerprint, "case": case["id"], "journal": str(self.journal.resolve())})
            spec = {"client_request_id": "retrieval-eval-" + key, "session_id": "retrieval-eval-" + key,
                    "message": case["query"], "knowledge_base_ids": scope.get("kb_ids", []), "selected_files": files}
            started = time.monotonic()
            run = await request("POST", "/api/pi/runs", spec)
            run_id = run["id"]
            reference_path.write_text(json.dumps({"case_id": case["id"], "run_id": run_id, "request": spec}, ensure_ascii=False, indent=2) + "\n")
            terminal = {"completed", "partial", "needs_input", "cancelled", "failed"}
            timed_out = False
            try:
                while run["status"] not in terminal:
                    if time.monotonic() - started >= self.deadline:
                        timed_out = True
                        await request("POST", f"/api/pi/runs/{run_id}/cancel", {})
                        break
                    await asyncio.sleep(1)
                    run = await request("GET", f"/api/pi/runs/{run_id}")
            finally:
                if run["status"] not in terminal:
                    await request("POST", f"/api/pi/runs/{run_id}/cancel", {})
                    for _ in range(10):
                        run = await request("GET", f"/api/pi/runs/{run_id}")
                        if run["status"] in terminal:
                            break
                        await asyncio.sleep(.25)
            response = await request("GET", f"/api/pi/runs/{run_id}/evidence")
            raw_evidence = response["evidence"]
            private_path = reference_path.with_suffix(".evidence.json")
            private_path.write_text(json.dumps({"run": run, "evidence": raw_evidence}, ensure_ascii=False, indent=2) + "\n")
            hits, seen, unscored, unresolved = [], set(), [], []
            for item in raw_evidence:
                if item["observation"] in {"media_observation", "calculation"} or item["source"] != "knowledge":
                    unscored.append({"id": item["id"], "observation": item["observation"]})
                    continue
                locator, provenance = item["locator"], item["provenance"]
                raw = {"id": locator.get("point_id"), "content": item["content"], "score": 0.0, "modality": item["modality"],
                       "source": {"knowledge_base_id": provenance.get("kb_id"), "file_id": provenance.get("file_id"),
                                  "page": locator.get("page", locator.get("page_number")),
                                  "start_seconds": locator.get("shot_start_time"), "end_seconds": locator.get("shot_end_time")}}
                try:
                    hit = self._hit(raw)
                except ValueError as error:
                    unresolved.append({"id": item["id"], "reason": str(error)})
                    continue
                identity = (hit["id"], hit["content"])
                if identity not in seen:
                    hits.append(hit)
                    seen.add(identity)
            usage = run.get("state", {}).get("usage", {})
            result = {"hits": hits[:top_k], "usage": {"known_tokens": usage.get("model_tokens", 0),
                      "unknown_usage_calls": usage.get("unknown_usage_requests", 0),
                      "unreported_task_usage": not bool(usage) or run["status"] in {"failed", "cancelled"},
                      "limits": "Native Pi usage ledger; cancelled pending requests may have unreported usage"},
                      "diagnostics": {"run_id": run_id, "native_status": run["status"], "usage": usage,
                                      "observed_evidence_count": len(raw_evidence), "unscored": unscored, "unresolved": unresolved}}
            if timed_out or run["status"] in {"failed", "cancelled"} or unresolved:
                category = "deadline_exceeded" if timed_out else "evidence_resolution_failed" if unresolved else "pi_" + run["status"]
                raise RetrievalAttemptError(category, result)
            return result
