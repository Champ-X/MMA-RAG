"""Real MediaInspector packets cross ToolSet persistence and delivery boundaries.

Only storage download, local decoders and remote model I/O are stubbed. Tool
validation, packet cache, RunStore, evidence IDs and citation checks are real.
"""
import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest

from app.modules.pi_agent import media
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.policy import AccessScope, ToolError
from test_pi_agent_tools import fixture_tools, request, source


def media_tools(tmp_path, monkeypatch, observe):
    tools, store, run_id, events = fixture_tools(tmp_path, answer_checks_enabled=False)
    original = replace(source(), modality="audio", name="song.mp3")
    catalog = SourceCatalog([original], {"a": "A"})
    downloads, calls = [], []

    def download(_storage, item, destination):
        downloads.append(item.id)
        destination.write_bytes(b"original audio")

    async def decode(*args):
        if args[0] == "ffprobe":
            return json.dumps({"format": {"duration": "90"}, "streams": [{"codec_type": "audio"}]}).encode()
        return b"decoded audio"

    async def model(parts, **kwargs):
        calls.append((parts, kwargs))
        return await observe(len(calls), parts, kwargs)

    catalog.download = download
    monkeypatch.setattr(media, "subprocess_bytes", decode)
    inspector = media.MediaInspector(catalog, object(), SimpleNamespace(observe=model), tools.ledger,
        SimpleNamespace(audio_model="fixture-audio", vision_model="fixture-vision", max_concurrent_media=2), tools.blocking)
    tools.catalog, tools.media = catalog, inspector
    args = {"source_id": original.id, "question": "Describe the audible instruments.",
            "start_sec": 0.0, "end_sec": 60.0, "view": "audio"}
    return tools, store, run_id, events, original, inspector, args, calls, downloads


def body(response):
    return json.loads(response["content"][0]["text"])


@pytest.mark.asyncio
async def test_packets_are_durable_before_later_call_finishes_but_not_yet_citable(tmp_path, monkeypatch):
    second_started, finish = asyncio.Event(), asyncio.Event()

    async def observe(number, _parts, _kwargs):
        if number == 2:
            second_started.set()
            await finish.wait()
        return f"audible observation {number}", {"model": "fixture-audio", "usage": {"total_tokens": 5}}

    tools, store, run_id, events, original, inspector, args, calls, _ = media_tools(tmp_path, monkeypatch, observe)
    operation = asyncio.create_task(tools.execute("inspect", "inspect_media", args))
    try:
        await asyncio.wait_for(second_started.wait(), 2)
        saved = store.evidence(run_id)
        assert len(saved) == 1 and saved[0].id == 1
        assert saved[0].locator["start_sec"] == 0 and saved[0].locator["end_sec"] == 30
        assert saved[0].provenance["calls"][0]["model"] == "fixture-audio"
        assert any(event["type"] == "evidence.added" for event in store.events(run_id))
        assert not tools.delivered and not operation.done()
        assert not any(name == "tool.completed" and event["name"] == "inspect_media" for name, event in events)

        recall = await tools.execute("premature-read", "recall_evidence", {"evidence_ids": [1]})
        assert recall["isError"] and recall["details"]["code"] == "invalid_evidence"
        answer = await tools.execute("premature-answer", "submit_answer", {"answer": "A piano is audible.[1]", "evidence_ids": [1]})
        assert answer["isError"] and not tools.final_result

        finish.set()
        completed = await operation
        assert not completed.get("isError")
        assert completed["details"]["evidence_ids"] == [1, 2]
        assert set(tools.delivered) == {1, 2} and len(store.evidence(run_id)) == 2
        assert len(calls) == 2
        output = body(completed)
        assert [item["id"] for item in output["evidence"]] == [1, 2]
        assert store.artifact(run_id, completed["details"]["artifact_id"]) == output

        accepted = await tools.execute("answer", "submit_answer", {
            "answer": "The first passage is audible.[1] The second passage is audible.[2]", "evidence_ids": [1, 2]})
        assert accepted["details"]["terminal"] == "completed"
        citations = accepted["details"]["citations"]
        assert [item["id"] for item in citations] == [1, 2]
        # Two observations retain one asset identity and separate playable ranges.
        assert {item["source_id"] for item in citations} == {original.id}
        assert len({item["audio_url"] for item in citations}) == 1
        assert [(item["start_sec"], item["end_sec"]) for item in citations] == [(0, 30), (30, 60)]
    finally:
        finish.set()
        await inspector.close()
        await asyncio.gather(operation, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("error_kind,expected_code", [
    ("provider", "media_model_unavailable"), ("timeout", "tool_timeout"), ("decode", "tool_failed")])
async def test_partial_failure_is_delivered_and_retry_reuses_only_completed_packet(tmp_path, monkeypatch, error_kind, expected_code):
    async def observe(number, _parts, _kwargs):
        if number == 2:
            if error_kind == "provider":
                raise ToolError("media_model_unavailable", "fixture provider failed", retryable=True)
            if error_kind == "timeout":
                raise asyncio.TimeoutError()
            raise OSError("private local decoder failure")
        return f"audible observation {number}", {"model": "fixture-audio"}

    tools, store, run_id, events, _, inspector, args, calls, downloads = media_tools(tmp_path, monkeypatch, observe)
    try:
        failed = await tools.execute("first-attempt", "inspect_media", args)
        assert failed["isError"] and failed["details"]["code"] == expected_code
        output = body(failed)
        assert output["coverage"] == "partial"
        assert failed["details"]["evidence_ids"] == [1] and set(tools.delivered) == {1}
        assert len(store.evidence(run_id)) == 1
        assert output["evidence"][0]["locator"]["end_sec"] == 30
        assert store.artifact(run_id, failed["details"]["artifact_id"]) == output
        assert "private local decoder failure" not in json.dumps(failed)
        assert any(name == "tool.failed" and event.get("evidence_ids") == [1] for name, event in events)

        recalled = await tools.execute("read-partial", "recall_evidence", {"evidence_ids": [1]})
        assert not recalled.get("isError")
        assert body(recalled)["evidence"][0]["content"] == store.evidence(run_id)[0].content
        missing = await tools.execute("read-missing", "recall_evidence", {"evidence_ids": [2]})
        assert missing["isError"] and missing["details"]["code"] == "invalid_evidence"
        missing_citation = await tools.execute("cite-missing", "submit_answer", {"answer": "Not observed.[2]", "evidence_ids": [2]})
        assert missing_citation["isError"] and not tools.final_result

        retried = await tools.execute("retry", "inspect_media", args)
        assert not retried.get("isError")
        assert retried["details"]["evidence_ids"] == [1, 2]
        assert body(retried)["reused_evidence_ids"] == [1]
        assert len(calls) == 3 and len(downloads) == 1
        assert len(store.evidence(run_id)) == 2 and set(tools.delivered) == {1, 2}
        assert store.evidence(run_id)[0].content.endswith("audible observation 1")
        assert store.evidence(run_id)[1].content.endswith("audible observation 3")
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_delivered_partial_packet_can_support_an_explicitly_partial_answer(tmp_path, monkeypatch):
    async def observe(number, _parts, _kwargs):
        if number == 2:
            raise ToolError("media_model_unavailable", "fixture", retryable=True)
        return "A piano is audible.", {}
    tools, _, _, _, _, inspector, args, _, _ = media_tools(tmp_path, monkeypatch, observe)
    try:
        result = await tools.execute("inspect", "inspect_media", args)
        assert result["isError"] and result["details"]["coverage"] == "partial"
        accepted = await tools.execute("answer", "submit_answer", {"answer": "A piano is audible in the first 30 seconds.[1]",
            "evidence_ids": [1], "status": "partial", "limitations": ["The next 30 seconds could not be inspected."]})
        assert accepted["details"]["terminal"] == "partial"
        assert accepted["details"]["citations"][0]["end_sec"] == 30
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_cancelled_tool_keeps_saved_packet_but_delivery_requires_a_returned_result(tmp_path, monkeypatch):
    second_started, second_settled = asyncio.Event(), asyncio.Event()
    async def observe(number, _parts, _kwargs):
        if number == 2:
            second_started.set()
            try:
                await asyncio.Future()
            finally:
                second_settled.set()
        return f"packet {number}", {}
    tools, store, run_id, events, _, inspector, args, calls, _ = media_tools(tmp_path, monkeypatch, observe)
    try:
        operation = asyncio.create_task(tools.execute("cancelled", "inspect_media", args))
        await asyncio.wait_for(second_started.wait(), 2)
        operation.cancel()
        with pytest.raises(asyncio.CancelledError):
            await operation
        assert second_settled.is_set() and not inspector.cache.flights
        assert len(store.evidence(run_id)) == 1 and not tools.delivered
        assert any(name == "tool.cancelled" for name, _ in events)
        unavailable = await tools.execute("not-yet-delivered", "recall_evidence", {"evidence_ids": [1]})
        assert unavailable["isError"]
        retried = await tools.execute("continue", "inspect_media", args)
        assert not retried.get("isError") and retried["details"]["evidence_ids"] == [1, 2]
        assert body(retried)["reused_evidence_ids"] == [1] and len(calls) == 3
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_scope_validation_happens_before_any_cached_observation_is_returned(tmp_path, monkeypatch):
    async def observe(number, _parts, _kwargs):
        return f"packet {number}", {}
    tools, _, _, _, _, inspector, args, calls, _ = media_tools(tmp_path, monkeypatch, observe)
    try:
        result = await tools.execute("allowed", "inspect_media", args)
        assert not result.get("isError") and len(calls) == 2
        tools.scope = AccessScope.from_request(request(), set())
        denied = await tools.execute("denied", "inspect_media", args)
        assert denied["isError"] and denied["details"]["code"] == "scope_denied"
        assert "evidence" not in body(denied) and len(calls) == 2
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_required_view_is_rejected_before_media_download(tmp_path, monkeypatch):
    async def observe(*_args):
        raise AssertionError("No model request is allowed")
    tools, _, _, _, _, inspector, args, calls, downloads = media_tools(tmp_path, monkeypatch, observe)
    try:
        args.pop("view")
        result = await tools.execute("missing-view", "inspect_media", args)
        assert result["isError"] and result["details"]["code"] == "invalid_arguments"
        assert not calls and not downloads
    finally:
        await inspector.close()
