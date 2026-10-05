"""Validate inline references against this turn; preserve identity and UTF-16 positions."""
from __future__ import annotations

import json
from typing import Any

MAX_MENTIONS = 64


def _array(raw: Any, label: str) -> list:
    if raw is None or raw == "":
        return []
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        raise ValueError(f"{label}格式无效，请重新引用文件。") from None
    if not isinstance(value, list):
        raise ValueError(f"{label}必须是列表。")
    return value


def normalize_attachment_ids(raw: Any, count: int) -> list[str]:
    ids = _array(raw, "附件标识")
    if not ids:
        # Legacy clients do not create inline references.
        import uuid
        return [f"att_{uuid.uuid4().hex}" for _ in range(count)]
    if len(ids) != count or any(not isinstance(i, str) or not i or len(i) > 128 for i in ids) or len(set(ids)) != count:
        raise ValueError("附件标识与上传文件不一致，请重新添加附件。")
    return ids


def resolve_multipart_references(message: str, message_json: str | None, raw: Any,
                                 selected_files: list[dict], attachments: list[dict]):
    """Preserve exact text; repair legacy browser CRLF only if every binding validates."""
    if message_json is not None:
        try:
            message = json.loads(message_json)
        except (ValueError, TypeError):
            raise ValueError("消息原文格式无效，请重新发送。") from None
        if not isinstance(message, str):
            raise ValueError("消息原文必须是文本，请重新发送。")
        return message, *resolve_message_references(message, raw, selected_files, attachments)

    try:
        resolved = resolve_message_references(message, raw, selected_files, attachments)
    except ValueError as original_error:
        # Old browser clients submit LF offsets with a CRLF-encoded message.
        # Do not relocate references by searching for a matching filename.
        normalized = message.replace("\r\n", "\n").replace("\r", "\n")
        if normalized == message:
            raise
        try:
            resolved = resolve_message_references(normalized, raw, selected_files, attachments)
        except ValueError:
            raise original_error from None
        message = normalized
    return message, *resolved


def resolve_message_references(message: str, raw: Any, selected_files: list[dict], attachments: list[dict]):
    """Return canonical metadata, annotated query and a source map. Never infer by name alone."""
    refs = _array(raw, "行内引用")
    if len(refs) > MAX_MENTIONS:
        raise ValueError(f"每条消息最多引用 {MAX_MENTIONS} 处文件。")
    kb_files = {(f.get("kb_id"), f.get("file_id")): f for f in selected_files}
    local_files = {a["id"]: a for a in attachments}
    utf16 = message.encode("utf-16-le")
    canonical, bindings, annotated = [], {}, []
    cursor = 0
    for index, ref in enumerate(refs, start=1):
        if not isinstance(ref, dict):
            raise ValueError("行内引用格式无效。")
        start, end = ref.get("start"), ref.get("end")
        if type(start) is not int or type(end) is not int or not cursor <= start < end <= len(utf16) // 2:
            raise ValueError("引用位置已失效，请重新选择文件。")
        try:
            prefix = utf16[cursor * 2:start * 2].decode("utf-16-le")
            token = utf16[start * 2:end * 2].decode("utf-16-le")
        except UnicodeDecodeError:
            raise ValueError("引用位置不能切开文字或表情。") from None
        source = ref.get("source")
        if source == "knowledge":
            file = kb_files.get((ref.get("kbId"), ref.get("fileId")))
            if not file:
                raise ValueError("引用文件不在本轮知识库范围内，请重新选择。")
            key = (source, file["kb_id"], file["file_id"])
            identity = {"source": source, "kbId": file["kb_id"], "fileId": file["file_id"],
                        "kbName": file.get("kb_name", ""), "name": file.get("name") or ref.get("name"),
                        "type": file.get("type", "")}
            label = bindings[key]["label"] if key in bindings else f"知识库K{sum(k[0] == source for k in bindings) + 1}"
        elif source == "attachment":
            file = local_files.get(ref.get("attachmentId"))
            if not file:
                raise ValueError("引用的本机附件未上传或已移除，请重新添加。")
            key = (source, file["id"])
            identity = {"source": source, "attachmentId": file["id"], "name": file["name"], "type": file.get("type", "")}
            label = f"本机附件A{file['index']}"
        else:
            raise ValueError("未知的引用来源。")
        if not isinstance(identity["name"], str) or token != f"@{identity['name']}":
            raise ValueError(f"第 {index} 处引用「{identity['name']}」的文字位置与文件不一致，请删除该引用后重新选择。")
        bindings[key] = {"label": label, **identity}
        canonical.append({**identity, "start": start, "end": end})
        annotated.append(f"{prefix}{token}〈{label}〉")
        cursor = end
    annotated.append(utf16[cursor * 2:].decode("utf-16-le"))
    context = ""
    if bindings:
        context = (
            "【行内引用对应关系】\n以下是用户原句的文件绑定；按原句位置理解比较、顺序和指代。"
            "同名文件以来源及标识区分。K/A 标签是对象标识，不是回答中的文献引用编号。\n"
            + json.dumps(list(bindings.values()), ensure_ascii=False)
        )
    return canonical, "".join(annotated), context
