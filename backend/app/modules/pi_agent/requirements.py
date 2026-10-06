"""Bind Pi's interpretation to user text; preserve it through later tool calls.

Literal quote identity is checked here. Whether the quoted words actually impose
the declared requirement remains Pi's semantic judgment, not a regex parser.
"""
from __future__ import annotations

import json

from .policy import ToolError


def _whitespace_quote_hint(quote: str, texts: list[tuple]) -> dict | None:
    """Suggest a bounded exact span, never silently accept a normalized quote."""
    compact_quote = "".join(quote.split())
    for kind, index, text in texts:
        positions = [offset for offset, char in enumerate(text) if not char.isspace()]
        compact_text = "".join(text[offset] for offset in positions)
        match = compact_text.find(compact_quote)
        while match >= 0:
            start, end = positions[match], positions[match + len(compact_quote) - 1] + 1
            # Keep the candidate within the existing length_quote schema. Long
            # whitespace gaps must not amplify error output or yield invalid args.
            if end - start <= 500:
                return {"length_quote": text[start:end], "length_origin": {
                    "kind": kind, "history_index": index, "start": start, "end": end}}
            match = compact_text.find(compact_quote, match + 1)
    return None


def bind_requirements(args: dict, request: dict) -> dict:
    limit, quote = args["max_characters"], args["length_quote"]
    if (limit is None) != (quote is None):
        raise ToolError("invalid_length_requirement", "有限长须同时提供上限与用户原句；无限长时两项都填null。")
    points = args["required_points"]
    if any(not point.strip() for point in points) or len(set(points)) != len(points):
        raise ToolError("invalid_answer_requirements", "回答要点须非空且不重复。")
    origin = None
    if quote is not None:
        if not quote.strip():
            raise ToolError("invalid_length_requirement", "篇幅要求的原句不能为空。")
        # Match only the current question and the user messages actually made
        # visible to Pi. Assistant history and retrieved documents cannot set it.
        texts = [("current_question", None, request["message"])]
        visible = [(index, item) for index, item in enumerate(request.get("history", []))
                   if item.get("role") in {"user", "assistant"}][-8:]
        texts.extend(("history", index, str(item.get("content", ""))[:2000])
                     for index, item in reversed(visible) if item.get("role") == "user")
        for kind, index, text in texts:
            start = text.find(quote)
            if start >= 0:
                origin = {"kind": kind, "history_index": index, "start": start, "end": start + len(quote)}
                break
        if origin is None:
            message = "篇幅原句必须逐字来自当前问题或已提供的用户历史，不能来自资料或助手回答。"
            hint = _whitespace_quote_hint(quote, texts)
            if hint is not None:
                message += ("本次未登记。发现仅空白字符不同的用户文本；请核对后逐字重新提交，勿原样重试。"
                            "空白差异候选：" + json.dumps(hint, ensure_ascii=False)
                            + "。候选仅说明文字接近，仍须由你确认它是否表达所声明的篇幅要求。")
            raise ToolError("unknown_requirement_quote", message)
    return {"version": 1, "max_characters": limit, "length_quote": quote, "length_origin": origin,
            "required_points": points,
            "interpretation": "Pi interpretation; literal user quote identity checked, meaning not independently verified."}


def apply_requirements(args: dict, requirements: dict) -> dict:
    registered, supplied = requirements["max_characters"], args.get("max_characters")
    if supplied is not None and supplied != registered:
        raise ToolError("answer_requirement_conflict", f"本轮已登记的正文上限为{registered}，不能在草稿或提交中改写；省略该参数仍执行已登记的上限。")
    # Never rewrite or truncate prose. A missing/null field inherits the run's
    # recorded requirement instead of silently disabling the length check.
    return {**args, "max_characters": registered}
