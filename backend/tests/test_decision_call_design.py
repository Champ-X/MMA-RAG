"""Paid-call scheduling, isolated diagnostics and unchanged legacy contracts."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import jev as api
from app.core.config import settings
from app.core.jev_settings import OFF_CONFIG, jev_config_store
from app.core.llm.jev import JevError
from app.modules.retrieval.processors import decision_plan as plan
from app.modules.retrieval.processors.jev_intent import classify_intent
from test_decision_plan import baseline, client, proposal, response
from test_jev_intent import decision


@pytest.fixture
def admitted(monkeypatch):
    monkeypatch.setattr(plan, 'decision_profile', lambda metadata, action: {
        'execution': 'apply', 'threshold': .85, 'status': 'admitted'})


@pytest.mark.asyncio
async def test_already_planned_media_and_complexity_do_not_spend_or_block():
    query = '结合剧情找海报和主题曲'
    original = baseline(proposal('image', 'require', query),
                        proposal('audio', 'require', query, identifier='audio'))
    original['audio_intent'] = 'explicit_demand'
    frozen = deepcopy(original)
    result = await plan.verify_plan(query, original,
        selection=('bailian', 'decision-model-preview'),
        client_factory=lambda: pytest.fail('already planned; no paid Decision call'))
    assert original == frozen
    assert result['is_complex'] is True and result['sub_queries'] == ['A', 'B']
    assert result['visual_intent'] == result['audio_intent'] == 'explicit_demand'
    assert result['decision_plan']['scheduled_count'] == result['decision_plan']['request_count'] == 0
    assert {row['reason'] for row in result['decision_plan']['actions']} == {'already_planned'}


@pytest.mark.asyncio
async def test_production_rejected_purpose_skips_before_client_creation():
    result = await plan.verify_plan('不要图片', baseline(proposal()),
        selection=('bailian', 'decision-model-preview'),
        client_factory=lambda: pytest.fail('non-admitted purpose must not consume chat calls'))
    assert result['visual_intent'] == 'explicit_demand'
    assert result['decision_plan']['actions'][0]['reason'] == 'model_purpose_not_admitted'
    assert result['decision_plan']['request_count'] == 0
    assert 'decision_requirements' not in result


@pytest.mark.asyncio
async def test_mixed_actions_only_send_changes_and_keep_prohibitions_binding(admitted):
    query = '找图片，找录音，不要视频'
    original = baseline(proposal('image', 'require', '找图片'),
        proposal('audio', 'require', '找录音', identifier='audio'),
        proposal('video', 'forbid', '不要视频', identifier='video'))
    evaluator = client()
    result = await plan.verify_plan(query, original, client_factory=lambda: evaluator)
    assert set(evaluator.evaluate.call_args.args[1]) == {'p1', 'p2'}
    evaluator.evaluate.assert_awaited_once()
    assert result['decision_plan']['applied_ids'] == ['audio', 'video']
    assert result['audio_intent'] == 'explicit_demand'
    assert result['decision_requirements']['modalities']['video']['status'] == 'forbidden'
    assert result['sub_queries'] == original['sub_queries']


@pytest.mark.asyncio
async def test_duplicate_identical_action_is_one_question_but_different_grounding_is_retained(admitted):
    original = baseline(proposal(), proposal(identifier='copy'), proposal(span='不用图片', identifier='other'))
    evaluator = client()
    result = await plan.verify_plan('不要图片，不用图片', original, client_factory=lambda: evaluator)
    assert set(evaluator.evaluate.call_args.args[1]) == {'p0', 'p2'}
    assert result['decision_plan']['actions'][1]['reason'] == 'equivalent_action'


@pytest.mark.asyncio
async def test_unadmitted_purpose_does_not_block_an_admitted_one(monkeypatch, admitted):
    monkeypatch.setattr(plan, 'source_action_capabilities', lambda *_: {
        'require': {'execution': 'skip'}, 'forbid': {'execution': 'verify'}})
    evaluator = client()
    result = await plan.verify_plan('不要图片，找录音', baseline(proposal(),
        proposal('audio', 'require', '找录音', identifier='audio')),
        selection=('example', 'model'), client_factory=lambda: evaluator)
    assert set(evaluator.evaluate.call_args.args[1]) == {'p0'}
    assert result['visual_intent'] == 'unnecessary' and result['audio_intent'] == 'unnecessary'
    assert result['decision_plan']['actions'][1]['reason'] == 'model_purpose_not_admitted'


@pytest.mark.asyncio
async def test_standalone_gate_receipt_explains_the_reported_movie_case():
    evaluator = SimpleNamespace(evaluate=AsyncMock(return_value=decision(complex_prob=.71,
        signals={'image_required': .97, 'image_helpful': .92, 'audio_required': .95,
                 'audio_helpful': .73, 'video_required': .42, 'video_helpful': .19})))
    _, info = await classify_intent(evaluator, '结合剧情找海报和主题曲')
    assert info['eligible'] is False
    assert info['blockers'] == [{'field': 'planning', 'reason': 'uncertain'},
                               {'field': 'audio', 'reason': 'uncertain'},
                               {'field': 'video', 'reason': 'uncertain'}]
    assert info['requirements']['modalities']['image']['status'] == 'required'


@pytest.fixture
def diagnostic_app(monkeypatch):
    monkeypatch.setattr(settings, 'bailian_decision_api_key', 'private-test-key')
    app = FastAPI()
    app.include_router(api.router, prefix='/api/decision')
    return app


def diagnostic_request(**changes):
    return {'provider': 'bailian', 'model': 'decision-model-preview', 'query': '找海报和主题曲', **changes}


@pytest.mark.asyncio
async def test_diagnostic_accepts_uncertainty_as_observation_and_never_changes_saved_modes(diagnostic_app, monkeypatch):
    saved = OFF_CONFIG.model_copy(update={'intent_mode': 'force'})
    jev_config_store.write(saved)
    before = jev_config_store.path.read_bytes()
    evaluate = AsyncMock(return_value=decision(complex_prob=.71))
    routes = []
    def factory(provider, model):
        routes.append((provider, model))
        return SimpleNamespace(evaluate=evaluate)
    monkeypatch.setattr(api, 'get_decision_client', factory)
    from app.modules.retrieval.processors.intent import IntentProcessor
    planner = AsyncMock(side_effect=AssertionError('diagnostic must not call the planner'))
    monkeypatch.setattr(IntentProcessor, '_process_generative', planner)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=diagnostic_app), base_url='http://test') as c:
        data = (await c.post('/api/decision/diagnose-intent', json=diagnostic_request())).json()
    assert data['success'] and data['diagnostic_only'] and not data['decision']['eligible']
    assert data['decision']['blockers'][0]['field'] == 'planning'
    assert routes == [('bailian', 'decision-model-preview')]
    assert jev_config_store.path.read_bytes() == before
    evaluate.assert_awaited_once()
    planner.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('query', ['', '  ', 'q' * 4001])
async def test_diagnostic_rejects_invalid_input_before_any_call(diagnostic_app, monkeypatch, query):
    monkeypatch.setattr(api, 'get_decision_client', lambda *_: pytest.fail('invalid input'))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=diagnostic_app), base_url='http://test') as c:
        assert (await c.post('/api/decision/diagnose-intent', json=diagnostic_request(query=query))).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize('failure,reason', [(JevError('timeout'), 'timeout'),
    (RuntimeError('private-key-and-provider-body'), 'invalid_response_or_transport')])
async def test_diagnostic_reports_transport_failure_without_private_data(diagnostic_app, monkeypatch, failure, reason):
    monkeypatch.setattr(api, 'get_decision_client', lambda *_: SimpleNamespace(evaluate=AsyncMock(side_effect=failure)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=diagnostic_app), base_url='http://test') as c:
        response = await c.post('/api/decision/diagnose-intent', json=diagnostic_request())
    assert not response.json()['success'] and response.json()['error'] == reason
    assert 'private-' not in response.text


@pytest.mark.asyncio
async def test_diagnostic_deadline_cancels_one_call_without_retry(diagnostic_app, monkeypatch):
    cancelled = asyncio.Event()
    async def hang(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    evaluate = AsyncMock(side_effect=hang)
    monkeypatch.setattr(api, 'INTENT_DIAGNOSTIC_TIMEOUT_S', .01)
    monkeypatch.setattr(api, 'get_decision_client', lambda *_: SimpleNamespace(evaluate=evaluate))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=diagnostic_app), base_url='http://test') as c:
        data = (await c.post('/api/decision/diagnose-intent', json=diagnostic_request())).json()
    assert data['error'] == 'timeout' and cancelled.is_set()
    evaluate.assert_awaited_once()


def test_capability_preflight_uses_real_profiles_and_fails_closed_on_bad_registry(tmp_path, monkeypatch):
    assert plan.source_action_capabilities('typesafe', 'jev-1.13.0')['require']['execution'] == 'verify'
    assert plan.source_action_capabilities('bailian', 'decision-model-preview')['forbid']['execution'] == 'skip'
    monkeypatch.setattr(plan, 'PROFILE_PATH', tmp_path / 'missing.json')
    assert plan.source_action_capabilities('typesafe', 'jev-1.13.0')['require']['execution'] == 'skip'
