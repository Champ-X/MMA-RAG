"""Failure-inclusive summaries, paired intervals and cost bounds from receipts only."""
import hashlib
import json
from pathlib import Path
import random
import statistics
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from scripts.evaluate_jev import metrics, percentile
OUT=ROOT/'docs/research/jev-v2/results'


def rows(path):return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
def latency(v):return {'n':len(v),'mean':statistics.mean(v) if v else None,'p50':percentile(v,.5),'p95':percentile(v,.95)}
def ci(v):
    if not v:return None
    rng=random.Random(20260922);boot=[statistics.mean(rng.choices(v,k=len(v))) for _ in range(3000)]
    return {'mean':statistics.mean(v),'bootstrap95':[percentile(boot,.025),percentile(boot,.975)]}


def intent(name, records=None):
    rs=rows(OUT/(name+'.jsonl')) if records is None else records
    cases={r['id']:r for r in rows(ROOT/'evals/jev_v2/intent/cases.jsonl')}
    modalities=['visual_intent','audio_intent','video_intent'];out={'n':len(rs),'baseline_failures':[],'jev_failures':[],'accepted':0,'unsafe_complex_acceptance':[],'fallback_required_acceptance':[], 'latency_scope':'Counterfactual policy sum of separately measured stage times; see system-paired for actual sequential handler.'}
    scores={m:[] for m in ['baseline','adaptive']};dur={m:[] for m in scores};conf={m:{'explicit_total':0,'explicit_recalled':0,'unnecessary_total':0,'false_activation':0} for m in scores};paired=[];family={}
    for r in rs:
        gold=cases[r['id']]['labels'];b=r['baseline']['prediction'];j=r['jev'];accept=j['metadata']['accepted'];a=j.get('prediction') if accept else b
        out['accepted']+=accept
        if not (r['baseline'].get('receipt') or {}).get('success'):out['baseline_failures'].append(r['id'])
        if j.get('error'):out['jev_failures'].append({'id':r['id'],'reason':j['error']})
        if accept and gold.get('is_complex'):out['unsafe_complex_acceptance'].append(r['id'])
        if accept and gold.get('must_fallback'):out['fallback_required_acceptance'].append(r['id'])
        dur['baseline'].append(r['baseline']['duration_s']);dur['adaptive'].append(j['duration_s']+(0 if accept else r['baseline']['duration_s']))
        if gold.get('must_fallback'):continue
        f=family.setdefault(r['family'],{'n':0,'accepted':0,'baseline_correct':0,'adaptive_correct':0});f['n']+=1;f['accepted']+=accept
        correct={}
        for mode,pred in [('baseline',b),('adaptive',a)]:
            correct[mode]=int(all(pred[k]==gold[k] for k in modalities));scores[mode].append(correct[mode]);f[mode+'_correct']+=correct[mode]
            for k in modalities:
                if gold[k]=='explicit_demand':conf[mode]['explicit_total']+=1;conf[mode]['explicit_recalled']+=pred[k]=='explicit_demand'
                if gold[k]=='unnecessary':conf[mode]['unnecessary_total']+=1;conf[mode]['false_activation']+=pred[k]!='unnecessary'
        paired.append(correct['adaptive']-correct['baseline'])
    out.update(modality_labeled_n=len(paired),modality_exact_accuracy={k:statistics.mean(v) if v else None for k,v in scores.items()},paired_accuracy_difference=ci(paired),latency={k:latency(v) for k,v in dur.items()},modalities=conf,families=family)
    # Independently gate on unsafe takeover, never fit thresholds from these results.
    out['accepted_modality_errors']=[r['id'] for r in rs if r['jev']['metadata']['accepted'] and not cases[r['id']]['labels'].get('must_fallback') and any(r['jev']['prediction'][f]!=cases[r['id']]['labels'][f] for f in modalities)]
    successful=[r for r in rs if (r['baseline'].get('receipt') or {}).get('success') and not cases[r['id']]['labels'].get('must_fallback')]
    paired_scores={m:[] for m in ['baseline','adaptive']}
    for r in successful:
        b=r['baseline']['prediction'];a=r['jev'].get('prediction') if r['jev']['metadata']['accepted'] else b
        for m,pred in [('baseline',b),('adaptive',a)]:
            paired_scores[m].append(int(all(pred[f]==cases[r['id']]['labels'][f] for f in modalities)))
    out['successful_baseline_comparison']={'n':len(successful),'accuracy':{m:statistics.mean(v) if v else None for m,v in paired_scores.items()},'paired_difference':ci([a-b for a,b in zip(paired_scores['adaptive'],paired_scores['baseline'])])}
    if successful:
        clusters={}
        for r,a,b in zip(successful,paired_scores['adaptive'],paired_scores['baseline']):
            clusters.setdefault(r['family'],[]).append(a-b)
        rng=random.Random(20260922)
        boot=[statistics.mean(x for family in rng.choices(list(clusters),k=len(clusters)) for x in clusters[family]) for _ in range(3000)]
        out['successful_baseline_comparison']['family_cluster_bootstrap95']=[percentile(boot,.025),percentile(boot,.975)]
        out['successful_baseline_comparison']['semantic_family_n']=len(clusters)
    return out


def rerank():
    rs=rows(OUT/'rerank-paired.jsonl');cases={c['id']:c for c in rows(ROOT/'evals/jev_v2/rerank/cases.jsonl')}
    out={'n':len(rs),'all_failure_records':[{'id':r['id'],'reason':r['jev']['error']} for r in rs if r['jev'].get('error')], 'latency_scope':'Concurrent ensemble wall time measured; replacement fallback sum is counterfactual because providers were measured concurrently.'}
    group=[r for r in rs if r['split']=='test'];out['holdout_n']=len(group)
    values={mode:[] for mode in ['qwen','replace_with_fallback','ensemble_with_fallback']}
    for r in group:
        q=r['qwen'];j=r['jev'];docs=cases[r['id']]['documents'];assert not q.get('error')
        qtime=q['pipeline_duration_s'];jtime=j.get('pipeline_duration_s',j.get('duration_s',0))
        for mode in values:
            if mode=='qwen':ranking=q['ranking'];duration=qtime
            elif mode=='replace_with_fallback':ranking=q['ranking'] if j.get('error') else j['ranking'];duration=jtime+(qtime if j.get('error') else 0)
            else:
                if j.get('error'):ranking=q['ranking']
                else:
                    score={k:{s['index']:s['relevance_score'] for s in r[k]['scores']} for k in ['qwen','jev']}
                    idx=sorted(range(len(r['candidate_ids'])),key=lambda i:.7*(score['qwen'][i]+score['jev'][i])*.5+.3/(61+i),reverse=True);ranking=[r['candidate_ids'][i] for i in idx]
                duration=r['ensemble_parallel_duration_s']
            values[mode].append({**metrics(ranking,docs),'duration_s':duration})
    out['policies']={mode:{'ndcg5':statistics.mean(x['ndcg5'] for x in v),'recall5':statistics.mean(x['recall5'] for x in v),'latency':latency([x['duration_s'] for x in v])} for mode,v in values.items()}
    out['paired_ndcg_difference']={mode:ci([a['ndcg5']-b['ndcg5'] for a,b in zip(values[mode],values['qwen'])]) for mode in values if mode!='qwen'}
    return out


def system():
    rs=rows(OUT/'system-paired.jsonl');out={'runs':len(rs),'policies':{},'scope_violations':[]}
    cases={x['id']:x for x in rows(ROOT/'evals/jev_v2/system/cases.jsonl')}
    for mode in ['off','adaptive']:
        group=[r for r in rs if r['mode']==mode]
        if not group:continue
        out['policies'][mode]={'n':len(group),'recall5':statistics.mean(r['evidence_recall5'] for r in group),'latency':latency([r['duration_s'] for r in group]),'intent_latency':latency([r['debug'].get('preprocessing_stages',{}).get('intent',0) for r in group]),'jev_accepted':sum(r['debug'].get('jev_decision',{}).get('accepted',False) for r in group),'generation_n':sum('generation' in r for r in group),'generation_successes':sum(r.get('generation',{}).get('success',False) for r in group)}
        out['policies'][mode]['recall10']=statistics.mean(len({x['file_id'] for x in r['evidence'][:10]}&set(cases[r['id']]['expected_files']))/len(cases[r['id']]['expected_files']) for r in group)
    out['scope_violations']=[(r['id'],r['mode']) for r in rs if not r['scope_valid']]
    return out


def cost():
    categories={}
    # Dev1 baseline timings were reused, Jev calls in dev2 were fresh.
    for name in ['intent-dev1','intent-dev2','intent-holdout','rerank-paired']:
        rs=rows(OUT/(name+'.jsonl'));meta=[r['jev'].get('metadata',r['jev']) for r in rs]
        unknown=sum(bool(r['jev'].get('error')) and r['jev']['error'] not in {'request_too_large','budget_exhausted','circuit_open','missing_key'} for r in rs)
        tokens=sum(m.get('usage',{}).get('input_tokens',0) for m in meta)
        categories[name]={'known_input_tokens':tokens,'known_usd':tokens*.042/1e6,'unknown_billed_attempts':unknown,'conservative_upper_usd':(tokens+60000*unknown)*.042/1e6}
    # Accepted and rejected live production decisions both retain usage metadata.
    meta=[r['debug'].get('jev_decision',{}) for r in rows(OUT/'system-paired.jsonl')]
    tokens=sum(m.get('usage',{}).get('input_tokens',0) for m in meta)
    unknown=sum(m.get('reason') in {'timeout','invalid_response_or_transport'} for m in meta)
    categories['system']={'known_input_tokens':tokens,'known_usd':tokens*.042/1e6,'unknown_billed_attempts':unknown,'conservative_upper_usd':(tokens+60000*unknown)*.042/1e6}
    if (OUT/'http-smoke.json').exists():
        categories['http_smoke']={'known_input_tokens':0,'known_usd':0,'unknown_billed_attempts':1,'conservative_upper_usd':60000*.042/1e6,'note':'Compact HTTP contract does not expose Jev usage; include one full request reservation in upper bound.'}
    return {'categories':categories,'known_usd':sum(x['known_usd'] for x in categories.values()),'conservative_upper_usd':sum(x['conservative_upper_usd'] for x in categories.values()),'excludes':'Qwen/DeepSeek/Kimi/embeddings and earlier v1 pilot; actual billing can differ from reported price.'}


if __name__=='__main__':
    out={'intent_dev':intent('intent-dev2'),'intent_holdout':intent('intent-holdout'),'rerank':rerank(),'system':system(),'jev_cost':cost()}
    original={r['id']:r for r in rows(OUT/'intent-holdout.jsonl')}
    repairs=rows(OUT/'intent-holdout-repair.jsonl')+rows(OUT/'intent-holdout-repair-late.jsonl')
    assert len({r['id'] for r in repairs})==len(repairs)
    for r in repairs:
        assert r['id'] in original and r['jev']==original[r['id']]['jev']
        original[r['id']]=r
    out['intent_holdout_repaired']=intent('intent-holdout',list(original.values()))
    out['intent_holdout_repaired']['supplemental_baseline_attempts']=len(repairs)
    (OUT/'v2-analysis.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(out,ensure_ascii=False,indent=2))
