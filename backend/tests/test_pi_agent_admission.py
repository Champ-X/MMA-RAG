import asyncio

import pytest

from app.modules.pi_agent.admission import LegacyActivity, LegacyPriorityMiddleware


@pytest.mark.asyncio
async def test_pi_admission_waits_for_all_existing_streams_and_is_cancellable():
    activity, events = LegacyActivity(), []
    emit = lambda name, data, **kw: events.append((name, data))
    activity.enter()
    activity.enter()
    waiting = asyncio.create_task(activity.wait(emit))
    await asyncio.sleep(0)
    assert events[0][0] == "resource.waiting" and not waiting.done()
    activity.leave()
    await asyncio.sleep(0)
    assert not waiting.done()
    activity.leave()
    await waiting
    assert events[-1][0] == "resource.resumed"
    activity.enter()
    cancelled = asyncio.create_task(activity.wait(emit))
    await asyncio.sleep(0)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    activity.leave()
    assert activity.active == 0


@pytest.mark.asyncio
async def test_legacy_stream_lifetime_is_counted_until_disconnect_without_changing_bytes(monkeypatch):
    from app.modules.pi_agent import admission
    activity = LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    packets = []
    async def app(scope, receive, send):
        assert activity.active == 1
        await send({"type": "http.response.start", "status": 200})
        await send({"type": "http.response.body", "body": b"original SSE", "more_body": True})
        raise asyncio.CancelledError
    async def send(packet):
        packets.append(packet)
    with pytest.raises(asyncio.CancelledError):
        await LegacyPriorityMiddleware(app)({"type": "http", "path": "/api/chat/stream"}, None, send)
    assert activity.active == 0 and activity.idle.is_set()
    assert packets[-1]["body"] == b"original SSE"


@pytest.mark.asyncio
async def test_new_legacy_request_between_wakeup_and_resumption_keeps_pi_waiting():
    activity, events = LegacyActivity(), []
    activity.enter()
    waiter = asyncio.create_task(activity.wait(lambda kind, data, **kw: events.append(kind)))
    await asyncio.sleep(0)
    activity.leave()
    activity.enter()
    await asyncio.sleep(0)
    assert not waiter.done() and events == ["resource.waiting"]
    activity.leave()
    await waiter
    assert events[-1] == "resource.resumed"
