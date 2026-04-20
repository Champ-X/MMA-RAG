"""
任意网页正文抽取：将 HTML 抽成 Markdown 供知识库入库。

四级管道（按 prefer 控制顺序，默认 auto = local→tavily 兜底）：
1. structured payload（优先消费 JSON-LD / SSR payload，如 __NEXT_DATA__）
2. trafilatura（主抽取器，直接输出 Markdown，支持解析相对链接）
3. readability-lxml + markdownify（本地兜底）
4. Tavily Extract（需 TAVILY_API_KEY，远程兜底，对 JS/反爬页面更稳）

调用方拿到 Markdown bytes 与 `WebpageExtractionResult` 元数据后，
按 .md 文件走现有的 ingestion 管道即可。
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Tuple
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from app.core.config import settings
from app.core.logger import get_logger
from .webpage_structured_payloads import extract_structured_payload

logger = get_logger(__name__)

ExtractorName = Literal["trafilatura", "readability", "tavily", "raw_html", "github_raw", "structured_payload"]
PreferMode = Literal["auto", "local", "tavily"]

# 生成的 Markdown 上限，避免极端长页拖垮后续向量化
MAX_MARKDOWN_CHARS = 2_000_000

# 图片下载默认参数
DEFAULT_IMAGE_MAX_COUNT = 30
DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10MB
DEFAULT_IMAGE_MIN_BYTES = 512  # 过滤 1x1 计数像素 / 极小装饰
DEFAULT_IMAGE_TIMEOUT = 12.0
DEFAULT_IMAGE_CONCURRENCY = 4

# 浏览器 UA，避免对 python-httpx 默认 UA 直接 403
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 MMAA-RAG/1.0"
)

# 写入 asset_map 的统一前缀，与生成的 Markdown 中相对路径保持一致
WEBPAGE_ASSET_DIR = "_assets"
# GitHub raw 单文件与 UrlSource 拉取上限对齐，避免误拉极大对象
MAX_GITHUB_RAW_FILE_BYTES = 100 * 1024 * 1024


@dataclass
class WebpageExtractionResult:
    markdown: str
    title: Optional[str] = None
    site: Optional[str] = None
    author: Optional[str] = None
    published: Optional[str] = None
    extractor: ExtractorName = "trafilatura"
    source_url: Optional[str] = None
    # 网页内图片下载结果：相对 asset 路径 -> 字节，可直接喂给 process_file_upload(asset_map=...)
    asset_map: Dict[str, bytes] = field(default_factory=dict)
    # 实际成功下载并写入 asset_map 的图片数（asset_map 的长度，便于 API 响应展示）
    image_count: int = 0
    extras: dict = field(default_factory=dict)


# ---------- 工具 ----------


_FILENAME_INVALID_RE = re.compile(r'[\\/:*?"<>|\r\n\t]+')
_MULTI_UNDERSCORE_RE = re.compile(r"_+")


def _sanitize_filename_part(text: str, max_len: int = 60) -> str:
    s = (text or "").strip()
    s = _FILENAME_INVALID_RE.sub("_", s)
    s = _MULTI_UNDERSCORE_RE.sub("_", s).strip("_. ")
    return s[:max_len]


def filename_from_title(title: Optional[str], url: str) -> str:
    """优先用网页标题命名（强制 .md），无标题用 host_path-yyyymmdd 兜底。"""
    safe = _sanitize_filename_part(title or "")
    if safe:
        return f"{safe}.md"
    parsed = urlparse(url)
    host = (parsed.hostname or "page").replace(".", "_")
    path_slug = _sanitize_filename_part(parsed.path.replace("/", "_"))
    date_str = datetime.utcnow().strftime("%Y%m%d")
    base = "_".join(p for p in (host, path_slug) if p) or "page"
    return f"{base}-{date_str}.md"


_MD_LINK_RE = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
# Markdown 内嵌 HTML（GitHub README 常用 `<img src="frontend/..." />`，相对仓库根而非当前文件）
_HTML_IMG_SRC_RE = re.compile(
    r'(<img\b[^>]*\bsrc\s*=\s*)(["\'])([^"\']+)\2',
    re.IGNORECASE,
)

# GitHub blob 页面上若仍走 HTML 抽取，正文里图片多为相对仓库根路径；应用 raw 域名根解析
_BINARY_BLOB_SUFFIXES = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff", ".svg",
    ".pdf", ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar",
    ".mp4", ".webm", ".mov", ".mkv", ".avi", ".mp3", ".wav", ".ogg", ".flac",
    ".exe", ".dll", ".so", ".dylib", ".woff", ".woff2", ".ttf", ".eot",
})


def parse_github_blob_url(url: str) -> Optional[Dict[str, str]]:
    """解析 github.com/<owner>/<repo>/blob/<ref>/<path>，返回分段信息。"""
    try:
        parsed = urlparse(url.strip())
        host = (parsed.hostname or "").lower().split(":")[0]
        if host not in ("github.com", "www.github.com"):
            return None
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) < 5:
            return None
        if parts[2].lower() != "blob":
            return None
        owner, repo, ref = parts[0], parts[1], parts[3]
        filepath = "/".join(parts[4:])
        filepath = unquote(filepath)
        return {"owner": owner, "repo": repo, "ref": ref, "path": filepath}
    except Exception:
        return None


def github_raw_repo_root_url(owner: str, repo: str, ref: str) -> str:
    """仓库某 ref 下文件在 raw.githubusercontent.com 上的根 URL（必须以 / 结尾供 urljoin）。"""
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/"


def github_blob_to_raw_file_url(info: Dict[str, str]) -> str:
    """blob 对应单一文件的 raw 直链。"""
    return (
        f"https://raw.githubusercontent.com/"
        f"{info['owner']}/{info['repo']}/{info['ref']}/{info['path']}"
    )


def _github_blob_path_likely_binary(repo_path: str) -> bool:
    suf = Path(repo_path).suffix.lower()
    return suf in _BINARY_BLOB_SUFFIXES


def _looks_like_binary_magic(body: bytes) -> bool:
    """粗判二进制内容（避免把图片/PDF 当 Markdown 解码）。"""
    if len(body) < 12:
        return False
    if body.startswith(b"\x89PNG"):
        return True
    if body.startswith(b"\xff\xd8\xff"):
        return True
    if body.startswith((b"GIF87a", b"GIF89a")):
        return True
    if body.startswith(b"RIFF") and len(body) >= 12 and body[8:12] == b"WEBP":
        return True
    if body.startswith(b"%PDF"):
        return True
    return False


def resolve_relative_assets(markdown: str, base_url: str) -> str:
    """把 Markdown 中相对路径的 [text](href) / ![alt](src) 转成绝对 URL。

    trafilatura 在传入 url 参数时已会做这件事，但 readability/tavily 兜底产物仍可能含相对路径。
    """
    if not markdown or not base_url:
        return markdown

    def _resolve(match: re.Match[str]) -> str:
        bang, alt_text, href = match.group(1), match.group(2), match.group(3).strip()
        if not href or href.startswith(("http://", "https://", "data:", "mailto:", "tel:", "#")):
            return match.group(0)
        try:
            absolute = urljoin(base_url, href)
        except Exception:
            return match.group(0)
        return f"{bang}[{alt_text}]({absolute})"

    return _MD_LINK_RE.sub(_resolve, markdown)


def resolve_relative_html_img_tags(markdown: str, base_url: str) -> str:
    """补全 Markdown 内嵌 HTML ``<img src=\"相对路径\">``（常见于 GitHub README 混排）。"""
    if not markdown or not base_url:
        return markdown

    def _repl(m: re.Match[str]) -> str:
        prefix, quote, src = m.group(1), m.group(2), (m.group(3) or "").strip()
        if not src or src.startswith(("http://", "https://", "data:", "mailto:", "tel:", "#")):
            return m.group(0)
        try:
            absolute = urljoin(base_url, src)
        except Exception:
            return m.group(0)
        return f"{prefix}{quote}{absolute}{quote}"

    return _HTML_IMG_SRC_RE.sub(_repl, markdown)


def resolve_base_url_for_github_or_page(page_url: str) -> str:
    """相对资源解析基准 URL。

    GitHub ``/blob/<ref>/<path>`` 页面上的 README 配图路径多相对 **仓库根**，
    必须用 ``raw.githubusercontent.com/<owner>/<repo>/<ref>/`` 作为基准；其它站点用页面自身 URL。
    """
    info = parse_github_blob_url(page_url)
    if info:
        return github_raw_repo_root_url(info["owner"], info["repo"], info["ref"])
    return page_url


def _truncate_markdown(md: str, limit: int = MAX_MARKDOWN_CHARS) -> str:
    if len(md) <= limit:
        return md
    logger.warning("网页抽取产生 Markdown 超过 {} 字，已截断", limit)
    return md[:limit] + "\n\n<!-- 内容过长，已截断 -->\n"


# ---------- 懒加载规范化 / 图片下载 ----------


_LAZY_SRC_KEYS = (
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-actualsrc",
    "data-original-src",
    "data-echo",
    "data-srcset",
)


def _normalize_lazy_images(html_bytes: bytes) -> bytes:
    """把 <img> 上常见的懒加载属性回写到 src，让抽取器看见真实图片。

    很多站点（CSDN、微信、知乎等）默认 src 是 1x1 占位 / 空字符串，真实地址放在
    data-src / data-original / srcset 等位置。trafilatura、readability 都只看 <img src>，
    不做归一化就会导致正文里图片全部丢失。
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return html_bytes
    try:
        soup = BeautifulSoup(html_bytes, "lxml")
    except Exception as e:
        logger.debug("懒加载归一化解析 HTML 失败: {}", e)
        return html_bytes

    changed = 0
    for img in soup.find_all("img"):
        src = (img.get("src") or "").strip()
        is_placeholder = (
            not src
            or src.startswith("data:image/svg")
            or src.startswith("data:image/gif;base64,R0lGODlh")
            or src.endswith((".gif", ".svg")) and ("blank" in src.lower() or "loading" in src.lower())
        )
        if not is_placeholder:
            continue
        replacement: Optional[str] = None
        for k in _LAZY_SRC_KEYS:
            v = (img.get(k) or "").strip()
            if not v:
                continue
            if k == "data-srcset" or "," in v:
                # srcset：按逗号取最后一项（通常分辨率最高）
                first = v.split(",")[-1].strip().split(" ", 1)[0]
                if first:
                    replacement = first
                    break
            replacement = v
            break
        if replacement is None:
            ss = (img.get("srcset") or "").strip()
            if ss:
                cand = ss.split(",")[-1].strip().split(" ", 1)[0]
                if cand:
                    replacement = cand
        if replacement:
            img["src"] = replacement
            changed += 1

    if changed == 0:
        return html_bytes
    try:
        return str(soup).encode("utf-8")
    except Exception:
        return html_bytes


_EXT_FROM_CT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
}
_KNOWN_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"}


def _ext_from_url(url: str) -> Optional[str]:
    path = urlparse(url).path or ""
    suffix = ("." + path.rsplit(".", 1)[-1].lower()) if "." in path.rsplit("/", 1)[-1] else ""
    if suffix in _KNOWN_IMAGE_EXTS:
        return suffix
    return None


def _ext_for(url: str, content_type: str = "") -> str:
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct in _EXT_FROM_CT:
        return _EXT_FROM_CT[ct]
    return _ext_from_url(url) or ".jpg"


def _build_asset_key(url: str) -> str:
    """对 URL 生成稳定的 asset_map 相对路径键（和 markdown 中的相对引用保持一致）。"""
    digest = hashlib.sha1(url.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return f"{WEBPAGE_ASSET_DIR}/{digest}{_ext_from_url(url) or '.jpg'}"


_MD_IMG_REF_RE = re.compile(r"(!\[[^\]]*\]\(\s*)([^\s)]+)((?:\s+\"[^\"]*\")?\s*\))")
_HTML_IMG_REF_RE = re.compile(r'(<img\b[^>]*\bsrc=["\'])([^"\']+)(["\'][^>]*>)', re.I)


async def _download_one_image(
    url: str,
    *,
    referer: str,
    timeout: float,
    max_bytes: int,
    min_bytes: int,
) -> Optional[Tuple[bytes, str]]:
    try:
        import httpx
    except ImportError:
        return None
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Referer": referer,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers=headers,
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            content = r.content
            ct = r.headers.get("content-type") or ""
    except Exception as e:
        logger.debug("网页图片下载失败 {}: {}", url[:100], e)
        return None
    if len(content) < min_bytes:
        logger.debug("网页图片过小忽略（疑似计数像素） {} ({}B)", url[:100], len(content))
        return None
    if len(content) > max_bytes:
        logger.debug("网页图片超过大小限制 {} ({}B > {}B)", url[:100], len(content), max_bytes)
        return None
    return content, _ext_for(url, ct)


async def download_markdown_images(
    markdown: str,
    *,
    referer: str,
    max_images: int = DEFAULT_IMAGE_MAX_COUNT,
    max_bytes: int = DEFAULT_IMAGE_MAX_BYTES,
    min_bytes: int = DEFAULT_IMAGE_MIN_BYTES,
    timeout: float = DEFAULT_IMAGE_TIMEOUT,
    concurrency: int = DEFAULT_IMAGE_CONCURRENCY,
) -> Tuple[str, Dict[str, bytes]]:
    """并发下载 markdown 中的 http(s) 图片，返回（重写后的 markdown，相对路径->bytes）。

    - 重写后的 Markdown 引用形如 `![](_assets/<sha1[:16]>.jpg)`，
      正好匹配 `process_file_upload(asset_map=...)` 走 Markdown 相对路径解析的 key。
    - 下载失败的图片会被还原为原始 URL，保证不丢链接。
    - data:/相对路径不处理（前者已是内联 base64，后者通常没有可下载源）。
    """
    if not markdown:
        return markdown, {}

    # 1. 收集所有 http(s) 图片，建立 url -> 临时占位 key 的映射
    seen: Dict[str, str] = {}
    refs: List[Tuple[str, str]] = []

    def _maybe_register(url: str) -> Optional[str]:
        url = url.strip()
        if not url.startswith(("http://", "https://")):
            return None
        if url in seen:
            return seen[url]
        if len(seen) >= max_images:
            return None
        key = _build_asset_key(url)
        seen[url] = key
        refs.append((url, key))
        return key

    def _rewrite_md(m: re.Match[str]) -> str:
        new = _maybe_register(m.group(2))
        if new is None:
            return m.group(0)
        return f"{m.group(1)}{new}{m.group(3)}"

    rewritten = _MD_IMG_REF_RE.sub(_rewrite_md, markdown)

    def _rewrite_html(m: re.Match[str]) -> str:
        new = _maybe_register(m.group(2))
        if new is None:
            return m.group(0)
        return f"{m.group(1)}{new}{m.group(3)}"

    rewritten = _HTML_IMG_REF_RE.sub(_rewrite_html, rewritten)

    if not refs:
        return rewritten, {}

    sem = asyncio.Semaphore(max(1, concurrency))
    asset_map: Dict[str, bytes] = {}
    async def _fetch_one(url: str, key: str) -> None:
        async with sem:
            res = await _download_one_image(
                url,
                referer=referer,
                timeout=timeout,
                max_bytes=max_bytes,
                min_bytes=min_bytes,
            )
        if res is None:
            return
        asset_map[key] = res[0]

    await asyncio.gather(*(_fetch_one(u, k) for u, k in refs))

    # 2. 失败的图片把 markdown 中的占位 key 还原为原始 URL，避免下游 404 警告
    failed = [(u, k) for u, k in refs if k not in asset_map]
    if failed:
        for url, key in failed:
            rewritten = rewritten.replace(key, url)
        logger.info(
            "网页图片下载: 共 {} 个 http(s) 图片，成功 {}，失败 {}",
            len(refs),
            len(asset_map),
            len(failed),
        )
    else:
        logger.info("网页图片下载: 共 {} 个，全部成功", len(refs))

    return rewritten, asset_map


# ---------- 三级抽取实现 ----------


def _extract_with_trafilatura(
    html_bytes: bytes,
    url: str,
    *,
    include_links: bool,
    include_images: bool,
) -> Optional[WebpageExtractionResult]:
    try:
        import trafilatura
    except ImportError:
        logger.warning("trafilatura 未安装，跳过本地主抽取器")
        return None

    try:
        text = trafilatura.extract(
            html_bytes,
            output_format="markdown",
            url=url,
            include_links=include_links,
            include_images=include_images,
            include_tables=True,
            favor_recall=True,
            with_metadata=False,
        )
    except Exception as e:
        logger.warning("trafilatura 抽取失败: {}", e)
        return None

    if not text or not text.strip():
        return None

    title = site = author = published = None
    try:
        meta = trafilatura.extract_metadata(html_bytes, default_url=url)
        if meta is not None:
            title = getattr(meta, "title", None) or None
            site = getattr(meta, "sitename", None) or None
            author = getattr(meta, "author", None) or None
            published = getattr(meta, "date", None) or None
    except Exception as e:
        logger.debug("trafilatura.extract_metadata 失败: {}", e)

    return WebpageExtractionResult(
        markdown=text.strip(),
        title=title,
        site=site,
        author=author,
        published=published,
        extractor="trafilatura",
        source_url=url,
    )


def _extract_with_readability(
    html_bytes: bytes,
    url: str,
    *,
    include_links: bool,
    include_images: bool,
) -> Optional[WebpageExtractionResult]:
    try:
        from readability import Document  # readability-lxml
        from markdownify import markdownify as html_to_md
        from bs4 import BeautifulSoup
    except ImportError as e:
        logger.warning("readability/markdownify 未安装，跳过兜底抽取: {}", e)
        return None

    try:
        doc = Document(html_bytes)
        summary_html = doc.summary(html_partial=True)
        title = (doc.short_title() or "").strip() or None
    except Exception as e:
        logger.warning("readability 摘要失败: {}", e)
        return None

    if not summary_html or not summary_html.strip():
        return None

    # 在转 Markdown 前先把 a/img 路径补为绝对 URL，markdownify 不做 base 解析
    try:
        soup = BeautifulSoup(summary_html, "lxml")
        for tag in soup.find_all("a", href=True):
            if not include_links:
                tag.replace_with(tag.get_text(" ", strip=True))
                continue
            tag["href"] = urljoin(url, tag.get("href", "").strip())
        for tag in soup.find_all("img", src=True):
            if not include_images:
                tag.decompose()
                continue
            tag["src"] = urljoin(url, tag.get("src", "").strip())
        normalized_html = str(soup)
    except Exception as e:
        logger.debug("readability 链接补全失败，按原样转 Markdown: {}", e)
        normalized_html = summary_html

    try:
        md_text = html_to_md(
            normalized_html,
            heading_style="ATX",
            strip=["script", "style"],
        )
    except Exception as e:
        logger.warning("markdownify 转换失败: {}", e)
        return None

    if not md_text or not md_text.strip():
        return None

    site = author = published = None
    try:
        full_soup = BeautifulSoup(html_bytes, "lxml")
        if not title:
            t = full_soup.find("title")
            if t and t.text:
                title = t.text.strip() or None
        og_site = full_soup.find("meta", attrs={"property": "og:site_name"})
        if og_site and og_site.get("content"):
            site = og_site["content"].strip() or None
        og_author = full_soup.find("meta", attrs={"name": "author"}) or full_soup.find(
            "meta", attrs={"property": "article:author"}
        )
        if og_author and og_author.get("content"):
            author = og_author["content"].strip() or None
        og_pub = full_soup.find("meta", attrs={"property": "article:published_time"})
        if og_pub and og_pub.get("content"):
            published = og_pub["content"].strip() or None
    except Exception:
        pass

    return WebpageExtractionResult(
        markdown=md_text.strip(),
        title=title,
        site=site,
        author=author,
        published=published,
        extractor="readability",
        source_url=url,
    )


def _get_tavily_text(item: Any) -> str:
    """Tavily Extract 在不同 SDK 版本可能用 markdown / raw_content 字段，做一次兼容。"""
    if isinstance(item, dict):
        for key in ("markdown", "raw_content", "content"):
            v = item.get(key)
            if isinstance(v, str) and v.strip():
                return v
        return ""
    for key in ("markdown", "raw_content", "content"):
        v = getattr(item, key, None)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def _extract_with_tavily(url: str) -> Optional[WebpageExtractionResult]:
    api_key = getattr(settings, "tavily_api_key", None) or ""
    if not api_key.strip():
        logger.info("TAVILY_API_KEY 未配置，跳过 Tavily 兜底抽取")
        return None
    try:
        from tavily import TavilyClient  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("tavily SDK 未安装，跳过 Tavily 兜底抽取")
        return None

    client = TavilyClient(api_key=api_key)
    # 不同版本的 SDK 对 format/extract_depth 接受度不一，做一次降级调用
    response: Any = None
    for kwargs in (
        {"urls": [url], "extract_depth": "advanced", "format": "markdown"},
        {"urls": [url], "extract_depth": "advanced"},
        {"urls": [url]},
    ):
        try:
            response = client.extract(**kwargs)
            break
        except TypeError:
            continue
        except Exception as e:
            logger.warning("Tavily extract 调用失败 ({}): {}", kwargs, e)
            return None

    if response is None:
        return None

    results = (
        getattr(response, "results", None)
        or (response.get("results", []) if isinstance(response, dict) else [])
        or []
    )
    if not results:
        return None
    text = _get_tavily_text(results[0])
    if not text or not text.strip():
        return None

    return WebpageExtractionResult(
        markdown=text.strip(),
        extractor="tavily",
        source_url=url,
    )


# ---------- GitHub blob → raw 快路径 ----------


async def extract_from_github_blob_url(
    original_blob_url: str,
    *,
    include_links: bool = True,
    include_images: bool = True,
    download_images: bool = False,
    image_max_count: int = DEFAULT_IMAGE_MAX_COUNT,
    image_max_bytes: int = DEFAULT_IMAGE_MAX_BYTES,
    image_min_bytes: int = DEFAULT_IMAGE_MIN_BYTES,
    http_timeout: float = 30.0,
    max_raw_bytes: int = MAX_GITHUB_RAW_FILE_BYTES,
) -> Optional[WebpageExtractionResult]:
    """若 URL 为 github.com 的 blob 页面，则优先拉取 raw.githubusercontent.com 正文。

    博客 README 内含 ``![](frontend/...)`` 与 ``<img src=\"docs/...\">``，路径相对仓库根；
    在 HTML 渲染页上抽取常会丢图或解析错基准路径。直接读 raw 文件再按仓库根补全 URL，
    图片可与现有 ``download_markdown_images`` / ingestion 多模态链路对齐。

    若 raw 不可用（404、二进制、过大），返回 None，由调用方回退普通 HTML 抽取。
    """
    info = parse_github_blob_url(original_blob_url)
    if not info:
        return None
    if _github_blob_path_likely_binary(info["path"]):
        logger.debug("GitHub blob 扩展名看似二进制，跳过 raw 快路径: {}", info["path"])
        return None

    raw_url = github_blob_to_raw_file_url(info)
    repo_root = github_raw_repo_root_url(info["owner"], info["repo"], info["ref"])

    try:
        import httpx
    except ImportError:
        return None

    try:
        async with httpx.AsyncClient(
            timeout=http_timeout,
            follow_redirects=True,
            headers={
                "User-Agent": DEFAULT_USER_AGENT,
                "Accept": "text/plain,text/markdown;q=0.9,*/*;q=0.8",
            },
        ) as client:
            r = await client.get(raw_url)
            if r.status_code != 200:
                logger.info(
                    "GitHub raw 请求失败 status={} url={}，回退 HTML 抽取",
                    r.status_code,
                    raw_url[:90],
                )
                return None
            body = r.content
            if len(body) > min(max_raw_bytes, MAX_GITHUB_RAW_FILE_BYTES):
                logger.warning("GitHub raw 文件过大，跳过 raw 快路径")
                return None
            if _looks_like_binary_magic(body):
                logger.debug("GitHub raw 内容疑似二进制，跳过 raw 快路径")
                return None
            ct_main = (r.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if ct_main.startswith(("image/", "video/", "audio/")):
                return None

            text = body.decode("utf-8-sig")
        if not text.strip():
            return None

        title_guess = Path(info["path"]).stem.replace("_", " ").replace("-", " ")
        first_line = text.strip().split("\n", 1)[0].strip()
        if first_line.startswith("#"):
            title_guess = first_line.lstrip("#").strip()[:200] or title_guess

        md = text
        md = resolve_relative_assets(md, repo_root)
        md = resolve_relative_html_img_tags(md, repo_root)

        result = WebpageExtractionResult(
            markdown=md.strip(),
            title=title_guess or None,
            site="GitHub",
            extractor="github_raw",
            source_url=raw_url,
            extras={"github_blob_url": original_blob_url},
        )

        if include_images and download_images:
            try:
                result.markdown, result.asset_map = await download_markdown_images(
                    result.markdown,
                    referer=original_blob_url,
                    max_images=image_max_count,
                    max_bytes=image_max_bytes,
                    min_bytes=image_min_bytes,
                )
            except Exception as e:
                logger.warning("GitHub raw 图片下载失败，跳过：{}", e)
                result.asset_map = {}

        result.image_count = len(result.asset_map)
        result.markdown = _truncate_markdown(result.markdown)
        _ = include_links  # 保留签名兼容；如需剥离链接可在此扩展
        return result
    except UnicodeDecodeError:
        logger.debug("GitHub raw 内容非 UTF-8 文本，回退 HTML 抽取")
        return None
    except Exception as e:
        logger.warning("GitHub raw 快路径异常，回退 HTML 抽取: {}", e)
        return None


# ---------- 对外入口 ----------


async def extract_webpage(
    url: str,
    html_bytes: bytes,
    *,
    include_links: bool = True,
    include_images: bool = True,
    prefer: PreferMode = "auto",
    min_chars: int = 200,
    download_images: bool = False,
    image_max_count: int = DEFAULT_IMAGE_MAX_COUNT,
    image_max_bytes: int = DEFAULT_IMAGE_MAX_BYTES,
    image_min_bytes: int = DEFAULT_IMAGE_MIN_BYTES,
) -> WebpageExtractionResult:
    """异步抽取网页正文，按 prefer 决定本地/远程优先级。

    - auto / local：structured payload → trafilatura → readability → tavily
    - tavily：tavily → structured payload → trafilatura → readability

    若各级都失败，最后退化为整段 raw HTML 文本（防止入库链路彻底中断）。

    当 ``include_images`` 与 ``download_images`` 同时为 True 时，会带上 Referer/UA
    并发下载页面内的图片，把 Markdown 引用改写为 ``_assets/<sha1>.<ext>`` 形式，
    并把字节挂在 ``WebpageExtractionResult.asset_map`` 上供 ingestion 走多模态管道。
    """
    if not html_bytes:
        raise ValueError("HTML 内容为空，无法抽取")

    # 抽取前对懒加载图片做归一化（仅在保留图片时有意义）
    normalized_html = _normalize_lazy_images(html_bytes) if include_images else html_bytes

    def _run_local() -> Optional[WebpageExtractionResult]:
        structured_result = extract_structured_payload(
            normalized_html,
            url,
            include_images=include_images,
        )
        structured_extraction: Optional[WebpageExtractionResult] = None
        if structured_result is not None:
            structured_extraction = WebpageExtractionResult(
                markdown=structured_result.markdown,
                title=structured_result.title,
                site=structured_result.site,
                author=structured_result.author,
                published=structured_result.published,
                extractor="structured_payload",
                source_url=structured_result.source_url or url,
                extras=structured_result.extras or {},
            )
            if len(structured_extraction.markdown) >= min_chars:
                return structured_extraction
        result = _extract_with_trafilatura(
            normalized_html,
            url,
            include_links=include_links,
            include_images=include_images,
        )
        if result and len(result.markdown) >= min_chars:
            return result
        fallback = _extract_with_readability(
            normalized_html,
            url,
            include_links=include_links,
            include_images=include_images,
        )
        if fallback and len(fallback.markdown) >= min_chars:
            return fallback
        return structured_extraction or result or fallback  # 即便短，也好过 None

    def _run_tavily() -> Optional[WebpageExtractionResult]:
        return _extract_with_tavily(url)

    candidates: list[Optional[WebpageExtractionResult]] = []
    if prefer == "tavily":
        candidates.append(await asyncio.to_thread(_run_tavily))
        candidates.append(await asyncio.to_thread(_run_local))
    else:
        candidates.append(await asyncio.to_thread(_run_local))
        if not (candidates[0] and len(candidates[0].markdown) >= min_chars):
            candidates.append(await asyncio.to_thread(_run_tavily))

    chosen: Optional[WebpageExtractionResult] = None
    for c in candidates:
        if c is None:
            continue
        if len(c.markdown) >= min_chars:
            chosen = c
            break
        # 留作最终兜底
        if chosen is None:
            chosen = c

    if chosen is None:
        # 最后兜底：把 HTML 转纯文本，至少避免 502
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(normalized_html, "lxml")
            for tag in soup(["script", "style", "noscript"]):
                tag.decompose()
            text = soup.get_text("\n", strip=True)
        except Exception:
            text = normalized_html.decode("utf-8", errors="ignore")
        if not text.strip():
            raise ValueError("无法从该网页抽取正文（trafilatura/readability/tavily 均失败）")
        chosen = WebpageExtractionResult(
            markdown=text.strip(),
            extractor="raw_html",
            source_url=url,
        )

    _rel_base = resolve_base_url_for_github_or_page(url)
    chosen.markdown = resolve_relative_assets(chosen.markdown, _rel_base)
    chosen.markdown = resolve_relative_html_img_tags(chosen.markdown, _rel_base)

    if include_images and download_images:
        try:
            chosen.markdown, chosen.asset_map = await download_markdown_images(
                chosen.markdown,
                referer=url,
                max_images=image_max_count,
                max_bytes=image_max_bytes,
                min_bytes=image_min_bytes,
            )
        except Exception as e:
            logger.warning("网页图片下载阶段失败，跳过：{}", e)
            chosen.asset_map = {}

    chosen.image_count = len(chosen.asset_map)
    chosen.markdown = _truncate_markdown(chosen.markdown)
    chosen.source_url = chosen.source_url or url
    return chosen
