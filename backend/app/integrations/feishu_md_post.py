"""
将模型输出的 Markdown 规范为飞书富文本 post 中 tag=md 可识别的语法，并做分段。

飞书「文本 text」类型仅支持少量内联标签；列表/引用/代码块/标题等需走 post + md 节点。
参见开放平台「发送消息内容结构」中 post / md 标签说明。
"""

from __future__ import annotations

import re
from typing import List

# post.md 单段不宜过大，预留 JSON 与转义开销
DEFAULT_FEISHU_MD_CHUNK = 5200

_HR_LINE = re.compile(r"^\s*(?:---|\*\*\*|___)\s*$")
_ATX_HEADING = re.compile(r"^(\s*)(#{1,6})\s+(.+?)\s*$")
_IMG = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
# 标准围栏：起始行 ``` 或 ```python，闭合行为单独一行的 ```
_FENCE_BLOCK = re.compile(r"^```[^\n]*\n[\s\S]*?^```", re.MULTILINE)


def _replace_images_in_segment(segment: str) -> str:
    """![alt](url) → 外链用 [alt](url)；本地/相对路径改为纯文案，避免非法链接导致整段降级为原文。"""

    def repl(m: re.Match[str]) -> str:
        alt, url = m.group(1) or "", (m.group(2) or "").strip()
        if url.startswith(("http://", "https://")):
            return f"[{alt}]({url})"
        return f"（图：{alt or '配图'}）"

    return _IMG.sub(repl, segment)


def _replace_images_outside_fences(s: str) -> str:
    out: List[str] = []
    pos = 0
    for m in _FENCE_BLOCK.finditer(s):
        out.append(_replace_images_in_segment(s[pos : m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_replace_images_in_segment(s[pos:]))
    return "".join(out)


def feishu_normalize_markdown_for_post(s: str) -> str:
    """
    在代码块外：
    - ATX 标题 #..###### → **标题**（md 节点不保证 # 标题渲染）
    - 独立一行的 --- / *** / ___ → 飞书要求的分割线形态（前后换行 + ` --- `）
    - 图片语法：http(s) 链转 [text](url)，否则改为（图：alt）
    """
    s = (s or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = s.split("\n")
    out: List[str] = []
    in_fence = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        if _HR_LINE.match(line) and len(stripped) >= 3:
            out.extend(["", " --- ", ""])
            continue
        hm = _ATX_HEADING.match(line)
        if hm:
            indent, title = hm.group(1), hm.group(3).strip()
            out.append(f"{indent}**{title}**")
            continue
        out.append(line)

    return _replace_images_outside_fences("\n".join(out))


def split_feishu_md_chunks(text: str, max_len: int = DEFAULT_FEISHU_MD_CHUNK) -> List[str]:
    """按段落累积分段，单段超长再硬切，减少截断代码块/列表的概率。"""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]

    paras = text.split("\n\n")
    chunks: List[str] = []
    buf = ""

    for p in paras:
        sep = "\n\n" if buf else ""
        cand = f"{buf}{sep}{p}" if buf else p
        if len(cand) <= max_len:
            buf = cand
            continue
        if buf:
            chunks.append(buf)
            buf = ""
        if len(p) > max_len:
            for i in range(0, len(p), max_len):
                chunks.append(p[i : i + max_len])
        else:
            buf = p

    if buf:
        chunks.append(buf)
    return chunks
