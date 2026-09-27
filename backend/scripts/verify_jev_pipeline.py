"""Live changed-stage smoke: real reranker -> context/citations -> generation.

Uses only synthetic evaluation documents. No storage writes. This deliberately
does not claim to exercise ingestion, hybrid recall, HTTP routes or the UI.
"""
import argparse
import asyncio
from dataclasses import asdict
import json
import os
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))


async def run(args):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env, override=False)
    secret = args.jev_key_file.read_text().strip()
    key = re.split(r'[:=：]', secret, maxsplit=1)[-1].strip().strip("\"'")
    from app.core.llm.jev import JevClient
    from app.core.llm.manager import llm_manager
    from app.modules.retrieval.reranker import Reranker
    from app.modules.generation.context_builder import ContextBuilder
    from app.modules.generation.templates.system_prompts import SystemPromptManager
    from loguru import logger
    logger.remove()
    dataset = ROOT / 'evals/baseline_v1'
    cases = [json.loads(line) for line in (dataset / 'cases.jsonl').read_text().splitlines()]
    raw = {'dense': [{'id': p.name, 'score': 1 / (61 + i), 'content_type': 'doc',
                      'payload': {'text_content': p.read_text(), 'file_path': p.name, 'kb_id': 'synthetic-eval'}}
                     for i, p in enumerate(sorted((dataset / 'corpus').glob('*.md')))]}
    context = SimpleNamespace(intent_type='factual', visual_intent='unnecessary', target_kb_ids=['synthetic-eval'])
    client = JevClient(key, max_input_tokens=100000, timeout_s=3)
    builder = ContextBuilder()
    prompt_manager = SystemPromptManager()
    completed = []
    for case in cases[-2:]:
        for mode in ['off', 'replace']:
            started = time.perf_counter()
            reranker = Reranker()
            reranker.jev_mode = mode
            reranker.jev_client = client
            # Genuine configured Qwen manager for baseline, genuine Jev wrapper for experiment.
            result = await reranker.rerank(case['question'], raw, context)
            assert result.get('results') and not result.get('error')
            if mode == 'replace':
                assert result['scorer']['status'] == 'ok', result['scorer']
            retrieval = SimpleNamespace(reranked_results=result['results'], context=context)
            built = await builder.build_context(retrieval, case['question'])
            assert built.context_string and built.reference_map
            messages = [
                {'role': 'system', 'content': prompt_manager.build_system_prompt('factual')},
                {'role': 'user', 'content': builder.formatter.format_user_query(query=case['question'], context=built.context_string)},
            ]
            generated = await llm_manager.chat(messages, task_type='final_generation', fallback=False,
                                                temperature=.3, max_tokens=1200, total_timeout=90)
            if not generated.success:
                raise RuntimeError('generation_failed_' + str(generated.error_category))
            answer = generated.data['choices'][0]['message']['content']
            assert answer.strip()
            cited = re.findall(r'\[(\d+)\]', answer)
            assert cited and all(c in built.reference_map for c in cited)
            completed.append({
                'case': case['id'], 'mode': mode, 'query': case['question'],
                'reference_answer': case['reference_answer'],
                'ranking': [d['id'] for d in result['results']], 'rerank_duration_s': result['processing_time'],
                'scorer': result['scorer'], 'context': built.context_string,
                'reference_map': {k: asdict(v) for k, v in built.reference_map.items()},
                'answer': answer, 'generation_model': generated.model_used,
                'generation_duration_s': generated.duration, 'generation_tokens': generated.tokens_used,
                'generation_usage': (generated.data or {}).get('usage'),
                'total_duration_s': time.perf_counter() - started, 'citation_ids_valid': True,
            })
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(completed, ensure_ascii=False, indent=2) + '\n')
            print(case['id'], mode, 'complete', flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--provider-env', type=Path, required=True)
    p.add_argument('--jev-key-file', type=Path, required=True)
    p.add_argument('--output', type=Path, default=ROOT / 'docs/research/jev/results/pipeline.json')
    asyncio.run(run(p.parse_args()))
