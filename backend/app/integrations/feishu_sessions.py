"""
飞书会话：与 Web chat 类似的 messages 列表，键为 feishu:{chat_id}。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

import redis

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

_MEMORY: Dict[str, Dict[str, Any]] = {}
_REDIS: Optional[redis.Redis] = None


def _redis() -> Optional[redis.Redis]:
    global _REDIS
    if settings.feishu_session_backend != "redis":
        return None
    if _REDIS is None:
        try:
            _REDIS = redis.Redis.from_url(settings.redis_url, decode_responses=True)
            _REDIS.ping()
        except Exception as e:
            logger.error(f"飞书会话 Redis 不可用，回退内存: {e}")
            return None
    return _REDIS


def _key(session_key: str) -> str:
    return f"feishu:session:{session_key}"


def load_session(session_key: str) -> Dict[str, Any]:
    r = _redis()
    if r:
        try:
            raw = r.get(_key(session_key))
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict) and "messages" in data:
                    return data
        except Exception as e:
            logger.warning(f"读取飞书会话失败: {e}")
    return _MEMORY.get(session_key) or {"id": session_key, "messages": []}


def save_session(session_key: str, session: Dict[str, Any]) -> None:
    session["updated_at"] = datetime.utcnow().isoformat()
    r = _redis()
    if r:
        try:
            r.set(_key(session_key), json.dumps(session, ensure_ascii=False), ex=86400 * 30)
            return
        except Exception as e:
            logger.warning(f"写入飞书会话 Redis 失败，改内存: {e}")
    _MEMORY[session_key] = session


def build_session_context(session: Dict[str, Any], limit: int = 10) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for msg in session.get("messages", [])[-limit:]:
        if msg.get("role") in ("user", "assistant"):
            out.append({"role": msg["role"], "content": (msg.get("content") or "")})
    return out


def append_turn(session_key: str, user_text: str, assistant_text: str) -> None:
    sess = load_session(session_key)
    if "messages" not in sess:
        sess["messages"] = []
    ts = datetime.utcnow().isoformat()
    sess["messages"].append({"role": "user", "content": user_text, "timestamp": ts})
    sess["messages"].append({"role": "assistant", "content": assistant_text, "timestamp": ts})
    save_session(session_key, sess)
