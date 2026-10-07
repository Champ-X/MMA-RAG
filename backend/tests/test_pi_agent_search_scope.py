import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import SourceFile
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.policy import AccessScope, ToolError
from app.modules.pi_agent.tools import Search
from test_pi_agent_tools import fixture_tools, request, source


def point(item, identity, **payload):
    return SimpleNamespace(id=identity, payload={"file_id": item.file_id, "kb_id": item.kb_id,
        "text_content": "指标为17。", **payload})


class Index:
    """Deliberately ignores filters, so post-query scope checks are exercised."""
    def __init__(self, points):
        self.points, self.calls, self.embeddings = points, [], []

    async def scroll(self, collection, **kwargs):
        self.calls.append((collection, kwargs["scroll_filter"]))
        return self.points, None

    async def query_points(self, collection, **kwargs):
        self.calls.append((collection, kwargs["query_filter"]))
        return SimpleNamespace(points=self.points)

    async def embed(self, query, span):
        self.embeddings.append((query, span))
        return [0.1]


def gateway(items, points, *, req=None):
    scope = AccessScope.from_request(req or request(), {"a", "b"})
    catalog = SourceCatalog(items, {"a": "A", "b": "B"})
    index = Index(points)
    return KnowledgeGateway(catalog, scope, index, index, asyncio.Semaphore(1)), index


def query(**kwargs):
    return {"query": "指标", "mode": "exact", "modalities": ["doc"],
        "knowledge_base_ids": [], "limit": 8, "span_id": "search:test", **kwargs}


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["exact", "hybrid"])
async def test_source_search_filters_both_routes_and_does_not_change_later_searches(mode):
    a, other = source(), source(fid="other")
    search, index = gateway([a, other], [point(a, "a"), point(other, "other", text_content="指标为99。")])
    original_scope = search.scope
    found, report = await search.search(**query(mode=mode, source_ids=[a.id, a.id]))
    assert [e.source_id for e in found] == [a.id]
    assert report["scope"]["selected_files"] == [{"kb_id": "a", "file_id": "file"}]
    assert all([condition.match.any for condition in filt.must[0].should] == [["file"], ["file"]]
               for _, filt in index.calls)
    assert len(index.calls) == (2 if mode == "hybrid" else 1)
    assert search.scope is original_scope
    for options in ({}, {"source_ids": []}):
        found, report = await search.search(**query(mode=mode, **options))
        assert {e.source_id for e in found} == {a.id, other.id}
        assert report["scope"] == original_scope.public()


@pytest.mark.asyncio
async def test_source_search_keeps_parent_document_images_and_rejects_other_sources():
    parent, other = source(), source(fid="other")
    child = replace(source(fid="child"), modality="image")
    search, index = gateway([parent, child, other], [
        point(child, "included", source_file_id=parent.file_id, caption="指标图"),
        point(other, "excluded", caption="指标图"),
        point(child, "wrong-parent-kb", source_file_id=parent.file_id, kb_id="b", caption="指标图"),
    ])
    found, _ = await search.search(**query(mode="hybrid", modalities=["image"], source_ids=[parent.id]))
    assert [(e.locator["point_id"], e.source_id, e.observation) for e in found] == [("included", parent.id, "caption")]
    assert all(collection == "image_vectors" for collection, _ in index.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["unknown", "reference", "attachment", "selected-file", "kb-conflict"])
async def test_invalid_source_filter_fails_before_embedding_or_storage(invalid):
    a, b = source(), source("b", "other")
    attachment = replace(source(fid="upload"), attachment_id="upload")
    req = request()
    target, kbs, code = a.id, [], "scope_denied"
    if invalid == "unknown":
        target, code = "src_unknown", "source_unavailable"
    elif invalid == "reference":
        req = request(knowledge_base_ids=["b"], reference_files=[SourceFile(kb_id="a", file_id="file")])
    elif invalid == "attachment":
        target = attachment.id
    elif invalid == "selected-file":
        req = request(selected_files=[SourceFile(kb_id="b", file_id="other")])
    else:
        kbs, code = ["b"], "scope_conflict"
    search, index = gateway([a, b, attachment], [point(a, "a"), point(b, "b")], req=req)
    with pytest.raises(ToolError) as raised:
        await search.search(**query(mode="hybrid", knowledge_base_ids=kbs, source_ids=[b.id, target]))
    assert raised.value.code == code
    assert not index.calls and not index.embeddings


@pytest.mark.asyncio
async def test_empty_source_query_cannot_fall_back_to_a_different_file():
    a, other = source(), source(fid="other")
    search, _ = gateway([a, other], [point(other, "other")])
    found, report = await search.search(**query(source_ids=[a.id]))
    assert not found and report["status"] == "no_hits"
    assert report["scope"]["selected_files"] == [{"kb_id": "a", "file_id": "file"}]


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_scoped_search_is_host_validated_budgeted_and_persisted(tmp_path, checks):
    tools, store, run_id, events = fixture_tools(tmp_path, answer_checks_enabled=checks)
    a, other = source(), source(fid="other")
    tools.catalog = SourceCatalog([a, other], {"a": "A"})
    index = Index([point(a, "a"), point(other, "other")])
    tools.gateway = KnowledgeGateway(tools.catalog, tools.scope, index, index, asyncio.Semaphore(1))
    result = await tools.execute("scoped", "search", {"query": "指标", "mode": "exact", "source_ids": [a.id]})
    assert not result.get("isError"), result
    assert tools.ledger.searches == tools.ledger.tool_calls == 1
    payload = json.loads(result["content"][0]["text"])
    assert payload["scope"]["selected_files"] == [{"kb_id": "a", "file_id": "file"}]
    assert {e["source_id"] for e in payload["evidence"]} == {a.id}
    assert {e.source_id for e in store.evidence(run_id)} == {a.id}
    assert next(data for kind, data in events if kind == "tool.started")["args"]["source_ids"] == [a.id]
    assert tools.scope.search_files == frozenset()


@pytest.mark.parametrize("value", [[""], [None], [True], "src_not_an_array"])
def test_source_filter_schema_is_bounded(value):
    with pytest.raises(ValidationError):
        Search.model_validate({"query": "指标", "source_ids": value})
