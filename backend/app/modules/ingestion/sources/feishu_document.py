"""Feishu document source with structured Block, media, Sheet, Base and Board parsing."""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

import httpx

from app.core.config import settings
from app.core.logger import get_logger

from .base import BaseContentSource, ContentSourceResult

logger = get_logger(__name__)

FEISHU_API_BASE = "https://open.feishu.cn/open-apis"
FEISHU_DOCUMENT_HOST_SUFFIXES = (
    ".feishu.cn",
    ".larksuite.com",
    ".larkoffice.com",
    ".doubao.com",
)
FEISHU_ASSET_DIR = "feishu_assets"
SUPPORTED_PATH_TYPES = frozenset({"docx", "wiki"})

BLOCK_FIELD_NAMES = {
    1: "page",
    2: "text",
    3: "heading1",
    4: "heading2",
    5: "heading3",
    6: "heading4",
    7: "heading5",
    8: "heading6",
    9: "heading7",
    10: "heading8",
    11: "heading9",
    12: "bullet",
    13: "ordered",
    14: "code",
    15: "quote",
    17: "todo",
    18: "bitable",
    19: "callout",
    20: "chat_card",
    21: "diagram",
    22: "divider",
    23: "file",
    24: "grid",
    25: "grid_column",
    26: "iframe",
    27: "image",
    28: "isv",
    29: "mindnote",
    30: "sheet",
    31: "table",
    32: "table_cell",
    33: "view",
    34: "quote_container",
    35: "task",
    36: "okr",
    37: "okr_objective",
    38: "okr_key_result",
    39: "okr_progress",
    40: "add_ons",
    41: "jira_issue",
    42: "wiki_catalog",
    43: "board",
}

CODE_LANGUAGES = {
    7: "bash",
    8: "c",
    9: "csharp",
    10: "cpp",
    14: "css",
    19: "dockerfile",
    25: "go",
    29: "html",
    31: "java",
    32: "javascript",
    33: "json",
    35: "kotlin",
    40: "markdown",
    46: "php",
    50: "python",
    52: "ruby",
    53: "rust",
    58: "sql",
    59: "swift",
    62: "typescript",
    68: "xml",
    69: "yaml",
}

_TOKEN_CACHE: Dict[str, Any] = {"key": None, "token": None, "expires_at": 0.0}
_TOKEN_LOCK = asyncio.Lock()


class FeishuDocumentError(ValueError):
    """A user-actionable Feishu source error."""


@dataclass(frozen=True)
class FeishuUrl:
    url: str
    token: str
    path_type: str


@dataclass(frozen=True)
class ResolvedFeishuResource:
    token: str
    resource_type: str
    title: Optional[str] = None


@dataclass(frozen=True)
class FeishuDocumentInspection:
    original_url: str
    resource_type: str
    token: str
    title: str
    suggested_filename: str


def _is_feishu_host(host: str) -> bool:
    normalized = (host or "").lower().split(":", 1)[0]
    return normalized in {"feishu.cn", "larksuite.com", "larkoffice.com", "doubao.com"} or any(
        normalized.endswith(suffix) for suffix in FEISHU_DOCUMENT_HOST_SUFFIXES
    )


def parse_feishu_document_url(url: str) -> Optional[FeishuUrl]:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"} or not _is_feishu_host(parsed.hostname or ""):
        return None
    match = re.search(r"/(docx|wiki)/([A-Za-z0-9_-]+)", parsed.path or "")
    if not match or match.group(1) not in SUPPORTED_PATH_TYPES:
        return None
    return FeishuUrl(url=url, path_type=match.group(1), token=match.group(2))


def is_feishu_document_url(url: str) -> bool:
    return parse_feishu_document_url(url) is not None


def _safe_filename(title: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "_", (title or "").strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    return f"{(cleaned or '飞书文档')[:120]}.md"


def _content_type_extension(content_type: str, fallback: str = ".bin") -> str:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    explicit = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    return explicit.get(media_type) or mimetypes.guess_extension(media_type) or fallback


def _column_name(index: int) -> str:
    result = ""
    value = max(1, index)
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _markdown_table(rows: Sequence[Sequence[Any]], *, empty_label: str = "无数据") -> str:
    normalized = [[_cell_to_text(cell) for cell in row] for row in rows]
    if not normalized:
        return f"_（{empty_label}）_"
    width = max((len(row) for row in normalized), default=0)
    if width <= 0:
        return f"_（{empty_label}）_"

    padded = [row + [""] * (width - len(row)) for row in normalized]

    def escape(value: str) -> str:
        return value.replace("|", "\\|").replace("\n", "<br>")

    header = padded[0]
    lines = [
        "| " + " | ".join(escape(value) for value in header) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    lines.extend(
        "| " + " | ".join(escape(value) for value in row) + " |"
        for row in padded[1:]
    )
    return "\n".join(lines)


def _cell_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(part for part in (_cell_to_text(item) for item in value) if part)
    if isinstance(value, dict):
        for key in ("text", "name", "title", "content", "link", "url"):
            if key in value and value[key] not in (None, ""):
                return _cell_to_text(value[key])
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


class FeishuDocumentSource(BaseContentSource):
    """Read a Feishu Docx or Wiki link and emit Markdown plus local image assets."""

    def __init__(
        self,
        *,
        app_id: Optional[str] = None,
        app_secret: Optional[str] = None,
        access_token: Optional[str] = None,
        timeout: float = 30.0,
        max_blocks: Optional[int] = None,
        max_assets: Optional[int] = None,
        max_sheet_rows: Optional[int] = None,
        max_bitable_records: Optional[int] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.app_id = app_id if app_id is not None else settings.feishu_app_id
        self.app_secret = app_secret if app_secret is not None else settings.feishu_app_secret
        self.access_token = (
            access_token
            if access_token is not None
            else getattr(settings, "feishu_doc_access_token", None)
        )
        self.timeout = timeout
        self.max_blocks = max_blocks or getattr(settings, "feishu_doc_max_blocks", 5000)
        self.max_assets = max_assets or getattr(settings, "feishu_doc_max_assets", 100)
        self.max_sheet_rows = max_sheet_rows or getattr(settings, "feishu_doc_max_sheet_rows", 200)
        self.max_bitable_records = max_bitable_records or getattr(
            settings, "feishu_doc_max_bitable_records", 200
        )
        self._active_max_assets = self.max_assets
        self.transport = transport
        self._asset_map: Dict[str, bytes] = {}
        self._warnings: List[str] = []
        self._stats: Dict[str, int] = {}
        self._asset_count = 0

    async def inspect_async(self, url: str) -> FeishuDocumentInspection:
        parsed = self._require_url(url)
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            token = await self._get_access_token(client)
            resolved = await self._resolve_resource(client, token, parsed)
            title = resolved.title or await self._resource_title(client, token, resolved)
        return FeishuDocumentInspection(
            original_url=url,
            resource_type=resolved.resource_type,
            token=resolved.token,
            title=title or "飞书文档",
            suggested_filename=_safe_filename(title or "飞书文档"),
        )

    async def fetch_async(
        self,
        url: str,
        *,
        include_links: bool = True,
        include_images: bool = True,
        download_images: bool = True,
        image_max_count: int = 30,
        image_max_bytes: int = 10 * 1024 * 1024,
    ) -> ContentSourceResult:
        parsed = self._require_url(url)
        self._asset_map = {}
        self._warnings = []
        self._stats = {}
        self._asset_count = 0
        self._active_max_assets = min(self.max_assets, max(1, image_max_count))

        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            access_token = await self._get_access_token(client)
            resource = await self._resolve_resource(client, access_token, parsed)
            title = resource.title or await self._resource_title(client, access_token, resource)

            if resource.resource_type == "docx":
                markdown, details = await self._fetch_docx(
                    client,
                    access_token,
                    resource.token,
                    title=title,
                    source_url=url,
                    include_links=include_links,
                    include_images=include_images,
                    download_images=download_images,
                    image_max_bytes=image_max_bytes,
                )
            elif resource.resource_type == "sheet":
                embedded = await self._fetch_spreadsheet_markdown(
                    client,
                    access_token,
                    resource.token,
                )
                markdown = f"# {title or '飞书电子表格'}\n\n来源：{url}\n\n{embedded}"
                details = {"block_count": 0, "block_type_counts": {}, "sheet_count": 1}
            elif resource.resource_type == "bitable":
                embedded = await self._fetch_bitable_markdown(
                    client,
                    access_token,
                    resource.token,
                )
                markdown = f"# {title or '飞书多维表格'}\n\n来源：{url}\n\n{embedded}"
                details = {"block_count": 0, "block_type_counts": {}, "bitable_count": 1}
            else:
                raise FeishuDocumentError(
                    f"该飞书链接指向 {resource.resource_type}，当前仅支持文档、电子表格和多维表格。"
                )

        meta: Dict[str, Any] = {
            "extractor": "feishu_openapi",
            "title": title or "飞书文档",
            "site": "飞书云文档",
            "source_url": url,
            "kind": "feishu_document",
            "resource_type": resource.resource_type,
            "image_count": len(self._asset_map),
            "warnings": list(self._warnings),
            **details,
        }
        if self._asset_map:
            meta["asset_map"] = self._asset_map
        return ContentSourceResult(
            content=markdown.encode("utf-8"),
            suggested_filename=_safe_filename(title or "飞书文档"),
            content_type="text/markdown",
            meta=meta,
        )

    def _require_url(self, url: str) -> FeishuUrl:
        parsed = parse_feishu_document_url(url)
        if parsed is None:
            raise FeishuDocumentError("不是受支持的飞书文档链接，仅支持 /docx/ 或 /wiki/ 链接。")
        return parsed

    async def _get_access_token(self, client: httpx.AsyncClient) -> str:
        configured = (self.access_token or "").strip()
        if configured:
            return configured
        app_id = (self.app_id or "").strip()
        app_secret = (self.app_secret or "").strip()
        if not app_id or not app_secret:
            raise FeishuDocumentError(
                "未配置飞书文档访问凭证。请设置 FEISHU_APP_ID 与 FEISHU_APP_SECRET，"
                "并将目标文档授权给该应用。"
            )

        cache_key = hashlib.sha256(f"{app_id}:{app_secret}".encode("utf-8")).hexdigest()
        now = time.monotonic()
        if _TOKEN_CACHE.get("key") == cache_key and now < float(_TOKEN_CACHE.get("expires_at") or 0):
            return str(_TOKEN_CACHE["token"])

        async with _TOKEN_LOCK:
            now = time.monotonic()
            if _TOKEN_CACHE.get("key") == cache_key and now < float(
                _TOKEN_CACHE.get("expires_at") or 0
            ):
                return str(_TOKEN_CACHE["token"])
            response = await client.post(
                f"{FEISHU_API_BASE}/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
            )
            payload = self._decode_api_response(response, "获取 tenant_access_token")
            token = str(payload.get("tenant_access_token") or "")
            if not token:
                raise FeishuDocumentError("飞书鉴权成功但未返回 tenant_access_token。")
            expires_in = int(payload.get("expire") or 7200)
            _TOKEN_CACHE.update(
                {
                    "key": cache_key,
                    "token": token,
                    "expires_at": time.monotonic() + max(60, expires_in - 300),
                }
            )
            return token

    async def _resolve_resource(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        parsed: FeishuUrl,
    ) -> ResolvedFeishuResource:
        if parsed.path_type == "docx":
            return ResolvedFeishuResource(token=parsed.token, resource_type="docx")

        data = await self._get_json(
            client,
            access_token,
            "/wiki/v2/spaces/get_node",
            params={"token": parsed.token},
            action="解析 Wiki 节点",
        )
        node = data.get("node") if isinstance(data.get("node"), dict) else {}
        obj_token = str(node.get("obj_token") or "").strip()
        obj_type = str(node.get("obj_type") or "").strip().lower()
        if not obj_token or not obj_type:
            raise FeishuDocumentError("Wiki 节点未返回 obj_token 或 obj_type。")
        return ResolvedFeishuResource(
            token=obj_token,
            resource_type=obj_type,
            title=str(node.get("title") or "").strip() or None,
        )

    async def _resource_title(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        resource: ResolvedFeishuResource,
    ) -> str:
        if resource.resource_type != "docx":
            return resource.title or {
                "sheet": "飞书电子表格",
                "bitable": "飞书多维表格",
            }.get(resource.resource_type, "飞书云文档")
        data = await self._get_json(
            client,
            access_token,
            f"/docx/v1/documents/{resource.token}",
            action="获取飞书文档信息",
        )
        document = data.get("document") if isinstance(data.get("document"), dict) else {}
        return str(document.get("title") or "").strip() or "飞书文档"

    async def _fetch_docx(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        document_id: str,
        *,
        title: str,
        source_url: str,
        include_links: bool,
        include_images: bool,
        download_images: bool,
        image_max_bytes: int,
    ) -> Tuple[str, Dict[str, Any]]:
        blocks = await self._fetch_all_blocks(client, access_token, document_id)
        by_id = {
            str(block.get("block_id")): block
            for block in blocks
            if isinstance(block, dict) and block.get("block_id")
        }
        block_type_counts: Dict[str, int] = {}
        for block in blocks:
            block_type = int(block.get("block_type") or 0)
            label = BLOCK_FIELD_NAMES.get(block_type, f"unknown_{block_type}")
            block_type_counts[label] = block_type_counts.get(label, 0) + 1

        root = by_id.get(document_id) or next(
            (block for block in blocks if int(block.get("block_type") or 0) == 1),
            None,
        )
        root_children = list((root or {}).get("children") or [])
        if not root_children:
            child_ids = {
                child_id
                for block in blocks
                for child_id in (block.get("children") or [])
            }
            root_children = [
                str(block.get("block_id"))
                for block in blocks
                if block.get("block_id") not in child_ids and block is not root
            ]

        rendered: List[str] = []
        visited: set[str] = set()
        for block_id in root_children:
            part = await self._render_block(
                client,
                access_token,
                by_id,
                str(block_id),
                visited=visited,
                include_links=include_links,
                include_images=include_images,
                download_images=download_images,
                image_max_bytes=image_max_bytes,
            )
            if part.strip():
                rendered.append(part.strip())

        warnings = "\n".join(f"- {warning}" for warning in self._warnings)
        warning_section = f"\n\n## 解析提示\n\n{warnings}" if warnings else ""
        markdown = (
            f"# {title or '飞书文档'}\n\n"
            f"来源：{source_url}\n\n"
            + "\n\n".join(rendered)
            + warning_section
        ).strip()
        return markdown, {
            "block_count": len(blocks),
            "block_type_counts": block_type_counts,
            "table_count": block_type_counts.get("table", 0),
            "whiteboard_count": block_type_counts.get("board", 0),
            "sheet_count": block_type_counts.get("sheet", 0),
            "bitable_count": block_type_counts.get("bitable", 0),
        }

    async def _fetch_all_blocks(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        document_id: str,
    ) -> List[Dict[str, Any]]:
        blocks: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        while True:
            params: Dict[str, Any] = {"page_size": 500, "document_revision_id": -1}
            if page_token:
                params["page_token"] = page_token
            data = await self._get_json(
                client,
                access_token,
                f"/docx/v1/documents/{document_id}/blocks",
                params=params,
                action="获取飞书文档 Block",
            )
            items = data.get("items") if isinstance(data.get("items"), list) else []
            blocks.extend(item for item in items if isinstance(item, dict))
            if len(blocks) > self.max_blocks:
                raise FeishuDocumentError(
                    f"飞书文档 Block 数超过安全上限 {self.max_blocks}，请拆分文档后导入。"
                )
            if not data.get("has_more"):
                break
            page_token = str(data.get("page_token") or "").strip() or None
            if not page_token:
                break
        return blocks

    async def _render_block(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        by_id: Dict[str, Dict[str, Any]],
        block_id: str,
        *,
        visited: set[str],
        include_links: bool,
        include_images: bool,
        download_images: bool,
        image_max_bytes: int,
    ) -> str:
        if block_id in visited:
            return ""
        visited.add(block_id)
        block = by_id.get(block_id)
        if not block:
            return ""
        block_type = int(block.get("block_type") or 0)
        field_name = BLOCK_FIELD_NAMES.get(block_type, "")
        payload = block.get(field_name) if isinstance(block.get(field_name), dict) else {}
        children = [str(item) for item in (block.get("children") or [])]

        if block_type == 31:
            return await self._render_native_table(
                client,
                access_token,
                by_id,
                block,
                visited=visited,
                include_links=include_links,
                include_images=include_images,
                download_images=download_images,
                image_max_bytes=image_max_bytes,
            )
        if block_type == 27:
            return await self._render_image(
                client,
                access_token,
                block,
                include_images=include_images,
                download_images=download_images,
                image_max_bytes=image_max_bytes,
            )
        if block_type == 43:
            return await self._render_board(
                client,
                access_token,
                block,
                include_images=include_images,
                download_images=download_images,
                image_max_bytes=image_max_bytes,
            )
        if block_type == 30:
            return await self._render_sheet(client, access_token, block)
        if block_type == 18:
            return await self._render_bitable(client, access_token, block)

        text = self._rich_text(payload.get("elements"), include_links=include_links)
        if not text:
            text = self._visible_payload_text(payload)

        own = ""
        if block_type == 2:
            own = text
        elif 3 <= block_type <= 11:
            own = f"{'#' * min(6, block_type - 2)} {text}".rstrip()
        elif block_type == 12:
            own = f"- {text}".rstrip()
        elif block_type == 13:
            own = f"1. {text}".rstrip()
        elif block_type == 14:
            language = CODE_LANGUAGES.get(int((payload.get("style") or {}).get("language") or 0), "")
            own = f"```{language}\n{text}\n```"
        elif block_type == 15:
            own = "\n".join(f"> {line}" for line in (text or "").splitlines())
        elif block_type == 17:
            done = bool((payload.get("style") or {}).get("done"))
            own = f"- [{'x' if done else ' '}] {text}".rstrip()
        elif block_type == 22:
            own = "---"
        elif block_type == 23:
            name = str(payload.get("name") or text or "附件")
            own = f"> 附件：{name}"
        elif block_type == 26:
            component = payload.get("component") if isinstance(payload.get("component"), dict) else {}
            url = component.get("url") or payload.get("url")
            own = f"[嵌入内容]({url})" if include_links and url else f"> 嵌入内容：{text or 'iframe'}"
        elif block_type in {19, 34}:
            own = "\n".join(f"> {line}" for line in text.splitlines()) if text else ""
        elif block_type in {21, 29}:
            label = "流程图" if block_type == 21 else "思维笔记"
            own = f"### {label}\n\n{text or f'（{label} Block）'}"
        elif block_type not in {1, 24, 25, 32, 33}:
            label = BLOCK_FIELD_NAMES.get(block_type, f"Block {block_type}")
            own = text or f"> 飞书 {label} Block"

        child_parts: List[str] = []
        for child_id in children:
            child = await self._render_block(
                client,
                access_token,
                by_id,
                child_id,
                visited=visited,
                include_links=include_links,
                include_images=include_images,
                download_images=download_images,
                image_max_bytes=image_max_bytes,
            )
            if child.strip():
                child_parts.append(child.strip())
        if own and child_parts:
            return f"{own}\n\n" + "\n\n".join(child_parts)
        return own or "\n\n".join(child_parts)

    async def _render_native_table(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        by_id: Dict[str, Dict[str, Any]],
        block: Dict[str, Any],
        *,
        visited: set[str],
        include_links: bool,
        include_images: bool,
        download_images: bool,
        image_max_bytes: int,
    ) -> str:
        payload = block.get("table") if isinstance(block.get("table"), dict) else {}
        prop = payload.get("property") if isinstance(payload.get("property"), dict) else {}
        row_size = int(prop.get("row_size") or 0)
        column_size = int(prop.get("column_size") or 0)
        cell_ids = [str(item) for item in (block.get("children") or [])]
        if column_size <= 0:
            column_size = max(1, len(cell_ids) // max(1, row_size))

        cells: List[str] = []
        for cell_id in cell_ids:
            cell_block = by_id.get(cell_id) or {}
            visited.add(cell_id)
            parts: List[str] = []
            for child_id in cell_block.get("children") or []:
                part = await self._render_block(
                    client,
                    access_token,
                    by_id,
                    str(child_id),
                    visited=visited,
                    include_links=include_links,
                    include_images=include_images,
                    download_images=download_images,
                    image_max_bytes=image_max_bytes,
                )
                if part.strip():
                    parts.append(part.strip())
            cells.append("\n".join(parts))

        rows = [
            cells[index : index + column_size]
            for index in range(0, len(cells), column_size)
        ]
        return _markdown_table(rows, empty_label="空表格")

    async def _render_image(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        block: Dict[str, Any],
        *,
        include_images: bool,
        download_images: bool,
        image_max_bytes: int,
    ) -> str:
        payload = block.get("image") if isinstance(block.get("image"), dict) else {}
        token = str(payload.get("token") or block.get("block_token") or "").strip()
        if not include_images:
            return "> 图片 Block（已按导入选项跳过）"
        if not download_images or not token:
            return "> 图片 Block（未下载素材）"
        asset_path = await self._download_media_asset(
            client,
            access_token,
            token,
            prefix="image",
            max_bytes=image_max_bytes,
        )
        return f"![飞书文档图片]({asset_path})" if asset_path else "> 图片素材下载失败"

    async def _render_board(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        block: Dict[str, Any],
        *,
        include_images: bool,
        download_images: bool,
        image_max_bytes: int,
    ) -> str:
        payload = block.get("board") if isinstance(block.get("board"), dict) else {}
        token = str(
            payload.get("token")
            or payload.get("whiteboard_id")
            or block.get("block_token")
            or ""
        ).strip()
        if not token:
            return "### 画板\n\n_（未返回画板 token）_"

        lines = ["### 画板"]
        try:
            data = await self._get_json(
                client,
                access_token,
                f"/board/v1/whiteboards/{token}/nodes",
                action="读取画板节点",
            )
            nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
            visible_text = self._board_text(nodes)
            self._stats["whiteboard_nodes"] = self._stats.get("whiteboard_nodes", 0) + len(nodes)
            if visible_text:
                lines.extend(["", "画板文字内容：", *[f"- {item}" for item in visible_text]])
            else:
                lines.extend(["", f"_（画板包含 {len(nodes)} 个节点，未提取到文字）_"])
        except FeishuDocumentError as exc:
            self._warnings.append(f"画板节点读取失败：{exc}")
            lines.extend(["", "_（画板节点读取失败）_"])

        if include_images and download_images and self._asset_count < self._active_max_assets:
            try:
                content, headers = await self._download_bytes_limited(
                    client,
                    access_token,
                    f"/board/v1/whiteboards/{token}/download_as_image",
                    action="下载画板缩略图",
                    max_bytes=image_max_bytes,
                )
                extension = _content_type_extension(
                    headers.get("content-type", ""),
                    ".png",
                )
                asset_path = self._store_asset(token, content, "whiteboard", extension)
                lines.insert(1, f"\n![飞书画板缩略图]({asset_path})")
            except FeishuDocumentError as exc:
                self._warnings.append(f"画板缩略图下载失败：{exc}")
        return "\n".join(lines)

    async def _render_sheet(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        block: Dict[str, Any],
    ) -> str:
        payload = block.get("sheet") if isinstance(block.get("sheet"), dict) else {}
        token = str(payload.get("token") or block.get("block_token") or "").strip()
        sheet_id = str(payload.get("sheet_id") or payload.get("sheet-id") or "").strip() or None
        if not token:
            return "### 嵌入电子表格\n\n_（未返回 spreadsheet token）_"
        try:
            return await self._fetch_spreadsheet_markdown(
                client,
                access_token,
                token,
                sheet_id=sheet_id,
            )
        except FeishuDocumentError as exc:
            self._warnings.append(f"嵌入电子表格读取失败：{exc}")
            return "### 嵌入电子表格\n\n_（读取失败，详见解析提示）_"

    async def _render_bitable(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        block: Dict[str, Any],
    ) -> str:
        payload = block.get("bitable") if isinstance(block.get("bitable"), dict) else {}
        token = str(payload.get("token") or block.get("block_token") or "").strip()
        table_id = str(payload.get("table_id") or payload.get("table-id") or "").strip() or None
        if not token:
            return "### 嵌入多维表格\n\n_（未返回 app token）_"
        try:
            return await self._fetch_bitable_markdown(
                client,
                access_token,
                token,
                table_id=table_id,
            )
        except FeishuDocumentError as exc:
            self._warnings.append(f"嵌入多维表格读取失败：{exc}")
            return "### 嵌入多维表格\n\n_（读取失败，详见解析提示）_"

    async def _fetch_spreadsheet_markdown(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        spreadsheet_token: str,
        *,
        sheet_id: Optional[str] = None,
    ) -> str:
        data = await self._get_json(
            client,
            access_token,
            f"/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query",
            action="获取电子表格工作表",
        )
        sheets = data.get("sheets") if isinstance(data.get("sheets"), list) else []
        if sheet_id:
            sheets = [sheet for sheet in sheets if str(sheet.get("sheet_id")) == sheet_id]
        sheets = sheets[:5]
        parts = ["### 嵌入电子表格"]
        for sheet in sheets:
            current_id = str(sheet.get("sheet_id") or "")
            title = str(sheet.get("title") or current_id or "工作表")
            grid = sheet.get("grid_properties") if isinstance(sheet.get("grid_properties"), dict) else {}
            row_count = min(max(1, int(grid.get("row_count") or 1)), self.max_sheet_rows)
            column_count = min(max(1, int(grid.get("column_count") or 1)), 50)
            cell_range = f"{current_id}!A1:{_column_name(column_count)}{row_count}"
            values_data = await self._get_json(
                client,
                access_token,
                f"/sheets/v2/spreadsheets/{spreadsheet_token}/values_batch_get",
                params={
                    "ranges": cell_range,
                    "valueRenderOption": "FormattedValue",
                    "dateTimeRenderOption": "FormattedString",
                },
                action=f"读取电子表格工作表 {title}",
            )
            ranges = (
                values_data.get("valueRanges")
                if isinstance(values_data.get("valueRanges"), list)
                else []
            )
            values = ranges[0].get("values", []) if ranges and isinstance(ranges[0], dict) else []
            parts.extend(["", f"#### {title}", "", _markdown_table(values)])
        if not sheets:
            parts.extend(["", "_（未找到可读取的工作表）_"])
        return "\n".join(parts)

    async def _fetch_bitable_markdown(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        app_token: str,
        *,
        table_id: Optional[str] = None,
    ) -> str:
        tables_data = await self._get_json(
            client,
            access_token,
            f"/bitable/v1/apps/{app_token}/tables",
            params={"page_size": 100},
            action="列出多维表格数据表",
        )
        tables = tables_data.get("items") if isinstance(tables_data.get("items"), list) else []
        if table_id:
            tables = [table for table in tables if str(table.get("table_id")) == table_id]
        tables = tables[:5]
        parts = ["### 嵌入多维表格"]
        for table in tables:
            current_id = str(table.get("table_id") or "")
            name = str(table.get("name") or current_id or "数据表")
            records: List[Dict[str, Any]] = []
            page_token: Optional[str] = None
            while len(records) < self.max_bitable_records:
                remaining = self.max_bitable_records - len(records)
                params: Dict[str, Any] = {
                    "page_size": min(500, remaining),
                    "text_field_as_array": "false",
                }
                if page_token:
                    params["page_token"] = page_token
                records_data = await self._get_json(
                    client,
                    access_token,
                    f"/bitable/v1/apps/{app_token}/tables/{current_id}/records",
                    params=params,
                    action=f"读取多维表格数据表 {name}",
                )
                items = (
                    records_data.get("items")
                    if isinstance(records_data.get("items"), list)
                    else []
                )
                records.extend(item for item in items if isinstance(item, dict))
                if not records_data.get("has_more"):
                    break
                page_token = str(records_data.get("page_token") or "").strip() or None
                if not page_token:
                    break

            field_names: List[str] = []
            for record in records:
                fields = record.get("fields") if isinstance(record.get("fields"), dict) else {}
                for field_name in fields:
                    if field_name not in field_names:
                        field_names.append(field_name)
            rows: List[List[Any]] = [field_names]
            for record in records:
                fields = record.get("fields") if isinstance(record.get("fields"), dict) else {}
                rows.append([fields.get(field_name) for field_name in field_names])
            parts.extend(["", f"#### {name}", "", _markdown_table(rows)])
            if records_data.get("has_more"):
                parts.extend(
                    ["", f"_（仅导入前 {self.max_bitable_records} 条记录）_"]
                )
        if not tables:
            parts.extend(["", "_（未找到可读取的数据表）_"])
        return "\n".join(parts)

    async def _download_bytes_limited(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        path: str,
        *,
        action: str,
        max_bytes: int,
    ) -> Tuple[bytes, httpx.Headers]:
        """Stream a binary OpenAPI response and stop as soon as the limit is exceeded."""
        url = f"{FEISHU_API_BASE}{path}"
        for attempt in range(3):
            response: Optional[httpx.Response] = None
            try:
                request = client.build_request(
                    "GET",
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                response = await client.send(request, stream=True)

                if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                    await response.aclose()
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue

                if response.status_code >= 400:
                    error_body = bytearray()
                    async for chunk in response.aiter_bytes():
                        remaining = 64 * 1024 - len(error_body)
                        if remaining <= 0:
                            break
                        error_body.extend(chunk[:remaining])
                    message = ""
                    try:
                        payload = json.loads(error_body.decode("utf-8", errors="replace"))
                        if isinstance(payload, dict):
                            message = str(payload.get("msg") or payload.get("message") or "")
                    except Exception:
                        pass
                    hint = (
                        "请确认应用已开通相应只读权限，并在文档的「添加文档应用」中授权。"
                        if response.status_code in {400, 403}
                        else "请稍后重试。"
                    )
                    raise FeishuDocumentError(
                        f"{action}失败（HTTP {response.status_code}）"
                        f"{f'：{message}' if message else ''}。{hint}"
                    )

                declared_length = response.headers.get("content-length")
                if declared_length:
                    try:
                        parsed_length = int(declared_length)
                    except ValueError:
                        parsed_length = None
                    if parsed_length is not None and parsed_length > max_bytes:
                        raise FeishuDocumentError(
                            f"{action}超过大小限制 {max_bytes} bytes。"
                        )

                chunks: List[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise FeishuDocumentError(
                            f"{action}超过大小限制 {max_bytes} bytes。"
                        )
                    chunks.append(chunk)
                return b"".join(chunks), httpx.Headers(response.headers)
            except FeishuDocumentError:
                raise
            except httpx.HTTPError as exc:
                if attempt >= 2:
                    raise FeishuDocumentError(f"{action}网络请求失败：{exc}") from exc
                await asyncio.sleep(0.5 * (2**attempt))
            finally:
                if response is not None:
                    await response.aclose()
        raise FeishuDocumentError(f"{action}未收到响应。")

    async def _download_media_asset(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        file_token: str,
        *,
        prefix: str,
        max_bytes: int,
    ) -> Optional[str]:
        if self._asset_count >= self._active_max_assets:
            self._warnings.append(
                f"素材数量超过上限 {self._active_max_assets}，后续素材已跳过。"
            )
            return None
        try:
            content, headers = await self._download_bytes_limited(
                client,
                access_token,
                f"/drive/v1/medias/{file_token}/download",
                action="下载飞书文档素材",
                max_bytes=max_bytes,
            )
            extension = _content_type_extension(headers.get("content-type", ""), ".bin")
            return self._store_asset(file_token, content, prefix, extension)
        except FeishuDocumentError as exc:
            self._warnings.append(f"素材 {file_token[:8]}… 下载失败：{exc}")
            return None

    def _store_asset(self, token: str, content: bytes, prefix: str, extension: str) -> str:
        digest = hashlib.sha1(token.encode("utf-8")).hexdigest()[:12]
        path = f"{FEISHU_ASSET_DIR}/{prefix}-{digest}{extension}"
        self._asset_map[path] = content
        self._asset_count += 1
        return path

    def _rich_text(self, elements: Any, *, include_links: bool) -> str:
        if not isinstance(elements, list):
            return ""
        parts: List[str] = []
        for element in elements:
            if not isinstance(element, dict):
                continue
            if isinstance(element.get("text_run"), dict):
                text_run = element["text_run"]
                text = str(text_run.get("content") or "")
                style = (
                    text_run.get("text_element_style")
                    if isinstance(text_run.get("text_element_style"), dict)
                    else {}
                )
                if style.get("inline_code"):
                    text = f"`{text}`"
                if style.get("bold"):
                    text = f"**{text}**"
                if style.get("italic"):
                    text = f"*{text}*"
                link = style.get("link") if isinstance(style.get("link"), dict) else {}
                if include_links and link.get("url"):
                    text = f"[{text}]({unquote(str(link['url']))})"
                parts.append(text)
            elif isinstance(element.get("equation"), dict):
                parts.append(f"${element['equation'].get('content', '')}$")
            elif isinstance(element.get("mention_user"), dict):
                mention = element["mention_user"]
                parts.append(f"@{mention.get('name') or mention.get('user_id') or '用户'}")
            elif isinstance(element.get("mention_doc"), dict):
                mention = element["mention_doc"]
                title = str(mention.get("title") or "文档")
                url = mention.get("url")
                parts.append(f"[{title}]({url})" if include_links and url else title)
            elif isinstance(element.get("reminder"), dict):
                parts.append(_cell_to_text(element["reminder"]))
            else:
                fallback = self._visible_payload_text(element)
                if fallback:
                    parts.append(fallback)
        return "".join(parts).strip()

    def _visible_payload_text(self, payload: Any) -> str:
        values: List[str] = []

        def walk(value: Any, key: str = "") -> None:
            if isinstance(value, dict):
                for child_key, child in value.items():
                    if child_key in {"token", "block_id", "parent_id", "children", "style"}:
                        continue
                    walk(child, child_key)
            elif isinstance(value, list):
                for child in value:
                    walk(child, key)
            elif key in {"text", "content", "title", "name", "description"}:
                text = str(value or "").strip()
                if text and text not in values:
                    values.append(text)

        walk(payload)
        return " ".join(values[:100])

    def _board_text(self, nodes: Iterable[Any]) -> List[str]:
        values: List[str] = []
        for node in nodes:
            text = self._visible_payload_text(node)
            if text and text not in values:
                values.append(text)
            if len(values) >= 200:
                break
        return values

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        action: str,
    ) -> Dict[str, Any]:
        response = await self._request(
            client,
            "GET",
            path,
            access_token=access_token,
            params=params,
            action=action,
        )
        payload = self._decode_api_response(response, action)
        data = payload.get("data")
        return data if isinstance(data, dict) else {}

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        *,
        access_token: str,
        action: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        url = f"{FEISHU_API_BASE}{path}"
        response: Optional[httpx.Response] = None
        for attempt in range(3):
            try:
                response = await client.request(
                    method,
                    url,
                    params=params,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            except httpx.HTTPError as exc:
                if attempt >= 2:
                    raise FeishuDocumentError(f"{action}网络请求失败：{exc}") from exc
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            if response.status_code not in {429, 500, 502, 503, 504} or attempt >= 2:
                break
            await asyncio.sleep(0.5 * (2**attempt))
        if response is None:
            raise FeishuDocumentError(f"{action}未收到响应。")
        if response.status_code >= 400:
            message = ""
            try:
                body = response.json()
                message = str(body.get("msg") or body.get("message") or "")
            except Exception:
                pass
            hint = (
                "请确认应用已开通相应只读权限，并在文档的「添加文档应用」中授权。"
                if response.status_code in {400, 403}
                else "请稍后重试。"
            )
            raise FeishuDocumentError(
                f"{action}失败（HTTP {response.status_code}）"
                f"{f'：{message}' if message else ''}。{hint}"
            )
        return response

    def _decode_api_response(self, response: httpx.Response, action: str) -> Dict[str, Any]:
        try:
            payload = response.json()
        except Exception as exc:
            raise FeishuDocumentError(f"{action}返回了非 JSON 响应。") from exc
        if not isinstance(payload, dict):
            raise FeishuDocumentError(f"{action}返回格式异常。")
        code = int(payload.get("code") or 0)
        if code != 0:
            message = str(payload.get("msg") or "未知错误")
            permission_hint = ""
            if code in {91403, 99991679, 1770032, 1310213, 2890005}:
                permission_hint = " 请确认应用权限与目标文档的应用协作者权限。"
            raise FeishuDocumentError(f"{action}失败（code={code}）：{message}。{permission_hint}".strip())
        return payload
