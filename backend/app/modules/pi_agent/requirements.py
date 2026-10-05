"""Bind Pi's interpretation to user text; preserve it through later tool calls.

Literal quote identity is checked here. Whether the quoted words actually impose
the declared requirement remains Pi's semantic judgment, not a regex parser.
"""
from __future__ import annotations

from .policy import ToolError


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
            raise ToolError("unknown_requirement_quote", "篇幅原句必须逐字来自当前问题或已提供的用户历史，不能来自资料或助手回答。")
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
