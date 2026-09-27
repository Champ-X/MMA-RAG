"""Live citation diagnostics; offline summaries reuse immutable raw decisions."""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))

DATA = ROOT/'evals/jev_v3/citations'
RESULTS = ROOT/'docs/research/jev-v3/results'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_rows(path):
    return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []


def percentile(values, q):
    if not values: return None
    v = sorted(values); index = (len(v)-1)*q; lo = int(index)
    return v[lo]+(v[min(lo+1,len(v)-1)]-v[lo])*(index-lo)


async def run(args, cases, fingerprint, prompt_hash, code_hash):
    if args.provider_env:
        from dotenv import load_dotenv
        load_dotenv(args.provider_env, override=False)
    from app.core.llm.jev import JevClient
    from app.modules.generation.jev_citations import audit_claim, citation_questions
    assert digest(json.dumps(citation_questions(),sort_keys=True,ensure_ascii=False).encode())==prompt_hash
    previous = read_rows(args.output)
    if any(r['result']['status'] == 'not_evaluated' and r['split'] != 'structural' for r in previous):
        raise ValueError('Prior unresolved error: preserve this run and inspect it before any further live calls')
    key = os.environ.get('TYPESAFE_API_KEY', '')
    if args.key_file:
        key = re.split(r'[:=：]', args.key_file.read_text().strip(), maxsplit=1)[-1].strip().strip("\"'")
    if not key: raise ValueError('No TypeSafe key configured')
    used = sum(r['result'].get('metadata',{}).get('usage',{}).get('input_tokens',0) for r in previous)
    client = JevClient(key, timeout_s=5, max_input_tokens=max(0,args.max_input_tokens-used))
    done = {r['id'] for r in previous}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for c in cases:
        if c['id'] in done: continue
        started = time.perf_counter()
        result = await audit_claim(client, c['claim'], c['citation_ids'], c['references'])
        row = {'id': c['id'], 'split': c['split'], 'family': c['family'],
               'fingerprint': fingerprint, 'prompt_sha256': prompt_hash, 'code_sha256': code_hash,
               'started_at': datetime.now(timezone.utc).isoformat(),
               'duration_s': time.perf_counter()-started, 'result': result,
               'reserved_input_tokens_cumulative': used+client.reserved_input_tokens}
        with args.output.open('a') as f: f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(c['id'], result['status'], result.get('answers',{}).get('relation',{}).get('choice',result.get('reason')), flush=True)
        if result['status'] != 'evaluated' and c['split'] != 'structural': break


def report(rows, cases):
    labels = {c['id']:c for c in cases}; groups = {}
    for split in ['dev','test','replay','structural']:
        rs = [r for r in rows if r['split']==split]
        if not rs: continue
        group = {'n':len(rs), 'expected_n':sum(c['split']==split for c in cases)}
        if split == 'structural':
            group['correct_rejections'] = sum(r['result'].get('reason')==labels[r['id']]['label'] for r in rs)
            groups[split] = group; continue
        valid = [r for r in rs if r['result']['status']=='evaluated']
        group['successful_calls'] = len(valid)
        group['three_class_correct'] = sum(r['result']['answers']['relation']['choice']==labels[r['id']]['label'] for r in valid)
        group['confusion'] = dict(Counter(labels[r['id']]['label']+'->'+r['result']['answers']['relation']['choice'] for r in valid))
        group['latency_s'] = {'p50':percentile([r['duration_s'] for r in rs],.5),
                              'p95':percentile([r['duration_s'] for r in rs],.95)}
        group['policies'] = {}
        for policy in ['ids_exist','choice_support_signal','factorized_support_signal']:
            support = []; errors = []
            for r in rs:
                c = labels[r['id']]
                signaled = (bool(c['citation_ids']) and all(i in c['references'] for i in c['citation_ids'])) if policy=='ids_exist' else r['result'].get(policy,False)
                support.append((c['label']=='supported',signaled))
                if signaled and c['label']!='supported':errors.append(c['id'])
            tp = sum(g and p for g,p in support); fp = sum(not g and p for g,p in support)
            positives = sum(g for g,p in support); negatives = len(support)-positives
            group['policies'][policy] = {'true_supports': tp, 'false_supports': fp,
                'supported_n': positives, 'unsupported_n': negatives,
                'support_precision': tp/(tp+fp) if tp+fp else None,
                'support_recall': tp/positives if positives else None,
                'false_support_rate': fp/negatives if negatives else None,
                'false_support_ids':errors}
        group['misclassifications'] = [r['id'] for r in valid if r['result']['answers']['relation']['choice']!=labels[r['id']]['label']]
        groups[split] = group
    usage = sum(r['result'].get('metadata',{}).get('usage',{}).get('input_tokens',0) for r in rows)
    return {'groups':groups,'reported_input_tokens':usage,'estimated_input_usd':usage*.042/1e6,
            'reserved_input_tokens':max((r['reserved_input_tokens_cumulative'] for r in rows),default=0),
            'limitations':['Authored small challenge set; no independent annotations or production distribution.',
                           'Two decisions in the same request are correlated, not independent judges.',
                           'Replay uses unions of cited sources for whole answers, not sentence attribution.',
                           'No automatic answer edits, rejection, or production generation integration.']}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live',action='store_true');p.add_argument('--key-file',type=Path)
    p.add_argument('--provider-env',type=Path,help='Project settings file, required only for live module imports when no environment is configured')
    p.add_argument('--max-input-tokens',type=int,default=200000)
    p.add_argument('--output',type=Path,default=RESULTS/'citations.jsonl')
    p.add_argument('--report',type=Path,default=RESULTS/'summary.json')
    args=p.parse_args();raw=(DATA/'cases.jsonl').read_bytes();fp=digest(raw)
    assert json.loads((DATA/'manifest.json').read_text())['sha256']==fp
    protocol=json.loads((RESULTS.parent/'protocol.json').read_text())
    prompt_hash=digest(json.dumps(protocol['questions'],sort_keys=True,ensure_ascii=False).encode())
    code_hash=digest((ROOT/'backend/app/modules/generation/jev_citations.py').read_bytes())
    cases=[json.loads(l) for l in raw.splitlines()];known={c['id'] for c in cases}
    rows=read_rows(args.output)
    assert len({r['id'] for r in rows})==len(rows)
    assert all(r['fingerprint']==fp and r['prompt_sha256']==prompt_hash and r['code_sha256']==code_hash and r['id'] in known for r in rows)
    if args.live:asyncio.run(run(args,cases,fp,prompt_hash,code_hash))
    output=report(read_rows(args.output),cases)
    output.update(fingerprint=fp,prompt_sha256=prompt_hash,code_sha256=code_hash,prompt_version=protocol['prompt_version'])
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
