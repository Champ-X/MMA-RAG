import pytest

from app.modules.pi_agent.contracts import RunBudget, RunRequest, SourceFile
from app.modules.pi_agent.policy import AccessScope, BudgetLedger, ToolError


def request(**kwargs):
    return RunRequest(client_request_id="request-123", session_id="session", message="问题", **kwargs)


def test_references_can_be_read_without_expanding_search_scope():
    scope = AccessScope.from_request(request(knowledge_base_ids=["pictures"],
        reference_files=[SourceFile(kb_id="music", file_id="song")]), {"pictures", "music"})
    assert scope.can_read("music", "song")
    assert not scope.can_read("music", "other-song")
    assert not scope.can_search("music", "song")
    assert scope.narrow_kbs([]) == ["pictures"]
    with pytest.raises(ToolError):
        scope.narrow_kbs(["music"])


def test_files_are_bound_to_their_knowledge_bases_not_cross_product():
    scope = AccessScope.from_request(request(selected_files=[SourceFile(kb_id="a", file_id="one"),
        SourceFile(kb_id="b", file_id="two")]), {"a", "b"})
    assert scope.can_read("a", "one")
    assert not scope.can_search("a", "two")
    assert not scope.can_search("b", "one")
    assert scope.can_read("a", "embedded-image", parent_file_id="one")
    assert not scope.can_read("b", "embedded-image", parent_file_id="one")


def test_no_access_means_empty_scope_not_unfiltered_query():
    scope = AccessScope.from_request(request(), set())
    assert scope.narrow_kbs([]) == []
    assert not scope.can_read("any", "file")
    with pytest.raises(ToolError):
        AccessScope.from_request(request(reference_files=[SourceFile(kb_id="private", file_id="x")]), {"public"})


def test_conflicting_explicit_scope_is_rejected():
    with pytest.raises(ToolError, match="冲突"):
        AccessScope.from_request(request(knowledge_base_ids=["a"],
            selected_files=[SourceFile(kb_id="b", file_id="x")]), {"a", "b"})


def test_unknown_token_usage_is_charged_and_duplicate_usage_is_not_counted_twice():
    ledger = BudgetLedger(RunBudget(model_tokens=1000, output_tokens=256))
    ledger.reserve_model(1, 500, 256)
    ledger.settle_model(1, {"totalTokens": 0})
    ledger.settle_model(1, {"totalTokens": 100})
    assert ledger.model_tokens == 756
    assert ledger.unknown_usage_requests == 1
    with pytest.raises(ToolError):
        ledger.reserve_model(2, 100, 256)


def test_parallel_reservations_cannot_overspend_and_completion_slots_remain():
    ledger = BudgetLedger(RunBudget(model_tokens=1000, output_tokens=256, tool_calls=4, searches=1))
    ledger.reserve_model(1, 500, 256)
    with pytest.raises(ToolError):
        ledger.reserve_model(2, 100, 256)
    ledger.settle_model(1, {"totalTokens": 120})
    ledger.reserve_model(2, 100, 256)
    ledger.reserve_tool("search")
    with pytest.raises(ToolError):
        ledger.reserve_tool("search")
    ledger.reserve_tool("read_source")
    with pytest.raises(ToolError):
        ledger.reserve_tool("read_source")
    ledger.reserve_tool("submit_answer")


def test_cancelled_or_long_running_calls_cannot_replenish_budget():
    ledger = BudgetLedger(RunBudget(wall_seconds=10))
    ledger.started -= 11
    with pytest.raises(ToolError, match="时间"):
        ledger.reserve_tool("submit_answer")


def test_token_headroom_closes_research_before_full_context_is_unaffordable():
    ledger = BudgetLedger(RunBudget(model_tokens=2000, output_tokens=256))
    assert not ledger.reserve_model(1, 300, 256, main_loop=True)["final_turn"]
    ledger.settle_model(1, {"totalTokens": 400})
    # This request fits (1256), but another full-context turn would not.
    assert ledger.reserve_model(2, 1000, 256, main_loop=True)["final_turn"]
    with pytest.raises(ToolError, match="收尾"):
        ledger.reserve_tool("search")
    with pytest.raises(ToolError, match="收尾"):
        ledger.reserve_model(-1, 50, 0)
    ledger.reserve_tool("submit_answer")
    ledger.settle_model(2, {"totalTokens": 600})
    # Actual usage refunds do not silently reopen research.
    assert ledger.finalizing
    assert ledger.reserve_model(3, 300, 256, main_loop=True)["final_turn"]


def test_closing_can_recall_delivered_evidence_without_reopening_research_or_limits():
    ledger = BudgetLedger(RunBudget(tool_calls=4), finalizing=True)
    ledger.reserve_tool("recall_evidence")
    assert ledger.tool_calls == 1
    for name in ("search", "read_source", "expand_context", "inspect_media", "query_table", "list_sources"):
        with pytest.raises(ToolError, match="收尾"):
            ledger.reserve_tool(name)
    with pytest.raises(ToolError, match="收尾"):
        ledger.reserve_model(-1, 50, 0)
    ledger.reserve_tool("recall_evidence")
    # Cached reads still preserve the last two tool slots for completion/repair.
    with pytest.raises(ToolError):
        ledger.reserve_tool("recall_evidence")
    ledger.reserve_tool("submit_answer")
    ledger.reserve_tool("submit_answer")
    with pytest.raises(ToolError):
        ledger.reserve_tool("submit_answer")
