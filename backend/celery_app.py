"""
Celery 异步任务配置
用于处理文档解析、向量化等耗时任务
"""

from celery import Celery
from dotenv import load_dotenv
import os

# 加载环境变量
load_dotenv()

# 创建 Celery 应用实例
celery_app = Celery(
    "mmrag_tasks",
    broker=os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"),
    include=[
        "app.modules.ingestion.service",
        "app.modules.knowledge.portraits",
        "app.modules.retrieval.service",
    ]
)

# Celery 配置
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    
    # 任务路由配置
    task_routes={
        "app.modules.ingestion.service.process_document": {"queue": "ingestion"},
        "app.modules.knowledge.portraits.build_kb_portrait_task": {"queue": "knowledge"},
        "app.modules.retrieval.service.search_documents": {"queue": "retrieval"},
    },
    
    # 任务超时配置
    task_soft_time_limit=300,  # 5分钟软超时
    task_time_limit=600,       # 10分钟硬超时
    
    # 任务重试配置
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    
    # 任务结果过期时间
    result_expires=3600,  # 1小时
)

# 自动发现任务
celery_app.autodiscover_tasks()

@celery_app.task(bind=True)
def debug_task(self):
    """调试任务"""
    print(f"Request: {self.request!r}")
    return {"hello": "world"}

if __name__ == "__main__":
    celery_app.start()