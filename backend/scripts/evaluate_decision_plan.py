"""Frozen proposal verification; no planner generation or retrieval quality claim.

Default invocation verifies hashes without calls. --live writes a NEW directory,
never retries a failure, and never changes the user's saved Decision settings.
"""
import argparse
import asyncio
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def load_protocol(path):
    from app.modules.retrieval.processors.decision_plan import prepare_verification, VERIFIED_THRESHOLD
    protocol = json.loads(path.read_text())
    case_path = path.parent / protocol["cases_file"]
    assert digest(case_path.read_bytes()) == protocol["cases_sha256"], "Frozen cases or labels changed"
    cases = json.loads(case_path.read_text())["cases"]
    assert len({row["id"] for row in cases}) == len(cases)
    for source, wanted in protocol["source_sha256"].items():
        assert digest((ROOT / source).read_bytes()) == wanted, "Source changed; create a new protocol"
    assert protocol["threshold"] == VERIFIED_THRESHOLD
    for case in cases:
        state, questions, _ = prepare_verification(case["query"], case["baseline"])
        assert digest(canonical({"state": state, "questions": questions})) == case["input_sha256"]
    return protocol, cases


def grade(case, receipt):
    expected, actual = set(case["expected_applied_ids"]), set(receipt["applied_ids"])
    relations = {row["id"]: row["decision"] for row in receipt["actions"] if "decision" in row}
    return {
        "true_positive": sorted(expected & actual), "false_positive": sorted(actual - expected),
        "false_negative": sorted(expected - actual), "exact_actions": expected == actual,
        "relation_correct": sum(value == relations.get(key) for key, value in case["expected_relations"].items() if key in relations),
        "relation_evaluated": sum(key in relations for key in case["expected_relations"]),
    }


def summarize(rows):
    groups = {}
    for provider in sorted({row["provider"] for row in rows}):
        selected = [row for row in rows if row["provider"] == provider]
        counts = Counter()
        for row in selected:
            counts["attempted_cases"] += 1
            counts["native_requests"] += row["receipt"]["request_count"]
            counts[row["receipt"]["status"] + "_cases"] += 1
            for field in ("true_positive", "false_positive", "false_negative"):
                counts[field] += len(row["grade"][field])
            counts["exact_action_cases"] += row["grade"]["exact_actions"]
            counts["relation_correct"] += row["grade"]["relation_correct"]
            counts["relation_evaluated"] += row["grade"]["relation_evaluated"]
        groups[provider] = {"counts": dict(counts), "incorrect_action_case_ids": [
            row["case_id"] for row in selected if not row["grade"]["exact_actions"]],
            "non_success_case_ids": [row["case_id"] for row in selected if row["receipt"]["status"] != "ok"]}
    return {"groups": groups, "scope": "manually prepared proposals, no generative planner or knowledge retrieval",
            "limitations": ["small diagnostic fixture", "single annotator", "not independent accuracy benchmark",
                            "skipped and failed cases retained", "no threshold selection on this fixture"]}


async def run(protocol_path, output):
    from app.core.config import settings
    from app.core.decision_providers import DECISION_CREDENTIALS, DECISION_ENDPOINTS
    from app.core.llm.jev import JevClient
    from app.modules.retrieval.processors.decision_plan import verify_plan
    protocol, cases = load_protocol(protocol_path)
    clients = {}
    for route in protocol["models"]:
        provider = route["provider"]
        credential = getattr(settings, DECISION_CREDENTIALS[provider][0])
        if not credential:
            raise ValueError(f"Missing credential for {provider}; no native requests started")
        endpoint = settings.bailian_decision_endpoint if provider == "bailian" else DECISION_ENDPOINTS[provider]
        clients[provider] = JevClient(credential, provider=provider, model=route["model"], endpoint=endpoint,
                                     timeout_s=3.0, max_input_tokens=200000)
    output.mkdir(parents=True, exist_ok=False)
    for name in ("protocol.json", "cases.json"):
        shutil.copyfile(protocol_path.parent / name, output / name)
    rows = []
    with (output / "receipts.jsonl").open("x") as log:
        for index, case in enumerate(cases):
            routes = protocol["models"] if index % 2 == 0 else list(reversed(protocol["models"]))
            for route in routes:
                client = clients[route["provider"]]
                captured = {}
                class RecordingClient:
                    timeout_s = 3.0
                    async def evaluate(self, *args, **kwargs):
                        result = await client.evaluate(*args, **kwargs)
                        captured.update(answers=deepcopy(result.answers), metadata=result.metadata())
                        return result
                result = await verify_plan(case["query"], deepcopy(case["baseline"]), client_factory=RecordingClient)
                receipt = result["decision_plan"]
                row = {**route, "case_id": case["id"], "timestamp": datetime.now(timezone.utc).isoformat(),
                       "protocol_sha256": digest(protocol_path.read_bytes()), "input_sha256": case["input_sha256"],
                       "receipt": receipt, "grade": grade(case, receipt), **captured}
                rows.append(row)
                log.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                log.flush()
                print(case["id"], route["provider"], receipt["status"], receipt["applied_ids"], flush=True)
    # If live code drifted, retain receipts but do not silently declare the frozen run valid.
    load_protocol(protocol_path)
    summary = summarize(rows)
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, default=ROOT / "evals/decision_plan_v1/protocol.json")
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    protocol, cases = load_protocol(args.protocol)
    if not args.live:
        print(json.dumps({"verified": True, "cases": len(cases), "providers": protocol["models"],
                          "protocol_sha256": digest(args.protocol.read_bytes()), "native_calls": 0}, indent=2))
        return
    if args.output is None:
        parser.error("--live requires a new --output directory")
    print(json.dumps(asyncio.run(run(args.protocol, args.output)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
