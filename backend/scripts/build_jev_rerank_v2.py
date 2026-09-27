"""Select an independent, reproducible public reranking cohort before inference."""
import hashlib
import json
from pathlib import Path
import random
import unicodedata

ROOT = Path(__file__).resolve().parents[2]


def build():
    import pyarrow.parquet as pq
    source = ROOT/'data/jev-v2/T2Reranking.parquet'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == 'ceaf1ba1a4777dbb7aecad86fb8aa9cae7a678af6d711d5529c238e89bb6adff'
    all_rows = pq.read_table(source).to_pylist()
    normalize = lambda q: ''.join(unicodedata.normalize('NFKC',q).lower().split())
    seen = {normalize(json.loads(line)['query']) for line in (ROOT/'evals/jev_v1/cases.jsonl').read_text().splitlines()}
    eligible = []
    for index, row in enumerate(all_rows):
        query = normalize(row['query'])
        if query in seen or not row['positive'] or len(set(row['negative'])) < 5:
            continue
        seen.add(query)
        eligible.append((index,row))
    rng = random.Random(20260922)
    selected = rng.sample(eligible,300)
    cases=[]
    for ordinal,(index,row) in enumerate(selected):
        positives=list(dict.fromkeys(row['positive']))[:2]
        negatives=[t for t in dict.fromkeys(row['negative']) if t not in row['positive']][:18]
        docs=[{'text':text,'relevance':int(text in positives)} for text in positives+negatives]
        random.Random(index).shuffle(docs)
        case_id=f't2v2-{index:04}'
        for i,doc in enumerate(docs):doc['id']=f'{case_id}-{i:02}'
        cases.append({'id':case_id,'suite':'public_t2_v2','split':'dev' if ordinal<60 else 'test',
                      'query':row['query'],'documents':docs,'source_row':index})
    path=ROOT/'evals/jev_v2/rerank';path.mkdir(parents=True,exist_ok=True)
    text=''.join(json.dumps(c,ensure_ascii=False)+'\n' for c in cases)
    (path/'cases.jsonl').write_text(text)
    (path/'manifest.json').write_text(json.dumps({'version':'jev-rerank-v2','cases':len(cases),
        'sha256':hashlib.sha256(text.encode()).hexdigest(),'sampling_seed':20260922,
        'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'selection':'300 unique queries, 60 dev and 240 test, excludes all v1 normalized queries; eligibility requires positive and >=5 distinct negatives',
        'source':'C-MTEB/T2Reranking; frozen 2 positives + up to 18 negatives per query; not official full-pool metric',
        'preregistered_primary':'paired mean nDCG@5 delta with query bootstrap 95% CI',
        'preregistered_candidates':['Qwen', 'Jev', '0.5 Qwen + 0.5 Jev'],
        'decision':'Do not promote a reranker whose paired CI crosses zero; report quality/latency tradeoff separately.',
    },indent=2)+'\n')
    print('Frozen',len(cases),'public cases; candidate pairs',sum(len(c['documents']) for c in cases))


if __name__=='__main__':build()
