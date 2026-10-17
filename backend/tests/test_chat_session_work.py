import asyncio
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr

from app.api import chat, pi_agent
from app.modules.chat import session_work
from app.modules.pi_agent.store import RunStore


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    settings = SimpleNamespace(data_dir=tmp_path, api_token=None, trusted_user_id=None, enabled=False)
    monkeypatch.setattr(session_work, 'get_pi_settings', lambda: settings)
    monkeypatch.setattr(pi_agent, 'get_pi_settings', lambda: settings)
    monkeypatch.setattr(chat, 'sessions', {})
    return settings


def application(workspace, monkeypatch):
    store = RunStore(workspace.data_dir / 'runs.sqlite3')

    class Host:
        async def close_session(self, session_id, owner):
            store.close_session(owner, session_id)
            return {'session_id': session_id, 'closed': True, 'runs': []}

    monkeypatch.setattr(pi_agent, 'host', Host)
    app = FastAPI()
    app.include_router(chat.router, prefix='/api/chat')
    app.include_router(pi_agent.router, prefix='/api/pi')
    return app, store


def test_admission_reads_only_existing_ledger_and_handles_pre_migration_schema(workspace):
    path = workspace.data_dir / 'runs.sqlite3'
    assert session_work.ensure_session_open('alice', 'fresh')
    assert not path.exists()
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE old_runs (id TEXT)')
    assert session_work.ensure_session_open('alice', 'fresh')
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [('old_runs',)]
    store = RunStore(path)
    store.close_session('alice', 'closed')
    with pytest.raises(HTTPException) as error:
        session_work.ensure_session_open('alice', 'closed')
    assert error.value.status_code == 409
    assert session_work.ensure_session_open('bob', 'closed')


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['get', 'multipart', 'message'])
async def test_delete_from_another_client_waits_for_legacy_cleanup_and_blocks_late_requests(workspace, monkeypatch, kind):
    app, store = application(workspace, monkeypatch)
    entered, cleanup_started, release_cleanup, cleaned = (asyncio.Event() for _ in range(4))
    calls = []
    second_delete = asyncio.Event()
    close_count = 0
    persist_close = store.close_session

    def close_session(owner, session_id):
        nonlocal close_count
        persist_close(owner, session_id)
        close_count += 1
        if close_count == 2:
            second_delete.set()

    monkeypatch.setattr(store, 'close_session', close_session)

    async def paid_work():
        calls.append(kind)
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleanup_started.set()
            await release_cleanup.wait()
            cleaned.set()

    async def iterate(**kwargs):
        await paid_work()
        yield 'data: {}\n\n'

    async def summarize(**kwargs):
        await paid_work()
        raise AssertionError('cancelled summaries cannot resume')

    async def message(data):
        await paid_work()

    monkeypatch.setattr(chat, '_iter_chat_sse', iterate)
    monkeypatch.setattr(chat, 'summarize_chat_attachments', summarize)
    monkeypatch.setattr(chat, '_chat_message', message)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as sender, \
            httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as deleter:
        def send():
            if kind == 'get':
                return sender.get('/api/chat/stream', params={'message': 'question', 'sessionId': 'shared'})
            if kind == 'message':
                return sender.post('/api/chat/message', json={'message': 'question', 'sessionId': 'shared'})
            return sender.post('/api/chat/stream', data={'message': 'question', 'sessionId': 'shared'},
                               files={'files': ('picture.png', b'fixture', 'image/png')})

        sending = asyncio.create_task(send())
        await asyncio.wait_for(entered.wait(), 2)
        deleting = asyncio.create_task(deleter.delete('/api/pi/sessions/shared'))
        await asyncio.wait_for(cleanup_started.wait(), 2)
        await asyncio.sleep(0)
        assert not deleting.done(), 'Deletion must await physical provider/generator cleanup'
        retrying = asyncio.create_task(deleter.delete('/api/pi/sessions/shared'))
        await asyncio.wait_for(second_delete.wait(), 2)
        assert not retrying.done(), 'A retry must wait for cleanup, not cancel its finally block again'
        release_cleanup.set()
        response = await asyncio.wait_for(deleting, 2)
        assert (await asyncio.wait_for(retrying, 2)).status_code == 200
        await asyncio.gather(sending, return_exceptions=True)
        assert response.status_code == 200 and cleaned.is_set()
        assert (await send()).status_code == 409
        assert calls == [kind]
        assert not session_work._active


@pytest.mark.asyncio
@pytest.mark.parametrize('asgi_version', ['2.0', '2.4'])
async def test_stream_cancelled_during_asgi_send_closes_suspended_generator(workspace, monkeypatch, asgi_version):
    sending, cleanup_started, release = (asyncio.Event() for _ in range(3))

    async def content(**kwargs):
        try:
            yield 'data: started\n\n'
        finally:
            cleanup_started.set()
            await release.wait()

    async def send(frame):
        if frame['type'] == 'http.response.body':
            sending.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(chat, '_iter_chat_sse', content)
    response = await chat.stream_chat(message='question', knowledgeBaseIds=None, selectedFiles=None,
                                     referenceFiles=None, mentions=None, sessionId='shared', model=None, agentMode='direct')
    async def receive():
        await asyncio.Event().wait()
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': [], 'asgi': {'spec_version': asgi_version}}
    # Exercise both the response's owned task and direct stream_response
    # dispatch, so cancellation also works when the request task owns work.
    task = asyncio.create_task(response.stream_response(send) if asgi_version == '2.4'
                               else response(scope, receive, send))
    await asyncio.wait_for(sending.wait(), 2)
    tasks = session_work.stop_session_work('local-workspace', 'shared')
    await asyncio.wait_for(cleanup_started.wait(), 2)
    assert len(tasks) == 1 and not task.done()
    if asgi_version == '2.4':
        assert tasks == (task,), 'ASGI 2.4 streams in the request task itself'
    assert session_work.stop_session_work('local-workspace', 'shared') == tasks
    assert tasks[0].cancelling() == 1
    release.set()
    await asyncio.gather(*tasks, return_exceptions=True)
    outcome = (await asyncio.gather(task, return_exceptions=True))[0]
    if asgi_version == '2.4':
        assert isinstance(outcome, asyncio.CancelledError)
    assert not session_work._active


@pytest.mark.asyncio
async def test_http_disconnect_waits_for_async_generator_cleanup_and_runs_background(workspace):
    entered, disconnected, cleanup_started, release, cleaned = (asyncio.Event() for _ in range(5))
    background_calls = []

    async def content():
        try:
            yield 'data: started\n\n'
            entered.set()
            await asyncio.Event().wait()
        finally:
            cleanup_started.set()
            await release.wait()
            cleaned.set()

    async def send(frame):
        pass

    async def receive():
        await disconnected.wait()
        return {'type': 'http.disconnect'}

    async def background():
        background_calls.append(cleaned.is_set())

    response = session_work.SessionStreamingResponse(content(), owner='local-workspace', session_id='disconnect')
    response.background = background
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': [], 'asgi': {'spec_version': '2.0'}}
    serving = asyncio.create_task(response(scope, receive, send))
    await asyncio.wait_for(entered.wait(), 2)
    disconnected.set()
    await asyncio.wait_for(cleanup_started.wait(), 2)
    assert not serving.done()
    assert session_work._active, 'The session must remain registered until provider cleanup completes'
    release.set()
    await asyncio.wait_for(serving, 2)
    assert cleaned.is_set() and not session_work._active
    assert background_calls == [True]


@pytest.mark.asyncio
async def test_disconnect_before_delete_still_waits_for_legacy_provider_cleanup(workspace, monkeypatch):
    app, _ = application(workspace, monkeypatch)
    entered, disconnected, cleanup_started, release, cleaned = (asyncio.Event() for _ in range(5))

    async def content(**kwargs):
        try:
            yield 'data: started\n\n'
            entered.set()
            await asyncio.Event().wait()
        finally:
            cleanup_started.set()
            await release.wait()
            cleaned.set()

    async def send(frame):
        pass

    async def receive():
        await disconnected.wait()
        return {'type': 'http.disconnect'}

    monkeypatch.setattr(chat, '_iter_chat_sse', content)
    response = await chat.stream_chat(message='question', knowledgeBaseIds=None, selectedFiles=None,
                                     referenceFiles=None, mentions=None, sessionId='shared', model=None, agentMode='direct')
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': [], 'asgi': {'spec_version': '2.0'}}
    serving = asyncio.create_task(response(scope, receive, send))
    await asyncio.wait_for(entered.wait(), 2)
    disconnected.set()
    await asyncio.wait_for(cleanup_started.wait(), 2)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
        deleting = asyncio.create_task(client.delete('/api/pi/sessions/shared'))
        await asyncio.sleep(0)
        assert not deleting.done() and not cleaned.is_set()
        # DELETE must not inject a second cancellation into the same finally.
        running = next(iter(session_work._active.values()))
        assert all(task.cancelling() == 1 for task in running)
        release.set()
        assert (await asyncio.wait_for(deleting, 2)).status_code == 200
    await asyncio.wait_for(serving, 2)
    assert cleaned.is_set() and not session_work._active


@pytest.mark.asyncio
async def test_owned_stream_propagates_asgi_send_errors_after_cleanup(workspace):
    cleaned = asyncio.Event()
    background_calls = []

    async def content():
        try:
            yield 'data: started\n\n'
        finally:
            await asyncio.sleep(0)
            cleaned.set()

    async def send(frame):
        if frame['type'] == 'http.response.body':
            raise RuntimeError('fixture ASGI send failure')

    async def receive():
        await asyncio.Event().wait()

    async def background():
        background_calls.append(True)

    response = session_work.SessionStreamingResponse(content(), owner='local-workspace', session_id='send-error')
    response.background = background
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': [], 'asgi': {'spec_version': '2.0'}}
    with pytest.raises(RuntimeError, match='fixture ASGI send failure'):
        await asyncio.wait_for(response(scope, receive, send), 2)
    assert cleaned.is_set() and not session_work._active
    assert not background_calls


@pytest.mark.asyncio
async def test_request_cancellation_during_disconnect_cleanup_is_deferred_not_swallowed(workspace):
    entered, cleanup_started, release, cleaned = (asyncio.Event() for _ in range(4))

    async def content():
        try:
            entered.set()
            await asyncio.Event().wait()
            yield 'unreachable'
        finally:
            cleanup_started.set()
            await release.wait()
            cleaned.set()

    async def send(frame):
        pass

    async def receive():
        await entered.wait()
        return {'type': 'http.disconnect'}

    response = session_work.SessionStreamingResponse(content(), owner='local-workspace', session_id='request-cancel')
    scope = {'type': 'http', 'method': 'GET', 'path': '/', 'headers': [], 'asgi': {'spec_version': '2.0'}}
    serving = asyncio.create_task(response(scope, receive, send))
    await asyncio.wait_for(cleanup_started.wait(), 2)
    serving.cancel()
    await asyncio.sleep(0)
    assert not serving.done() and not cleaned.is_set()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await serving
    assert cleaned.is_set() and not session_work._active


@pytest.mark.asyncio
async def test_unauthenticated_delete_cannot_cancel_and_owner_isolation_is_preserved(workspace, monkeypatch):
    workspace.api_token = SecretStr('test-only-token')
    app, _ = application(workspace, monkeypatch)
    started = asyncio.Event()

    async def work():
        with session_work.track_session_work('other-owner', 'shared'):
            started.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(work())
    await started.wait()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
            assert (await client.delete('/api/pi/sessions/shared')).status_code == 401
            assert (await client.delete('/api/pi/sessions/shared', headers={'Authorization': 'Bearer test-only-token'})).status_code == 200
        assert not task.done()
        assert session_work.ensure_session_open('other-owner', 'shared')
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
