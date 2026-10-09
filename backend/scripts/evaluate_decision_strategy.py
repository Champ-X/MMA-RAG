"""Frozen old/new native Decision intent comparison; no generative/RAG claims.

Run without --live to verify the frozen protocol and input hashes without calls.
Live results go to a new directory. Failures are retained, never retried/refilled.
"""
import argparse
import asyncio
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def load_protocol(path):
    from app.modules.retrieval.processors import jev_intent
    protocol = json.loads(path.read_text())
    folder = path.parent
    cases_path = folder / protocol['cases_file']
    assert digest(cases_path.read_bytes()) == protocol['cases_sha256'], 'Case labels changed'
    cases = json.loads(cases_path.read_text())['cases']
    assert len({case['id'] for case in cases}) == len(cases)
    questions = {}
    for policy in ('old', 'new'):
        question_path = folder / protocol[policy]['questions_file']
        assert digest(question_path.read_bytes()) == protocol[policy]['questions_sha256'], 'Frozen questions changed'
        questions[policy] = json.loads(question_path.read_text())
    assert questions['new'] == jev_intent.intent_questions(), 'Live prompt no longer matches the frozen candidate'
    assert digest((ROOT / protocol['new']['source_path']).read_bytes()) == protocol['new']['source_sha256'], 'Candidate code changed; create a new protocol'
    assert protocol['new']['positive_signal'] == jev_intent.POSITIVE_SIGNAL
    assert protocol['new']['negative_signal'] == jev_intent.NEGATIVE_SIGNAL
    assert protocol['new']['selected_probability_min'] == jev_intent.MIN_SELECTED_PROBABILITY
    assert protocol['transport']['concurrency'] == 1 and protocol['transport']['retries'] == 0
    return protocol, cases, questions


def old_policy(answers, frozen):
    fields = ['intent_type', 'visual_intent', 'audio_intent', 'video_intent']
    selected = {field: answers[field]['choice'] for field in fields}
    complete = (min(answers[field]['probabilities'][selected[field]] for field in fields)
                >= frozen['selected_probability_min']
                and answers['is_complex']['noul'] <= frozen['complexity_max']
                and answers['needs_context']['noul'] <= frozen['context_max'])
    required = [modality for modality, field in (
        ('image', 'visual_intent'), ('audio', 'audio_intent'), ('video', 'video_intent'))
        if selected[field] == 'explicit_demand']
    return {'complete': complete, 'required': required, 'forbidden': None,
            'partial_required_eligible': [], 'conflicts': [],
            'planning_handoff': not complete,
            'strict_would_adopt': True, 'requirements': None}


def new_policy(info):
    requirements = info['requirements']
    modalities = requirements['modalities']
    required = [key for key, record in modalities.items() if record['status'] == 'required']
    forbidden = [key for key, record in modalities.items() if record['status'] == 'forbidden']
    partial = required if (not info['accepted'] and requirements['planning']['context_signal']
                           <= info['thresholds']['negative']) else []
    return {'complete': info['accepted'], 'required': required, 'forbidden': forbidden,
            'partial_required_eligible': partial,
            'conflicts': [key for key, record in modalities.items() if record['status'] == 'conflict'],
            'planning_handoff': not info['accepted'],
            'strict_would_adopt': info['accepted'], 'requirements': requirements}


def grade(case, policy):
    required = set(policy['required'])
    forbidden = set(policy['forbidden'] or [])
    expected = set(case['required'])
    extra = required & set(case['must_not_require'])
    missing = expected - required
    wrong_exclusions = forbidden - set(case['forbidden'])
    needs_planning = case['expected_planning'] != 'simple'
    content_correct = not (missing or extra or wrong_exclusions)
    return {
        'required_true_positive': sorted(required & expected),
        'required_missed_raw': sorted(missing),
        'required_unexpected_raw': sorted(extra),
        'forbidden_detected': sorted(forbidden & set(case['forbidden'])),
        'forbidden_unexpected_raw': sorted(wrong_exclusions),
        'complete_correct': bool(content_correct and not needs_planning) if policy['complete'] else None,
        'strict_correct': bool(content_correct and not needs_planning) if policy['strict_would_adopt'] else None,
        'missed_required_when_adopted': sorted(missing) if policy['complete'] else [],
        'incorrect_required_when_adopted': sorted(extra) if policy['complete'] else [],
        'incorrect_exclusions_when_adopted': sorted(wrong_exclusions) if policy['complete'] else [],
        'unsafe_complex_adoption': bool(policy['complete'] and needs_planning),
        'required_eligible_for_partial': sorted(set(policy['partial_required_eligible']) & expected),
        'unexpected_partial_required': sorted(set(policy['partial_required_eligible']) & set(case['must_not_require'])),
    }


def percentile(values, p):
    values = sorted(values)
    if not values:
        return None
    index = (len(values) - 1) * p
    lo = int(index)
    return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (index - lo)


def summarize(rows, cases, protocol_hash):
    gold = {case['id']: case for case in cases}
    groups = {}
    for key in sorted({(row['provider'], row['model'], row['policy']) for row in rows}):
        subset = [row for row in rows if (row['provider'], row['model'], row['policy']) == key]
        successful = [row for row in subset if row['status'] == 'success']
        count = Counter()
        missing_cases, incorrect_cases, partial_cases = [], [], []
        for row in successful:
            policy, score, case = row['decision'], row['grade'], gold[row['case_id']]
            count['complete_adoption'] += policy['complete']
            count['correct_complete_adoption'] += score['complete_correct'] is True
            count['unsafe_complete_adoption'] += score['complete_correct'] is False
            count['abstention'] += not policy['complete']
            count['strict_adoption'] += policy['strict_would_adopt']
            count['unsafe_strict_adoption'] += score['strict_correct'] is False
            count['planning_handoff'] += policy['planning_handoff']
            count['unsafe_complex_adoption'] += score['unsafe_complex_adoption']
            count['partial_eligible_cases'] += bool(policy['partial_required_eligible'])
            count['correct_partial_required_fields'] += len(score['required_eligible_for_partial'])
            count['incorrect_partial_required_fields'] += len(score['unexpected_partial_required'])
            count['conflict_cases'] += bool(policy['conflicts'])
            count['missed_required_when_adopted'] += len(score['missed_required_when_adopted'])
            count['incorrect_required_when_adopted'] += len(score['incorrect_required_when_adopted'])
            count['incorrect_exclusions_when_adopted'] += len(score['incorrect_exclusions_when_adopted'])
            count['required_true_positive'] += len(score['required_true_positive'])
            count['required_missed_raw'] += len(score['required_missed_raw'])
            count['required_unexpected_raw'] += len(score['required_unexpected_raw'])
            count['required_gold_fields_successes'] += len(case['required'])
            count['forbidden_gold_fields_successes'] += len(case['forbidden'])
            count['forbidden_detected'] += len(score['forbidden_detected'])
            count['forbidden_unexpected_raw'] += len(score['forbidden_unexpected_raw'])
            if policy['requirements'] is not None:
                state = policy['requirements']['planning']['grounding_state']
                count['grounding_abstention'] += state == 'uncertain'
                count['grounding_correct'] += (state == 'positive' and case['grounding_required']) or (
                    state == 'negative' and not case['grounding_required'])
                count['grounding_incorrect'] += (state == 'negative' and case['grounding_required']) or (
                    state == 'positive' and not case['grounding_required'])
            if score['required_missed_raw']:
                missing_cases.append({'id': row['case_id'], 'modalities': score['required_missed_raw']})
            if score['complete_correct'] is False:
                incorrect_cases.append(row['case_id'])
            if policy['partial_required_eligible']:
                partial_cases.append({'id': row['case_id'], 'modalities': policy['partial_required_eligible']})
        tp, fp, total = count['required_true_positive'], count['required_unexpected_raw'], count['required_gold_fields_successes']
        groups['/'.join(key)] = {
            'attempts': len(subset), 'successes': len(successful), 'failures': len(subset) - len(successful),
            'failure_reasons': dict(Counter(row['error'] for row in subset if row['status'] == 'failure')),
            'counts': dict(count),
            'raw_required_precision': tp / (tp + fp) if tp + fp else None,
            'raw_required_recall': tp / total if total else None,
            'explicit_exclusion_supported': key[2] == 'new',
            'success_duration_p50_s': statistics.median([row['duration_s'] for row in successful]) if successful else None,
            'success_duration_p95_s': percentile([row['duration_s'] for row in successful], .95),
            'all_attempt_duration_p50_s': statistics.median([row['duration_s'] for row in subset]),
            'reported_input_tokens': sum(row['metadata']['usage']['input_tokens'] for row in successful),
            'reported_output_tokens': sum(row['metadata']['usage'].get('output_tokens') or 0 for row in successful)
                if any(row['metadata']['usage'].get('output_tokens') is not None for row in successful) else None,
            'missing_output_usage_receipts': sum(row['metadata']['usage'].get('output_tokens') is None for row in successful),
            'reported_cost_usd': sum(row['metadata'].get('reported_usd') or 0 for row in successful)
                if any(row['metadata'].get('reported_usd') is not None for row in successful) else None,
            'raw_requirement_misses': missing_cases, 'unsafe_adoption_cases': incorrect_cases,
            'partial_eligible_cases': partial_cases,
        }
    return {'protocol_sha256': protocol_hash, 'completed_attempts': len(rows), 'groups': groups,
            'limitations': [
                'Small human-labelled diagnostic set; not a calibrated model ranking or a final RAG quality result.',
                'Complete correctness here covers required/forbidden/planning labels only, not unlabelled task type or helpful enrichment.',
                'Raw required recall counts selective abstentions as undetected requirements; abstention is separately reported.',
                'Partial fields are eligible additions only: no real generative baseline planner was run.',
                'Old unnecessary does not encode an explicit exclusion; no exclusion capability is invented.',
                'Single observation per request; failures retained; no retries, repairs or replaced results.',
            ]}


def replay_consistency(directory):
    """Re-select v3 signals only; never claim to have run the v3.1 prompt."""
    from app.modules.retrieval.processors.jev_intent import (
        MIN_SELECTED_PROBABILITY, NEGATIVE_SIGNAL, POLICY_VERSION,
        modality_requirement, requirement_intent,
    )
    protocol_path = directory / 'protocol.json'
    protocol = json.loads(protocol_path.read_text())
    cases_path = directory / protocol['cases_file']
    assert digest(cases_path.read_bytes()) == protocol['cases_sha256']
    cases = json.loads(cases_path.read_text())['cases']
    gold = {case['id']: case for case in cases}
    source = directory / 'receipts.jsonl'
    original = [json.loads(line) for line in source.read_text().splitlines()]
    rows = []
    for captured in original:
        if captured['policy'] != 'new':
            continue
        row = deepcopy(captured)
        if row['status'] == 'success':
            requirements = row['decision']['requirements']
            requirements['policy_version'] = POLICY_VERSION
            modalities = {}
            for modality in ('image', 'audio', 'video'):
                signals = requirements['modalities'][modality]['signals']
                modalities[modality] = modality_requirement(*(signals[key] for key in ('required', 'forbidden', 'helpful')))
            accepted = (requirements['task']['selected_probability'] >= MIN_SELECTED_PROBABILITY
                        and requirements['planning']['status'] == 'simple'
                        and all(record['status'] not in {'conflict', 'uncertain'} for record in modalities.values()))
            for record in modalities.values():
                record['action'] = 'adopted' if accepted else 'abstained'
                record['effective_intent'] = requirement_intent(record) if accepted else None
            requirements['modalities'] = modalities
            requirements['task']['accepted'] = accepted
            requirements['task']['action'] = 'adopted' if accepted else 'abstained'
            row['decision'] = new_policy({'accepted': accepted, 'requirements': requirements,
                                          'thresholds': {'negative': NEGATIVE_SIGNAL}})
            row['grade'] = grade(gold[row['case_id']], row['decision'])
        rows.append(row)
    result = summarize(rows, cases, digest(protocol_path.read_bytes()))
    result.update(analysis_kind='selection_set_logic_only_replay', native_model_calls=0,
                  source_receipts_sha256=digest(source.read_bytes()),
                  source_prompt_version=protocol['new']['prompt_version'],
                  applied_policy_version=POLICY_VERSION,
                  warning='Uses the same 20 cases that informed the consistency change and their original v3 signals. No v3.1 prompt was sent. Not independent improvement evidence. Timings and usage describe original calls only.')
    return result


async def run(protocol_path, output):
    from app.core.config import settings
    from app.core.decision_providers import DECISION_CREDENTIALS, DECISION_ENDPOINTS
    from app.core.llm.jev import JevClient, JevError
    from app.modules.retrieval.processors.jev_intent import classify_intent
    protocol, cases, questions = load_protocol(protocol_path)
    protocol_hash = digest(protocol_path.read_bytes())
    clients = {}
    for route in protocol['models']:
        provider, model = route['provider'], route['model']
        key = getattr(settings, DECISION_CREDENTIALS[provider][0])
        if not key:
            raise ValueError(f'Missing configured credential for {provider}; no live requests made')
        endpoint = settings.bailian_decision_endpoint if provider == 'bailian' else DECISION_ENDPOINTS[provider]
        clients[(provider, model)] = JevClient(key, provider=provider, model=model, endpoint=endpoint,
            timeout_s=protocol['transport']['timeout_s'],
            max_input_tokens=protocol['transport']['max_input_tokens_per_route'])
    output.mkdir(parents=True, exist_ok=False)
    for name in ('protocol.json', 'cases.json', 'old-questions.json', 'new-questions.json'):
        shutil.copyfile(protocol_path.parent / name, output / name)
    rows = []
    with (output / 'receipts.jsonl').open('x') as log:
        for index, case in enumerate(cases):
            routes = protocol['models'] if index % 2 == 0 else list(reversed(protocol['models']))
            policies = ('old', 'new') if index % 2 == 0 else ('new', 'old')
            for route in routes:
                for policy_name in policies:
                    client = clients[(route['provider'], route['model'])]
                    row = {**route, 'case_id': case['id'], 'policy': policy_name,
                           'protocol_sha256': protocol_hash, 'started_at': datetime.now(timezone.utc).isoformat(),
                           'input_sha256': digest(canonical({'state': {'query': case['query']}, 'questions': questions[policy_name]}))}
                    started = time.perf_counter()
                    try:
                        if policy_name == 'old':
                            response = await client.evaluate({'query': case['query']}, questions['old'],
                                prompt_version=protocol['old']['prompt_version'])
                            result = old_policy(response.answers, protocol['old'])
                            metadata = response.metadata()
                            answers = response.answers
                        else:
                            class RecordingClient:
                                answers = None
                                async def evaluate(self, *args, **kwargs):
                                    result = await client.evaluate(*args, **kwargs)
                                    self.answers = result.answers
                                    return result
                            recording = RecordingClient()
                            _, info = await classify_intent(recording, case['query'])
                            result = new_policy(info)
                            metadata = {key: value for key, value in info.items() if key not in {
                                'requirements', 'thresholds', 'selected_probabilities', 'complex_probability',
                                'context_probability', 'eligible', 'forced', 'accepted', 'policy_version'}}
                            answers = recording.answers
                        row.update(status='success', decision=result, grade=grade(case, result),
                                   metadata=metadata, answers=answers)
                    except JevError as error:
                        row.update(status='failure', error=str(error))
                    row['duration_s'] = time.perf_counter() - started
                    rows.append(row)
                    log.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
                    log.flush()
                    print(case['id'], route['provider'], policy_name, row['status'],
                          'adopted=' + str(row.get('decision', {}).get('complete', False)), flush=True)
    summary = summarize(rows, cases, protocol_hash)
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, default=ROOT / 'evals/decision_strategy_v3_1_holdout/protocol.json')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--summarize', type=Path, help='Aggregate immutable receipts offline; never calls models')
    parser.add_argument('--replay-consistency', type=Path, help='Apply current logical consistency to old signals offline; not a new prompt evaluation')
    args = parser.parse_args()
    if args.replay_consistency:
        if args.live or args.summarize or args.output is None:
            parser.error('--replay-consistency requires a fresh --output file and cannot be combined with --live/--summarize')
        result = replay_consistency(args.replay_consistency)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x') as output:
            output.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'native_model_calls': 0, 'analysis': str(args.output)}))
        return
    if args.summarize:
        if args.live:
            parser.error('--summarize cannot be combined with --live')
        folder = args.summarize
        saved_protocol = folder / 'protocol.json'
        protocol = json.loads(saved_protocol.read_text())
        protocol_hash = digest(saved_protocol.read_bytes())
        saved_cases = folder / protocol['cases_file']
        assert digest(saved_cases.read_bytes()) == protocol['cases_sha256'], 'Saved case labels changed'
        cases = json.loads(saved_cases.read_text())['cases']
        rows = [json.loads(line) for line in (folder / 'receipts.jsonl').read_text().splitlines()]
        assert all(row['protocol_sha256'] == protocol_hash for row in rows), 'Receipt protocol mismatch'
        identities = {(row['provider'], row['model'], row['policy'], row['case_id']) for row in rows}
        assert len(identities) == len(rows), 'Duplicate attempts are not permitted'
        summary = summarize(rows, cases, protocol_hash)
        summary['aggregation'] = 'offline from immutable native receipts; no calls or replacement samples'
        summary_path = folder / 'summary.json'
        if not summary_path.exists():
            with summary_path.open('x') as output:
                output.write(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    protocol, cases, _ = load_protocol(args.protocol)
    if not args.live:
        print(json.dumps({'verified': True, 'cases': len(cases), 'providers': protocol['models'],
                          'requests_if_live': len(cases) * len(protocol['models']) * 2,
                          'protocol_sha256': digest(args.protocol.read_bytes())}, indent=2))
        return
    if args.output is None:
        parser.error('--live requires --output pointing to a new directory')
    if args.output.exists():
        parser.error('Output already exists; refusing to overwrite or refill a recorded run')
    summary = asyncio.run(run(args.protocol, args.output))
    print(json.dumps({'completed_attempts': summary['completed_attempts'], 'summary': str(args.output / 'summary.json')}))


if __name__ == '__main__':
    main()
