"""Paired live experiments separating structured representation and batching."""
import argparse
import asyncio
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import random
import re
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
DATA = ROOT/'evals/jev_v5/batching'
OUT = ROOT/'docs/research/jev-v5'
MODES = ['current', 'structured_single', 'batch', 'batch_background']


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []
def percentile(values, p):
    if not values: return None
    v=sorted(values);i=(len(v)-1)*p;lo=int(i)
    return v[lo]+(v[min(lo+1,len(v)-1)]-v[lo])*(i-lo)


async def run(args):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env, override=False)
    from loguru import logger
    logger.remove()
    from app.core.llm.jev import JevClient, JevError
    from app.modules.generation.jev_citations import audit_claim
    from scripts.jev_batch_candidate import build_questions, evaluate_batch, VERSION
    cases=read(DATA/'cases.jsonl');fp=sha(DATA/'cases.jsonl')
    assert fp==json.loads((DATA/'manifest.json').read_text())['sha256']
    hashes={p:sha(ROOT/p) for p in ['backend/scripts/jev_batch_candidate.py','backend/app/modules/generation/jev_citations.py']}
    prior=read(args.output)
    assert all(r['fingerprint']==fp and r['module_sha256']==hashes for r in prior)
    assert len({(r['id'],r['mode']) for r in prior})==len(prior)
    if not args.continue_pending_after_review and any(r['status']!='evaluated' for r in prior):
        raise ValueError('Inspect failures; only explicit continuation of unattempted pairs is allowed')
    used=max((r['budget_accounted_tokens'] for r in prior),default=0)
    key=re.split(r'[:=：]',args.key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    client=JevClient(key,timeout_s=5,max_input_tokens=max(0,300000-used))
    completed={(r['id'],r['mode']) for r in prior}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    for c in cases:
        order=list(MODES);random.Random(c['id']).shuffle(order)
        for mode in order:
            if (c['id'],mode) in completed:continue
            start=time.perf_counter();row={'id':c['id'],'split':c['split'],'family':c['family'],
                'mode':mode,'fingerprint':fp,'module_sha256':hashes,'request_count':0}
            if mode in {'current','structured_single'}:
                async def one(index,unit):
                    row['request_count']+=1
                    if mode=='current':
                        result=await audit_claim(client,unit['claim'],list(unit['cited_sources']),unit['cited_sources'])
                        if result['status']!='evaluated':return result
                        return {'status':'evaluated','choice':result['answers']['relation'],
                                'support_signal':result['choice_support_signal'],'metadata':result['metadata']}
                    questions=build_questions(c['units'])
                    name=f'u{index}'
                    try:
                        result=await client.evaluate({}, {name:questions[name]},prompt_version=VERSION+'-isolated')
                    except JevError as exc:return {'status':'not_evaluated','reason':str(exc)}
                    answer=result.answers[name]
                    return {'status':'evaluated','choice':answer,'metadata':result.metadata(),
                            'support_signal':answer['choice']=='supported' and answer['probabilities']['supported']>=.8}
                row['units']=await asyncio.gather(*(one(i,u) for i,u in enumerate(c['units'])))
                row['status']='evaluated' if all(u['status']=='evaluated' for u in row['units']) else 'not_evaluated'
                row['reported_input_tokens']=sum(u.get('metadata',{}).get('usage',{}).get('input_tokens',0) for u in row['units'])
            else:
                row['request_count']=1
                result=await evaluate_batch(client,c['units'],with_background=mode=='batch_background')
                row.update(result)
                row['reported_input_tokens']=result.get('metadata',{}).get('usage',{}).get('input_tokens',0)
            row.update(duration_s=time.perf_counter()-start,budget_accounted_tokens=used+client.reserved_input_tokens)
            with args.output.open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
            print(c['id'],mode,row['status'],round(row['duration_s'],3),flush=True)
            if row['status']!='evaluated':return


def report(args):
    cases={c['id']:c for c in read(DATA/'cases.jsonl')};rows=read(args.output)
    assert len({(r['id'],r['mode']) for r in rows})==len(rows)
    assert all(r['fingerprint']==sha(DATA/'cases.jsonl') for r in rows)
    groups={}
    for split in ['dev','test']:
        groups[split]={}
        for mode in MODES:
            rs=[r for r in rows if r['split']==split and r['mode']==mode]
            g={'attempted_cases':len(rs),'expected_cases':sum(c['split']==split for c in cases.values()),
               'successful_cases':sum(r['status']=='evaluated' for r in rs),'evaluated_units':0,
               'supported_units':0,'unsupported_units':0,'true_support':0,'false_support':0,'false_support_ids':[],
               'missed_support_ids':[], 'reported_input_tokens':sum(r['reported_input_tokens'] for r in rs),
               'attempted_requests':sum(r['request_count'] for r in rs),
               'p50_s':percentile([r['duration_s'] for r in rs],.5),
               'p95_s':percentile([r['duration_s'] for r in rs],.95)}
            for r in rs:
                for i,gold in enumerate(cases[r['id']]['units']):
                    g['supported_units' if gold['supported'] else 'unsupported_units']+=1
                    pred=r['units'][i] if i<len(r['units']) else {}
                    evaluated=bool(pred.get('choice'));g['evaluated_units']+=evaluated
                    signal=pred.get('support_signal',False)
                    if signal and gold['supported']:g['true_support']+=1
                    elif signal:g['false_support']+=1;g['false_support_ids'].append([r['id'],i])
                    elif gold['supported']:g['missed_support_ids'].append([r['id'],i])
            g['support_recall']=g['true_support']/g['supported_units'] if g['supported_units'] else None
            groups[split][mode]=g
    pair={}
    by_key={(r['id'],r['mode']):r for r in rows}
    for mode in ['batch','batch_background']:
        valid=[(by_key[(i,'structured_single')],by_key[(i,mode)]) for i,c in cases.items() if c['split']=='test'
               and (i,'structured_single') in by_key and (i,mode) in by_key
               and by_key[(i,'structured_single')]['status']==by_key[(i,mode)]['status']=='evaluated']
        deltas=defaultdict(list)
        for a,b in valid:deltas[a['family']].append(b['duration_s']-a['duration_s'])
        rng=random.Random(20260922);families=list(deltas)
        means=[]
        if families:
            for _ in range(2000):
                sampled=[v for f in rng.choices(families,k=len(families)) for v in deltas[f]]
                means.append(statistics.mean(sampled))
        pair[mode]={'successful_pairs':len(valid),'families':len(families),
                    'mean_latency_difference_s':statistics.mean([b['duration_s']-a['duration_s'] for a,b in valid]) if valid else None,
                    'family_bootstrap_95_interval_s':[percentile(means,.025),percentile(means,.975)],
                    'classification_disagreements':sum(a['units'][i]['choice']['choice']!=b['units'][i]['choice']['choice'] for a,b in valid for i in range(len(a['units'])))}
    result={'groups':groups,'paired_against_structured_single_test':pair,
            'observed_input_usd':sum(r['reported_input_tokens'] for r in rows)*.042/1e6,
            'budget_accounted_tokens':max((r['budget_accounted_tokens'] for r in rows),default=0),
            'failures':[{'id':r['id'],'mode':r['mode'],'reason':r.get('reason'),
                         'unit_reasons':[u.get('reason') for u in r['units'] if u.get('reason')]} for r in rows if r['status']!='evaluated'],
            'scope':'Authored grouped stress set and known dev replay. Success-paired latency is not failure-inclusive deployment latency.'}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--live',action='store_true')
    p.add_argument('--provider-env',type=Path);p.add_argument('--key-file',type=Path)
    p.add_argument('--continue-pending-after-review',action='store_true')
    p.add_argument('--output',type=Path,default=OUT/'results/batching.jsonl')
    p.add_argument('--report',type=Path,default=OUT/'results/batching-summary.json')
    args=p.parse_args()
    if args.live:asyncio.run(run(args))
    report(args)
