"""Resource admission for Pi work, separate from legacy request behavior.

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

    async def wait(self, emit, *, parent_span_id=None, resource="search", max_wait_seconds=1.0):
        if not self.active:
            return
        started = time.monotonic()
        span = f"resource:{time.monotonic_ns()}"
        emit("resource.waiting", {"reason": "legacy_priority", "resource": resource,
             "message": "优先处理正在进行的普通检索，稍后继续。"},
             span_id=span, parent_span_id=parent_span_id)
        # Another legacy request can enter after Event.set() wakes this waiter
        # but before it is scheduled. Re-check the count before admission.
        deadline = started + max(0.0, max_wait_seconds)
        while self.active:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                await asyncio.wait_for(self.idle.wait(), remaining)
            except asyncio.TimeoutError:
                break
        # This is a scheduling grace period, never a task deadline. A continuous
        # stream of ordinary requests cannot starve already-admitted Pi work.
        emit("resource.resumed", {"reason": "legacy_priority", "resource": resource,
             "admission": "aged" if self.active else "idle",
             "message": "继续自主研究。", "duration_ms": round((time.monotonic() - started) * 1000)},
             span_id=span, parent_span_id=parent_span_id)


class ProviderCapacity:
    """Shared Pi capacity per provider; unrelated providers never block each other."""
    def __init__(self, capacity=2):
        self.capacity = capacity
        self.gates = {}

    async def acquire(self, provider, emit, *, parent_span_id=None):
        gate = self.gates.setdefault(provider, asyncio.Semaphore(self.capacity))
        started = time.monotonic()
        span = f"resource:{time.monotonic_ns()}"
        waiting = gate.locked()
        if waiting:
            emit("resource.waiting", {"reason": "provider_capacity", "resource": f"provider:{provider}",
                 "message": "等待模型服务的可用并发容量。"}, span_id=span, parent_span_id=parent_span_id)
        await gate.acquire()
        if waiting:
            try:
                emit("resource.resumed", {"reason": "provider_capacity", "resource": f"provider:{provider}",
                     "message": "模型服务容量可用。", "duration_ms": round((time.monotonic() - started) * 1000)},
                     span_id=span, parent_span_id=parent_span_id)
            except BaseException:
                gate.release()
                raise
        return gate


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
