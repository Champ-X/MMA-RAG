"""Optional, bounded Choice diagnostics with one request per answer.

The caller supplies the shared worker JevClient and the current answer's already
authorized reference map. No retrieval, retries, or paid fallback occurs here.
Usage belongs to the entire batch and is never copied into individual results.
"""
import asyncio
import hashlib
import time

from app.core.llm.jev import JevClient, JevError
from .jev_answer_audit import LEGACY_EXTRACTOR_VERSION, extract_citation_units
from .jev_citations import SUPPORT_THRESHOLD, citation_questions
from .decision_citation_sources import (
    LEGACY_SOURCE_POLICY, SOURCE_POLICY, SOURCE_SCOPE_RULE, prepare_citation_unit,
)


PROMPT_VERSION = 'citation-batch-choice-v5-frozen1-isolated'
TEXT_PROXY_PROMPT_VERSION = 'citation-batch-choice-v7-reference-text-isolated'
# Native Bailian requires a nonempty state. Keep evidence inside each question,
# with no answer-wide background that could leak support between claims. This
# explicit production prompt revision leaves the frozen legacy v5 untouched.
TEXT_PROXY_CONTEXT = 'No shared evidence. Each question contains its own claim and cited sources.'
MAX_BATCH_UNITS = 8


def _prepare_unit(unit, reference_map):
    """Validate one complete evidence set without truncating or borrowing text."""
    data, _, error = prepare_citation_unit(unit, reference_map)
    return data, error


def _build_questions(units):
    # Each question contains only its own claim and sources. The frozen v5
    # shared state stays empty; production adds only a fixed isolation notice.
    questions = {}
    for index, unit in enumerate(units):
        question = citation_questions()['relation']
        if 'source_context' in unit:
            question['instructions'] += SOURCE_SCOPE_RULE
        question['instructions'] = {
            'rule': question['instructions'],
            'claim': unit['claim'],
            'cited_sources': unit['cited_sources'],
        }
        if 'source_context' in unit:
            question['instructions']['source_context'] = unit['source_context']
        questions[f'u{index}'] = question
    return questions


async def audit_answer_batch(client: JevClient, answer, reference_map, *, timeout_s=3.0, max_units=8,
                             extractor_version=LEGACY_EXTRACTOR_VERSION,
                             source_policy=LEGACY_SOURCE_POLICY):
    """Audit eligible units in one bounded request; cancellation propagates.

    Invalid units retain their own deterministic result. Any batch failure leaves
    every otherwise eligible unit unevaluated, with no automatic per-unit retry.
    ``asyncio.wait_for`` cancels and joins the in-flight request on deadline or
    caller cancellation; the shared client retains unknown billing reservations.
    """
    started = time.perf_counter()
    parsed = extract_citation_units(answer, version=extractor_version)
    records, eligible, prepared = [], [], []
    unit_limit = max(0, min(max_units, MAX_BATCH_UNITS))
    for index, unit in enumerate(parsed['units']):
        record = {key: unit[key] for key in ('start', 'end', 'citation_ids')}
        record['claim_sha256'] = hashlib.sha256(unit['claim'].encode()).hexdigest()
        records.append(record)
        if index >= unit_limit:
            record['result'] = {'status': 'not_evaluated', 'reason': 'unit_limit'}
            continue
        data, provenance, error = prepare_citation_unit(unit, reference_map, source_policy=source_policy)
        record.update(provenance)
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
            state = {'context': TEXT_PROXY_CONTEXT} if source_policy == SOURCE_POLICY else {}
            decision = await asyncio.wait_for(
                client.evaluate(state, questions, prompt_version=(TEXT_PROXY_PROMPT_VERSION
                                if source_policy == SOURCE_POLICY else PROMPT_VERSION)),
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
        'extractor_version': extractor_version, 'source_policy': source_policy,
        'duration_s': time.perf_counter() - started,
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
