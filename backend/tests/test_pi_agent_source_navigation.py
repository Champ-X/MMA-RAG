import asyncio
from dataclasses import replace
import json

import pytest
from pydantic import ValidationError

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.answers import evidence_payload
from app.modules.pi_agent.contracts import SourceFile
from app.modules.pi_agent.gateway import KnowledgeGateway, evidence_for, point_text
from app.modules.pi_agent.policy import AccessScope, ToolError
from app.modules.pi_agent.tools import ListSources
from test_pi_agent_search_scope import Index, point, query
from test_pi_agent_tools import fixture_tools, request, source


def contents(result):
    assert not result.get("isError"), result
    return json.loads(result["content"][0]["text"])


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_source_discovery_filters_before_pagination_and_preserves_default(tmp_path, checks):
    tools, store, run_id, events = fixture_tools(tmp_path, answer_checks_enabled=checks)
    documents = [replace(source(fid=str(i)), name=f"Survey {i}.pdf") for i in range(2)]
    images = [replace(source(fid=f"img{i}"), name=f"000{i}.jpg", modality="image") for i in range(22)]
    tools.catalog = SourceCatalog([*images, *documents, source("b", "private")], {"a": "A", "b": "B"})
    default = contents(await tools.execute("default", "list_sources", {}))
    assert default["total"] == 24 and len(default["sources"]) == 20
    assert {s["modality"] for s in default["sources"]} == {"image"}
    docs = contents(await tools.execute("docs", "list_sources", {"modalities": ["doc"]}))
    assert docs["total"] == 2 and docs["next_offset"] is None
    assert [s["source_id"] for s in docs["sources"]] == [s.id for s in documents]
    for offset in (0, 1):
        page = contents(await tools.execute(f"page{offset}", "list_sources", {
            "modalities": ["doc", "doc"], "query": "SURVEY", "offset": offset, "limit": 1}))
        assert page["total"] == 2
        assert [s["source_id"] for s in page["sources"]] == [documents[offset].id]
        assert page["next_offset"] == (1 if offset == 0 else None)
    assert tools.ledger.tool_calls == 4 and tools.ledger.model_requests == tools.ledger.searches == 0
    assert store.artifact(run_id, next(data for kind, data in events if kind == "tool.completed")["artifact_id"]) == default
    assert not store.evidence(run_id)  # A source directory is not evidence.


@pytest.mark.asyncio
async def test_filtered_listing_keeps_attachment_and_reference_authority(tmp_path):
    tools, *_ = fixture_tools(tmp_path)
    image = replace(source(fid="image"), modality="image")
    upload = replace(source(fid="upload", attachment_id="input-image"), modality="image")
    reference = source(fid="reference")
    tools.catalog = SourceCatalog([image, upload, reference, source(fid="hidden")], {"a": "A"})
    tools.scope = AccessScope.from_request(request(selected_files=[SourceFile(kb_id="a", file_id="image")],
        reference_files=[SourceFile(kb_id="a", file_id="reference")]), {"a"})
    listed = contents(await tools.execute("images", "list_sources", {"modalities": ["image"]}))
    assert {s["source_id"] for s in listed["sources"]} == {image.id, upload.id}
    assert next(s for s in listed["sources"] if s["source_id"] == upload.id)["searchable"] is False
    listed = contents(await tools.execute("docs", "list_sources", {"modalities": ["doc"]}))
    assert [s["source_id"] for s in listed["sources"]] == [reference.id]
    assert listed["sources"][0]["input_material"] is True and listed["sources"][0]["searchable"] is False


@pytest.mark.parametrize("value", ["doc", ["pdf"], ["doc"] * 5, [None]])
def test_discovery_modality_filter_is_typed_and_bounded(value):
    with pytest.raises(ValidationError):
        ListSources.model_validate({"modalities": value})


def image_gateway(*, req=None):
    parent = replace(source(fid="parent"), name="Full paper.pdf")
    image = replace(source(fid="image"), name="parent_page4_img0.jpg", modality="image")
    catalog = SourceCatalog([parent, image], {"a": "A", "b": "B"})
    scope = AccessScope.from_request(req or request(), {"a", "b"})
    record = point(image, "figure", source_file_id=parent.file_id, caption="指标图")
    index = Index([record])
    return KnowledgeGateway(catalog, scope, index, index, asyncio.Semaphore(1)), parent, image, record


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["exact", "hybrid"])
async def test_image_search_and_read_expose_verified_document_navigation(mode):
    gateway, parent, image, _ = image_gateway()
    found, _ = await gateway.search(**query(mode=mode, modalities=["image"], source_ids=[image.id]))
    assert len(found) == 1 and found[0].source_id == image.id
    assert found[0].observation == "caption" and found[0].content == "索引画面描述：指标图"
    link = found[0].provenance["parent_document"]
    assert link == parent.public(gateway.scope)
    assert gateway.catalog.get(link["source_id"], gateway.scope) == parent
    reread, _ = await gateway.read(image, start=0, limit=1)
    assert reread[0].provenance["parent_document"] == link
    assert reread[0].source_id == image.id and reread[0].observation == "caption"
    # Query-only narrowing must not hide a parent readable in the original run.
    assert gateway.scope.search_files == frozenset()


@pytest.mark.asyncio
async def test_parent_navigation_does_not_widen_selected_file_scope():
    req = request(selected_files=[SourceFile(kb_id="a", file_id="image")])
    gateway, parent, image, _ = image_gateway(req=req)
    found, _ = await gateway.search(**query(modalities=["image"]))
    assert len(found) == 1 and "parent_document" not in found[0].provenance
    with pytest.raises(ToolError, match="范围"):
        gateway.catalog.get(parent.id, gateway.scope)
    req.reference_files = [SourceFile(kb_id="a", file_id="parent")]
    gateway.scope = AccessScope.from_request(req, {"a", "b"})
    found, _ = await gateway.search(**query(modalities=["image"]))
    link = found[0].provenance["parent_document"]
    assert link["source_id"] == parent.id and link["searchable"] is False and link["input_material"] is True


@pytest.mark.asyncio
async def test_selected_parent_navigation_preserves_caption_identity():
    gateway, parent, image, _ = image_gateway(req=request(selected_files=[SourceFile(kb_id="a", file_id="parent")]))
    found, _ = await gateway.search(**query(modalities=["image"]))
    assert found[0].source_id == parent.id and found[0].observation == "caption"
    assert found[0].provenance["parent_document"]["source_id"] == parent.id


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["missing", "unknown", "non-document", "duplicate-parent", "cross-kb", "wrong-bucket"])
async def test_invalid_parent_relationship_cannot_publish_a_navigation_link(invalid):
    gateway, parent, image, record = image_gateway()
    if invalid == "missing":
        record.payload.pop("source_file_id")
    elif invalid == "unknown":
        record.payload["source_file_id"] = "unknown"
    elif invalid == "non-document":
        gateway.catalog = SourceCatalog([replace(parent, modality="image"), image], {"a": "A"})
    elif invalid == "duplicate-parent":
        gateway.catalog = SourceCatalog([parent, image, source("b", "parent")], {"a": "A", "b": "B"})
    elif invalid == "cross-kb":
        gateway.catalog = SourceCatalog([source("b", "parent"), image], {"a": "A", "b": "B"})
    else:
        record.payload["bucket"] = "kb-b"
    found, _ = await gateway.search(**query(modalities=["image"]))
    assert all("parent_document" not in item.provenance for item in found)
    if invalid in {"duplicate-parent", "cross-kb", "wrong-bucket"}:
        assert not found
    else:
        assert found  # No guessing a parent from the image filename.


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_navigation_is_budgeted_durable_and_recalled_without_reading_parent(tmp_path, checks):
    tools, store, run_id, _ = fixture_tools(tmp_path, answer_checks_enabled=checks)
    gateway, parent, image, _ = image_gateway()
    tools.gateway, tools.catalog, tools.scope = gateway, gateway.catalog, gateway.scope
    original = contents(await tools.execute("image", "read_source", {"source_id": image.id}))
    saved = store.evidence(run_id)[0]
    assert saved.provenance["parent_document"]["source_id"] == parent.id
    count = len(gateway.client.calls)
    recalled = contents(await tools.execute("recall", "recall_evidence", {"evidence_ids": [saved.id]}))
    assert recalled["evidence"] == original["evidence"]
    assert len(gateway.client.calls) == count == 1
    assert tools.ledger.tool_calls == 2 and tools.ledger.model_requests == 0
    assert len(store.evidence(run_id)) == 1  # A navigation link never registers parent text.


@pytest.mark.asyncio
async def test_changed_parent_binding_invalidates_long_record_continuation():
    gateway, parent, image, record = image_gateway()
    record.payload["caption"] = "原图描述" * 4000
    first, report = await gateway.read(image, start=0, limit=1)
    other = source(fid="another-parent")
    gateway.catalog = SourceCatalog([parent, image, other], {"a": "A"})
    record.payload["source_file_id"] = other.file_id
    cursor = {key: value for key, value in report["text_continuations"][0].items() if key != "source_id"}
    with pytest.raises(ToolError) as raised:
        await gateway.read(image, **cursor)
    assert raised.value.code == "index_record_changed"


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_navigation_uses_excerpt_allowance_and_long_text_still_continues(tmp_path, checks):
    tools, store, run_id, _ = fixture_tools(tmp_path, answer_checks_enabled=checks)
    gateway, parent, image, record = image_gateway()
    record.payload["caption"] = "指标与完整原始图片描述" * 2000
    gateway.client.points = [type(record)(id=f"image{i}", payload=record.payload) for i in range(8)]
    tools.gateway, tools.catalog, tools.scope = gateway, gateway.catalog, gateway.scope
    result = contents(await tools.execute("eight", "search", {
        "query": "指标", "mode": "exact", "modalities": ["image"], "limit": 8}))
    assert len(result["evidence"]) == 8
    payload = evidence_payload if checks else lambda e: e.model_dump()
    for saved in store.evidence(run_id):
        baseline = evidence_for(image, "image", record, max_chars=1400)
        baseline.id = saved.id
        assert len(json.dumps(payload(saved), ensure_ascii=False)) <= len(json.dumps(payload(baseline), ensure_ascii=False))
        assert saved.provenance["parent_document"]["source_id"] == parent.id
        assert saved.provenance["truncated"] and saved.content == point_text(record.payload, "image")[:len(saved.content)]
    gateway.client.points = [record]
    head, report = await gateway.read(image, start=0, limit=1)
    cursor = {key: value for key, value in report["text_continuations"][0].items() if key != "source_id"}
    tail, _ = await gateway.read(image, **cursor)
    combined = head[0].content + tail[0].content
    assert combined == point_text(record.payload, "image")[:len(combined)]
    assert tail[0].locator["text_start"] == head[0].locator["text_end"]
    assert tail[0].provenance["parent_document"] == head[0].provenance["parent_document"]
