from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_AT_PLACEHOLDER = re.compile(r"@_user_\d+")


def _walk_text(node: Any, output: list[str]) -> None:
    if isinstance(node, dict):
        if node.get("tag") == "text" and isinstance(node.get("text"), str):
            value = node["text"].strip()
            if value:
                output.append(value)
        for value in node.values():
            _walk_text(value, output)
    elif isinstance(node, list):
        for value in node:
            _walk_text(value, output)


def extract_text(message_type: str | None, content: str | None) -> str | None:
    if not content or not content.strip():
        return None
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return content.strip()[:20_000] or None
    kind = (message_type or "").lower()
    if kind == "text":
        value = str(payload.get("text") or "")
    elif kind == "post":
        parts: list[str] = []
        _walk_text(payload, parts)
        value = " ".join(parts)
    else:
        return None
    value = _AT_PLACEHOLDER.sub("", value)
    return " ".join(value.split()).strip() or None


def extract_resource_spec(
    message_type: str | None, content: str | None
) -> tuple[str, str, str, str | None] | None:
    if not content:
        return None
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return None
    kind = (message_type or "").lower()
    if kind == "image" and payload.get("image_key"):
        return "image", str(payload["image_key"]), ".jpg", None
    if kind == "audio" and payload.get("file_key"):
        return "file", str(payload["file_key"]), ".mp3", None
    if kind == "media" and payload.get("file_key"):
        return "file", str(payload["file_key"]), ".mp4", None
    if kind == "file" and payload.get("file_key"):
        filename = str(
            payload.get("file_name") or payload.get("filename") or payload.get("name") or ""
        ).strip()
        return "file", str(payload["file_key"]), Path(filename).suffix.lower(), filename or None
    return None
