import pytest

from app.modules.pi_agent.contracts import RunRequest, SourceFile
from app.modules.pi_agent.policy import AccessScope, UsageLedger, ToolError


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


def test_missing_usage_is_unknown_and_duplicate_settlement_does_not_invent_tokens():
    ledger = UsageLedger()
    ledger.start_model(1)
    ledger.settle_model(1, {"totalTokens": 0})
    ledger.settle_model(1, {"totalTokens": 100})
    assert ledger.model_tokens == 0 and ledger.unknown_usage_requests == 1
    with pytest.raises(ToolError, match="重复"):
        ledger.start_model(1)
    ledger.start_model(2)
    ledger.settle_model(2, {"totalTokens": 1234})
    ledger.settle_model(2, {"totalTokens": 1234})
    assert ledger.model_tokens == 1234


def test_work_continues_past_all_former_cumulative_allowances():
    ledger = UsageLedger()
    ledger.started -= 3600
    for turn in range(1, 101):
        assert ledger.start_model(turn) == {"allowed": True}
        ledger.settle_model(turn, {"totalTokens": 20000})
        for name in ("search", "inspect_media", "read_source", "recall_evidence", "check_answer"):
            ledger.record_tool(name)
        ledger.record_media(10 * 1024 * 1024, 300)
        ledger.account_output(100000)
    ledger.record_tool("submit_answer")
    used = ledger.snapshot()
    assert used["duration_ms"] >= 3600000
    assert used["model_requests"] == 100 and used["model_tokens"] == 2000000
    assert used["tool_calls"] == 501 and used["searches"] == used["media_calls"] == 100
    assert used["media_input_bytes"] == 1000 * 1024 * 1024 and used["media_seconds"] == 30000
    assert used["tool_output_chars"] == 10000000


def test_parallel_model_calls_have_independent_idempotent_accounting():
    ledger = UsageLedger()
    for turn in range(-100, 100):
        ledger.start_model(turn)
    for turn in reversed(range(-100, 100)):
        ledger.settle_model(turn, {"totalTokens": 5000})
    assert not ledger._pending and ledger.model_tokens == 1000000
