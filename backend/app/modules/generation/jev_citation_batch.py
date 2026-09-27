"""Optional, bounded Choice diagnostics with one request per answer.

The caller supplies the shared worker JevClient and the current answer's already
authorized reference map. No retrieval, retries, or paid fallback occurs here.
Usage belongs to the entire batch and is never copied into individual results.
"""
import asyncio
import hashlib
import time

from app.core.llm.jev import JevClient, JevError
from .jev_answer_audit import EXTRACTOR_VERSION, extract_citation_units
from .jev_citations import SUPPORT_THRESHOLD, citation_questions


PROMPT_VERSION = 'citation-batch-choice-v5-frozen1-isolated'
MAX_BATCH_UNITS = 8


def _prepare_unit(unit, reference_map):
    """Validate one complete evidence set without truncating or borrowing text."""
    claim = unit['claim']
    ids = unit['citation_ids']
    if not isinstance(claim, str) or not claim.strip() or len(claim) > 4000:
        return None, {'status': 'not_evaluated', 'reason': 'invalid_claim'}
    if not ids or len(ids) > 10 or any(not isinstance(i, str) for i in ids):
        return None, {'status': 'not_evaluated', 'reason': 'invalid_citation_ids'}
    ids = list(dict.fromkeys(ids))
    missing = [i for i in ids if i not in reference_map]
    if missing:
        return None, {'status': 'not_evaluated', 'reason': 'missing_reference',
                      'missing_ids': missing}
    sources = {}
    for ref_id in ids:
        ref = reference_map[ref_id]
        kind = ref.get('content_type') if isinstance(ref, dict) else getattr(ref, 'content_type', None)
        content = ref.get('content') if isinstance(ref, dict) else getattr(ref, 'content', None)
        if kind != 'doc':
            return None, {'status': 'not_evaluated', 'reason': 'non_text_source'}
        if not isinstance(content, str) or not content.strip():
            return None, {'status': 'not_evaluated', 'reason': 'empty_source'}
        sources[ref_id] = content
    if sum(len(content) for content in sources.values()) > 12000:
        return None, {'status': 'not_evaluated', 'reason': 'source_too_large'}
    return {'claim': claim, 'cited_sources': sources}, None


def _build_questions(units):
    # Identical to the frozen v5 isolated candidate. Each question contains only
    # its own claim and sources; the shared state is empty and has no background.
    questions = {}
    for index, unit in enumerate(units):
        question = citation_questions()['relation']
        question['instructions'] = {
            'rule': question['instructions'],
            'claim': unit['claim'],
            'cited_sources': unit['cited_sources'],
        }
        questions[f'u{index}'] = question
    return questions


async def audit_answer_batch(client: JevClient, answer, reference_map, *, timeout_s=3.0, max_units=8):
    """Audit eligible units in one bounded request; cancellation propagates.

    Invalid units retain their own deterministic result. Any batch failure leaves
    every otherwise eligible unit unevaluated, with no automatic per-unit retry.
    ``asyncio.wait_for`` cancels and joins the in-flight request on deadline or
    caller cancellation; the shared client retains unknown billing reservations.
    """
    started = time.perf_counter()
    parsed = extract_citation_units(answer)
    records, eligible, prepared = [], [], []
    unit_limit = max(0, min(max_units, MAX_BATCH_UNITS))
    for index, unit in enumerate(parsed['units']):
        record = {key: unit[key] for key in ('start', 'end', 'citation_ids')}
        record['claim_sha256'] = hashlib.sha256(unit['claim'].encode()).hexdigest()
        records.append(record)
        if index >= unit_limit:
            record['result'] = {'status': 'not_evaluated', 'reason': 'unit_limit'}
            continue
        data, error = _prepare_unit(unit, reference_map)
        if error is not None:
            record['result'] = error
            continue
        prepared.append(data)
        eligible.append(record)

    batch_metadata = None
    if eligible:
        try:
            questions = _build_questions(prepared)
            remaining = max(0.0, timeout_s - (time.perf_counter() - started))
            decision = await asyncio.wait_for(
                client.evaluate({}, questions, prompt_version=PROMPT_VERSION),
                timeout=remaining,
            )
            # JevClient validates the complete response before returning it. Build
            # all results before attaching any, preserving all-or-nothing failure.
            results = []
            for index in range(len(eligible)):
                choice = decision.answers[f'u{index}']
                results.append({
                    'status': 'evaluated', 'answers': {'relation': choice},
                    'choice_support_signal': (
                        choice['choice'] == 'supported'
                        and choice['probabilities']['supported'] >= SUPPORT_THRESHOLD),
                    'diagnostic_only': True,
                })
            batch_metadata = decision.metadata()
            for record, result in zip(eligible, results):
                record['result'] = result
        except JevError as exc:
            reason = str(exc)
        except asyncio.TimeoutError:
            reason = 'answer_deadline'
        except Exception:
            # Never copy provider response bodies or source text into diagnostics.
            reason = 'diagnostic_error'
        else:
            reason = None
        if reason is not None:
            for record in eligible:
                record['result'] = {'status': 'not_evaluated', 'reason': reason}

    evaluated = sum(record['result']['status'] == 'evaluated' for record in records)
    result = {
        'mode': 'shadow', 'diagnostic_only': True, 'strategy': 'batch_choice',
        'extractor_version': EXTRACTOR_VERSION, 'duration_s': time.perf_counter() - started,
        'units': records, 'gaps': parsed['gaps'],
        'coverage': {
            'cited_units': len(records), 'evaluated_units': evaluated,
            'not_evaluated_units': len(records) - evaluated,
            'unattributed_spans': len(parsed['gaps']),
        },
    }
    if batch_metadata is not None:
        result['batch_metadata'] = batch_metadata
    return result
