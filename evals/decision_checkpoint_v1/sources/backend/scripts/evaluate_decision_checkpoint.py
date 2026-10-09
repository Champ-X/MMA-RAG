"""Freeze, then evaluate one context checkpoint with capped native providers.

Natural-query cohorts use existing qrels and historical Qwen ONLY for selection.
No Decision output selects cases. This is a diagnostic cohort, not a new holdout.
"""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(Path(__file__).parent))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path, value):
    with path.open('x') as file:
        json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)


def document(identity, text):
    return {'id': identity, 'content_type': 'doc', 'final_score': .1, 'total_score': .1,
            'payload': {'text_content': text, 'file_id': identity, 'file_path': identity+'.txt'}}


def visible(baseline):
    from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
    formatter = MultiModalFormatter()
    return '\n\n'.join(formatter.format_document_chunk(str(i+1), x['payload']['text_content'],
        x['payload'].get('file_path','evidence.txt'), {}) for i,x in enumerate(baseline))


def functional_cases():
    def case(identity, query, baseline, candidates, expected, rendered=None):
        return {'suite':'functional','id':identity,'query':query,'baseline':baseline,
                'candidates':candidates,'visible_context':rendered if rendered is not None else visible(baseline),
                'expected_ids':expected,'qrels':None}
    hidden_prefix = '海桐合同的说明部分记录归档流程、办公室安排和普通联络事项。' * 30
    hidden = '海桐2026年合同规定：消费者可以在收到货物后14天内申请退款。超过14天不受理。'
    hidden_doc = document('retained-hidden', hidden_prefix+'\n\n'+hidden)
    long_before = '一般背景材料。' * 1000
    long_after = '无关的附录材料。' * 1000
    return [
        case('hidden-retained-fact','海桐2026年合同的退款期限是多少？',[hidden_doc],
             [hidden_doc,document('hidden-wrong','海杉2026年合同的退款期限为60天。')],['retained-hidden']),
        case('partial-query-support','白鹭市2026年借阅期限和续借限制分别是什么？',
             [document('loan-base','白鹭市2026年规定：普通读者最多同时借5本书。')],
             [document('loan-days','白鹭市2026年规定：普通读者借阅期限是30天。'),
              document('loan-condition','白鹭市2026年规定：只有尚未到期且无人预约的图书可以续借，逾期图书不能续借。'),
              document('loan-wrong','白鹤市2026年规定：图书可以无限续借。')],['loan-days','loan-condition']),
        case('version-and-negative','Lumen 2.4能离线导出JSON吗？有哪些记录限制？',
             [document('export-base','Lumen 2.4允许本地管理员发起CSV离线导出。')],
             [document('export-old','Lumen 2.3支持JSON离线导出。此规则仅适用于2.3。'),
              document('export-no-json','Lumen 2.4不支持JSON离线导出，该功能已经移除。'),
              document('export-encrypted','Lumen 2.4离线导出仅包含已解密记录，未解密记录会被省略。')],
             ['export-no-json','export-encrypted']),
        case('false-premise','H12实验是否证明盐水可以把发芽率提高到90%？',
             [document('seed-base','H12实验研究盐水与种子发芽的关系。')],
             [document('seed-counter','H12实验在25摄氏度下，标准组发芽率为80%，盐水组为40%。盐水没有提高发芽率。'),
              document('seed-other','H13实验盐水组的发芽率为90%。H13使用另一个品种。')],['seed-counter']),
        case('duplicate-visible','云杉站的开放时间是什么？',
             [document('hours-base','云杉站每天9点开放，18点关闭。')],
             [document('hours-copy','云杉站每天9点开放，18点关闭。')],[]),
        case('long-visible-baseline','白帆2026年会员有什么取消限制？',
             [document('long-base','白帆会员的服务范围包括阅览室。')],
             [document('cancel','白帆2026年会员可以在次月开始前取消。已开始的月份不退款。'),
              document('cancel-other','黑帆2026年会员全年不可取消。')],['cancel'],
             rendered=('已显示的背景介绍，与取消规则无关。' * 1800)),
        case('long-source-paragraph','星河3.1导出会包含未解密记录吗？',
             [document('long-source-base','星河3.1支持数据导出。')],
             [document('long-source',long_before+'\n\n星河3.1导出仅包含已解密记录，未解密记录不包含在导出文件内。\n\n'+long_after)],
             ['long-source']),
    ]


def freeze(directory):
    from evaluate_jev import coarse_candidates
    from app.modules.retrieval.reranker import Reranker
    from loguru import logger
    logger.remove()
    dataset = ROOT/'evals/jev_v2/rerank/cases.jsonl'
    baseline_path = ROOT/'docs/research/jev-v2/results/rerank-paired.jsonl'
    previous = set(json.loads((ROOT/'evals/decision_assist/incremental-protocol-v2.json').read_text())['cases'])
    cases = [json.loads(line) for line in dataset.read_text().splitlines()]
    receipts = {row['id']:row for row in map(json.loads,baseline_path.read_text().splitlines())}
    pools=[]
    for case in cases:
        if case['split']!='test' or case['id'] in previous:
            continue
        old=receipts.get(case['id'],{})
        if old.get('qwen',{}).get('error') or not old.get('qwen',{}).get('scores'):
            continue
        ranker=Reranker()
        coarse=ranker._prepare_coarse_ranking({'dense':coarse_candidates(case)})
        selected=ranker._select_candidates_for_reranking(coarse,None)
        assert [x['id'] for x in selected]==old['candidate_ids']
        built=[ranker._build_document_content(x) for x in selected]
        assert hashlib.sha256(json.dumps([case['query'],built],ensure_ascii=False).encode()).hexdigest()==old['input_sha256']
        ranked=ranker._merge_scores(case['query'],selected,old['qwen']['scores'])
        ranked.sort(key=lambda x:x['final_score'],reverse=True)
        baseline=ranker._apply_final_ranking_with_modality_protection(ranked,None)
        ids={x['id'] for x in baseline}
        labels={d['id']:int(d['relevance']>0) for d in case['documents']}
        missing=[key for key,value in labels.items() if value and key not in ids]
        # Candidates follow root integration: excluded ranked sources first,
        # then retained chunks whose omitted paragraphs can still be useful.
        candidates=[x for x in ranked if x['id'] not in ids]+baseline
        pools.append({'suite':'public','id':case['id'],'query':case['query'],
            'group':'missed' if missing else 'saturated','baseline':baseline,
            'candidates':candidates,'ranked_ids':[x['id'] for x in ranked],
            'recall_ids':[x['id'] for x in coarse], 'qrels':labels,
            'visible_context':visible(baseline),'missing_ids':missing,
            'baseline_chars':sum(len(x['payload']['text_content']) for x in baseline),
            'baseline_input_sha256':old['input_sha256']})
    order=lambda row:hashlib.sha256(('checkpoint-v1:'+row['id']).encode()).hexdigest()
    missed=sorted([x for x in pools if x['group']=='missed'],key=order)
    controls=[x for x in pools if x['group']=='saturated' and len(x['candidates'])>10]
    pairs=[]
    for target in missed:
        if not controls:break
        # Pre-model matching uses only baseline lengths and candidate counts.
        selected=min(controls,key=lambda row:(abs(math.log1p(row['baseline_chars'])-math.log1p(target['baseline_chars']))
                       +abs(len(row['candidates'])-len(target['candidates']))/10,order(row)))
        controls.remove(selected);pairs.append((target,selected))
    pilot=[row for pair in pairs[:10] for row in pair]
    directory.mkdir(parents=True,exist_ok=False)
    rows=pilot+functional_cases()
    with (directory/'cases.jsonl').open('x') as file:
        for row in rows:file.write(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n')
    write_new(directory/'cohort.json',{'all_missed_count':len(missed),'matched_pairs':[
        {'missed':a['id'],'control':b['id'],'missed_baseline_chars':a['baseline_chars'],
         'control_baseline_chars':b['baseline_chars']} for a,b in pairs],
        'pilot_pairs':10,'excluded_prior_assist':sorted(previous),
        'selection':'test split; historical Qwen/qrels define headroom; stable SHA order; match only length and pool size; never Decision scores'})
    sources=['backend/app/modules/retrieval/decision_evidence_checkpoint.py',
        'backend/app/modules/retrieval/decision_evidence_incremental.py',
        'backend/app/modules/retrieval/decision_evidence_legacy.py',
        'backend/app/core/llm/jev.py','backend/app/core/llm/decision_catalog.py',
        'backend/app/core/decision_providers.py',
        'backend/app/modules/generation/templates/multimodal_fmt.py',
        'backend/scripts/evaluate_decision_checkpoint.py']
    for name in sources:
        dest=directory/'sources'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((ROOT/name).read_bytes())
    write_new(directory/'protocol.json',{'protocol':'visible-evidence-checkpoint-pilot-v1',
        'frozen_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'cases_sha256':digest(directory/'cases.jsonl'),'cohort_sha256':digest(directory/'cohort.json'),
        'original_dataset_sha256':digest(dataset),'historical_qwen_sha256':digest(baseline_path),
        'source_sha256':{name:digest(ROOT/name) for name in sources},
        'providers':[{'provider':'typesafe','model':'jev-1.13.0'},
                     {'provider':'bailian','model':'decision-model-preview'},
                     {'provider':'openrouter','model':'openai/gpt-6-luna-decisions'}],
        'policies':['incremental-evidence-v2','visible-evidence-checkpoint-v1'],
        'stage_deadline_ms':3000,'max_candidates':10,'max_additions':2,'threshold':.8,
        'max_provider_input_tokens':500000,'max_total_native_requests_per_provider':135,
        'concurrency':1,'retries':0,
        'controls':['Qwen-next2','recall-next2'],
        'limitations':'Diagnostic, previously studied T2 queries; 10 missed + 10 matched saturated natural query pools; qrels are relevance labels, not novelty/answer correctness. Sources lack independent provenance. Visible baseline is frozen production document formatter output; no live KB recall/generation. Seven functional cases are hand-authored behavior checks. No default/config changes or artifact refill.'})
    print(json.dumps({'frozen':str(directory),'public_cases':len(pilot),'functional_cases':len(rows)-len(pilot),
                      'all_missed':len(missed),'protocol_sha256':digest(directory/'protocol.json')}))


def score(case, additions):
    ids=[x['id'] for x in additions]
    if case['suite']=='functional':
        expected=set(case['expected_ids'])
        return {'added_ids':ids,'correct_added':len(set(ids)&expected),'false_added_ids':sorted(set(ids)-expected),
                'missed_expected_ids':sorted(expected-set(ids)), 'expected_count':len(expected)}
    qrels=case['qrels'];before={x['id'] for x in case['baseline']};after=before|set(ids)
    positive=sum(qrels.values())
    return {'added_ids':ids,'positive_count':positive,
        'recall_before':sum(qrels[x] for x in before)/positive,
        'recall_after':sum(qrels[x] for x in after)/positive,
        'new_relevant':sum(qrels[x] for x in set(ids)-before),
        'relevant_additions':sum(qrels[x] for x in ids),
        'same_chunk_additions':sum(x in before for x in ids)}


def controls(case):
    from app.modules.retrieval.decision_evidence_checkpoint import select_source_span,normalized
    by_id={x['id']:x for x in case['candidates']}
    baseline={x['id'] for x in case['baseline']}
    result={}
    for name,key in [('Qwen-next2','ranked_ids'),('recall-next2','recall_ids')]:
        selected=[];seen=set()
        for identity in case[key]:
            if identity in baseline or identity not in by_id:continue
            item=by_id[identity]
            span,_=select_source_span(case['query'],item['payload']['text_content'],case['visible_context'])
            if span is None or normalized(span['excerpt']) in seen:continue
            seen.add(normalized(span['excerpt']));selected.append(item)
            if len(selected)==2:break
        result[name]=score(case,selected)
    return result


async def run(directory, output):
    from app.core.config import settings
    from app.core.decision_providers import DECISION_CREDENTIALS
    from app.core.llm.jev import JevClient
    from app.core.jev_settings import JevConfig,_request_config
    from app.modules.retrieval.decision_evidence_checkpoint import select_context_evidence
    from app.modules.retrieval.decision_evidence_incremental import supplement_evidence
    from loguru import logger
    logger.remove()
    protocol=json.loads((directory/'protocol.json').read_text())
    assert digest(directory/'cases.jsonl')==protocol['cases_sha256']
    assert digest(directory/'cohort.json')==protocol['cohort_sha256']
    for path,value in protocol['source_sha256'].items():assert digest(ROOT/path)==value,path
    cases=[json.loads(line) for line in (directory/'cases.jsonl').read_text().splitlines()]
    config=ROOT/'backend/data/jev_settings.json';config_hash=digest(config)
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x'):pass
    all_rows=[]
    for selection in protocol['providers']:
        key=getattr(settings,DECISION_CREDENTIALS[selection['provider']][0]) or ''
        client=JevClient(key,**selection,timeout_s=3.,max_input_tokens=protocol['max_provider_input_tokens'],
                         endpoint=settings.bailian_decision_endpoint if selection['provider']=='bailian' else None)
        token=_request_config.set(JevConfig(**selection,intent_mode='off',rerank_mode='assist',citation_mode='off'))
        try:
            for i,case in enumerate(cases):
                policies=protocol['policies'][i%2:]+protocol['policies'][:i%2]
                for policy in policies:
                    if policy=='incremental-evidence-v2':
                        result,receipt=await supplement_evidence(case['query'],case['baseline'],case['candidates'],case['candidates'],
                            client_factory=lambda:client,modality=lambda x:x['content_type'])
                        assert result[:len(case['baseline'])]==case['baseline']
                        additions=result[len(case['baseline']):]
                    else:
                        additions,receipt=await select_context_evidence(client,case['query'],case['candidates'],case['visible_context'],
                            timeout_ms=protocol['stage_deadline_ms'])
                    assert len(additions)<=2
                    row={'suite':case['suite'],'id':case['id'],'group':case.get('group'),**selection,
                         'policy':policy,'metrics':score(case,additions),'receipt':receipt,
                         'baseline_preserved':True,'recorded_at':time.strftime('%Y-%m-%dT%H:%M:%S%z')}
                    if case['suite']=='public':row['controls']=controls(case)
                    serialized=json.dumps(row,ensure_ascii=False,allow_nan=False)
                    assert not key or key not in serialized
                    with output.open('a') as file:file.write(serialized+'\n')
                    all_rows.append(row)
                    print(json.dumps({key:row[key] for key in ('suite','id','provider','policy','metrics')},ensure_ascii=False),flush=True)
        finally:_request_config.reset(token)
    assert digest(config)==config_hash
    for path,value in protocol['source_sha256'].items():assert digest(ROOT/path)==value,path
    summary={'protocol_sha256':digest(directory/'protocol.json'),'saved_settings_unchanged':True,
             'receipt_sha256':digest(output),'groups':{}}
    for selection in protocol['providers']:
        for policy in protocol['policies']:
            rows=[r for r in all_rows if r['provider']==selection['provider'] and r['policy']==policy]
            public=[r for r in rows if r['suite']=='public'];function=[r for r in rows if r['suite']=='functional']
            added=sum(len(r['metrics']['added_ids']) for r in public)
            summary['groups'][selection['provider']+'/'+policy]={
                'public_n':len(public),'additions':added,'new_relevant':sum(r['metrics']['new_relevant'] for r in public),
                'relevant_additions':sum(r['metrics']['relevant_additions'] for r in public),
                'recall_before':statistics.mean(r['metrics']['recall_before'] for r in public),
                'recall_after':statistics.mean(r['metrics']['recall_after'] for r in public),
                'functional_expected':sum(r['metrics']['expected_count'] for r in function),
                'functional_correct':sum(r['metrics']['correct_added'] for r in function),
                'functional_false':sum(len(r['metrics']['false_added_ids']) for r in function),
                'status':dict(Counter(r['receipt']['status'] for r in rows)),
                'reasons':dict(Counter(r['receipt']['reason'] for r in rows)),
                'native_requests':sum(len(r['receipt'].get('requests',[])) for r in rows),
                'duration_median_s':statistics.median(r['receipt']['duration_s'] for r in rows)}
    write_new(output.with_suffix('.summary.json'),summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze',action='store_true')
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.freeze:
        if args.live:parser.error('Freeze and live must be separate invocations')
        freeze(args.directory)
    elif args.live and args.output:asyncio.run(run(args.directory,args.output))
    else:parser.error('Use --freeze or --live with --output')
