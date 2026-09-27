"""Paired real query-decision experiment, before enabling the production gate."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
from scripts.evaluate_jev import percentile


async def run(args, cases, fingerprint):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env, override=False)
    from app.core.llm.jev import JevClient, JevError
    from app.core.llm.manager import llm_manager
    from app.modules.retrieval.processors.intent import IntentProcessor
    from app.modules.retrieval.processors.jev_intent import classify_intent, INTENT_PROMPT_VERSION
    from loguru import logger
    logger.remove()
    secret = args.key_file.read_text().strip()
    key = re.split(r'[:=：]', secret, maxsplit=1)[-1].strip().strip("\"'")
    previous = list(map(json.loads, args.output.read_text().splitlines())) if args.output.exists() else []
    assert all(r['fingerprint'] == fingerprint and r['prompt_version'] == INTENT_PROMPT_VERSION for r in previous)
    used = sum(r.get('jev', {}).get('metadata', {}).get('usage', {}).get('input_tokens', 0) for r in previous)
    prior_errors = [r for r in previous if r.get('jev',{}).get('error')]
    if prior_errors and not args.resume_after_error:
        raise ValueError('Inspect failed attempts, then explicitly resume with billing reservations')
    used += len(prior_errors) * 60_000
    done = {r['id'] for r in previous}
    baseline_cache = {r['id']:r for r in map(json.loads,args.baseline_cache.read_text().splitlines())} if args.baseline_cache else {}
    jev_cache = {r['id']:r for r in map(json.loads,args.jev_cache.read_text().splitlines())} if args.jev_cache else {}
    assert all(r['fingerprint'] == fingerprint and r['prompt_version'] == INTENT_PROMPT_VERSION for r in jev_cache.values())
    assert all(r['fingerprint']==fingerprint for r in baseline_cache.values())
    client = JevClient(key, timeout_s=5, max_input_tokens=max(0, 600000-used))
    semaphore = asyncio.Semaphore(args.concurrency)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    async def one(case):
        async with semaphore:
            row = {'id':case['id'],'split':case['split'],'family':case['family'],
                   'fingerprint':fingerprint,'prompt_version':INTENT_PROMPT_VERSION,'query':case['query']}
            class RecordedManager:
                receipt = None
                async def chat(self, *a, **kw):
                    # Honor the real manager cooldown instead of racing through
                    # the dataset with zero-second blocked calls after a timeout.
                    model = llm_manager.registry.get_task_model('intent_recognition')
                    blocked = llm_manager._blocked(model, 'chat_completion')
                    if blocked:
                        await asyncio.sleep(max(0, blocked['retry_after']-time.time())+.05)
                    result = await llm_manager.chat(*a, **kw, fallback=False, total_timeout=args.baseline_timeout)
                    self.receipt = {'success':result.success,'model':result.model_used,'fallback':result.fallback_used,
                                    'usage':(result.data or {}).get('usage'),'duration_s':result.duration,
                                    'error_category':result.error_category}
                    return result
            processor = IntentProcessor()
            processor.jev_mode = 'off'
            recorder = RecordedManager()
            processor.llm_manager = recorder
            async def baseline():
                if case['id'] in baseline_cache:
                    row['baseline'] = baseline_cache[case['id']]['baseline']
                    row['baseline_timing_source'] = 'prior_live_receipt:' + str(args.baseline_cache)
                    return
                start = time.perf_counter()
                prediction = await processor.process(case['query'], case['history'], case['attachment'])
                row['baseline'] = {'prediction':prediction,'duration_s':time.perf_counter()-start,'receipt':recorder.receipt}
            async def jev():
                if case['id'] in jev_cache:
                    row['jev'] = jev_cache[case['id']]['jev']
                    row['jev_timing_source'] = 'prior_live_receipt:' + str(args.jev_cache)
                    return
                if case['history'] or case['attachment']:
                    row['jev'] = {'skipped':'context_requires_generative_handler','metadata':{'accepted':False},'duration_s':0}
                    return
                start = time.perf_counter()
                try:
                    prediction, metadata = await classify_intent(client, case['query'])
                    row['jev'] = {'prediction':prediction,'metadata':metadata,'duration_s':time.perf_counter()-start}
                except JevError as exc:
                    row['jev'] = {'error':str(exc),'metadata':{'accepted':False},'duration_s':time.perf_counter()-start}
            for fn in ([baseline, jev] if int(hashlib.sha256(case['id'].encode()).hexdigest(),16)%2 else [jev,baseline]):
                await fn()
            args.output.open('a').write(json.dumps(row,ensure_ascii=False)+'\n')
            print(case['id'], 'accepted',row['jev']['metadata']['accepted'],'baseline',round(row['baseline']['duration_s'],2),'jev',round(row['jev']['duration_s'],2),flush=True)
    selected_ids = set(json.loads(args.case_ids.read_text())) if args.case_ids else None
    pending=[c for c in cases if c['id'] not in done and (args.split=='all' or c['split']==args.split)
             and (selected_ids is None or c['id'] in selected_ids)
             and (not args.repair_baseline_only or (c['id'] in jev_cache and not (jev_cache[c['id']]['baseline'].get('receipt') or {}).get('success')))
             and (not args.baseline_cache or c['id'] in baseline_cache)][:args.max_cases]
    # Small bounded chunks: a provider failure halts further admission.
    for i in range(0,len(pending),args.concurrency):
        await asyncio.gather(*(one(c) for c in pending[i:i+args.concurrency]))
        current=list(map(json.loads,args.output.read_text().splitlines()))
        new_ids = {c['id'] for c in pending[i:i+args.concurrency]}
        if any(r.get('jev',{}).get('error') for r in current if r['id'] in new_ids):
            print('Stopped after provider error; inspect receipts.',flush=True)
            break


def report(args,cases,fingerprint):
    rows=list(map(json.loads,args.output.read_text().splitlines()))
    assert all(r['fingerprint']==fingerprint for r in rows)
    labels={c['id']:c for c in cases}
    fields=['visual_intent','audio_intent','video_intent']
    out={'fingerprint':fingerprint,'completed':len(rows),'groups':{},'errors':[],
         'cost_jev_usd':sum(r['jev']['metadata'].get('estimated_usd',0) for r in rows if not r.get('jev_timing_source')),
         'cached_jev_predictions':sum(bool(r.get('jev_timing_source')) for r in rows),
         'comparison_scope':'Quality/latency below use successful baseline responses only; v2-analysis.json additionally retains failure-inclusive policies and supplemental comparisons.',
         'latency_scope':'Counterfactual sum of stage timings, not live sequential adaptive execution.'}
    for split in ['dev','test']:
        group=[r for r in rows if r['split']==split]
        if not group:continue
        report={'n':len(group),'accepted':sum(r['jev']['metadata']['accepted'] for r in group),
                'successful_baseline_n':0,'accepted_with_successful_baseline':0,
                'unsafe_complex_acceptance':[], 'regressions':[]}
        correctness={m:[] for m in ['baseline','jev_raw','adaptive']}
        latency={m:[] for m in ['baseline','adaptive']}
        for r in group:
            if not (r['baseline'].get('receipt') or {}).get('success'):
                out['errors'].append(r['id']);continue
            gold=labels[r['id']]['labels'];baseline=r['baseline']['prediction'];j=r['jev'].get('prediction')
            accepted=r['jev']['metadata']['accepted']
            report['successful_baseline_n']+=1
            report['accepted_with_successful_baseline']+=accepted
            latency['baseline'].append(r['baseline']['duration_s'])
            latency['adaptive'].append(r['jev']['duration_s']+(0 if accepted else r['baseline']['duration_s']))
            if gold.get('is_complex') and accepted:report['unsafe_complex_acceptance'].append(r['id'])
            if gold.get('must_fallback'):
                assert not accepted
                continue
            for mode,pred in [('baseline',baseline),('jev_raw',j),('adaptive',j if accepted else baseline)]:
                if pred is None:continue
                correct=all(pred[f]==gold[f] for f in fields)
                correctness[mode].append(correct)
            if accepted and all(baseline[f]==gold[f] for f in fields) and any(j[f]!=gold[f] for f in fields):report['regressions'].append(r['id'])
        report['modality_exact_accuracy']={m:statistics.mean(v) if v else None for m,v in correctness.items()}
        report['latency']={m:{'p50':percentile(v,.5),'p95':percentile(v,.95),'mean':statistics.mean(v)} for m,v in latency.items()}
        out['groups'][split]=report
    args.report.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(out,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live',action='store_true');p.add_argument('--provider-env',type=Path);p.add_argument('--key-file',type=Path)
    p.add_argument('--split',choices=['dev','test','all'],default='dev');p.add_argument('--max-cases',type=int,default=30)
    p.add_argument('--concurrency',type=int,default=3)
    p.add_argument('--baseline-cache',type=Path)
    p.add_argument('--jev-cache',type=Path)
    p.add_argument('--repair-baseline-only',action='store_true')
    p.add_argument('--case-ids',type=Path)
    p.add_argument('--baseline-timeout',type=float,default=180)
    p.add_argument('--resume-after-error',action='store_true')
    p.add_argument('--output',type=Path,default=ROOT/'docs/research/jev-v2/results/intent-dev1.jsonl')
    p.add_argument('--report',type=Path,default=ROOT/'docs/research/jev-v2/results/intent-dev1-summary.json')
    a=p.parse_args();raw=(ROOT/'evals/jev_v2/intent/cases.jsonl').read_bytes();fingerprint=hashlib.sha256(raw).hexdigest()
    assert json.loads((ROOT/'evals/jev_v2/intent/manifest.json').read_text())['sha256']==fingerprint
    cases=list(map(json.loads,raw.splitlines()))
    if a.live:asyncio.run(run(a,cases,fingerprint))
    report(a,cases,fingerprint)
