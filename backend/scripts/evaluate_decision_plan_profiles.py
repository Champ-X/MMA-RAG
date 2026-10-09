"""Frozen development-selected profiles and independent 24-case holdout.

No prompt/threshold selection on holdout. --promote changes only the checked-in
execution profile registry after fixed gates, never the user's saved settings.
"""
import argparse
import asyncio
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
PROFILE_PATH = ROOT / 'backend/app/modules/retrieval/processors/decision_plan_profiles.json'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def select_threshold(rows):
    """Development-only: zero FP, maximize TP, break ties at highest threshold."""
    positives = sum(row['positive'] for row in rows)
    eligible = []
    for tick in range(50, 101, 5):
        threshold = tick / 100
        selected = [row for row in rows if row['choice'] == 'verified' and row['signal'] >= threshold]
        tp = sum(row['positive'] for row in selected)
        fp = len(selected) - tp
        if fp == 0 and tp > 0 and tp >= .5 * positives:
            eligible.append((tp, threshold))
    return max(eligible)[1] if eligible else None


def load_protocol(path):
    from app.modules.retrieval.processors.decision_plan import prepare_verification
    protocol = json.loads(path.read_text())
    cases_path = path.parent / 'cases.json'
    assert sha(cases_path.read_bytes()) == protocol['cases_sha256']
    for file, expected in protocol['source_sha256'].items():
        assert sha((ROOT / file).read_bytes()) == expected, 'Source changed: ' + file
    # Admission metadata may change after the frozen holdout; thresholds cannot.
    profiles = json.loads(PROFILE_PATH.read_text())
    assert sha(canonical(candidate_profiles(profiles))) == protocol['candidate_profiles_sha256']
    cases = json.loads(cases_path.read_text())['cases']
    assert len(cases) == 24 and len({case['id'] for case in cases}) == 24
    for case in cases:
        state, questions, _ = prepare_verification(case['query'], case['baseline'])
        assert sha(canonical({'state': state, 'questions': questions})) == case['input_sha256']
    return protocol, cases


def candidate_profiles(registry):
    return [{key: value for key, value in profile.items() if key not in ('status', 'reason', 'holdout')}
            for profile in registry['profiles']]


def summarize(rows, cases):
    gold = {case['id']: case for case in cases}
    groups = defaultdict(lambda: {'positive_count': 0, 'negative_count': 0, 'true_positive': 0,
                                 'false_positive': 0, 'false_negative': 0, 'raw_verified_true_positive': 0,
                                 'raw_verified_false_positive': 0, 'failed_cases': [], 'wrong_action_cases': []})
    for row in rows:
        case = gold[row['case_id']]
        key = row['provider'] + '/' + case['purpose']
        group = groups[key]
        positive = case['positive']
        group['positive_count' if positive else 'negative_count'] += 1
        meets = row['actions'][0].get('meets_profile_threshold', False) if row['actions'] else False
        raw_verified = row['actions'][0].get('decision') == 'verified' if row['actions'] else False
        if raw_verified:
            group['raw_verified_true_positive' if positive else 'raw_verified_false_positive'] += 1
        if positive:
            group['true_positive' if meets else 'false_negative'] += 1
        elif meets:
            group['false_positive'] += 1
        if positive != meets:
            group['wrong_action_cases'].append(case['id'])
        if row['status'] != 'ok':
            group['failed_cases'].append(case['id'])
    for group in groups.values():
        group['passed'] = (group['positive_count'] == group['negative_count'] == 6
                           and group['false_positive'] == 0 and group['true_positive'] >= 4)
    return dict(groups)


async def run(protocol_path, output):
    from app.core.config import settings
    from app.core.decision_providers import DECISION_CREDENTIALS, DECISION_ENDPOINTS
    from app.core.llm.jev import JevClient
    from app.modules.retrieval.processors.decision_plan import verify_plan
    protocol, cases = load_protocol(protocol_path)
    clients = {}
    for model in protocol['models']:
        provider = model['provider']
        key = getattr(settings, DECISION_CREDENTIALS[provider][0])
        if not key:
            raise RuntimeError('Missing provider credential: ' + provider)
        endpoint = settings.bailian_decision_endpoint if provider == 'bailian' else DECISION_ENDPOINTS[provider]
        clients[provider] = JevClient(key, provider=provider, model=model['model'], endpoint=endpoint,
                                     timeout_s=3, max_input_tokens=200000)
    output.mkdir(parents=True, exist_ok=False)
    for file in ('protocol.json', 'cases.json'):
        shutil.copyfile(protocol_path.parent / file, output / file)
    shutil.copyfile(PROFILE_PATH, output / 'candidate-profiles.json')
    rows = []
    with (output / 'receipts.jsonl').open('x') as log:
        for index, case in enumerate(cases):
            routes = protocol['models'] if index % 2 == 0 else list(reversed(protocol['models']))
            for route in routes:
                native = clients[route['provider']]
                capture = {}
                class RecordingClient:
                    timeout_s = 3
                    async def evaluate(self, *args, **kwargs):
                        result = await native.evaluate(*args, **kwargs)
                        capture.update(answers=deepcopy(result.answers), metadata=result.metadata())
                        return result
                result = await verify_plan(case['query'], case['baseline'], client_factory=RecordingClient)
                plan = result['decision_plan']
                row = {**route, 'case_id': case['id'], 'purpose': case['purpose'], 'positive': case['positive'],
                       'at': datetime.now(timezone.utc).isoformat(), 'protocol_sha256': sha(protocol_path.read_bytes()),
                       'input_sha256': case['input_sha256'], 'status': plan['status'], 'reason': plan['reason'],
                       'actions': plan['actions'], 'client_attempt_count': plan['request_count'], **capture}
                rows.append(row)
                log.write(json.dumps(row, ensure_ascii=False) + '\n'); log.flush()
                print(route['provider'], case['id'], row['status'],
                      [r.get('meets_profile_threshold') for r in row['actions']], flush=True)
    load_protocol(protocol_path)
    summary = {'groups': summarize(rows, cases), 'production_actions_applied': sum(
        action.get('applied', False) for row in rows for action in row['actions']),
        'limitations': '24-case single-author holdout; no population reliability guarantee. Thresholds from separate development set; no retries or refill.'}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return summary


def promote(protocol_path, output):
    protocol, cases = load_protocol(protocol_path)
    rows = [json.loads(line) for line in (output / 'receipts.jsonl').read_text().splitlines()]
    assert len(rows) == len(cases) * len(protocol['models'])
    assert len({(row['provider'], row['case_id']) for row in rows}) == len(rows)
    assert all(row['protocol_sha256'] == sha(protocol_path.read_bytes()) for row in rows)
    summary = summarize(rows, cases)
    registry = json.loads(PROFILE_PATH.read_text())
    receipts_sha = sha((output / 'receipts.jsonl').read_bytes())
    for profile in registry['profiles']:
        result = summary[profile['provider'] + '/' + profile['purpose']]
        admitted = profile['threshold'] is not None and result['passed']
        profile.update(status='admitted' if admitted else 'rejected',
                       reason='holdout_gate_passed' if admitted else 'holdout_or_development_gate_failed',
                       holdout={**result, 'receipts_sha256': receipts_sha,
                                'protocol_sha256': sha(protocol_path.read_bytes()), 'path': str(output.relative_to(ROOT))})
    PROFILE_PATH.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n')
    return {p['id']: p['status'] for p in registry['profiles']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, default=ROOT/'evals/decision_plan_v2_holdout/protocol.json')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--promote', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.live and args.promote:
        parser.error('Run first, inspect, then promote from immutable receipts')
    protocol, cases = load_protocol(args.protocol)
    if args.live or args.promote:
        if args.output is None:
            parser.error('An output path is required')
        result = asyncio.run(run(args.protocol,args.output)) if args.live else promote(args.protocol,args.output)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    else:
        print(json.dumps({'verified':True,'cases':len(cases),'protocol_sha256':sha(args.protocol.read_bytes())}))


if __name__ == '__main__':
    main()
