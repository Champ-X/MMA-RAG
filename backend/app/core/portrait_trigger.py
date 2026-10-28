"""
知识库画像增量触发。

基于 Redis 累计每个 KB 的新增/修改 Chunk 数，达到阈值时触发画像构建。
优先投递 Celery 任务；投递失败时才通过后台线程调用同步 API。后者不能在
处理当前 API 请求的线程中直接调用本服务，否则单 worker 部署会发生自调用
死锁：外层请求等待画像接口，而画像接口又在等待外层事件循环释放。
"""

from threading import Thread
from typing import Any, Optional
import json
import uuid
import redis
import urllib.request
import urllib.error
import ssl
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

KEY_PREFIX = "portrait:delta:"
PENDING_KEY_PREFIX = "portrait:pending:"
# Celery has a 600 s hard limit and two retries. An abandoned claim expires so
# a later ingestion can recover it; the dirty counter itself never expires.
PENDING_LEASE_SECONDS = 3600

# Reserve one snapshot without consuming the delta. New increments can arrive
# at any point between reservation, broker delivery and completion.
_CLAIM_SCRIPT = """
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count < tonumber(ARGV[1]) or redis.call('EXISTS', KEYS[2]) == 1 then
    return 0
end
redis.call('SET', KEYS[2], cjson.encode({token=ARGV[2], count=count}), 'EX', ARGV[3])
return count
"""

_ACK_SCRIPT = """
local pending = redis.call('GET', KEYS[2])
if not pending then return -1 end
local claim = cjson.decode(pending)
if claim.token ~= ARGV[1] then return -1 end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local remaining = math.max(0, current - tonumber(claim.count))
if remaining > 0 then
    redis.call('SET', KEYS[1], remaining)
else
    redis.call('DEL', KEYS[1])
end
redis.call('DEL', KEYS[2])
return remaining
"""

_RELEASE_SCRIPT = """
local pending = redis.call('GET', KEYS[1])
if not pending or cjson.decode(pending).token ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
"""

_BEGIN_SCRIPT = """
local pending = redis.call('GET', KEYS[1])
if not pending or cjson.decode(pending).token ~= ARGV[1] then return 0 end
return redis.call('EXPIRE', KEYS[1], ARGV[2])
"""


def _redis_client() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)  # type: ignore[return-value]


def _trigger_portrait_via_sync_api(kb_id: str, trigger_token: Optional[str] = None) -> bool:
    """在线程中调用同步画像 API 的实际执行函数，不应直接在请求线程中调用。"""
    base = (getattr(settings, "portrait_sync_api_url", None) or "").strip().rstrip("/")
    if not base:
        # 未配置时默认请求本机 API（ingestion 与 API 同机时），由 API 进程执行画像（含视频 Scene–Shot）
        base = f"http://127.0.0.1:{getattr(settings, 'port', 8000)}"
    if not base:
        return False
    url = f"{base}/api/knowledge/{kb_id}/portrait/regenerate?sync=true"
    try:
        req = urllib.request.Request(url, method="POST")
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            if 200 <= resp.status < 300:
                result = json.loads(resp.read())
                # A queued task, empty/malformed response or HTTP 200 alone is
                # not a completed build. This endpoint returns cluster count
                # only after its synchronous generator has stored the result.
                clusters = result.get("clusters") if isinstance(result, dict) else None
                if isinstance(result, dict) and result.get("status") == "success" and type(clusters) is int and clusters > 0:
                    complete_portrait_trigger(kb_id, trigger_token, {
                        "status": "success", "storage_result": {"status": "success"},
                    })
                    logger.info(f"画像已通过同步 API 构建完成 kb_id={kb_id}")
                    return True
                logger.warning(f"画像同步 API 未返回完成凭据 kb_id={kb_id}")
                return False
            logger.warning(f"画像同步 API 返回非 2xx kb_id={kb_id} status={resp.status}")
            return False
    except urllib.error.HTTPError as e:
        logger.warning(f"画像同步 API 请求失败 kb_id={kb_id} code={e.code}: {e}")
        return False
    except Exception as e:
        logger.warning(f"画像同步 API 请求异常 kb_id={kb_id}: {e}")
        return False


def _schedule_portrait_via_sync_api(kb_id: str, trigger_token: Optional[str] = None) -> bool:
    """非阻塞地调用同步画像 API，避免 API 进程自调用时阻塞事件循环。"""
    try:
        Thread(
            target=_trigger_portrait_via_sync_api,
            args=(kb_id,),
            kwargs={"trigger_token": trigger_token} if trigger_token else {},
            daemon=True,
            name=f"portrait-sync-{kb_id[:8]}",
        ).start()
        logger.info(f"画像同步 API 已后台调度 kb_id={kb_id}")
        return True
    except Exception as e:
        logger.warning(f"画像同步 API 后台调度失败 kb_id={kb_id}: {e}")
        return False


def _enqueue_portrait_task(
    kb_id: str, *, force_update: bool, trigger_token: Optional[str] = None,
) -> bool:
    """投递画像任务；broker 不可用时返回 False 以使用非阻塞 HTTP 回退。"""
    try:
        from app.modules.knowledge.portraits import build_kb_portrait_task

        options: dict[str, Any] = {"force_update": force_update}
        if trigger_token:
            options["trigger_token"] = trigger_token
        build_kb_portrait_task.delay(kb_id, **options)
        logger.info(
            f"画像 Celery 任务已投递 kb_id={kb_id} force_update={force_update}"
        )
        return True
    except (ImportError, AttributeError) as e:
        logger.warning(f"画像 Celery 任务不可用 kb_id={kb_id}: {e}")
        return False
    except Exception as e:
        logger.warning(f"画像 Celery 任务投递失败 kb_id={kb_id}: {e}")
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
    """Administrative reset only; triggering work must use completion ACK."""
    try:
        client = _redis_client()
        key = f"{KEY_PREFIX}{kb_id}"
        client.delete(key)
    except Exception as e:
        logger.warning(f"reset_portrait_delta 失败 kb_id={kb_id}: {e}")


def _dispatch_pending_delta(kb_id: str) -> bool:
    """Coalesce threshold work; retain all dirty units until a completed build."""
    token = uuid.uuid4().hex
    client = _redis_client()
    count = int(client.eval(
        _CLAIM_SCRIPT, 2, f"{KEY_PREFIX}{kb_id}", f"{PENDING_KEY_PREFIX}{kb_id}",
        max(1, settings.portrait_update_threshold), token, PENDING_LEASE_SECONDS,
    ))
    if count <= 0:
        return False
    # The ingestion threshold already decided to refresh. A second 20%/7-day
    # gate must not discard that work as no_update_needed.
    if _enqueue_portrait_task(kb_id, force_update=True, trigger_token=token):
        return True
    if _schedule_portrait_via_sync_api(kb_id, trigger_token=token):
        return True
    # Neither transport was scheduled. Only release our own claim; no counter
    # restoration is needed because the snapshot was never subtracted.
    client.eval(_RELEASE_SCRIPT, 1, f"{PENDING_KEY_PREFIX}{kb_id}", token)
    return False


def complete_portrait_trigger(
    kb_id: str, trigger_token: Optional[str], result: dict[str, Any],
) -> bool:
    """Acknowledge only completed work and preserve concurrent increments.

    Retries keep the same token. Failed/abandoned jobs keep their dirty count;
    after the lease expires a subsequent trigger can claim it again. There is
    intentionally no background sweeper in this module.
    """
    if not trigger_token:
        return False
    status = result.get("status")
    storage = result.get("storage_result") or {}
    complete = status == "insufficient_data" or (
        status == "success" and isinstance(storage, dict) and storage.get("status") == "success"
    )
    if not complete:
        logger.warning("画像任务未完成，保留待更新计数 kb_id={} status={}", kb_id, status)
        return False
    try:
        remaining = int(_redis_client().eval(
            _ACK_SCRIPT, 2, f"{KEY_PREFIX}{kb_id}", f"{PENDING_KEY_PREFIX}{kb_id}", trigger_token,
        ))
        if remaining < 0:
            # A duplicate/expired worker must never consume a newer claim.
            return False
        if remaining >= max(1, settings.portrait_update_threshold):
            _dispatch_pending_delta(kb_id)
        return True
    except Exception as exc:
        logger.warning("画像完成确认失败，保留未确认变更 kb_id={}: {}", kb_id, exc)
        return False


def begin_portrait_trigger(kb_id: str, trigger_token: Optional[str]) -> bool:
    """Fence stale queued tasks and renew the valid worker's execution lease.

    The renewed lease exceeds Celery's hard execution limit. Redis errors are
    deliberately propagated so Celery retries without performing an untracked
    write; a missing/replaced token is an ordinary superseded task.
    """
    if not trigger_token:
        return True
    return bool(_redis_client().eval(
        _BEGIN_SCRIPT, 1, f"{PENDING_KEY_PREFIX}{kb_id}", trigger_token, PENDING_LEASE_SECONDS,
    ))


def increment_and_maybe_trigger(kb_id: str, delta: int) -> bool:
    """
    增加增量并检查是否达到阈值；构建成功确认后才扣除本次覆盖的计数。
    - 优先使用 Celery 异步任务。
    - 若任务投递失败，后台调用同步画像 API；不阻塞当前上传/删除请求。
    阈值使用 settings.portrait_update_threshold（默认 50）。
    返回是否触发了任务。
    """
    try:
        threshold = settings.portrait_update_threshold
        n = increment_portrait_delta(kb_id, delta)
        if n < threshold:
            return False
        return _dispatch_pending_delta(kb_id)
    except Exception as e:
        logger.warning(f"increment_and_maybe_trigger 失败 kb_id={kb_id} delta={delta}: {e}")
        return False


def trigger_portrait_rebuild(kb_id: str, reason: str = "data_changed") -> bool:
    """
    直接触发知识库画像重建（用于视频新增/删除等场景，数据量变化时需更新画像）。
    优先投递 Celery；投递失败时才非阻塞地回退同步 API。
    返回是否成功触发。
    """
    try:
        if _enqueue_portrait_task(kb_id, force_update=True):
            logger.info(f"画像重建已通过 Celery 触发 kb_id={kb_id} reason={reason}")
            return True
        if _schedule_portrait_via_sync_api(kb_id):
            logger.info(f"画像重建已通过后台同步 API 触发 kb_id={kb_id} reason={reason}")
            return True
        return False
    except Exception as e:
        logger.error(f"触发画像重建失败 kb_id={kb_id}: {e}")
        return False
