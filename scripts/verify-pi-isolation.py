#!/usr/bin/env python3
"""Paired live checks against an unchanged legacy pipeline and bounded Pi load.

Run with the backend venv. Makes paid model calls and reads the existing corpus;
does not upload, parse, vectorize, modify model routes or write knowledge data.
Outputs private verification receipts, never provider keys or signed media URLs.
"""
import argparse
import asyncio
import json
from pathlib import Path
import statistics
import time
import uuid

import httpx

QUESTION = "请根据 Harness Paper 知识库的 Agent Harness Engineering: A Survey，用两句话解释 agent harness 的定义，并引用依据。"
LOAD_QUESTION = "请检索 Harness Paper 中的两篇论文，比较 harness 的定义、组件、可观测性和验证方法。对每一项读取原文上下文，指出异同并引用具体证据。"
MODES = ("auto", "direct", "agent")
TERMINAL = {"completed", "partial", "failed", "cancelled", "needs_input"}


async def legacy(client, mode, kb):
    started = time.perf_counter()
    started_at = time.time()
    answer, citations, errors, phases = "", [], [], []
    first = None
    phase_events = []
    session_id = "pi-control-" + uuid.uuid4().hex
    async with client.stream("GET", "/api/chat/stream", params={"message": QUESTION, "knowledgeBaseIds": kb,
            "agentMode": mode, "model": "deepseek:deepseek-flash", "sessionId": session_id}) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            item = json.loads(line[5:])
            kind, data = item.get("type") or item.get("event"), item.get("data") or item
            if kind == "error":
                errors.append(str(data.get("message") or data.get("error") or "stream_error")[:500])
            elif kind in {"message", "token"}:
                text = data.get("delta") or data.get("content") or ""
                if text and first is None:
                    first = time.perf_counter() - started
                answer += text
            elif kind == "citation":
                refs = data.get("references") or []
                safe = [{"id": r.get("id"), "type": r.get("type"), "file_name": r.get("file_name"),
                         "chunk_id": (r.get("debug_info") or {}).get("chunk_id")} for r in refs]
                citations = safe if data.get("replace") else citations + safe
            elif kind == "thought":
                phase = data.get("type")
                payload = data.get("data") or {}
                phase_events.append({"seconds": time.perf_counter() - started, "phase": phase,
                    **{k: payload[k] for k in ("agent_status", "agent_round", "stage_status", "status") if k in payload}})
                if phase and phase not in phases:
                    phases.append(phase)
    ended_at = time.time()
    names = sorted({c["file_name"] for c in citations if c.get("file_name")})
    elapsed = time.perf_counter() - started
    history = (await client.get("/api/chat/history", params={"sessionId": session_id})).json()
    saved = (history.get("messages") or [{}])[-1]
    timings = (saved.get("thinking") or {}).get("stage_timings") or saved.get("stage_timings")
    return {"mode": mode, "session_id": session_id, "seconds": elapsed, "started_at": started_at, "ended_at": ended_at,
            "first_answer_seconds": first, "stage_timings": timings, "phase_events": phase_events,
            "answer": answer, "citations": citations, "source_names": names, "errors": errors, "phases": phases,
            "has_expected_source": any("Agent Harness Engineering" in name for name in names),
            "has_answer": bool(answer.strip())}


async def pi_load(client, kb):
    response = await client.post("/api/pi/runs", json={"client_request_id": uuid.uuid4().hex,
        "session_id": "pi-isolation-load", "message": LOAD_QUESTION, "knowledge_base_ids": [kb]})
    response.raise_for_status()
    return response.json()["id"]


async def condition(client, kb, loaded):
    runs = await asyncio.gather(*(pi_load(client, kb) for _ in range(2))) if loaded else []
    if runs:
        for _ in range(40):
            states = [(await client.get("/api/pi/runs/" + rid)).json()["status"] for rid in runs]
            if all(s != "queued" for s in states):
                break
            await asyncio.sleep(.25)
    pings, stop = [], asyncio.Event()
    async def health():
        while not stop.is_set():
            started = time.perf_counter()
            response = await client.get("/health")
            pings.append({"ms": (time.perf_counter() - started) * 1000, "status": response.status_code})
            await asyncio.sleep(.5)
    task = asyncio.create_task(health())
    try:
        results = await asyncio.gather(*(legacy(client, mode, kb) for mode in MODES))
    finally:
        stop.set()
        await task
    # History reads and health-task shutdown are outside the measured streams.
    # Retain per-stream windows so events after the last response cannot be
    # misclassified as concurrent model/tool admissions.
    windows = [(r["started_at"], r["ended_at"]) for r in results]
    final = []
    for rid in runs:
        state = (await client.get("/api/pi/runs/" + rid)).json()
        final.append({"run_id": rid, "status_at_controls_end": state["status"], "usage": state["state"].get("usage")})
        if state["status"] not in TERMINAL:
            await client.post("/api/pi/runs/" + rid + "/cancel")
        for _ in range(80):
            if (await client.get("/api/pi/runs/" + rid)).json()["status"] in TERMINAL:
                break
            await asyncio.sleep(.25)
        event_response = await client.get("/api/pi/runs/" + rid + "/events")
        events = [json.loads(line[5:]) for line in event_response.text.splitlines() if line.startswith("data:")]
        final[-1]["admissions_during_controls"] = [{"type": e["type"], "timestamp": e["timestamp"],
            "name": e["data"].get("name"), "purpose": e["data"].get("purpose")} for e in events
            if any(start <= e["timestamp"] <= end for start, end in windows) and e["type"] in {"model.started", "tool.started", "resource.waiting", "resource.resumed"}]
    return {"pi_load": final, "legacy": results, "health": pings}


async def main(args):
    out = Path(args.output)
    if out.exists():
        raise SystemExit("Receipt already exists; use a new output path to preserve earlier results.")
    out.parent.mkdir(parents=True, exist_ok=True)
    receipt = {"protocol": {"version": 3, "question": QUESTION, "pi_question": LOAD_QUESTION,
        "knowledge_base_id": args.kb, "repetitions": args.repetitions, "legacy_parallelism": 3, "pi_parallelism": 2,
        "latency_ratio_review_threshold": 1.25, "quality_gate": "answer + cited expected paper + no stream error",
        "limitations": "Small live smoke; source presence is not semantic entailment or a general no-regression proof."}, "rounds": []}
    async with httpx.AsyncClient(base_url=args.base, timeout=420, trust_env=False) as client:
        print("Warming legacy controls", flush=True)
        receipt["warmup"] = await condition(client, args.kb, False)
        schedule = (False, True, True, False) * (args.repetitions // 2)
        for index, loaded in enumerate(schedule):
            print(f"Round {index + 1}: {'concurrent Pi' if loaded else 'legacy control'}", flush=True)
            result = {"loaded": loaded, **await condition(client, args.kb, loaded)}
            receipt["rounds"].append(result)
            out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
            out.chmod(0o600)
            print([(r["mode"], round(r["seconds"], 1), r["has_expected_source"], len(r["errors"])) for r in result["legacy"]], flush=True)
    summary = {}
    for mode in MODES:
        controls = [r for group in receipt["rounds"] if not group["loaded"] for r in group["legacy"] if r["mode"] == mode]
        loaded = [r for group in receipt["rounds"] if group["loaded"] for r in group["legacy"] if r["mode"] == mode]
        ratio = statistics.median(r["seconds"] for r in loaded) / statistics.median(r["seconds"] for r in controls)
        summary[mode] = {"median_latency_ratio": ratio,
            "quality_gate": all(r["has_expected_source"] and r["has_answer"] and not r["errors"] for r in controls + loaded),
            "latency_review_required": ratio > 1.25}
    receipt["summary"] = summary
    out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--kb", default="cecac--a-f-99f0bf")
    parser.add_argument("--output", default="data/pi-agent-verification/isolation-live.json")
    parser.add_argument("--repetitions", type=int, choices=[2, 4, 6], default=2)
    asyncio.run(main(parser.parse_args()))
