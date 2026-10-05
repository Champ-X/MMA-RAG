import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from app.modules.pi_agent.contracts import RunBudget
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.requirements import apply_requirements, bind_requirements
from app.modules.pi_agent.store import RunConflict, RunStore
from app.modules.pi_agent.tools import AnswerRequirements, ToolSet
from test_pi_agent_tools import fixture_tools, request, source


def declaration(limit=4, quote="正文不超过4字", points=None):
    return {"max_characters": limit, "length_quote": quote,
            "required_points": points or ["回答问题"]}


def test_quote_origin_uses_unicode_positions_and_prefers_current_user_text():
    message = "😀问题；正文不超过4字。"
    bound = bind_requirements(declaration(), {"message": message,
        "history": [{"role": "user", "content": "正文不超过4字"}]})
    origin = bound["length_origin"]
    assert origin == {"kind": "current_question", "history_index": None, "start": 4, "end": 11}
    assert message[origin["start"]:origin["end"]] == bound["length_quote"]


def test_quote_can_bind_to_the_newest_visible_user_requirement():
    history = [{"role": "user", "content": "正文不超过4字"},
               {"role": "assistant", "content": "历史回答"},
               {"role": "user", "content": "继续，正文不超过4字"}]
    bound = bind_requirements(declaration(), {"message": "请回答", "history": history})
    assert bound["length_origin"] == {"kind": "history", "history_index": 2, "start": 3, "end": 10}


@pytest.mark.parametrize("history", [
    [{"role": "assistant", "content": "正文不超过4字"}],
    [{"role": "tool", "content": "正文不超过4字"}],
    [{"role": "user", "content": "正文不超过4字"}] + [{"role": "user", "content": "后来"}] * 8,
    [{"role": "user", "content": "长" * 2000 + "正文不超过4字"}],
])
def test_unseen_history_assistant_and_documents_cannot_supply_requirement_quotes(history):
    with pytest.raises(ToolError) as caught:
        bind_requirements(declaration(), {"message": "问题", "history": history})
    assert caught.value.code == "unknown_requirement_quote"


@pytest.mark.parametrize("args", [declaration(None), declaration(4, None), declaration(4, " "),
                                  declaration(points=[" "]), declaration(points=["重复", "重复"])])
def test_inconsistent_or_empty_declarations_are_rejected(args):
    with pytest.raises(ToolError):
        bind_requirements(args, {"message": "正文不超过4字"})


def test_no_limit_is_an_explicit_interpretation_without_a_fabricated_quote():
    bound = bind_requirements(declaration(None, None), {"message": "问题"})
    assert bound["length_origin"] is None and bound["max_characters"] is None
    assert "not independently verified" in bound["interpretation"]
    assert apply_requirements({"answer": "原文"}, bound) == {"answer": "原文", "max_characters": None}


@pytest.mark.parametrize("update", [{"max_characters": True}, {"max_characters": 0},
    {"max_characters": 24001}, {"required_points": []}, {"required_points": ["x"] * 13}])
def test_schema_bounds_requirement_inputs(update):
    with pytest.raises(ValidationError):
        AnswerRequirements.model_validate({**declaration(), **update})


@pytest.mark.parametrize("name,args", [
    ("list_sources", {}), ("search", {"query": "问题"}),
    ("read_source", {"source_id": source().id}),
    ("submit_answer", {"answer": "回答"}), ("check_answer", {"answer": "草稿"}),
])
@pytest.mark.asyncio
async def test_research_and_submission_require_registration_before_execution(tmp_path, name, args):
    tools, store, run, events = fixture_tools(tmp_path, register_requirements=False)
    result = await tools.execute("early", name, args)
    assert result["details"]["code"] == "answer_requirements_missing"
    assert not tools.ledger.tool_calls and not store.evidence(run) and not tools.final_result
    assert len(events) == 1 and events[0][0] == "tool.rejected"
    assert events[0][1]["executed"] is False
    question = await tools.execute("clarify", "ask_user", {"question": "请说明具体要求？"})
    assert question["details"]["terminal"] == "needs_input"


@pytest.mark.asyncio
async def test_registered_requirements_are_durable_and_idempotent_but_cannot_change(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, register_requirements=False,
                                       req=request(message="问题，正文不超过4字"))
    first = await tools.execute("register", "set_answer_requirements", declaration())
    assert not first.get("isError")
    bound = first["details"]["answer_requirements"]
    same = await tools.execute("retry", "set_answer_requirements", declaration())
    assert same["details"]["answer_requirements"] == bound
    changed = await tools.execute("erase", "set_answer_requirements", declaration(None, None))
    assert changed["details"]["code"] == "answer_requirements_locked"
    reopened = RunStore(tmp_path / "run.db")
    assert reopened.get(run)["state"]["answer_requirements"] == bound
    events = [e for e in reopened.events(run) if e["type"] == "answer.requirements"]
    assert len(events) == 1 and events[0]["data"] == bound
    assert events[0]["parent_span_id"] == "tool:register"
    restored = ToolSet(run, reopened, tools.catalog, tools.scope, tools.ledger,
                       tools.gateway, tools.media, tools.emit, tools.blocking, answer_checks_enabled=True)
    assert restored.answer_requirements == bound
    assert not (await restored.execute("read", "read_source", {"source_id": source().id})).get("isError")


@pytest.mark.parametrize("cap", ["omitted", None])
@pytest.mark.asyncio
async def test_omitted_or_null_final_limit_still_enforces_the_registered_limit(tmp_path, cap):
    tools, _, _, _ = fixture_tools(tmp_path, requirement_limit=4)
    await tools.execute("read", "read_source", {"source_id": source().id})
    args = {"answer": "实际原文长[1]", "evidence_ids": [1], "statements": [
        {"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]}
    if cap != "omitted":
        args["max_characters"] = cap
    check = await tools.execute("check", "check_answer", args)
    report = json.loads(check["content"][0]["text"])
    assert not report["protocol_valid"] and report["declared_max_characters"] == 4
    rejected = await tools.execute("reject", "submit_answer", args)
    assert rejected["details"]["code"] == "answer_too_long" and not tools.final_result
    assert args["answer"] == "实际原文长[1]"
    assert args.get("max_characters") is None
    args["answer"] = "实际原文[1]"
    accepted = await tools.execute("finish", "submit_answer", args)
    assert accepted["details"]["answer"] == args["answer"]
    assert accepted["details"]["answer_checks"]["declared_max_characters"] == 4


@pytest.mark.parametrize("cap", [3, 5])
@pytest.mark.asyncio
async def test_submissions_cannot_replace_registered_limit(tmp_path, cap):
    tools, *_ = fixture_tools(tmp_path, requirement_limit=4)
    result = await tools.execute("change", "submit_answer", {"answer": "原文", "max_characters": cap})
    assert result["details"]["code"] == "answer_requirement_conflict" and not tools.final_result


@pytest.mark.asyncio
async def test_oversized_requirement_result_cannot_register_or_publish_success(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path, RunBudget(tool_output_chars=1000), register_requirements=False)
    result = await tools.execute("big", "set_answer_requirements",
        declaration(None, None, [str(i) + "要" * 299 for i in range(4)]))
    assert result["isError"] and result["details"]["code"] == "tool_output_too_large"
    assert tools.answer_requirements is None and "answer_requirements" not in store.get(run)["state"]
    assert not any(e["type"] == "answer.requirements" for e in store.events(run))
    assert not any(kind == "tool.completed" for kind, _ in events)


def test_registration_state_and_event_roll_back_together(tmp_path, monkeypatch):
    _, store, run, _ = fixture_tools(tmp_path, register_requirements=False)
    before = store.get(run)
    bound = bind_requirements(declaration(None, None), before["request"])
    def fail(*args, **kwargs):
        raise RuntimeError("event write interrupted")
    with monkeypatch.context() as patch:
        patch.setattr(store, "_append", fail)
        with pytest.raises(RuntimeError):
            store.record_answer_requirements(run, bound)
    assert store.get(run) == before
    assert not any(e["type"] == "answer.requirements" for e in store.events(run))


@pytest.mark.parametrize("status", ["cancelling", "cancelled", "failed", "completed"])
def test_cancellation_or_terminal_state_prevents_late_requirement_registration(tmp_path, status):
    _, store, run, _ = fixture_tools(tmp_path, register_requirements=False)
    store.transition(run, status)
    with pytest.raises(RunConflict):
        store.record_answer_requirements(run, declaration(None, None))
    assert "answer_requirements" not in store.get(run)["state"]
    assert not any(e["type"] == "answer.requirements" for e in store.events(run))


def test_concurrent_duplicate_registration_emits_one_event_and_survives_restart(tmp_path):
    _, store, run, _ = fixture_tools(tmp_path, register_requirements=False)
    bound = bind_requirements(declaration(None, None), store.get(run)["request"])
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(lambda _: store.record_answer_requirements(run, bound), range(8)))
    assert all(r == bound for r in results)
    results[0]["required_points"].append("cannot mutate storage")
    reopened = RunStore(tmp_path / "run.db")
    reopened.recover_interrupted()
    assert reopened.get(run)["state"]["answer_requirements"] == bound
    assert reopened.get(run)["status"] == "failed"
    assert len([e for e in reopened.events(run) if e["type"] == "answer.requirements"]) == 1


@pytest.mark.asyncio
async def test_cancellation_while_preparing_requirements_does_not_commit_them(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path, register_requirements=False)
    reached, release = asyncio.Event(), asyncio.Event()
    original = tools._dispatch
    async def wait_before_result(*args):
        result = await original(*args)
        reached.set()
        await release.wait()
        return result
    tools._dispatch = wait_before_result
    task = asyncio.create_task(tools.execute("register", "set_answer_requirements", declaration(None, None)))
    await asyncio.wait_for(reached.wait(), 1)
    store.transition(run, "cancelling")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert tools.answer_requirements is None and "answer_requirements" not in store.get(run)["state"]
    assert any(kind == "tool.cancelled" for kind, _ in events)
