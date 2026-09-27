"""Read-only scoped request against the isolated adaptive eval server."""
import json
from pathlib import Path
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]

if __name__=='__main__':
    state=json.loads((ROOT/'data/jev-v2/system-seed.json').read_text());kb=state['kbs']['primary']
    base='http://127.0.0.1:18001'
    health=json.load(urllib.request.urlopen(base+'/health',timeout=10))
    assert health.get('evaluation_mode') is True
    body={'query':'白鹭SDK的image_timeout默认值是多少？','knowledge_base_ids':[kb],'file_ids':['p2-code'],'top_k':5}
    t=time.perf_counter();req=urllib.request.Request(base+'/api/v1/retrieval/search',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
    response=json.load(urllib.request.urlopen(req,timeout=240));duration=time.perf_counter()-t
    assert response['results'] and all(x['source']['knowledge_base_id']==kb and x['source']['file_id']=='p2-code' for x in response['results'])
    (ROOT/'docs/research/jev-v2/results/http-smoke.json').write_text(json.dumps({'request':body,'response':response,'wall_time_s':duration,'evaluation_mode':True,'scope_valid':True,'server_configuration':'jev_eval_server --port 18001 --intent-mode adaptive; rerank off'},ensure_ascii=False,indent=2)+'\n')
    print('PASS',round(duration,3))
