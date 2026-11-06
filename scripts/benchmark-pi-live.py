#!/usr/bin/env python3
"""Paired old/new Pi answers on a frozen, read-only corpus with real providers.

Run only on explicitly selected evaluation sources. This creates isolated run
ledgers, never changes the knowledge index, and retains failures/timeouts. No
reference answer or qrel is sent to the agent. Credentials are read in process.
"""
import argparse
import asyncio
from collections import Counter
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import sys
import time
import uuid


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def run_process(command, cwd, timeout):
    """A hard measurement timeout must retain failure and stop its workers."""
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = process.communicate()
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr), timed_out


def all_events(store, run_id):
    events = []
    while True:
        page = store.events(run_id, after=events[-1]["seq"] if events else 0)
        if not page:
            return events
        events.extend(page)


async def wait_terminal(host, run_id, timeout):
    # Durable recovery can replace a settled job with another one. Waiting only
    # for the first job would incorrectly measure the intermediate queued state.
    deadline = time.perf_counter() + timeout
    while True:
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            raise asyncio.TimeoutError
        job = host.jobs.get(run_id)
        if host.store.get(run_id)["status"] in {"completed", "partial", "failed", "cancelled", "needs_input"}:
            if job and not job.done():
                await asyncio.wait_for(asyncio.shield(job), remaining)
            return
        if job:
            await asyncio.wait_for(asyncio.shield(job), remaining)
        await asyncio.sleep(min(.005, max(0, deadline - time.perf_counter())))


def imports(args):
    sys.path.insert(0, str(Path(args.code) / "backend"))
    from dotenv import load_dotenv
    load_dotenv(args.env, override=True)
    from loguru import logger
    logger.remove()


async def inventory(args):
    imports(args)
    from app.core.config import Settings
    from app.modules.pi_agent.catalog import SourceCatalog
    from minio import Minio
    from qdrant_client import AsyncQdrantClient, models as qm
    settings = Settings(_env_file=args.env)
    client = Minio(settings.minio_endpoint, access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key, secure=settings.minio_secure,
        region=settings.minio_region or "us-east-1")
    spec = json.loads(Path(args.cases).read_text())
    catalog = await asyncio.to_thread(SourceCatalog.load, client)
    selected = {f["fileId"] for f in spec.get("selected_files", [])}
    sources = sorted([asdict(s) for s in catalog.sources.values() if s.kb_id == spec["kb_id"]
        and (not selected or s.file_id in selected)], key=lambda s: s["id"])
    if len(sources) != 2 or any(s["modality"] != "doc" for s in sources):
        raise ValueError("This frozen six-case protocol requires exactly the two original papers")
    vectors = AsyncQdrantClient(**settings.get_qdrant_config())
    records = []
    try:
        cursor = None
        while True:
            points, cursor = await vectors.scroll("text_chunks_agentic", scroll_filter=qm.Filter(must=[
                qm.FieldCondition(key="file_id", match=qm.MatchAny(any=[s["file_id"] for s in sources]))]),
                offset=cursor, limit=128, with_payload=True, with_vectors=True)
            records.extend(point.model_dump(mode="json") for point in points)
            if cursor is None:
                break
    finally:
        await vectors.close()
    records.sort(key=lambda p: str(p["id"]))
    actual = {p["id"]: p for p in records}
    reference_matches = {}
    for name, ref in spec["reference_snapshots"].items():
        point = actual.get(ref["point_id"])
        reference_matches[name] = bool(point and sha(point["payload"]["text_content"].encode()) == ref["content_sha256"])
    result = {"sources": sources, "point_count": len(records), "sources_sha256": sha(canonical(sources).encode()),
        "index_sha256": sha(canonical(records).encode()), "reference_matches": reference_matches}
    if not all(reference_matches.values()):
        raise ValueError("Frozen reference snippets no longer match the current index")
    save(args.result, result)


async def sample(args):
    imports(args)
    from app.core.config import Settings
    from app.core.llm import LLMRegistry
    from app.modules.pi_agent.config import PiSettings
    from app.modules.pi_agent.contracts import RunRequest
    from app.modules.pi_agent.supervisor import PiSupervisor
    spec = json.loads(Path(args.cases).read_text())
    case = next(c for c in spec["cases"] if c["id"] == args.case_id)
    settings = PiSettings(_env_file=args.env, data_dir=Path(args.result).parent / (Path(args.result).stem + "-state"),
        model="deepseek:deepseek-flash", allowed_models=["deepseek:deepseek-flash"],
        runtime="core" if args.variant == "before" else "durable", thinking_enabled=False,
        answer_plan_enabled=True, answer_checks_enabled=False, allowed_kb_ids=[spec["kb_id"]],
        yield_to_legacy=False, max_concurrent_runs=1)
    registry = LLMRegistry(settings_override=Settings(_env_file=args.env))
    host = PiSupervisor(settings, registry)
    payload = {"client_request_id": str(uuid.uuid4()), "session_id": "ab-" + str(uuid.uuid4()),
        "message": case["question"], "knowledge_base_ids": [spec["kb_id"]], "language": "zh-CN"}
    selected = case.get("selected_files") or spec.get("selected_files")
    if selected:
        payload["selected_files"] = [{"kb_id": f["kbId"], "file_id": f["fileId"]} for f in selected]
    started, run_id, timed_out = time.perf_counter(), None, False
    try:
        run = await host.start(RunRequest(**payload), "evaluation")
        run_id = run["id"]
        try:
            await wait_terminal(host, run_id, args.timeout)
        except asyncio.TimeoutError:
            timed_out = True
            await host.cancel(run_id, "evaluation")
            if run_id in host.jobs:
                await asyncio.shield(host.jobs[run_id])
        elapsed = (time.perf_counter() - started) * 1000
        run = host.store.get(run_id)
        events = all_events(host.store, run_id)
        evidence = [e.model_dump(mode="json") for e in host.store.evidence(run_id)]
        state = run["state"]
        citations = state.get("citations", [])
        markers = {int(n) for n in re.findall(r"\[(\d+)\]", state.get("answer", ""))}
        ids = {c["id"] for c in citations}
        search_results = []
        for event in events:
            if event["type"] == "tool.completed" and event["data"].get("name") == "search":
                search_results.append(host.store.artifact(run_id, event["data"]["artifact_id"]))
        result = {"variant": args.variant, "case_id": case["id"], "repeat": args.repeat,
            "wall_ms": elapsed, "timed_out": timed_out, "run": run, "events": events, "evidence": evidence,
            "citation_identity": {"unknown_markers": sorted(markers - ids), "unused_citations": sorted(ids - markers)},
            "search_results": search_results, "tool_counts": dict(Counter(e["data"].get("name") for e in events if e["type"] == "tool.started")),
            "failed_tools": [e for e in events if e["type"] in {"tool.failed", "tool.rejected"}],
            "model_wall_sum_ms": sum(e["data"].get("duration_ms", 0) for e in events if e["type"] == "model.completed"),
            "search_wall_sum_ms": sum(e["data"].get("duration_ms", 0) for e in events if e["type"] == "tool.completed" and e["data"].get("name") == "search"),
            "local_encoders": "not preloaded in either isolated host; candidate must report fallback honestly"}
        save(args.result, result)
        print(canonical({"variant": args.variant, "case": case["id"], "repeat": args.repeat,
            "status": run["status"], "wall_ms": round(elapsed), "requests": state.get("usage", {}).get("model_requests")}))
    finally:
        await host.close()


def snapshot(code, destination):
    files = [*code.glob("agent-runtime/src/*.mjs"), code / "agent-runtime/package.json", code / "agent-runtime/package-lock.json",
        *code.glob("backend/app/modules/pi_agent/*.py"), code / "backend/app/modules/pi_agent/prompt_translations.json",
        code / "backend/app/core/sparse_encoder.py"]
    result = {}
    for path in sorted(files):
        raw = path.read_bytes()
        relative = path.relative_to(code)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        result[str(relative)] = sha(raw)
    return result


def orchestrate(args):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    before, after = Path(args.before).resolve(), Path(args.after).resolve()
    cases = Path(args.cases).resolve()
    spec = json.loads(cases.read_text())
    frozen = output / "cases.json"
    save(frozen, spec)
    (output / "runner-executed.py").write_bytes(Path(__file__).read_bytes())
    save(output / "protocol.json", {"baseline": "658b0d10080bdf2350e76be79e0bda1b461180f4", "repetitions": args.repetitions,
        "cases_sha256": sha(cases.read_bytes()), "runner_sha256": sha(Path(__file__).read_bytes()),
        "model": "deepseek:deepseek-flash", "answer_plan_enabled": True, "answer_checks_enabled": False,
        "thinking_enabled": False, "yield_to_legacy": False, "per_sample_timeout_seconds": args.timeout,
        "design": "six frozen source-grounded questions; alternate AB/BA per case, reverse next repetition; sequential actual provider calls",
        "scope": "two real papers, frozen points checked before and after; read-only index; independent run ledgers",
        "limits": "small known regression set, not blind holdout; no provider cache control; no significance/SLA claim; local sparse encoders not loaded",
        "code_hashes": {"before": snapshot(before, output / "source-before"), "after": snapshot(after, output / "source-after")}})
    common = [sys.executable, str(Path(__file__).resolve()), "--env", str(Path(args.env).resolve()), "--cases", str(frozen), "--timeout", str(args.timeout)]
    subprocess.run([*common, "--inventory", "--code", str(after), "--result", str(output / "inventory-before.json")], check=True)
    receipts = []
    for repeat in range(args.repetitions):
        for index, case in enumerate(spec["cases"]):
            for variant in (["before", "after"] if (index + repeat) % 2 == 0 else ["after", "before"]):
                result_path = output / f"r{repeat}-{case['id']}-{variant}.json"
                command = [*common, "--sample", "--code", str(before if variant == "before" else after),
                    "--variant", variant, "--case-id", case["id"], "--repeat", str(repeat), "--result", str(result_path)]
                print(f"START repeat={repeat} case={case['id']} variant={variant}", flush=True)
                completed, hard_timeout = run_process(command, output, args.timeout + 60)
                if result_path.exists():
                    receipt = json.loads(result_path.read_text())
                    print(completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else "sample saved", flush=True)
                else:
                    receipt = {"variant": variant, "case_id": case["id"], "repeat": repeat, "process_failed": True,
                        "hard_timeout": hard_timeout,
                        "exit_code": completed.returncode, "stderr_tail": completed.stderr[-2000:]}
                    save(result_path, receipt)
                    print(f"FAIL {variant} {case['id']} exit={completed.returncode}", flush=True)
                receipts.append(receipt)
                save(output / "progress.json", {"completed_samples": len(receipts), "expected_samples": len(spec["cases"]) * args.repetitions * 2})
    subprocess.run([*common, "--inventory", "--code", str(after), "--result", str(output / "inventory-after.json")], check=True)
    inventories = [json.loads((output / f"inventory-{name}.json").read_text()) for name in ["before", "after"]]
    summary = {"corpus_unchanged": inventories[0] == inventories[1], "semantic_review": "pending", "variants": {}}
    for variant in ["before", "after"]:
        rows = [r for r in receipts if r["variant"] == variant]
        valid = [r for r in rows if r.get("run")]
        durations = [r["wall_ms"] for r in valid]
        successful = [r for r in valid if r["run"]["status"] in {"completed", "partial"} and r["run"]["state"].get("answer")]
        success_durations = [r["wall_ms"] for r in successful]
        summary["variants"][variant] = {"samples": len(rows), "process_failed": sum(bool(r.get("process_failed")) for r in rows),
            "statuses": dict(Counter(r["run"]["status"] for r in valid)), "timeout_count": sum(r["timed_out"] for r in valid),
            "terminal_all_samples_median_ms": statistics.median(durations) if durations else None,
            "terminal_all_samples_mean_ms": statistics.mean(durations) if durations else None,
            "successful_samples": len(successful),
            "successful_wall_median_ms": statistics.median(success_durations) if success_durations else None,
            "successful_wall_mean_ms": statistics.mean(success_durations) if success_durations else None,
            "model_requests": sum(r["run"]["state"].get("usage", {}).get("model_requests", 0) for r in valid),
            "model_tokens": sum(r["run"]["state"].get("usage", {}).get("model_tokens", 0) for r in valid),
            "tool_calls": sum(sum(r["tool_counts"].values()) for r in valid),
            "tool_errors": sum(len(r["failed_tools"]) for r in valid)}
    grouped = {}
    for receipt in receipts:
        if receipt.get("run", {}).get("status") in {"completed", "partial"} and receipt["run"]["state"].get("answer"):
            grouped.setdefault((receipt["repeat"], receipt["case_id"]), {})[receipt["variant"]] = receipt
    paired = [values for values in grouped.values() if set(values) == {"before", "after"}]
    summary["matched_successful_pairs"] = {"n": len(paired),
        "candidate_faster_count": sum(p["after"]["wall_ms"] < p["before"]["wall_ms"] for p in paired),
        "mean_difference_ms": statistics.mean(p["after"]["wall_ms"] - p["before"]["wall_ms"] for p in paired) if paired else None,
        "median_difference_ms": statistics.median(p["after"]["wall_ms"] - p["before"]["wall_ms"] for p in paired) if paired else None,
        **{v + "_mean_ms": statistics.mean(p[v]["wall_ms"] for p in paired) if paired else None for v in ["before", "after"]},
        **{v + "_median_ms": statistics.median(p[v]["wall_ms"] for p in paired) if paired else None for v in ["before", "after"]}}
    save(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True)
    parser.add_argument("--cases", required=True)
    parser.add_argument("--before")
    parser.add_argument("--after")
    parser.add_argument("--output")
    parser.add_argument("--repetitions", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--code")
    parser.add_argument("--result")
    parser.add_argument("--case-id")
    parser.add_argument("--variant", choices=["before", "after"])
    parser.add_argument("--repeat", type=int)
    arguments = parser.parse_args()
    if arguments.inventory:
        asyncio.run(inventory(arguments))
    elif arguments.sample:
        asyncio.run(sample(arguments))
    else:
        orchestrate(arguments)
