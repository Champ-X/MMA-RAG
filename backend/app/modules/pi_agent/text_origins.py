"""Recover known ingestion caption markers without rewriting indexed text.

This is a marker-based annotation, not an authorship classifier. In particular,
an index chunk that starts after an opening marker has unknown origin. Scanning
the whole available record before clipping prevents a *tool excerpt* from
losing an opening marker, but cannot recover missing ingestion provenance.
"""

TEXT_ORIGIN_VERSION = 1
CAPTION_MARKER = "[图注："


def document_text_origin(text: str, start: int, length: int) -> dict:
    spans, cursor, end = [], 0, start + length
    while (opening := text.find(CAPTION_MARKER, cursor)) >= 0:
        cursor, depth = opening + len(CAPTION_MARKER), 1
        # Captions can contain bracketed references and span several lines.
        # If the wrapper is incomplete, conservatively keep its available tail
        # marked; do not certify the remaining text as source prose.
        while cursor < len(text) and depth:
            if text[cursor] == "[":
                depth += 1
            elif text[cursor] == "]":
                depth -= 1
            cursor += 1
        lo, hi = max(start, opening), min(end, cursor)
        if lo < hi:
            spans.append({"start": lo - start, "end": hi - start, "closed": depth == 0,
                          "clipped": lo != opening or hi != cursor})
    return {"version": TEXT_ORIGIN_VERSION, "basis": "ingestion_caption_marker",
            "unmarked_text": "unclassified", "generated_spans": spans}
