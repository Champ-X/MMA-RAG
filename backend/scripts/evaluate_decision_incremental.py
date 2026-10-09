"""Frozen v2 evidence evaluation; public quality and synthetic behavior are separate.

Explicit --live is required. No retries, old-artifact writes, configuration
changes, fresh Qwen calls, ingestion or answer-quality claims occur here.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(Path(__file__).parent))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mean(values):
    values = [value for value in values if value is not None]
    return statistics.mean(values) if values else None


def controlled_document(identity, text):
    return {'id': identity, 'content_type': 'doc', 'total_score': .1,
            'final_score': .1, 'rerank_score': None,
            'payload': {'text_content': text, 'kb_id': 'controlled-fixture', 'file_id': identity,
                        'file_name': identity + '.txt'}}


async def run(args):
    from loguru import logger
    from evaluate_jev import coarse_candidates
    from app.core.llm.jev import get_decision_client
    from app.core.llm.manager import LLMCallResult
    from app.core.jev_settings import JevConfig, _request_config
    from app.modules.retrieval.decision_evidence import POLICY_VERSION, supplement_evidence
    from app.modules.retrieval.reranker import Reranker
    logger.remove()
    protocol = json.loads(args.protocol.read_text())
    if protocol['protocol'] != 'decision-incremental-pilot-v2' or protocol['policy_version'] != POLICY_VERSION:
        raise ValueError('Unsupported protocol or policy version')
    for relative, expected in protocol['source_sha256'].items():
        if sha(ROOT / relative) != expected:
            raise ValueError(f'Source drift: {relative}')
    for field in ('dataset', 'baseline_receipts', 'functional_cases'):
        if sha(ROOT / protocol[field]) != protocol[field + '_sha256']:
            raise ValueError(f'Input drift: {field}')
    cases = {row['id']: row for row in map(json.loads, (ROOT / protocol['dataset']).read_text().splitlines())}
    receipts = {row['id']: row for row in map(json.loads, (ROOT / protocol['baseline_receipts']).read_text().splitlines())}
    functional = json.loads((ROOT / protocol['functional_cases']).read_text())['cases']
    config_path = ROOT / 'backend/data/jev_settings.json'
    config_hash = sha(config_path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Reserve once before calls; an interrupted receipt is kept, never refilled.
    with args.output.open('x'):
        pass
    rows = []

    def record(row):
        rows.append(row)
        with args.output.open('a') as out:
            out.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
        print(json.dumps({'suite': row['suite'], 'id': row['id'], 'route': row['provider'],
                          'status': row['scorer']['status'], 'reason': row['scorer']['reason'],
                          'added_ids': row['added_ids']}, ensure_ascii=False), flush=True)

    for selection in protocol['providers']:
        client = get_decision_client(selection['provider'], selection['model'])
        if client.timeout_s != protocol['stage_deadline_s']:
            raise ValueError('Runtime timeout does not match frozen protocol')
        token = _request_config.set(JevConfig(**selection, intent_mode='off', rerank_mode='assist',
                                             citation_mode='off', citation_strategy='per_unit'))
        try:
            for case_id in protocol['cases']:
                case, receipt = cases[case_id], receipts[case_id]
                ranker = Reranker()
                ranker.decision_evidence_policy = POLICY_VERSION
                raw = {'dense': coarse_candidates(case)}
                selected = ranker._select_candidates_for_reranking(ranker._prepare_coarse_ranking(raw), None)
                if [row['id'] for row in selected] != receipt['candidate_ids']:
                    raise ValueError('Baseline candidate drift')
                documents = [ranker._build_document_content(row) for row in selected]
                fingerprint = hashlib.sha256(json.dumps([case['query'], documents], ensure_ascii=False).encode()).hexdigest()
                if fingerprint != receipt['input_sha256']:
                    raise ValueError('Baseline input drift')

                class CachedBaseline:
                    async def rerank(self, query, documents, **kwargs):
                        return LLMCallResult(success=True, data=receipt['qwen']['scores'],
                                             model_used=receipt['qwen']['model'])

                ranker.llm_manager = CachedBaseline()
                ranker.jev_mode = 'off'
                before = (await ranker.rerank(case['query'], raw))['results']
                ranker.jev_mode = 'assist'
                ranker.jev_client = client
                after = await ranker.rerank(case['query'], raw)
                if after['results'][:len(before)] != before:
                    raise AssertionError('Baseline evidence changed')
                additions = after['results'][len(before):]
                if len(additions) > 2:
                    raise AssertionError('Addition bound broken')
                labels = {row['id']: row['relevance'] > 0 for row in case['documents']}
                positive_count = sum(labels.values())
                relevant_before = sum(labels[row['id']] for row in before)
                relevant_added = sum(labels[row['id']] for row in additions)
                record({'suite': 'public', 'id': case_id, **selection, 'query': case['query'],
                        'baseline_source': 'frozen historical real Qwen scores',
                        'baseline_input_sha256': fingerprint, 'baseline_preserved': True,
                        'baseline_ids': [row['id'] for row in before],
                        'added_ids': [row['id'] for row in additions], 'added_relevant': relevant_added,
                        'positive_count': positive_count,
                        'recall_before': relevant_before / positive_count if positive_count else None,
                        'recall_after': (relevant_before + relevant_added) / positive_count if positive_count else None,
                        'scorer': after['scorer'], 'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')})
            for case in functional:
                before = [controlled_document(row['id'], row['text']) for row in case['baseline']]
                candidates = [controlled_document(row['id'], row['text']) for row in case['candidates']]
                after, scorer = await supplement_evidence(
                    case['query'], before, candidates, candidates,
                    client_factory=lambda: client, modality=lambda row: row['content_type'],
                    policy_version=POLICY_VERSION)
                if after[:len(before)] != before:
                    raise AssertionError('Controlled baseline changed')
                added_ids = [row['id'] for row in after[len(before):]]
                expected = {row['id'] for row in case['candidates'] if row['expected_incremental_addition']}
                record({'suite': 'functional', 'id': case['id'], **selection, 'query': case['query'],
                        'baseline_source': 'controlled fixture; no Qwen quality comparison',
                        'baseline_preserved': True, 'added_ids': added_ids,
                        'expected_ids': sorted(expected), 'false_additions': sorted(set(added_ids) - expected),
                        'missed_expected': sorted(expected - set(added_ids)),
                        'scorer': scorer, 'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')})
        finally:
            _request_config.reset(token)
    if sha(config_path) != config_hash:
        raise AssertionError('Saved settings changed')
    for relative, expected in protocol['source_sha256'].items():
        if sha(ROOT / relative) != expected:
            raise AssertionError(f'Source changed during run: {relative}')
    groups = {}
    for selection in protocol['providers']:
        key = f"{selection['provider']}/{selection['model']}"
        group = [row for row in rows if row['provider'] == selection['provider'] and row['model'] == selection['model']]
        public = [row for row in group if row['suite'] == 'public']
        functional_rows = [row for row in group if row['suite'] == 'functional']
        added = sum(len(row['added_ids']) for row in public)
        groups[key] = {
            'public_attempted_cases': len(public), 'public_additions': added,
            'public_relevant_additions': sum(row['added_relevant'] for row in public),
            'public_addition_precision': sum(row['added_relevant'] for row in public) / added if added else None,
            'mean_recall_before': mean([row['recall_before'] for row in public]),
            'mean_recall_after': mean([row['recall_after'] for row in public]),
            'functional_attempted_cases': len(functional_rows),
            'functional_exact_addition_sets': sum(not row['false_additions'] and not row['missed_expected'] for row in functional_rows),
            'functional_false_additions': sum(len(row['false_additions']) for row in functional_rows),
            'functional_missed_expected': sum(len(row['missed_expected']) for row in functional_rows),
            'baseline_preserved': all(row['baseline_preserved'] for row in group),
            'failures': [{'suite': row['suite'], 'id': row['id'], 'reason': row['scorer']['reason']}
                         for row in group if row['scorer']['status'] == 'fallback'],
            'skipped': [{'suite': row['suite'], 'id': row['id'], 'reason': row['scorer']['reason']}
                        for row in group if row['scorer']['status'] == 'skipped'],
        }
    summary = {'protocol': protocol, 'protocol_sha256': sha(args.protocol), 'groups': groups,
               'settings_unchanged': True, 'limitations': protocol['limitations']}
    with args.output.with_suffix('.summary.json').open('x') as out:
        json.dump(summary, out, ensure_ascii=False, indent=2, allow_nan=False)
    print(json.dumps(groups, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.live:
        parser.error('Fresh provider requests require --live')
    asyncio.run(run(args))
