"""Track legacy request lifetimes in the trusted single-user workspace.

Event-stream disconnects and explicit session deletion are separate actions.
Deletion also reaches work submitted by other tabs or HTTP clients. Admission
only reads an existing ledger; ordinary chat never starts a Pi supervisor.
"""
from __future__ import annotations

import asyncio
import sqlite3
from contextlib import closing, contextmanager

from fastapi import HTTPException
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.modules.pi_agent.config import get_pi_settings


_active: dict[tuple[str, str, str], set[asyncio.Task]] = {}
_closed: set[tuple[str, str, str]] = set()


def workspace_owner() -> str:
    # Legacy chat already operates in one trusted workspace, not client-selected
    # tenants. Match the identity enforced by the authenticated deletion route.
    settings = get_pi_settings()
    return settings.trusted_user_id or ("configured-workspace" if settings.api_token else "local-workspace")


def _key(owner: str, session_id: str, data_dir=None):
    return (str((data_dir or get_pi_settings().data_dir).resolve() / "runs.sqlite3"), owner, session_id)


def ensure_session_open(owner: str, session_id: str):
    key = _key(owner, session_id)
    if key not in _closed:
        path = (get_pi_settings().data_dir / "runs.sqlite3").resolve()
        if path.is_file():
            # mode=ro prevents missing files from creating an unused Pi ledger.
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=10)) as db:
                table = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pi_closed_sessions'").fetchone()
                if table and db.execute("SELECT 1 FROM pi_closed_sessions WHERE owner=? AND session_id=?",
                                        (owner, session_id)).fetchone():
                    _closed.add(key)
    if key in _closed:
        raise HTTPException(409, "此会话已删除，不能继续创建任务。请在新会话中重试。")
    return key


@contextmanager
def track_session_work(owner: str, session_id: str):
    # No await between checking the durable fence and registering. Closing and
    # admission are atomic relative to other requests on this server event loop.
    key = ensure_session_open(owner, session_id)
    task = asyncio.current_task()
    tasks = _active.setdefault(key, set())
    tasks.add(task)
    try:
        yield
    finally:
        tasks.discard(task)
        if not tasks:
            _active.pop(key, None)


def stop_session_work(owner: str, session_id: str, *, data_dir=None):
    key = _key(owner, session_id, data_dir)
    _closed.add(key)
    tasks = tuple(_active.get(key, ()))
    for task in tasks:
        # A repeated DELETE (or a disconnected stream) must not inject another
        # CancelledError into the provider/generator's asynchronous finally block.
        if not task.cancelling():
            task.cancel()
    return tasks


class SessionStreamingResponse(StreamingResponse):
    def __init__(self, content, *, owner: str, session_id: str):
        ensure_session_open(owner, session_id)
        super().__init__(content, media_type="text/event-stream")
        self.owner, self.session_id = owner, session_id

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        # Starlette 0.27 cancels an AnyIO scope on disconnect. Its repeated
        # cancellation interrupts await points inside the provider's finally
        # block. Own the stream in an independent asyncio task so disconnect,
        # DELETE and request cancellation all issue at most one cancellation.
        stream = asyncio.create_task(self.stream_response(send))
        disconnect = asyncio.create_task(self.listen_for_disconnect(receive))
        tasks = (stream, disconnect)
        interrupted_during_cleanup = False
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                if not task.done() and not task.cancelling():
                    task.cancel()
            settled = asyncio.gather(*tasks, return_exceptions=True)
            while not settled.done():
                try:
                    await asyncio.shield(settled)
                except asyncio.CancelledError:
                    # A second disconnect/shutdown must not cancel cleanup.
                    interrupted_during_cleanup = True
                    continue
        if interrupted_during_cleanup:
            raise asyncio.CancelledError
        # Preserve real ASGI/generator errors. A cancelled child is the normal
        # outcome of an explicit stop or disconnect, not an application error.
        for task in tasks:
            if not task.cancelled():
                task.result()
        if self.background is not None:
            await self.background()

    async def stream_response(self, send):
        with track_session_work(self.owner, self.session_id):
            try:
                await super().stream_response(send)
            finally:
                # Cancellation can arrive while ASGI is sending a yielded chunk.
                # Close the generator here so attachment/provider cleanup finishes
                # before deletion acknowledges that the request has stopped.
                await self.body_iterator.aclose()
