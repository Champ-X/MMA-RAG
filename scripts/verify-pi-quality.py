#!/usr/bin/env python3
"""Collect paired real answers for source-grounded review, without corpus writes.

The case manifest must be frozen before execution. This runner does not turn
keyword/source presence into a semantic quality score: review the saved answers
and their actual citations against the manifest's reference facts separately.
Each legacy mode runs once per condition/case; Pi also answers each case. Paid
model calls, failed samples and source bodies are retained in private receipts.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import uuid

import httpx

TERMINAL = {"completed", "partial", "failed", "cancelled", "needs_input"}
MODES = ("auto", "direct", "agent")
LOAD_QUESTION = "比较 Harness Paper 中两篇论文的 harness 定义、组件、可观测性和验证方法。读取原文上下文，引用证据。"


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def extract_legacy(events):
    answer, citations, errors = "", [], []
    for item in events:
        kind, data = item.get("type"), item.get("data") or {}
        if kind in {"message", "token"}:
            answer += data.get("delta") or data.get("content") or ""
        elif kind == "citation":
            refs = data.get("references") or []
            citations = refs if data.get("replace") else citations + refs
        elif kind == "error":
            errors.append(data.get("code") or "stream_error")
    return {"answer": answer, "citations": citations, "errors": errors,
            "complete": any(e.get("type") == "complete" for e in events)}


def citation_identity(answer, citations):
    markers = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    ids = {int(c["id"]) for c in citations if str(c.get("id", "")).isdecimal()}
    return {"markers": sorted(markers), "ids": sorted(ids),
            "unknown_markers": sorted(markers - ids), "unused_citations": sorted(ids - markers)}


async def legacy(client, case, mode, kb):
    sid = "pi-control-quality-" + uuid.uuid4().hex
    params = {"message": case["question"], "knowledgeBaseIds": kb,
              "agentMode": mode, "model": "deepseek:deepseek-flash", "sessionId": sid}
    if case.get("selected_files"):
        params["selectedFiles"] = json.dumps(case["selected_files"])
    started, events, error = time.time(), [], None
    try:
        async with client.stream("GET", "/api/chat/stream", params=params) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:]))
    except Exception as cause:
        error = type(cause).__name__
    result = extract_legacy(events)
    if error:
        result["errors"].append(error)
    result.update(mode=mode, session_id=sid, started_at=started, ended_at=time.time())
    result["citation_identity"] = citation_identity(result["answer"], result["citations"])
    return result


async def start_pi(client, case, kb, session):
    payload = {"client_request_id": uuid.uuid4().hex, "session_id": session,
               "message": case["question"], "knowledge_base_ids": [kb]}
    if case.get("selected_files"):
        payload["selected_files"] = [{"kb_id": f["kbId"], "file_id": f["fileId"]}
                                     for f in case["selected_files"]]
    response = await client.post("/api/pi/runs", json=payload)
    response.raise_for_status()
    return response.json()["id"]


async def pi_events(client, run_id, *, first_model=False):
    events = []
    async with client.stream("GET", f"/api/pi/runs/{run_id}/events") as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                event = json.loads(line[5:])
                events.append(event)
                if first_model and event["type"] == "model.started":
                    break
    return events


async def finish_pi(client, run_id, *, cancel=False):
    if cancel:
        response = await client.post(f"/api/pi/runs/{run_id}/cancel")
        response.raise_for_status()
    events = await pi_events(client, run_id)
    response = await client.get(f"/api/pi/runs/{run_id}")
    response.raise_for_status()
    run = response.json()
    response = await client.get(f"/api/pi/runs/{run_id}/evidence")
    response.raise_for_status()
    state = run["state"]
    return {"run_id": run_id, "status": run["status"], "state": state,
            "events": events, "evidence": response.json()["evidence"],
            "citation_identity": citation_identity(state.get("answer", ""), state.get("citations", []))}


async def condition(client, case, kb, loaded):
    runs, admitted = [], []
    result = {"loaded": loaded, "legacy": [], "load_admission": admitted}
    try:
        if loaded:
            for _ in range(2):
                runs.append(await start_pi(client, {"question": LOAD_QUESTION}, kb, "pi-quality-load"))
            # Exercise already-issued Pi inference, unlike a startup-only load.
            for rid in runs:
                async with asyncio.timeout(45):
                    events = await pi_events(client, rid, first_model=True)
                admitted.append({"run_id": rid, "model_started": any(e["type"] == "model.started" for e in events)})
        result["legacy"] = await asyncio.gather(*(legacy(client, case, mode, kb) for mode in MODES))
    except Exception as error:
        result["error_type"] = type(error).__name__
    finally:
        # Preserve and stop this runner's load only, including on a failed sample.
        cleanup = await asyncio.gather(*(finish_pi(client, rid, cancel=True) for rid in runs), return_exceptions=True)
        result["pi_load"] = []
        for rid, item in zip(runs, cleanup):
            if isinstance(item, Exception):
                print(f"Load cleanup incomplete {rid}: {type(item).__name__}", flush=True)
                result["pi_load"].append({"run_id": rid, "error_type": type(item).__name__})
            else:
                result["pi_load"].append(item)
    # Keep failed/cancelled load receipts too; server ledger holds the full trace.
    return result


async def main(args):
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    manifest_bytes = Path(args.cases).read_bytes()
    manifest = json.loads(manifest_bytes)
    save(output / "manifest.json", {"cases": manifest, "cases_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "protocol": "v1; alternating paired conditions; one sample/mode/case/condition; two Pi runs admitted before legacy; separate Pi answers",
        "semantic_review": "pending; citation identity is not semantic entailment; no statistical SLA claim"})
    async with httpx.AsyncClient(base_url=args.base, timeout=420, trust_env=False) as client:
        for index, case in enumerate(manifest["cases"]):
            receipt = {"case_id": case["id"], "conditions": []}
            path = output / (case["id"] + ".json")
            save(path, receipt)
            for loaded in ([False, True] if index % 2 == 0 else [True, False]):
                print(case["id"], "loaded" if loaded else "control", flush=True)
                try:
                    result = await condition(client, case, manifest["kb_id"], loaded)
                except Exception as error:
                    result = {"loaded": loaded, "error_type": type(error).__name__}
                receipt["conditions"].append(result)
                save(path, receipt)
            print(case["id"], "Pi answer", flush=True)
            rid = None
            try:
                rid = await start_pi(client, case, manifest["kb_id"], "pi-quality-" + case["id"])
                receipt["pi_run_id"] = rid
                save(path, receipt)
                receipt["pi"] = await finish_pi(client, rid)
            except Exception as error:
                receipt["pi"] = {"run_id": rid, "error_type": type(error).__name__}
                if rid:
                    await client.post(f"/api/pi/runs/{rid}/cancel")
            save(path, receipt)
            print(case["id"], receipt["pi"].get("status", "error"), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8002")
    parser.add_argument("--cases", required=True)
    parser.add_argument("--output", required=True)
    asyncio.run(main(parser.parse_args()))
