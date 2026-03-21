"""飞书 post/md 规范化与分段。"""

from app.integrations.feishu_md_post import (
    feishu_normalize_markdown_for_post,
    split_feishu_md_chunks,
)


def test_normalize_heading_and_hr():
    s = "## 小节\n\n---\n\n正文"
    out = feishu_normalize_markdown_for_post(s)
    assert "**小节**" in out
    assert "\n --- \n" in out
    assert "正文" in out


def test_normalize_image_http_vs_local():
    s = "![x](https://a.com/z.png) ![y](rel/path.jpg)"
    out = feishu_normalize_markdown_for_post(s)
    assert "[x](https://a.com/z.png)" in out
    assert "（图：y）" in out


def test_split_paragraph_chunks():
    a = "p1\n\n" + ("x" * 100)
    parts = split_feishu_md_chunks(a, max_len=80)
    assert len(parts) >= 2
    assert "p1" in parts[0]
