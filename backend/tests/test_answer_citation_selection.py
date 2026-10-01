"""Answer attribution must not silently adopt retrieval candidates."""

import pytest

from app.modules.generation.citation_selection import ordered_citation_ids, select_answer_references
from app.modules.generation.context_builder import ContextBuilder, ReferenceMap


@pytest.mark.parametrize("answer,expected", [
    ("知识库中未找到相关内容。", []),
    ("相关结论 [3]、[1]；更多证据 [3]。", ["3", "1"]),
    ("老回答【2】〔3〕〖1〗。", ["2", "3", "1"]),
    ("数组 `values[1]`；链接 [2](https://example.test)；正文[3]。", ["3"]),
    ("```python\narray[1]\n```\n正文[2]。", ["2"]),
    ("~~~python\narray[1]\n~~~\n正文[2]。", ["2"]),
    (r"转义 \[1]，正文[2]。", ["2"]),
])
def test_source_numbers_are_taken_from_prose_only(answer, expected):
    assert ordered_citation_ids(answer) == expected


def test_selection_preserves_source_metadata_and_original_numbers():
    refs = [{"id": 1, "debug_info": {"chunk_id": "one"}},
            {"id": 3, "video_url": "https://example.test/video", "start_sec": 4}]
    assert select_answer_references("视频[3]，背景[1]，未知[9]。", refs) == [refs[1], refs[0]]
    assert select_answer_references("没有编号的回答", refs) == []
    assert select_answer_references("没有编号的回答", None) == []


def test_nonstream_validation_uses_same_prose_selection():
    builder = ContextBuilder.__new__(ContextBuilder)
    refs = {"1": ReferenceMap("1", "doc", "one.md", "第一条", {}),
            "2": ReferenceMap("2", "doc", "two.md", "第二条", {})}
    assert builder.validate_references("知识库中未找到相关内容。", refs) == []
    selected = builder.validate_references("代码 `array[1]`；结论【2】。", refs)
    assert [ref["id"] for ref in selected] == [2]
