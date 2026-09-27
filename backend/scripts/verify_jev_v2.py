"""Validate frozen inputs and complete receipts, without making model calls."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/research/jev-v2/results'


def read(path):return [json.loads(x) for x in path.read_text().splitlines()]
def normalized(q):return ''.join(unicodedata.normalize('NFKC',q).lower().split())


def verify(test_log=None):
    sources=json.loads((OUT.parent/'sources.json').read_text())
    for source in sources:
        if source.get('path'):assert hashlib.sha256((OUT.parent/source['path']).read_bytes()).hexdigest()==source['sha256']
    for name,count in [('intent',120),('rerank',300)]:
        path=ROOT/'evals/jev_v2'/name;manifest=json.loads((path/'manifest.json').read_text());data=read(path/'cases.jsonl')
        assert len(data)==count and len({x['id'] for x in data})==count
        assert hashlib.sha256((path/'cases.jsonl').read_bytes()).hexdigest()==manifest['sha256']
    rerank=read(ROOT/'evals/jev_v2/rerank/cases.jsonl')
    old={normalized(c['query']) for c in read(ROOT/'evals/jev_v1/cases.jsonl')}
    assert not old&{normalized(c['query']) for c in rerank}
    pairs=read(OUT/'rerank-paired.jsonl');assert len(pairs)==len({c['id'] for c in pairs})==300
    intents=read(ROOT/'evals/jev_v2/intent/cases.jsonl')
    families={}
    for c in intents:families.setdefault(c['family'],set()).add(c['split'])
    assert all(len(v)==1 for v in families.values())
    holdout=read(OUT/'intent-holdout.jsonl');assert len(holdout)==len({c['id'] for c in holdout})==90
    repairs=read(OUT/'intent-holdout-repair.jsonl')+read(OUT/'intent-holdout-repair-late.jsonl')
    by_id={x['id']:x for x in holdout}
    assert len({r['id'] for r in repairs})==len(repairs)==77
    for r in repairs:
        assert r['jev']==by_id[r['id']]['jev']
        assert not by_id[r['id']]['baseline']['receipt']['success']
    system=read(OUT/'system-paired.jsonl');assert len(system)==len({(x['id'],x['mode']) for x in system})==24
    assert all(x['scope_valid'] for x in system)
    assert all(x['evidence'] for x in system)
    generation=[x['generation'] for x in system if 'generation' in x]
    assert len(generation)==6 and all(x['success'] for x in generation)
    http=json.loads((OUT/'http-smoke.json').read_text());assert http['scope_valid'] and http['evaluation_mode']
    subprocess.run(['git','diff','--check'],cwd=ROOT,check=True)
    passed = None
    if test_log is not None:
        tests = test_log.read_text()
        summaries = re.findall(r'^.*\b\d+ passed\b.*$', tests, re.MULTILINE)
        assert summaries, 'No pytest completion summary in supplied test log'
        summary = summaries[-1]
        assert not re.search(r'\b\d+ (?:failed|errors?|deselected)\b', summary), summary
        passed = int(re.search(r'(\d+) passed', summary).group(1))
    return {'source_entries':len(sources),'dataset_counts':{'rerank':300,'intent':120,'system':12},'no_v1_query_overlap':True,'intent_family_split_disjoint':True,'frozen_jev_predictions_reused_for_77_baseline_supplements':True,'real_system_paired_runs':24,'generation_runs':6,'http_scope_passed':True,'regression_tests_passed':passed,'diff_check_passed':True,'scope':'Artifact integrity checks of historical receipts, not new model calls. Test results are checked only when a log is explicitly supplied; not a general semantic correctness proof.'}

if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-log', type=Path, help='Optional completed pytest log; never assumes a local /tmp file')
    parser.add_argument('--output', type=Path, help='Optional new receipt path; refuses to replace historical evidence')
    args = parser.parse_args()
    result = verify(args.test_log)
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x') as stream:
            stream.write(rendered)
    print(rendered, end='')
