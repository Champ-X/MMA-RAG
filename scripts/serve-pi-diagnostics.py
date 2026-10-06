#!/usr/bin/env python3
"""Run unmodified chat/Pi routes with request-scoped timing in a separate process.

No prompt/result rewriting or model-route changes. Spans contain timing, model
identifiers and counts, never prompts, provider keys or retrieved source bodies.
The production service and Pi ledger remain separate. Uvicorn lifespan is off
so this verifier cannot start a duplicate Feishu listener or maintenance loop.
"""
import argparse
import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
import functools
import hashlib
import inspect
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parents[1]
request_id = ContextVar("pi_verification_request", default=None)
parent_id = ContextVar("pi_verification_parent", default=None)


class Recorder:
    def __init__(self, path):
        self.path = Path(path)
        self.path.touch(mode=0o600, exist_ok=False)
        self.ids = itertools.count(1)

    @contextmanager
    def span(self, name, **fields):
        sid = request_id.get()
        if not sid:
            yield {}
            return
        item = {"session_id": sid, "span_id": next(self.ids), "parent_span_id": parent_id.get(),
                "name": name, "started_at": time.time(), **fields}
        token = parent_id.set(item["span_id"])
        started = time.perf_counter()
        try:
            yield item
            item.setdefault("status", "ok")
        except BaseException as error:
            item.update(status="error", error_type=type(error).__name__)
            raise
        finally:
            item["ended_at"] = time.time()
            item["seconds"] = time.perf_counter() - started
            parent_id.reset(token)
            with self.path.open("a") as target:
                target.write(json.dumps(item, ensure_ascii=False) + "\n")

    def wrap(self, target, name, label=None, fields=()):
        original = getattr(target, name)
        signature = inspect.signature(original)
        def metadata(args, kwargs):
            bound = signature.bind_partial(*args, **kwargs).arguments
            return {key: bound[key] for key in fields if key in bound and isinstance(bound[key], (str, int, float, bool))}
        if inspect.isasyncgenfunction(original):
            @functools.wraps(original)
            async def measured(*args, **kwargs):
                with self.span(label or name, **metadata(args, kwargs)):
                    async for item in original(*args, **kwargs):
                        yield item
        else:
            @functools.wraps(original)
            async def measured(*args, **kwargs):
                with self.span(label or name, **metadata(args, kwargs)) as span:
                    result = await original(*args, **kwargs)
                    if hasattr(result, "success"):
                        span["success"] = bool(result.success)
                        span["error_category"] = getattr(result, "error_category", None)
                    if hasattr(result, "action"):
                        span["action"] = result.action
                        span["query_count"] = len(result.queries)
                    return result
        setattr(target, name, measured)


class RequestSpans:
    def __init__(self, app, recorder):
        self.app, self.recorder = app, recorder

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode("utf-8", errors="replace"))
        sid = query.get("sessionId", [""])[0]
        if scope.get("path") != "/api/chat/stream" or not sid.startswith("pi-control-"):
            return await self.app(scope, receive, send)
        token = request_id.set(sid)
        try:
            with self.recorder.span("http.request", mode=query.get("agentMode", [""])[0]):
                await self.app(scope, receive, send)
        finally:
            request_id.reset(token)


async def serve(args):
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # Always a fresh ledger; never recover/cancel the interactive server's runs.
    if (out / "ledger").exists():
        raise SystemExit("Diagnostic ledger already exists; use a new output directory.")
    recorder = Recorder(out / "spans.jsonl")
    os.environ["PI_AGENT_DATA_DIR"] = str(out / "ledger")
    sys.path.insert(0, str(ROOT / "backend"))
    from app.main import app
    from app.api import chat
    from app.api.pi_agent import stop_pi_supervisor
    from app.core.llm.manager import llm_manager
    from app.core.logger import logger
    from app.modules.pi_agent.config import get_pi_settings
    import uvicorn

    logger.remove()
    logger.add(sys.stderr, level="WARNING", backtrace=False, diagnose=False)
    for name in ("chat", "embed", "rerank", "stream_chat"):
        recorder.wrap(llm_manager, name, "model." + name, fields=("task_type", "model"))
    recorder.wrap(llm_manager, "_call_with_model", "model.attempt", fields=("method", "model"))
    recorder.wrap(chat.agentic_retrieval_service.planner, "decide", "agent.plan", fields=("round_number",))
    for name in ("_preprocess_query", "_route_to_knowledge_bases", "_prepare_target_modality", "_perform_hybrid_search", "_apply_reranking"):
        recorder.wrap(chat.retrieval_service, name, "retrieval." + name.lstrip("_"))
    for name in ("_dense_search", "_sparse_search", "_visual_search", "_audio_search", "_video_search"):
        recorder.wrap(chat.retrieval_service.search_engine, name, "search." + name.lstrip("_"))
    app.add_middleware(RequestSpans, recorder=recorder)
    settings = get_pi_settings()
    paths = ["backend/app/api/chat.py", "backend/app/modules/agent/service.py", "backend/app/modules/pi_agent/supervisor.py",
             "scripts/verify-pi-isolation.py", "scripts/serve-pi-diagnostics.py"]
    manifest = {"git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "source_sha256": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths},
        "port": args.port, "pi_model": settings.model, "pi_budget": settings.budget.model_dump(),
        "pi_thinking_enabled": settings.thinking_enabled,
        "yield_to_legacy": settings.yield_to_legacy, "lifespan": "off",
        "predeclared_next_check": args.check_label}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, lifespan="off", access_log=False))
    try:
        await server.serve()
    finally:
        await stop_pi_supervisor()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8002)
    parser.add_argument("--output", required=True)
    parser.add_argument("--check-label", default="verify-pi-isolation.py v3; 6 samples/condition/mode; retain the 1.25 median threshold")
    asyncio.run(serve(parser.parse_args()))
