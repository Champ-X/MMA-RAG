"""
知识库画像增量触发
基于 Redis 累计每个 KB 的新增/修改 Chunk 数，达到阈值时触发画像构建。
若配置 PORTRAIT_SYNC_API_URL则通过 HTTP 调用该 API 的同步画像接口（保证含视频关键帧等最新逻辑）；
否则使用 Celery 异步任务（需 Worker 与 API 代码一致）。
"""

from typing import Optional
import redis
import urllib.request
import urllib.error
import ssl
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

KEY_PREFIX = "portrait:delta:"


def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)  # type: ignore[return-value]


def _trigger_portrait_via_sync_api(kb_id: str) -> bool:
    """通过 HTTP 调用 API 的同步画像接口，由 API 进程执行（使用当前部署代码，含视频关键帧）。"""
    base = (getattr(settings, "portrait_sync_api_url", None) or "").strip().rstrip("/")
    if not base:
        # 未配置时默认请求本机 API（ingestion 与 API 同机时），由 API 进程执行画像（含视频关键帧）
        base = f"http://127.0.0.1:{getattr(settings, 'port', 8000)}"
    if not base:
        return False
    url = f"{base}/api/knowledge/{kb_id}/portrait/regenerate?sync=true"
    try:
        req = urllib.request.Request(url, method="POST")
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            if 200 <= resp.status < 300:
                logger.info(f"画像已通过同步 API 触发完成 kb_id={kb_id} url={url}")
                return True
            logger.warning(f"画像同步 API 返回非 2xx kb_id={kb_id} status={resp.status}")
            return False
    except urllib.error.HTTPError as e:
        # 400 可能为数据不足，仍算“已触发”
        if e.code == 400:
            logger.info(f"画像同步 API 返回 400（可能数据不足）kb_id={kb_id}")
            return True
        logger.warning(f"画像同步 API 请求失败 kb_id={kb_id} code={e.code}: {e}")
        return False
    except Exception as e:
        logger.warning(f"画像同步 API 请求异常 kb_id={kb_id}: {e}")
        return False


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
    增加增量并检查是否达到阈值；若达到则触发画像构建并清零计数。
    - 若配置了 portrait_sync_api_url：通过 HTTP 调用该 API 的同步画像接口（由 API 进程执行，保证含视频关键帧）。
    - 否则：使用 Celery 异步任务（需 Worker 与 API 代码一致，否则可能不统计视频）。
    阈值使用 settings.portrait_update_threshold（默认 50）。
    返回是否触发了任务。
    """
    try:
        threshold = settings.portrait_update_threshold
        n = increment_portrait_delta(kb_id, delta)
        if n < threshold:
            return False
        reset_portrait_delta(kb_id)
        # 优先走同步 API，保证使用当前部署代码（含视频关键帧）
        if _trigger_portrait_via_sync_api(kb_id):
            return True
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
