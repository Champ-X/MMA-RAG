"""Select answer sources from explicit citations, never from retrieval rank."""

import re
from typing import Any, List


_CITATION = re.compile(r"\[(\d+)\]|【(\d+)】|〔(\d+)〕|〖(\d+)〗")


def ordered_citation_ids(answer: str) -> List[str]:
    """Return source numbers used in prose, including legacy Chinese brackets."""
    if not isinstance(answer, str):
        return []
    # Brackets in code and Markdown links/images describe syntax or labels,
    # rather than assertions attributed to a knowledge-base source.
    prose = re.sub(r"```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)", "", answer)
    prose = re.sub(r"`+[^`]*`+|!?\[[^\]]*\]\([^)]*\)|\\\[\d+\]", "", prose)
    return list(dict.fromkeys(
        str(int(next(group for group in match.groups() if group is not None)))
        for match in _CITATION.finditer(prose)
    ))


def select_answer_references(answer: str, references: Any) -> List[Any]:
    """Keep cited records and their original IDs, in first-appearance order.

    This is a structural selection, not a factual or semantic support audit.
    It also repairs old history containing every preloaded retrieval candidate.
    Unnumbered media candidates are not adopted as answer sources implicitly.
    """
    if not isinstance(references, list):
        return []
    by_id = {}
    for reference in references:
        raw_id = reference.get("id") if isinstance(reference, dict) else reference
        if isinstance(raw_id, bool) or not str(raw_id).isdigit():
            continue
        by_id.setdefault(str(int(raw_id)), reference)
    return [by_id[ref_id] for ref_id in ordered_citation_ids(answer) if ref_id in by_id]
