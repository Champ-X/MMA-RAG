"""
飞书会话：与 Web chat 类似的 messages 列表，键为 feishu:{chat_id}。
"""

from __future__ import annotations

import json
import time
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


def get_feishu_default_kb_ids(session_key: str) -> Optional[List[str]]:
    sess = load_session(session_key)
    raw = sess.get("feishu_default_kb_ids")
    if not isinstance(raw, list) or not raw:
        return None
    out = [str(x).strip() for x in raw if str(x).strip()]
    return out or None


def set_feishu_default_kb_ids(session_key: str, kb_ids: List[str]) -> None:
    sess = load_session(session_key)
    ids = [str(x).strip() for x in kb_ids if str(x).strip()]
    if ids:
        sess["feishu_default_kb_ids"] = ids
    else:
        sess.pop("feishu_default_kb_ids", None)
    save_session(session_key, sess)


def clear_feishu_default_kb_ids(session_key: str) -> None:
    sess = load_session(session_key)
    sess.pop("feishu_default_kb_ids", None)
    save_session(session_key, sess)


def get_feishu_upload_kb_id(session_key: str) -> Optional[str]:
    sess = load_session(session_key)
    v = sess.get("feishu_upload_kb_id")
    return str(v).strip() if isinstance(v, str) and v.strip() else None


def set_feishu_upload_kb_id(session_key: str, kb_id: Optional[str]) -> None:
    sess = load_session(session_key)
    kid = (kb_id or "").strip()
    if kid:
        sess["feishu_upload_kb_id"] = kid
    else:
        sess.pop("feishu_upload_kb_id", None)
    save_session(session_key, sess)


def get_feishu_pending_kb_delete(session_key: str) -> Optional[Dict[str, Any]]:
    sess = load_session(session_key)
    p = sess.get("feishu_pending_kb_delete")
    return p if isinstance(p, dict) else None


def set_feishu_pending_kb_delete(session_key: str, payload: Dict[str, Any]) -> None:
    sess = load_session(session_key)
    sess["feishu_pending_kb_delete"] = payload
    save_session(session_key, sess)


def clear_feishu_pending_kb_delete(session_key: str) -> None:
    sess = load_session(session_key)
    sess.pop("feishu_pending_kb_delete", None)
    save_session(session_key, sess)


def get_feishu_wizard(session_key: str) -> Optional[Dict[str, Any]]:
    """面板「一步指引」：用户点按钮后，下一条非指令文本按 kind 解释。"""
    sess = load_session(session_key)
    w = sess.get("feishu_wizard")
    return w if isinstance(w, dict) else None


def set_feishu_wizard(session_key: str, kind: str, ttl_sec: float = 600.0) -> None:
    sess = load_session(session_key)
    sess["feishu_wizard"] = {
        "kind": kind,
        "expires_at": time.time() + max(60.0, float(ttl_sec)),
    }
    save_session(session_key, sess)


def clear_feishu_wizard(session_key: str) -> None:
    sess = load_session(session_key)
    sess.pop("feishu_wizard", None)
    save_session(session_key, sess)
