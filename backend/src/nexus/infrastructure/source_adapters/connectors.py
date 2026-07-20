from __future__ import annotations

import base64
import fnmatch
import hashlib
import html
import ipaddress
import mimetypes
import os
import re
import socket
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx

from nexus.modules.sources.application import IngestionResult, IngestionService
from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError

DEFAULT_INCLUDE_GLOBS = (
    "*.md",
    "*.markdown",
    "*.txt",
    "*.pdf",
    "*.doc",
    "*.docx",
    "*.ppt",
    "*.pptx",
    "*.csv",
    "*.xlsx",
    "*.xls",
    "*.xlsm",
    "*.jpg",
    "*.jpeg",
    "*.png",
    "*.webp",
    "*.gif",
    "*.bmp",
    "*.tif",
    "*.tiff",
    "*.wav",
    "*.mp3",
    "*.m4a",
    "*.flac",
    "*.aac",
    "*.ogg",
    "*.wma",
    "*.opus",
    "*.mp4",
    "*.mov",
    "*.mkv",
    "*.webm",
    "*.avi",
    "*.flv",
    "*.wmv",
    "*.m4v",
)

_LOCAL_MARKDOWN_IMAGE_RE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\(\s*(?P<target><[^>]+>|[^\s)]+)"
    r"(?:\s+[\"'][^\"']*[\"'])?\s*\)",
    re.IGNORECASE,
)
_LOCAL_HTML_IMAGE_RE = re.compile(
    r"(?P<prefix><img\b[^>]*?\bsrc\s*=\s*(?P<quote>[\"']))"
    r"(?P<target>.*?)(?P<suffix>(?P=quote)[^>]*>)",
    re.IGNORECASE | re.DOTALL,
)
_LOCAL_MARKDOWN_IMAGE_MAX_BYTES = 10 * 1024 * 1024
_LOCAL_MARKDOWN_IMAGE_MAX_COUNT = 30


class _ReadableHtmlParser(HTMLParser):
    """Small dependency-free HTML to Markdown extractor for connector ingestion."""

    _BLOCKS = {
        "article",
        "aside",
        "blockquote",
        "br",
        "div",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "li",
        "main",
        "p",
        "section",
        "table",
        "tr",
    }

    def __init__(
        self, base_url: str, *, include_links: bool = True, include_images: bool = True
    ) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.include_links = include_links
        self.include_images = include_images
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self._links: list[str] = []
        self._hidden = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "svg", "noscript", "template"}:
            self._hidden += 1
            return
        if self._hidden:
            return
        if tag == "title":
            self._in_title = True
        if tag in self._BLOCKS:
            self.parts.append("\n")
        if tag.startswith("h") and len(tag) == 2 and tag[1].isdigit():
            self.parts.append("#" * min(int(tag[1]), 6) + " ")
        if tag == "li":
            self.parts.append("- ")
        values = dict(attrs)
        if tag == "a" and values.get("href") and self.include_links:
            self.parts.append("[")
            self._links.append(urljoin(self.base_url, values["href"] or ""))
        image_source = self._image_source(values) if tag == "img" else None
        if tag == "img" and image_source and self.include_images:
            alt = (values.get("alt") or "image").strip()
            self.parts.append(f"![{alt}]({urljoin(self.base_url, image_source)})")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "svg", "noscript", "template"}:
            self._hidden = max(0, self._hidden - 1)
            return
        if self._hidden:
            return
        if tag == "title":
            self._in_title = False
        if tag == "a" and self.include_links:
            href = self._links.pop() if self._links else ""
            self.parts.append(f"]({href})" if href else "]")
        if tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._hidden:
            return
        value = " ".join(data.split())
        if not value:
            return
        if self._in_title:
            self.title_parts.append(value)
        self.parts.append(value + " ")

    def markdown(self) -> tuple[str, str]:
        value = html.unescape("".join(self.parts))
        lines = [" ".join(line.split()).strip() for line in value.splitlines()]
        clean = "\n\n".join(line for line in lines if line)
        return clean, " ".join(self.title_parts).strip()

    @staticmethod
    def _image_source(values: dict[str, str | None]) -> str | None:
        source = (values.get("src") or "").strip()
        placeholder = (
            not source
            or source.startswith("data:image/svg")
            or source.startswith("data:image/gif;base64,R0lGODlh")
            or (
                source.lower().endswith((".gif", ".svg"))
                and any(marker in source.lower() for marker in ("blank", "loading", "spacer"))
            )
        )
        if not placeholder:
            return source
        for key in (
            "data-src",
            "data-original",
            "data-lazy-src",
            "data-actualsrc",
            "data-original-src",
            "data-echo",
            "data-srcset",
            "srcset",
        ):
            candidate = (values.get(key) or "").strip()
            if not candidate:
                continue
            # The last srcset candidate is conventionally the highest-resolution asset.
            return candidate.split(",")[-1].strip().split(" ", 1)[0]
        return source or None


@dataclass(frozen=True, slots=True)
class ConnectorItem:
    filename: str
    content: bytes = field(repr=False)
    mime_type: str
    canonical_uri: str
    external_version: str
    metadata: dict[str, object] = field(default_factory=dict)


class BuiltinConnectorService:
    """Bounded first-party connector surface feeding the same Raw-first ingestion path."""

    def __init__(
        self,
        *,
        ingestion: IngestionService,
        allowed_folder_roots: list[Path],
        max_download_bytes: int,
        timeout_seconds: float,
        allow_private_networks: bool = False,
    ) -> None:
        self.ingestion = ingestion
        self.allowed_folder_roots = [root.expanduser().resolve() for root in allowed_folder_roots]
        self.max_download_bytes = max_download_bytes
        self.timeout_seconds = timeout_seconds
        self.allow_private_networks = allow_private_networks

    def sync(
        self,
        *,
        kind: str,
        space_id: str,
        process_inline: bool,
        **parameters: object,
    ) -> list[IngestionResult]:
        if kind == "markdown":
            items = [
                self._markdown(
                    self._optional_text(parameters.get("content")),
                    self._optional_text(parameters.get("title")),
                )
            ]
        elif kind == "url":
            items = [
                self._url(
                    self._required_text(parameters, "url"),
                    self._optional_text(parameters.get("filename")),
                    mode=str(parameters.get("mode") or "auto"),
                    include_links=bool(parameters.get("include_links", True)),
                    include_images=bool(parameters.get("include_images", True)),
                )
            ]
        elif kind == "rss":
            items = self._rss(
                self._required_text(parameters, "feed_url"),
                max_items=int(parameters.get("max_entries") or 20),
            )
        elif kind == "folder":
            items = self._folder(
                self._required_text(parameters, "path"),
                recursive=bool(parameters.get("recursive", True)),
                extensions=self._string_list(parameters.get("extensions")),
                exclude_globs=self._string_list(parameters.get("exclude_globs")),
                max_items=int(parameters.get("max_files") or 500),
            )
        elif kind == "git":
            items = self._git(
                self._required_text(parameters, "repository_url"),
                branch=self._optional_text(parameters.get("branch")),
                subdirectory=self._optional_text(parameters.get("subdirectory")),
                include_globs=self._string_list(parameters.get("include_globs")),
                exclude_globs=self._string_list(parameters.get("exclude_globs")),
                max_items=int(parameters.get("max_files") or 500),
            )
        elif kind == "news":
            items = self._news(
                self._required_text(parameters, "query"),
                topic=str(parameters.get("topic") or "news"),
                time_range=str(parameters.get("time_range") or "week"),
                search_depth=str(parameters.get("search_depth") or "advanced"),
                include_full_content=bool(parameters.get("include_full_content", False)),
                max_items=int(parameters.get("max_results") or 10),
            )
        elif kind == "image_search":
            items = self._image_search(
                self._required_text(parameters, "query"),
                source=str(parameters.get("source") or "google_images"),
                image_type=str(parameters.get("image_type") or "photo"),
                order=str(parameters.get("order") or "relevance"),
                safe_search=bool(parameters.get("safe_search", True)),
                max_items=int(parameters.get("quantity") or 8),
            )
        else:
            raise ValidationError("Unsupported connector kind", details={"kind": kind})
        sync_contract = {"kind": kind, **parameters}
        return [
            self.ingestion.ingest_bytes(
                space_id=space_id,
                filename=item.filename,
                content=item.content,
                mime_type=item.mime_type,
                connector_kind=kind,
                canonical_uri=item.canonical_uri,
                external_version=item.external_version,
                metadata={**item.metadata, "sync_contract": sync_contract},
                idempotency_key=(
                    f"connector:{space_id}:{kind}:{item.canonical_uri}:{item.external_version}"
                ),
                process_inline=process_inline,
            )
            for item in items
        ]

    @staticmethod
    def _optional_text(value: object) -> str | None:
        return value.strip() if isinstance(value, str) and value.strip() else None

    @classmethod
    def _required_text(cls, values: dict[str, object], key: str) -> str:
        value = cls._optional_text(values.get(key))
        if value is None:
            raise ValidationError("Connector parameter is required", details={"parameter": key})
        return value

    @staticmethod
    def _string_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    @staticmethod
    def describe_origin(*, kind: str, parameters: dict[str, object]) -> str | None:
        key = {
            "url": "url",
            "rss": "feed_url",
            "folder": "path",
            "git": "repository_url",
            "news": "query",
            "image_search": "query",
        }.get(kind)
        value = parameters.get(key) if key else parameters.get("title")
        return str(value) if value else None

    @staticmethod
    def _markdown(content: str | None, display_name: str | None) -> ConnectorItem:
        if not content or not content.strip():
            raise ValidationError("Markdown connector content must not be empty")
        data = content.encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        filename = (display_name or "manual-note.md").strip()
        if not filename.lower().endswith((".md", ".markdown")):
            filename += ".md"
        return ConnectorItem(
            filename=Path(filename).name,
            content=data,
            mime_type="text/markdown",
            canonical_uri=f"nexus:markdown:{digest}",
            external_version=digest,
            metadata={"source_type": "inline_markdown"},
        )

    def _url(
        self,
        location: str,
        display_name: str | None,
        *,
        mode: str,
        include_links: bool,
        include_images: bool,
    ) -> ConnectorItem:
        response = self._download(location)
        content_type = response.headers.get("content-type", "application/octet-stream").split(";")[
            0
        ]
        path_name = Path(urlsplit(str(response.url)).path).name
        content = response.content
        source_type = "url_file"
        extractor = None
        is_html = content_type in {"text/html", "application/xhtml+xml"}
        if mode == "webpage" and not is_html:
            raise ValidationError("URL did not return HTML for webpage mode")
        if mode != "file" and is_html:
            parser = _ReadableHtmlParser(
                str(response.url),
                include_links=include_links,
                include_images=include_images,
            )
            parser.feed(response.text)
            markdown, title = parser.markdown()
            if not markdown:
                raise ValidationError("Web page contains no readable content")
            content = (f"Source: {response.url}\n\n{markdown}\n").encode()
            filename = self._safe_markdown_filename(
                display_name or title or path_name or "web page", 0
            )
            content_type = "text/markdown"
            source_type = "webpage"
            extractor = "readable-html-v1"
        else:
            filename = Path(display_name or path_name or "web-source.bin").name
        digest = hashlib.sha256(content).hexdigest()
        return ConnectorItem(
            filename=filename,
            content=content,
            mime_type=content_type,
            canonical_uri=str(response.url),
            external_version=(
                response.headers.get("etag") or response.headers.get("last-modified") or digest
            ),
            metadata={
                "source_type": source_type,
                "status_code": response.status_code,
                "content_hash": digest,
                "extractor": extractor,
                "mode": mode,
                "include_links": include_links,
                "include_images": include_images,
            },
        )

    def _news(
        self,
        query: str,
        *,
        topic: str,
        time_range: str,
        search_depth: str,
        include_full_content: bool,
        max_items: int,
    ) -> list[ConnectorItem]:
        api_key = os.environ.get("TAVILY_API_KEY", "").strip()
        if not api_key:
            raise CapabilityUnavailableError(
                "News search requires TAVILY_API_KEY",
                details={"connector": "news"},
            )
        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "topic": topic,
                "time_range": time_range,
                "search_depth": search_depth,
                "max_results": min(max_items, 20),
                "include_raw_content": include_full_content,
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        items: list[ConnectorItem] = []
        for index, result in enumerate(results[:max_items]):
            if not isinstance(result, dict):
                continue
            title = str(result.get("title") or f"News result {index + 1}")
            fallback_url = f"nexus:news:{hashlib.sha256(title.encode()).hexdigest()}"
            url = str(result.get("url") or fallback_url)
            body_value = (
                (result.get("raw_content") if include_full_content else None)
                or result.get("content")
                or ""
            )
            body = str(body_value).strip()
            markdown = f"# {title}\n\nSource: {url}\n\nQuery: {query}\n\n{body}\n"
            data = markdown.encode("utf-8")
            items.append(
                ConnectorItem(
                    filename=self._safe_markdown_filename(title, index),
                    content=data,
                    mime_type="text/markdown",
                    canonical_uri=url,
                    external_version=hashlib.sha256(data).hexdigest(),
                    metadata={
                        "source_type": "news_search",
                        "query": query,
                        "topic": topic,
                        "time_range": time_range,
                        "search_depth": search_depth,
                    },
                )
            )
        if not items:
            raise ValidationError("News search returned no importable results")
        return items

    def _image_search(
        self,
        query: str,
        *,
        source: str,
        image_type: str,
        order: str,
        safe_search: bool,
        max_items: int,
    ) -> list[ConnectorItem]:
        results = self._image_search_results(
            query,
            source=source,
            image_type=image_type,
            order=order,
            safe_search=safe_search,
            max_items=max_items,
        )
        items: list[ConnectorItem] = []
        for index, result in enumerate(results):
            if len(items) >= min(max_items, 20) or not isinstance(result, dict):
                break
            image_url = str(result.get("image_url") or "").strip()
            if not image_url:
                continue
            try:
                downloaded = self._download(image_url)
            except Exception:
                continue
            content_type = downloaded.headers.get("content-type", "").split(";")[0]
            if not content_type.startswith("image/"):
                continue
            extension = mimetypes.guess_extension(content_type) or ".jpg"
            title = str(result.get("title") or f"{query} {index + 1}")
            data = downloaded.content
            items.append(
                ConnectorItem(
                    filename=f"{Path(self._safe_markdown_filename(title, index)).stem}{extension}",
                    content=data,
                    mime_type=content_type,
                    canonical_uri=str(downloaded.url),
                    external_version=hashlib.sha256(data).hexdigest(),
                    metadata={
                        "source_type": "image_search",
                        "query": query,
                        "search_source": source,
                        "source_page": result.get("source_page"),
                        "license": result.get("license"),
                    },
                )
            )
        if not items:
            raise ValidationError("Image search returned no downloadable public images")
        return items

    def _image_search_results(
        self,
        query: str,
        *,
        source: str,
        image_type: str,
        order: str,
        safe_search: bool,
        max_items: int,
    ) -> list[dict[str, object]]:
        if source == "google_images":
            api_key = os.environ.get("SERPAPI_KEY", "").strip()
            if not api_key:
                raise CapabilityUnavailableError(
                    "Google Images search requires SERPAPI_KEY",
                    details={"connector": "image_search", "source": source},
                )
            response = httpx.get(
                "https://serpapi.com/search.json",
                params={
                    "engine": "google_images",
                    "q": query,
                    "api_key": api_key,
                    "safe": "active" if safe_search else "off",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return [
                {
                    "image_url": item.get("original"),
                    "title": item.get("title"),
                    "source_page": item.get("link"),
                }
                for item in response.json().get("images_results", [])[:max_items]
                if isinstance(item, dict)
            ]
        if source == "pixabay":
            api_key = os.environ.get("PIXABAY_API_KEY", "").strip()
            if not api_key:
                raise CapabilityUnavailableError(
                    "Pixabay search requires PIXABAY_API_KEY",
                    details={"connector": "image_search", "source": source},
                )
            response = httpx.get(
                "https://pixabay.com/api/",
                params={
                    "key": api_key,
                    "q": query,
                    "image_type": image_type if image_type != "all" else "all",
                    "order": order if order in {"popular", "latest"} else "popular",
                    "safesearch": str(safe_search).lower(),
                    "per_page": max(3, min(max_items, 20)),
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return [
                {
                    "image_url": item.get("largeImageURL") or item.get("webformatURL"),
                    "title": item.get("tags") or f"{query} {index + 1}",
                    "source_page": item.get("pageURL"),
                    "license": "Pixabay Content License",
                }
                for index, item in enumerate(response.json().get("hits", [])[:max_items])
                if isinstance(item, dict)
            ]
        if source == "internet_archive":
            sort = "downloads desc" if order == "downloads" else "titleSorter asc"
            response = httpx.get(
                "https://archive.org/advancedsearch.php",
                params={
                    "q": f"({query}) AND mediatype:image",
                    "fl[]": ["identifier", "title"],
                    "sort[]": sort,
                    "rows": min(max_items, 20),
                    "page": 1,
                    "output": "json",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            docs = response.json().get("response", {}).get("docs", [])
            return [
                {
                    "image_url": f"https://archive.org/download/{item.get('identifier')}/__ia_thumb.jpg",
                    "title": item.get("title") or item.get("identifier"),
                    "source_page": f"https://archive.org/details/{item.get('identifier')}",
                    "license": "See Internet Archive item rights",
                }
                for item in docs[:max_items]
                if isinstance(item, dict) and item.get("identifier")
            ]
        raise ValidationError("Unsupported image search source", details={"source": source})

    def _rss(self, location: str, *, max_items: int) -> list[ConnectorItem]:
        response = self._download(location)
        try:
            root = ElementTree.fromstring(response.content)
        except ElementTree.ParseError as exc:
            raise ValidationError("RSS/Atom response is not valid XML") from exc
        entries = [node for node in root.iter() if self._local_name(node.tag) in {"item", "entry"}]
        result: list[ConnectorItem] = []
        for index, entry in enumerate(entries[:max_items]):
            title = self._child_text(entry, "title") or f"Feed entry {index + 1}"
            link = self._entry_link(entry) or f"{location}#entry-{index + 1}"
            body = (
                self._child_text(entry, "content")
                or self._child_text(entry, "description")
                or self._child_text(entry, "summary")
                or ""
            )
            published = (
                self._child_text(entry, "updated")
                or self._child_text(entry, "published")
                or self._child_text(entry, "pubDate")
                or ""
            )
            markdown = f"# {title}\n\nSource: {link}\n\nPublished: {published}\n\n{body}"
            data = markdown.encode("utf-8")
            digest = hashlib.sha256(data).hexdigest()
            result.append(
                ConnectorItem(
                    filename=self._safe_markdown_filename(title, index),
                    content=data,
                    mime_type="text/markdown",
                    canonical_uri=link,
                    external_version=published or digest,
                    metadata={"source_type": "rss", "feed_uri": location},
                )
            )
        if not result:
            raise ValidationError("RSS/Atom feed contains no entries")
        return result

    def _folder(
        self,
        location: str,
        *,
        recursive: bool,
        extensions: list[str],
        exclude_globs: list[str],
        max_items: int,
    ) -> list[ConnectorItem]:
        root = Path(location).expanduser().resolve()
        if not any(
            root == allowed or root.is_relative_to(allowed) for allowed in self.allowed_folder_roots
        ):
            raise ValidationError(
                "Folder path is outside configured connector roots",
                details={"configured_root_count": len(self.allowed_folder_roots)},
            )
        if not root.is_dir():
            raise ValidationError("Folder connector location is not a directory")
        return self._items_from_tree(
            root,
            canonical_prefix=root.as_uri(),
            external_prefix="folder",
            include_globs=self._extension_globs(extensions),
            exclude_globs=exclude_globs,
            max_items=max_items,
            recursive=recursive,
        )

    def _git(
        self,
        location: str,
        *,
        branch: str | None,
        subdirectory: str | None,
        include_globs: list[str],
        exclude_globs: list[str],
        max_items: int,
    ) -> list[ConnectorItem]:
        self.validate_public_url(location, schemes={"https"})
        with tempfile.TemporaryDirectory(prefix="nexus-git-") as temp:
            destination = Path(temp) / "repo"
            environment = {
                **os.environ,
                "GIT_TERMINAL_PROMPT": "0",
                "GIT_CONFIG_NOSYSTEM": "1",
            }
            try:
                clone_command = [
                    "git",
                    "-c",
                    "protocol.file.allow=never",
                    "-c",
                    "http.followRedirects=false",
                    "clone",
                    "--depth=1",
                    "--no-tags",
                    "--filter=blob:none",
                ]
                if branch:
                    clone_command.extend(["--branch", branch, "--single-branch"])
                clone_command.extend(
                    [
                        "--",
                        location,
                        str(destination),
                    ]
                )
                subprocess.run(
                    clone_command,
                    check=True,
                    capture_output=True,
                    timeout=max(30.0, self.timeout_seconds * 3),
                    env=environment,
                )
                revision = subprocess.run(
                    ["git", "-C", str(destination), "rev-parse", "HEAD"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    env=environment,
                ).stdout.strip()
            except (OSError, subprocess.SubprocessError) as exc:
                raise CapabilityUnavailableError(
                    "Git connector could not materialize the repository",
                    details={"error_type": type(exc).__name__},
                ) from exc
            content_root = destination
            if subdirectory:
                relative = Path(subdirectory)
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValidationError("Git subdirectory must be repository-relative")
                content_root = (destination / relative).resolve()
                if (
                    not content_root.is_relative_to(destination.resolve())
                    or not content_root.is_dir()
                ):
                    raise ValidationError("Git subdirectory does not exist")
            return self._items_from_tree(
                content_root,
                canonical_prefix=location.rstrip("/"),
                external_prefix=revision,
                include_globs=include_globs,
                exclude_globs=exclude_globs,
                max_items=max_items,
                ignore_git=True,
            )

    def _items_from_tree(
        self,
        root: Path,
        *,
        canonical_prefix: str,
        external_prefix: str,
        include_globs: list[str],
        exclude_globs: list[str],
        max_items: int,
        recursive: bool = True,
        ignore_git: bool = False,
    ) -> list[ConnectorItem]:
        patterns = tuple(include_globs or DEFAULT_INCLUDE_GLOBS)
        excludes = tuple(exclude_globs)
        items: list[ConnectorItem] = []
        total_bytes = 0
        candidates = root.rglob("*") if recursive else root.glob("*")
        for path in sorted(candidates):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(root).as_posix()
            if ignore_git and relative.startswith(".git/"):
                continue
            if any(
                fnmatch.fnmatch(relative.lower(), pattern.lower())
                or fnmatch.fnmatch(path.name.lower(), pattern.lower())
                for pattern in excludes
            ):
                continue
            if not any(fnmatch.fnmatch(relative.lower(), pattern.lower()) for pattern in patterns):
                continue
            size = path.stat().st_size
            if size > self.max_download_bytes or total_bytes + size > self.max_download_bytes:
                raise ValidationError(
                    "Connector materialization exceeds the configured byte limit",
                    details={"limit": self.max_download_bytes},
                )
            data = path.read_bytes()
            total_bytes += len(data)
            embedded_assets: list[str] = []
            if path.suffix.lower() in {".md", ".markdown"}:
                data, embedded_assets = self._inline_local_markdown_images(
                    root=root,
                    markdown_path=path,
                    content=data,
                )
                if len(data) > self.max_download_bytes:
                    raise ValidationError(
                        "Materialized Markdown exceeds the configured byte limit",
                        details={"path": relative, "limit": self.max_download_bytes},
                    )
            digest = hashlib.sha256(data).hexdigest()
            items.append(
                ConnectorItem(
                    filename=path.name,
                    content=data,
                    mime_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                    canonical_uri=f"{canonical_prefix}#path={relative}",
                    external_version=f"{external_prefix}:{digest}",
                    metadata={
                        "source_type": "git" if ignore_git else "folder",
                        "path": relative,
                        "embedded_assets": embedded_assets,
                    },
                )
            )
            if len(items) >= max_items:
                break
        if not items:
            raise ValidationError("Connector found no files matching the include patterns")
        return items

    @staticmethod
    def _inline_local_markdown_images(
        *,
        root: Path,
        markdown_path: Path,
        content: bytes,
    ) -> tuple[bytes, list[str]]:
        """Bundle safe relative Markdown images into the immutable source version.

        Folder and Git connectors materialize each file independently. Inlining referenced
        sibling images keeps the original Markdown/image relationship intact after the
        temporary tree disappears and also makes an image change produce a new version.
        """

        text: str | None = None
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            return content, []

        root_path = root.resolve()
        replacements: list[tuple[int, int, str, str]] = []
        matches: list[tuple[int, int, str]] = []
        for match in _LOCAL_MARKDOWN_IMAGE_RE.finditer(text):
            matches.append((match.start("target"), match.end("target"), match.group("target")))
        for match in _LOCAL_HTML_IMAGE_RE.finditer(text):
            matches.append((match.start("target"), match.end("target"), match.group("target")))

        for start, end, raw_target in sorted(matches)[:_LOCAL_MARKDOWN_IMAGE_MAX_COUNT]:
            target = raw_target.strip().removeprefix("<").removesuffix(">")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or target.lower().startswith("data:"):
                continue
            relative_path = unquote(parsed.path).replace("\\", "/")
            if not relative_path:
                continue
            candidate = (markdown_path.parent / relative_path).resolve()
            if not candidate.is_relative_to(root_path) or not candidate.is_file():
                continue
            image_data = candidate.read_bytes()
            if not image_data or len(image_data) > _LOCAL_MARKDOWN_IMAGE_MAX_BYTES:
                continue
            content_type = mimetypes.guess_type(candidate.name)[0] or ""
            if not content_type.startswith("image/"):
                continue
            data_uri = f"data:{content_type};base64,{base64.b64encode(image_data).decode('ascii')}"
            asset_path = candidate.relative_to(root_path).as_posix()
            replacements.append((start, end, data_uri, asset_path))

        bundled = text
        for start, end, data_uri, _asset_path in reversed(replacements):
            bundled = f"{bundled[:start]}{data_uri}{bundled[end:]}"
        return bundled.encode("utf-8"), [item[3] for item in replacements]

    @staticmethod
    def _extension_globs(extensions: list[str]) -> list[str]:
        if not extensions:
            return []
        return [
            f"*{value.lower() if value.startswith('.') else f'.{value.lower()}'}"
            for value in extensions
        ]

    def _download(self, initial_url: str) -> httpx.Response:
        headers = {"User-Agent": "MMA-RAG-Nexus/2.0"}
        attempts = 3
        last_url = initial_url
        last_error: httpx.HTTPError | None = None
        with httpx.Client(timeout=self.timeout_seconds, follow_redirects=False) as client:
            for attempt in range(attempts):
                url = initial_url
                for _ in range(6):
                    self.validate_public_url(url, schemes={"http", "https"})
                    last_url = url
                    try:
                        with client.stream("GET", url, headers=headers) as response:
                            if response.status_code in {301, 302, 303, 307, 308}:
                                location = response.headers.get("location")
                                if not location:
                                    raise ValidationError(
                                        "Connector redirect has no Location header"
                                    )
                                url = urljoin(url, location)
                                continue
                            response.raise_for_status()
                            data = bytearray()
                            for chunk in response.iter_bytes():
                                data.extend(chunk)
                                if len(data) > self.max_download_bytes:
                                    raise ValidationError(
                                        "Connector download exceeds the configured byte limit",
                                        details={"limit": self.max_download_bytes},
                                    )

                            # iter_bytes() has already decoded content-encoding. Reusing the
                            # original encoding and length headers would make the detached
                            # response decode the same body a second time (and fail for gzip).
                            response_headers = httpx.Headers(response.headers)
                            for stale_header in (
                                "content-encoding",
                                "content-length",
                                "transfer-encoding",
                            ):
                                response_headers.pop(stale_header, None)
                            return httpx.Response(
                                status_code=response.status_code,
                                headers=response_headers,
                                content=bytes(data),
                                request=response.request,
                            )
                    except httpx.HTTPStatusError as exc:
                        last_error = exc
                        break
                    except httpx.TransportError as exc:
                        last_error = exc
                        break
                else:
                    raise ValidationError("Connector exceeded the redirect limit")
                if attempt + 1 < attempts and self._is_retryable_download_error(last_error):
                    time.sleep(0.25 * (2**attempt))
                    continue
                break

        assert last_error is not None
        status_code = (
            last_error.response.status_code
            if isinstance(last_error, httpx.HTTPStatusError)
            else None
        )
        raise CapabilityUnavailableError(
            "Connector could not download the remote source after bounded retries",
            details={
                "error_type": type(last_error).__name__,
                "hostname": urlsplit(last_url).hostname,
                "attempts": attempts,
                "status_code": status_code,
            },
        ) from last_error

    @staticmethod
    def _is_retryable_download_error(error: httpx.HTTPError | None) -> bool:
        if isinstance(error, httpx.TransportError):
            return True
        return isinstance(error, httpx.HTTPStatusError) and error.response.status_code in {
            408,
            425,
            429,
            500,
            502,
            503,
            504,
        }

    def validate_public_url(self, value: str, *, schemes: set[str]) -> None:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in schemes
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValidationError("Connector URL is not an allowed absolute URL")
        try:
            addresses = {
                item[4][0]
                for item in socket.getaddrinfo(
                    parsed.hostname, parsed.port, type=socket.SOCK_STREAM
                )
            }
        except OSError as exc:
            raise CapabilityUnavailableError(
                "Connector hostname could not be resolved",
                details={"error_type": type(exc).__name__},
            ) from exc
        if not addresses:
            raise ValidationError("Connector hostname did not resolve")
        if self.allow_private_networks:
            return
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if not ip.is_global:
                raise ValidationError(
                    "Connector URL resolves to a non-public network",
                    details={"host": parsed.hostname},
                )

    @staticmethod
    def _local_name(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    @classmethod
    def _child_text(cls, element: ElementTree.Element, name: str) -> str:
        for child in element:
            if cls._local_name(child.tag) == name:
                return "".join(child.itertext()).strip()
        return ""

    @classmethod
    def _entry_link(cls, element: ElementTree.Element) -> str:
        for child in element:
            if cls._local_name(child.tag) != "link":
                continue
            href = child.attrib.get("href")
            if href:
                return href.strip()
            if child.text:
                return child.text.strip()
        return ""

    @staticmethod
    def _safe_markdown_filename(title: str, index: int) -> str:
        safe = "".join(character if character.isalnum() else "-" for character in title)
        safe = "-".join(part for part in safe.split("-") if part)[:120]
        return f"{safe or f'feed-entry-{index + 1}'}.md"


def normalized_url_without_fragment(value: str) -> str:
    """Stable utility used by contract tests and future incremental cursors."""

    parsed = urlsplit(value)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
