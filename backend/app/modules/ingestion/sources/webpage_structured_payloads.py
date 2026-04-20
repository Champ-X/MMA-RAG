from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from html import unescape
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urlparse


_JSON_LD_SCRIPT_RE = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>\s*(.*?)\s*</script>",
    re.IGNORECASE | re.DOTALL,
)
_NEXT_DATA_SCRIPT_RE = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]+type=["\']application/json["\'][^>]*>\s*(.*?)\s*</script>',
    re.IGNORECASE | re.DOTALL,
)
_NUXT_DATA_SCRIPT_RE = re.compile(
    r'<script[^>]+(?:id=["\']__NUXT_DATA__["\']|data-nuxt-data=["\']true["\'])[^>]*type=["\']application/json["\'][^>]*>\s*(.*?)\s*</script>',
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_BLOCK_END_RE = re.compile(r"</(p|div|section|article|li|tr|table|h[1-6]|blockquote)>", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"[ \t\f\v]+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")
_INITIAL_STATE_MARKERS = ("window.__INITIAL_STATE__", "__INITIAL_STATE__")
_NUXT_STATE_MARKERS = ("window.__NUXT__", "__NUXT__")

_CONTENT_KEYS = ("content", "plain", "articleBody", "body", "markdown", "raw_content", "html")
_TITLE_KEYS = ("title", "headline", "name")
_SUMMARY_KEYS = ("summary", "description", "excerpt", "subTitle", "subtitle")
_PUBLISHED_KEYS = (
    "publishTime",
    "publishedAt",
    "publishAt",
    "datePublished",
    "createTime",
    "createdAt",
    "updateTime",
    "updatedAt",
)
_SITE_KEYS = ("site", "siteName", "sitename", "source", "sourceName")


@dataclass
class StructuredPayloadResult:
    markdown: str
    strategy: str
    score: int
    title: Optional[str] = None
    site: Optional[str] = None
    author: Optional[str] = None
    published: Optional[str] = None
    source_url: Optional[str] = None
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class _StructuredPayloadHandler:
    name: str
    matcher: Callable[[str], bool]
    extractor: Callable[[str, str, bool], Optional[StructuredPayloadResult]]


def _clean_text(value: Any, *, max_len: Optional[int] = None) -> str:
    text = unescape(str(value or ""))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WHITESPACE_RE.sub(" ", text)
    text = _BLANK_LINES_RE.sub("\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    text = _BLANK_LINES_RE.sub("\n\n", text)
    text = text.strip()
    if max_len is not None:
        return text[:max_len]
    return text


def _host_to_site_name(url: str) -> Optional[str]:
    host = (urlparse(url).hostname or "").strip().lower()
    if not host:
        return None
    return host.replace("www.", "")


def _extract_json_scripts(html_text: str, pattern: re.Pattern[str]) -> list[Any]:
    payloads: list[Any] = []
    for raw in pattern.findall(html_text):
        snippet = (raw or "").strip()
        if not snippet:
            continue
        try:
            payloads.append(json.loads(snippet))
        except Exception:
            continue
    return payloads


def _find_json_value_start(text: str, idx: int) -> Optional[int]:
    i = idx
    while i < len(text) and text[i] in " \t\r\n=":
        i += 1
    if i < len(text) and text[i] in "{[":
        return i
    return None


def _extract_balanced_json(text: str, start_idx: int) -> Optional[tuple[str, int]]:
    if start_idx >= len(text) or text[start_idx] not in "{[":
        return None
    stack = ["}" if text[start_idx] == "{" else "]"]
    quote: Optional[str] = None
    escape = False
    i = start_idx + 1
    while i < len(text):
        ch = text[i]
        if quote is not None:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            i += 1
            continue
        if ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if not stack or ch != stack[-1]:
                return None
            stack.pop()
            if not stack:
                return text[start_idx : i + 1], i + 1
        i += 1
    return None


def _extract_js_assigned_json_payloads(html_text: str, markers: tuple[str, ...]) -> list[Any]:
    payloads: list[Any] = []
    seen_ranges: set[tuple[int, int]] = set()
    for marker in markers:
        offset = 0
        while True:
            idx = html_text.find(marker, offset)
            if idx == -1:
                break
            value_start = _find_json_value_start(html_text, idx + len(marker))
            if value_start is None:
                offset = idx + len(marker)
                continue
            extracted = _extract_balanced_json(html_text, value_start)
            if extracted is None:
                offset = idx + len(marker)
                continue
            raw, end_idx = extracted
            key = (value_start, end_idx)
            if key in seen_ranges:
                offset = end_idx
                continue
            seen_ranges.add(key)
            try:
                payloads.append(json.loads(raw))
            except Exception:
                pass
            offset = end_idx
    return payloads


def _walk_mappings(node: Any, *, ancestors: tuple[dict[str, Any], ...] = ()) -> Iterable[tuple[dict[str, Any], tuple[dict[str, Any], ...]]]:
    if isinstance(node, dict):
        yield node, ancestors
        next_ancestors = ancestors + (node,)
        for value in node.values():
            yield from _walk_mappings(value, ancestors=next_ancestors)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_mappings(item, ancestors=ancestors)


def _lookup_scalar(mappings: Iterable[dict[str, Any]], keys: tuple[str, ...]) -> Optional[str]:
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        for key in keys:
            value = mapping.get(key)
            if isinstance(value, str):
                cleaned = _clean_text(value)
                if cleaned:
                    return cleaned
    return None


def _format_published_value(value: Any) -> Optional[str]:
    if isinstance(value, str):
        cleaned = _clean_text(value)
        return cleaned or None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts <= 0:
            return None
        if ts > 1_000_000_000_000:
            ts /= 1000.0
        try:
            return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
        except (OverflowError, OSError, ValueError):
            return str(int(value))
    return None


def _lookup_published(mappings: Iterable[dict[str, Any]]) -> Optional[str]:
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        for key in _PUBLISHED_KEYS:
            formatted = _format_published_value(mapping.get(key))
            if formatted:
                return formatted
    return None


def _extract_author(mapping: Any) -> Optional[str]:
    if isinstance(mapping, str):
        return _clean_text(mapping, max_len=200) or None
    if isinstance(mapping, list):
        names = [_extract_author(item) for item in mapping]
        names = [name for name in names if name]
        if names:
            return ", ".join(dict.fromkeys(names))
        return None
    if not isinstance(mapping, dict):
        return None
    for key in ("name", "nickname", "nickName", "authorName", "userName"):
        value = mapping.get(key)
        if isinstance(value, str):
            cleaned = _clean_text(value, max_len=200)
            if cleaned:
                return cleaned
    if "author" in mapping:
        return _extract_author(mapping.get("author"))
    return None


def _lookup_author(mappings: Iterable[dict[str, Any]]) -> Optional[str]:
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        for key in ("author", "authorInfo", "userInfo", "publisher"):
            value = mapping.get(key)
            author = _extract_author(value)
            if author:
                return author
    return None


def _extract_site(mapping: Any) -> Optional[str]:
    if isinstance(mapping, str):
        cleaned = _clean_text(mapping, max_len=200)
        return cleaned or None
    if isinstance(mapping, dict):
        for key in ("name", "siteName", "sitename", "sourceName"):
            value = mapping.get(key)
            if isinstance(value, str):
                cleaned = _clean_text(value, max_len=200)
                if cleaned:
                    return cleaned
        for key in ("publisher", "sourceDetail", "organization"):
            nested = _extract_site(mapping.get(key))
            if nested:
                return nested
    return None


def _lookup_site(mappings: Iterable[dict[str, Any]], *, fallback_url: str) -> Optional[str]:
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        direct = _lookup_scalar((mapping,), _SITE_KEYS)
        if direct:
            return direct
        nested = _extract_site(mapping.get("publisher"))
        if nested:
            return nested
    return _host_to_site_name(fallback_url)


def _strip_html_to_markdown(html_text: str) -> str:
    text = _HTML_BREAK_RE.sub("\n", html_text)
    text = _HTML_BLOCK_END_RE.sub("\n\n", text)
    text = _HTML_TAG_RE.sub("", text)
    return _clean_text(text)


def _apply_marks(text: str, marks: Any) -> str:
    if not text:
        return ""
    output = text
    link_href: Optional[str] = None
    for mark in marks or []:
        if not isinstance(mark, dict):
            continue
        mark_type = (mark.get("type") or "").strip()
        attrs = mark.get("attrs") or {}
        if mark_type == "code":
            output = f"`{output}`"
        elif mark_type == "bold":
            output = f"**{output}**"
        elif mark_type == "italic":
            output = f"*{output}*"
        elif mark_type == "strike":
            output = f"~~{output}~~"
        elif mark_type == "underline":
            output = f"<u>{output}</u>"
        elif mark_type == "link":
            href = _clean_text(attrs.get("href") or "")
            if href:
                link_href = href
    if link_href:
        output = f"[{output}]({link_href})"
    return output


def _render_inline(node: Any, *, include_images: bool) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type")
    if node_type == "text":
        return _apply_marks(str(node.get("text") or ""), node.get("marks"))
    if node_type == "hardBreak":
        return "  \n"
    if node_type == "image":
        if not include_images:
            return ""
        attrs = node.get("attrs") or {}
        src = _clean_text(attrs.get("src") or "")
        if not src:
            return ""
        alt = _clean_text(attrs.get("alt") or "")
        return f"![{alt}]({src})"
    return "".join(_render_inline(child, include_images=include_images) for child in (node.get("content") or []))


def _render_inlines(nodes: Any, *, include_images: bool) -> str:
    if not isinstance(nodes, list):
        return ""
    return "".join(_render_inline(node, include_images=include_images) for node in nodes)


def _collect_plain_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type")
    if node_type == "text":
        return str(node.get("text") or "")
    if node_type == "hardBreak":
        return "\n"
    return "".join(_collect_plain_text(child) for child in (node.get("content") or []))


def _render_table(node: dict[str, Any], *, include_images: bool) -> str:
    rows: list[list[str]] = []
    header_row_idx: Optional[int] = None
    for row in node.get("content") or []:
        if not isinstance(row, dict) or row.get("type") != "tableRow":
            continue
        rendered_row: list[str] = []
        has_header = False
        for cell in row.get("content") or []:
            if not isinstance(cell, dict):
                continue
            if cell.get("type") == "tableHeader":
                has_header = True
            text = _render_inlines(cell.get("content") or [], include_images=include_images).strip()
            text = text.replace("|", r"\|").replace("\n", "<br>")
            rendered_row.append(text)
        if rendered_row:
            if has_header and header_row_idx is None:
                header_row_idx = len(rows)
            rows.append(rendered_row)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    if header_row_idx is None:
        header = normalized[0]
        body = normalized[1:]
    else:
        header = normalized[header_row_idx]
        body = normalized[:header_row_idx] + normalized[header_row_idx + 1 :]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines).strip() + "\n\n"


def _render_prosemirror_blocks(nodes: Any, *, include_images: bool, depth: int = 0) -> str:
    if not isinstance(nodes, list):
        return ""
    parts: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_type = node.get("type")
        attrs = node.get("attrs") or {}
        if node_type == "heading":
            level = min(6, max(1, int(attrs.get("level") or 1)))
            text = _render_inlines(node.get("content") or [], include_images=include_images).strip()
            if text:
                parts.append(f"{'#' * level} {text}\n\n")
            continue
        if node_type == "paragraph":
            text = _render_inlines(node.get("content") or [], include_images=include_images).strip()
            if text:
                parts.append(f"{text}\n\n")
            continue
        if node_type == "codeBlock":
            language = _clean_text(attrs.get("language") or "")
            code = "".join(_collect_plain_text(child) for child in (node.get("content") or [])).rstrip()
            parts.append(f"```{language}\n{code}\n```\n\n" if code else f"```{language}\n```\n\n")
            continue
        if node_type == "image":
            if include_images:
                src = _clean_text((attrs.get("src") or ""))
                if src:
                    alt = _clean_text(attrs.get("alt") or "")
                    parts.append(f"![{alt}]({src})\n\n")
            continue
        if node_type == "table":
            table_md = _render_table(node, include_images=include_images)
            if table_md:
                parts.append(table_md)
            continue
        if node_type in ("bulletList", "orderedList"):
            items: list[str] = []
            for idx, item in enumerate(node.get("content") or [], start=1):
                body = _render_prosemirror_blocks(item.get("content") or [], include_images=include_images, depth=depth + 1).strip()
                if not body:
                    continue
                prefix = f"{idx}." if node_type == "orderedList" else "-"
                indented = body.replace("\n", "\n" + "  " * (depth + 1))
                items.append(f"{'  ' * depth}{prefix} {indented}")
            if items:
                parts.append("\n".join(items) + "\n\n")
            continue
        if node_type == "blockquote":
            text = _render_prosemirror_blocks(node.get("content") or [], include_images=include_images, depth=depth).strip()
            if text:
                quoted = "\n".join(f"> {line}" if line else ">" for line in text.splitlines())
                parts.append(quoted + "\n\n")
            continue
        nested = _render_prosemirror_blocks(node.get("content") or [], include_images=include_images, depth=depth)
        if nested:
            parts.append(nested)
    return "".join(parts)


def _render_prosemirror_doc(doc: Any, *, include_images: bool) -> Optional[str]:
    if not isinstance(doc, dict):
        return None
    if doc.get("type") != "doc" or not isinstance(doc.get("content"), list):
        return None
    markdown = _render_prosemirror_blocks(doc.get("content") or [], include_images=include_images).strip()
    return markdown or None


def _render_payload_value(value: Any, *, include_images: bool) -> tuple[str, int]:
    if isinstance(value, dict):
        if value.get("type") == "doc":
            rendered = _render_prosemirror_doc(value, include_images=include_images)
            if rendered:
                return rendered, 220
        return "", 0
    if not isinstance(value, str):
        return "", 0
    raw = value.strip()
    if not raw:
        return "", 0
    if raw.startswith("{") or raw.startswith("["):
        try:
            loaded = json.loads(raw)
        except Exception:
            loaded = None
        if loaded is not None:
            rendered, score = _render_payload_value(loaded, include_images=include_images)
            if rendered:
                return rendered, score
    if "<" in raw and ">" in raw:
        text = _strip_html_to_markdown(raw)
        if text:
            return text, 80
    cleaned = _clean_text(raw)
    if cleaned:
        return cleaned, 120
    return "", 0


def _score_markdown(markdown: str, *, title: Optional[str], base_score: int) -> int:
    score = base_score + min(len(markdown) // 160, 140)
    if title:
        score += 30
    if markdown.startswith("# "):
        score += 20
    if markdown.count("\n## ") >= 1:
        score += 15
    return score


def _extract_candidates_from_payload(
    payload: Any,
    *,
    include_images: bool,
    url: str,
    strategy: str,
    min_chars: int = 180,
    base_score: int = 180,
) -> list[StructuredPayloadResult]:
    candidates: list[StructuredPayloadResult] = []
    for mapping, ancestors in _walk_mappings(payload):
        candidate = _build_candidate_from_mapping(
            mapping,
            ancestors,
            include_images=include_images,
            url=url,
            strategy=strategy,
            min_chars=min_chars,
            base_score=base_score,
        )
        if candidate:
            candidates.append(candidate)
    return candidates


def _build_candidate_from_mapping(
    mapping: dict[str, Any],
    ancestors: tuple[dict[str, Any], ...],
    *,
    include_images: bool,
    url: str,
    strategy: str,
    min_chars: int = 180,
    base_score: int = 100,
) -> Optional[StructuredPayloadResult]:
    if not any(key in mapping for key in _CONTENT_KEYS + _TITLE_KEYS + _SUMMARY_KEYS):
        return None
    scopes = (mapping,) + tuple(reversed(ancestors))

    markdown = ""
    render_score = 0
    for key in _CONTENT_KEYS:
        if key not in mapping:
            continue
        candidate_text, candidate_score = _render_payload_value(mapping.get(key), include_images=include_images)
        if candidate_text and (candidate_score > render_score or len(candidate_text) > len(markdown)):
            markdown = candidate_text
            render_score = candidate_score

    if not markdown or len(markdown) < min_chars:
        return None

    title = _lookup_scalar(scopes, _TITLE_KEYS)
    summary = _lookup_scalar(scopes, _SUMMARY_KEYS)
    published = _lookup_published(scopes)
    author = _lookup_author(scopes)
    site = _lookup_site(scopes, fallback_url=url)

    if summary and summary not in markdown and len(summary) <= max(400, len(markdown) // 2):
        markdown = summary + "\n\n" + markdown

    return StructuredPayloadResult(
        markdown=markdown.strip(),
        title=title,
        site=site,
        author=author,
        published=published,
        source_url=url,
        strategy=strategy,
        score=_score_markdown(markdown, title=title, base_score=base_score + render_score),
        extras={"structured_strategy": strategy},
    )


def _is_tencent_developer_article(url: str) -> bool:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().split(":")[0]
    return host in ("cloud.tencent.com", "www.cloud.tencent.com") and parsed.path.startswith("/developer/article/")


def _extract_json_ld_article(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    _ = include_images
    candidates: list[StructuredPayloadResult] = []
    for payload in _extract_json_scripts(html_text, _JSON_LD_SCRIPT_RE):
        for mapping, ancestors in _walk_mappings(payload):
            raw_type = mapping.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            types = {str(t).lower() for t in types if isinstance(t, str)}
            if not types.intersection({"article", "newsarticle", "blogposting", "report", "techarticle"}) and "articleBody" not in mapping:
                continue
            candidate = _build_candidate_from_mapping(
                mapping,
                ancestors,
                include_images=False,
                url=url,
                strategy="json_ld_article",
                min_chars=120,
                base_score=150,
            )
            if candidate:
                candidates.append(candidate)
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


def _extract_tencent_next_data(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    if not _is_tencent_developer_article(url):
        return None
    payloads = _extract_json_scripts(html_text, _NEXT_DATA_SCRIPT_RE)
    if not payloads:
        return None
    payload = payloads[0]
    candidates: list[StructuredPayloadResult] = []
    for mapping, ancestors in _walk_mappings(payload):
        article_info = mapping.get("articleInfo")
        if not isinstance(article_info, dict):
            continue
        candidate = _build_candidate_from_mapping(
            article_info,
            ancestors + (mapping,),
            include_images=include_images,
            url=url,
            strategy="tencent_next_data",
            min_chars=180,
            base_score=260,
        )
        if candidate:
            if not candidate.site:
                candidate.site = "腾讯云开发者社区"
            elif "tencent" in candidate.site.lower() or candidate.site == "cloud.tencent.com":
                candidate.site = "腾讯云开发者社区"
            candidates.append(candidate)
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


def _extract_next_data_generic(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    payloads = _extract_json_scripts(html_text, _NEXT_DATA_SCRIPT_RE)
    if not payloads:
        return None
    candidates: list[StructuredPayloadResult] = []
    for payload in payloads:
        candidates.extend(
            _extract_candidates_from_payload(
                payload,
                include_images=include_images,
                url=url,
                strategy="next_data_generic",
                min_chars=180,
                base_score=180,
            )
        )
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


def _extract_initial_state(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    payloads = _extract_js_assigned_json_payloads(html_text, _INITIAL_STATE_MARKERS)
    if not payloads:
        return None
    candidates: list[StructuredPayloadResult] = []
    for payload in payloads:
        candidates.extend(
            _extract_candidates_from_payload(
                payload,
                include_images=include_images,
                url=url,
                strategy="initial_state",
                min_chars=160,
                base_score=190,
            )
        )
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


def _extract_nuxt_data_script(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    payloads = _extract_json_scripts(html_text, _NUXT_DATA_SCRIPT_RE)
    if not payloads:
        return None
    candidates: list[StructuredPayloadResult] = []
    for payload in payloads:
        candidates.extend(
            _extract_candidates_from_payload(
                payload,
                include_images=include_images,
                url=url,
                strategy="nuxt_data",
                min_chars=160,
                base_score=195,
            )
        )
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


def _extract_nuxt_state(html_text: str, url: str, include_images: bool) -> Optional[StructuredPayloadResult]:
    payloads = _extract_js_assigned_json_payloads(html_text, _NUXT_STATE_MARKERS)
    if not payloads:
        return None
    candidates: list[StructuredPayloadResult] = []
    for payload in payloads:
        candidates.extend(
            _extract_candidates_from_payload(
                payload,
                include_images=include_images,
                url=url,
                strategy="nuxt_state",
                min_chars=160,
                base_score=200,
            )
        )
    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))


_HANDLERS: tuple[_StructuredPayloadHandler, ...] = (
    _StructuredPayloadHandler(
        name="json_ld_article",
        matcher=lambda _url: True,
        extractor=_extract_json_ld_article,
    ),
    _StructuredPayloadHandler(
        name="tencent_next_data",
        matcher=_is_tencent_developer_article,
        extractor=_extract_tencent_next_data,
    ),
    _StructuredPayloadHandler(
        name="next_data_generic",
        matcher=lambda _url: True,
        extractor=_extract_next_data_generic,
    ),
    _StructuredPayloadHandler(
        name="initial_state",
        matcher=lambda _url: True,
        extractor=_extract_initial_state,
    ),
    _StructuredPayloadHandler(
        name="nuxt_data",
        matcher=lambda _url: True,
        extractor=_extract_nuxt_data_script,
    ),
    _StructuredPayloadHandler(
        name="nuxt_state",
        matcher=lambda _url: True,
        extractor=_extract_nuxt_state,
    ),
)


def extract_structured_payload(
    html_bytes: bytes,
    url: str,
    *,
    include_images: bool,
) -> Optional[StructuredPayloadResult]:
    """统一的结构化载荷抽取入口，优先利用 JSON-LD / SSR payload 还原正文。"""
    if not html_bytes:
        return None
    try:
        html_text = html_bytes.decode("utf-8", errors="ignore")
    except Exception:
        return None

    candidates: list[StructuredPayloadResult] = []
    for handler in _HANDLERS:
        if not handler.matcher(url):
            continue
        result = handler.extractor(html_text, url, include_images)
        if result and result.markdown.strip():
            candidates.append(result)

    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.score, len(item.markdown)))
