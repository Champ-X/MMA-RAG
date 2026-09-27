"""Offline checks for evidence accounting and interrupted paid-run protection."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from scripts import evaluate_jev_batching as evaluation


@pytest.fixture
def experiment(tmp_path, monkeypatch):
    data = tmp_path/'data'
    data.mkdir()
    cases = [{'id': 'test-one', 'split': 'test', 'family': 'one', 'units': [
        {'claim': '日志保留14天。', 'supported': True,
         'cited_sources': {'1': '日志保留14天。'}, 'background': ''},
    ]}]
    (data/'cases.jsonl').write_text(json.dumps(cases[0])+'\n')
    fingerprint = evaluation.sha(data/'cases.jsonl')
    (data/'manifest.json').write_text(json.dumps({'sha256': fingerprint}))
    monkeypatch.setattr(evaluation, 'DATA', data)
    key = tmp_path/'test-key'
    key.write_text('offline-placeholder')
    env = tmp_path/'empty.env'
    env.write_text('')
    args = SimpleNamespace(output=tmp_path/'receipts.jsonl', report=tmp_path/'report.json',
                           key_file=key, provider_env=env, continue_pending_after_review=False)
    return args, cases, fingerprint


def install_client_stub(monkeypatch, args, *, interrupt=False, fail=False, before_inference=None, pause=None):
    from app.core.llm import jev
    calls = []

    class OfflineClient:
        def __init__(self, api_key, *, model, timeout_s, max_input_tokens):
            self.reserved_input_tokens = 0
            assert model == evaluation.MODEL
            assert timeout_s == evaluation.TIMEOUT_S

        async def evaluate(self, state, questions, *, prompt_version):
            if before_inference:
                before_inference()
            manifest_path, pending_path = evaluation.ledger_paths(args.output)
            manifest = json.loads(manifest_path.read_text())
            pending = json.loads(pending_path.read_text())
            assert pending['execution_id'] == manifest['execution_id']
            calls.append(pending['mode'])
            if pause:
                started, release = pause
                started.set()
                await release.wait()
            self.reserved_input_tokens += 7
            if interrupt:
                raise asyncio.CancelledError('simulate process interruption')
            if fail:
                raise jev.JevError('timeout')
            answers = {}
            for name, question in questions.items():
                if question['type'] == 'choice':
                    answers[name] = {'type': 'choice', 'choice': 'supported', 'confidence': 1,
                                     'probabilities': {k: int(k == 'supported') for k in question['criteria']}}
                else:
                    answers[name] = {'type': 'noul', 'noul': int(name == 'supported')}
            return SimpleNamespace(answers=answers, metadata=lambda: {
                'model': evaluation.MODEL, 'usage': {'input_tokens': 7, 'output_tokens': 1},
                'prompt_version': prompt_version,
            })

    monkeypatch.setattr(jev, 'JevClient', OfflineClient)
    return calls


@pytest.mark.asyncio
async def test_legacy_receipts_cannot_be_given_a_retroactive_live_manifest(experiment, monkeypatch):
    args, _, _ = experiment
    args.output.write_text('{"historical": true}\n')
    before = args.output.read_bytes()
    calls = install_client_stub(monkeypatch, args)
    with pytest.raises(ValueError, match='offline reporting only'):
        await evaluation.run(args)
    assert calls == []
    assert args.output.read_bytes() == before
    assert not evaluation.ledger_paths(args.output)[0].exists()


@pytest.mark.asyncio
async def test_manifest_and_pending_are_durable_before_inference_and_receipts_before_clear(experiment, monkeypatch):
    args, _, fingerprint = experiment
    synced = []
    real_sync = evaluation.os.fsync

    def record_sync(fd):
        real_sync(fd)
        synced.append(fd)

    monkeypatch.setattr(evaluation.os, 'fsync', record_sync)

    def assert_synced_before_inference():
        assert len(synced) >= 4  # Manifest and pending, both synced before the call.

    calls = install_client_stub(monkeypatch, args, before_inference=assert_synced_before_inference)
    real_complete = evaluation._complete_group

    def verify_complete(output, row, pending_path):
        assert len(synced) >= 4  # Manifest and pending, each file plus directory.
        assert pending_path.exists()
        real_complete(output, row, pending_path)
        assert evaluation.read(output)[-1] == row
        assert not pending_path.exists()

    monkeypatch.setattr(evaluation, '_complete_group', verify_complete)
    await evaluation.run(args)
    manifest_path, pending_path = evaluation.ledger_paths(args.output)
    manifest = json.loads(manifest_path.read_text())
    assert manifest['spec']['dataset_sha256'] == fingerprint
    assert set(manifest['spec']['module_sha256']) == set(evaluation.EXECUTION_FILES)
    assert manifest['spec']['support_threshold'] == .8
    assert len(calls) == 4
    assert len(evaluation.read(args.output)) == 4
    assert not pending_path.exists()
    # An ordinary clean resume never repeats completed groups.
    await evaluation.run(args)
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_concurrent_live_run_is_rejected_for_entire_run_lifetime(experiment, monkeypatch):
    args, _, _ = experiment
    started, release = asyncio.Event(), asyncio.Event()
    calls = install_client_stub(monkeypatch, args, pause=(started, release))
    running = asyncio.create_task(evaluation.run(args))
    try:
        await asyncio.wait_for(started.wait(), timeout=1)
        with pytest.raises(ValueError, match='Another live evaluator owns this output'):
            await evaluation.run(args)
        assert len(calls) == 1
    finally:
        release.set()
        await running
    assert len(calls) == 4
    # The finished process releases its lock; no pending work or calls remain.
    await evaluation.run(args)
    assert len(calls) == 4


@pytest.mark.asyncio
async def test_interrupted_group_refuses_resume_even_with_continuation_flag(experiment, monkeypatch):
    args, _, _ = experiment
    calls = install_client_stub(monkeypatch, args, interrupt=True)
    with pytest.raises(asyncio.CancelledError):
        await evaluation.run(args)
    pending_path = evaluation.ledger_paths(args.output)[1]
    assert pending_path.exists()
    pending_before = pending_path.read_bytes()
    count = len(calls)
    args.continue_pending_after_review = True
    with pytest.raises(ValueError, match='billing and completion are unknown'):
        await evaluation.run(args)
    assert len(calls) == count
    assert pending_path.read_bytes() == pending_before


@pytest.mark.asyncio
async def test_receipt_without_pending_clear_still_blocks_resume(experiment, monkeypatch):
    args, _, _ = experiment
    calls = install_client_stub(monkeypatch, args)
    pending_path = evaluation.ledger_paths(args.output)[1]
    original_unlink = type(pending_path).unlink

    def crash_on_clear(path, *a, **kw):
        if path == pending_path:
            raise RuntimeError('interruption after durable receipt')
        return original_unlink(path, *a, **kw)

    monkeypatch.setattr(type(pending_path), 'unlink', crash_on_clear)
    with pytest.raises(RuntimeError, match='after durable receipt'):
        await evaluation.run(args)
    assert len(evaluation.read(args.output)) == 1
    receipt_before = args.output.read_bytes()
    with pytest.raises(ValueError, match='Automatic continuation or retry is forbidden'):
        await evaluation.run(args)
    assert len(calls) == 1
    assert args.output.read_bytes() == receipt_before


@pytest.mark.asyncio
async def test_recorded_failure_keeps_reservation_without_retrying_failed_group(experiment, monkeypatch):
    args, _, _ = experiment
    calls = install_client_stub(monkeypatch, args, fail=True)
    await evaluation.run(args)
    row = evaluation.read(args.output)[0]
    assert row['status'] == 'not_evaluated'
    assert row['budget_accounted_tokens'] == 7
    assert row['reported_input_tokens'] == 0
    assert not evaluation.ledger_paths(args.output)[1].exists()
    with pytest.raises(ValueError, match='Inspect failures'):
        await evaluation.run(args)
    assert len(calls) == 1
    args.continue_pending_after_review = True
    await evaluation.run(args)
    assert len(calls) == 2
    assert calls[0] != calls[1]
    assert evaluation.read(args.output)[1]['budget_accounted_tokens'] == 14


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['timeout', 'module_hash'])
async def test_resume_rejects_changed_execution_configuration(experiment, monkeypatch, change):
    args, _, _ = experiment
    calls = install_client_stub(monkeypatch, args)
    await evaluation.run(args)
    if change == 'timeout':
        monkeypatch.setattr(evaluation, 'TIMEOUT_S', evaluation.TIMEOUT_S+1)
    else:
        original_spec = evaluation.execution_spec

        def changed_code(*a, **kw):
            spec = original_spec(*a, **kw)
            spec['module_sha256']['backend/app/core/llm/jev.py'] = 'changed'
            return spec

        monkeypatch.setattr(evaluation, 'execution_spec', changed_code)
    with pytest.raises(ValueError, match='manifest differs'):
        await evaluation.run(args)
    assert len(calls) == 4


def test_offline_report_exposes_threshold_changes_failures_and_unknown_cost(experiment):
    args, cases, fingerprint = experiment
    case = cases[0]
    case['units'].append({'claim': '未知声明', 'supported': False, 'cited_sources': {'2': '无此事实'}})
    (evaluation.DATA/'cases.jsonl').write_text(json.dumps(case)+'\n')
    fingerprint = evaluation.sha(evaluation.DATA/'cases.jsonl')

    def unit(probability):
        return {'choice': {'choice': 'supported', 'probabilities': {'supported': probability}},
                'support_signal': probability >= .8}

    rows = []
    for mode, units, reported, budget in [
        ('structured_single', [unit(.79), unit(.81)], 100, 100),
        ('batch', [unit(.81), unit(.79)], 80, 180),
        ('batch_background', [], 0, 500),
    ]:
        rows.append({'id': case['id'], 'split': 'test', 'family': case['family'],
                     'mode': mode, 'fingerprint': fingerprint, 'units': units,
                     'status': 'evaluated' if units else 'not_evaluated', 'reason': 'timeout' if not units else None,
                     'duration_s': 1, 'request_count': 2 if mode == 'structured_single' else 1,
                     'reported_input_tokens': reported, 'budget_accounted_tokens': budget})
    args.output.write_text(''.join(json.dumps(r)+'\n' for r in rows))
    before = args.output.read_bytes()
    evaluation.report(args)  # Historical receipts require no credentials or live manifest.
    result = json.loads(args.report.read_text())
    pair = result['paired_against_structured_single_test']['batch']
    assert pair['classification_disagreements'] == 0
    assert pair['support_signal_disagreements'] == 2
    assert pair['support_signal_disagreement_ids'] == [[case['id'], 0], [case['id'], 1]]
    assert pair['support_signal_changes'][0]['candidate_signal'] is True
    failed = result['groups']['test']['batch_background']
    assert failed['supported_units'] == failed['unsupported_units'] == 1
    assert failed['support_recall'] == 0
    assert failed['evaluated_units'] == 0
    assert result['observed_input_usd'] == pytest.approx(180*.042/1e6)
    assert result['budget_accounted_usd'] == pytest.approx(500*.042/1e6)
    assert result['unconfirmed_reserved_tokens'] == 320
    assert result['billing_total_unknown'] is True
    assert 'not verified server-received' in result['attempted_requests_definition']
    assert result['execution_manifest_status'] == 'absent_legacy_offline_only'
    assert not evaluation.ledger_paths(args.output)[0].exists()
    assert args.output.read_bytes() == before
