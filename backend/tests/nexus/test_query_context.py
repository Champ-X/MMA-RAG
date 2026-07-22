from __future__ import annotations

import pytest

from nexus.shared.domain.query_context import is_contextual_follow_up


@pytest.mark.parametrize(
    "question",
    [
        "What about it?",
        "Can you continue from the previous answer?",
        "它的发布日期是什么？",
    ],
)
def test_contextual_follow_up_detects_explicit_references(question: str) -> None:
    assert is_contextual_follow_up(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "What is the capital of France?",
        "Summarize the itinerary.",
        "Thisness is not a follow-up reference.",
    ],
)
def test_contextual_follow_up_does_not_match_english_substrings(question: str) -> None:
    assert is_contextual_follow_up(question) is False
