import copy
import json
from dataclasses import replace

import pytest

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.plan import retained_evidence
from app.modules.pi_agent.store import RunStore
from test_pi_agent_tools import fixture_tools, request, source


QUESTION = "结合电影剧情，为其挑选海报封面和主题曲。"


def items():
    return [{"id": "cover", "requirement": "按剧情选封面", "quote": "海报封面", "modality": "image"},
            {"id": "song", "requirement": "按剧情选主题曲", "quote": "主题曲", "modality": "audio"}]


def make_tools(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path, answer_checks_enabled=False,
        answer_plan_enabled=True, req=request(message=QUESTION))
    sources = [replace(source(fid=kind), name=name, modality=kind)
               for kind, name in [("image", "海报.png"), ("audio", "歌曲.mp3"), ("video", "电影.mp4")]]
    tools.catalog = SourceCatalog(sources, {"a": "A"})

    async def read(s, **kwargs):
        return [Evidence(source_id=s.id, modality=s.modality, file_name=s.name,
            content=s.name + "原文🔎" * 450, version="v1", observation="caption",
            citation={"type": s.modality, "file_name": s.name})], {"status": "ok"}
    tools.gateway.read = read
    return tools, store, run, events, sources


async def select(tools, sources):
    await tools.execute("plan", "update_answer_plan", {"items": items()})
    for s in sources:
        assert not (await tools.execute(s.id, "read_source", {"source_id": s.id})).get("isError")
    selected = items()
    selected[0].update(status="ready", evidence_ids=[1], supporting_evidence_ids=[3])
    selected[1].update(status="ready", evidence_ids=[2], supporting_evidence_ids=[3])
    result = await tools.execute("select", "update_answer_plan", {"items": selected})
    assert not result.get("isError")
    return selected, result


@pytest.mark.asyncio
async def test_media_answer_keeps_all_cited_assets_without_plan_based_filtering(tmp_path):
    tools, store, run, _, sources = make_tools(tmp_path)
    missing = await tools.execute("premature", "read_source", {"source_id": sources[0].id})
    assert missing["details"]["code"] == "answer_plan_missing"
    await select(tools, sources)
    revised = {"answer": "海报.png[1]与歌曲.mp3[2]呼应电影的氛围[3]。", "evidence_ids": [1, 2, 3]}
    accepted = await tools.execute("submit", "submit_answer", revised)
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["answer"] == revised["answer"]
    citations = accepted["details"]["citations"]
    assert citations[0]["img_url"] and citations[1]["audio_url"] and citations[2]["video_url"]
    assert store.get(run)["state"]["answer_plan"]["items"][0]["evidence_ids"] == [1]


@pytest.mark.asyncio
@pytest.mark.parametrize("change,code", [("omit", "answer_plan_locked"), ("quote", "answer_plan_locked"),
    ("type", "answer_plan_locked"), ("foreign", "invalid_evidence"), ("wrong_media", "answer_plan_modality")])
async def test_plan_cannot_drop_requirements_or_select_unavailable_or_wrong_media(tmp_path, change, code):
    tools, store, run, _, sources = make_tools(tmp_path)
    selected, _ = await select(tools, sources)
    before = copy.deepcopy(store.get(run)["state"]["answer_plan"])
    if change == "omit": selected.pop()
    elif change == "quote": selected[0]["quote"] = "其他用户的话"
    elif change == "type": selected[0]["modality"] = "video"
    elif change == "foreign": selected[0]["evidence_ids"] = [99]
    else: selected[0]["evidence_ids"] = [3]
    rejected = await tools.execute("bad-selection", "update_answer_plan", {"items": selected})
    assert rejected["details"]["code"] == code
    assert store.get(run)["state"]["answer_plan"] == before


@pytest.mark.asyncio
async def test_retention_is_verbatim_and_survives_store_reopen(tmp_path):
    tools, store, run, _, sources = make_tools(tmp_path)
    _, result = await select(tools, sources)
    payload = json.loads(result["content"][0]["text"])
    assert len(payload["retained_evidence"]) == 3 and len(store.evidence(run)) == 3
    for retained in payload["retained_evidence"]:
        original = tools.delivered[retained["id"]]
        assert retained["content"] == original.content
        assert retained["retained_range"] == {"start": 0, "end": len(original.content),
            "original_characters": len(original.content), "truncated": False}
        assert store.evidence(run)[retained["id"] - 1].content == original.content
    reopened = RunStore(store.path)
    assert reopened.get(run)["state"]["answer_plan"] == tools.answer_plan
    assert [event["type"] for event in reopened.events(run)].count("answer.plan") == 2
    checked = retained_evidence(tools.answer_plan, tools.delivered, checked=True)
    for entry in checked:
        original = tools.delivered[entry["id"]].content
        for unit in entry["content_units"]:
            assert unit["text"] == original[unit["start"]:unit["end"]]


@pytest.mark.asyncio
async def test_unavailable_modality_must_be_reported_and_cannot_fake_completion(tmp_path):
    tools, _, _, _, sources = make_tools(tmp_path)
    await tools.execute("plan", "update_answer_plan", {"items": items()})
    await tools.execute("read", "read_source", {"source_id": sources[0].id})
    plan = items()
    plan[0].update(status="ready", evidence_ids=[1])
    plan[1].update(status="unavailable", gap="当前范围内未取得主题曲依据。")
    result = await tools.execute("gap", "update_answer_plan", {"items": plan})
    assert not result.get("isError")
    args = {"answer": "选海报.png[1]；本次缺少主题曲依据。", "evidence_ids": [1]}
    assert (await tools.execute("fake-complete", "submit_answer", args))["details"]["code"] == "answer_delivery_gap"
    accepted = await tools.execute("partial", "submit_answer", {**args, "status": "partial",
        "limitations": [plan[1]["gap"]]})
    assert accepted["details"]["terminal"] == "partial"
    assert [c["type"] for c in accepted["details"]["citations"]] == ["image"]


@pytest.mark.asyncio
async def test_large_plan_updates_remain_available_without_output_or_retention_caps(tmp_path):
    tools, store, run, _, sources = make_tools(tmp_path)
    await tools.execute("plan", "update_answer_plan", {"items": items()})
    item = Evidence(id=1, source_id=sources[0].id, modality="image", file_name="海报.png",
        content="大" * 50000, version="v1", observation="caption")
    tools.delivered[1] = item
    selected = items()
    selected[0].update(status="ready", evidence_ids=[1])
    result = await tools.execute("large", "update_answer_plan", {"items": selected,
        "retained_spans": [{"evidence_id": 1, "start": 10000, "end": 50000}]})
    assert not result.get("isError")
    assert len(json.loads(result["content"][0]["text"])["retained_evidence"][0]["content"]) == 40000
    assert store.get(run)["state"]["answer_plan"] == tools.answer_plan
