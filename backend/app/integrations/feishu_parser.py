"""
从飞书 IM 消息 content 中提取用户可读纯文本。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from app.core.logger import get_logger

logger = get_logger(__name__)

# 飞书 text 消息里常见的 at 占位
_AT_USER_PLACEHOLDER_RE = re.compile(r"@_user_\d+")


def _walk_post_content(node: Any, out: List[str]) -> None:
    """递归收集飞书 post 富文本中 tag=text 的文本节点。"""
    if node is None:
        return
    if isinstance(node, dict):
        if node.get("tag") == "text":
            raw = node.get("text")
            if isinstance(raw, str):
                t = raw.strip()
                if t:
                    out.append(t)
        for v in node.values():
            _walk_post_content(v, out)
        return
    if isinstance(node, list):
        for item in node:
            _walk_post_content(item, out)
        return


def extract_text(*, message_type: Optional[str], content: Optional[str]) -> Optional[str]:
    """
    从 message.message_type / message.content 解析用户文本。
    content 为 JSON 字符串（飞书约定）。
    """
    if not content or not str(content).strip():
        return None
    mt = (message_type or "").lower()
    raw = str(content).strip()
    try:
        data: Dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        logger.debug("飞书消息 content 非 JSON，原样截取")
        return raw[:20000] if raw else None

    if mt == "text":
        t = (data.get("text") or "").strip()
        if not t:
            return None
        t = _AT_USER_PLACEHOLDER_RE.sub("", t)
        return " ".join(t.split()).strip() or None

    if mt == "post":
        parts: List[str] = []
        _walk_post_content(data, parts)
        t = " ".join(parts).strip()
        t = _AT_USER_PLACEHOLDER_RE.sub("", t)
        return " ".join(t.split()).strip() or None

    # 其它类型首版不解析正文
    return None


def extract_message_resource_spec(
    message_type: Optional[str], content: Optional[str]
) -> Optional[Tuple[str, str, str]]:
    """
    可调用「下载消息中的资源」接口时返回 (resource_type, resource_key, default_suffix)。
    resource_type 对应 GET .../resources/:file_key 的 type 查询参数；key 填入路径中的 file_key。
    """
    if not content or not str(content).strip():
        return None
    mt = (message_type or "").lower()
    try:
        data: Dict[str, Any] = json.loads(str(content).strip())
    except json.JSONDecodeError:
        return None
    if mt == "image":
        key = data.get("image_key")
        if key and str(key).strip():
            return ("image", str(key).strip(), ".jpg")
    if mt == "audio":
        key = data.get("file_key")
        if key and str(key).strip():
            return ("file", str(key).strip(), ".mp3")
    return None
