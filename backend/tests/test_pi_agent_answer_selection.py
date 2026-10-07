"""Final citations follow the answer, never a presentation or plan whitelist."""
from dataclasses import replace
import json

import pytest

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence
from test_pi_agent_tools import fixture_tools, request, source


@pytest.mark.asyncio
@pytest.mark.parametrize("modality", ["doc", "image", "audio", "video"])
@pytest.mark.parametrize("checked", [False, True])
@pytest.mark.parametrize("cite_support", [False, True])
async def test_plans_do_not_force_extra_citations_or_hide_newly_cited_material(tmp_path, modality, checked, cite_support):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=checked,
        answer_plan_enabled=True, req=request(message="选择符合要求的材料并说明理由"))
    sources = [replace(source(fid=str(n)), modality=modality, name=f"材料{n}") for n in (1, 2)]
    tools.catalog = SourceCatalog(sources, {"a": "A"})

    async def read(s, **kwargs):
        return [Evidence(source_id=s.id, modality=modality, file_name=s.name,
            content=s.name + "的原始内容", version="v1", observation="caption",
            citation={"type": modality, "file_name": s.name})], {"status": "ok"}

    tools.gateway.read = read
    item = {"id": "result", "requirement": "选择符合要求的材料", "quote": "选择符合要求的材料"}
    await tools.execute("plan", "update_answer_plan", {"items": [item]})
    for n, s in enumerate(sources):
        assert not (await tools.execute(f"read-{n}", "read_source", {"source_id": s.id})).get("isError")
    await tools.execute("select", "update_answer_plan", {"items": [{**item, "status": "ready", "evidence_ids": [1],
        "supporting_evidence_ids": [] if cite_support else [2]}]})
    answer = "匹配结果[1]，必要的条件[2]。" if cite_support else "匹配结果[1]。"
    ids = [1, 2] if cite_support else [1]
    args = {"answer": answer, "evidence_ids": ids}
    if checked:
        args["statements"] = [{"unit_id": "a1", "kind": "fact", "source_spans": [f"e{n}s1" for n in ids]}]
        report = await tools.execute("check", "check_answer", args)
        assert not json.loads(report["content"][0]["text"])["errors"]
    accepted = await tools.execute("finish", "submit_answer", args)
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["answer"] == answer
    assert [c["id"] for c in accepted["details"]["citations"]] == ids
    assert len(store.evidence(run)) == 2, "Research history remains complete"


@pytest.mark.asyncio
async def test_requested_comparison_can_select_counterevidence_without_a_positive_only_filter(tmp_path):
    tools, _, _, _ = fixture_tools(tmp_path, answer_checks_enabled=False, answer_plan_enabled=True,
        req=request(message="比较两份材料的适用条件和不适用情形"))
    item = {"id": "compare", "requirement": "比较适用条件和反例", "quote": "比较两份材料的适用条件和不适用情形"}
    await tools.execute("plan", "update_answer_plan", {"items": [item]})
    await tools.execute("read", "read_source", {"source_id": source().id})
    # A separate observation of the same source can provide a material caveat.
    tools.delivered[2] = tools.delivered[1].model_copy(update={"id": 2, "content": "仅适用试验组，不适用对照组"})
    await tools.execute("select", "update_answer_plan", {"items": [{**item, "status": "ready",
        "evidence_ids": [1], "supporting_evidence_ids": [2]}]})
    accepted = await tools.execute("compare", "submit_answer", {
        "answer": "方案的条件见材料[1]，对照组不适用[2]。", "evidence_ids": [1, 2]})
    assert accepted["details"]["terminal"] == "completed"
    assert [c["id"] for c in accepted["details"]["citations"]] == [1, 2]
