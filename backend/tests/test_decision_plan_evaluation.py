"""Frozen fixture and denominator checks; no native calls."""
import importlib.util
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("evaluate_decision_plan", ROOT / "backend/scripts/evaluate_decision_plan.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def test_historical_protocol_and_sources_remain_immutable():
    folder = ROOT / "evals/decision_plan_v1"
    protocol = json.loads((folder / "protocol.json").read_text())
    cases = json.loads((folder / "cases.json").read_text())["cases"]
    assert hashlib.sha256((folder / "cases.json").read_bytes()).hexdigest() == protocol["cases_sha256"]
    for source, wanted in protocol["source_sha256"].items():
        assert hashlib.sha256((folder / "sources" / source).read_bytes()).hexdigest() == wanted
    assert len(cases) == 18
    assert len(protocol["models"]) == 3
    assert protocol["transport"]["retries"] == 0


def test_failed_expected_action_remains_a_false_negative_in_full_denominator():
    case = {"expected_applied_ids": ["p1"], "expected_relations": {"p1": "verified"}}
    receipt = {"status": "fallback", "request_count": 1, "applied_ids": [], "actions": []}
    grade = evaluation.grade(case, receipt)
    summary = evaluation.summarize([{"provider": "typesafe", "case_id": "failed", "receipt": receipt, "grade": grade}])
    counts = summary["groups"]["typesafe"]["counts"]
    assert counts["attempted_cases"] == counts["fallback_cases"] == counts["false_negative"] == 1
    assert counts["relation_evaluated"] == 0
    assert summary["groups"]["typesafe"]["incorrect_action_case_ids"] == ["failed"]
