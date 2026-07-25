import base64

import httpx
import pytest

from app.modules.ingestion.sources.feishu_document import (
    FeishuDocumentError,
    FeishuDocumentSource,
    is_feishu_document_url,
    parse_feishu_document_url,
)
from app.modules.ingestion.sources.base import ContentSourceResult
from app.modules.ingestion.sources.url import UrlSource
from app.modules.ingestion.sources.webpage_extractor import WebpageExtractionResult


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _text_block(block_id: str, parent_id: str, text: str) -> dict:
    return {
        "block_id": block_id,
        "parent_id": parent_id,
        "block_type": 2,
        "text": {"elements": [{"text_run": {"content": text, "text_element_style": {}}}]},
    }


def _mock_transport(called_paths: list[str]) -> httpx.MockTransport:
    blocks = [
        {
            "block_id": "doc123",
            "block_type": 1,
            "children": ["h1", "p1", "table1", "image1", "board1", "sheet1", "base1"],
            "page": {"elements": []},
        },
        {
            "block_id": "h1",
            "parent_id": "doc123",
            "block_type": 3,
            "heading1": {
                "elements": [{"text_run": {"content": "项目概览", "text_element_style": {}}}]
            },
        },
        _text_block("p1", "doc123", "这是正文"),
        {
            "block_id": "table1",
            "parent_id": "doc123",
            "block_type": 31,
            "children": ["c1", "c2", "c3", "c4"],
            "table": {"property": {"row_size": 2, "column_size": 2}},
        },
        {"block_id": "c1", "parent_id": "table1", "block_type": 32, "children": ["cp1"], "table_cell": {}},
        {"block_id": "c2", "parent_id": "table1", "block_type": 32, "children": ["cp2"], "table_cell": {}},
        {"block_id": "c3", "parent_id": "table1", "block_type": 32, "children": ["cp3"], "table_cell": {}},
        {"block_id": "c4", "parent_id": "table1", "block_type": 32, "children": ["cp4"], "table_cell": {}},
        _text_block("cp1", "c1", "列A"),
        _text_block("cp2", "c2", "列B"),
        _text_block("cp3", "c3", "值1"),
        _text_block("cp4", "c4", "值2"),
        {
            "block_id": "image1",
            "parent_id": "doc123",
            "block_type": 27,
            "image": {"token": "imgToken"},
        },
        {
            "block_id": "board1",
            "parent_id": "doc123",
            "block_type": 43,
            "board": {"token": "boardToken"},
        },
        {
            "block_id": "sheet1",
            "parent_id": "doc123",
            "block_type": 30,
            "sheet": {"token": "sheetToken", "sheet_id": "s1"},
        },
        {
            "block_id": "base1",
            "parent_id": "doc123",
            "block_type": 18,
            "bitable": {"token": "appToken", "table_id": "t1"},
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        called_paths.append(path)
        if path == "/open-apis/docx/v1/documents/doc123":
            return httpx.Response(
                200,
                json={"code": 0, "data": {"document": {"title": "飞书导入测试"}}},
            )
        if path == "/open-apis/docx/v1/documents/doc123/blocks":
            return httpx.Response(
                200,
                json={"code": 0, "data": {"items": blocks, "has_more": False}},
            )
        if path == "/open-apis/drive/v1/medias/imgToken/download":
            return httpx.Response(200, content=PNG_1X1, headers={"content-type": "image/png"})
        if path == "/open-apis/board/v1/whiteboards/boardToken/nodes":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "nodes": [
                            {"id": "n1", "type": "shape", "text": {"text": "流程开始"}},
                            {"id": "n2", "type": "shape", "text": {"text": "流程结束"}},
                        ]
                    },
                },
            )
        if path == "/open-apis/board/v1/whiteboards/boardToken/download_as_image":
            return httpx.Response(200, content=PNG_1X1, headers={"content-type": "image/png"})
        if path == "/open-apis/sheets/v3/spreadsheets/sheetToken/sheets/query":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "sheets": [
                            {
                                "sheet_id": "s1",
                                "title": "数据",
                                "grid_properties": {"row_count": 2, "column_count": 2},
                            }
                        ]
                    },
                },
            )
        if path == "/open-apis/sheets/v2/spreadsheets/sheetToken/values_batch_get":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {"valueRanges": [{"values": [["指标", "数值"], ["收入", 100]]}]},
                },
            )
        if path == "/open-apis/bitable/v1/apps/appToken/tables":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {"items": [{"table_id": "t1", "name": "任务"}]},
                },
            )
        if path == "/open-apis/bitable/v1/apps/appToken/tables/t1/records":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "items": [{"record_id": "r1", "fields": {"名称": "发布", "状态": "完成"}}],
                        "has_more": False,
                    },
                },
            )
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    return httpx.MockTransport(handler)


def test_feishu_url_detection():
    parsed = parse_feishu_document_url("https://acme.feishu.cn/wiki/wikiToken?from=share")

    assert parsed is not None
    assert parsed.path_type == "wiki"
    assert parsed.token == "wikiToken"
    assert is_feishu_document_url("https://acme.larksuite.com/docx/docToken")
    assert not is_feishu_document_url("https://example.com/docx/docToken")


@pytest.mark.asyncio
async def test_fetch_docx_parses_blocks_assets_and_embedded_data():
    called_paths: list[str] = []
    source = FeishuDocumentSource(
        access_token="test-token",
        transport=_mock_transport(called_paths),
        max_assets=10,
    )

    result = await source.fetch_async(
        "https://acme.feishu.cn/docx/doc123",
        image_max_count=10,
    )
    markdown = result.content.decode("utf-8")

    assert result.suggested_filename == "飞书导入测试.md"
    assert "# 项目概览" in markdown
    assert "这是正文" in markdown
    assert "| 列A | 列B |" in markdown
    assert "流程开始" in markdown
    assert "#### 数据" in markdown
    assert "| 收入 | 100 |" in markdown
    assert "#### 任务" in markdown
    assert "| 发布 | 完成 |" in markdown
    assert markdown.count("![") == 2
    assert len(result.meta["asset_map"]) == 2
    assert result.meta["table_count"] == 1
    assert result.meta["whiteboard_count"] == 1
    assert "/open-apis/board/v1/whiteboards/boardToken/nodes" in called_paths


@pytest.mark.asyncio
async def test_wiki_inspection_resolves_obj_token():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/open-apis/wiki/v2/spaces/get_node":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "node": {
                            "obj_token": "doc123",
                            "obj_type": "docx",
                            "title": "Wiki 页面",
                        }
                    },
                },
            )
        raise AssertionError(f"unexpected request: {request.url}")

    source = FeishuDocumentSource(
        access_token="test-token",
        transport=httpx.MockTransport(handler),
    )
    inspection = await source.inspect_async("https://acme.feishu.cn/wiki/wikiToken")

    assert inspection.resource_type == "docx"
    assert inspection.token == "doc123"
    assert inspection.suggested_filename == "Wiki 页面.md"


@pytest.mark.asyncio
async def test_reused_source_restores_per_fetch_asset_limit():
    called_paths: list[str] = []
    source = FeishuDocumentSource(
        access_token="test-token",
        transport=_mock_transport(called_paths),
        max_assets=10,
    )

    first = await source.fetch_async(
        "https://acme.feishu.cn/docx/doc123",
        image_max_count=1,
    )
    second = await source.fetch_async(
        "https://acme.feishu.cn/docx/doc123",
        image_max_count=10,
    )

    assert len(first.meta["asset_map"]) == 1
    assert len(second.meta["asset_map"]) == 2
    assert source.max_assets == 10


class _CountingByteStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]):
        self.chunks = chunks
        self.yielded = 0
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            self.yielded += 1
            yield chunk

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_binary_download_stops_when_stream_exceeds_limit():
    stream = _CountingByteStream([b"1234", b"5678", b"not-read"])

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "image/png"},
            stream=stream,
        )

    source = FeishuDocumentSource(
        access_token="test-token",
        transport=httpx.MockTransport(handler),
    )
    async with httpx.AsyncClient(transport=source.transport) as client:
        with pytest.raises(FeishuDocumentError, match="超过大小限制"):
            await source._download_bytes_limited(
                client,
                "test-token",
                "/drive/v1/medias/large/download",
                action="下载测试素材",
                max_bytes=5,
            )

    assert stream.yielded == 2
    assert stream.closed


@pytest.mark.asyncio
async def test_binary_download_rejects_oversized_content_length_before_reading():
    stream = _CountingByteStream([b"not-read"])

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "image/png", "content-length": "100"},
            stream=stream,
        )

    source = FeishuDocumentSource(
        access_token="test-token",
        transport=httpx.MockTransport(handler),
    )
    async with httpx.AsyncClient(transport=source.transport) as client:
        with pytest.raises(FeishuDocumentError, match="超过大小限制"):
            await source._download_bytes_limited(
                client,
                "test-token",
                "/drive/v1/medias/large/download",
                action="下载测试素材",
                max_bytes=5,
            )

    assert stream.yielded == 0
    assert stream.closed


@pytest.mark.asyncio
async def test_explicit_webpage_mode_does_not_force_feishu_openapi(monkeypatch):
    async def fake_webpage_fast_path(url: str, **_: object) -> WebpageExtractionResult:
        return WebpageExtractionResult(
            markdown="# 公开页面",
            title="公开飞书页面",
            source_url=url,
        )

    async def forbidden_feishu_fetch(*_: object, **__: object):
        raise AssertionError("webpage mode must not call Feishu OpenAPI")

    monkeypatch.setattr(
        "app.modules.ingestion.sources.url.extract_from_github_blob_url",
        fake_webpage_fast_path,
    )
    monkeypatch.setattr(FeishuDocumentSource, "fetch_async", forbidden_feishu_fetch)

    result = await UrlSource().fetch_async(
        "https://acme.feishu.cn/docx/doc123",
        mode="webpage",
    )

    assert result.meta["kind"] == "webpage"
    assert result.suggested_filename == "公开飞书页面.md"


@pytest.mark.asyncio
async def test_auto_mode_keeps_feishu_openapi_fast_path(monkeypatch):
    called: list[str] = []

    async def fake_feishu_fetch(
        _: FeishuDocumentSource,
        url: str,
        **__: object,
    ) -> ContentSourceResult:
        called.append(url)
        return ContentSourceResult(
            content=b"# Block parsed",
            suggested_filename="飞书文档.md",
            content_type="text/markdown",
            meta={"kind": "feishu_document"},
        )

    monkeypatch.setattr(FeishuDocumentSource, "fetch_async", fake_feishu_fetch)

    result = await UrlSource().fetch_async(
        "https://acme.feishu.cn/docx/doc123",
        mode="auto",
    )

    assert called == ["https://acme.feishu.cn/docx/doc123"]
    assert result.meta["kind"] == "feishu_document"
