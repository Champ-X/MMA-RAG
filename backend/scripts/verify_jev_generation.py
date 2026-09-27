"""Real GenerationService -> live LLM -> live Jev, on frozen retrieval evidence.

No storage/HTTP/UI claims: optional neighboring-chunk storage enrichment is absent.
"""
import argparse
import asyncio
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))


async def run(args):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env,override=False)
    key=re.split(r'[:=：]',args.key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    os.environ.update(JEV_CITATION_MODE='shadow',JEV_CITATION_STRATEGY=args.strategy,
                      TYPESAFE_API_KEY=key,JEV_TIMEOUT_S='3',JEV_MAX_INPUT_TOKENS='100000')
    from app.core.jev_settings import jev_config_store
    jev_config_store.path = None  # Frozen CLI configuration must win over saved UI settings.
    from app.core.llm.manager import llm_manager
    from app.core.llm.jev import get_jev_client
    from app.modules.generation.context_builder import ContextBuilder
    from app.modules.generation.stream_manager import StreamManager,StreamEventType
    from app.modules.generation.service import GenerationService
    from app.modules.generation.templates.system_prompts import SystemPromptManager
    from loguru import logger
    logger.remove()
    source=ROOT/'docs/research/jev-v2/results/system-paired.jsonl'
    rows=[json.loads(l) for l in source.read_text().splitlines()]
    if args.output.exists():raise ValueError('Use a new output path; never overwrite live generation evidence')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    class RecordingBuilder(ContextBuilder):
        async def build_context(self,*a,**kw):
            built=await super().build_context(*a,**kw)
            self.last_built=built
            return built
    # Compose real service components without the optional VectorStore lookup,
    # because this experiment starts at frozen retrieval output.
    service=GenerationService.__new__(GenerationService)
    service.context_builder=RecordingBuilder()
    service.stream_manager=StreamManager()
    service.prompt_manager=SystemPromptManager()
    service.llm_manager=llm_manager
    for case_id,mode in [('system-00','nonstream'),('system-08','stream')]:
        row=next(r for r in rows if r['id']==case_id and r['mode']=='off')
        evidence=[{'id':e['id'],'score':e['score'],'final_score':e['score'],'content_type':'doc',
                   'payload':{'text_content':e['text'],'file_path':'documents/'+e['file_id']+'.txt',
                              'kb_id':e['kb_id'],'chunk_index':0}} for e in row['evidence']]
        retrieval=SimpleNamespace(reranked_results=evidence,context=SimpleNamespace(**row['context']))
        started=time.perf_counter();result={'id':case_id,'mode':mode,'citation_strategy':args.strategy,
            'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        try:
            async with asyncio.timeout(180):
                if mode=='nonstream':
                    response=await service.generate_response(row['query'],retrieval)
                    result.update(success=response['success'],answer=response['answer'],metadata=response.get('metadata',{}),
                                  references=response.get('references_used',[]))
                else:
                    events=[];parts=[]
                    async for e in service.stream_generate_response(row['query'],retrieval,'jev-v4-live'):
                        events.append({'type':e.type.value,'elapsed_s':time.perf_counter()-started,'data':e.data})
                        if e.type==StreamEventType.MESSAGE:parts.append(e.data['content'])
                    result.update(events=events,answer=''.join(parts),success=events[-1]['type']=='done',
                                  metadata=events[-1]['data'])
                built=service.context_builder.last_built
                result['reference_map']={k:asdict(v) for k,v in built.reference_map.items()}
                result['citation_ids_valid']=all(i in built.reference_map for i in re.findall(r'\[(\d+)\]',result['answer']))
                audit=result['metadata'].get('jev_citation_audit')
                result['diagnostic_present']=audit is not None
                result['semantic_calls_completed']=audit and audit.get('coverage',{}).get('evaluated_units',0)>0
        except Exception as exc:
            result.update(success=False,error_type=type(exc).__name__)
        result.update(duration_s=time.perf_counter()-started,reserved_input_tokens=get_jev_client().reserved_input_tokens)
        with args.output.open('a') as f:f.write(json.dumps(result,ensure_ascii=False)+'\n')
        print(case_id,mode,result['success'],result.get('diagnostic_present'),flush=True)
        if not result['success']:break


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--provider-env',type=Path,required=True);p.add_argument('--key-file',type=Path,required=True)
    p.add_argument('--strategy',choices=['per_unit','batch_choice'],default='per_unit')
    p.add_argument('--output',type=Path,default=ROOT/'docs/research/jev-v4/results/generation-live.jsonl')
    asyncio.run(run(p.parse_args()))
