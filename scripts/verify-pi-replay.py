#!/usr/bin/env python3
"""Record real legacy external I/O once, then compare independent checkouts.

Use a detached baseline and the backend virtualenv. Lifespan/background jobs
are off. HTTP routing, request validation, attachments, local encoders, query
rewriting, retrieval, legacy Agent, generation, SSE and history remain active.
Replays compare exact request contracts and answer/citation/history contents;
they deliberately do not claim provider timing or semantic correctness.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

import httpx
from dotenv import load_dotenv

from pi_io_replay import Tape, digest, lane, normalize, write_private

ROOT = Path(__file__).resolve().parents[1]
TERMINAL = {"completed", "partial", "cancelled", "failed", "needs_input"}


def git_head(checkout):
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()


def projection(events, history):
    answer, citations, errors = "", [], []
    for event in events:
        data = event.get("data") or event
        if event.get("type") in {"message", "token"}:
            answer += data.get("delta") or data.get("content") or ""
        elif event.get("type") == "citation":
            refs = data.get("references") or []
            citations = refs if data.get("replace") else citations + refs
        elif event.get("type") == "error":
            errors.append(data)
    saved = [{key: item[key] for key in ("role", "content", "citations", "attachments", "mentions",
                                       "selected_files", "reference_files", "scope_version", "reference_query",
                                       "reference_context", "attachment_context", "agent_selection") if key in item}
             for item in history.get("messages", [])]
    return normalize({"answer": answer, "citations": citations, "errors": errors, "history": saved,
                      "complete": any(item.get("type") == "complete" for item in events)})


async def legacy(client, case, mode):
    sid = f'pi-replay-{case["id"]}-{mode}'
    params = {"message": case["question"], "knowledgeBaseIds": ",".join(case.get("kb_ids", [])),
              "agentMode": mode, "model": "deepseek:deepseek-flash", "sessionId": sid}
    for key, field in (("selected_files", "selectedFiles"), ("reference_files", "referenceFiles"),
                       ("mentions", "mentions")):
        if key in case:
            params[field] = json.dumps(case[key], ensure_ascii=False)
    started = time.time()
    if case.get("attachments"):
        files = []
        for attachment in case["attachments"]:
            body = Path(attachment["path"]).read_bytes()
            if hashlib.sha256(body).hexdigest() != attachment["sha256"]:
                raise ValueError("Frozen attachment changed")
            files.append(("files", (attachment["name"], body, attachment["mime"])))
        params["messageJson"] = json.dumps(params["message"], ensure_ascii=False)
        params["attachmentIds"] = json.dumps([f'fixture-{index}' for index in range(len(files))])
        response = await client.post("/api/chat/stream", data=params, files=files)
    else:
        response = await client.get("/api/chat/stream", params=params)
    response.raise_for_status()
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    ended = time.time()
    history = await client.get("/api/chat/history", params={"sessionId": sid})
    history.raise_for_status()
    return {"session_id": sid, "started_at": started, "ended_at": ended,
            "projection": projection(events, history.json()), "events": normalize(events),
            "history": normalize(history.json())}


async def start_load(client, kb_id, cohort):
    from app.api.pi_agent import host
    runs = []
    for number in range(2):
        response = await client.post("/api/pi/runs", json={
            "client_request_id": f"replay-load-{cohort}-{number}", "session_id": "pi-replay-load",
            "message": "比较 Harness Paper 两篇论文的组件、可观测性和验证方法。逐项读取原文并核对证据后回答。",
            "knowledge_base_ids": [kb_id]})
        response.raise_for_status()
        runs.append(response.json()["id"])
    async with asyncio.timeout(60):
        while not all(any(event["type"] == "model.started" for event in host().store.events(rid)) for rid in runs):
            if any(host().store.get(rid)["status"] in TERMINAL for rid in runs):
                raise RuntimeError("Pi load ended before model admission")
            await asyncio.sleep(.02)
    return runs


async def run(args):
    if os.environ.get("PYTHONHASHSEED") != "0":
        raise SystemExit("Start the interpreter with PYTHONHASHSEED=0 to fix legacy keyword set order.")
    for key in ("cases", "tape", "expected", "environment_file"):
        if getattr(args, key):
            setattr(args, key, str(Path(getattr(args, key)).resolve()))
    checkout, output = Path(args.checkout).resolve(), Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.environ["PI_AGENT_DATA_DIR"] = str(output / "pi-ledger")
    # Model files must already be present: evaluation never downloads/rebuilds a corpus.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    load_dotenv(args.environment_file, override=False)
    os.chdir(output)
    sys.path.insert(0, str(checkout / "backend"))
    from app.core.config import settings
    from app.core.logger import logger
    logger.remove()
    logger.add(sys.stderr, level="ERROR", backtrace=False, diagnose=False)
    cases_bytes = Path(args.cases).read_bytes()
    manifest = json.loads(cases_bytes)
    metadata = {"protocol": 2, "git_head": git_head(checkout), "mode": args.mode,
                "pi_load": args.pi_load, "cases_sha256": hashlib.sha256(cases_bytes).hexdigest(),
                "hash_seed": "0", "inventory_clock": "each monotonic read recorded and consumed exactly once",
                "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "tape_module_sha256": hashlib.sha256((ROOT / "scripts/pi_io_replay.py").read_bytes()).hexdigest(),
                "config_sha256": {name: hashlib.sha256((checkout / "backend/data" / name).read_bytes()).hexdigest()
                                  for name in ("llm_task_overrides.json", "jev_settings.json")
                                  if (checkout / "backend/data" / name).exists()},
                "limitations": "No wall-clock latency or independent quality claim; network delays not replayed; lifespan off; HTTP via ASGI."}
    if args.expected:
        original = json.loads((Path(args.expected) / "manifest.json").read_text())
        for key in ("protocol", "hash_seed", "inventory_clock", "cases_sha256", "config_sha256", "runner_sha256", "tape_module_sha256"):
            if metadata[key] != original[key]:
                raise ValueError("Replay protocol changed: " + key)
    write_private(output / "manifest.json", metadata)
    tape = Tape(args.tape, args.mode, minio_hosts={settings.minio_endpoint, settings.minio_public_endpoint},
                qdrant_hosts={f"{settings.qdrant_host}:{settings.qdrant_port}"}).install()
    results, loads = [], []
    try:
        from app.main import app
        from app.modules.knowledge import router as knowledge_router
        knowledge_router.time = SimpleNamespace(monotonic=lambda: tape.clock("inventory/monotonic", time.monotonic))
        # app.main configures logging again, redirect diagnostics to this private process.
        logger.remove()
        logger.add(sys.stderr, level="ERROR", backtrace=False, diagnose=False)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 1)),
                                     base_url="http://127.0.0.1", timeout=420) as client:
            startup = tape.report("startup")
            write_private(output / "startup.json", startup)
            for case in manifest["cases"]:
                if args.pi_load:
                    from app.api.pi_agent import host
                    if not loads or all(host().store.get(rid)["status"] in TERMINAL for rid in loads[-1]):
                        token = lane.set(None)
                        try:
                            loads.append(await start_load(client, manifest["load_kb_id"], len(loads)))
                        finally:
                            lane.reset(token)
                for mode in case.get("modes", ["auto", "direct", "agent"]):
                    name = f'{case["id"]}-{mode}'
                    token = lane.set(name)
                    try:
                        print(name, args.mode, "loaded" if args.pi_load else "control", flush=True)
                        try:
                            result = await legacy(client, case, mode)
                        except Exception as error:
                            result = {"error_type": type(error).__name__}
                        result["tape"] = tape.report(name)
                        result["contract_pass"] = not result["tape"]["errors"] and not result["tape"]["unconsumed_ids"]
                        if args.expected:
                            expected = json.loads((Path(args.expected) / f"{name}.json").read_text())
                            result["same_projection"] = result.get("projection") == expected.get("projection")
                            result["baseline_has_answer"] = bool(expected.get("projection", {}).get("answer"))
                        write_private(output / f"{name}.json", result)
                        results.append({"case": name, **{key: result[key] for key in
                                        ("contract_pass", "same_projection", "baseline_has_answer", "error_type") if key in result}})
                        print(results[-1], flush=True)
                    finally:
                        lane.reset(token)
            if args.pi_load:
                token = lane.set(None)
                try:
                    for cohort in loads:
                        for rid in cohort:
                            await client.post(f"/api/pi/runs/{rid}/cancel")
                    from app.api.pi_agent import stop_pi_supervisor
                    supervisor = host()
                    await stop_pi_supervisor()
                    events = [event for cohort in loads for rid in cohort for event in supervisor.store.events(rid)]
                    write_private(output / "pi-load.json", {"cohorts": loads, "events": events})
                finally:
                    lane.reset(token)
    finally:
        if args.pi_load:
            token = lane.set(None)
            try:
                from app.api.pi_agent import stop_pi_supervisor
                await stop_pi_supervisor()
            finally:
                lane.reset(token)
        report = tape.report()
        passed = (bool(results) and not report["errors"] and not report["unconsumed_ids"]
                  and not report["incomplete_ids"] and all(r["contract_pass"] and r.get("same_projection", True)
                                                          and not r.get("error_type") for r in results))
        write_private(output / "report.json", {"cases": results, "tape": report, "pass": passed})
        tape.close()
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["record", "replay"], required=True)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--environment-file", default=str(ROOT / "backend/.env"))
    parser.add_argument("--cases", required=True)
    parser.add_argument("--tape", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected", help="Immutable baseline record output directory")
    parser.add_argument("--pi-load", action="store_true")
    args = parser.parse_args()
    if args.pi_load and args.mode != "replay":
        parser.error("Pi load belongs to candidate replays only")
    if not asyncio.run(run(args)):
        raise SystemExit(1)
