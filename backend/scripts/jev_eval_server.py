"""Launch this worktree against the dedicated evaluation storage ports only."""
import argparse
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))


def configure(provider_env, key_file, intent_mode='off', rerank_mode='off'):
    from dotenv import load_dotenv
    load_dotenv(provider_env,override=False)
    key=re.split(r'[:=：]',key_file.read_text().strip(),maxsplit=1)[-1].strip().strip("\"'")
    os.environ.update({
        'EVALUATION_MODE':'true','PRELOAD_LOCAL_MODELS_ON_STARTUP':'false','FEISHU_WS_ENABLED':'false',
        'QDRANT_HOST':'127.0.0.1','QDRANT_PORT':'16333','QDRANT_API_KEY':'',
        'MINIO_ENDPOINT':'127.0.0.1:19000','MINIO_PUBLIC_ENDPOINT':'127.0.0.1:19000',
        'MINIO_ACCESS_KEY':'minioadmin','MINIO_SECRET_KEY':'minioadmin','MINIO_SECURE':'false',
        'REDIS_URL':'redis://127.0.0.1:16379/0','CELERY_BROKER_URL':'redis://127.0.0.1:16379/0',
        'CELERY_RESULT_BACKEND':'redis://127.0.0.1:16379/0',
        'DATABASE_URL':'sqlite:///'+str(ROOT/'data/jev-v2/eval.db'),
        'JEV_INTENT_MODE':intent_mode,'JEV_RERANK_MODE':rerank_mode,
        'DECISION_PROVIDER':'typesafe','DECISION_MODEL':'jev-1.13.0',
        'JEV_CITATION_MODE':'off','JEV_CITATION_STRATEGY':'per_unit',
        'JEV_MAX_INPUT_TOKENS':'600000','TYPESAFE_API_KEY':key,'JEV_TIMEOUT_S':'5',
        'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1',
    })
    from app.core.jev_settings import jev_config_store
    jev_config_store.path = None  # Ignore UI overrides and reject settings writes in this process.


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--provider-env',type=Path,required=True)
    p.add_argument('--key-file',type=Path,required=True)
    p.add_argument('--port',type=int,default=18000)
    p.add_argument('--intent-mode',default='off',choices=['off','adaptive'])
    p.add_argument('--rerank-mode',default='off',choices=['off','shadow','replace'])
    a=p.parse_args()
    configure(a.provider_env, a.key_file, a.intent_mode, a.rerank_mode)
    import uvicorn
    uvicorn.run('app.main:app',host='127.0.0.1',port=a.port,log_level='warning')
