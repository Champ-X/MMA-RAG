import asyncio
import json
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.answers import assess_answer, evidence_payload, evidence_units
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.gateway import evidence_for, KnowledgeGateway
from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.tools import CheckedAnswer
from test_pi_agent_tools import fixture_tools, source
from test_pi_agent_reading import IndexedText, gateway
from test_pi_agent_search_scope import Index, point


def observed(text, **kwargs):
    point = SimpleNamespace(id="p", payload={"text_content": text, "chunk_index": 0})
    return evidence_for(source(), "doc", point, annotate_text_origins=True, **kwargs).model_copy(update={"id": 1})


def assert_verbatim(item, units):
    covered = set()
    for unit in units:
        assert item.content[unit["start"]:unit["end"]] == unit["text"]
        assert len(unit["text"]) <= 1200
        assert not covered.intersection(range(unit["start"], unit["end"]))
        covered.update(range(unit["start"], unit["end"]))
    assert all(i in covered for i, char in enumerate(item.content) if not char.isspace())


def test_generated_caption_and_author_caption_have_distinct_verbatim_units():
    caption = "[图注：生成的描述[嵌套引用]🔎。\r\n第二行。]"
    text = "作者正文。\r\n" + caption + "\r\n\r\nFigure 1: Author caption.\r\n"
    item = observed(text)
    units = evidence_payload(item)["content_units"]
    generated = [u for u in units if u["origin"] == "generated_caption"]
    assert "".join(u["text"] for u in generated) == caption
    assert all(u["origin"] == "unmarked_parsed_text" for u in units if "Figure 1" in u["text"] or "作者正文" in u["text"])
    assert item.provenance["text_origin"]["unmarked_text"] == "unclassified"
    assert_verbatim(item, units)
    assert item.content == text and item.observation == "parsed_text"


def test_caption_boundaries_split_inline_units_without_rewriting_text():
    item = observed("原文甲[图注：生成文字]原文乙。\n[图注：第二幅图]末尾🔎")
    units = evidence_units(item)
    assert [u["origin"] for u in units] == ["unmarked_parsed_text", "generated_caption", "unmarked_parsed_text", "generated_caption", "unmarked_parsed_text"]
    assert [u["text"] for u in units if u["origin"] == "generated_caption"] == ["[图注：生成文字]", "[图注：第二幅图]"]
    assert_verbatim(item, units)


def test_excerpt_starting_inside_caption_retains_origin_from_full_index_record():
    text = "正文\n\n[图注：" + "细节🔎" * 500 + "]\n\nFigure 1: Author caption."
    item = observed(text, text_offset=1300, max_chars=300)
    assert "[图注：" not in item.content
    units = evidence_units(item)
    assert units[0]["origin"] == "generated_caption"
    assert units[-1]["origin"] == "unmarked_parsed_text" and "Author caption" in units[-1]["text"]
    assert_verbatim(item, units)
    tail = observed(text, text_offset=1509, max_chars=100)
    assert all(u["origin"] == "unmarked_parsed_text" for u in evidence_units(tail))
    assert tail.provenance["record_version"] == item.provenance["record_version"]
    assert tail.version != item.version


def test_unclosed_caption_marker_is_conservative_and_explicit():
    item = observed("原文\n[图注：图示包含[未闭合的片段")
    spans = item.provenance["text_origin"]["generated_spans"]
    assert len(spans) == 1 and spans[0]["closed"] is False
    assert evidence_units(item)[-1]["origin"] == "generated_caption"
    # A different source chunk without the marker cannot be certified as prose.
    other = observed("此前块中的描述延续在这里。]")
    assert evidence_units(other)[0]["origin"] == "unmarked_parsed_text"
    assert other.provenance["text_origin"]["unmarked_text"] == "unclassified"


def test_default_payload_and_historical_source_units_keep_their_contract():
    text = "正文\n\n[图注：生成文字]\n\nFigure 1: Author caption."
    point = SimpleNamespace(id="p", payload={"text_content": text, "chunk_index": 0})
    old = evidence_for(source(), "doc", point).model_copy(update={"id": 1})
    explicit = evidence_for(source(), "doc", point, annotate_text_origins=False).model_copy(update={"id": 1})
    assert old == explicit
    assert "text_origin" not in old.provenance
    units = evidence_units(old)
    assert units == [{"id": "e1s1", "start": 0, "end": 3, "text": "正文\n"},
        {"id": "e1s2", "start": 4, "end": 14, "text": "[图注：生成文字]\n"},
        {"id": "e1s3", "start": 15, "end": len(text), "text": "Figure 1: Author caption."}]
    new = observed(text)
    assert new.content == old.content and new.version != old.version
    assert new.provenance["record_version"] != old.provenance["record_version"]


def test_selected_caption_origin_survives_compact_answer_binding():
    item = observed("原文\n[图注：图中标了三层]\nFigure 1: Three levels.")
    unit = next(u for u in evidence_units(item) if u["origin"] == "generated_caption")
    args = CheckedAnswer(answer="生成图注描述了三层[1]。", evidence_ids=[1], statements=[
        {"unit_id": "a1", "kind": "fact", "source_spans": [unit["id"]]}]).model_dump()
    report = assess_answer(args, {1: item})
    assert report["protocol_valid"] is True, 'Origin labels are not semantic judges or a ban on citing image observations'
    span = report["statements"][0]["source_spans"][0]
    assert span["origin"] == "generated_caption"
    assert span["text"] == unit["text"] and span["observation"] == "parsed_text"


@pytest.mark.asyncio
async def test_origin_annotations_reach_real_tools_recall_and_accepted_state(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path)
    reader, item = gateway(IndexedText("前文。\n[图注：生成内容]\nFigure 1: Author caption."))
    reader.annotate_text_origins = True
    tools.gateway = reader
    # fixture_tools defaults to the experimental contract with a registered cap.
    result = await tools.execute("read", "read_source", {"source_id": item.id, "start": 4, "limit": 1})
    assert not result.get("isError"), result
    first = json.loads(result["content"][0]["text"])["evidence"][0]
    gen = next(u for u in first["content_units"] if u["origin"] == "generated_caption")
    recalled = await tools.execute("recall", "recall_evidence", {"evidence_ids": [first["id"]]})
    assert json.loads(recalled["content"][0]["text"])["evidence"][0] == first
    saved = store.evidence(run)[0]
    assert saved.content[gen["start"]:gen["end"]] == gen["text"]
    args = {"answer": f"生成图注包含描述[{first['id']}]。", "evidence_ids": [first["id"]],
        "statements": [{"unit_id": "a1", "kind": "fact", "source_spans": [gen["id"]]}]}
    accepted = await tools.execute("submit", "submit_answer", args)
    assert not accepted.get("isError"), accepted
    assert accepted["details"]["answer_checks"]["statements"][0]["source_spans"][0]["origin"] == "generated_caption"
    assert first["provenance"] == saved.provenance


@pytest.mark.parametrize("modality,field", [("image", "caption"), ("audio", "transcript"), ("video", "caption")])
def test_document_annotation_does_not_reclassify_other_observations(modality, field):
    record = SimpleNamespace(id="media", payload={field: "[图注：literal marker]"})
    default = evidence_for(source(), modality, record)
    enabled = evidence_for(source(), modality, record, annotate_text_origins=True)
    assert default == enabled and "text_origin" not in enabled.provenance


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["exact", "hybrid"])
async def test_scoped_search_annotations_fit_the_original_output_budget(tmp_path, mode):
    tools, store, run, _ = fixture_tools(tmp_path)
    item, other = source(), source(fid="excluded")
    tools.catalog = SourceCatalog([item, other], {"a": "A"})
    text = "指标\n[图注：" + "生成描述" * 310 + "]\n正文尾部。"
    index = Index([point(item, str(i), chunk_index=i, text_content=text) for i in range(8)]
        + [point(other, "outside", text_content=text)])
    tools.gateway = KnowledgeGateway(tools.catalog, tools.scope, index, index, asyncio.Semaphore(1),
        annotate_text_origins=True)
    result = await tools.execute("search", "search", {"query": "指标", "mode": mode,
        "modalities": ["doc"], "source_ids": [item.id], "limit": 8})
    assert not result.get("isError"), result
    payload = json.loads(result["content"][0]["text"])
    assert {e["source_id"] for e in payload["evidence"]} == {item.id}
    assert payload["scope"]["selected_files"] == [{"kb_id": "a", "file_id": "file"}]
    assert all(e.content == text for e in store.evidence(run))
    assert all(any(u["origin"] == "generated_caption" for u in e["content_units"]) for e in payload["evidence"])
    assert len(result["content"][0]["text"]) <= tools.ledger.tool_output_chars <= 20000
    assert tools.ledger.searches == tools.ledger.tool_calls == 1
    assert tools.ledger.model_requests == 0


@pytest.mark.asyncio
async def test_long_caption_continuation_preserves_annotations_and_rejects_cross_version():
    text = "前文\n[图注：" + "生成文字🔎" * 2500 + "]\n原文后续"
    reader, item = gateway(IndexedText(text))
    reader.annotate_text_origins = True
    first, report = await reader.read(item, start=4, limit=1)
    continuation = report["text_continuations"][0]
    second, _ = await reader.read(item, **{k: v for k, v in continuation.items() if k != "source_id"})
    assert first[0].content + second[0].content == text
    assert "[图注：" not in second[0].content
    assert evidence_units(second[0])[0]["origin"] == "generated_caption"
    assert evidence_units(second[0])[-1]["origin"] == "unmarked_parsed_text"
    reader.annotate_text_origins = False
    with pytest.raises(ToolError, match="版本"):
        await reader.read(item, **{k: v for k, v in continuation.items() if k != "source_id"})
