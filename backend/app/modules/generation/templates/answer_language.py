"""The answer language is a request preference, independent of source language."""

from app.core.prompt_language import localized


ANSWER_LANGUAGE_ZH = """# 回答语言
默认使用简体中文撰写本轮回答，包括标题、解释、推荐理由和未找到相关内容的说明。
如果用户在本轮问题中明确指定回答语言，优先遵循该要求（包括翻译或双语要求）。仅在问题中提到某种语言不等于要求用该语言回答。
参考材料、附件、检索改写和历史对话的语言不决定本轮回答语言；不要因为中文或英文材料、旧回答而切换语言。
转述或概括来源内容时，将描述、标签和形容性短语译成本轮回答语言，不要把来源语言的描述性片段夹进周围说明。
保留原始文件名、作品名、必要的原文引用、代码和 `[id]` 引用编号；这些原文不影响周围说明所用的回答语言。"""

ANSWER_LANGUAGE_EN = """# Answer language
Write this turn's answer in English by default, including headings, explanations, recommendation reasons and statements that no relevant information was found.
If the user explicitly requests an answer language in the latest question, follow that request instead, including translation or bilingual requests. Merely mentioning a language is not a request to answer in it.
The language of reference materials, attachments, retrieval rewrites and conversation history does not determine this turn's answer language. Do not switch languages because sources or earlier answers are in Chinese or English.
When paraphrasing or summarizing sources, translate descriptions, labels and descriptive phrases into this turn's answer language. Do not mix source-language descriptive fragments into the surrounding explanation.
Preserve original filenames, work titles, necessary verbatim quotations, code and `[id]` citation IDs. These originals do not change the language of the surrounding answer."""


def answer_language_instructions() -> str:
    return localized(ANSWER_LANGUAGE_ZH, ANSWER_LANGUAGE_EN)
