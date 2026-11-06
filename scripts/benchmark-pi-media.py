#!/usr/bin/env python3
"""Paired, controlled Pi media cache/concurrency experiment; no provider calls.

Usage: .venv/bin/python scripts/benchmark-pi-media.py --repeats 5

Both variants import frozen real MediaInspector/RunStore/SourceCatalog sources
in separate Python processes. Original-object download, ffprobe/ffmpeg and the
observation service are deterministic local stubs. The service waits 20 ms by
default. Timings measure this controlled workload, NOT production media quality,
decoder throughput, provider latency, or billed dollars. All attempts, including
failed subprocesses and invariant failures, are retained under runs/.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "backend/app/modules/pi_agent/__init__.py",
    "backend/app/modules/pi_agent/media.py",
    "backend/app/modules/pi_agent/media_cache.py",
    "backend/app/modules/pi_agent/media_observation_store.py",
    "backend/app/modules/pi_agent/catalog.py",
    "backend/app/modules/pi_agent/contracts.py",
    "backend/app/modules/pi_agent/policy.py",
    "backend/app/modules/pi_agent/store.py",
    "backend/app/modules/pi_agent/language.py",
    "backend/app/modules/pi_agent/prompt_translations.json",
    "backend/app/core/prompt_language.py",
]
SCENARIOS = ["first_single_packet", "first_multi_packet", "same_run_repeat", "cross_run_repeat",
             "host_reopen_repeat", "different_question", "different_version", "different_owner",
             "different_scope", "denied_permission"]
QUESTION = "只描述这段音频实际可听见的内容。"
ROUTE = {"name": "controlled:audio-v1", "model": "controlled-audio-v1", "provider": "controlled-stub",
         "base_url": "https://benchmark.invalid/no-network"}


def digest(value):
    raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def git(*arguments):
    return subprocess.check_output(["git", *arguments], cwd=ROOT)


def freeze(destination, ref=None):
    hashes = {}
    for relative in FILES:
        if ref:
            result = subprocess.run(["git", "show", f"{ref}:{relative}"], cwd=ROOT, capture_output=True)
            if result.returncode:
                if relative.endswith("media_observation_store.py"):
                    hashes[relative] = None  # This feature is absent at baseline.
                    continue
                raise RuntimeError(result.stderr.decode())
            raw = result.stdout
        else:
            raw = (ROOT / relative).read_bytes()
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        hashes[relative] = digest(raw)
    return hashes


class MeasuredSemaphore:
    """A thin probe around the same asyncio.Semaphore used by the implementation."""
    def __init__(self, capacity):
        self.semaphore = asyncio.Semaphore(capacity)
        self.active = self.peak = 0

    async def __aenter__(self):
        await self.semaphore.acquire()
        self.active += 1
        self.peak = max(self.peak, self.active)
        return self

    async def __aexit__(self, *_):
        self.active -= 1
        self.semaphore.release()

    def reset(self):
        assert self.active == 0
        self.peak = 0


async def worker(args):
    # Each process resolves app.* solely from its frozen variant snapshot.
    sys.path.insert(0, str(args.snapshot / "backend"))
    from app.modules.pi_agent import media
    from app.modules.pi_agent.catalog import Source, SourceCatalog
    from app.modules.pi_agent.contracts import Evidence, RunRequest
    from app.modules.pi_agent.policy import AccessScope, ToolError, UsageLedger
    from app.modules.pi_agent.store import RunStore, fingerprint
    from app.core.prompt_language import prompt_language

    persistent = (args.snapshot / "backend/app/modules/pi_agent/media_observation_store.py").is_file()
    if persistent:
        from app.modules.pi_agent.media_observation_store import MediaObservationStore
    args.state_dir.mkdir(parents=True, exist_ok=True)
    run_store = RunStore(args.state_dir / "runs.sqlite3")
    records = []
    current = {"downloads": [], "decodes": [], "calls": []}
    start_clock = time.perf_counter()

    async def subprocess_stub(*command):
        current["decodes"].append({"program": command[0], "argv": list(command[1:]),
                                   "at_ms": (time.perf_counter() - start_clock) * 1000})
        if command[0] == "ffprobe":
            return json.dumps({"format": {"duration": "120"}, "streams": [{"codec_type": "audio"}]}).encode()
        if command[0] != "ffmpeg":
            raise AssertionError("Only the declared local decoder stubs are permitted")
        path = Path(command[command.index("-i") + 1])
        start = command[command.index("-ss") + 1]
        length = command[command.index("-t") + 1]
        return b"controlled-decoded-audio:" + path.read_bytes() + f":{start}:{length}".encode()

    media.subprocess_bytes = subprocess_stub
    sample = b"controlled-original-audio:v1"
    original = Source("bench-source", "bench-kb", "bench-file", "controlled.mp3", "audio", "v1", len(sample),
                      bucket="controlled-bucket", object_path="audios/controlled.mp3")

    def build(source=original, *, owner="owner-a", scope_variant=False, single=False, denied=False, seed_evidence=False):
        request = RunRequest(client_request_id=str(uuid.uuid4()), session_id="controlled-media-benchmark",
                             message=QUESTION, knowledge_base_ids=[] if denied else ["bench-kb", *( ["other-kb"] if scope_variant else [])])
        scope = AccessScope.from_request(request, set() if denied else {"bench-kb", "other-kb"})
        catalog = SourceCatalog([source], {"bench-kb": "Controlled sample", "other-kb": "Scope fixture"})

        def download(_storage, item, destination):
            # This is intentionally not MinIO, a network download, or a decoder.
            body = b"controlled-original-audio:" + item.version.encode()
            if len(body) != item.size:
                raise AssertionError("Fixture source length mismatch")
            current["downloads"].append({"source_id": item.id, "source_version": item.version, "sha256": digest(body)})
            destination.write_bytes(body)

        catalog.download = download
        ledger = UsageLedger()
        provider_gate = MeasuredSemaphore(2)
        call_counter = 0

        async def observe(parts, *, kind, input_units, parent):
            nonlocal call_counter
            async with provider_gate:
                call_counter += 1
                call_id = -call_counter
                ledger.start_model(call_id)
                signature = digest({"route": ROUTE, "kind": kind, "parts": parts})
                receipt = {"model": ROUTE["name"], "usage": {"total_tokens": 64}, "benchmark_stub": True}
                call = {"signature": signature, "kind": kind, "input_units": input_units, "parent": parent,
                        "started_ms": (time.perf_counter() - start_clock) * 1000, "stub_delay_ms": args.delay_ms}
                current["calls"].append(call)
                try:
                    await asyncio.sleep(args.delay_ms / 1000)
                    observation = "Controlled observation " + signature
                    ledger.settle_model(call_id, {"totalTokens": 64})
                    call.update(completed_ms=(time.perf_counter() - start_clock) * 1000,
                                observation_sha256=digest(observation.encode()))
                    return observation, receipt
                except BaseException:
                    call["failed"] = True
                    raise

        async def blocking(function, *positional):
            return function(*positional)

        settings = SimpleNamespace(max_concurrent_media=2, max_concurrent_media_packets=2,
                                   audio_model=ROUTE["name"], vision_model="controlled:vision-v1")
        kwargs = {}
        if persistent:
            kwargs = {"observation_store": MediaObservationStore(args.state_dir / ("single-observations.sqlite3" if single else "observations.sqlite3")),
                      "cache_namespace": fingerprint({"owner": owner, "scope": scope.public()})}
        inspector = media.MediaInspector(catalog, object(), SimpleNamespace(observe=observe, _endpoint=lambda *_: dict(ROUTE)),
                                         ledger, settings, blocking, **kwargs)
        inspector.gate, inspector.prepared_gate = MeasuredSemaphore(2), MeasuredSemaphore(2)
        run, _ = run_store.create(owner=owner, request=request.model_dump(), config={"fixture": True})
        run_store.transition(run["id"], "running")
        if seed_evidence:
            # A pre-existing citation ensures cache reuse cannot pass this
            # benchmark merely by returning the old run's numeric IDs 1..4.
            run_store.add_evidence(run["id"], Evidence(source_id="unrelated-source", modality="doc",
                file_name="unrelated.txt", content="Existing citation in the new run", version="v1", observation="parsed_text"))
        return SimpleNamespace(inspector=inspector, source=source, scope=scope, catalog=catalog, ledger=ledger,
                               provider_gate=provider_gate, run_id=run["id"], owner=owner, seed_evidence=seed_evidence)

    async def measure(name, environment, *, question=QUESTION, end=120, expected_error=None):
        for values in current.values():
            values.clear()
        for gate in (environment.inspector.gate, environment.inspector.prepared_gate, environment.provider_gate):
            gate.reset()
        before = environment.ledger.snapshot()
        packets = []
        result = None
        error = None

        def publish(evidence, *, reused):
            stored = run_store.add_evidence(environment.run_id, evidence)
            packets.append({"evidence": stored.model_dump(), "reused": reused})
            return stored

        started = time.perf_counter()
        try:
            # The real per-run authorization check is deliberately before any
            # cached observation lookup, as in ToolSet.inspect_media.
            source = environment.catalog.get(environment.source.id, environment.scope)
            with prompt_language("zh-CN"):
                result = await environment.inspector.inspect(source, question=question, start_sec=0, end_sec=end,
                    view="audio", page=1, span_id=f"benchmark:{name}", on_packet=publish)
        except Exception as cause:
            error = {"type": type(cause).__name__, "code": getattr(cause, "code", None), "message": str(cause)}
        elapsed = (time.perf_counter() - started) * 1000
        normalized = [{key: item["evidence"][key] for key in
                       ("source_id", "content", "version", "observation", "locator")}
                      for item in sorted(packets, key=lambda item: item["evidence"]["locator"].get("start_sec", 0))]
        after = environment.ledger.snapshot()
        persisted = run_store.evidence(environment.run_id)
        raw = {"scenario": name, "variant": args.variant, "repetition": args.repetition, "pid": os.getpid(),
               "phase": args.phase, "elapsed_ms": elapsed, "measurement_boundary": "authorization + inspect + per-run evidence persistence",
               "run_id": environment.run_id, "source": {"id": environment.source.id, "version": environment.source.version},
               "scope": environment.scope.public(), "owner": environment.owner, "question": question, "route": ROUTE,
               "status": "expected_denial" if expected_error and error and error["code"] == expected_error else "error" if error else "ok",
               "error": error, "provider_requests": len(current["calls"]), "cost_usd": None,
               "cost_proxy": "number of calls to controlled observation stub; no billed requests",
               "download_count": len(current["downloads"]), "decoder_count": len(current["decodes"]),
               "local_gate_peak": environment.inspector.gate.peak, "prepared_gate_peak": environment.inspector.prepared_gate.peak,
               "provider_gate_peak": environment.provider_gate.peak, "reused_packets": sum(item["reused"] for item in packets),
               "packet_count": len(packets), "packet_evidence_ids": [item["evidence"]["id"] for item in packets],
               "current_run_evidence_count": len(persisted), "seeded_evidence_count": int(environment.seed_evidence),
               "packets_match_current_run_evidence": all(any(stored.model_dump() == packet["evidence"] for stored in persisted)
                                                         for packet in packets),
               "semantic_sha256": digest(normalized), "aggregate_sha256": digest(result.content.encode()) if result else None,
               "aggregate": result.model_dump() if result else None, "packets": packets,
               "usage_delta": {key: after[key] - before[key] for key in after if key != "duration_ms"},
               "raw_downloads": list(current["downloads"]), "raw_decodes": list(current["decodes"]), "raw_model_calls": list(current["calls"])}
        records.append(raw)
        save(args.json_out, {"records": records, "persistent_observations_available": persistent,
                             "source_module": media.__file__, "pid": os.getpid(), "python": sys.version})
        return raw

    async def finish(environment):
        await environment.inspector.close()
        run_store.transition(environment.run_id, "completed", state={"fixture": True})

    if args.phase == "reopen":
        environment = build(seed_evidence=True)
        await measure("host_reopen_repeat", environment)
        await finish(environment)
    else:
        single = build(single=True)
        await measure("first_single_packet", single, end=30)
        await finish(single)
        first = build()
        await measure("first_multi_packet", first)
        await measure("same_run_repeat", first)
        await finish(first)
        for name, options, question in [
            ("cross_run_repeat", {"seed_evidence": True}, QUESTION),
            ("different_question", {}, QUESTION + "特别留意背景声。"),
            ("different_version", {"source": replace(original, version="v2")}, QUESTION),
            ("different_owner", {"owner": "owner-b"}, QUESTION),
            ("different_scope", {"scope_variant": True}, QUESTION),
            ("denied_permission", {"denied": True}, QUESTION),
        ]:
            environment = build(**options)
            await measure(name, environment, question=question, expected_error="scope_denied" if name == "denied_permission" else None)
            await finish(environment)
    save(args.json_out, {"records": records, "persistent_observations_available": persistent,
                         "source_module": media.__file__, "pid": os.getpid(), "python": sys.version})


def summarize(records, repeats):
    grouped = {(variant, scenario): [row for row in records if row["variant"] == variant and row["scenario"] == scenario]
               for variant in ("baseline", "current") for scenario in SCENARIOS}
    comparisons, checks = [], []
    for scenario in SCENARIOS:
        pair = {}
        for variant in ("baseline", "current"):
            rows = grouped[variant, scenario]
            pair[variant] = {"n": len(rows), "median_ms": statistics.median(row["elapsed_ms"] for row in rows) if rows else None,
                "min_ms": min((row["elapsed_ms"] for row in rows), default=None),
                "max_ms": max((row["elapsed_ms"] for row in rows), default=None),
                "provider_requests": [row["provider_requests"] for row in rows],
                "provider_gate_peak": max((row["provider_gate_peak"] for row in rows), default=0),
                "prepared_gate_peak": max((row["prepared_gate_peak"] for row in rows), default=0),
                "reused_packets": [row["reused_packets"] for row in rows], "statuses": [row["status"] for row in rows]}
            for row in rows:
                expected_calls = 0 if scenario in {"same_run_repeat", "denied_permission"} or variant == "current" and scenario in {
                    "cross_run_repeat", "host_reopen_repeat"} else 1 if scenario == "first_single_packet" else 4
                expected_status = "expected_denial" if scenario == "denied_permission" else "ok"
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "request_count_and_status", "passed": row["provider_requests"] == expected_calls and row["status"] == expected_status,
                    "expected_calls": expected_calls, "observed_calls": row["provider_requests"]})
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "bounded_gates", "passed": all(row[key] <= 2 for key in ("local_gate_peak", "prepared_gate_peak", "provider_gate_peak"))})
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "packet_coverage", "passed": row["packet_count"] == (0 if scenario == "denied_permission" else 1 if scenario == "first_single_packet" else 4)})
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "current_run_evidence_binding", "passed": row["packets_match_current_run_evidence"]
                        and row["current_run_evidence_count"] == row["packet_count"] + row["seeded_evidence_count"]
                        and sorted(row["packet_evidence_ids"]) == list(range(1 + row["seeded_evidence_count"],
                                                                           1 + row["seeded_evidence_count"] + row["packet_count"]))})
                expected_downloads = 0 if scenario in {"same_run_repeat", "denied_permission"} else 1
                expected_decodes = 0 if expected_downloads == 0 else expected_calls + 1
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "authorization_fetch_and_decode_boundary", "passed": row["download_count"] == expected_downloads
                        and row["decoder_count"] == expected_decodes})
                checks.append({"variant": variant, "scenario": scenario, "repetition": row["repetition"],
                    "name": "fresh_request_usage_only", "passed": row["usage_delta"]["model_requests"] == expected_calls
                        and row["usage_delta"]["model_tokens"] == expected_calls * 64})
        left, right = grouped["baseline", scenario], grouped["current", scenario]
        paired = [(a, b) for a in left for b in right if a["repetition"] == b["repetition"]]
        content_equal = len(paired) == repeats and all(a["semantic_sha256"] == b["semantic_sha256"]
            and a["aggregate_sha256"] == b["aggregate_sha256"] for a, b in paired)
        checks.append({"scenario": scenario, "name": "paired_observation_and_evidence_equality", "passed": content_equal})
        baseline_ms, current_ms = pair["baseline"]["median_ms"], pair["current"]["median_ms"]
        comparisons.append({"scenario": scenario, **pair, "paired_content_equal": content_equal,
            "median_change_percent": (current_ms / baseline_ms - 1) * 100 if baseline_ms and current_ms is not None else None,
            "controlled_speedup": baseline_ms / current_ms if current_ms and baseline_ms else None})
    for variant in ("baseline", "current"):
        for repetition in range(repeats):
            rows = {row["scenario"]: row for row in records if row["variant"] == variant and row["repetition"] == repetition}
            reference = rows.get("first_multi_packet")
            for scenario in ("same_run_repeat", "cross_run_repeat", "host_reopen_repeat"):
                row = rows.get(scenario)
                checks.append({"variant": variant, "repetition": repetition, "scenario": scenario,
                    "name": "reuse_preserves_content", "passed": bool(reference and row and reference["semantic_sha256"] == row["semantic_sha256"])})
            reopened, cross = rows.get("host_reopen_repeat"), rows.get("cross_run_repeat")
            checks.append({"variant": variant, "repetition": repetition, "name": "genuine_process_reopen",
                           "passed": bool(reopened and cross and reopened["pid"] != cross["pid"])})
            for scenario in ("different_question", "different_version"):
                row = rows.get(scenario)
                checks.append({"variant": variant, "repetition": repetition, "scenario": scenario,
                    "name": "changed_input_changes_observation", "passed": bool(reference and row and
                        reference["semantic_sha256"] != row["semantic_sha256"])})
    return {"comparisons": comparisons, "checks": checks, "checks_passed": sum(check["passed"] for check in checks),
            "checks_total": len(checks), "failures": [check for check in checks if not check["passed"]]}


def main(args):
    baseline = git("rev-parse", args.baseline).decode().strip()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    destination = args.output.resolve() / "runs" / stamp
    destination.mkdir(parents=True)
    hashes = {variant: freeze(destination / "snapshots" / variant, baseline if variant == "baseline" else None)
              for variant in ("baseline", "current")}
    (destination / "benchmark-pi-media.py").write_bytes(Path(__file__).read_bytes())
    manifest = {"experiment": "controlled-media-cache-and-concurrency", "baseline_commit": baseline,
        "current": "uncommitted working-tree snapshot", "head_at_capture": git("rev-parse", "HEAD").decode().strip(),
        "source_hashes": hashes, "script_sha256": digest(Path(__file__).read_bytes()), "python": str(args.python),
        "platform": platform.platform(), "repetitions": args.repeats, "stub_delay_ms": args.delay_ms,
        "fixture": {"source": "synthetic local byte fixture; not valid encoded audio", "duration_seconds": 120,
                    "packet_seconds": 30, "view": "audio", "language": "zh-CN", "question": QUESTION,
                    "source_v1_sha256": digest(b"controlled-original-audio:v1"), "route": ROUTE},
        "scope": "real MediaInspector/cache/evidence persistence; stubbed download/decoders/observation service",
        "limitations": ["No paid requests, external downloads, or production cache writes.",
            "The 20ms default wait is an experimental control, not measured provider latency.",
            "Request counts are a cost proxy, not dollar savings; semantic model quality is not evaluated.",
            "Operation latency excludes Python import, cache schema initialization and run creation.",
            "Runs use identical source/question/route; changed-input scenarios explicitly alter one named factor.",
            "This checks single-host completed-result reuse; it does not claim cross-process in-flight deduplication."],
        "captured_at": datetime.now(timezone.utc).isoformat()}
    save(destination / "manifest.json", manifest)
    records, processes = [], []
    for repetition in range(args.repeats):
        # Alternate A/B order; the controlled service dominates neither process
        # startup nor cache-schema initialization because both are out of timing.
        for variant in (["baseline", "current"] if repetition % 2 == 0 else ["current", "baseline"]):
            state = destination / "raw" / variant / f"repeat-{repetition}"
            state.mkdir(parents=True)
            for phase in ("warm", "reopen"):
                output = state / f"{phase}.json"
                command = [str(args.python), str(Path(__file__).resolve()), "--worker", "--snapshot", str(destination / "snapshots" / variant),
                    "--state-dir", str(state), "--variant", variant, "--phase", phase, "--repetition", str(repetition),
                    "--delay-ms", str(args.delay_ms), "--json-out", str(output)]
                process = subprocess.run(command, cwd=state, capture_output=True, text=True,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
                (state / f"{phase}.stdout.log").write_text(process.stdout)
                (state / f"{phase}.stderr.log").write_text(process.stderr)
                processes.append({"variant": variant, "repetition": repetition, "phase": phase, "exit_code": process.returncode,
                                  "output": str(output.relative_to(destination))})
                if output.is_file():
                    records.extend(json.loads(output.read_text())["records"])
    summary = {**summarize(records, args.repeats), "manifest": manifest, "processes": processes,
               "process_failures": sum(process["exit_code"] != 0 for process in processes), "raw_records": len(records),
               "run_directory": str(destination)}
    save(destination / "results.json", summary)
    save(args.output / "summary.json", summary)
    save(args.output / "latest.json", {"run_directory": str(destination), "results": str(destination / "results.json")})
    lines = ["scenario,baseline_median_ms,current_median_ms,change_percent,baseline_requests,current_requests,content_equal"]
    for row in summary["comparisons"]:
        lines.append(",".join(map(str, [row["scenario"], row["baseline"]["median_ms"], row["current"]["median_ms"],
            row["median_change_percent"], ";".join(map(str, row["baseline"]["provider_requests"])),
            ";".join(map(str, row["current"]["provider_requests"])), row["paired_content_equal"]])))
    (destination / "summary.csv").write_text("\n".join(lines) + "\n")
    (args.output / "summary.csv").write_text("\n".join(lines) + "\n")
    print(json.dumps({"run_directory": str(destination), "records": len(records), "checks_passed": summary["checks_passed"],
        "checks_total": summary["checks_total"], "process_failures": summary["process_failures"]}))
    return 1 if summary["failures"] or summary["process_failures"] else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="658b0d1")
    parser.add_argument("--output", type=Path, default=ROOT / "data/pi-ab-20261106/media")
    parser.add_argument("--python", type=Path, default=ROOT / ".venv/bin/python")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--delay-ms", type=float, default=20)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--snapshot", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--state-dir", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--json-out", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--variant", help=argparse.SUPPRESS)
    parser.add_argument("--phase", choices=["warm", "reopen"], help=argparse.SUPPRESS)
    parser.add_argument("--repetition", type=int, help=argparse.SUPPRESS)
    arguments = parser.parse_args()
    if arguments.repeats < 1 or arguments.delay_ms < 0:
        parser.error("repeats must be positive and delay-ms must be nonnegative")
    if arguments.worker:
        asyncio.run(worker(arguments))
    else:
        raise SystemExit(main(arguments))
