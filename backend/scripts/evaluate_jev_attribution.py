"""Freeze/replay citation-attribution perturbations of six prior real answers."""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
OUT=ROOT/'docs/research/jev-v4'
DATA=ROOT/'evals/jev_v4/attribution'


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []


def freeze():
    from app.modules.generation.jev_answer_audit import extract_citation_units
    source=ROOT/'docs/research/jev-v2/results/system-paired.jsonl'
    cases=[]
    for row in read(source):
        if not row.get('generation'): continue
        g=row['generation']; answer=g['answer']; original=extract_citation_units(answer)['units']
        if row['id']=='system-00':
            wrong=re.sub(r'\[\d+\]', '[1]' if row['mode']=='off' else '[2]',answer)
            mutated=answer.replace('600','900')
        elif row['id']=='system-08':
            wrong=re.sub(r'\[(\d+)\]',lambda m: '[1]' if m[1]=='9' else '[9]',answer)
            mutated=answer.replace('48小时','48天').replace('365天','36天')
        else:
            wrong=re.sub(r'\[\d+\]','[9]',answer)
            mutated=answer.replace('2500','3500')
        for variant,text in [('original',answer),('wrong_citation',wrong),('mutated_fact',mutated),
                             ('missing_id',re.sub(r'\[\d+\]','[999]',answer)),
                             ('uncited',re.sub(r'\[\d+\]','',answer))]:
            units=extract_citation_units(text)['units']
            assert variant=='uncited' or len(units)==len(original)
            labels=[(variant=='original' or variant=='mutated_fact' and u['claim']==original[i]['claim']) for i,u in enumerate(units)]
            cases.append({'id':row['id']+'-'+row['mode']+'-'+variant,'family':row['id'],
                          'variant':variant,'answer':text,'references':g['reference_map'],
                          'expected_support':labels,'frozen_units':units,
                          'source_receipt_sha256':sha(source)})
    DATA.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    path=DATA/'cases.jsonl'
    raw=''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in cases)
    if path.exists() and path.read_text()!=raw: raise ValueError('Refusing to overwrite frozen data')
    path.write_text(raw)
    manifest={'sha256':sha(path),'answers':len(cases),'source_sha256':sha(source),
              'labeling':'Assistant predeclared binary support labels; original and unchanged units supported; altered facts and wrong sources unsupported.',
              'scope':'Six existing live answers, five variants each; correlated stress test, not independent holdout.'}
    (DATA/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest,indent=2))


async def run(args):
    from app.core.llm.jev import JevClient
    from app.modules.generation.jev_answer_audit import audit_answer,extract_citation_units
    rows=read(args.output);cases=read(DATA/'cases.jsonl')
    fingerprint=sha(DATA/'cases.jsonl')
    modules=['backend/app/modules/generation/jev_answer_audit.py','backend/app/modules/generation/jev_citations.py']
    hashes={p:sha(ROOT/p) for p in modules}
    assert all(r['fingerprint']==fingerprint and r['module_sha256']==hashes for r in rows)
    assert args.continue_pending_after_review or not any(r.get('unresolved_error') for r in rows), 'Inspect prior failure before further calls'
    done={r['id'] for r in rows}
    used=max((r['reserved_input_tokens'] for r in rows),default=0)
    key=re.split(r'[:=：]',args.key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    client=JevClient(key,timeout_s=5,max_input_tokens=max(0,200000-used))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    for c in cases:
        if c['id'] in done:continue
        assert extract_citation_units(c['answer'])['units']==c['frozen_units']
        result=await audit_answer(client,c['answer'],c['references'],timeout_s=5)
        errors=[u['result'].get('reason') for u in result['units'] if u['result']['status']!='evaluated']
        unresolved=any(e!='missing_reference' for e in errors)
        row={'id':c['id'],'variant':c['variant'],'fingerprint':fingerprint,'module_sha256':hashes,
             'result':result,'reserved_input_tokens':used+client.reserved_input_tokens,'unresolved_error':unresolved}
        with args.output.open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(c['id'],result['coverage'],flush=True)
        if unresolved:break


def report(args):
    cases={c['id']:c for c in read(DATA/'cases.jsonl')};rows=read(args.output)
    assert len({r['id'] for r in rows})==len(rows)
    groups={};tokens=0
    for r in rows:
        c=cases[r['id']];result=r['result']
        assert r['fingerprint']==sha(DATA/'cases.jsonl')
        group=groups.setdefault(c['variant'],{'answers':0,'units':0,'evaluated':0,'true_support':0,'false_support':0,'expected_support':0,'unattributed_spans':0,'reasons':Counter()})
        group['answers']+=1;group['units']+=len(result['units']);group['unattributed_spans']+=len(result['gaps'])
        assert len(result['units'])==len(c['expected_support'])
        for u,gold in zip(result['units'],c['expected_support']):
            d=u['result']; signal=d.get('choice_support_signal',False)
            group['expected_support']+=gold;group['evaluated']+=d['status']=='evaluated'
            group['true_support']+=bool(signal and gold);group['false_support']+=bool(signal and not gold)
            if d.get('reason'):group['reasons'][d['reason']]+=1
            tokens+=d.get('metadata',{}).get('usage',{}).get('input_tokens',0)
    out={'completed_answers':len(rows),'expected_answers':len(cases),'groups':groups,'reported_input_tokens':tokens,
         'estimated_input_usd':tokens*.042/1e6,'unknown_error_answers':[r['id'] for r in rows if r['unresolved_error']],
         'budget_accounted_input_tokens':max((r['reserved_input_tokens'] for r in rows),default=0),
         'budget_accounted_input_usd':max((r['reserved_input_tokens'] for r in rows),default=0)*.042/1e6,
         'scope':'Correlated answer perturbations and real Jev calls. Not a production distribution or new retrieval run.'}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(out,ensure_ascii=False,indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--freeze',action='store_true');p.add_argument('--live',action='store_true')
    p.add_argument('--provider-env',type=Path);p.add_argument('--key-file',type=Path)
    p.add_argument('--continue-pending-after-review',action='store_true',help='Keep all prior failures and reservations; admit only previously unattempted cases')
    p.add_argument('--output',type=Path,default=OUT/'results/attribution.jsonl');p.add_argument('--report',type=Path,default=OUT/'results/attribution-summary.json')
    args=p.parse_args()
    if args.provider_env:
        from dotenv import load_dotenv
        load_dotenv(args.provider_env,override=False)
    if args.freeze:freeze()
    if args.live:asyncio.run(run(args))
    if not args.freeze or args.live:report(args)


if __name__=='__main__':main()
