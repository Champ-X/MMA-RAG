import asyncio
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.catalog import Source, SourceCatalog, source_id, index_kb_matches
from app.modules.pi_agent.contracts import Evidence, RunRequest, RunBudget, SourceFile
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.policy import AccessScope, BudgetLedger, ToolError
from app.modules.pi_agent.store import RunStore
from app.modules.pi_agent.tools import ToolSet
from app.modules.pi_agent.tables import query_table


def source(kb="a", fid="file", **kw):
    return Source(source_id(kb, fid), kb, fid, "材料.pdf", "doc", "v1", 40, "kb-" + kb, "documents/file_材料.pdf", **kw)


def request(**kw):
    return RunRequest(client_request_id="test-request", session_id="session", message="问题", **kw)


def test_catalog_binds_file_and_kb_and_rejects_duplicate_and_cross_parent():
    a, b = source(), source("b", "other")
    scope = AccessScope.from_request(request(knowledge_base_ids=["a"]), {"a", "b"})
    catalog = SourceCatalog([a, b], {"a": "A", "b": "B"})
    assert catalog.bind_point({"file_id": "file", "kb_id": "a"}, scope) == a
    assert catalog.bind_point({"file_id": "file", "kb_id": "b"}, scope) is None
    assert catalog.bind_point({"file_id": "file", "kb_id": "a", "bucket": "kb-b"}, scope) is None
    assert catalog.bind_point({"file_id": "file", "kb_id": "a", "source_file_id": "other"}, scope) is None
    duplicate = SourceCatalog([a, source("b")], {"a": "A", "b": "B"})
    assert duplicate.bind_point({"file_id": "file", "kb_id": "a"}, scope) is None


def test_historical_id_conversion_is_exact_not_an_unscoped_fallback():
    s = source("cecac--a-f-99f0bf")
    assert index_kb_matches("c6ec7ac1-5664-456a-8f67-939f0b155f25", s)
    assert not index_kb_matches("c6ec7ac1-5664-456a-8f67-939f0b155f2a", s)


@pytest.mark.asyncio
async def test_empty_scope_does_not_call_storage_and_bad_backend_result_is_filtered():
    class Client:
        calls = 0
        async def scroll(self, *a, **kw):
            self.calls += 1
            return [SimpleNamespace(id="evil", payload={"file_id": "file", "kb_id": "b", "text_content": "问题"}),
                    SimpleNamespace(id="good", payload={"file_id": "file", "kb_id": "a", "text_content": "问题的答案"})], None
    client = Client()
    catalog = SourceCatalog([source()], {"a": "A"})
    scope = AccessScope.from_request(request(), set())
    gateway = KnowledgeGateway(catalog, scope, client, None, asyncio.Semaphore(1))
    found, report = await gateway.search(query="问题", mode="exact", modalities=["doc"], knowledge_base_ids=[], limit=5, span_id="t")
    assert not found and client.calls == 0
    gateway.scope = AccessScope.from_request(request(), {"a"})
    found, report = await gateway.search(query="问题", mode="exact", modalities=["doc"], knowledge_base_ids=[], limit=5, span_id="t")
    assert [e.locator["point_id"] for e in found] == ["good"]
    assert found[0].content == "问题的答案"


@pytest.mark.asyncio
async def test_index_outage_is_not_reported_as_no_results():
    class Client:
        async def scroll(self, *a, **kw):
            raise ConnectionError("secret URL must not be exposed")
    gateway = KnowledgeGateway(SourceCatalog([source()], {"a": "A"}),
        AccessScope.from_request(request(), {"a"}), Client(), None, asyncio.Semaphore(1))
    with pytest.raises(ToolError, match="不代表没有"):
        await gateway.search(query="x", mode="exact", modalities=["doc"], knowledge_base_ids=[], limit=1, span_id="t")


def fixture_tools(tmp_path, budget=None):
    store = RunStore(tmp_path / "run.db")
    req = request()
    run = store.create(owner="alice", request=req.model_dump(), config={})[0]
    store.transition(run["id"], "running")
    scope = AccessScope.from_request(req, {"a"})
    events = []
    async def blocking(fn, *args, **kwargs):
        return fn(*args, **kwargs)
    class Gateway:
        async def read(self, s, **kw):
            return [Evidence(source_id=s.id, modality="doc", file_name=s.name, content="实际原文", version="v1", observation="parsed_text",
                             citation={"type": "doc", "file_name": s.name})], {"status": "ok"}
    tools = ToolSet(run["id"], store, SourceCatalog([source()], {"a": "A"}), scope,
        BudgetLedger(budget or RunBudget()), Gateway(), None, lambda name, data, **kw: events.append((name, data)), blocking)
    return tools, store, run["id"], events


@pytest.mark.asyncio
async def test_only_delivered_evidence_can_be_cited_and_repair_keeps_id(tmp_path):
    tools, store, run, events = fixture_tools(tmp_path)
    # Registration alone (e.g. interrupted tool) does not grant a citation.
    store.add_evidence(run, Evidence(source_id=source().id, modality="doc", file_name="材料.pdf", content="未返回", version="v0", observation="parsed_text"))
    rejected = await tools.execute("s1", "submit_answer", {"answer": "结论[1]", "evidence_ids": [1]})
    assert rejected["isError"] and not tools.final_result
    read = await tools.execute("r", "read_source", {"source_id": source().id})
    number = read["details"]["evidence_ids"][0]
    assert number == 2
    bad = await tools.execute("s2", "submit_answer", {"answer": "结论[2]", "evidence_ids": [1, 2]})
    assert bad["isError"]
    accepted = await tools.execute("s3", "submit_answer", {"answer": "结论[2]", "evidence_ids": [2]})
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["citations"][0]["id"] == 2
    assert "api_key" not in str(events)


@pytest.mark.asyncio
async def test_oversized_result_is_not_available_for_citation(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, RunBudget(tool_output_chars=1000))
    original = tools.gateway.read
    async def large(*a, **kw):
        evidence, result = await original(*a, **kw)
        evidence[0].content = "大" * 2000
        return evidence, result
    tools.gateway.read = large
    result = await tools.execute("r", "read_source", {"source_id": source().id})
    assert result["isError"] and not tools.delivered and not store.evidence(run)


@pytest.mark.asyncio
@pytest.mark.parametrize("exhausted", [False, True])
async def test_closing_recall_reads_only_delivered_evidence_and_keeps_output_budget(tmp_path, exhausted):
    tools, store, run, _ = fixture_tools(tmp_path)
    original = await tools.execute("read", "read_source", {"source_id": source().id})
    number = original["details"]["evidence_ids"][0]
    unknown = await tools.execute("unknown", "recall_evidence", {"evidence_ids": [number + 1]})
    assert unknown["isError"] and unknown["details"]["code"] == "invalid_evidence"
    tools.ledger.finalizing = True
    async def forbidden(*args, **kwargs):
        pytest.fail("Closing recall must not fetch new source content")
    tools.gateway.read = forbidden
    if exhausted:
        tools.ledger.tool_output_chars = tools.ledger.limits.total_tool_output_chars
    result = await tools.execute("recall", "recall_evidence", {"evidence_ids": [number]})
    if exhausted:
        assert result["isError"] and result["details"]["code"] == "tool_output_budget_exhausted"
        return
    assert not result.get("isError")
    assert result["details"]["evidence_ids"] == [number]
    assert result["content"][0]["text"].count("实际原文") == 1
    assert len(store.evidence(run)) == 1


@pytest.mark.asyncio
async def test_reference_remains_readable_but_cannot_expand_discovery_scope(tmp_path):
    tools, *_ = fixture_tools(tmp_path)
    tools.scope = AccessScope.from_request(request(knowledge_base_ids=["b"], reference_files=[SourceFile(kb_id="a", file_id="file")]), {"a", "b"})
    assert (await tools.execute("r", "read_source", {"source_id": source().id}))["details"]["evidence_ids"]
    assert not tools.catalog.get(source().id, tools.scope).public(tools.scope)["searchable"]


def test_table_computation_reports_scope_and_refuses_formulas(tmp_path):
    path = tmp_path / "values.csv"
    path.write_text("组,数量\nA,2\nA,3\nB,9\n", encoding="utf8")
    args = {"columns": [], "filters": [{"column": "组", "op": "eq", "value": "A"}], "operation": "sum", "value_column": "数量",
            "group_by": None, "offset": 0, "limit": 1}
    result = query_table(path, args)
    assert result["result"] == [{"group": "all", "value": "5", "rows": 2}]
    assert result["matched_rows"] == 2 and result["total_rows"] == 3
    path.write_text("组,数量\nA,=1+2\n", encoding="utf8")
    with pytest.raises(ToolError, match="非数值或公式"):
        query_table(path, args)


@pytest.mark.asyncio
async def test_not_found_requires_partial_and_no_candidate_citations(tmp_path):
    tools, *_ = fixture_tools(tmp_path)
    evidence = await tools.execute("read", "read_source", {"source_id": source().id})
    number = evidence["details"]["evidence_ids"][0]
    spec = {"answer": f"未找到。来源是学术论文[{number}]", "evidence_ids": [number],
            "outcome": "not_found", "status": "partial", "limitations": ["未找到用户所需资料"]}
    assert (await tools.execute("bad", "submit_answer", spec))["isError"]
    spec.update(answer="当前材料中未找到所需信息。", evidence_ids=[])
    result = await tools.execute("fixed", "submit_answer", spec)
    assert result["details"]["terminal"] == "partial"
    assert result["details"]["citations"] == []
