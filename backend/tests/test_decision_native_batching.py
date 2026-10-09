"""Gateway limits must not truncate, partially apply, or extend a Decision call."""
import asyncio
import copy
import json

import httpx
import pytest

from app.core.llm.jev import JevClient, JevError, relevance_payload


MODEL = "decision-model-preview"


def native_response(payload, **usage):
    # Deliberately reverse response order to detect positional joins.
    return {
        "model": payload["model"],
        "answers": {key: {"type": "noul", "noul": int(key[1:]) / 100}
                    for key in reversed(payload["questions"])},
        "usage": {"input_tokens": len(payload["questions"]) * 100, **usage},
    }


def client(handler, **kwargs):
    return JevClient("private-key", provider="bailian", model=MODEL,
                     transport=httpx.MockTransport(handler), **kwargs)


@pytest.mark.asyncio
async def test_twenty_candidates_keep_original_ids_evidence_and_all_scores():
    calls = []
    documents = [f"Independent passage {i}" for i in range(20)]
    expected = relevance_payload("Query", documents, MODEL)

    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload["state"] == expected["state"]
        assert len(payload["questions"]) <= 16
        assert all(question == expected["questions"][key]
                   for key, question in payload["questions"].items())
        return httpx.Response(200, json=native_response(payload))

    current = client(handler)
    result = await current.score("Query", documents)
    assert [list(call["questions"]) for call in calls] == [
        [f"d{i}" for i in range(16)], [f"d{i}" for i in range(16, 20)]]
    assert result.scores == [{"index": i, "relevance_score": i / 100} for i in range(20)]
    assert result.usage == {"input_tokens": 2000}
    assert current.reserved_input_tokens == 2000
    assert result.metadata()["native_request_count"] == 2
    assert result.metadata()["native_batch_sizes"] == [16, 4]
    assert result.metadata()["reported_usd"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("count,expected_sizes", [(16, [16]), (17, [16, 1]), (64, [16] * 4)])
async def test_native_limit_boundaries_preserve_input_and_complete_answer_set(count, expected_sizes):
    payload = relevance_payload("Query", ["Evidence"] * count, MODEL)
    original = copy.deepcopy(payload)
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        return httpx.Response(200, json=native_response(body, output_tokens=0, cost=.0001))

    result = await client(handler).evaluate(payload["state"], payload["questions"], prompt_version="test")
    assert [len(call["questions"]) for call in calls] == expected_sizes
    assert set(result.answers) == set(payload["questions"])
    assert result.usage == {"input_tokens": count * 100, "output_tokens": 0,
                            "cost": pytest.approx(len(expected_sizes) * .0001)}
    assert payload == original


@pytest.mark.asyncio
async def test_partially_known_optional_usage_remains_unknown():
    count = 0

    def handler(request):
        nonlocal count
        count += 1
        usage = {"cost": .1, "output_tokens": 0} if count == 1 else {}
        return httpx.Response(200, json=native_response(json.loads(request.content), **usage))

    result = await client(handler).score("Query", ["Evidence"] * 20)
    assert count == 2 and result.usage == {"input_tokens": 2000}
    assert result.metadata()["cost_source"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,reason", [
    ("http", "http_429"), ("missing", "incomplete_answers"),
    ("wrong_batch", "incomplete_answers"), ("model", "model_mismatch"),
    ("score", "invalid_score"), ("usage", "invalid_usage"),
])
async def test_bad_second_batch_never_returns_partial_answers_or_sends_later_batches(failure, reason):
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        response = native_response(body)
        if len(calls) == 2:
            if failure == "http":
                return httpx.Response(429, text="private-key private state")
            if failure == "missing":
                response["answers"].pop("d16")
            if failure == "wrong_batch":
                response["answers"] = native_response(calls[0])["answers"]
            if failure == "model":
                response["model"] = "unrequested-model"
            if failure == "score":
                response["answers"]["d16"]["noul"] = True
            if failure == "usage":
                response["usage"]["input_tokens"] = -1
        return httpx.Response(200, json=response)

    payload = relevance_payload("Query", ["Evidence"] * 40, MODEL)
    current = client(handler)
    with pytest.raises(JevError, match=f"^{reason}$"):
        await current.evaluate(payload["state"], payload["questions"], prompt_version="test")
    assert len(calls) == 2 and current.reserved_input_tokens > 4000
    if failure == "http":
        with pytest.raises(JevError, match="^circuit_open$"):
            await current.score("Query", ["Evidence"])
        assert len(calls) == 2


@pytest.mark.asyncio
async def test_one_deadline_cancels_inflight_batch_and_starts_no_more(monkeypatch):
    timeouts = []
    original_wait = asyncio.wait_for

    async def wait_once(awaitable, timeout):
        timeouts.append(timeout)
        return await original_wait(awaitable, timeout)

    monkeypatch.setattr(asyncio, "wait_for", wait_once)
    calls = []
    cancelled = asyncio.Event()

    async def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 2:
            try:
                await asyncio.sleep(20)
            finally:
                cancelled.set()
        return httpx.Response(200, json=native_response(body))

    current = client(handler, timeout_s=.05)
    payload = relevance_payload("Query", ["Evidence"] * 40, MODEL)
    with pytest.raises(JevError, match="^timeout$"):
        await current.evaluate(payload["state"], payload["questions"], prompt_version="test")
    assert timeouts == [.05] and len(calls) == 2 and cancelled.is_set()
    assert current.reserved_input_tokens > 0


@pytest.mark.asyncio
async def test_caller_cancellation_stops_remaining_batches():
    calls = []
    second_started = asyncio.Event()
    cancelled = asyncio.Event()

    async def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 2:
            second_started.set()
            try:
                await asyncio.sleep(20)
            finally:
                cancelled.set()
        return httpx.Response(200, json=native_response(body))

    current = client(handler)
    task = asyncio.create_task(current.score("Query", ["Evidence"] * 20))
    await asyncio.wait_for(second_started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) == 2 and cancelled.is_set() and current.reserved_input_tokens > 0


@pytest.mark.asyncio
async def test_budget_covers_all_batches_before_first_network_call():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=native_response(json.loads(request.content)))

    current = client(handler, max_input_tokens=15000)  # One batch fits; both do not.
    with pytest.raises(JevError, match="^budget_exhausted$"):
        await current.score("Query", ["Evidence"] * 20)
    assert not calls and current.reserved_input_tokens == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,model", [
    ("typesafe", "jev-1.13.0"), ("openrouter", "openai/gpt-6-luna-decisions"),
])
async def test_other_providers_keep_existing_single_request_contract(provider, model):
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        return httpx.Response(200, json=native_response(body, output_tokens=0))

    current = JevClient("private-key", provider=provider, model=model,
                        transport=httpx.MockTransport(handler))
    result = await current.score("Query", ["Evidence"] * 20)
    assert len(calls) == 1 and len(result.scores) == 20
