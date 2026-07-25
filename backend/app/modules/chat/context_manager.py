"""Budget-aware conversation history selection shared by Web and Feishu chat."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence


ALLOWED_ROLES = frozenset({"user", "assistant"})


@dataclass(frozen=True)
class ConversationContext:
    """A chronological, turn-aware slice of prior conversation messages."""

    messages: List[Dict[str, str]]
    transcript: str
    total_chars: int
    omitted_messages: int

    @property
    def has_history(self) -> bool:
        return bool(self.messages)


def _truncate_middle(text: str, limit: int) -> str:
    text = text.strip()
    if limit <= 0 or len(text) <= limit:
        return text
    if limit <= 12:
        return text[:limit]
    marker = "\n…\n"
    remaining = limit - len(marker)
    prefix = max(1, int(remaining * 0.7))
    return f"{text[:prefix]}{marker}{text[-(remaining - prefix):]}"


def _normalize_messages(
    raw_messages: Iterable[Dict[str, Any]],
    *,
    max_message_chars: int,
) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for raw in raw_messages:
        if not isinstance(raw, dict):
            continue
        role = str(raw.get("role") or "").strip().lower()
        if role not in ALLOWED_ROLES:
            continue
        content = _truncate_middle(str(raw.get("content") or ""), max_message_chars)
        if not content:
            continue
        normalized.append({"role": role, "content": content})
    return normalized


def _group_turns(messages: Sequence[Dict[str, str]]) -> List[List[Dict[str, str]]]:
    """Group a user message and subsequent assistant messages as one atomic turn."""
    turns: List[List[Dict[str, str]]] = []
    current: List[Dict[str, str]] = []
    for message in messages:
        if message["role"] == "user" and current:
            turns.append(current)
            current = []
        current.append(message)
    if current:
        turns.append(current)
    return turns


def _message_cost(message: Dict[str, str]) -> int:
    return len(message["content"]) + len(message["role"]) + 4


def build_conversation_context(
    raw_messages: Iterable[Dict[str, Any]],
    *,
    max_messages: int = 12,
    max_chars: int = 6000,
    max_message_chars: int = 1600,
) -> ConversationContext:
    """Select recent complete turns without exceeding the configured budgets."""
    if max_messages <= 0 or max_chars <= 0:
        return ConversationContext([], "", 0, 0)

    normalized = _normalize_messages(
        raw_messages,
        max_message_chars=max(1, max_message_chars),
    )
    turns = _group_turns(normalized)
    selected_reversed: List[List[Dict[str, str]]] = []
    selected_count = 0
    selected_chars = 0

    for turn in reversed(turns):
        turn_cost = sum(_message_cost(message) for message in turn)
        if selected_reversed and (
            selected_count + len(turn) > max_messages
            or selected_chars + turn_cost > max_chars
        ):
            break
        if not selected_reversed and (len(turn) > max_messages or turn_cost > max_chars):
            # Always preserve the latest turn, but fit it to the hard budget.
            candidates = turn[-max_messages:]
            overhead = sum(len(message["role"]) + 4 for message in candidates)
            per_message_budget = max(1, (max_chars - overhead) // max(1, len(candidates)))
            fitted: List[Dict[str, str]] = []
            for message in candidates:
                content = _truncate_middle(message["content"], per_message_budget)
                fitted.append({"role": message["role"], "content": content})
            turn = fitted
            turn_cost = sum(_message_cost(message) for message in turn)
        if not turn:
            break
        selected_reversed.append(turn)
        selected_count += len(turn)
        selected_chars += turn_cost

    selected = [
        message
        for turn in reversed(selected_reversed)
        for message in turn
    ]
    transcript = "\n".join(
        f"{'用户' if message['role'] == 'user' else '助手'}: {message['content']}"
        for message in selected
    )
    return ConversationContext(
        messages=selected,
        transcript=transcript,
        total_chars=sum(len(message["content"]) for message in selected),
        omitted_messages=max(0, len(normalized) - len(selected)),
    )


def trim_stored_messages(
    raw_messages: Iterable[Dict[str, Any]],
    *,
    max_messages: int = 100,
    max_chars: int = 100_000,
) -> List[Dict[str, Any]]:
    """Bound session storage while retaining the most recent complete turns."""
    items = [item for item in raw_messages if isinstance(item, dict)]
    if len(items) <= max_messages and sum(len(str(item.get("content") or "")) for item in items) <= max_chars:
        return items

    selected: List[Dict[str, Any]] = []
    chars = 0
    for item in reversed(items):
        content_chars = len(str(item.get("content") or ""))
        if selected and (len(selected) >= max_messages or chars + content_chars > max_chars):
            break
        selected.append(item)
        chars += content_chars
    selected.reverse()
    if selected and selected[0].get("role") == "assistant":
        selected = selected[1:]
    return selected
