"""Paired live experiments separating structured representation and batching."""
import argparse
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import random
import re
import statistics
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
DATA = ROOT/'evals/jev_v5/batching'
OUT = ROOT/'docs/research/jev-v5'
MODES = ['current', 'structured_single', 'batch', 'batch_background']
MODEL = 'jev-1.13.0'
TIMEOUT_S = 5
MAX_INPUT_TOKENS = 300000
INPUT_USD_PER_MILLION = .042
EXECUTION_FILES = [
    'backend/scripts/jev_batch_candidate.py',
    'backend/app/modules/generation/jev_citations.py',
    'backend/app/core/llm/jev.py',
    'backend/scripts/evaluate_jev_batching.py',
]


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []
def percentile(values, p):
    if not values: return None
    v=sorted(values);i=(len(v)-1)*p;lo=int(i)
    return v[lo]+(v[min(lo+1,len(v)-1)]-v[lo])*(i-lo)


def ledger_paths(output):
    return Path(str(output)+'.execution.json'), Path(str(output)+'.pending.json')


def _sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _durable_create(path, value):
    # Exclusive creation prevents overlapping unresolved request groups.
    # A crash during creation leaves a marker that must be reviewed, never replaced.
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    _sync_directory(path.parent)


def execution_spec(fingerprint, support_threshold):
    return {
        'dataset_sha256': fingerprint,
        'module_sha256': {path: sha(ROOT/path) for path in EXECUTION_FILES},
        'model': MODEL, 'support_threshold': support_threshold,
        'timeout_s': TIMEOUT_S, 'max_input_tokens': MAX_INPUT_TOKENS,
        'input_usd_per_million': INPUT_USD_PER_MILLION, 'modes': MODES,
    }


def prepare_execution(output, spec):
    """Require a manifest created before this run and no unresolved paid work."""
    manifest_path, pending_path = ledger_paths(output)
    if pending_path.exists():
        raise ValueError(
            'Unresolved pending request group: billing and completion are unknown. '
            'Stop this run, review provider/receipt evidence, and choose a new experiment '
            'if needed. Automatic continuation or retry is forbidden.'
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if (manifest.get('schema_version') != 1 or manifest.get('spec') != spec
                or manifest.get('output') != str(output.resolve())):
            raise ValueError('Execution manifest differs from current code/configuration; use a new output path')
    else:
        if output.exists():
            raise ValueError('Existing receipts have no prior execution manifest: offline reporting only; use a new output path')
        manifest = {
            'schema_version': 1, 'execution_id': str(uuid.uuid4()),
            'created_at': datetime.now(timezone.utc).isoformat(),
            'output': str(output.resolve()), 'spec': spec,
        }
        _durable_create(manifest_path, manifest)
    return manifest


def _complete_group(output, row, pending_path):
    with output.open('a') as stream:
        stream.write(json.dumps(row, ensure_ascii=False)+'\n')
        stream.flush()
        os.fsync(stream.fileno())
    _sync_directory(output.parent)
    # Only a durable receipt resolves the marker. A crash before unlink remains
    # deliberately blocked even if a matching receipt exists; do not infer billing.
    pending_path.unlink()
    _sync_directory(pending_path.parent)


async def run(args):
    """Keep one live writer; unresolved work is detected, never auto-reconciled."""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Keep this inode after release. Unlinking a lock file permits another process
    # to lock a different inode while an existing file descriptor still owns it.
    with Path(str(args.output)+'.lock').open('a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another live evaluator owns this output; concurrent execution is forbidden') from None
        try:
            return await _run_locked(args)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


async def _run_locked(args):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env, override=False)
    from loguru import logger
    logger.remove()
    from app.core.llm.jev import JevClient, JevError
    from app.modules.generation.jev_citations import audit_claim, SUPPORT_THRESHOLD
    from scripts.jev_batch_candidate import build_questions, evaluate_batch, VERSION
    cases=read(DATA/'cases.jsonl');fp=sha(DATA/'cases.jsonl')
    assert fp==json.loads((DATA/'manifest.json').read_text())['sha256']
    spec=execution_spec(fp, SUPPORT_THRESHOLD)
    execution=prepare_execution(args.output, spec)
    hashes=spec['module_sha256']
    _,pending_path=ledger_paths(args.output)
    prior=read(args.output)
    assert all(r['fingerprint']==fp and r['module_sha256']==hashes
               and r.get('execution_id')==execution['execution_id'] for r in prior)
    assert len({(r['id'],r['mode']) for r in prior})==len(prior)
    if not args.continue_pending_after_review and any(r['status']!='evaluated' for r in prior):
        raise ValueError('Inspect failures; only explicit continuation of unattempted pairs is allowed')
    used=max((r['budget_accounted_tokens'] for r in prior),default=0)
    key=re.split(r'[:=：]',args.key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    client=JevClient(key,model=MODEL,timeout_s=TIMEOUT_S,max_input_tokens=max(0,MAX_INPUT_TOKENS-used))
    completed={(r['id'],r['mode']) for r in prior}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    for c in cases:
        order=list(MODES);random.Random(c['id']).shuffle(order)
        for mode in order:
            if (c['id'],mode) in completed:continue
            _durable_create(pending_path, {
                'execution_id': execution['execution_id'], 'id': c['id'], 'mode': mode,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'budget_accounted_tokens_before_group': used+client.reserved_input_tokens,
                'billing_status': 'unknown_until_durable_receipt',
            })
            start=time.perf_counter();row={'id':c['id'],'split':c['split'],'family':c['family'],
                'mode':mode,'fingerprint':fp,'module_sha256':hashes,'request_count':0,
                'execution_id':execution['execution_id']}
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
                            'support_signal':answer['choice']=='supported' and answer['probabilities']['supported']>=SUPPORT_THRESHOLD}
                row['units']=await asyncio.gather(*(one(i,u) for i,u in enumerate(c['units'])))
                row['status']='evaluated' if all(u['status']=='evaluated' for u in row['units']) else 'not_evaluated'
                row['reported_input_tokens']=sum(u.get('metadata',{}).get('usage',{}).get('input_tokens',0) for u in row['units'])
            else:
                row['request_count']=1
                result=await evaluate_batch(client,c['units'],with_background=mode=='batch_background')
                row.update(result)
                row['reported_input_tokens']=result.get('metadata',{}).get('usage',{}).get('input_tokens',0)
            row.update(duration_s=time.perf_counter()-start,budget_accounted_tokens=used+client.reserved_input_tokens)
            _complete_group(args.output, row, pending_path)
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
        changes=[{'id':a['id'], 'unit_index':i,
                  'baseline_signal':a['units'][i]['support_signal'],
                  'candidate_signal':b['units'][i]['support_signal'],
                  'gold_supported':cases[a['id']]['units'][i]['supported']}
                 for a,b in valid for i in range(len(a['units']))
                 if a['units'][i]['support_signal']!=b['units'][i]['support_signal']]
        pair[mode].update(support_signal_disagreements=len(changes),
                          support_signal_disagreement_ids=[[c['id'],c['unit_index']] for c in changes],
                          support_signal_changes=changes)
    observed_tokens=sum(r['reported_input_tokens'] for r in rows)
    budget_tokens=max((r['budget_accounted_tokens'] for r in rows),default=0)
    unconfirmed_tokens=max(0,budget_tokens-observed_tokens)
    manifest_path,pending_path=ledger_paths(args.output)
    result={'groups':groups,'paired_against_structured_single_test':pair,
            'observed_input_usd':observed_tokens*INPUT_USD_PER_MILLION/1e6,
            'budget_accounted_tokens':budget_tokens,
            'budget_accounted_usd':budget_tokens*INPUT_USD_PER_MILLION/1e6,
            'unconfirmed_reserved_tokens':unconfirmed_tokens,
            'unconfirmed_reserved_usd':unconfirmed_tokens*INPUT_USD_PER_MILLION/1e6,
            'unresolved_pending_group':pending_path.exists(),
            'billing_total_unknown':bool(unconfirmed_tokens or pending_path.exists()),
            'billing_scope':('Observed USD uses provider-reported input usage from successful receipts. '
                             'Budget USD also includes conservative reservations for failures and is not an invoice. '
                             'An unresolved pending group may have incurred additional unrecorded charges; '
                             'neither estimate proves the final bill.'),
            'attempted_requests_definition':('Client invocation attempts, including possible local validation, '
                                             'budget or circuit rejections; not verified server-received requests.'),
            'execution_manifest_status':'present' if manifest_path.exists() else 'absent_legacy_offline_only',
            'failures':[{'id':r['id'],'mode':r['mode'],'reason':r.get('reason'),
                         'unit_reasons':[u.get('reason') for u in r['units'] if u.get('reason')]} for r in rows if r['status']!='evaluated'],
            'scope':'Authored grouped stress set and known dev replay. Success-paired latency is not failure-inclusive deployment latency.'}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--live',action='store_true')
    p.add_argument('--provider-env',type=Path);p.add_argument('--key-file',type=Path)
    p.add_argument('--continue-pending-after-review',action='store_true',
                   help='Continue only unattempted pairs after recorded failures; never override an unresolved pending group')
    p.add_argument('--output',type=Path,default=OUT/'results/batching.jsonl')
    p.add_argument('--report',type=Path,default=OUT/'results/batching-summary.json')
    args=p.parse_args()
    if args.live:asyncio.run(run(args))
    report(args)
