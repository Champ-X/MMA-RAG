import asyncio
from unittest.mock import AsyncMock

import pytest

from app.modules.retrieval.processors.intent import IntentProcessor


@pytest.mark.asyncio
async def test_adaptive_local_failure_preserves_original_intent_processor(monkeypatch):
    processor = IntentProcessor()
    processor.jev_mode = "adaptive"
    baseline = {"intent_type": "comparison", "refined_query": "original full rewrite", "is_complex": True}
    processor._process_generative = AsyncMock(return_value=baseline)
    monkeypatch.setattr("app.modules.retrieval.processors.intent.verify_plan",
                        AsyncMock(side_effect=RuntimeError("do not expose local data")))
    result = await processor.process("Compare two plans")
    assert result["intent_type"] == "comparison"
    assert result["refined_query"] == "original full rewrite"
    assert result["jev_decision"] == {"mode": "adaptive", "strategy": "plan_first", "accepted": False,
                                       "status": "fallback", "reason": "unexpected_error"}
    processor._process_generative.assert_awaited_once()


@pytest.mark.asyncio
async def test_adaptive_cancellation_does_not_repeat_the_completed_planner(monkeypatch):
    processor = IntentProcessor()
    processor.jev_mode = "adaptive"
    processor._process_generative = AsyncMock()
    monkeypatch.setattr("app.modules.retrieval.processors.intent.verify_plan",
                        AsyncMock(side_effect=asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        await processor.process("Compare two plans")
    processor._process_generative.assert_awaited_once()
