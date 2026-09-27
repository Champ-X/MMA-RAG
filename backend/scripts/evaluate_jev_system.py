"""Real paired RetrievalService against dedicated evaluation storage.

Seeds authored text chunks directly: parsing/OCR/media ingestion are outside this
experiment. No fake embeddings, retrieval, decisions or generated answers.
"""
import argparse
import asyncio
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import re
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
DATA=ROOT/'evals/jev_v2/system'
OUT=ROOT/'docs/research/jev-v2/results'


async def run(args):
    from scripts.jev_eval_server import configure
    configure(args.provider_env,args.key_file)
    from loguru import logger
    logger.remove()
    from app.core.config import settings
    assert settings.qdrant_port==16333 and settings.minio_endpoint=='127.0.0.1:19000' and settings.evaluation_mode
    from app.core.llm.manager import llm_manager
    from app.core.sparse_encoder import get_sparse_encoder
    from app.modules.knowledge.service import KnowledgeBaseService
    from app.modules.ingestion.storage.vector_store import VectorStore
    from app.modules.retrieval.service import RetrievalService
    from app.modules.generation.context_builder import ContextBuilder
    from app.modules.generation.templates.system_prompts import SystemPromptManager
    docs=[json.loads(x) for x in (DATA/'corpus.jsonl').read_text().splitlines()]
    cases=[json.loads(x) for x in (DATA/'cases.jsonl').read_text().splitlines()]
    manifest=json.loads((DATA/'manifest.json').read_text())
    for n in ['corpus','cases']:assert manifest['hashes'][n]==hashlib.sha256((DATA/(n+'.jsonl')).read_bytes()).hexdigest()
    state_path=ROOT/'data/jev-v2/system-seed.json'
    OUT.mkdir(parents=True,exist_ok=True)
    if not state_path.exists():
        kb=KnowledgeBaseService();store=VectorStore()
        state={'manifest':manifest,'kbs':{}}
        for scope in ['primary','foreign']:
            result=await kb.create_knowledge_base('Jev v2 '+scope,'Isolated synthetic adversarial evaluation')
            state['kbs'][scope]=result['id']
        sparse=get_sparse_encoder()
        encoded=await asyncio.to_thread(sparse.encode_corpus,[d['text'] for d in docs],8)
        vectors=[];receipts=[]
        for start in range(0,len(docs),16):
            result=await llm_manager.embed([d['text'] for d in docs[start:start+16]],fallback=False)
            assert result.success and len(result.data)==len(docs[start:start+16]),result.error_category
            vectors.extend(result.data);receipts.append({'model':result.model_used,'duration_s':result.duration,'usage':result.tokens_used})
        for scope in state['kbs']:
            chunks=[]
            for i,d in enumerate(docs):
                if d['kb']!=scope:continue
                upload=await kb.minio_adapter.upload_file(d['text'].encode(),d['id']+'.txt',state['kbs'][scope],'documents',custom_object_path='documents/'+d['id']+'.txt',file_id_override=d['id'])
                chunks.append({'text':d['text'],'vector':vectors[i],'sparse_vector':encoded[i]['sparse'],'file_id':d['id'],'file_path':'documents/'+d['id']+'.txt','file_type':'txt'})
            inserted=await store.upsert_text_chunks(state['kbs'][scope],chunks)
            assert inserted.get('status')=='success' or inserted.get('success') or inserted.get('inserted_count'),inserted
        state['embedding_receipts']=receipts
        state_path.parent.mkdir(parents=True,exist_ok=True);state_path.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
        (OUT/'system-seed.json').write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
        print('Seed complete',len(docs),flush=True)
    state=json.loads(state_path.read_text());assert state['manifest']==manifest
    # Warm local sparse inference equally before timing either policy.
    await asyncio.to_thread(get_sparse_encoder().encode_query,'评估预热')
    path=OUT/'system-paired.jsonl'
    prior=[json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    done={(r['id'],r['mode']) for r in prior}
    for c in cases:
        modes=['off','adaptive'] if int(c['id'][-2:])%2==0 else ['adaptive','off']
        for mode in modes:
            if (c['id'],mode) in done:continue
            service=RetrievalService();service.intent_processor.jev_mode=mode
            # Existing reranker is retained: independent v2 results rejected replacement/ensemble.
            service.reranker.jev_mode='off'
            context={'kb_ids':[state['kbs'][c['kb']]]}
            if c.get('scope_files'):context['selected_files']=[{'kb_id':state['kbs'][c['kb']],'file_id':f,'type':'txt'} for f in c['scope_files']]
            t=time.perf_counter()
            result=await service.search(c['query'],kb_context=context)
            row={'id':c['id'],'mode':mode,'query':c['query'],'family':c['family'],'duration_s':time.perf_counter()-t,'manifest':manifest['hashes'],'debug':result.debug_info,'context':asdict(result.context)}
            row['branch_counts']={k:len(v) for k,v in result.raw_results.items()}
            row['provider_health_snapshot']=llm_manager._health().snapshot()
            row['evidence']=[{'id':x['id'],'file_id':x.get('payload',{}).get('file_id'),'kb_id':x.get('payload',{}).get('kb_id'),'text':x.get('payload',{}).get('text_content'),'score':x.get('final_score')} for x in result.reranked_results]
            top={x['file_id'] for x in row['evidence'][:5]}
            row['evidence_recall5']=len(top&set(c['expected_files']))/len(c['expected_files'])
            row['scope_valid']=all(x['kb_id']==state['kbs'][c['kb']] and (not c.get('scope_files') or x['file_id'] in c['scope_files']) for x in row['evidence'])
            if c['id'] in {'system-00','system-08','system-11'}:
                built=await ContextBuilder().build_context(result,c['query'])
                builder=ContextBuilder()
                messages=[{'role':'system','content':SystemPromptManager().build_system_prompt(result.context.intent_type)}, {'role':'user','content':builder.formatter.format_user_query(query=c['query'],context=built.context_string)}]
                generated=await llm_manager.chat(messages,task_type='final_generation',fallback=False,temperature=.1,max_tokens=1000,total_timeout=90)
                row['generation']={'success':generated.success,'model':generated.model_used,'duration_s':generated.duration,'usage':(generated.data or {}).get('usage'),'error_category':generated.error_category}
                if generated.success:
                    answer=generated.data['choices'][0]['message']['content'];cited=re.findall(r'\[(\d+)\]',answer)
                    row['generation'].update(answer=answer,reference_map={k:asdict(v) for k,v in built.reference_map.items()},citation_ids_valid=bool(cited) and all(x in built.reference_map for x in cited),expected_strings_present=all(x in answer for x in c.get('answer_contains',[])))
            with path.open('a') as f:f.write(json.dumps(row,ensure_ascii=False,default=str)+'\n')
            print(c['id'],mode,round(row['duration_s'],2),'recall',row['evidence_recall5'],'gate',row['debug'].get('jev_decision'),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--provider-env',type=Path,required=True);p.add_argument('--key-file',type=Path,required=True)
    asyncio.run(run(p.parse_args()))
