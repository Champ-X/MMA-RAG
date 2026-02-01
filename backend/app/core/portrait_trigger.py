"""
知识库画像增量触发
基于 Redis 累计每个 KB 的新增/修改 Chunk 数，达到阈值时异步触发 Celery 画像构建任务。
"""

from typing import Optional
import redis
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

KEY_PREFIX = "portrait:delta:"


def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)  # type: ignore[return-value]


def increment_portrait_delta(kb_id: str, delta: int) -> int:
    """
    增加某 KB 的画像增量计数，返回增加后的值。
    """
    try:
        client = _redis_client()
        key = f"{KEY_PREFIX}{kb_id}"
        n = client.incrby(key, delta)
        return int(n)  # type: ignore[arg-type]
    except Exception as e:
        logger.warning(f"increment_portrait_delta 失败 kb_id={kb_id} delta={delta}: {e}")
        return 0


def get_portrait_delta(kb_id: str) -> int:
    try:
        client = _redis_client()
        key = f"{KEY_PREFIX}{kb_id}"
        v = client.get(key)
        return int(v or 0)  # type: ignore[arg-type]
    except Exception as e:
        logger.warning(f"get_portrait_delta 失败 kb_id={kb_id}: {e}")
        return 0


def reset_portrait_delta(kb_id: str) -> None:
    try:
        client = _redis_client()
        key = f"{KEY_PREFIX}{kb_id}"
        client.delete(key)
    except Exception as e:
        logger.warning(f"reset_portrait_delta 失败 kb_id={kb_id}: {e}")


def increment_and_maybe_trigger(kb_id: str, delta: int) -> bool:
    """
    增加增量并检查是否达到阈值；若达到则触发 Celery 画像构建任务并清零计数。
    阈值使用 settings.portrait_update_threshold（默认 50）。
    返回是否触发了任务。
    """
    try:
        threshold = settings.portrait_update_threshold
        n = increment_portrait_delta(kb_id, delta)
        if n < threshold:
            return False
        reset_portrait_delta(kb_id)
        try:
            from app.modules.knowledge.portraits import build_kb_portrait_task
            build_kb_portrait_task.delay(kb_id, False)
            logger.info(f"画像增量达到阈值 {threshold}，已触发异步构建 kb_id={kb_id}")
            return True
        except ImportError as e:
            logger.warning(f"未找到 Celery 画像任务，跳过触发 kb_id={kb_id}: {e}")
            increment_portrait_delta(kb_id, n)
            return False
        except Exception as e:
            logger.error(f"触发画像构建任务失败 kb_id={kb_id}: {e}")
            increment_portrait_delta(kb_id, n)
            return False
    except Exception as e:
        logger.warning(f"increment_and_maybe_trigger 失败 kb_id={kb_id} delta={delta}: {e}")
        return False


def trigger_portrait_rebuild(kb_id: str, reason: str = "data_changed") -> bool:
    """
    直接触发知识库画像异步重建（用于删除文件等场景，数据量减少时需更新画像）。
    使用 force_update=True 跳过增量检查，确保画像与当前数据一致。
    返回是否成功触发。
    """
    try:
        from app.modules.knowledge.portraits import build_kb_portrait_task

        build_kb_portrait_task.delay(kb_id, force_update=True)
        logger.info(f"画像重建已触发 kb_id={kb_id} reason={reason}")
        return True
    except ImportError as e:
        logger.warning(f"未找到 Celery 画像任务，跳过触发 kb_id={kb_id}: {e}")
        return False
    except Exception as e:
        logger.error(f"触发画像重建失败 kb_id={kb_id}: {e}")
        return False
