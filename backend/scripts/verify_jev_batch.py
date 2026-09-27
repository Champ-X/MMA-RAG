"""Live eight-unit capacity and scope smoke for the optional batch auditor."""
import argparse
import asyncio
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))


async def run(args):
    from dotenv import load_dotenv
    load_dotenv(args.provider_env,override=False)
    from loguru import logger
    logger.remove()
    from app.core.llm.jev import JevClient
    from app.modules.generation.jev_citation_batch import audit_answer_batch
    if args.output.exists():raise ValueError('Use a new path; preserve prior live records')
    key=re.split(r'[:=：]',args.key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    class CountingClient(JevClient):
        evaluations=0
        async def evaluate(self,*a,**kw):
            self.evaluations+=1
            return await super().evaluate(*a,**kw)
    client=CountingClient(key,timeout_s=5,max_input_tokens=60000)
    references={};lines=[];expected=[]
    for i in range(8):
        value=100+i*17
        references[str(i+1)]={'content_type':'doc','content':f'桥塔服务{i+1}每小时限额为{value}次。该规则只适用于该服务。'}
        correct=i%2==0
        lines.append(f'{i+1}. 桥塔服务{i+1}每小时限额为{value if correct else value+1}次[{i+1}]。')
        expected.append(correct)
    answer='\n'.join(lines)
    result=await audit_answer_batch(client,answer,references,timeout_s=5)
    signals=[u['result'].get('choice_support_signal') for u in result['units']]
    record={'answer':answer,'references':references,'expected_support':expected,'result':result,
            'client_evaluations':client.evaluations,'budget_accounted_tokens':client.reserved_input_tokens,
            'scope':'Eight related synthetic units, real model call. Capacity/scope smoke, not independent quality evidence.',
            'all_units_evaluated':result['coverage']['evaluated_units']==8,'signals_match_predeclared_labels':signals==expected}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:record[k] for k in ['client_evaluations','all_units_evaluated','signals_match_predeclared_labels','budget_accounted_tokens']},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--provider-env',type=Path,required=True);p.add_argument('--key-file',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'docs/research/jev-v5/results/eight-unit-live.json')
    asyncio.run(run(p.parse_args()))
