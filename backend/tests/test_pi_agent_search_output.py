import json

import pytest

from app.modules.pi_agent.contracts import Evidence, RunBudget
from test_pi_agent_tools import fixture_tools, source


def candidates(count=3, text="原始证据" * 325):
    return [Evidence(source_id=source().id, file_name="材料.pdf", modality="doc", version=f"version-{i}",
        observation="parsed_text", content=f"候选{i}：" + text,
        locator={"chunk_index": i, "text_start": 0, "text_end": len(text) + 4},
        provenance={"kb_id": "a", "file_id": "file"}) for i in range(count)]


def search_fixture(tmp_path, *, checks, budget=None, count=3, report=None):
    tools, store, run_id, events = fixture_tools(tmp_path, budget or RunBudget(tool_output_chars=4400),
        answer_checks_enabled=checks)
    observations = candidates(count)
    metadata = report or {"status": "ok", "scope": tools.scope.public(), "methods": ["dense", "lexical"],
        "errors": [], "truncated": False, "scanned_point_limit_per_modality": 2000}
    calls = []
    async def search(**args):
        calls.append(args)
        return observations, metadata
    tools.gateway.search = search
    return tools, store, run_id, events, observations, metadata, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_search_delivers_a_ranked_prefix_with_explicit_omissions(tmp_path, checks):
    tools, store, run_id, events, original, metadata, calls = search_fixture(tmp_path, checks=checks)
    before = [e.model_dump() for e in original]
    response = await tools.execute("search", "search", {"query": "问题", "limit": 3})
    assert not response.get("isError"), response
    output = json.loads(response["content"][0]["text"])
    assert output["status"] == "partial" and output["truncated"] is True
    assert output["output_truncation"]["reason"] == "per_call_output_limit"
    assert output["output_truncation"]["candidate_count"] == 3
    assert output["output_truncation"]["returned_count"] == 2
    assert output["output_truncation"]["omitted_count"] == 1
    assert output["scope"] == metadata["scope"] and output["methods"] == metadata["methods"]
    assert [e.content for e in store.evidence(run_id)] == [e.content for e in original[:2]]
    assert [e.locator for e in store.evidence(run_id)] == [e.locator for e in original[:2]]
    assert response["details"]["evidence_ids"] == [1, 2]
    assert [e.model_dump() for e in original] == before and metadata["status"] == "ok"
    assert store.artifact(run_id, response["details"]["artifact_id"]) == output
    assert next(data for kind, data in events if kind == "tool.completed")["status"] == "partial"
    assert len(response["content"][0]["text"]) <= tools.ledger.tool_output_chars <= 4400
    assert len(calls) == tools.ledger.searches == tools.ledger.tool_calls == 1
    assert tools.ledger.model_requests == 0
    missing = await tools.execute("recall-omitted", "recall_evidence", {"evidence_ids": [3]})
    assert missing["isError"] and missing["details"]["code"] == "invalid_evidence"


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_search_that_fits_preserves_its_existing_result(tmp_path, checks):
    tools, _, _, _, original, metadata, _ = search_fixture(tmp_path, checks=checks, count=1)
    response = await tools.execute("fits", "search", {"query": "问题"})
    assert not response.get("isError")
    output = json.loads(response["content"][0]["text"])
    assert output == {**metadata, "evidence": [tools.evidence_payload(original[0].model_copy(update={"id": 1}))]}


@pytest.mark.asyncio
@pytest.mark.parametrize("checks", [False, True])
async def test_truncation_retains_backend_errors_and_scope(tmp_path, checks):
    metadata = {"status": "partial", "scope": {"knowledge_base_ids": ["a"], "selected_files": [{"kb_id": "a", "file_id": "file"}], "reference_files": []},
        "methods": ["lexical"], "errors": [{"method": "dense", "code": "model_unavailable"}],
        "truncated": True, "scanned_point_limit_per_modality": 2000}
    tools, *_ = search_fixture(tmp_path, checks=checks, report=metadata)
    result = await tools.execute("partial", "search", {"query": "问题"})
    assert not result.get("isError")
    output = json.loads(result["content"][0]["text"])
    assert all(output[key] == value for key, value in metadata.items())
    assert output["output_truncation"]["omitted_count"] > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["single_hit", "total_budget"])
async def test_output_packing_cannot_bypass_irreducible_or_total_budget_failure(tmp_path, failure):
    budget = RunBudget(tool_output_chars=1000 if failure == "single_hit" else 4400,
        total_tool_output_chars=4500)
    tools, store, run_id, events, _, _, calls = search_fixture(tmp_path, checks=True, budget=budget)
    if failure == "total_budget":
        tools.ledger.tool_output_chars = 4000
    prior_usage = tools.ledger.tool_output_chars
    result = await tools.execute("fails", "search", {"query": "问题"})
    assert result["isError"]
    expected = "tool_output_too_large" if failure == "single_hit" else "tool_output_budget_exhausted"
    assert result["details"]["code"] == expected
    assert not store.evidence(run_id) and not tools.delivered
    assert not any(kind == "tool.completed" for kind, _ in events)
    assert tools.ledger.tool_output_chars == prior_usage and len(calls) == 1


@pytest.mark.asyncio
async def test_packing_accounts_for_actual_multidigit_source_unit_ids(tmp_path):
    tools, store, run_id, _, _, _, _ = search_fixture(tmp_path, checks=True)
    # Registered but never delivered observations may already occupy IDs.
    for evidence in candidates(9, text="之前中断的调用"):
        store.add_evidence(run_id, evidence)
    result = await tools.execute("after-interruption", "search", {"query": "问题"})
    assert not result.get("isError"), result
    assert result["details"]["evidence_ids"] == [10, 11]
    assert len(result["content"][0]["text"]) <= tools.ledger.tool_output_chars <= 4400
    output = json.loads(result["content"][0]["text"])
    assert output["evidence"][0]["content_units"][0]["id"] == "e10s1"


@pytest.mark.asyncio
async def test_packing_does_not_skip_an_oversized_first_candidate(tmp_path):
    tools, store, run_id, _, observations, _, _ = search_fixture(tmp_path, checks=True,
        budget=RunBudget(tool_output_chars=1000), count=2)
    observations[1] = observations[1].model_copy(update={"content": "能容纳的低排名候选"})
    result = await tools.execute("large-first", "search", {"query": "问题"})
    assert result["isError"] and result["details"]["code"] == "tool_output_too_large"
    assert not store.evidence(run_id) and not tools.delivered
