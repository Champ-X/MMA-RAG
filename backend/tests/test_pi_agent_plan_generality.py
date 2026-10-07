"""Different task families exercise one contract, including adversarial repairs."""
import copy
import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.answers import evidence_units, media_target_errors
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.plan import bind_plan, retained_evidence, plan_payload
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.tools import UpdateAnswerPlan
from test_pi_agent_tools import fixture_tools, request, source


def item(**changes):
    return {"id": "result", "requirement": "完成用户任务", "quote": "比较", "modality": "any", **changes}


def bind(items, delivered=None, *, message="比较各项结果", previous=None, spans=None):
    args = UpdateAnswerPlan(items=items, retained_spans=spans or []).model_dump()
    return bind_plan(args["items"], request(message=message).model_dump(), previous, delivered or {},
                     retained_spans=args["retained_spans"])


def documents(count=12):
    return {number: Evidence(id=number, source_id=f"unseen-{number}", modality="doc", file_name=f"报告-{number}.txt",
        content="引言🔎\n" * 350 + f"条件{number}：只适用于试验组，排除对照组。\n", version=f"v-{number}",
        observation="parsed_text") for number in range(1, count + 1)}


@pytest.mark.parametrize("answer", [
    "![图](some-source-identity)", "![图](drawing.png)",
    "![图](https://example.test/unretrieved.png)",
    "![图][asset]\n\n[asset]: unknown-target", "![图]()",
])
def test_rendered_image_addresses_require_selected_source_identity(answer):
    assert media_target_errors(answer, {"/api/selected-image"})[0]["code"] == "invalid_media_target"


@pytest.mark.parametrize("answer", [
    "![图](/api/selected-image)",
    "![图][asset]\n\n[asset]: /api/selected-image",
    "`![示例](unknown-target)`", "```markdown\n![示例](unknown-target)\n```",
    r"\![示例](unknown-target)", "<img src='unknown-target'>",
    "[普通链接](unknown-target)",
])
def test_images_resolve_but_code_escaped_text_and_nonrendered_html_remain_data(answer):
    assert media_target_errors(answer, {"/api/selected-image"}) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("checked", [False, True])
async def test_source_image_submission_rejects_an_unbound_address_and_agent_repairs(tmp_path, checked):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=checked, answer_plan_enabled=True,
        req=request(message="分析图片内容"))
    image = replace(source(), modality="image", name="drawing.png")
    tools.catalog = SourceCatalog([image], {"a": "A"})

    async def read(s, **kwargs):
        return [Evidence(source_id=s.id, modality="image", file_name=s.name, content="画面中有山丘。",
            version="v1", observation="media_observation", citation={"type": "image", "file_name": s.name})], {"status": "ok"}

    tools.gateway.read = read
    await tools.execute("plan", "update_answer_plan", {"items": [item(quote="分析")]})
    assert not (await tools.execute("read", "read_source", {"source_id": image.id})).get("isError")
    assert not (await tools.execute("ready", "update_answer_plan", {
        "items": [item(quote="分析", status="ready", evidence_ids=[1])]})).get("isError")
    args = {"answer": "山丘[1] ![图](some-source-identity)", "evidence_ids": [1]}
    if checked:
        args["statements"] = [{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]
        report = await tools.execute("check", "check_answer", args)
        assert json.loads(report["content"][0]["text"])["errors"][0]["code"] == "invalid_media_target"
    rejected = await tools.execute("invalid-image", "submit_answer", args)
    assert rejected["details"]["code"] == "invalid_media_target" and tools.final_result is None
    assert rejected["details"]["rejected_answer_span_id"] == "tool:invalid-image"
    accepted = await tools.execute("repair", "submit_answer", {**args, "answer": "山丘[1]"})
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["citations"][0]["img_url"] == tools.citation(tools.delivered[1])["img_url"]


@pytest.mark.asyncio
async def test_user_input_markdown_transformation_preserves_original_image_addresses(tmp_path):
    original = "![输入示例](relative-image.png)"
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message=f"保留下面的Markdown图片语法：{original}"))
    await tools.execute("ready", "update_answer_plan", {"items": [item(quote="保留", basis="user_input",
        status="ready", input_quotes=[original])]})
    result = await tools.execute("submit", "submit_answer", {"answer": original})
    assert result["details"]["terminal"] == "completed" and result["details"]["citations"] == []


@pytest.mark.asyncio
async def test_mixed_research_and_input_transform_preserves_only_bound_input_images(tmp_path):
    original = "![输入示例][asset]\n\n[asset]: relative-image.png"
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message=f"比较材料，并保留下面的Markdown图片语法：{original}"))
    plan = [item(), item(id="transform", quote="保留", basis="user_input",
        status="ready", input_quotes=[original])]
    assert not (await tools.execute("plan", "update_answer_plan", {"items": plan})).get("isError")
    await tools.execute("read", "read_source", {"source_id": source().id})
    plan[0].update(status="ready", evidence_ids=[1])
    assert not (await tools.execute("ready", "update_answer_plan", {"items": plan})).get("isError")
    unbound = await tools.execute("unbound", "submit_answer", {
        "answer": "实际原文[1]\n\n![其他图片](invented-image.png)", "evidence_ids": [1]})
    assert unbound["details"]["code"] == "invalid_media_target"
    accepted = await tools.execute("preserve", "submit_answer", {
        "answer": "实际原文[1]\n\n" + original, "evidence_ids": [1]})
    assert accepted["details"]["terminal"] == "completed"


def test_more_than_eight_deliverables_and_sources_fit_without_discarding_requirements():
    rows = documents()
    points = [item(id=f"result_{n}", status="ready", evidence_ids=[n]) for n in rows]
    plan = bind(points, rows)
    memory = retained_evidence(plan, rows)
    assert len(plan["items"]) == 12 and {entry["id"] for entry in memory} == set(rows)
    assert all(entry["content"] == rows[entry["id"]].content and not entry["retained_range"]["truncated"] for entry in memory)


def test_critical_tail_can_be_pinned_while_all_other_citation_identities_remain_available():
    rows = documents()
    tail = rows[12].content.index("条件12")
    plan = bind([item(status="ready", evidence_ids=list(rows))], rows,
                spans=[{"evidence_id": 12, "start": tail, "end": len(rows[12].content)}])
    memory = retained_evidence(plan, rows)
    pinned = next(entry for entry in memory if entry["id"] == 12)
    assert pinned["content"] == "条件12：只适用于试验组，排除对照组。\n"
    assert pinned["retained_range"]["start"] == tail and len(memory) == 12
    checked = next(entry for entry in retained_evidence(plan, rows, checked=True) if entry["id"] == 12)
    original_units = {unit["id"]: unit for unit in evidence_units(rows[12])}
    for unit in checked["content_units"]:
        assert unit["id"] in original_units
        assert unit["text"] == rows[12].content[unit["start"]:unit["end"]]
        assert unit["start"] >= original_units[unit["id"]]["start"] >= tail


def test_clipped_checked_unit_keeps_its_original_id_and_global_offsets():
    rows = documents(1)
    plan = bind([item(status="ready", evidence_ids=[1])], rows,
                spans=[{"evidence_id": 1, "start": 5, "end": 7}])
    unit = retained_evidence(plan, rows, checked=True)[0]["content_units"][0]
    original = next(part for part in evidence_units(rows[1]) if part["id"] == unit["id"])
    assert unit["id"] != "e1s1" and unit["text"] == rows[1].content[5:7]
    assert unit["truncated"] and unit["original_start"] == original["start"]


@pytest.mark.parametrize("spans,code", [
    ([{"evidence_id": 99, "start": 0, "end": 1}], "invalid_retained_span"),
    ([{"evidence_id": 1, "start": 2, "end": 1}], "invalid_retained_span"),
    ([{"evidence_id": 1, "start": 0, "end": 20000}], "invalid_retained_span"),
    ([{"evidence_id": 1, "start": 0, "end": 1}] * 2, "invalid_retained_span"),
])
def test_retention_cannot_invent_text_expand_selection_(spans, code):
    with pytest.raises(ToolError) as rejected:
        bind([item(status="ready", evidence_ids=list(range(1, 13)))], documents(), spans=spans)
    assert rejected.value.code == code


def test_discovered_requirements_can_be_appended_but_prior_contract_cannot_be_downgraded():
    original = bind([item()])
    expanded = bind([item(), item(id="conditions", quote="结果", requirement="回答适用条件")], previous=original)
    assert len(expanded["items"]) == 2
    with pytest.raises(ToolError, match="既有"):
        bind([item(basis="user_input", input_quotes=["比较"])], previous=original)


def test_omitted_retention_update_preserves_tail_and_explicit_clear_restores_defaults():
    rows = documents(1)
    tail = rows[1].content.index("条件1")
    original = bind([item(status="ready", evidence_ids=[1])], rows,
        spans=[{"evidence_id": 1, "start": tail, "end": len(rows[1].content)}])
    args = UpdateAnswerPlan(items=[item(status="ready", evidence_ids=[1])]).model_dump()
    updated = bind_plan(args["items"], request(message="比较").model_dump(), original, rows,
        retained_spans=args["retained_spans"])
    assert updated["retained_spans"] == original["retained_spans"]
    cleared = bind([item(status="ready", evidence_ids=[1])], rows, previous=updated, spans=[])
    assert cleared["retained_spans"] == []


@pytest.mark.parametrize("checked", [False, True])
def test_large_metadata_and_escaping_do_not_limit_final_selection(checked):
    rows = documents(26)
    for row in rows.values():
        row.file_name = "名称" * 150
        row.version = "a" * 64
        row.locator = {"chunk_index": row.id, "section_path": ["很长的标题" * 300], "query": {"other": "参数" * 300}}
        row.content = '"\n\\🔎' * 1500
    plan = bind([item(status="ready", evidence_ids=list(rows))], rows)
    payload = plan_payload(plan, rows, checked=checked)
    assert len(payload["retained_evidence"]) == len(rows)
    assert payload["answer_plan"]["items"][0]["evidence_ids"] == list(rows)
    for entry in payload["retained_evidence"]:
        assert entry["file_name_truncated"] and entry["locator_omitted_fields"]
        if checked:
            for unit in entry["content_units"]:
                assert unit["text"] == rows[entry["id"]].content[unit["start"]:unit["end"]]
        else:
            assert entry["content"] == rows[entry["id"]].content[:entry["retained_range"]["end"]]


def test_all_selected_evidence_is_retained_without_a_working_set_quota():
    rows = documents(100)
    points = [item(id="large", status="ready", evidence_ids=list(range(1, 100))),
              item(id="later", status="ready", evidence_ids=[100])]
    plan = bind(points, rows)
    payload = plan_payload(plan, rows)
    ids = {entry["id"] for entry in payload["retained_evidence"]}
    assert {1, 100} <= ids
    assert ids | set(payload["retention"]["omitted_evidence_ids"]) == set(rows)
    assert not payload["retention"]["omitted_evidence_ids"] and len(ids) == 100
    assert payload["answer_plan"] == plan


@pytest.mark.asyncio
@pytest.mark.parametrize("checked", [False, True])
@pytest.mark.parametrize("message,quote,answer", [
    ("把‘明天开会，请准时到’改成礼貌通知。", "明天开会，请准时到", "明天将举行会议，敬请准时出席。"),
    ("只输出结果：17×23。", "17×23", "391"),
    ("Translate exactly: The deployment is delayed.", "The deployment is delayed.", "部署延期了。"),
])
async def test_user_input_task_can_complete_without_search_or_fabricated_citations(tmp_path, checked, message, quote, answer):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=checked, answer_plan_enabled=True,
        req=request(message=message))
    points = [item(quote=message, basis="user_input", input_quotes=[quote], status="ready")]
    recorded = await tools.execute("plan", "update_answer_plan", {"items": points})
    assert not recorded.get("isError")
    args = {"answer": answer}
    if checked:
        args["statements"] = [{"unit_id": "a1", "kind": "inference", "source_spans": []}]
    result = await tools.execute("submit", "submit_answer", args)
    assert not result.get("isError") and result["details"]["terminal"] == "completed"
    assert result["details"]["answer"] == answer and result["details"]["citations"] == []
    assert tools.ledger.searches == 0 and not store.evidence(run)


@pytest.mark.asyncio
@pytest.mark.parametrize("quote", ["助手给出的资料事实", "不存在的用户原句", " "])
async def test_input_only_basis_cannot_be_forged_from_assistant_or_tool_text(tmp_path, quote):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="改写通知", history=[{"role": "assistant", "content": "助手给出的资料事实"}]))
    rejected = await tools.execute("plan", "update_answer_plan", {"items": [item(quote="通知", basis="user_input",
        input_quotes=[quote], status="ready")]})
    assert rejected["details"]["code"] == "invalid_answer_plan" and tools.answer_plan is None


@pytest.mark.asyncio
async def test_source_required_task_cannot_complete_without_evidence_or_switch_its_basis(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="根据资料比较"))
    await tools.execute("plan", "update_answer_plan", {"items": [item()]})
    rejected = await tools.execute("no-evidence", "update_answer_plan", {"items": [item(status="ready")]})
    assert rejected["details"]["code"] == "answer_plan_evidence_missing"
    changed = await tools.execute("bypass", "update_answer_plan", {"items": [item(basis="user_input",
        status="ready", input_quotes=["比较"])]})
    assert changed["details"]["code"] == "answer_plan_locked"
    incomplete = await tools.execute("submit", "submit_answer", {"answer": "两者相同。"})
    assert incomplete["details"]["code"] == "answer_delivery_incomplete"


@pytest.mark.asyncio
async def test_source_submission_needs_no_duplicate_answer_protocol_and_rejection_is_archivable(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="比较"))
    tools.emit = lambda kind, data, **kw: store.append(run, kind, data, **kw)
    await tools.execute("plan", "update_answer_plan", {"items": [item()]})
    await tools.execute("read", "read_source", {"source_id": source().id})
    await tools.execute("ready", "update_answer_plan", {"items": [item(status="ready", evidence_ids=[1])]})
    rejected = await tools.execute("bad", "submit_answer", {"answer": "依据不足以作比较。"})
    assert rejected["details"]["code"] == "missing_evidence"
    assert rejected["details"]["rejected_answer_span_id"] == "tool:bad"
    assert any(event["type"] == "tool.started" and event["span_id"] == "tool:bad" for event in store.events(run))
    accepted = await tools.execute("good", "submit_answer", {"answer": "比较结果[1]。", "evidence_ids": [1]})
    assert accepted["details"]["terminal"] == "completed"


@pytest.mark.asyncio
async def test_rejected_retention_update_cannot_change_committed_selection(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="比较"))
    await tools.execute("plan", "update_answer_plan", {"items": [item()]})
    await tools.execute("read", "read_source", {"source_id": source().id})
    await tools.execute("ready", "update_answer_plan", {"items": [item(status="ready", evidence_ids=[1])]})
    before = copy.deepcopy(tools.answer_plan)
    rejected = await tools.execute("bad", "update_answer_plan", {"items": [item(status="ready", evidence_ids=[1])],
        "retained_spans": [{"evidence_id": 1, "start": 1, "end": 9999}]})
    assert rejected["details"]["code"] == "invalid_retained_span"
    assert before == tools.answer_plan == store.get(run)["state"]["answer_plan"]


@pytest.mark.asyncio
async def test_plan_can_resolve_gaps_after_long_research_and_then_submit(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="比较"))
    await tools.execute("plan", "update_answer_plan", {"items": [item()]})
    tools.ledger.tool_calls = 1000
    resolved = await tools.execute("gap", "update_answer_plan", {"items": [item(status="unavailable", gap="本次未取得比较依据。") ]})
    assert not resolved.get("isError")
    accepted = await tools.execute("submit", "submit_answer", {"answer": "本次未取得比較所需依据。", "status": "partial",
        "outcome": "not_found", "limitations": ["本次未取得比较依据。"]})
    assert accepted["details"]["terminal"] == "partial"
    assert tools.ledger.tool_calls == 1002


@pytest.mark.asyncio
async def test_table_calculation_evidence_uses_the_same_delivery_contract(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="比较地区收入"))
    table = replace(source(), name="regions.csv")
    tools.catalog = SourceCatalog([table], {"a": "A"})
    def download(client, s, destination, **kwargs):
        assert s.id == table.id
        destination.write_text("地区,收入\n华东,120\n华东,80\n华西,60\n华西,90\n华南,110\n")
    tools.catalog.download = download
    tools.media = SimpleNamespace(storage=object())
    await tools.execute("plan", "update_answer_plan", {"items": [item()]})
    computed = await tools.execute("sum", "query_table", {"source_id": table.id,
        "operation": "sum", "value_column": "收入", "group_by": "地区"})
    assert not computed.get("isError")
    assert tools.delivered[1].observation == "calculation"
    assert all(number in tools.delivered[1].content for number in ['200', '150', '110'])
    await tools.execute("ready", "update_answer_plan", {"items": [item(status="ready", evidence_ids=[1])]})
    accepted = await tools.execute("submit", "submit_answer", {"answer": "地区汇总：华东200、华西150、华南110；最高与最低相差90[1]。",
        "evidence_ids": [1]})
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["citations"][0]["file_name"] == "regions.csv"
