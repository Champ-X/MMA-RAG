"""Search adapters and one bounded, public-network-only material downloader."""

import asyncio
import ipaddress
import json
import mimetypes
import os
import re
import socket
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from email.message import Message
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

import httpx

from app.core.config import settings
from app.modules.ingestion.sources.base import ContentSourceResult


class CollectionProviderError(Exception):
    def __init__(self, code: str, message: str, *, downloaded_bytes: int = 0):
        self.code = code
        self.message = message
        self.downloaded_bytes = max(0, int(downloaded_bytes))
        super().__init__(message)


def _key(channel: str) -> str:
    if channel == "tavily":
        return str(getattr(settings, "tavily_api_key", "") or "").strip()
    return str(os.environ.get({"pixabay": "PIXABAY_API_KEY", "google_images": "SERPAPI_KEY"}.get(channel, ""), "")).strip()


def capabilities() -> dict:
    """Available means configured adapter, not a live provider-health guarantee."""
    result = {}
    for channel in ("tavily", "pixabay", "google_images", "internet_archive"):
        configured = channel == "internet_archive" or bool(_key(channel))
        result[channel] = {"configured": configured, "available": configured,
                           "kinds": ["webpage", "news", "document", "image", "audio", "video"] if channel == "tavily" else ["image"],
                           "reason": "已配置，连接状态将在搜索时检查" if configured else "未配置 API 密钥"}
    result["open_web"] = {"configured": True, "available": True,
                          "kinds": ["webpage", "news", "document", "image", "audio", "video"],
                          "reason": "从提供的公开链接发现原始素材，无需搜索密钥"}
    return result


async def _api_json(method: str, url: str, *, params=None, payload=None) -> dict:
    try:
        async with asyncio.timeout(25), httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), trust_env=False,
                                                        follow_redirects=False) as client:
            async with client.stream(method, url, params=params, json=payload) as response:
                if response.status_code in (401, 402, 403, 429):
                    raise CollectionProviderError("provider_blocked", "搜索渠道拒绝请求或额度不足，请检查渠道配置。")
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 4 * 1024 * 1024:
                        raise CollectionProviderError("search_failed", "搜索渠道返回的数据过大。")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError("invalid response")
        return result
    except CollectionProviderError:
        raise
    except (httpx.TimeoutException, TimeoutError):
        raise CollectionProviderError("provider_timeout", "搜索渠道请求超时。") from None
    except Exception:
        # Provider exception strings often include a URL containing an API key.
        raise CollectionProviderError("search_failed", "搜索渠道请求失败，请稍后重试。") from None


def _text_metadata(value):
    if isinstance(value, (list, tuple)):
        return "; ".join(str(item) for item in value if isinstance(item, (str, int, float))) or None
    return str(value) if isinstance(value, (str, int, float)) else None


def _publication_date(value) -> str | None:
    if isinstance(value, list):
        value = next((item for item in value if isinstance(item, str) and item.strip()), None)
    text = _text_metadata(value)
    if not text:
        return None
    # Highwire/arXiv citation metadata commonly uses YYYY/MM/DD.
    if re.fullmatch(r"\d{4}/\d{1,2}/\d{1,2}", text):
        try:
            return datetime.strptime(text, "%Y/%m/%d").isoformat()
        except ValueError:
            return None
    try:
        date = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            date = parsedate_to_datetime(text)
        except (ValueError, TypeError):
            return text
    return date.isoformat()


def _candidate(*, title, url, source, kind, description="", **metadata) -> dict:
    for field in ("author", "license"):
        if field in metadata:
            metadata[field] = _text_metadata(metadata[field])
    if "published_at" in metadata:
        metadata["published_at"] = _publication_date(metadata["published_at"])
    for field in ("width", "height"):
        if field in metadata:
            try:
                metadata[field] = max(0, int(metadata[field])) or None
            except (TypeError, ValueError):
                metadata[field] = None
    return {"title": str(title or url)[:500], "url": str(url), "source": source, "kind": kind,
            "description": str(description or "")[:5000],
            **{key: value for key, value in metadata.items() if value is not None}}


async def _archive_candidate(doc: dict, semaphore: asyncio.Semaphore) -> dict | None:
    identifier = doc.get("identifier")
    if not isinstance(identifier, str) or not identifier:
        return None
    async with semaphore:
        data = await _api_json("GET", "https://archive.org/metadata/" + quote(identifier, safe=""))
    files = [item for item in data.get("files", []) if isinstance(item, dict)
             and Path(str(item.get("name", ""))).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
             and not str(item.get("name", "")).startswith("__ia_thumb")]
    files.sort(key=lambda item: item.get("source") != "original")
    if not files:
        return None
    selected = files[0]
    meta = data.get("metadata") or doc
    return _candidate(title=meta.get("title", identifier), url="https://archive.org/details/" + quote(identifier, safe=""),
                      source="internet_archive", kind="image", description=meta.get("description", ""),
                      download_url="https://archive.org/download/" + quote(identifier, safe="") + "/" + quote(selected["name"], safe="/"),
                      author=meta.get("creator"), license=meta.get("licenseurl"), published_at=meta.get("date"),
                      provider_metadata={"identifier": identifier, "file": selected})


_RESOURCE_EXTENSIONS = {
    "document": {".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".txt", ".md", ".csv"},
    "image": {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"},
    "audio": {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"},
    "video": {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"},
}
_DISCOVERY_PAGE_BYTES = 1024 * 1024
_DISCOVERY_MAX_PAGES = 3
_PDF_DISCOVERY_MAX_PAGES = 12
_GENERIC_DOCUMENT_LABEL = re.compile(r"(?:paper|pdf|download|full[\s_-]*text|view|file|document|下载|全文|原文|论文)(?:[\s_-]+(?:paper|pdf|file|document|full[\s_-]*text))*", re.I)


def _hash_filename(filename: str) -> bool:
    return bool(re.fullmatch(r"[a-f0-9]{16,}(?:[-_](?:paper|fulltext|main|download))?", Path(filename).stem, re.I))


def _resource_kind(url: str, mime: str = "") -> str | None:
    mime = mime.split(";", 1)[0].lower().strip()
    if mime in {"text/html", "application/xhtml+xml"}:
        return "webpage"
    for kind in ("image", "audio", "video"):
        if mime.startswith(kind + "/"):
            return kind
    if mime == "application/pdf" or "officedocument" in mime or mime in {"text/plain", "text/markdown", "text/csv"}:
        return "document"
    suffix = Path(unquote(urlsplit(url).path)).suffix.lower()
    return next((kind for kind, extensions in _RESOURCE_EXTENSIONS.items() if suffix in extensions), None)


def _observed_url(base: str, value: str) -> str | None:
    if not isinstance(value, str) or len(value) > 3000:
        return None
    joined = urljoin(base, value.strip())
    try:
        parsed = urlsplit(joined)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return None
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except ValueError:
        return None


def _pdf_link(url: str, mime: str = "", label: str = "") -> bool:
    """Classify an observed link, including extensionless publisher PDF endpoints."""
    path = unquote(urlsplit(url).path).lower()
    return (mime.split(";", 1)[0].strip().lower() == "application/pdf"
            or path.endswith(".pdf") or bool(re.search(r"/(?:e?pdf)(?:/|$)", path))
            or bool(re.search(r"\bpdf\b", label, re.I)))


def _paper_metadata(soup, page: dict) -> dict:
    """Source metadata is evidence; search/request text cannot supply missing facts."""
    values: dict[str, list[str]] = {}
    for node in soup.find_all("meta", limit=200):
        name = str(node.get("name") or node.get("property") or "").lower()
        content = node.get("content")
        if isinstance(content, str) and content.strip():
            values.setdefault(name, []).append(content.strip())
    def first(*names):
        return next((values[name][0] for name in names if values.get(name)), None)
    title = first("citation_title", "dc.title", "dcterms.title")
    authors = values.get("citation_author") or values.get("dc.creator")
    published = first("citation_publication_date", "citation_date", "dc.date", "dcterms.issued", "article:published_time")
    result = {"title": title or (soup.title.get_text(" ", strip=True) if soup.title else page.get("title")),
              "author": _text_metadata(authors) or page.get("author"),
              "published_at": _publication_date(published) or page.get("published_at"),
              "doi": first("citation_doi", "dc.identifier.doi"),
              "abstract": first("citation_abstract", "dc.description", "dcterms.abstract", "description")}
    return {key: value for key, value in result.items() if value}


def _structured_pdf_links(soup) -> list[tuple[str, str]]:
    """Read bounded JSON-LD media URLs, without evaluating publisher scripts."""
    links = []
    for node in soup.find_all("script", attrs={"type": "application/ld+json"}, limit=12):
        try:
            pending = [json.loads(node.string or node.get_text())]
        except (ValueError, TypeError):
            continue
        inspected = 0
        while pending and inspected < 150:
            item = pending.pop()
            inspected += 1
            if isinstance(item, list):
                pending.extend(item[:30])
            elif isinstance(item, dict):
                mime = item.get("encodingFormat") or item.get("fileFormat") or ""
                for field in ("contentUrl", "url"):
                    value = item.get(field)
                    if isinstance(value, str) and (mime == "application/pdf" or value.lower().split("?", 1)[0].endswith(".pdf")):
                        links.append((value, "jsonld." + field))
                pending.extend(value for key, value in item.items()
                               if key in {"@graph", "mainEntity", "encoding", "associatedMedia", "distribution", "subjectOf"}
                               and isinstance(value, (dict, list)))
    return links[:20]


def _page_links(body: bytes, page_url: str, page: dict, kind: str, *, required_format: str | None = None,
                material_intent: str | None = None) -> tuple[list[dict], list[dict]]:
    """Extract only observed attributes; never synthesize a guessed download URL."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(body, "html.parser")
    identity = _paper_metadata(soup, page)
    page_title = str(identity.get("title") or page.get("title") or page_url)[:500]
    resources, follow, seen = [], [], set()
    nodes = list(soup.find_all(["a", "img", "source", "audio", "video", "meta", "link", "iframe", "embed", "object"], limit=400))
    # Metadata identifies the primary paper; it must beat appendix and reference links.
    nodes.sort(key=lambda node: 0 if node.name == "meta" and str(node.get("name", "")).lower() in {
        "citation_pdf_url", "bepress_citation_pdf_url", "eprints.document_url"} else 1)
    for node in nodes:
        value = node.get("href") if node.name in {"a", "link"} else node.get("src") or node.get("data-src")
        if node.name == "object":
            value = node.get("data")
        declared = node.get("type", "")
        primary_pdf = False
        if node.name == "meta":
            meta_name = str(node.get("name") or node.get("property") or "").lower()
            if meta_name in {"citation_pdf_url", "bepress_citation_pdf_url", "eprints.document_url"}:
                value, declared = node.get("content"), "application/pdf"
                primary_pdf = True
            elif meta_name in {"dc.identifier", "dc.relation", "dcterms.hasformat"}:
                value = node.get("content")
            elif meta_name in {"og:image", "twitter:image"}:
                value, declared = node.get("content"), "image/unknown"
        if not value and node.name in {"img", "source"} and node.get("srcset"):
            value = str(node["srcset"]).split(",")[-1].strip().split(" ")[0]
        url = _observed_url(page_url, value)
        if not url or url in seen:
            continue
        seen.add(url)
        detected = _resource_kind(url, declared)
        label = str(node.get("alt") or node.get("title") or node.get_text(" ", strip=True) or "")[:400]
        pdf_link = _pdf_link(url, declared, label)
        if kind == "document" and pdf_link:
            detected = "document"
        if detected is None and node.name in {"img", "audio", "video", "source"}:
            parent = node.parent.name if node.parent else ""
            detected = "image" if node.name == "img" else node.name if node.name in {"audio", "video"} else parent if parent in {"audio", "video"} else None
        figure = node.find_parent("figure")
        caption = figure.find("figcaption").get_text(" ", strip=True)[:400] if figure and figure.find("figcaption") else ""
        filename = Path(unquote(urlsplit(url).path)).name
        if detected == kind:
            if required_format == "pdf" and not pdf_link:
                continue
            if material_intent == "paper" and re.search(r"supplement|appendix|supporting.?info|补充|附录", label + " " + filename, re.I):
                continue
            if material_intent == "paper":
                reference_section = any(re.search(r"(?:^|[\s_-])(?:references?|bibliography|related|citations?)(?:$|[\s_-])",
                    " ".join([str(parent.get("id", "")), " ".join(parent.get("class", [])), str(parent.get("role", ""))]), re.I)
                    for parent in node.parents if hasattr(parent, "get"))
                if reference_section:
                    continue
            main_document = primary_pdf or node.name in {"link", "embed", "object", "iframe"} or bool(
                _GENERIC_DOCUMENT_LABEL.fullmatch(label.strip()) or re.search(r"(?:full[\s_-]*(?:text|paper)|download.*pdf|pdf.*download|manuscript|论文全文|下载论文)", label, re.I)
                or label.strip().casefold() == page_title.strip().casefold())
            if kind == "image" and re.search(r"(?:^|[_\W])(logo|icon|avatar|favicon)(?:[_\W]|$)", filename, re.I):
                continue
            title = label or caption or filename or f"{kind} 素材"
            if kind == "document" and (not label or _GENERIC_DOCUMENT_LABEL.fullmatch(label.strip()) or node.name == "meta"
                                       or material_intent == "paper" and main_document):
                title = page_title or title
            description = " ".join(filter(None, (label, caption))) if kind == "image" else " — ".join(filter(None, (label, caption, page_title, identity.get("abstract"))))
            resources.append(_candidate(title=title, url=page_url, download_url=url, source=page.get("source", "open_web"), kind=kind,
                description=description, provider_metadata={"page_url": page_url, "page_title": page_title,
                    "observed_attribute": "href" if node.name in {"a", "link"} else "content" if node.name == "meta" else "data" if node.name == "object" else "src",
                    "asset_description": description, "origin": urlsplit(url).hostname,
                    "primary_document": primary_pdf, "main_document_link": main_document, "doi": identity.get("doi"),
                    "anchor_text": label},
                required_format=required_format, material_intent=material_intent,
                author=identity.get("author"), published_at=identity.get("published_at"), license=page.get("license")))
        elif node.name == "a" and detected in {None, "webpage"}:
            # One additional public page may expose a file behind a download page.
            hint = label + " " + url
            pattern = (r"download|full.?text|pdf|manuscript|view.{0,12}(?:paper|document|article)|原文|下载|全文"
                       if required_format == "pdf" else r"download|full.?text|pdf|原文|下载|全文|view|file|media|image|audio|video")
            if re.search(pattern, hint, re.I):
                follow.append(_candidate(title=page_title, url=url, source=page.get("source", "open_web"), kind="webpage",
                    description=" — ".join(filter(None, (label, page_title))),
                    provider_metadata={"page_url": page_url, "page_title": page_title, "observed_attribute": "href",
                                       "anchor_text": label, "origin": urlsplit(url).hostname}))
    if kind == "document":
        for value, attribute in _structured_pdf_links(soup):
            url = _observed_url(page_url, value)
            if not url or url in seen:
                continue
            seen.add(url)
            resources.append(_candidate(title=page_title, url=page_url, download_url=url,
                source=page.get("source", "open_web"), kind="document", description=identity.get("abstract") or page_title,
                author=identity.get("author"), published_at=identity.get("published_at"), license=page.get("license"),
                required_format=required_format, material_intent=material_intent,
                provider_metadata={"page_url": page_url, "page_title": page_title, "observed_attribute": attribute,
                                   "primary_document": True, "doi": identity.get("doi"), "origin": urlsplit(url).hostname}))
    if material_intent == "paper":
        primary = [item for item in resources if item["provider_metadata"].get("primary_document")]
        resources = primary or [item for item in resources if item["provider_metadata"].get("main_document_link")][:1]
    return resources, follow[:6]


def _page_observation(body: bytes) -> tuple[str, str]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(body, "html.parser")
    title = soup.title.get_text(" ", strip=True)[:300] if soup.title else ""
    for tag in soup(["script", "style", "nav", "footer", "noscript"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup
    return title, main.get_text(" ", strip=True)[:2500]


def _linked_resource(page: dict, download_url: str, kind: str) -> dict:
    metadata = page.get("provider_metadata") or {}
    return {**page, "url": metadata.get("page_url") or page["url"], "kind": kind, "download_url": download_url}


async def _discover_public(pages: list[dict], kind: str, limit: int, remaining: int, *,
                           required_format: str | None = None, material_intent: str | None = None) -> list[dict]:
    """Bounded page traversal; paper searches inspect more than the first two hits."""
    consumed, visited, resources = 0, set(), []
    pdf_required = required_format == "pdf"
    max_pages = min(_PDF_DISCOVERY_MAX_PAGES, max(4, limit * 2)) if pdf_required else _DISCOVERY_MAX_PAGES
    queue = [(page, 0) for page in pages[:max_pages if pdf_required else 2]]
    failures = []
    try:
        async with asyncio.timeout(75):
            while queue and len(visited) < max_pages and len(resources) < limit:
                page, depth = queue.pop(0)
                url = page.get("download_url") or page.get("url")
                if not url or url in visited:
                    continue
                visited.add(url)
                if kind not in {"webpage", "news"} and (_resource_kind(url) == kind or kind == "document" and _pdf_link(url)) and (not pdf_required or _pdf_link(url)):
                    # Existence/type is verified by the subsequent download, not inferred as completed here.
                    await _resolve_public(url)
                    resources.append(_linked_resource(page, url, kind))
                    continue
                allowance = min(_DISCOVERY_PAGE_BYTES, remaining - consumed)
                if allowance <= 0:
                    raise CollectionProviderError("discovery_budget_exhausted", "网页发现已达到本次下载预算。", downloaded_bytes=consumed)
                try:
                    body, final_url, headers = await _download(url, allowance)
                    consumed += len(body)
                except CollectionProviderError as error:
                    consumed += error.downloaded_bytes
                    failures.append(error)
                    declared_kind = _resource_kind(getattr(error, "final_url", url), getattr(error, "content_type", ""))
                    pdf_declared = getattr(error, "content_type", "").split(";", 1)[0].strip().lower() == "application/pdf"
                    if error.code == "download_too_large" and declared_kind == kind and (not pdf_required or pdf_declared):
                        resources.append(_linked_resource(page, getattr(error, "final_url", url), kind))
                    continue
                except asyncio.CancelledError as error:
                    consumed += getattr(error, "downloaded_bytes", 0)
                    error.downloaded_bytes = consumed
                    raise
                actual_kind = _resource_kind(final_url, headers.get("content-type", ""))
                if _is_pdf(body):
                    actual_kind = "document"
                is_html = actual_kind == "webpage" or body[:512].lstrip().lower().startswith((b"<!doctype html", b"<html"))
                if not is_html:
                    if actual_kind == kind and (not pdf_required or _is_pdf(body)):
                        resources.append(_linked_resource(page, final_url, kind))
                    continue
                if kind in {"webpage", "news"}:
                    title, description = await asyncio.to_thread(_page_observation, body)
                    resources.append({**page, "url": final_url, "kind": kind, "title": title or final_url,
                                      "description": description})
                    continue
                observed, links = await asyncio.to_thread(_page_links, body, final_url, page, kind,
                                                          required_format=required_format, material_intent=material_intent)
                for resource in observed[:limit * 2]:
                    try:
                        await _resolve_public(resource["download_url"])
                    except CollectionProviderError:
                        continue
                    if resource["download_url"] not in {item.get("download_url") for item in resources}:
                        resources.append(resource)
                    if len(resources) >= limit:
                        break
                if depth < 1:
                    next_pages = [(link, depth + 1) for link in links[:2]]
                    if pdf_required and not observed:
                        queue[0:0] = next_pages
                    elif not observed:
                        queue.extend(next_pages)
    except asyncio.CancelledError as error:
        error.downloaded_bytes = max(consumed, getattr(error, "downloaded_bytes", 0))
        raise
    except TimeoutError:
        if not resources:
            raise CollectionProviderError("provider_timeout", "公开网页资源发现超时。", downloaded_bytes=consumed) from None
        for item in resources:
            item.setdefault("warnings", []).append("已保留找到的原始文件；后续页面读取超时，候选可能不完整。")
    except CollectionProviderError as error:
        error.downloaded_bytes = max(consumed, error.downloaded_bytes)
        raise
    except Exception:
        raise CollectionProviderError("discovery_failed", "公开网页资源发现失败。", downloaded_bytes=consumed) from None
    if not resources:
        if failures and len(failures) == len(visited):
            error = failures[-1]
            error.downloaded_bytes = consumed
            raise error
        raise CollectionProviderError("pdf_unavailable" if pdf_required else "search_empty",
            "已检查论文页面，但未找到可公开获取的 PDF 原文；不会以摘要网页代替。" if pdf_required else "已检查公开网页，但未发现符合类型的原始资源链接。", downloaded_bytes=consumed)
    if pdf_required:
        for item in resources:
            item["required_format"] = "pdf"
            if material_intent:
                item["material_intent"] = material_intent
    resources[0]["_discovery_bytes"] = consumed
    return resources[:limit]


async def discover(query: dict, limit: int) -> list[dict]:
    """Discover metadata without downloading materials or writing to a knowledge base."""
    channel = query.get("channel")
    capability = capabilities().get(channel)
    if capability is None:
        raise CollectionProviderError("unsupported_channel", "不支持此搜索渠道。")
    if not capability["configured"]:
        raise CollectionProviderError("provider_unconfigured", "此搜索渠道尚未配置 API 密钥。")
    count = max(1, min(20, int(limit)))
    text = str(query.get("query", "")).strip()[:600]
    if not text:
        raise CollectionProviderError("invalid_query", "搜索关键词不能为空。")
    required_format = query.get("required_format")
    material_intent = query.get("material_intent")
    kind = "document" if required_format == "pdf" else query.get("kind") or ("webpage" if channel in {"tavily", "open_web"} else "image")
    if kind not in capability["kinds"]:
        raise CollectionProviderError("unsupported_channel", "此渠道不支持请求的素材类型。")
    results = []
    if channel == "open_web":
        seeds = query.get("seed_urls")
        if not isinstance(seeds, list) or not seeds or any(not isinstance(url, str) for url in seeds):
            raise CollectionProviderError("invalid_query", "请提供要查找素材的公开网页链接。")
        pages = [_candidate(title=url, url=url, source="open_web", kind="webpage") for url in seeds[:5]]
        return await _discover_public(pages, kind, count, max(0, int(query.get("_remaining_bytes", 3 * _DISCOVERY_PAGE_BYTES))),
                                      required_format=required_format, material_intent=material_intent)
    if channel == "tavily":
        payload = {"api_key": _key(channel), "query": text, "topic": "news" if kind == "news" else "general",
                   "search_depth": "basic", "max_results": count, "include_raw_content": False}
        if query.get("time_range") in {"day", "week", "month", "year"}:
            payload["time_range"] = query["time_range"]
        if query.get("domains"):
            payload["include_domains"] = query["domains"][:5]
        data = await _api_json("POST", "https://api.tavily.com/search", payload=payload)
        results = [_candidate(title=item.get("title"), url=item["url"], source=channel, kind=kind if kind in {"webpage", "news"} else "webpage",
                              description=item.get("content"), published_at=item.get("published_date"),
                              provider_metadata={"score": item.get("score")})
                   for item in data.get("results", []) if isinstance(item, dict) and item.get("url")]
    elif channel == "pixabay":
        data = await _api_json("GET", "https://pixabay.com/api/", params={"key": _key(channel), "q": text,
                              "per_page": max(3, count), "safesearch": "true", "order": "popular"})
        results = [_candidate(title=item.get("tags"), url=item.get("pageURL") or item["largeImageURL"],
                              download_url=item["largeImageURL"], source=channel, kind="image",
                              description=item.get("tags"), author=item.get("user"), thumbnail_url=item.get("previewURL"),
                              width=item.get("imageWidth"), height=item.get("imageHeight"),
                              provider_metadata={key: item.get(key) for key in ("id", "imageWidth", "imageHeight", "user", "pageURL")})
                   for item in data.get("hits", []) if isinstance(item, dict) and item.get("largeImageURL")]
    elif channel == "google_images":
        data = await _api_json("GET", "https://serpapi.com/search.json", params={"api_key": _key(channel), "q": text,
                              "engine": "google_images", "ijn": 0})
        if data.get("error"):
            raise CollectionProviderError("search_failed", "图片搜索渠道返回错误，请检查配置或额度。")
        results = [_candidate(title=item.get("title"), url=item.get("link") or item["original"],
                              download_url=item["original"], source=channel, kind="image",
                              description=item.get("snippet") or item.get("title"), thumbnail_url=item.get("thumbnail"),
                              width=item.get("original_width"), height=item.get("original_height"),
                              provider_metadata={key: item.get(key) for key in ("source", "original_width", "original_height", "link")})
                   for item in data.get("images_results", []) if isinstance(item, dict) and item.get("original")]
    elif channel == "internet_archive":
        data = await _api_json("GET", "https://archive.org/advancedsearch.php", params={
            "q": 'title:("' + text.replace('"', ' ').replace("\\", " ") + '") AND mediatype:image',
            "output": "json", "rows": count, "fl[]": "identifier,title,description,creator,date,licenseurl"})
        docs = (data.get("response") or {}).get("docs", [])[:count]
        semaphore = asyncio.Semaphore(3)
        outcomes = await asyncio.gather(*(_archive_candidate(doc, semaphore) for doc in docs if isinstance(doc, dict)),
                                        return_exceptions=True)
        results = [item for item in outcomes if isinstance(item, dict)]
        if not results:
            failure = next((item for item in outcomes if isinstance(item, CollectionProviderError)), None)
            if failure:
                raise failure
    if query.get("domains"):
        domains = [str(value).lower().strip(".") for value in query["domains"]]
        results = [item for item in results if any((urlsplit(item["url"]).hostname or "").lower().rstrip(".") == domain
                   or (urlsplit(item["url"]).hostname or "").lower().rstrip(".").endswith("." + domain) for domain in domains)]
    if query.get("time_range") in {"day", "week", "month", "year"}:
        cutoff = datetime.now(timezone.utc) - timedelta(days={"day": 1, "week": 7, "month": 30, "year": 365}[query["time_range"]])
        within_range = []
        for item in results:
            try:
                date = datetime.fromisoformat(str(item.get("published_at", "")).replace("Z", "+00:00"))
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                if date < cutoff:
                    continue
            except ValueError:
                item.setdefault("warnings", []).append("搜索渠道未提供可验证的发布时间。")
            within_range.append(item)
        results = within_range
    if not results:
        raise CollectionProviderError("search_empty", "此渠道没有返回可用的素材候选。")
    if channel == "tavily" and kind not in {"webpage", "news"}:
        return await _discover_public(results, kind, count, max(0, int(query.get("_remaining_bytes", 3 * _DISCOVERY_PAGE_BYTES))),
                                      required_format=required_format, material_intent=material_intent)
    return results[:count]


def _public_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        return ip.is_global and not ip.is_multicast and not ip.is_reserved
    except ValueError:
        return False


async def _resolve_public(url: str) -> tuple[str, str, str]:
    """Resolve once and pin the connection to a checked IP, preventing DNS rebinding."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if parsed.scheme not in {"http", "https"} or not host or parsed.username or parsed.password or port not in {80, 443}:
            raise ValueError("invalid public URL")
        host = host.encode("idna").decode("ascii")
        if "%" in host:
            raise ValueError("invalid hostname")
        entries = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 5)
        addresses = list(dict.fromkeys(entry[4][0] for entry in entries))
        if not addresses or not all(_public_address(address) for address in addresses):
            raise ValueError("non-public address")
        address = addresses[0]
        address_netloc = f"[{address}]" if ":" in address else address
        original_netloc = f"[{host}]" if ":" in host else host
        if parsed.port:
            original_netloc += f":{port}"
        pinned = urlunsplit((parsed.scheme, f"{address_netloc}:{port}", parsed.path or "/", parsed.query, ""))
        return pinned, original_netloc, host
    except (TimeoutError, socket.gaierror):
        raise CollectionProviderError("download_failed", "素材域名解析失败或超时。") from None
    except (ValueError, UnicodeError):
        raise CollectionProviderError("download_blocked", "只允许下载公网 HTTP/HTTPS 素材（80/443端口），已阻止不安全地址。") from None


async def _download(url: str, max_bytes: int) -> tuple[bytes, str, httpx.Headers]:
    downloaded_bytes = 0
    try:
        async with asyncio.timeout(45):
            async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), trust_env=False,
                                         follow_redirects=False, limits=httpx.Limits(max_keepalive_connections=0)) as client:
                current = url
                for hop in range(6):
                    pinned, host_header, tls_host = await _resolve_public(current)
                    async with client.stream("GET", pinned, headers={"Host": host_header, "User-Agent": "Tessmora-Collection/1.0",
                                                                      "Accept-Encoding": "identity"},
                                             extensions={"sni_hostname": tls_host}) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            target = response.headers.get("location")
                            if not target or hop == 5:
                                raise CollectionProviderError("download_failed", "素材链接重定向过多或目标缺失。")
                            current = urljoin(current, target)
                            continue
                        if response.status_code in (401, 403, 429):
                            raise CollectionProviderError("download_blocked", "素材站点拒绝访问，可能需要登录或已限制下载。")
                        response.raise_for_status()
                        length = response.headers.get("content-length", "")
                        if length.isdigit() and int(length) > max_bytes:
                            error = CollectionProviderError("download_too_large", "素材超过本次下载大小限制。")
                            error.content_type, error.final_url = response.headers.get("content-type", ""), current
                            raise error
                        if response.headers.get("content-encoding", "identity").lower() not in {"", "identity"}:
                            raise CollectionProviderError("download_failed", "站点未提供未压缩传输，暂无法在下载限额内安全读取。")
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            downloaded_bytes += len(chunk)
                            content.extend(chunk)
                            if len(content) > max_bytes:
                                error = CollectionProviderError("download_too_large", "素材超过本次下载大小限制。")
                                error.content_type, error.final_url = response.headers.get("content-type", ""), current
                                raise error
                        if not content:
                            raise CollectionProviderError("download_failed", "素材下载内容为空。")
                        return bytes(content), current, response.headers
    except asyncio.CancelledError as error:
        error.downloaded_bytes = downloaded_bytes
        raise
    except CollectionProviderError as error:
        error.downloaded_bytes = max(error.downloaded_bytes, downloaded_bytes)
        raise
    except (httpx.TimeoutException, TimeoutError):
        raise CollectionProviderError("download_timeout", "素材下载超时。", downloaded_bytes=downloaded_bytes) from None
    except Exception:
        raise CollectionProviderError("download_failed", "素材下载失败。", downloaded_bytes=downloaded_bytes) from None
    raise CollectionProviderError("download_failed", "无法取得素材内容。")


def _remove_images(markdown: str) -> str:
    # All references are removed, including local/file/data paths. No downstream
    # Markdown parser may fetch a resource outside this downloader's controls.
    markdown = re.sub(r"!\[([^\]]*)\]\([^\n]*?\)", r"\1", markdown)
    markdown = re.sub(r"!\[([^\]]*)\](?:\[[^\]]*\])?", r"\1", markdown)
    return re.sub(r"<(?:img|picture|source)\b[^>]*>|</picture\s*>", "", markdown, flags=re.I)


def _extract_local(content: bytes, url: str):
    from app.modules.ingestion.sources import webpage_extractor as extractor
    structured = extractor.extract_structured_payload(content, url, include_images=False)
    if structured is not None and structured.markdown.strip():
        return structured
    for method in (extractor._extract_with_trafilatura, extractor._extract_with_readability):
        result = method(content, url, include_links=True, include_images=False)
        if result is not None and result.markdown.strip():
            return result
    raise CollectionProviderError("parse_failed", "未能从网页提取有效正文。")


def is_pdf_content(content: bytes) -> bool:
    return bool(re.match(br"%PDF-[12]\.\d(?:\s|$)", content.lstrip(b"\xef\xbb\xbf\x00\t\r\n ")[:16]))


_is_pdf = is_pdf_content


async def _fetch_linked_pdf(candidate: dict, content: bytes, page_url: str, max_bytes: int):
    """Resolve observed full-text links at fetch time, including direct landing URLs.

    All attempts share one byte allowance; failed files are never replaced by an
    abstract. This also covers a publisher changing its download endpoint after
    search, while retaining the original source and an auditable link chain.
    """
    consumed = len(content)
    visited = {page_url}
    pending = [(candidate, content, page_url, 0)]
    attempts = 0
    last_error = None
    try:
        while pending and attempts < 4:
            page, body, current, depth = pending.pop(0)
            resources, follow = await asyncio.to_thread(_page_links, body, current, page, "document",
                required_format="pdf", material_intent=candidate.get("material_intent"))
            targets = resources[:3] or (follow[:2] if depth < 1 else [])
            original = candidate.get("url")
            if depth == 0 and isinstance(original, str) and original not in visited:
                # A previously observed download endpoint may now be a login or
                # expiry page. Re-open its original source once, within the cap.
                targets.append({**candidate, "url": original, "download_url": None, "kind": "webpage"})
            for target in targets:
                url = target.get("download_url") or target["url"]
                if url in visited or attempts >= 4:
                    continue
                visited.add(url)
                attempts += 1
                allowance = max_bytes - consumed
                if allowance <= 0:
                    raise CollectionProviderError("download_too_large", "论文原文获取已达到本次下载大小限制。")
                try:
                    downloaded, final_url, headers = await _download(url, allowance)
                    consumed += len(downloaded)
                except CollectionProviderError as error:
                    consumed += error.downloaded_bytes
                    last_error = error
                    continue
                except asyncio.CancelledError as error:
                    consumed += getattr(error, "downloaded_bytes", 0)
                    raise
                if _is_pdf(downloaded):
                    resolved = {**candidate, **target, "url": candidate.get("url") or page_url,
                                "download_url": url, "required_format": "pdf",
                                "provider_metadata": {**(candidate.get("provider_metadata") or {}),
                                    **(target.get("provider_metadata") or {}),
                                    "resolution_chain": [page_url, current, url] if current != page_url else [page_url, url]}}
                    return resolved, downloaded, final_url, headers, consumed
                mime = headers.get("content-type", "").split(";", 1)[0].lower()
                html = mime in {"text/html", "application/xhtml+xml"} or downloaded[:512].lstrip().lower().startswith((b"<!doctype html", b"<html"))
                if html and depth < 1:
                    pending.append((target, downloaded, final_url, depth + 1))
                else:
                    last_error = CollectionProviderError("resource_type_mismatch", "下载地址未返回有效的 PDF 文件。")
        if last_error:
            last_error.downloaded_bytes = consumed
            raise last_error
        raise CollectionProviderError("pdf_unavailable", "未找到可公开获取的 PDF 原文；未将摘要网页作为论文收录。")
    except asyncio.CancelledError as error:
        error.downloaded_bytes = consumed
        raise
    except CollectionProviderError as error:
        error.downloaded_bytes = consumed
        raise


async def fetch_candidate(candidate: dict, max_bytes: int) -> ContentSourceResult:
    """Download a checked candidate; preserve provenance and disable implicit asset fetches."""
    if not 1 <= int(max_bytes) <= 100 * 1024 * 1024:
        raise CollectionProviderError("invalid_limit", "下载大小限制须为 1 字节至 100 MB。")
    url = str(candidate.get("download_url") or candidate.get("url") or "")
    pdf_required = candidate.get("required_format") == "pdf"
    prior_bytes = 0
    try:
        content, final_url, headers = await _download(url, int(max_bytes))
    except CollectionProviderError as error:
        original = candidate.get("url")
        if not pdf_required or not isinstance(original, str) or original == url or error.code not in {
            "download_failed", "download_blocked", "download_timeout"}:
            raise
        prior_bytes = error.downloaded_bytes
        allowance = int(max_bytes) - prior_bytes
        if allowance <= 0:
            raise
        try:
            content, final_url, headers = await _download(original, allowance)
            url = original
        except (CollectionProviderError, asyncio.CancelledError) as retry_error:
            retry_error.downloaded_bytes = prior_bytes + getattr(retry_error, "downloaded_bytes", 0)
            raise
    download_bytes = prior_bytes + len(content)
    content_type = headers.get("content-type", "").split(";", 1)[0].lower().strip()
    if _is_pdf(content):
        content_type = "application/pdf"
    is_html = content_type in {"text/html", "application/xhtml+xml"} or content[:512].lstrip().lower().startswith((b"<!doctype html", b"<html"))
    if pdf_required and is_html:
        try:
            candidate, content, final_url, headers, download_bytes = await _fetch_linked_pdf(candidate, content, final_url, int(max_bytes) - prior_bytes)
        except (CollectionProviderError, asyncio.CancelledError) as error:
            error.downloaded_bytes = prior_bytes + getattr(error, "downloaded_bytes", 0)
            raise
        download_bytes += prior_bytes
        url = candidate["download_url"]
        content_type, is_html = "application/pdf", False
    if (pdf_required or content_type == "application/pdf") and not _is_pdf(content):
        raise CollectionProviderError("resource_type_mismatch", "下载内容未通过 PDF 文件签名校验；未以网页或其他文件代替。", downloaded_bytes=download_bytes)
    meta = {"source_url": candidate.get("url") or url, "download_url": url, "final_url": final_url,
            "download_bytes": download_bytes,
            "source": candidate.get("source", "url"), "kind": candidate.get("kind", "file"),
            **{key: candidate[key] for key in ("title", "author", "published_at", "license", "provider_metadata", "required_format", "material_intent") if key in candidate}}
    if is_html:
        if candidate.get("kind") in {"image", "audio", "video", "document"}:
            raise CollectionProviderError("resource_type_mismatch", "资源链接返回网页，未获得所需类型的原始文件。", downloaded_bytes=download_bytes)
        try:
            extracted = await asyncio.to_thread(_extract_local, content, final_url)
        except asyncio.CancelledError as error:
            error.downloaded_bytes = download_bytes
            raise
        except CollectionProviderError as error:
            error.downloaded_bytes = download_bytes
            raise
        except Exception:
            raise CollectionProviderError("parse_failed", "网页正文提取失败。", downloaded_bytes=download_bytes) from None
        markdown = _remove_images(extracted.markdown)
        title = getattr(extracted, "title", None) or candidate.get("title") or "网页素材"
        filename = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(title))[:120] + ".md"
        meta.update({"title": title, "kind": "webpage", "extractor": getattr(extracted, "extractor", "structured_payload"),
                     "warnings": ["仅采集网页正文，网页内嵌图片未自动下载。"]})
        for field, attr in (("author", "author"), ("published_at", "published")):
            if getattr(extracted, attr, None):
                meta[field] = (_publication_date(getattr(extracted, attr)) if field == "published_at"
                               else _text_metadata(getattr(extracted, attr)))
        return ContentSourceResult(markdown.encode("utf-8"), filename, "text/markdown", meta)
    disposition = Message()
    disposition["Content-Disposition"] = headers.get("content-disposition", "")
    response_filename = disposition.get_filename()
    filename = Path(response_filename or unquote(urlsplit(final_url).path)).name or "素材"
    filename = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", filename)[:160]
    if content_type == "application/pdf":
        # arXiv IDs contain a dot but are not filename extensions. Parser routing
        # must follow the verified payload rather than an endpoint's path suffix.
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        paper_title = candidate.get("title")
        if candidate.get("material_intent") == "paper" and not response_filename and isinstance(paper_title, str) and not paper_title.startswith(("http://", "https://")):
            readable = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", paper_title).strip(" .")[:120]
            if readable:
                filename = readable.removesuffix(".pdf") + ".pdf"
    image_magic = content.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a", b"BM", b"II*\x00", b"MM\x00*")) or (content[:4] == b"RIFF" and content[8:12] == b"WEBP")
    if candidate.get("kind") == "image" or content_type.startswith("image/") or image_magic:
        try:
            from PIL import Image
            with Image.open(BytesIO(content)) as image:
                format_name = image.format
                meta["width"], meta["height"] = image.size
            extension = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp", "BMP": ".bmp", "TIFF": ".tiff"}[format_name]
            meta["kind"] = "image"
            readable_title = candidate.get("title") if candidate.get("source") != "url" else None
            if isinstance(readable_title, str) and not readable_title.startswith(("http://", "https://")):
                readable_title = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", readable_title).strip(" .")[:80]
            else:
                readable_title = None
            filename = (readable_title or Path(filename).stem) + extension
            content_type = Image.MIME.get(format_name, content_type)
        except Exception:
            raise CollectionProviderError("unsupported_format", "下载内容不是可解析的图片格式。", downloaded_bytes=download_bytes) from None
    else:
        meta["kind"] = _resource_kind(final_url, content_type) or "file"
    if candidate.get("kind") in {"image", "audio", "video", "document"} and candidate["kind"] != meta["kind"]:
        raise CollectionProviderError("resource_type_mismatch", "下载内容类型与所需素材类型不符。", downloaded_bytes=download_bytes)
    if not Path(filename).suffix:
        filename += {"application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md",
                     "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(content_type,
                     mimetypes.guess_extension(content_type) or ".bin")
    if meta["kind"] == "document" and candidate.get("source") in {"open_web", "tavily"} and _hash_filename(filename):
        meaningful_disposition = response_filename and not _hash_filename(response_filename) and not _GENERIC_DOCUMENT_LABEL.fullmatch(Path(response_filename).stem)
        title = candidate.get("title")
        if not isinstance(title, str) or _hash_filename(title) or _GENERIC_DOCUMENT_LABEL.fullmatch(title.strip()) or title.startswith(("http://", "https://")):
            title = (candidate.get("provider_metadata") or {}).get("page_title")
        if not meaningful_disposition and isinstance(title, str) and title and not title.startswith(("http://", "https://")):
            title = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", title).strip(" .")[:80]
            suffix = ".pdf" if content_type == "application/pdf" else Path(filename).suffix
            if title.lower().endswith(suffix.lower()):
                title = title[:-len(suffix)]
            if title:
                filename = title + suffix
    if Path(filename).suffix.lower() in {".md", ".markdown"} or content_type == "text/markdown":
        content = _remove_images(content.decode("utf-8", errors="replace")).encode("utf-8")
        meta["warnings"] = ["文档中的图片引用未自动下载。"]
    return ContentSourceResult(content, filename, content_type or None, meta)
