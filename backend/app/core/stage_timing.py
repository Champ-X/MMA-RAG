"""Request-local stage clocks shared by streaming services and saved history."""
from __future__ import annotations

import copy
import math
import time
from typing import Callable


class StageTimings:
    """Use monotonic durations; wall time is only an anchor for live UI clocks."""

    def __init__(self, *, monotonic: Callable[[], float] = time.perf_counter,
                 wall_time: Callable[[], float] = time.time):
        self._monotonic = monotonic
        self._wall_time = wall_time
        self._started: dict[str, float] = {}
        self._stages: dict[str, dict] = {}

    def start(self, stage: str) -> dict:
        # Progress updates and repeated model tokens must not restart the clock.
        if stage not in self._stages:
            self._started[stage] = self._monotonic()
            self._stages[stage] = {"started_at": self._wall_time() * 1000,
                                   "duration_ms": 0.0, "status": "processing"}
        return self.snapshot()[stage]

    def finish(self, stage: str, *, status: str = "completed",
               substage_durations_ms: dict | None = None) -> dict | None:
        if stage not in self._stages:
            return None  # An unexecuted stage has no measured duration.
        timing = self._stages[stage]
        if timing["status"] == "processing":
            timing["duration_ms"] = self._elapsed(stage)
            timing["status"] = status
        if substage_durations_ms:
            clean = {name: float(value) for name, value in substage_durations_ms.items()
                     if type(value) in {int, float} and math.isfinite(value) and value >= 0}
            if clean:
                timing["substage_durations_ms"] = clean
        return copy.deepcopy(timing)

    def finish_active(self, status: str) -> None:
        for stage, timing in self._stages.items():
            if timing["status"] == "processing":
                self.finish(stage, status=status)

    def _elapsed(self, stage: str) -> float:
        return round(max(0, self._monotonic() - self._started[stage]) * 1000, 3)

    def snapshot(self) -> dict[str, dict]:
        result = copy.deepcopy(self._stages)
        for stage, timing in result.items():
            if timing["status"] == "processing":
                timing["duration_ms"] = self._elapsed(stage)
        return result

    def attach(self, stage: str, payload: dict) -> dict:
        snapshot = self.snapshot()
        result = {**payload, "stage_timings": snapshot}
        if stage in snapshot:
            result["stage_timing"] = snapshot[stage]
        return result
