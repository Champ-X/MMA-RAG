import asyncio
import socket
from io import BytesIO
from types import SimpleNamespace
from datetime import datetime, timezone

import httpx
import pytest
from PIL import Image

from app.modules.collection import providers


def mock_http(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        **kwargs, transport=httpx.MockTransport(handler)))


@pytest.mark.asyncio
async def test_capabilities_and_unconfigured_are_not_empty_search(monkeypatch):
    monkeypatch.delenv("PIXABAY_API_KEY", raising=False)
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    monkeypatch.setattr(providers.settings, "tavily_api_key", None)
    assert providers.capabilities()["pixabay"]["configured"] is False
    assert providers.capabilities()["internet_archive"]["available"] is True
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.discover({"channel": "pixabay", "query": "cat"}, 3)
    assert exc.value.code == "provider_unconfigured"


@pytest.mark.asyncio
async def test_pixabay_preserves_page_and_original_metadata(monkeypatch):
    monkeypatch.setenv("PIXABAY_API_KEY", "private-key")
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"hits": [{
        "id": 12, "tags": "forest", "pageURL": "https://pixabay.com/photos/12", "user": "Artist",
        "largeImageURL": "https://cdn.pixabay.com/photo.jpg", "imageWidth": 4000, "imageHeight": 3000}]}))
    found = await providers.discover({"channel": "pixabay", "query": "forest"}, 3)
    assert found[0]["url"] == "https://pixabay.com/photos/12"
    assert found[0]["download_url"] == "https://cdn.pixabay.com/photo.jpg"
    assert found[0]["author"] == "Artist"
    assert found[0]["provider_metadata"]["imageWidth"] == 4000
    assert "license" not in found[0] and "private-key" not in str(found)


@pytest.mark.asyncio
@pytest.mark.parametrize("status,body,code", [(200, {"hits": []}, "search_empty"),
                                             (403, {}, "provider_blocked"), (500, {}, "search_failed")])
async def test_provider_outcomes_are_typed_and_do_not_leak_keys(monkeypatch, status, body, code):
    monkeypatch.setenv("PIXABAY_API_KEY", "private-key")
    mock_http(monkeypatch, lambda request: httpx.Response(status, json=body))
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.discover({"channel": "pixabay", "query": "forest"}, 3)
    assert exc.value.code == code
    assert "private-key" not in str(exc.value)


@pytest.mark.asyncio
async def test_tavily_keeps_original_source_and_search_constraints(monkeypatch):
    monkeypatch.setattr(providers.settings, "tavily_api_key", "private-key")
    captured = []
    published = datetime.now(timezone.utc).isoformat()
    async def api(method, url, **kwargs):
        captured.append(kwargs["payload"])
        return {"results": [{"title": "News", "url": "https://example.org/story", "content": "Snippet",
                             "published_date": published, "score": 0.8}]}
    monkeypatch.setattr(providers, "_api_json", api)
    found = await providers.discover({"channel": "tavily", "query": "news", "kind": "news",
                                      "domains": ["example.org"], "time_range": "week"}, 2)
    assert captured[0]["topic"] == "news" and captured[0]["time_range"] == "week"
    assert captured[0]["include_domains"] == ["example.org"]
    assert found[0]["published_at"] == published
    assert found[0]["description"] == "Snippet"


@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:127.0.0.1"])
async def test_dns_private_and_mapped_addresses_are_blocked(monkeypatch, address):
    async def lookup(*args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", lookup)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers._resolve_public("https://evil.example/file")
    assert exc.value.code == "download_blocked"


@pytest.mark.asyncio
async def test_download_pins_dns_and_preserves_host_and_tls_sni(monkeypatch):
    async def lookup(*args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", lookup)
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=b"content", headers={"content-type": "text/plain"})
    mock_http(monkeypatch, handler)
    content, final_url, _ = await providers._download("https://source.example/doc.txt", 100)
    assert content == b"content" and final_url == "https://source.example/doc.txt"
    assert requests[0].url.host == "93.184.216.34"
    assert requests[0].headers["host"] == "source.example"
    assert requests[0].extensions["sni_hostname"] == "source.example"


@pytest.mark.asyncio
async def test_redirect_revalidates_target_before_next_request(monkeypatch):
    calls = []
    async def resolve(url):
        calls.append(url)
        if "127.0.0.1" in url:
            raise providers.CollectionProviderError("download_blocked", "blocked")
        return "https://93.184.216.34/a", "public.example", "public.example"
    monkeypatch.setattr(providers, "_resolve_public", resolve)
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(302, headers={"location": "http://127.0.0.1/internal"})
    mock_http(monkeypatch, handler)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers._download("https://public.example/a", 100)
    assert exc.value.code == "download_blocked"
    assert len(calls) == 2 and len(sent) == 1


class Chunks(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"a" * 60
        yield b"b" * 60


@pytest.mark.asyncio
async def test_streamed_download_enforces_limit_without_content_length(monkeypatch):
    async def resolve(url):
        return "https://93.184.216.34/a", "public.example", "public.example"
    monkeypatch.setattr(providers, "_resolve_public", resolve)
    mock_http(monkeypatch, lambda request: httpx.Response(200, stream=Chunks()))
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers._download("https://public.example/a", 100)
    assert exc.value.code == "download_too_large"
    assert exc.value.downloaded_bytes == 120


@pytest.mark.asyncio
async def test_webpage_extraction_keeps_provenance_and_cannot_refetch_images(monkeypatch):
    html = b"<html>" + b"<!-- unused layout -->" * 1000 + b"article</html>"
    async def download(url, size):
        return html, "https://source.example/final", httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    monkeypatch.setattr(providers, "_extract_local", lambda *args: SimpleNamespace(
        markdown='# Article\n![secret](http://127.0.0.1/x)\n![file]\n[file]: file:///private/x\n<img src="http://x">',
        title="Article", author="Author", published="2026-10-29", extractor="test"))
    result = await providers.fetch_candidate({"url": "https://source.example/original", "source": "tavily"}, 1000)
    assert result.meta["source_url"] == "https://source.example/original"
    assert result.meta["final_url"] == "https://source.example/final"
    assert result.meta["author"] == "Author"
    assert b"![" not in result.content and b"<img" not in result.content
    assert result.meta["warnings"]
    assert result.meta["download_bytes"] == len(html)
    assert result.meta["download_bytes"] > len(result.content) * 10


@pytest.mark.asyncio
async def test_image_download_validates_actual_format_and_records_dimensions(monkeypatch):
    buffer = BytesIO()
    Image.new("RGB", (20, 30)).save(buffer, "PNG")
    async def download(url, size):
        return buffer.getvalue(), url, httpx.Headers({"content-type": "application/octet-stream"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.fetch_candidate({"url": "https://example.org/image", "kind": "webpage"}, 1000)
    assert result.suggested_filename.endswith(".png")
    assert result.meta["width"] == 20 and result.meta["height"] == 30
    assert result.content_type == "image/png"
    assert result.meta["kind"] == "image"


def test_archive_lists_are_normalized_without_losing_provider_metadata():
    result = providers._candidate(title="Archive", url="https://archive.org/details/x", source="internet_archive", kind="image",
                                  author=["A", "B"], license=["https://license.example/one"], published_at=["2026-10-29"],
                                  width="4000", height="invalid")
    assert result["author"] == "A; B"
    assert result["published_at"] == "2026-10-29T00:00:00"
    assert result["license"] == "https://license.example/one"
    assert result["width"] == 4000 and "height" not in result


@pytest.mark.asyncio
async def test_domain_filter_checks_returned_url_not_provider_claim(monkeypatch):
    monkeypatch.setattr(providers.settings, "tavily_api_key", "test")
    async def api(*args, **kwargs):
        return {"results": [{"title": "Good", "url": "https://sub.example.org/a"},
                             {"title": "Wrong", "url": "https://example.org.evil.com/a"}]}
    monkeypatch.setattr(providers, "_api_json", api)
    result = await providers.discover({"channel": "tavily", "query": "topic", "domains": ["example.org"]}, 5)
    assert [item["title"] for item in result] == ["Good"]


@pytest.mark.asyncio
async def test_failed_extraction_reports_already_downloaded_bytes(monkeypatch):
    html = b"<html>empty article</html>"
    async def download(url, size):
        return html, url, httpx.Headers({"content-type": "text/html"})
    def extract(*args):
        raise providers.CollectionProviderError("parse_failed", "no article")
    monkeypatch.setattr(providers, "_download", download)
    monkeypatch.setattr(providers, "_extract_local", extract)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.fetch_candidate({"url": "https://example.org/article"}, 1000)
    assert exc.value.downloaded_bytes == len(html)


@pytest.mark.asyncio
async def test_cancelled_download_reports_consumed_bytes(monkeypatch):
    consumed = asyncio.Event()
    class Partial(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"received before cancellation"
            consumed.set()
            await asyncio.Event().wait()
    async def resolve(url):
        return "https://93.184.216.34/a", "public.example", "public.example"
    monkeypatch.setattr(providers, "_resolve_public", resolve)
    mock_http(monkeypatch, lambda request: httpx.Response(200, stream=Partial()))
    task = asyncio.create_task(providers._download("https://public.example/a", 1000))
    await consumed.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError) as exc:
        await task
    assert exc.value.downloaded_bytes == len(b"received before cancellation")


def public_resolution(monkeypatch):
    async def resolve(url):
        if "127.0.0.1" in url or "private.example" in url:
            raise providers.CollectionProviderError("download_blocked", "private destination")
        return "https://93.184.216.34/a", "public.example", "public.example"
    monkeypatch.setattr(providers, "_resolve_public", resolve)


@pytest.mark.asyncio
async def test_open_web_observes_pdf_link_with_origin_and_budget(monkeypatch):
    public_resolution(monkeypatch)
    body = b'<html><title>Exact paper title</title><a href="/files/paper.pdf">Download paper PDF</a></html>'
    calls = []
    async def download(url, size):
        calls.append((url, size))
        return body, url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "kind": "document", "query": "paper PDF",
                                      "seed_urls": ["https://any-public-origin.example/article"], "_remaining_bytes": 5000}, 5)
    assert result[0]["download_url"] == "https://any-public-origin.example/files/paper.pdf"
    assert result[0]["url"] == "https://any-public-origin.example/article"
    assert result[0]["source"] == "open_web" and result[0]["kind"] == "document"
    assert result[0]["_discovery_bytes"] == len(body)
    assert result[0]["provider_metadata"]["origin"] == "any-public-origin.example"
    assert calls == [("https://any-public-origin.example/article", 5000)]


@pytest.mark.asyncio
async def test_open_web_follows_observed_download_page_once(monkeypatch):
    public_resolution(monkeypatch)
    bodies = {"https://example.org/paper": b'<a href="/download">Full text download</a>',
              "https://example.org/download": b'<meta name="citation_pdf_url" content="https://files.other.example/p.pdf">'}
    async def download(url, size):
        return bodies[url], url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "query": "PDF", "kind": "document",
                                      "seed_urls": ["https://example.org/paper"]}, 3)
    assert result[0]["download_url"] == "https://files.other.example/p.pdf"
    assert result[0]["_discovery_bytes"] == sum(map(len, bodies.values()))


@pytest.mark.asyncio
async def test_link_discovery_does_not_follow_third_level_or_invent_assets(monkeypatch):
    public_resolution(monkeypatch)
    visited = []
    async def download(url, size):
        visited.append(url)
        return b'<a href="/deeper/download">Download full text</a>', url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.discover({"channel": "open_web", "kind": "document", "query": "PDF",
                                  "seed_urls": ["https://example.org/paper"]}, 4)
    assert exc.value.code == "search_empty"
    assert visited == ["https://example.org/paper", "https://example.org/deeper/download"]
    assert exc.value.downloaded_bytes > 0


@pytest.mark.asyncio
async def test_resource_links_to_private_hosts_are_not_candidates(monkeypatch):
    public_resolution(monkeypatch)
    body = b'<a href="http://127.0.0.1/private.pdf">Private</a><a href="https://public.example/p.pdf">Paper</a>'
    async def download(url, size):
        return body, url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "query": "PDF", "kind": "document",
                                      "seed_urls": ["https://source.example/paper"]}, 5)
    assert len(result) == 1 and result[0]["download_url"] == "https://public.example/p.pdf"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,html,target", [
    ("image", '<figure><img src="/leaf.png" alt="Green leaf"><figcaption>Leaf veins</figcaption></figure>', "leaf.png"),
    ("audio", '<audio><source src="/sound.mp3" type="audio/mpeg"></audio>', "sound.mp3"),
    ("video", '<video src="/lecture.mp4" title="Recorded lecture"></video>', "lecture.mp4"),
])
async def test_open_web_observes_typed_media_tags(monkeypatch, kind, html, target):
    public_resolution(monkeypatch)
    async def download(url, size):
        return html.encode(), url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "query": "resource", "kind": kind,
                                      "seed_urls": ["https://source.example/page"]}, 5)
    assert result[0]["kind"] == kind and result[0]["download_url"] == f"https://source.example/{target}"
    if kind == "image":
        assert result[0]["description"] == "Green leaf Leaf veins"


@pytest.mark.asyncio
async def test_tavily_can_discover_pdf_on_any_public_search_origin(monkeypatch):
    public_resolution(monkeypatch)
    monkeypatch.setattr(providers.settings, "tavily_api_key", "test")
    async def api(*args, **kwargs):
        return {"results": [{"title": "Independent research", "url": "https://research.anywhere.example/article", "content": "Study"}]}
    async def download(url, size):
        return b'<a href="https://cdn.anywhere.example/study.pdf">Study PDF</a>', url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_api_json", api)
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "tavily", "query": "study pdf", "kind": "document"}, 2)
    assert result[0]["source"] == "tavily"
    assert result[0]["url"] == "https://research.anywhere.example/article"
    assert result[0]["download_url"] == "https://cdn.anywhere.example/study.pdf"


@pytest.mark.asyncio
async def test_discovery_budget_prevents_fetching_next_page(monkeypatch):
    public_resolution(monkeypatch)
    body = b'<a href="/download">download</a>'
    calls = []
    async def download(url, size):
        calls.append(size)
        return body, url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.discover({"channel": "open_web", "kind": "document", "query": "PDF",
                                  "seed_urls": ["https://example.org/page"], "_remaining_bytes": len(body)}, 3)
    assert exc.value.code == "discovery_budget_exhausted"
    assert exc.value.downloaded_bytes == len(body)
    assert calls == [len(body)]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,mime,content", [("document", "application/pdf", b"%PDF-1.7 body"),
                                             ("audio", "audio/mpeg", b"ID3 sound"),
                                             ("video", "video/mp4", b"\x00\x00\x00\x20ftypisom")])
async def test_fetch_resource_keeps_actual_type(monkeypatch, kind, mime, content):
    async def download(url, size):
        return content, url, httpx.Headers({"content-type": mime})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.fetch_candidate({"url": "https://source.example/resource", "kind": kind}, 5000)
    assert result.meta["kind"] == kind and result.meta["download_bytes"] == len(content)


@pytest.mark.asyncio
async def test_expected_file_must_not_be_replaced_by_login_page(monkeypatch):
    async def download(url, size):
        return b"<html>Login required</html>", url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.fetch_candidate({"url": "https://example.org/download", "kind": "document"}, 5000)
    assert exc.value.code == "resource_type_mismatch" and exc.value.downloaded_bytes > 0


@pytest.mark.asyncio
async def test_searched_image_filename_uses_readable_title_but_direct_link_retains_name(monkeypatch):
    buffer = BytesIO()
    Image.new("RGB", (2, 2)).save(buffer, "PNG")
    async def download(url, size):
        return buffer.getvalue(), "https://cdn.example/longhashabcdef.png", httpx.Headers({"content-type": "image/png"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.fetch_candidate({"url": "https://example.org/page", "source": "pixabay", "title": "Green/leaf\nclose up", "kind": "image"}, 1000)
    assert result.suggested_filename == "Green_leaf_close up.png"
    direct = await providers.fetch_candidate({"url": "https://cdn.example/longhashabcdef.png", "source": "url", "title": "ignored"}, 1000)
    assert direct.suggested_filename == "longhashabcdef.png"


@pytest.mark.asyncio
async def test_seed_request_text_is_not_reused_as_source_evidence(monkeypatch):
    public_resolution(monkeypatch)
    async def download(url, size):
        return b'<html><title>Observed topic</title><main>Only source text here.</main></html>', url, httpx.Headers({"content-type": "text/html"})
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "kind": "webpage", "query": "USER CLAIM NOT IN SOURCE",
                                      "seed_urls": ["https://source.example/page"]}, 2)
    assert result[0]["title"] == "Observed topic"
    assert result[0]["description"] == "Only source text here."
    assert "USER CLAIM" not in str(result)


@pytest.mark.asyncio
async def test_discovery_deadline_keeps_partial_bytes_from_last_page(monkeypatch):
    public_resolution(monkeypatch)
    real_timeout = asyncio.timeout
    monkeypatch.setattr(providers.asyncio, "timeout", lambda seconds: real_timeout(0.02))
    first = b'<a href="/download">download</a>'
    async def download(url, size):
        if url.endswith("/start"):
            return first, url, httpx.Headers({"content-type": "text/html"})
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError as error:
            error.downloaded_bytes = 7
            raise
    monkeypatch.setattr(providers, "_download", download)
    with pytest.raises(providers.CollectionProviderError) as exc:
        await providers.discover({"channel": "open_web", "kind": "document", "query": "PDF",
                                  "seed_urls": ["https://example.org/start"]}, 2)
    assert exc.value.code == "provider_timeout"
    assert exc.value.downloaded_bytes == len(first) + 7


@pytest.mark.asyncio
async def test_extensionless_pdf_preserves_observed_paper_identity(monkeypatch):
    public_resolution(monkeypatch)
    page = b'<html><title>Attention Is All You Need</title><a href="/pdf/1706.03762">View PDF</a></html>'
    async def download(url, size):
        if "/abs/" in url:
            return page, url, httpx.Headers({"content-type": "text/html"})
        error = providers.CollectionProviderError("download_too_large", "discovery preview limit")
        error.content_type, error.final_url = "application/pdf", url
        raise error
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.discover({"channel": "open_web", "kind": "document", "query": "获取论文PDF",
                                      "seed_urls": ["https://arxiv.org/abs/1706.03762"]}, 1)
    assert result[0]["title"] == "Attention Is All You Need"
    assert result[0]["url"] == "https://arxiv.org/abs/1706.03762"
    assert result[0]["download_url"] == "https://arxiv.org/pdf/1706.03762"
    assert "Attention Is All You Need" in result[0]["description"]
    assert result[0]["provider_metadata"]["anchor_text"] == "View PDF"
    assert result[0]["_discovery_bytes"] == len(page)


@pytest.mark.asyncio
async def test_generic_document_labels_and_hash_download_names_use_observed_title(monkeypatch):
    page_url = "https://research.example/article"
    hashed = "abcdef1234567890abcdef1234567890-Paper.pdf"
    html = f'<title>Observed Research / Results</title><meta name="citation_pdf_url" content="/{hashed}"><a href="/other.pdf">Paper</a><a href="/appendix.pdf">Appendix A: proofs</a>'.encode()
    candidates, _ = providers._page_links(html, page_url, {"source": "open_web"}, "document")
    assert [item["title"] for item in candidates] == ["Observed Research / Results", "Observed Research / Results", "Appendix A: proofs"]
    headers = {"content-type": "application/pdf"}
    async def download(url, size):
        return b"%PDF-1.7 content", url, httpx.Headers(headers)
    monkeypatch.setattr(providers, "_download", download)
    result = await providers.fetch_candidate(candidates[0], 1000)
    assert result.suggested_filename == "Observed Research _ Results.pdf"
    restored = {**candidates[0], "title": hashed}
    result = await providers.fetch_candidate(restored, 1000)
    assert result.suggested_filename == "Observed Research _ Results.pdf"
    headers["content-disposition"] = 'attachment; filename="Official research report.pdf"'
    result = await providers.fetch_candidate(candidates[0], 1000)
    assert result.suggested_filename == "Official research report.pdf"


@pytest.mark.asyncio
async def test_paper_requirement_upgrades_web_search_and_checks_later_results(monkeypatch):
    public_resolution(monkeypatch)
    monkeypatch.setattr(providers.settings, 'tavily_api_key', 'test')
    async def api(*args, **kwargs):
        return {'results': [
            {'title': 'Search snippet', 'url': f'https://research.example/article/{number}'}
            for number in range(1, 5)]}
    pages = []
    async def download(url, size):
        pages.append(url)
        body = b'<html><title>Index without a file</title></html>'
        if url.endswith('/3'):
            body = b'''<title>Site title</title><meta name="citation_title" content="Actual paper title">
                <meta name="citation_author" content="Author One"><meta name="citation_author" content="Author Two">
                <meta name="citation_date" content="2026/09/22"><meta name="citation_doi" content="10.1234/paper">
                <meta name="citation_pdf_url" content="https://archive.example/pdf/2609.26457">
                <a href="/supplement.pdf">Supplementary PDF</a>'''
        return body, url, httpx.Headers({'content-type': 'text/html'})
    monkeypatch.setattr(providers, '_api_json', api)
    monkeypatch.setattr(providers, '_download', download)
    found = await providers.discover({'channel': 'tavily', 'query': 'agent research', 'kind': 'webpage',
        'required_format': 'pdf', 'material_intent': 'paper'}, 3)
    assert len(found) == 1
    assert found[0]['download_url'] == 'https://archive.example/pdf/2609.26457'
    assert found[0]['kind'] == 'document' and found[0]['required_format'] == 'pdf'
    assert found[0]['material_intent'] == 'paper'
    assert found[0]['title'] == 'Actual paper title'
    assert found[0]['author'] == 'Author One; Author Two'
    assert found[0]['published_at'] == '2026-09-22T00:00:00'
    assert found[0]['provider_metadata']['doi'] == '10.1234/paper'
    assert len(pages) == 4


@pytest.mark.parametrize('markup,target', [
    ('<a href="/pdf?id=paper-identity">Download PDF</a>', 'https://publisher.example/pdf?id=paper-identity'),
    ('<link rel="alternate" type="application/pdf" href="/download?article=1">', 'https://publisher.example/download?article=1'),
    ('<object data="/files/main" type="application/pdf"></object>', 'https://publisher.example/files/main'),
    ('<embed src="/files/main" type="application/pdf">', 'https://publisher.example/files/main'),
    ('<iframe src="/papers/main.pdf"></iframe>', 'https://publisher.example/papers/main.pdf'),
    ('<meta name="bepress_citation_pdf_url" content="/papers/main">', 'https://publisher.example/papers/main'),
    ('<script type="application/ld+json">{"@type":"ScholarlyArticle","encoding":{"@type":"MediaObject","encodingFormat":"application/pdf","contentUrl":"https://cdn.independent.example/paper"}}</script>', 'https://cdn.independent.example/paper'),
])
def test_observed_publisher_pdf_encodings_are_not_limited_to_known_sites(markup, target):
    body = ('<title>A source paper</title>' + markup).encode()
    found, _ = providers._page_links(body, 'https://publisher.example/article', {'source': 'tavily'}, 'document',
        required_format='pdf', material_intent='paper')
    assert len(found) == 1 and found[0]['download_url'] == target
    assert found[0]['url'] == 'https://publisher.example/article'


def test_paper_pdf_metadata_beats_appendices_and_non_pdf_documents():
    body = b'''<title>Research finding</title><a href="/data.docx">Manuscript</a>
        <a href="/supplement.pdf">Supplementary PDF</a><a href="/references.pdf">References PDF</a>
        <meta name="citation_pdf_url" content="/main.pdf">'''
    found, _ = providers._page_links(body, 'https://publisher.example/article', {'source': 'tavily'}, 'document',
        required_format='pdf', material_intent='paper')
    assert [item['download_url'] for item in found] == ['https://publisher.example/main.pdf']


@pytest.mark.asyncio
async def test_pdf_required_never_turns_an_abstract_into_a_document(monkeypatch):
    public_resolution(monkeypatch)
    body = b'<html><title>Interesting paper</title><article>Abstract only</article></html>'
    async def download(url, size):
        return body, url, httpx.Headers({'content-type': 'text/html'})
    monkeypatch.setattr(providers, '_download', download)
    monkeypatch.setattr(providers, '_extract_local', lambda *args: pytest.fail('Must not extract abstract HTML'))
    with pytest.raises(providers.CollectionProviderError) as search:
        await providers.discover({'channel': 'open_web', 'query': 'paper', 'kind': 'document',
            'required_format': 'pdf', 'material_intent': 'paper', 'seed_urls': ['https://publisher.example/article']}, 1)
    assert search.value.code == 'pdf_unavailable' and search.value.downloaded_bytes == len(body)
    with pytest.raises(providers.CollectionProviderError) as fetch:
        await providers.fetch_candidate({'url': 'https://publisher.example/article', 'kind': 'webpage',
            'required_format': 'pdf', 'material_intent': 'paper'}, 2000)
    assert fetch.value.code == 'pdf_unavailable' and fetch.value.downloaded_bytes == len(body)


@pytest.mark.asyncio
async def test_fetch_landing_page_resolves_pdf_and_counts_every_attempt(monkeypatch):
    page = b'''<html><meta name="citation_title" content="Verified / Research">
        <meta name="citation_pdf_url" content="/unavailable.pdf">
        <meta name="citation_pdf_url" content="https://files.example/pdf/2609.26457"></html>'''
    pdf = b'%PDF-1.7\noriginal paper'
    calls = []
    async def download(url, size):
        calls.append((url, size))
        if url.endswith('/article'):
            return page, url, httpx.Headers({'content-type': 'text/html'})
        if url.endswith('/unavailable.pdf'):
            raise providers.CollectionProviderError('download_failed', 'temporary failure', downloaded_bytes=7)
        return pdf, url, httpx.Headers({'content-type': 'application/octet-stream'})
    monkeypatch.setattr(providers, '_download', download)
    result = await providers.fetch_candidate({'url': 'https://publisher.example/article', 'kind': 'webpage',
        'source': 'tavily', 'required_format': 'pdf', 'material_intent': 'paper'}, 2000)
    assert result.content == pdf and result.content_type == 'application/pdf'
    assert result.suggested_filename == 'Verified _ Research.pdf'
    assert result.meta['kind'] == 'document'
    assert result.meta['source_url'] == 'https://publisher.example/article'
    assert result.meta['download_url'] == 'https://files.example/pdf/2609.26457'
    assert result.meta['download_bytes'] == len(page) + 7 + len(pdf)
    assert calls[-1][1] == 2000 - len(page) - 7
    assert result.meta['provider_metadata']['resolution_chain'] == [
        'https://publisher.example/article', 'https://files.example/pdf/2609.26457']


@pytest.mark.asyncio
@pytest.mark.parametrize('content,mime', [(b'not a pdf', 'application/pdf'),
                                         (b'plain text instead of requested PDF', 'text/plain'),
                                         (b'PK\x03\x04an office file', 'application/octet-stream')])
async def test_required_pdf_checks_bytes_not_extension_or_mime(monkeypatch, content, mime):
    async def download(url, size):
        return content, url, httpx.Headers({'content-type': mime})
    monkeypatch.setattr(providers, '_download', download)
    with pytest.raises(providers.CollectionProviderError) as error:
        await providers.fetch_candidate({'url': 'https://publisher.example/main.pdf', 'kind': 'document',
            'required_format': 'pdf'}, 1000)
    assert error.value.code == 'resource_type_mismatch'
    assert error.value.downloaded_bytes == len(content)


@pytest.mark.asyncio
async def test_numeric_arxiv_endpoint_always_gets_pdf_extension(monkeypatch):
    async def download(url, size):
        return b'%PDF-1.7\ncontent', url, httpx.Headers({'content-type': 'application/pdf'})
    monkeypatch.setattr(providers, '_download', download)
    result = await providers.fetch_candidate({'url': 'https://arxiv.org/pdf/2609.26457', 'kind': 'document'}, 1000)
    assert result.suggested_filename == '2609.26457.pdf'
    assert result.meta['kind'] == 'document'


@pytest.mark.asyncio
async def test_pdf_resolution_cancellation_keeps_prior_page_and_file_bytes(monkeypatch):
    page = b'<meta name="citation_pdf_url" content="/main.pdf">'
    async def download(url, size):
        if url.endswith('/article'):
            return page, url, httpx.Headers({'content-type': 'text/html'})
        error = asyncio.CancelledError()
        error.downloaded_bytes = 17
        raise error
    monkeypatch.setattr(providers, '_download', download)
    with pytest.raises(asyncio.CancelledError) as error:
        await providers.fetch_candidate({'url': 'https://publisher.example/article', 'required_format': 'pdf'}, 1000)
    assert error.value.downloaded_bytes == len(page) + 17


def test_paper_fallback_does_not_label_a_reference_pdf_as_current_paper():
    body = b'''<title>The current research paper</title><section id="references">
        <a href="/other-paper.pdf">PDF</a></section><a href="/another-paper.pdf">Another paper title</a>'''
    found, _ = providers._page_links(body, 'https://publisher.example/article', {'source': 'tavily'}, 'document',
        required_format='pdf', material_intent='paper')
    assert found == []
    found, _ = providers._page_links(body + b'<a href="/main.pdf">Download full paper PDF</a>',
        'https://publisher.example/article', {'source': 'tavily'}, 'document',
        required_format='pdf', material_intent='paper')
    assert [item['download_url'] for item in found] == ['https://publisher.example/main.pdf']


@pytest.mark.asyncio
async def test_discovery_timeout_keeps_already_found_pdf_and_consumed_bytes(monkeypatch):
    public_resolution(monkeypatch)
    real_timeout = asyncio.timeout
    monkeypatch.setattr(providers.asyncio, 'timeout', lambda seconds: real_timeout(0.02))
    body = b'<title>Primary paper</title><meta name="citation_pdf_url" content="/main.pdf">'
    async def download(url, size):
        if url.endswith('/first'):
            return body, url, httpx.Headers({'content-type': 'text/html'})
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError as error:
            error.downloaded_bytes = 7
            raise
    monkeypatch.setattr(providers, '_download', download)
    found = await providers.discover({'channel': 'open_web', 'query': 'paper', 'kind': 'document',
        'required_format': 'pdf', 'material_intent': 'paper',
        'seed_urls': ['https://publisher.example/first', 'https://publisher.example/second']}, 3)
    assert found[0]['download_url'] == 'https://publisher.example/main.pdf'
    assert found[0]['_discovery_bytes'] == len(body) + 7
    assert '超时' in found[0]['warnings'][0]


@pytest.mark.asyncio
@pytest.mark.parametrize('stale_response', ['blocked', 'html'])
async def test_stale_pdf_endpoint_reopens_source_once_with_shared_budget(monkeypatch, stale_response):
    landing = b'<title>Current paper</title><meta name="citation_pdf_url" content="/new.pdf">'
    pdf = b'%PDF-1.7\noriginal paper'
    expired_html = b'<html>Expired link</html>'
    requests = []
    async def download(url, size):
        requests.append((url, size))
        if url.endswith('/old.pdf'):
            if stale_response == 'blocked':
                raise providers.CollectionProviderError('download_blocked', 'expired', downloaded_bytes=5)
            return expired_html, url, httpx.Headers({'content-type': 'text/html'})
        if url.endswith('/article'):
            return landing, url, httpx.Headers({'content-type': 'text/html'})
        if url.endswith('/new.pdf'):
            return pdf, url, httpx.Headers({'content-type': 'application/pdf'})
        pytest.fail('Unexpected URL')
    monkeypatch.setattr(providers, '_download', download)
    result = await providers.fetch_candidate({'url': 'https://publisher.example/article',
        'download_url': 'https://publisher.example/old.pdf', 'kind': 'document',
        'required_format': 'pdf', 'material_intent': 'paper'}, 2000)
    first_bytes = 5 if stale_response == 'blocked' else len(expired_html)
    assert result.content == pdf and result.meta['download_url'] == 'https://publisher.example/new.pdf'
    assert result.meta['download_bytes'] == first_bytes + len(landing) + len(pdf)
    assert requests[-1][1] == 2000 - first_bytes - len(landing)
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_failed_source_recovery_preserves_both_download_receipts(monkeypatch):
    async def download(url, size):
        raise providers.CollectionProviderError('download_blocked', 'blocked', downloaded_bytes=5)
    monkeypatch.setattr(providers, '_download', download)
    with pytest.raises(providers.CollectionProviderError) as error:
        await providers.fetch_candidate({'url': 'https://publisher.example/article',
            'download_url': 'https://publisher.example/old.pdf', 'kind': 'document', 'required_format': 'pdf'}, 2000)
    assert error.value.code == 'download_blocked' and error.value.downloaded_bytes == 10


def test_pdf_follow_links_exclude_unrelated_email_and_audio_navigation():
    body = b'<title>Paper</title><a href="/show-email/1">view email</a><a href="/audio/1">Audio Summary</a><a href="/download/1">Full text</a>'
    _, follow = providers._page_links(body, 'https://publisher.example/article', {}, 'document', required_format='pdf', material_intent='paper')
    assert [item['url'] for item in follow] == ['https://publisher.example/download/1']
