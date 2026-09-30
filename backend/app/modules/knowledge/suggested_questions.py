"""
基于知识库画像、文件分块、图片 caption、音视频描述等生成推荐检索问题。
轻量模型离线生成有来源的问题，首页只读问题池；缺失时后台补齐。
"""

from __future__ import annotations

import asyncio
from contextlib import contextmanager, ExitStack
import fcntl
import hashlib
import json
import random
import re
import time
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.llm.manager import llm_manager
from app.core.logger import get_logger
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.natural_questions import (
    NATURAL_QUESTION_VERSION, evidence_from_preview, generate_natural_questions,
    sample_evidence_for_kb, is_natural_question,
)

logger = get_logger(__name__)

# backend/data/suggestion_cache
CACHE_DIR = Path(__file__).resolve().parents[3] / "data" / "suggestion_cache"
PRECOMPUTED_DIR = CACHE_DIR / "precomputed_by_kb"
BANK_DIR = CACHE_DIR / "question_bank_by_kb"
CACHE_TTL_SECONDS_DEFAULT = 7 * 24 * 3600  # 7 天

MAX_CONTEXT_CHARS = 14000
MAX_CHUNK_SAMPLE = 3
MAX_CHUNK_CHARS = 450
MAX_CAPTION_CHARS = 600
MAX_KB_SAMPLE_GLOBAL = 8
MAX_FILES_PER_KB = 5
PREVIEW_TIMEOUT_SEC = 18.0
MAX_QUESTION_TEXT_CHARS = 96
SUGGESTION_STRATEGY_VERSION = NATURAL_QUESTION_VERSION
_background_tasks: Dict[str, asyncio.Task] = {}
_background_cooldowns: Dict[str, float] = {}
_generation_semaphore = asyncio.Semaphore(2)
BACKGROUND_RETRY_SECONDS = 300
MAX_BACKGROUND_SCOPES = 16
_CACHE_CLEANUP_INTERVAL_SEC = 600
_last_cache_cleanup_ts = 0.0

_UUID_RE = re.compile(
    r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b"
)
_LONG_OPAQUE_TOKEN_RE = re.compile(r"(?i)\b[0-9a-f]{16,}\b")
_FILE_REFERENCE_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9_.-])([a-z0-9][a-z0-9._-]{2,180}\."
    r"(?:png|jpe?g|gif|webp|bmp|tiff?|svg|pdf|docx?|pptx?|xlsx?|csv|txt|md|"
    r"mp3|wav|m4a|aac|flac|mp4|mov|avi|mkv|webm))(?![A-Za-z0-9_.-])"
)
_TEMP_FILE_PREFIX_RE = re.compile(
    r"(?i)^(?:"
    r"codex[-_ ]*clipboard|clipboard|pasted?[-_ ]*(?:image|file)|"
    r"screen[-_ ]*shot|screenshot|image|img|upload(?:ed)?|"
    r"wechatimg|wx_camera|mmexport|dsc|pxl"
    r")[-_ .]*"
)
_GENERIC_FILE_WORD_RE = re.compile(
    r"(?i)\b(?:at|copy|file|image|photo|picture|scan|new|final)\b"
)
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg"}
_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac"}
_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def _sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()


def _trim(s: str, max_len: int) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _payload(p: Any) -> Dict[str, Any]:
    if p is None:
        return {}
    return p if isinstance(p, dict) else {}


def _safe_json_loads_array(raw: str) -> List[str]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", text)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []

    out: List[str] = []
    if isinstance(data, list):
        for x in data:
            if isinstance(x, str) and x.strip():
                out.append(x.strip())
            elif isinstance(x, dict) and x.get("text"):
                t = str(x["text"]).strip()
                if t:
                    out.append(t)
    elif isinstance(data, dict):
        for key in ("questions", "items", "data"):
            arr = data.get(key)
            if isinstance(arr, list):
                for x in arr:
                    if isinstance(x, str) and x.strip():
                        out.append(x.strip())
                    elif isinstance(x, dict) and x.get("text"):
                        t = str(x["text"]).strip()
                        if t:
                            out.append(t)
                break
    return out


def _readable_file_title(file_name: str) -> str:
    """将人工标题与上传工具生成的临时文件名区分开。"""
    raw_name = re.split(r"[/\\]", str(file_name or "").strip())[-1]
    stem = re.sub(r"\.[^.]+$", "", raw_name).strip()
    if not stem:
        return ""

    had_temp_prefix = bool(_TEMP_FILE_PREFIX_RE.match(stem))
    cleaned = _TEMP_FILE_PREFIX_RE.sub("", stem)
    cleaned = _UUID_RE.sub(" ", cleaned)
    cleaned = _LONG_OPAQUE_TOKEN_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[-_.]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_.")
    semantic = _GENERIC_FILE_WORD_RE.sub(" ", cleaned)
    semantic = re.sub(r"[\d\s:.-]+", " ", semantic).strip()

    # 截图时间、纯编号、UUID/哈希与工具前缀都不应被当成用户可读主题。
    if not semantic or not re.search(r"[A-Za-z\u4e00-\u9fff]", semantic):
        return ""
    if had_temp_prefix and not re.sub(r"(?i)[0-9a-f\s:.-]+", "", cleaned):
        return ""
    if had_temp_prefix and len(semantic) < 3:
        return ""
    return _trim(cleaned, 48)


def _generic_material_label(file_name: str) -> str:
    suffix = Path(str(file_name or "")).suffix.lower()
    if suffix in _IMAGE_EXTENSIONS:
        return "上传图片"
    if suffix in _AUDIO_EXTENSIONS:
        return "上传音频"
    if suffix in _VIDEO_EXTENSIONS:
        return "上传视频"
    return "上传材料"


def _remove_opaque_file_references(text: str) -> str:
    """清理旧缓存或模型偶尔复述的 UUID/临时文件名，同时保留问题主题。"""
    cleaned = text
    removed = False
    for match in list(_FILE_REFERENCE_RE.finditer(text)):
        file_ref = match.group(1)
        if _readable_file_title(file_ref):
            continue
        cleaned = cleaned.replace(file_ref, "")
        removed = True

    if not removed:
        return cleaned

    cleaned = re.sub(r"[「《“\"]\s*[」》”\"]", "", cleaned)
    cleaned = re.sub(
        r"(?:在|从|根据|关于)?\s*(?:该|这个|这份|这张)?\s*"
        r"(?:文件|文档|图片|图像|附件)\s*"
        r"(?:中|里|内|所示(?:的)?|显示(?:的)?)?\s*[，,:：]?\s*",
        "",
        cleaned,
    )
    cleaned = re.sub(r"^\s*(?:中|里|内)(?:的)?\s*", "", cleaned)
    return cleaned


def _normalize_question_text(text: str) -> str:
    t = str(text or "").strip()
    if not t:
        return ""
    t = re.sub(r"^[\-\*\d\.\)\s]+", "", t)
    t = _remove_opaque_file_references(t)
    t = re.sub(r"\s+", " ", t).strip()
    t = t.strip("，,。;；:：")
    if not t:
        return ""
    if len(t) > MAX_QUESTION_TEXT_CHARS:
        t = t[: MAX_QUESTION_TEXT_CHARS - 1].strip() + "…"
    if t[-1] not in ("?", "？"):
        t = f"{t}？"
    return t


def _canonical_question_key(text: str) -> str:
    t = _normalize_question_text(text).lower()
    t = re.sub(r"[?？!！。,.，;；:：]+$", "", t).strip()
    return t


def _normalize_question_items(
    questions: Sequence[Any],
    *,
    kb_name: str,
    max_q: int,
) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for q in questions:
        if isinstance(q, dict):
            text = _normalize_question_text(str(q.get("text") or ""))
            q_kb_name = str(q.get("kb_name") or kb_name)
        else:
            text = _normalize_question_text(str(q))
            q_kb_name = kb_name
        if not text:
            continue
        key = _canonical_question_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"text": text, "kb_name": q_kb_name})
        if len(out) >= max_q:
            break
    return out


async def _preview_with_timeout(
    kb_service: KnowledgeBaseService, kb_id: str, file_id: str
) -> Dict[str, Any]:
    try:
        return await asyncio.wait_for(
            kb_service.get_file_preview_details(kb_id, file_id),
            timeout=PREVIEW_TIMEOUT_SEC,
        )
    except Exception as e:
        logger.debug("get_file_preview_details 超时或失败 %s/%s: %s", kb_id, file_id, e)
        return {"caption": None, "chunks": [], "transcript": None, "description": None}


def _format_file_block(file_name: str, details: Dict[str, Any]) -> str:
    lines: List[str] = []
    readable_title = _readable_file_title(file_name)
    if readable_title:
        lines.append(f"### 素材主题: {readable_title}")
    else:
        lines.append(f"### 素材类型: {_generic_material_label(file_name)}（临时文件名已省略）")
    chunks = details.get("chunks") or []
    if isinstance(chunks, list) and chunks:
        parts = []
        for c in chunks[:MAX_CHUNK_SAMPLE]:
            if not isinstance(c, dict):
                continue
            t = (c.get("text") or "").strip()
            if t:
                parts.append(_trim(t, MAX_CHUNK_CHARS))
        if parts:
            lines.append("- 文档分块摘录:\n" + "\n".join(f"  · {p}" for p in parts))

    cap = details.get("caption") or ""
    if isinstance(cap, str) and cap.strip():
        lines.append(f"- 图片/视频画面说明:\n{_trim(cap.strip(), MAX_CAPTION_CHARS)}")

    desc = details.get("description") or ""
    tr = details.get("transcript") or ""
    audio_bits = []
    if isinstance(desc, str) and desc.strip():
        audio_bits.append(f"概述: {_trim(desc.strip(), MAX_CAPTION_CHARS)}")
    if isinstance(tr, str) and tr.strip():
        audio_bits.append(f"转写摘录: {_trim(tr.strip(), MAX_CAPTION_CHARS)}")
    if audio_bits:
        lines.append("- 音频:\n" + "\n".join(f"  · {b}" for b in audio_bits))

    if len(lines) == 1:
        lines.append("(无可用分块或说明)")
    return "\n".join(lines)


def _portrait_summaries(portraits: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for p in portraits:
        pl = _payload(p.get("payload"))
        summary = (pl.get("topic_summary") or "").strip()
        if summary:
            size = pl.get("cluster_size", 0)
            out.append(f"- ({size}条) { _trim(summary, 500)}")
    return out


def _fallback_seed_from_file_block(block: str) -> str:
    """优先从材料内容抽主题；仅在标题可读时才退回标题。"""
    title_seed = ""
    for raw_line in str(block or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("## 知识库:"):
            continue
        if line.startswith("### 素材主题:"):
            title_seed = line.split(":", 1)[-1].strip()
            continue
        if line.startswith("###") or line in {
            "- 文档分块摘录:",
            "- 图片/视频画面说明:",
            "- 音频:",
        }:
            continue
        line = re.sub(r"^[·\-]\s*", "", line)
        line = re.sub(r"^(?:概述|转写摘录)\s*[:：]\s*", "", line)
        line = line.strip()
        if len(line) >= 4:
            return _trim(line, 30)
    return _trim(title_seed, 24)


def _fallback_questions_from_context(
    kb_names: List[str],
    portrait_lines: List[str],
    file_lines: List[str],
    max_q: int,
) -> List[Dict[str, str]]:
    """无 LLM 时的模板兜底。"""
    seeds: List[str] = []
    for line in portrait_lines[:6]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.search(r"\)\s*(.+)$", line)
        if m:
            seeds.append(_trim(m.group(1).strip(), 24))
        else:
            seeds.append(_trim(line.replace("- ", "").strip(), 24))
    if not seeds and file_lines:
        for block in file_lines[:3]:
            seed = _fallback_seed_from_file_block(block)
            if seed:
                seeds.append(seed)
    seeds = [s for s in seeds if s][:6]
    if not seeds:
        seeds = ["知识库内容"]

    templates = [
        lambda s: f"关于「{s}」，材料里有哪些结论或要点？",
        lambda s: f"「{s}」相关的流程或注意事项是什么？",
        lambda s: f"材料如何说明「{s}」的核心含义？",
    ]
    kb_label = kb_names[0] if len(kb_names) == 1 else "多个知识库"
    out: List[Dict[str, str]] = []
    for i in range(min(max_q, len(seeds) if seeds else max_q)):
        seed = seeds[i % len(seeds)]
        text = templates[i % len(templates)](seed)
        out.append({"text": text, "kb_name": kb_label})
        if len(out) >= max_q:
            break
    return out[:max_q]


def _cache_path(cache_key: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", cache_key[:80])
    return CACHE_DIR / f"{safe}.json"


def _read_cache(cache_key: str, ttl_sec: int) -> Optional[Dict[str, Any]]:
    path = _cache_path(cache_key)
    if not path.is_file():
        return None
    try:
        age = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
        if age > ttl_sec:
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("cache_key") != cache_key:
            logger.info(
                "推荐问题缓存键冲突(文件名截断导致) path=%s expect=%s got=%s",
                path.name,
                cache_key[:16],
                str(raw.get("cache_key") or "")[:16],
            )
            return None
        return raw
    except Exception as e:
        logger.debug("读取推荐问题缓存失败: %s", e)
        return None


def _write_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = _cache_path(cache_key)
        out = {**payload, "cache_key": cache_key, "saved_at": datetime.now(timezone.utc).isoformat()}
        _atomic_write_json(path, out)
    except Exception as e:
        logger.warning("写入推荐问题缓存失败: %s", e)


def _cleanup_expired_cache_files(ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT) -> None:
    global _last_cache_cleanup_ts
    now = time.time()
    if now - _last_cache_cleanup_ts < _CACHE_CLEANUP_INTERVAL_SEC:
        return
    _last_cache_cleanup_ts = now
    if not CACHE_DIR.exists():
        return
    removed = 0
    scanned = 0
    now_ts = datetime.now(timezone.utc).timestamp()
    for path in CACHE_DIR.glob("*.json"):
        scanned += 1
        if path.parent in (PRECOMPUTED_DIR, BANK_DIR):
            continue
        try:
            age = now_ts - path.stat().st_mtime
            if age > ttl_sec:
                path.unlink(missing_ok=True)
                removed += 1
        except Exception:
            continue
    if removed > 0:
        logger.info("推荐问题缓存清理完成 removed=%s scanned=%s", removed, scanned)


def _precomputed_path(kb_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", str(kb_id).strip()) or "unknown_kb"
    return PRECOMPUTED_DIR / f"{safe}.json"


def _bank_path(kb_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", str(kb_id).strip()) or "unknown_kb"
    return BANK_DIR / f"{safe}.json"


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    """Separate writers must never share a temporary filename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, indent=2)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def _bank_lock(kb_id: str):
    """Lock the complete read/merge/write operation across API and worker processes."""
    BANK_DIR.mkdir(parents=True, exist_ok=True)
    # Keep lock files when deleting banks so another process cannot lock a new inode.
    with _bank_path(kb_id).with_suffix(".lock").open("a+") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def _scope_locks(kb_ids: Sequence[str]):
    # All callers take multiple locks in the same order. No await occurs inside.
    with ExitStack() as stack:
        for kb_id in sorted(set(kb_ids)):
            stack.enter_context(_bank_lock(kb_id))
        yield


def _generation_epoch(kb_id: str) -> str:
    path = _bank_path(kb_id).with_suffix(".epoch")
    try:
        return str(json.loads(path.read_text(encoding="utf-8"))["epoch"])
    except FileNotFoundError:
        return "initial"


def _invalidate_generation(kb_id: str) -> None:
    # Called under the KB lock, even when no bank has ever been created.
    _atomic_write_json(_bank_path(kb_id).with_suffix(".epoch"), {"epoch": uuid.uuid4().hex})


def _epochs_match(epochs: Dict[str, str]) -> bool:
    return all(_generation_epoch(kb_id) == epoch for kb_id, epoch in epochs.items())


def _read_question_bank(kb_id: str) -> Dict[str, Any]:
    path = _bank_path(kb_id)
    if not path.is_file():
        return {"kb_id": kb_id, "questions": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if str(raw.get("kb_id") or "") != str(kb_id):
            return {"kb_id": kb_id, "questions": []}
        if not isinstance(raw.get("questions"), list):
            raw["questions"] = []
        return raw
    except Exception:
        return {"kb_id": kb_id, "questions": []}


def _write_question_bank(kb_id: str, payload: Dict[str, Any]) -> None:
    try:
        BANK_DIR.mkdir(parents=True, exist_ok=True)
        path = _bank_path(kb_id)
        out = {
            "kb_id": kb_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "strategy": SUGGESTION_STRATEGY_VERSION,
            "questions": payload.get("questions", []),
        }
        _atomic_write_json(path, out)
    except Exception as e:
        logger.warning("写入问题池失败 kb_id=%s: %s", kb_id, e)


def add_questions_to_bank(
    kb_id: str,
    questions: Sequence[Dict[str, str]],
    *,
    source: str,
    file_id: Optional[str] = None,
    max_total: int = 800,
    replace_file_ids: Sequence[str] = (),
) -> int:
    """写入知识库问题池（去重、限量）。"""
    with _bank_lock(kb_id):
        return _add_questions_to_bank_unlocked(kb_id, questions, source=source, file_id=file_id,
                                               max_total=max_total, replace_file_ids=replace_file_ids)


def _add_questions_to_bank_unlocked(
    kb_id: str, questions: Sequence[Dict[str, str]], *, source: str,
    file_id: Optional[str] = None, max_total: int = 800, replace_file_ids: Sequence[str] = (),
) -> int:
    if not questions:
        return 0
    bank = _read_question_bank(kb_id)
    existing = [q for q in bank.get("questions", []) or []
                if isinstance(q, dict) and q.get("strategy") == SUGGESTION_STRATEGY_VERSION
                and q.get("file_id") not in replace_file_ids]
    seen = {(q.get("file_id"), _canonical_question_key(str(q.get("text") or ""))) for q in existing}
    added = 0
    now = datetime.now(timezone.utc).isoformat()
    for q in questions:
        if q.get("strategy") != SUGGESTION_STRATEGY_VERSION or not q.get("evidence_quote") or not is_natural_question(q.get("text")):
            continue
        text = _normalize_question_text(str((q or {}).get("text") or ""))
        key = (file_id or q.get("file_id"), _canonical_question_key(text))
        if not text or not key or key in seen:
            continue
        seen.add(key)
        existing.append(
            {
                **q,
                "id": _sha256_text(f"{kb_id}|{file_id or q.get('file_id') or ''}|{text}")[:16],
                "text": text,
                "kb_name": str((q or {}).get("kb_name") or kb_id),
                "source": source,
                "file_id": file_id or q.get("file_id"),
                "created_at": now,
            }
        )
        added += 1
    if len(existing) > max_total:
        existing = existing[-max_total:]
    _write_question_bank(kb_id, {"questions": existing})
    return added


def remove_questions_by_file(kb_id: str, file_id: str) -> int:
    with _bank_lock(kb_id):
        _invalidate_generation(kb_id)
        bank = _read_question_bank(kb_id)
        qs = bank.get("questions", []) or []
        kept = [q for q in qs if str((q or {}).get("file_id") or "") != str(file_id)]
        removed = len(qs) - len(kept)
        if removed > 0:
            _write_question_bank(kb_id, {"questions": kept})
        _precomputed_path(kb_id).unlink(missing_ok=True)
        return removed


def remove_kb_question_bank(kb_id: str) -> None:
    try:
        with _bank_lock(kb_id):
            _invalidate_generation(kb_id)
            _bank_path(kb_id).unlink(missing_ok=True)
            _precomputed_path(kb_id).unlink(missing_ok=True)
    except Exception as e:
        logger.warning("删除知识库问题缓存失败 kb_id=%s: %s", kb_id, e)


def _write_precomputed_for_kb(kb_id: str, payload: Dict[str, Any]) -> None:
    """每个知识库维护一份“可秒读”的预生成问题快照。"""
    try:
        PRECOMPUTED_DIR.mkdir(parents=True, exist_ok=True)
        path = _precomputed_path(kb_id)
        out = {
            "kb_id": kb_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **payload,
            "strategy": SUGGESTION_STRATEGY_VERSION,
        }
        _atomic_write_json(path, out)
    except Exception as e:
        logger.warning("写入 KB 预生成问题缓存失败 kb_id=%s: %s", kb_id, e)


def _read_precomputed_for_kb(kb_id: str, ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT) -> Optional[Dict[str, Any]]:
    path = _precomputed_path(kb_id)
    if not path.is_file():
        return None
    try:
        age = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
        if age > ttl_sec:
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        if str(raw.get("kb_id") or "") != str(kb_id):
            return None
        if raw.get("strategy") != SUGGESTION_STRATEGY_VERSION or raw.get("source") != "llm":
            return None
        return raw
    except Exception:
        return None


async def get_precomputed_questions_fast(
    kb_service: KnowledgeBaseService,
    *,
    kb_mode: str,
    knowledge_base_ids: Sequence[str],
    selected_files: Sequence[Dict[str, Any]],
    max_questions: int,
    ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT,
) -> List[Dict[str, str]]:
    """Compatibility wrapper returning only stored, scope-matching questions."""
    result = await get_suggested_questions_fast(
        kb_service, kb_mode=kb_mode, knowledge_base_ids=knowledge_base_ids,
        selected_files=selected_files, max_questions=max_questions, ttl_sec=ttl_sec,
        include_fallback=False,
    )
    return result['questions']


def _current_questions(items: Sequence[Any]) -> List[Dict[str, Any]]:
    return [q for q in items if isinstance(q, dict)
            and q.get("strategy") == SUGGESTION_STRATEGY_VERSION
            and q.get("evidence_quote") and q.get("file_id") and is_natural_question(q.get("text"))]


def _schedule_background_generation(kb_service, kb, selected_files) -> bool:
    files = [f for f in selected_files if str(f.get("kb_id")) == str(kb["id"])]
    key = json.dumps([kb["id"], sorted(str(f["file_id"]) for f in files)], ensure_ascii=False)
    existing = _background_tasks.get(key)
    if existing and not existing.done():
        return True
    now = time.monotonic()
    for old_key, deadline in list(_background_cooldowns.items()):
        if deadline <= now:
            _background_cooldowns.pop(old_key, None)
    if _background_cooldowns.get(key, 0) > now or len(_background_tasks) >= MAX_BACKGROUND_SCOPES:
        return False

    async def run():
        try:
            async with _generation_semaphore:
                await asyncio.wait_for(build_context_and_questions_payload(
                    kb_service, kb_mode="files" if files else "manual",
                    knowledge_base_ids=[kb["id"]], selected_files=files,
                    max_questions=8, use_llm=True, refresh=True,
                ), timeout=90)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("推荐问题后台生成失败 kb_id={}", kb["id"], exc_info=True)
        finally:
            _background_tasks.pop(key, None)
            _background_cooldowns[key] = time.monotonic() + BACKGROUND_RETRY_SECONDS

    _background_tasks[key] = asyncio.create_task(run(), name=f"suggestions:{kb['id']}")
    return True


async def stop_suggestion_background_tasks() -> None:
    tasks = list(_background_tasks.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _background_tasks.clear()


async def get_suggested_questions_fast(
    kb_service: KnowledgeBaseService,
    *,
    kb_mode: str,
    knowledge_base_ids: Sequence[str],
    selected_files: Sequence[Dict[str, Any]],
    max_questions: int,
    ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT,
    include_fallback: bool = True,
    use_llm: bool = True,
) -> Dict[str, Any]:
    """Read versioned, grounded questions; never await a model on the landing page."""
    max_q = max(1, min(int(max_questions or 3), 10))
    candidate_kbs = await _pick_candidate_kbs(
        kb_service, kb_mode, knowledge_base_ids, selected_files, exclude_known_empty=True,
    )
    if not candidate_kbs:
        return {"questions": [], "source": "empty", "cached": False, "error": "no_knowledge_bases"}
    allowed_files = {(str(f.get("kb_id") or ""), str(f.get("file_id") or "")) for f in selected_files}
    pools = []
    warming = False
    used_bank = False
    for kb in candidate_kbs:
        kb_id = str(kb["id"])
        pool = []
        for question in _current_questions(_read_question_bank(kb_id).get("questions") or []):
            if selected_files and (kb_id, str(question.get("file_id") or "")) not in allowed_files:
                continue
            pool.append({"text": question["text"], "kb_name": str(kb.get("name") or "知识库")})
            used_bank = True
        if not selected_files:
            precomputed = _read_precomputed_for_kb(kb_id, ttl_sec=ttl_sec)
            if precomputed:
                pool.extend({"text": q["text"], "kb_name": str(kb.get("name") or "知识库")}
                            for q in _current_questions(precomputed.get("questions") or []))
        if not pool and include_fallback and use_llm:
            warming = _schedule_background_generation(kb_service, kb, selected_files) or warming
        random.shuffle(pool)
        if pool:
            pools.append(pool)
    # Round-robin across libraries so a large paper bank cannot crowd out images/audio.
    random.shuffle(pools)
    pool = [items[i] for i in range(max((len(p) for p in pools), default=0))
            for items in pools if i < len(items)]
    questions = _normalize_question_items(pool, kb_name="知识库", max_q=max_q)
    if questions:
        return {"questions": questions, "source": "question_bank" if used_bank else "precomputed", "cached": True}
    return {"questions": [], "source": "warming" if warming else "unavailable", "cached": False,
            **({"retry_after_ms": 2000} if warming else {})}


async def _pick_candidate_kbs(
    kb_service: KnowledgeBaseService,
    kb_mode: str,
    knowledge_base_ids: Sequence[str],
    selected_files: Sequence[Dict[str, Any]],
    *,
    exclude_known_empty: bool = False,
) -> List[Dict[str, Any]]:
    if not selected_files and (kb_mode == 'files' or (kb_mode == 'manual' and not knowledge_base_ids)):
        return []
    all_kbs = await kb_service.list_knowledge_bases()
    if not all_kbs:
        return []
    if exclude_known_empty:
        def known_empty(kb):
            stats = kb.get('statistics') or {}
            keys = ('total_chunks', 'total_images', 'total_audio', 'total_video')
            # Missing statistics mean unknown, rather than an empty library.
            return all(isinstance(stats.get(key), (int, float)) and stats[key] == 0 for key in keys)

        # Filter before the global sample: empty libraries must not use all
        # eight slots while an indexed library remains outside the sample.
        all_kbs = [kb for kb in all_kbs if not known_empty(kb)]

    if selected_files:
        kb_ids = sorted({str(f.get("kb_id") or "").strip() for f in selected_files if f.get("kb_id")})
        return [k for k in all_kbs if k.get("id") in kb_ids]

    if kb_mode == "manual" and knowledge_base_ids:
        wanted = {str(x).strip() for x in knowledge_base_ids if str(x).strip()}
        return [k for k in all_kbs if k.get("id") in wanted]

    # auto / all：随机抽样若干知识库
    pool = list(all_kbs)
    random.shuffle(pool)
    return pool[:MAX_KB_SAMPLE_GLOBAL]


async def build_context_and_questions_payload(
    kb_service: KnowledgeBaseService,
    *,
    kb_mode: str,
    knowledge_base_ids: Sequence[str],
    selected_files: Sequence[Dict[str, Any]],
    max_questions: int,
    use_llm: bool,
    refresh: bool,
    prefer_precomputed: bool = True,
    cache_ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT,
) -> Dict[str, Any]:
    """Cached-first suggestions; explicit generation uses only parsed source evidence."""
    max_q = max(1, min(int(max_questions or 3), 10))
    if prefer_precomputed and not refresh:
        return await get_suggested_questions_fast(
            kb_service, kb_mode=kb_mode, knowledge_base_ids=knowledge_base_ids,
            selected_files=selected_files, max_questions=max_q, ttl_sec=cache_ttl_sec,
            use_llm=use_llm,
        )
    if not use_llm:
        return {"questions": [], "source": "unavailable", "cached": False}
    candidates = await _pick_candidate_kbs(kb_service, kb_mode, knowledge_base_ids, selected_files)
    if not candidates:
        return {"questions": [], "source": "empty", "cached": False}
    kb_ids = [str(kb["id"]) for kb in candidates]
    with _scope_locks(kb_ids):
        epochs = {kb_id: _generation_epoch(kb_id) for kb_id in kb_ids}
    evidence = []
    for kb in candidates:
        kb_id, kb_name = str(kb["id"]), str(kb.get("name") or kb["id"])
        files = [f for f in selected_files if str(f.get("kb_id")) == kb_id]
        # The UI preview permits a legacy global file_id fallback. Generation must
        # always enforce both KB and file filters before assigning source ownership.
        evidence.extend(await asyncio.wait_for(sample_evidence_for_kb(
            kb_service, kb_id, kb_name,
            file_ids=[str(f["file_id"]) for f in files] if files else None, limit=24,
        ), timeout=20))
    if not evidence:
        return {"questions": [], "source": "empty", "cached": False, "note": "no_parsed_evidence"}
    revision = _sha256_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
    cache_key = _sha256_text(
        f"{SUGGESTION_STRATEGY_VERSION}|{revision}|{max_q}|{json.dumps(epochs, sort_keys=True)}"
    )
    _cleanup_expired_cache_files(cache_ttl_sec)
    if not refresh:
        with _scope_locks(kb_ids):
            if not _epochs_match(epochs):
                return {"questions": [], "source": "unavailable", "cached": False, "note": "scope_changed"}
            cached = _read_cache(cache_key, cache_ttl_sec)
            if cached and _current_questions(cached.get("questions") or []):
                return {**cached, "source": "scope_cache", "cached": True}
    generated = await generate_natural_questions(evidence, max_questions=max_q, llm=llm_manager)
    questions = generated.get("questions") or []
    payload = {**generated, "questions": questions, "revision": revision, "cache_key": cache_key,
               "cached": False, "strategy": SUGGESTION_STRATEGY_VERSION}
    if questions:
        with _scope_locks(kb_ids):
            if not _epochs_match(epochs):
                return {"questions": [], "source": "unavailable", "cached": False, "note": "scope_changed"}
            for kb in candidates:
                own_questions = [q for q in questions if str(q.get("kb_id")) == str(kb["id"])]
                if not own_questions:
                    continue
                _add_questions_to_bank_unlocked(str(kb["id"]), own_questions, source="llm", replace_file_ids=[
                    str(f["file_id"]) for f in selected_files if str(f.get("kb_id")) == str(kb["id"])
                ])
                if not selected_files:
                    _write_precomputed_for_kb(str(kb["id"]), {**payload, "questions": own_questions})
            _write_cache(cache_key, payload)
    return payload


async def warmup_suggested_questions_for_kb(
    kb_id: str,
    *,
    max_questions: int = 3,
    use_llm: bool = True,
) -> None:
    """入库后后台预热：生成该知识库的推荐问题缓存，供新会话秒读。"""
    try:
        kb_service = KnowledgeBaseService()
        result = await build_context_and_questions_payload(
            kb_service,
            kb_mode="manual",
            knowledge_base_ids=[kb_id],
            selected_files=[],
            max_questions=max_questions,
            use_llm=use_llm,
            refresh=True,
        )
        logger.info(
            "推荐问题预热完成 kb_id=%s source=%s count=%s",
            kb_id,
            result.get("source"),
            len(result.get("questions") or []),
        )
    except Exception as e:
        logger.warning("推荐问题预热失败 kb_id=%s: %s", kb_id, e, exc_info=True)


async def generate_questions_for_file_and_store(
    kb_id: str,
    file_id: str,
    *,
    file_name: Optional[str] = None,
    max_questions: int = 6,
    use_llm: bool = True,
) -> int:
    """
    基于单文件材料生成一批问题并写入知识库问题池。
    供“文件入库完成后”触发，避免新会话现场生成。
    """
    kb_service = KnowledgeBaseService()
    async with _generation_semaphore:
        payload = await build_context_and_questions_payload(
            kb_service,
            kb_mode="files",
            knowledge_base_ids=[],
            selected_files=[{"kb_id": kb_id, "file_id": file_id, "name": file_name or file_id}],
            max_questions=max_questions,
            use_llm=use_llm,
            refresh=True,
        )
    questions = payload.get("questions") or []
    # build_context_and_questions_payload already persists this file's validated batch.
    added = sum(str(q.get("file_id")) == file_id for q in questions)
    logger.info("文件入库问题生成完成 kb_id=%s file_id=%s added=%s", kb_id, file_id, added)
    return added
