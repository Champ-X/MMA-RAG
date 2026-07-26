"""推荐问题应围绕内容主题，不暴露上传工具生成的临时文件名。"""

from app.modules.knowledge.suggested_questions import (
    _fallback_questions_from_context,
    _format_file_block,
    _normalize_question_items,
    _readable_file_title,
)


TEMP_IMAGE_NAME = "codex-clipboard-9603ca4f-12d6-4da1-8066-fa9ef8131b54.png"


def test_readable_file_title_hides_temporary_upload_names():
    assert _readable_file_title(TEMP_IMAGE_NAME) == ""
    assert _readable_file_title("Annual_Report_2026.pdf") == "Annual Report 2026"


def test_file_context_omits_temporary_name():
    block = _format_file_block(
        TEMP_IMAGE_NAME,
        {"caption": "根系环绕的种子状结构，内部可见胚芽形态。"},
    )

    assert TEMP_IMAGE_NAME not in block
    assert "上传图片（临时文件名已省略）" in block
    assert "根系环绕的种子状结构" in block


def test_normalization_removes_opaque_file_reference_but_keeps_topic():
    items = _normalize_question_items(
        [
            {
                "text": (
                    f"文件 {TEMP_IMAGE_NAME} 中"
                    "根系环绕的种子状结构内含什么形态？"
                )
            }
        ],
        kb_name="植物图谱",
        max_q=3,
    )

    assert items == [
        {
            "text": "根系环绕的种子状结构内含什么形态？",
            "kb_name": "植物图谱",
        }
    ]


def test_fallback_uses_caption_instead_of_temporary_file_name():
    block = _format_file_block(
        TEMP_IMAGE_NAME,
        {"caption": "根系环绕的种子状结构，内部可见胚芽形态。"},
    )

    questions = _fallback_questions_from_context(["植物图谱"], [], [block], 3)

    assert questions
    assert TEMP_IMAGE_NAME not in questions[0]["text"]
    assert "根系环绕的种子状结构" in questions[0]["text"]
