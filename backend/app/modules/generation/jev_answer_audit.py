"""Bounded, review-only attribution for trailing numeric citations in prose.

This is a syntactic citation unit extractor, not an atomic fact extractor. Rich
Markdown, uncited prose and incomplete coverage remain visible in the result.
"""
import asyncio
import hashlib
import re
import time

from .jev_citations import audit_claim
from .decision_citation_sources import (
    LEGACY_SOURCE_POLICY, SOURCE_POLICY, prepare_citation_unit,
)

LEGACY_EXTRACTOR_VERSION = 'trailing-citations-v2'
EXTRACTOR_VERSION = 'sentence-citations-v3'
GROUP = re.compile(r'\[\d+\](?:[ \t]*(?:[,，、][ \t]*)?\[\d+\])*')
BOUNDARY = re.compile(r'[。！？!?]|\.(?=\s|$)')
LIST_PREFIX = re.compile(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)')
ABBREVIATIONS = {'e.g', 'i.e', 'etc', 'vs', 'no', 'fig', 'eq', 'sec', 'vol',
                 'approx', 'dept', 'inc', 'ltd', 'co', 'corp', 'jr', 'sr', 'st'}
TITLES = {'mr', 'mrs', 'ms', 'dr', 'prof'}


def _mask_syntax(line):
    # Retain offsets while ignoring inline code and Markdown links as citations.
    chars = list(line)
    marker = LIST_PREFIX.match(line)
    if marker:
        # A numbered list's period is not a sentence boundary or uncited prose.
        chars[:marker.end()] = ' ' * marker.end()
    for pattern in [r'`+[^`]*`+', r'!?\[[^\]]*\]\([^)]*\)', r'\\\[\d+\]']:
        for match in re.finditer(pattern, line):
            chars[match.start():match.end()] = ' ' * (match.end()-match.start())
    return ''.join(chars)


def _sentence_boundaries(text):
    """Keep common abbreviations intact; expose uncertain sentence endings.

    An acronym before a capitalized word can also end a sentence (``U.S. It``).
    Treating either interpretation as certain could remove an entity or lend a
    later citation to an earlier sentence, so that candidate remains unaudited.
    """
    certain, ambiguous = [], []
    for match in BOUNDARY.finditer(text):
        if match.group() == '.':
            before = text[:match.start()]
            token_match = re.search(r'([A-Za-z]+(?:\.[A-Za-z]+)*)$', before)
            token = token_match.group(1) if token_match else ''
            if token.lower() in TITLES:
                continue
            if (token.lower() in ABBREVIATIONS
                    or re.fullmatch(r'(?:[A-Za-z]\.)+[A-Za-z]', token)
                    or re.fullmatch(r'[A-Z]', token)):
                following = text[match.end():].lstrip()
                if following and (following[0].islower() or following[0].isdigit()):
                    continue
                ambiguous.append(match)
                continue
        certain.append(match)
    return certain, ambiguous


def _has_terminal_boundary(text):
    text = text.rstrip()
    certain, _ = _sentence_boundaries(text)
    return bool(certain and certain[-1].end() == len(text))


def _extract_legacy_citation_units(answer):
    units, gaps = [], []
    if not isinstance(answer, str) or len(answer) > 16000:
        return {'units': [], 'gaps': [{'reason': 'answer_too_large_or_invalid'}]}
    offset = 0
    fence = None
    for line in answer.splitlines(keepends=True):
        stripped = line.strip()
        opening = re.match(r'^\s*(`{3,}|~{3,})', line)
        if opening:
            token = opening.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            gaps.append({'start': offset, 'end': offset+len(line), 'reason': 'code_fence'})
            offset += len(line); continue
        if fence or re.match(r'^\s*(?:#{1,6}\s|>|\|)', line) or ' | ' in line:
            if stripped:
                gaps.append({'start': offset, 'end': offset+len(line), 'reason': 'unsupported_markdown'})
            offset += len(line); continue
        masked = _mask_syntax(line)
        cursor = 0
        blocked_until_boundary = False
        for match in GROUP.finditer(masked):
            prefix = masked[cursor:match.start()]
            # A citation after terminal punctuation belongs to the preceding
            # sentence. Earlier sentences remain uncited, never inherit it.
            end = len(prefix.rstrip())
            while end and prefix[end-1] in '.。！？!?':
                end -= 1
            boundaries, ambiguous = _sentence_boundaries(prefix[:end])
            start = cursor + (boundaries[-1].end() if boundaries else 0)
            if boundaries:
                blocked_until_boundary = False
            if line[cursor:start].strip(' \t\r\n.。！？!?'):
                gaps.append({'start': offset+cursor, 'end': offset+start, 'reason': 'uncited_prose'})
            if any(cursor + boundary.start() >= start for boundary in ambiguous):
                gaps.append({'start': offset+start, 'end': offset+match.end(),
                             'reason': 'ambiguous_sentence_boundary'})
                blocked_until_boundary = True
                cursor = match.end()
                continue
            suffix = masked[match.end():].lstrip()
            # Mid-sentence citations can precede material qualifiers ("[1] per
            # second"). Do not audit a shortened claim, or its remaining tail
            # under a later citation, until an unambiguous new sentence begins.
            if (blocked_until_boundary
                    or (suffix and not BOUNDARY.match(suffix)
                        and not _has_terminal_boundary(prefix))):
                gaps.append({'start': offset+start, 'end': offset+match.end(),
                             'reason': 'ambiguous_citation_position'})
                blocked_until_boundary = True
                cursor = match.end()
                continue
            raw = line[start:match.start()]
            # Remove only leading list syntax; retain the original span offsets.
            clean = re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)?', '', raw).strip()
            if any(char.isalnum() for char in clean):
                units.append({'start': offset+start, 'end': offset+match.end(), 'claim': clean,
                              'citation_ids': list(dict.fromkeys(re.findall(r'\[(\d+)\]', match.group())))})
            else:
                gaps.append({'start': offset+start, 'end': offset+match.end(), 'reason': 'citation_without_claim'})
            cursor = match.end()
        if line[cursor:].strip(' \t\r\n.。！？!?'):
            gaps.append({'start': offset+cursor, 'end': offset+len(line), 'reason': 'uncited_prose'})
        offset += len(line)
    return {'units': units, 'gaps': gaps}


def _citation_prose_blocks(answer):
    """Keep soft line wraps together so a qualifier cannot become a new claim."""
    pending, start, offset, fence = [], 0, 0, None
    for line in answer.splitlines(keepends=True):
        reason = None
        opening = re.match(r'^\s*(`{3,}|~{3,})', line)
        if opening:
            token = opening.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            reason = 'code_fence'
        elif fence or re.match(r'^\s*(?:#{1,6}\s|>|\|)', line) or ' | ' in line:
            reason = 'unsupported_markdown'
        if reason or not line.strip() or LIST_PREFIX.match(line):
            if pending:
                yield ''.join(pending), start, None
                pending = []
        if reason:
            if line.strip():
                yield line, offset, reason
        elif line.strip():
            if not pending:
                start = offset
            pending.append(line)
        offset += len(line)
    if pending:
        yield ''.join(pending), start, None


def _extract_sentence_citation_units(answer):
    """A single citation group scopes the complete sentence, never half a claim.

    Multiple nonadjacent groups in one sentence have ambiguous attribution and
    remain gaps. Terminal citations after punctuation attach only to the prior
    sentence. Offsets always refer to the original Unicode string.
    """
    if not isinstance(answer, str) or len(answer) > 16000:
        return {'units': [], 'gaps': [{'reason': 'answer_too_large_or_invalid'}]}
    units, gaps = [], []
    for line, offset, block_reason in _citation_prose_blocks(answer):
        if block_reason:
            gaps.append({'start': offset, 'end': offset + len(line), 'reason': block_reason})
            continue
        masked = _mask_syntax(line)
        boundaries, ambiguous = _sentence_boundaries(masked)
        spans, cursor = [], 0
        for boundary in boundaries:
            if boundary.end() <= cursor:
                continue
            end = boundary.end()
            # A citation immediately after terminal punctuation belongs to this
            # sentence, not the following one. Whitespace is kept in offsets.
            following = re.match(r'[ \t\r\n]*', masked[end:]).end() + end
            trailing = GROUP.match(masked, following)
            if trailing:
                end = trailing.end()
            spans.append((cursor, end))
            cursor = end
        if cursor < len(line):
            spans.append((cursor, len(line)))
        for start, end in spans:
            segment = masked[start:end]
            groups = list(GROUP.finditer(segment))
            if not groups:
                if segment.strip(' \t\r\n.。！？!?'):
                    gaps.append({'start': offset + start, 'end': offset + end, 'reason': 'uncited_prose'})
                continue
            reason = None
            if any(start <= boundary.start() < end for boundary in ambiguous):
                reason = 'ambiguous_sentence_boundary'
            elif len(groups) != 1:
                reason = 'ambiguous_citation_position'
            elif '\n' in segment.strip() or '\r' in segment.strip():
                # A line wrap could continue a qualifier, or separate an
                # uncited assertion. Neither half may borrow the other's cite.
                reason = 'ambiguous_line_boundary'
            if reason:
                gaps.append({'start': offset + start, 'end': offset + end, 'reason': reason})
                continue
            group = groups[0]
            original = line[start:end]
            raw = original[:group.start()] + original[group.end():]
            claim = LIST_PREFIX.sub('', raw).strip()
            if not any(char.isalnum() for char in claim):
                gaps.append({'start': offset + start, 'end': offset + end, 'reason': 'citation_without_claim'})
                continue
            units.append({'start': offset + start, 'end': offset + end, 'claim': claim,
                          'citation_ids': list(dict.fromkeys(re.findall(r'\[(\d+)\]', group.group())))})
    return {'units': units, 'gaps': gaps}


def extract_citation_units(answer, *, version=LEGACY_EXTRACTOR_VERSION):
    """Keep frozen evaluation callers reproducible; production opts into v3."""
    if version == LEGACY_EXTRACTOR_VERSION:
        return _extract_legacy_citation_units(answer)
    if version == EXTRACTOR_VERSION:
        return _extract_sentence_citation_units(answer)
    raise ValueError('unknown_citation_extractor_version')


async def audit_answer(client, answer, reference_map, *, timeout_s=3.0, max_units=8,
                       extractor_version=LEGACY_EXTRACTOR_VERSION,
                       source_policy=LEGACY_SOURCE_POLICY):
    """Finish within a total deadline; cancelled network work is always joined."""
    started = time.perf_counter()
    parsed = extract_citation_units(answer, version=extractor_version)
    records = []
    tasks = {}
    for i, unit in enumerate(parsed['units']):
        record = {k: unit[k] for k in ['start', 'end', 'citation_ids']}
        record['claim_sha256'] = hashlib.sha256(unit['claim'].encode()).hexdigest()
        records.append(record)
        if i >= max(0, min(max_units, 8)):
            record['result'] = {'status': 'not_evaluated', 'reason': 'unit_limit'}
            continue
        data, provenance, error = prepare_citation_unit(unit, reference_map, source_policy=source_policy)
        record.update(provenance)
        if error:
            record['result'] = error
            continue
        options = {'source_context': data['source_context']} if 'source_context' in data else {}
        tasks[asyncio.create_task(audit_claim(client, unit['claim'], unit['citation_ids'],
                                            data['cited_sources'], **options))] = record
    try:
        if tasks:
            done, pending = await asyncio.wait(tasks, timeout=max(0, timeout_s-(time.perf_counter()-started)))
            for task in done:
                try:
                    tasks[task]['result'] = task.result()
                except Exception:
                    tasks[task]['result'] = {'status': 'not_evaluated', 'reason': 'diagnostic_error'}
            for task in pending:
                tasks[task]['result'] = {'status': 'not_evaluated', 'reason': 'answer_deadline'}
    finally:
        for task in tasks:
            if not task.done(): task.cancel()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)
    evaluated = sum(r['result']['status']=='evaluated' for r in records)
    return {'mode': 'shadow', 'diagnostic_only': True, 'extractor_version': extractor_version,
            'source_policy': source_policy,
            'duration_s': time.perf_counter()-started, 'units': records, 'gaps': parsed['gaps'],
            'coverage': {'cited_units': len(records), 'evaluated_units': evaluated,
                         'not_evaluated_units': len(records)-evaluated, 'unattributed_spans': len(parsed['gaps'])}}


async def maybe_audit_answer(answer, reference_map):
    from app.core.config import settings
    from app.core.jev_settings import get_jev_config
    config = get_jev_config()
    if config.citation_mode != 'shadow': return None
    from app.core.llm.jev import get_jev_client
    try:
        auditor = audit_answer
        if config.citation_strategy == 'batch_choice':
            from .jev_citation_batch import audit_answer_batch
            auditor = audit_answer_batch
        return await auditor(get_jev_client(), answer, reference_map,
                             timeout_s=settings.jev_timeout_s,
                             extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
    except Exception:
        # Diagnostics must never convert successful generation into a failure.
        # CancelledError is a BaseException and intentionally propagates.
        return {'mode': 'shadow', 'diagnostic_only': True, 'status': 'not_evaluated', 'reason': 'diagnostic_error'}
