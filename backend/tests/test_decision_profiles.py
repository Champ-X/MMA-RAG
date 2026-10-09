"""Model/purpose execution authorization and development selection boundaries."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.retrieval.processors import decision_plan as plan
from test_decision_plan import proposal, baseline, response

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('profile_evaluation', ROOT / 'backend/scripts/evaluate_decision_plan_profiles.py')
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def register(tmp_path, monkeypatch, *, status='admitted', threshold=.7, purpose='source_forbid', false_positive=0):
    profile = {'id': 'test-profile', 'purpose': purpose, 'provider': 'typesafe', 'requested_model': 'requested',
               'actual_model': 'version-1', 'verifier_sha256': plan.verifier_sha256(), 'status': status,
               'threshold': threshold, 'reason': 'test_profile',
               'holdout': {'false_positive': false_positive, 'true_positive': 4, 'positive_count': 6,
                           'negative_count': 6, 'receipts_sha256': 'test-fixture'}}
    path = tmp_path / 'profiles.json'
    path.write_text(json.dumps({'profiles': [profile]}))
    monkeypatch.setattr(plan, 'PROFILE_PATH', path)
    return profile


def metadata(**overrides):
    return {'route': 'typesafe', 'requested_model': 'requested', 'model': 'version-1', **overrides}


@pytest.mark.parametrize('overrides', [{'route': 'openrouter'}, {'requested_model': 'other'}, {'model': 'version-2'}])
def test_model_identity_changes_do_not_inherit_an_admitted_profile(tmp_path, monkeypatch, overrides):
    register(tmp_path, monkeypatch)
    assert plan.decision_profile(metadata(**overrides), 'forbid')['execution'] == 'observe_only'


def test_purpose_is_independent_and_declared_admission_still_checks_fixed_gate(tmp_path, monkeypatch):
    register(tmp_path, monkeypatch)
    assert plan.decision_profile(metadata(), 'forbid')['execution'] == 'apply'
    assert plan.decision_profile(metadata(), 'require')['execution'] == 'observe_only'
    register(tmp_path, monkeypatch, false_positive=1)
    assert plan.decision_profile(metadata(), 'forbid')['execution'] == 'observe_only'


@pytest.mark.asyncio
@pytest.mark.parametrize('status,threshold,meets', [('holdout_pending', .7, True), ('rejected', None, False)])
async def test_probability_one_does_not_grant_execution_authority(tmp_path, monkeypatch, status, threshold, meets):
    register(tmp_path, monkeypatch, status=status, threshold=threshold)
    async def evaluate(state, questions, **kwargs):
        result = response(questions, {'p0': ('verified', 1.0)})
        result.metadata = metadata
        return result
    result = await plan.verify_plan('不要图片', baseline(proposal()),
        client_factory=lambda: SimpleNamespace(evaluate=AsyncMock(side_effect=evaluate)))
    row = result['decision_plan']['actions'][0]
    assert row['meets_profile_threshold'] is meets
    assert not row['applied'] and row['reason'] == 'profile_observe_only'
    assert result['visual_intent'] == 'explicit_demand'
    assert result['jev_decision']['reason'] == 'observe_only'


def test_development_algorithm_values_false_positive_above_recall_and_uses_highest_tied_threshold():
    good = [{'positive': True, 'choice': 'verified', 'signal': .73},
            {'positive': True, 'choice': 'verified', 'signal': .86},
            {'positive': False, 'choice': 'contradicted', 'signal': .02}]
    assert evaluation.select_threshold(good) == .7
    unsafe = [{'positive': True, 'choice': 'verified', 'signal': 1},
              {'positive': False, 'choice': 'verified', 'signal': 1}]
    assert evaluation.select_threshold(unsafe) is None


def test_pending_production_actions_do_not_zero_out_candidate_holdout_recall():
    cases = [{'id': 'q', 'purpose': 'source_forbid', 'positive': True}]
    rows = [{'case_id': 'q', 'provider': 'typesafe', 'status': 'ok',
             'actions': [{'decision': 'verified', 'meets_profile_threshold': True, 'applied': False}]}]
    result = evaluation.summarize(rows, cases)['typesafe/source_forbid']
    assert result['true_positive'] == 1 and result['false_negative'] == 0
    assert not result['passed']  # One positive is not the required holdout size.


def test_tracked_compact_evidence_reproduces_selection_and_admission_without_ops():
    registry = json.loads((ROOT / 'backend/app/modules/retrieval/processors/decision_plan_profiles.json').read_text())
    for path, wanted in registry['evidence'].items():
        assert evaluation.sha((ROOT / path).read_bytes()) == wanted
    folder = ROOT / 'evals/decision_plan_v2'
    dev = json.loads((folder / 'development-signals.json').read_text())['rows']
    holdout = json.loads((folder / 'holdout-signals.json').read_text())['rows']
    cases = json.loads((ROOT / 'evals/decision_plan_v2_holdout/cases.json').read_text())['cases']
    metrics = evaluation.summarize(holdout, cases)
    selections = {row['profile_id']: row for row in json.loads((folder / 'selection.json').read_text())['rows']}
    for profile in registry['profiles']:
        samples = []
        for row in dev:
            if row['provider'] != profile['provider']:
                continue
            assert row['actual_model'] in (None, profile['actual_model'])
            for action in row['actions']:
                if action['status'] != 'evaluated' or 'source_' + action['action'] != profile['purpose']:
                    continue
                answer = row['answers']['p' + str(action['index'])]
                samples.append({'positive': action['positive'], 'choice': answer['choice'], 'signal': answer['probabilities']['verified']})
        assert evaluation.select_threshold(samples) == profile['threshold'] == selections[profile['id']]['threshold']
        metric = metrics[profile['provider'] + '/' + profile['purpose']]
        expected = 'admitted' if profile['threshold'] is not None and metric['passed'] else 'rejected'
        assert profile['status'] == expected
        for field in ('true_positive', 'false_positive', 'false_negative', 'positive_count', 'negative_count'):
            assert profile['holdout'][field] == metric[field]
        # The stored signal itself reproduces qualification; do not trust the
        # receipt's derived meets_profile_threshold field when auditing.
        for row in holdout:
            if row['provider'] != profile['provider'] or row['purpose'] != profile['purpose']:
                continue
            assert row['actual_model'] == profile['actual_model']
            answer = row['answers']['p0']
            qualifies = (profile['threshold'] is not None and answer['choice'] == 'verified'
                         and answer['probabilities']['verified'] >= profile['threshold'])
            assert row['actions'][0]['meets_profile_threshold'] == qualifies
