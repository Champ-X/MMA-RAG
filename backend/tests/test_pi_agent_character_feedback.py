"""Measured character costs help Pi rewrite without changing the user's cap."""
from copy import deepcopy
import json

import pytest

from app.modules.pi_agent.answers import assess_answer, character_count, compact_assessment, repair_feedback
from app.modules.pi_agent.tools import CheckedAnswer
from test_pi_agent_answers import evidence
from test_pi_agent_tools import fixture_tools, source


@pytest.mark.parametrize("text,total,ascii_letters,other", [
    ("**中Aé🔎** [12]\n", 4, 1, 3),
    ("e\u0301 B2[3]", 4, 2, 2),
    ("> 中文#\n", 2, 0, 2),
    ("go go [99]!", 5, 4, 1),
])
def test_character_composition_uses_existing_unicode_and_markup_counting(text, total, ascii_letters, other):
    args = CheckedAnswer(answer=text, max_characters=total).model_dump()
    original = deepcopy(args)
    report = assess_answer(args, {})
    counts = {"total": total, "ascii_letters": ascii_letters, "other_characters": other}
    assert report["body_character_counts"] == counts
    assert report["body_characters"] == character_count(text) == total
    assert repair_feedback(report)["body_character_counts"] == counts
    assert compact_assessment(report)["body_character_counts"] == counts
    assert args == original


def test_english_characters_are_not_words_and_the_host_does_not_translate_or_shorten():
    args = CheckedAnswer(answer="alpha beta gamma[1]", evidence_ids=[1], max_characters=8,
        statements=[{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]).model_dump()
    original = deepcopy(args)
    report = assess_answer(args, {1: evidence(text="alpha beta gamma")})
    assert report["body_character_counts"] == {"total": 14, "ascii_letters": 14, "other_characters": 0}
    assert report["errors"] == [{"code": "answer_too_long", "actual": 14, "maximum": 8,
        "over_by": 6, "message": "正文超出所声明的用户篇幅要求，请由Pi缩短后重新检查或提交。"}]
    assert report["declared_max_characters"] == 8 and args == original


def test_body_character_profile_excludes_limitation_text():
    args = CheckedAnswer(answer="未找到支持", outcome="not_found", status="partial",
        limitations=["Unseen scope"], statements=[{"unit_id": "a1", "kind": "abstention"},
            {"unit_id": "l1", "kind": "limitation"}]).model_dump()
    report = assess_answer(args, {})
    assert report["protocol_valid"]
    assert report["body_character_counts"] == {"total": 5, "ascii_letters": 0, "other_characters": 5}
    assert "not independently verified" in report["semantic_support"]


@pytest.mark.asyncio
async def test_check_and_failed_submission_deliver_the_same_counts_and_preserve_original_arguments(tmp_path):
    tools, store, run, _ = fixture_tools(tmp_path, requirement_limit=10)
    tools.emit = lambda kind, data, **kw: store.append(run, kind, data, **kw)
    await tools.execute("read", "read_source", {"source_id": source().id})
    args = {"answer": "指标Alpha为17，条件Beta为3[1]。", "evidence_ids": [1],
        "statements": [{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]}
    original = deepcopy(args)
    checked = await tools.execute("check", "check_answer", args)
    report = json.loads(checked["content"][0]["text"])
    expected = {"total": 20, "ascii_letters": 9, "other_characters": 11}
    assert report["body_character_counts"] == expected
    assert store.artifact(run, checked["details"]["artifact_id"])["body_character_counts"] == expected
    rejected = await tools.execute("submit", "submit_answer", args)
    assert rejected["isError"] and rejected["details"]["code"] == "answer_too_long"
    message = rejected["details"]["message"]
    feedback = json.loads(message[message.index("{"):])
    assert feedback["body_character_counts"] == expected
    assert feedback["declared_max_characters"] == 10
    assert feedback["over_by"] == 10 and args == original
    assert not tools.final_result and tools.ledger.model_requests == 0
    start = next(e for e in store.events(run) if e["type"] == "tool.started" and e["data"]["name"] == "submit_answer")
    assert start["data"]["args"]["answer"] == original["answer"]
