import json

from app.integrations.feishu_parser import extract_text


def test_extract_text_plain():
    c = json.dumps({"text": "  hello world  "})
    assert extract_text(message_type="text", content=c) == "hello world"


def test_extract_text_strip_at_placeholder():
    c = json.dumps({"text": "@_user_1 你好"})
    assert extract_text(message_type="text", content=c) == "你好"


def test_extract_post():
    c = json.dumps(
        {
            "zh_cn": {
                "title": "t",
                "content": [[[{"tag": "text", "text": "段落A"}], [{"tag": "text", "text": "段落B"}]]],
            }
        }
    )
    t = extract_text(message_type="post", content=c)
    assert "段落A" in (t or "")
    assert "段落B" in (t or "")
