"""Real, bounded diagnostics and paired plan scheduling; no settings/index writes.

The planner runs once per query. Each provider sees that same frozen plan.
Standalone intent diagnostics are recorded separately from production actions.
This is a functional call-contract check, not a retrieval-quality benchmark.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
CASES = [
    ('movie-media', '结合《浴血黑帮》这部电影剧情，为其挑选合适的海报封面和主题曲。'),
    ('source-exclusion', '比较这些论文中的检索和生成分工。只使用文档资料，不搜索图片、音频或视频。'),
    ('audio-source', '请从曲库找一首适合夜晚独处聆听的歌曲，说明理由。'),
    ('quoted-literal', '解释配置字段 image/png 和 audio_timeout 的含义，用文字回答。'),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


async def run(output):
    from fastapi import FastAPI
    import httpx
    from app.api import jev as api
    from app.core.decision_providers import DECISION_DEFAULT_MODELS
    from app.core.llm.jev import get_decision_client
    from app.modules.retrieval.processors.intent import IntentProcessor
    from app.modules.retrieval.processors.decision_plan import prepare_verification, verify_plan
    from loguru import logger

    output.mkdir(parents=True, exist_ok=False)
    logger.remove()
    logger.add(output / 'runtime.log', level='INFO')
    sources = ['backend/app/api/jev.py', 'backend/app/modules/retrieval/processors/intent.py',
               'backend/app/modules/retrieval/processors/decision_plan.py',
               'backend/app/modules/retrieval/processors/jev_intent.py',
               'backend/app/modules/retrieval/processors/decision_plan_profiles.json']
    frozen = {name: sha(ROOT / name) for name in sources}
    protocol = {'cases': CASES, 'providers': DECISION_DEFAULT_MODELS, 'source_sha256': frozen,
                'protocol': 'One attempt; no refill. Per query, one shared generative plan and three isolated standalone diagnostics. No chat/index/config writes.'}
    (output / 'protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2))
    settings_path = ROOT / 'backend/data/jev_settings.json'
    settings_hash = sha(settings_path)
    app = FastAPI()
    app.include_router(api.router, prefix='/api/decision')
    rows = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://local') as http:
        for case_id, query in CASES:
            baseline = await IntentProcessor()._process_generative(query, include_source_proposals=True)
            (output / f'{case_id}-planner.json').write_text(json.dumps(baseline, ensure_ascii=False, indent=2))
            for provider, model in DECISION_DEFAULT_MODELS.items():
                diagnostic = (await http.post('/api/decision/diagnose-intent',
                    json={'provider': provider, 'model': model, 'query': query})).json()
                _, previous_questions, _ = prepare_verification(query, baseline)
                planned = await verify_plan(query, baseline, selection=(provider, model),
                    client_factory=lambda: get_decision_client(provider, model))
                receipt = planned['decision_plan']
                row = {'case_id': case_id, 'provider': provider, 'model': model,
                       'diagnostic': diagnostic, 'baseline': baseline, 'result': planned,
                       'before_schedule_question_count': len(previous_questions)}
                (output / f'{case_id}-{provider}.json').write_text(json.dumps(row, ensure_ascii=False, indent=2))
                summary = {'case_id': case_id, 'provider': provider,
                    'diagnostic_completed': diagnostic.get('success', False),
                    'standalone_eligible': diagnostic.get('decision', {}).get('eligible'),
                    'diagnostic_error': diagnostic.get('error'),
                    'before_schedule_questions': len(previous_questions),
                    'scheduled_questions': receipt['scheduled_count'], 'chat_decision_requests': receipt['request_count'],
                    'status': receipt['status'], 'reason': receipt['reason'],
                    'applied_ids': receipt['applied_ids'], 'blockers': diagnostic.get('decision', {}).get('blockers', [])}
                rows.append(summary)
                print(json.dumps(summary, ensure_ascii=False), flush=True)
                assert sha(settings_path) == settings_hash, 'Saved settings changed during run'
    assert frozen == {name: sha(ROOT / name) for name in sources}, 'Source drift'
    (output / 'summary.json').write_text(json.dumps({'rows': rows, 'saved_settings_unchanged': True,
        'source_sha256': frozen, 'limitations': 'No semantic accuracy/SLA claim; one stochastic planner sample per case. Runtime actions retain existing model-purpose admission.'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.live:
        parser.error('--live is required for real provider calls')
    asyncio.run(run(args.output))
