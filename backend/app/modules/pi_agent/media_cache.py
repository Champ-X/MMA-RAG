"""Run-local exact-result memoization with cancellation-safe shared work.

No identity, permission or semantic-equivalence decisions belong here. The
caller supplies a versioned exact key after validating the source and request.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class _Flight:
    task: asyncio.Task
    waiters: int = 0


async def settle_cancelled(task: asyncio.Task):
    """Do not leave ffmpeg or a blocking-download cleanup behind a cancellation."""
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break
    if not task.cancelled():
        # Retrieve a failure even when every waiter was cancelled.
        task.exception()


class RunMediaCache:
    def __init__(self):
        self.values: dict[str, Any] = {}
        self.flights: dict[str, _Flight] = {}
        self.closed = False

    async def get(self, key: str, create: Callable[[], Awaitable[Any]]):
        if self.closed:
            raise RuntimeError("Media cache is closed")
        if key in self.values:
            return self.values[key], True
        flight = self.flights.get(key)
        if flight is not None and not flight.waiters and flight.task.cancelling():
            # A retry arriving while the last cancelled waiter's download is
            # settling must not attach to doomed work or race its file writer.
            await asyncio.shield(asyncio.gather(flight.task, return_exceptions=True))
            if self.flights.get(key) is flight:
                self.flights.pop(key)
            return await self.get(key, create)
        reused = flight is not None
        if flight is None:
            async def acquire():
                value = await create()
                if not self.closed:
                    self.values[key] = value
                return value

            flight = _Flight(asyncio.create_task(acquire(), name="pi-media-acquisition"))
            self.flights[key] = flight
        flight.waiters += 1
        try:
            return await asyncio.shield(flight.task), reused
        finally:
            flight.waiters -= 1
            if not flight.waiters:
                if not flight.task.done():
                    flight.task.cancel()
                    await settle_cancelled(flight.task)
                elif not flight.task.cancelled():
                    flight.task.exception()
                if self.flights.get(key) is flight:
                    self.flights.pop(key)

    async def close(self):
        if self.closed:
            return
        self.closed = True
        pending = [flight.task for flight in self.flights.values()]
        for task in pending:
            task.cancel()
        await asyncio.gather(*(settle_cancelled(task) for task in pending))
        self.flights.clear()
        self.values.clear()
