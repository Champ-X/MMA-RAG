"""Metric integrity for the frozen strategy comparison; no provider calls."""
from scripts.evaluate_decision_strategy import grade, old_policy, summarize


def sample_case():
    return {'id': 'compound', 'required': ['image', 'audio'], 'forbidden': ['video'],
            'must_not_require': ['video'], 'expected_planning': 'needs_planning',
            'grounding_required': True}


def sample_policy(**changes):
    return {'complete': False, 'required': ['image'], 'forbidden': [],
            'partial_required_eligible': ['image'], 'conflicts': [], 'requirements': None,
            'strict_would_adopt': False, 'planning_handoff': True, **changes}


def test_abstention_and_raw_requirement_miss_are_not_an_incorrect_adoption():
    result = grade(sample_case(), sample_policy())
    assert result['complete_correct'] is None
    assert result['required_missed_raw'] == ['audio']
    assert result['missed_required_when_adopted'] == []
    assert result['required_eligible_for_partial'] == ['image']


def test_wrong_exclusion_and_missing_compound_goal_are_counted_on_adoption():
    result = grade(sample_case(), sample_policy(complete=True, required=['image', 'video'], forbidden=['audio']))
    assert result['complete_correct'] is False
    assert result['missed_required_when_adopted'] == ['audio']
    assert result['incorrect_required_when_adopted'] == ['video']
    assert result['incorrect_exclusions_when_adopted'] == ['audio']
    assert result['unsafe_complex_adoption']


def test_failures_do_not_inflate_abstention_or_correctness_denominators():
    policy = sample_policy()
    success = {'provider': 'typesafe', 'model': 'jev-1.13.0', 'policy': 'new', 'case_id': 'compound',
               'status': 'success', 'duration_s': .2, 'decision': policy, 'grade': grade(sample_case(), policy),
               'metadata': {'usage': {'input_tokens': 12, 'output_tokens': 2}}}
    failed = {**success, 'status': 'failure', 'duration_s': 3, 'error': 'timeout'}
    summary = summarize([success, failed], [sample_case()], 'frozen')
    group = summary['groups']['typesafe/jev-1.13.0/new']
    assert group['successes'] == group['failures'] == 1
    assert group['counts']['abstention'] == 1
    assert group['counts']['correct_complete_adoption'] == 0
    assert group['raw_required_recall'] == .5
    assert group['success_duration_p50_s'] == .2
    assert group['reported_cost_usd'] is None


def test_old_policy_keeps_original_gate_and_cannot_claim_explicit_exclusions():
    answers = {field: {'choice': choice, 'probabilities': {choice: .95}} for field, choice in (
        ('intent_type', 'analysis'), ('visual_intent', 'explicit_demand'),
        ('audio_intent', 'unnecessary'), ('video_intent', 'unnecessary'))}
    answers.update(is_complex={'noul': .2}, needs_context={'noul': .2})
    policy = old_policy(answers, {'selected_probability_min': .75, 'complexity_max': .2, 'context_max': .2})
    assert policy['complete'] and policy['strict_would_adopt']
    assert policy['required'] == ['image']
    assert policy['forbidden'] is None
    answers['is_complex']['noul'] = .200001
    assert not old_policy(answers, {'selected_probability_min': .75, 'complexity_max': .2, 'context_max': .2})['complete']


def test_provider_omitted_output_usage_is_unknown_not_zero_or_failure():
    policy = sample_policy()
    row = {'provider': 'bailian', 'model': 'decision-model-preview', 'policy': 'new', 'case_id': 'compound',
           'status': 'success', 'duration_s': .1, 'decision': policy, 'grade': grade(sample_case(), policy),
           'metadata': {'usage': {'input_tokens': 10}}}
    summary = summarize([row], [sample_case()], 'frozen')
    group = summary['groups']['bailian/decision-model-preview/new']
    assert group['successes'] == 1
    assert group['reported_input_tokens'] == 10
    assert group['reported_output_tokens'] is None
    assert group['missing_output_usage_receipts'] == 1
