from concurrent.futures import ThreadPoolExecutor

import pytest

from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.store import RunConflict, RunNotFound, RunStore


def new_run(store, owner="alice", key="request-1"):
    return store.create(owner=owner, request={"client_request_id": key, "session_id": "session", "message": "问题"}, config={})[0]


def item(content="原文", version="sha256-v1"):
    return Evidence(source_id="kb/file/chunk", modality="doc", file_name="材料.pdf", content=content,
                    version=version, observation="parsed_text", locator={"page": 3})


def test_creation_is_idempotent_but_scope_or_question_change_is_rejected(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    run = new_run(store)
    assert new_run(store)["id"] == run["id"]
    with pytest.raises(RunConflict):
        store.create(owner="alice", request={"client_request_id": "request-1", "session_id": "session", "message": "另一个问题"}, config={})
    assert new_run(store, owner="bob")["id"] != run["id"]


def test_owner_cannot_read_another_run_events_evidence_or_artifacts(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    run = new_run(store)["id"]
    store.put_artifact(run, "tool-1", {"secret": "material"})
    for read in (lambda: store.get(run, owner="bob"), lambda: store.events(run, owner="bob"),
                 lambda: store.evidence(run, owner="bob"), lambda: store.artifact(run, "tool-1", owner="bob")):
        with pytest.raises(RunNotFound):
            read()
    assert store.list_runs("bob", "session") == []


def test_concurrent_events_have_gapless_sequences_and_replay_after_reopen(tmp_path):
    path = tmp_path / "runs.db"
    store = RunStore(path)
    run = new_run(store)["id"]
    store.transition(run, "running")
    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(lambda i: store.append(run, "tool.completed", {"index": i}), range(40)))
    reopened = RunStore(path)
    events = reopened.events(run, after=20, owner="alice")
    assert [event["seq"] for event in events] == list(range(21, 43))
    assert len({event["event_id"] for event in events}) == 22
    assert reopened.get(run)["seq"] == 42


def test_evidence_identity_is_immutable_and_versioned(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    run = new_run(store)["id"]
    first = store.add_evidence(run, item())
    again = store.add_evidence(run, item().model_copy(update={"provenance": {"query": "another"}}))
    changed = store.add_evidence(run, item("新版原文", "sha256-v2"))
    assert first.id == again.id == 1
    assert changed.id == 2
    assert [e.content for e in store.evidence(run)] == ["原文", "新版原文"]
    store.transition(run, "running")
    store.transition(run, "completed", state={"answer": "结论[1]", "citations": [1]})
    with pytest.raises(RunConflict):
        store.add_evidence(run, item("悄悄替换"))


def test_cancellation_wins_over_late_completion_and_state_is_atomic(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    run = new_run(store)["id"]
    store.transition(run, "running")
    store.transition(run, "cancelling", owner="alice")
    with pytest.raises(RunConflict):
        store.transition(run, "completed", state={"answer": "late answer"})
    assert "answer" not in store.get(run)["state"]
    store.transition(run, "cancelled")
    assert store.events(run)[-1]["type"] == "run.cancelled"
    with pytest.raises(RunConflict):
        store.append(run, "answer.delta", {"delta": "late"})


def test_restart_marks_interrupted_runs_and_retains_evidence(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    first = new_run(store)["id"]
    store.transition(first, "running")
    store.add_evidence(first, item())
    second = new_run(store, key="request-2")["id"]
    store.transition(second, "cancelling")
    assert store.recover_interrupted() == 2
    assert store.get(first)["status"] == "failed"
    assert store.get(second)["status"] == "cancelled"
    assert len(store.evidence(first)) == 1
    assert store.events(first)[-1]["data"]["code"] == "host_restarted"
    assert store.recover_interrupted() == 0


def test_tool_artifact_cannot_be_overwritten(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    run = new_run(store)["id"]
    store.put_artifact(run, "tool-1", {"text": "original"})
    store.put_artifact(run, "tool-1", {"text": "original"})
    with pytest.raises(RunConflict):
        store.put_artifact(run, "tool-1", {"text": "rewritten"})
