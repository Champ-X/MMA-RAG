from __future__ import annotations

import re

_CHINESE_CONTEXT_REFERENCES = (
    "它",
    "他",
    "她",
    "其",
    "这个",
    "那个",
    "这些",
    "那些",
    "上述",
    "上面",
    "刚才",
    "之前",
    "继续",
)
_ENGLISH_CONTEXT_REFERENCE_RE = re.compile(
    r"\b(?:this|that|these|those|it|its|previous|above|continue)\b"
)


def is_contextual_follow_up(question: str) -> bool:
    """Return whether a question explicitly refers to an earlier conversation turn."""
    normalized = question.casefold()
    return any(token in normalized for token in _CHINESE_CONTEXT_REFERENCES) or bool(
        _ENGLISH_CONTEXT_REFERENCE_RE.search(normalized)
    )
