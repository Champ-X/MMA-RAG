"""Give interactive legacy retrieval priority over new Pi model/tool admissions.

Counts HTTP lifetimes only. No query, model choice, retrieval result or generation
parameter in the existing pipeline is read or changed by this middleware.
"""
from __future__ import annotations

import asyncio
import time


class LegacyActivity:
    def __init__(self):
        self.active = 0
        self.idle = asyncio.Event()
        self.idle.set()

    def enter(self):
        self.active += 1
        self.idle.clear()

    def leave(self):
        self.active = max(0, self.active - 1)
        if not self.active:
            self.idle.set()

    async def wait(self, emit, *, parent_span_id=None):
        if not self.active:
            return
        started = time.monotonic()
        span = f"resource:{time.monotonic_ns()}"
        emit("resource.waiting", {"reason": "legacy_priority", "message": "等待检索资源，已有对话正在使用服务。"},
             span_id=span, parent_span_id=parent_span_id)
        # Another legacy request can enter after Event.set() wakes this waiter
        # but before it is scheduled. Re-check the count before admission.
        while self.active:
            await self.idle.wait()
        emit("resource.resumed", {"reason": "legacy_priority", "message": "资源可用，继续自主研究。",
             "duration_ms": round((time.monotonic() - started) * 1000)}, span_id=span, parent_span_id=parent_span_id)


legacy_activity = LegacyActivity()


class LegacyPriorityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        relevant = scope.get("type") == "http" and (
            path in {"/api/chat/stream", "/api/chat/message"} or path.startswith("/api/v1/retrieval"))
        if relevant:
            legacy_activity.enter()
        try:
            await self.app(scope, receive, send)
        finally:
            if relevant:
                legacy_activity.leave()
