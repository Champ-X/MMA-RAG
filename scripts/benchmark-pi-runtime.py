#!/usr/bin/env python3
"""Controlled old/new Pi worker benchmark; only a localhost fixture provider is used.

Run from the candidate checkout with its Python environment. The two checkouts
must already have their own lockfile-installed agent-runtime/node_modules.
Artifacts include every HTTP body, host event, final state, code hashes and the
exact subprocess commands. No application service or real provider is used.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import sys
import threading
import time
from types import SimpleNamespace


FIXTURE = {
    "kb_id": "bench-kb", "file_id": "11111111-1111-1111-1111-111111111111",
    "file_name": "runtime-fixture.txt", "source_version": "runtime-fixture-v1",
    "content": "Tessmora benchmark fixture: the documented release year is 2026.",
    "question": "Read runtime-fixture.txt and report its documented release year with a citation.",
}
TERMINAL = {"completed", "partial", "failed", "cancelled", "needs_input"}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Provider:
    def __init__(self, scenario, source_id):
        self.requests = []
        self.scenario, self.source_id = scenario, source_id
        self.fault_ready, self.release = threading.Event(), threading.Event()
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                index = len(provider.requests)
                provider.requests.append({"index": index, "received_ns": time.perf_counter_ns(), "body": body})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                try:
                    if provider.scenario == "model_stream_kill" and index == 0:
                        self.wfile.write(b'data: {"choices":[{"index":0,"delta":{"content":"unfinished draft"}}]}\n\n')
                        self.wfile.flush()
                        provider.fault_ready.set()
                        provider.release.wait(12)
                        return
                    messages = body.get("messages", [])
                    calls = [call for message in messages for call in message.get("tool_calls", [])]
                    names = {call["function"]["name"] for call in calls}
                    if provider.scenario == "ask_reply" and "ask_user" not in names:
                        name, args = "ask_user", {"question": "Which year should I verify?", "options": ["2026"]}
                    elif "list_sources" not in names:
                        name, args = "list_sources", {"query": "runtime-fixture"}
                    elif "read_source" not in names:
                        name, args = "read_source", {"source_id": provider.source_id, "start": 0, "limit": 1}
                    else:
                        name, args = "submit_answer", {"answer": "The documented release year is 2026 [1].",
                            "status": "completed", "outcome": "answer", "evidence_ids": [1], "limitations": []}
                    frames = [
                        {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0,
                            "id": f"call-{name}", "type": "function", "function": {
                                "name": name, "arguments": json.dumps(args)}}]}}]},
                        {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                            "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}},
                    ]
                    self.wfile.write(("".join("data: " + json.dumps(frame) + "\n\n" for frame in frames)
                        + "data: [DONE]\n\n").encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01), daemon=True)
        self.thread.start()

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)


async def run_trial(args):
    repo, output = Path(args.repo).resolve(), Path(args.output).resolve()
    sys.path.insert(0, str(repo / "backend"))
    from app.modules.pi_agent.catalog import SourceCatalog, Source, source_id
    from app.modules.pi_agent.config import PiSettings
    from app.modules.pi_agent.contracts import RunRequest
    from app.modules.pi_agent.supervisor import PiSupervisor
    from app.modules.pi_agent.tools import ToolSet

    source = Source(id=source_id(FIXTURE["kb_id"], FIXTURE["file_id"]), kb_id=FIXTURE["kb_id"],
        file_id=FIXTURE["file_id"], name=FIXTURE["file_name"], modality="doc",
        version=FIXTURE["source_version"], size=len(FIXTURE["content"]), bucket="kb-bench-kb")
    # Both versions see the identical immutable source and index payload.
    SourceCatalog.load = classmethod(lambda cls, *a, **kw: SourceCatalog([source], {FIXTURE["kb_id"]: "Fixture"}))
    provider = Provider(args.scenario, source.id)
    vectors_calls, tool_calls = [], []

    class Registry:
        def list_models(self, kind):
            return ["fixture:test"]
        def list_providers(self):
            return ["fixture"]
        def get_model_config(self, name):
            return {"type": "chat", "provider": "fixture", "raw_model": "test", "context_length": 64000, "max_output_tokens": 1000}
        def get_provider(self, name):
            return SimpleNamespace(api_key="localhost-fixture-only", base_url=f"http://127.0.0.1:{provider.server.server_port}")

    class Vectors:
        async def scroll(self, collection, **kwargs):
            vectors_calls.append({"method": "scroll", "collection": collection, "time_ns": time.perf_counter_ns()})
            return [SimpleNamespace(id="fixture-point", payload={"kb_id": source.kb_id, "file_id": source.file_id,
                "chunk_index": 0, "text_content": FIXTURE["content"]})], None
        async def count(self, collection, **kwargs):
            vectors_calls.append({"method": "count", "collection": collection, "time_ns": time.perf_counter_ns()})
            conditions = kwargs["count_filter"].must
            after = any(getattr(item, "key", None) == "chunk_index" and getattr(item, "range", None)
                and item.range.gte >= 1 for item in conditions)
            return SimpleNamespace(count=0 if after else 1)
        async def close(self):
            pass

    settings = PiSettings(data_dir=output / "state", model="fixture:test", runtime=args.runtime,
        answer_plan_enabled=False, answer_checks_enabled=False, yield_to_legacy=False,
        allowed_models=["fixture:test"], max_concurrent_runs=1)
    host = PiSupervisor(settings, Registry(), storage=object(), vector_client=Vectors())
    original_execute = ToolSet.execute
    fault = {"injected": False}

    async def intercepted(toolset, call_id, name, raw):
        before_io = len(vectors_calls)
        value = await original_execute(toolset, call_id, name, raw)
        call = {"call_id": call_id, "name": name, "args": raw, "result": value,
            "index_io": len(vectors_calls) - before_io, "returned_ns": time.perf_counter_ns()}
        tool_calls.append(call)
        if args.scenario == "tool_receipt_kill" and name == "read_source" and not fault["injected"]:
            fault.update(injected=True, at_ns=time.perf_counter_ns(), point="after_tool_execute_before_pipe_reply",
                receipt_api=hasattr(host.store, "operation_results"), completed_evidence=len(host.store.evidence(toolset.run_id)))
            if hasattr(host.store, "operation_results"):
                fault["operation_receipts_at_kill"] = host.store.operation_results(toolset.run_id)
            process = host.processes[toolset.run_id]
            process.kill()
            await process.wait()
        return value

    ToolSet.execute = intercepted
    run_id, error, reply_at, initial_status = None, None, None, None
    started = time.perf_counter_ns()
    try:
        run = await host.start(RunRequest(client_request_id="runtime-benchmark", session_id="runtime-benchmark",
            message=FIXTURE["question"], language="en"), "benchmark-owner")
        run_id = run["id"]
        async with asyncio.timeout(20):
            while True:
                if args.scenario == "model_stream_kill" and provider.fault_ready.is_set() and not fault["injected"]:
                    process = host.processes[run_id]
                    fault.update(injected=True, at_ns=time.perf_counter_ns(), point="after_partial_http_sse_before_terminal_response")
                    process.kill()
                    await process.wait()
                    provider.release.set()
                state = host.store.get(run_id)
                if state["status"] in TERMINAL:
                    # Ensure callbacks/pipe draining have finished before reply
                    # or considering the terminal state final.
                    job = host.jobs.get(run_id)
                    if job:
                        await asyncio.shield(job)
                    state = host.store.get(run_id)
                    if state["status"] not in TERMINAL:
                        continue
                    if args.scenario == "ask_reply" and state["status"] == "needs_input" and reply_at is None:
                        initial_status = state["status"]
                        if not hasattr(host, "submit_input"):
                            break
                        from app.modules.pi_agent.contracts import RunInput
                        reply_at = time.perf_counter_ns()
                        await host.submit_input(run_id, "benchmark-owner", RunInput(
                            request_id="runtime-benchmark-reply", message="Please verify 2026.", mode="reply"))
                        continue
                    break
                await asyncio.sleep(.001)
        ended = time.perf_counter_ns()
    except Exception as exc:
        ended = time.perf_counter_ns()
        error = f"{type(exc).__name__}: {exc}"
    finally:
        provider.release.set()
        await host.close()
        provider.close()
        ToolSet.execute = original_execute
    state = host.store.get(run_id) if run_id else {}
    events = host.store.events(run_id, limit=10000) if run_id else []
    evidence = [item.model_dump() for item in host.store.evidence(run_id)] if run_id else []
    first_request_ns = provider.requests[0]["received_ns"] if provider.requests else None
    summary = {
        "variant": args.variant, "runtime": args.runtime, "scenario": args.scenario,
        "replicate": args.replicate, "warmup": args.warmup, "repo": str(repo),
        "duration_ms": (ended - started) / 1e6,
        "first_request_ms": (first_request_ns - started) / 1e6 if first_request_ns else None,
        "after_first_request_ms": (ended - first_request_ns) / 1e6 if first_request_ns else None,
        "recovery_ms": (ended - fault["at_ns"]) / 1e6 if fault["injected"] else None,
        "reply_ms": (ended - reply_at) / 1e6 if reply_at else None,
        "success": state.get("status") == "completed", "status": state.get("status"),
        "code": state.get("state", {}).get("code"), "run_id": run_id,
        "model_requests": len(provider.requests), "index_scrolls": sum(c["method"] == "scroll" for c in vectors_calls),
        "tool_rpc_count": len(tool_calls), "unique_tool_ids": len({c["call_id"] for c in tool_calls}),
        "evidence_count": len(evidence), "usage": state.get("state", {}).get("usage"),
        "same_run_reply_supported": hasattr(host, "submit_input"), "initial_status": initial_status,
        "fault": fault, "error": error,
    }
    summary["fixture_content_preserved"] = bool(evidence) and all(item["content"] == FIXTURE["content"] for item in evidence)
    summary["reply_present_in_last_request"] = bool(reply_at and provider.requests
        and "Please verify 2026." in json.dumps(provider.requests[-1]["body"]))
    expected_status = "completed" if args.runtime == "durable" or args.scenario == "normal" else (
        "needs_input" if args.scenario == "ask_reply" else "failed")
    summary["expectation_passed"] = not error and state.get("status") == expected_status
    if summary["success"]:
        summary["expectation_passed"] &= summary["fixture_content_preserved"] and len(evidence) == 1
    if args.runtime == "durable" and args.scenario == "tool_receipt_kill":
        summary["expectation_passed"] &= summary["model_requests"] == 3 and summary["index_scrolls"] == 1
    if args.runtime == "durable" and args.scenario == "ask_reply":
        summary["expectation_passed"] &= summary["reply_present_in_last_request"]
    write_json(output / "record.json", {"summary": summary, "fixture": FIXTURE, "source": asdict(source),
        "provider_requests": provider.requests, "tool_calls": tool_calls, "index_calls": vectors_calls,
        "events": events, "final_state": state, "evidence": evidence})
    print(json.dumps(summary, ensure_ascii=False))


def percentile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    lower = int(position)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower)


def aggregate(records):
    result = {}
    for variant in {r["variant"] for r in records}:
        result[variant] = {}
        for scenario in {r["scenario"] for r in records}:
            rows = [r for r in records if r["variant"] == variant and r["scenario"] == scenario and not r["warmup"]]
            if not rows:
                continue
            result[variant][scenario] = {"n": len(rows), "successes": sum(r["success"] for r in rows),
                "success_rate": statistics.mean(r["success"] for r in rows),
                "statuses": sorted({r["status"] for r in rows}), "errors": [r["error"] for r in rows if r["error"]],
                "expectations_passed": sum(r["expectation_passed"] for r in rows)}
            for key in ("duration_ms", "first_request_ms", "after_first_request_ms", "recovery_ms", "reply_ms",
                        "model_requests", "index_scrolls", "tool_rpc_count", "unique_tool_ids", "evidence_count"):
                vals = [r[key] for r in rows if r[key] is not None]
                if vals:
                    result[variant][scenario][key] = {"p50": percentile(vals, .5), "p95": percentile(vals, .95),
                        "min": min(vals), "max": max(vals), "mean": statistics.mean(vals)}
    return result


def main(args):
    if args.trial:
        asyncio.run(run_trial(args))
        return
    output = Path(args.output).resolve()
    if (output / "manifest.json").exists():
        raise ValueError("Use a fresh output directory so old run databases cannot affect the benchmark")
    output.mkdir(parents=True, exist_ok=True)
    variants = [("baseline-core-1.0.3", Path(args.baseline).resolve(), "core"),
        ("candidate-durable-1.5.0", Path(args.candidate).resolve(), "durable")]
    source_files = sorted({"agent-runtime/package.json", "agent-runtime/package-lock.json", *(
        str(path.relative_to(repo)) for _, repo, _ in variants for directory, pattern in (
            ("agent-runtime/src", "*.mjs"), ("backend/app/modules/pi_agent", "*.py"),
            ("backend/app/modules/pi_agent", "*.json")) for path in (repo / directory).glob(pattern))})
    manifest = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "python": sys.version,
        "platform": platform.platform(), "machine": platform.machine(), "cpu_count": os.cpu_count(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "benchmark_sha256": sha(__file__), "fixture_sha256": hashlib.sha256(json.dumps(FIXTURE, sort_keys=True).encode()).hexdigest(),
        "fixture": FIXTURE, "seed": 20261106, "normal_repeats": args.normal, "fault_repeats": args.faults,
        "warmup_repeats": args.warmups, "measurement": "host.start through settled host job; host initialization and Python imports excluded",
        "scope": "real PiSupervisor, real Node workers, real SQLite; local deterministic HTTP provider and in-memory fixed index adapter",
        "limitations": ["not production model/retrieval/answer-quality latency", "same-run reply unsupported by baseline is not emulated",
            "1ms terminal polling contributes measurement quantization", "existing machine workloads are not isolated",
            "fixed provider usage tokens are protocol fixtures, not actual model tokenizer usage", "no cross-version database reuse"],
        "variants": {}}
    for variant, repo, runtime in variants:
        package = json.loads((repo / "agent-runtime/package.json").read_text())
        manifest["variants"][variant] = {"repo": str(repo), "runtime": runtime, "dependencies": package["dependencies"],
            "source_hashes": {file: sha(repo / file) for file in source_files if (repo / file).is_file()}}
        for file in manifest["variants"][variant]["source_hashes"]:
            target = output / "sources" / variant / file
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repo / file, target)
    manifest["baseline_commit"] = "658b0d10080bdf2350e76be79e0bda1b461180f4"
    manifest["candidate_base_commit"] = subprocess.check_output(["git", "-C", args.candidate, "rev-parse", "HEAD"], text=True).strip()
    write_json(output / "manifest.json", manifest)
    (output / "candidate.patch").write_bytes(subprocess.check_output(["git", "-C", args.candidate, "diff", "--", "agent-runtime", "backend/app/modules/pi_agent"]))
    commands, records = [], []
    order = random.Random(20261106)
    plan = [("normal", i, True) for i in range(args.warmups)] + [("normal", i, False) for i in range(args.normal)]
    plan += [(scenario, i, False) for scenario in ("model_stream_kill", "tool_receipt_kill", "ask_reply") for i in range(args.faults)]
    for scenario, replicate, warmup in plan:
        pair = list(variants)
        order.shuffle(pair)
        for variant, repo, runtime in pair:
            directory = output / variant / (f"warmup-{replicate:02d}" if warmup else f"{scenario}-{replicate:02d}")
            command = [sys.executable, str(Path(__file__).resolve()), "--trial", "--repo", str(repo), "--output", str(directory),
                "--variant", variant, "--runtime", runtime, "--scenario", scenario, "--replicate", str(replicate)]
            if warmup:
                command.append("--warmup")
            commands.append(command)
            env = {**os.environ, "PYTHONPATH": str(repo / "backend"), "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
            completed = subprocess.run(command, cwd=repo, env=env, text=True, capture_output=True, timeout=45)
            directory.mkdir(parents=True, exist_ok=True)
            (directory / "stdout.log").write_text(completed.stdout)
            (directory / "stderr.log").write_text(completed.stderr)
            if completed.returncode or not (directory / "record.json").exists():
                write_json(output / "commands.json", commands)
                raise RuntimeError(f"Trial failed ({completed.returncode}): {directory}; {completed.stderr[-2000:]}")
            record = json.loads((directory / "record.json").read_text())["summary"]
            records.append(record)
            write_json(output / "records.json", records)
            write_json(output / "summary.json", aggregate(records))
            write_json(output / "commands.json", commands)
            print(f"{variant} {scenario} {replicate} warmup={warmup}: {record['status']} {record['duration_ms']:.1f}ms requests={record['model_requests']}", flush=True)
    manifest["ended_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for variant, repo, _ in variants:
        entry = manifest["variants"][variant]
        entry["ending_source_hashes"] = {file: sha(repo / file) for file in source_files if (repo / file).is_file()}
        entry["source_changed_during_benchmark"] = entry["source_hashes"] != entry["ending_source_hashes"]
    write_json(output / "manifest.json", manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="/tmp/tessmora-pi-baseline-658b0d1")
    parser.add_argument("--candidate", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output", required=True)
    parser.add_argument("--normal", type=int, default=20)
    parser.add_argument("--faults", type=int, default=5)
    parser.add_argument("--warmups", type=int, default=2)
    parser.add_argument("--trial", action="store_true")
    parser.add_argument("--repo")
    parser.add_argument("--variant")
    parser.add_argument("--runtime", default="durable")
    parser.add_argument("--scenario", default="normal")
    parser.add_argument("--replicate", type=int, default=0)
    parser.add_argument("--warmup", action="store_true")
    main(parser.parse_args())
