"""无 # 标题的 MD / CRLF 纯文本分段：供分块前产生合理段落数。"""
import pytest

from app.modules.ingestion.parsers.factory import (
    MarkdownParser,
    TextParser,
    normalize_text_newlines,
)
from app.modules.ingestion.service import IngestionService


def test_normalize_text_newlines_crlf():
    s = "a\r\n\r\nb"
    assert normalize_text_newlines(s) == "a\n\nb"
    assert len(normalize_text_newlines(s).split("\n\n")) == 2


@pytest.mark.asyncio
async def test_text_parser_splits_crlf_paragraphs():
    raw = "第一段\r\n\r\n第二段\r\n\r\n第三段"
    tp = TextParser()
    r = await tp.parse(raw.encode("utf-8"), "x.txt")
    assert len(r["paragraphs"]) == 3


def test_markdown_smart_paragraphs_no_atx_splits_on_single_blank():
    mp = MarkdownParser()
    body = "标题\n\n段落甲\n\n段落乙"
    paras = mp._build_smart_paragraphs(body, [])
    texts = [p["text"] for p in paras]
    assert len(texts) == 3
    assert "段落甲" in texts[1]
    assert "段落乙" in texts[2]


def test_markdown_smart_paragraphs_with_atx_single_blank_stays_grouped():
    """有 # 时保留原逻辑：小节内单空行不强制切段。"""
    mp = MarkdownParser()
    body = "# H\n\n行1\n行2\n\n行3"
    paras = mp._build_smart_paragraphs(body, [{"level": 1, "text": "H"}])
    assert len(paras) >= 1
    joined = "\n".join(p["text"] for p in paras)
    assert "行1" in joined and "行2" in joined


def test_merge_adjacent_chunks_up_to_max_packs_under_limit():
    chunks = [{"text": "a" * 100, "metadata": {}} for _ in range(15)]
    out = IngestionService.merge_adjacent_chunks_up_to_max(chunks, max_chunk_size=350)
    assert len(out) == 5
    assert all(len(c["text"]) <= 350 for c in out)


@pytest.mark.asyncio
async def test_split_policy_doc_not_excessively_fragmented():
    """政策类无 # 的 md：合并后 chunk 数远少于原段落数。"""
    from pathlib import Path

    p = Path(__file__).resolve().parents[2] / "tests" / "chunking" / "2.md"
    if not p.exists():
        pytest.skip("fixture tests/chunking/2.md missing")
    raw = p.read_bytes()
    parse = await MarkdownParser().parse(raw, "2.md")
    assert len(parse["paragraphs"]) > 20
    svc = IngestionService()
    chunks = await svc._split_text_into_chunks(parse)
    assert len(chunks) <= 12
    assert all(len(c["text"]) <= 1600 for c in chunks)
