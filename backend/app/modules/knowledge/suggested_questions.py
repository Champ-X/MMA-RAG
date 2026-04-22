"""
基于知识库画像、文件分块、图片 caption、音视频描述等生成推荐检索问题。
支持 LLM 生成与本地模板兜底；结果按内容摘要哈希落盘缓存。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.llm.manager import llm_manager
from app.core.logger import get_logger
from app.modules.knowledge.service import KnowledgeBaseService

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


def _format_file_block(
    kb_name: str,
    file_name: str,
    file_id: str,
    details: Dict[str, Any],
) -> str:
    lines: List[str] = []
    lines.append(f"### 文件: {file_name} (id={file_id})")
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


def _fallback_questions_from_context(
    kb_names: List[str],
    portrait_lines: List[str],
    file_lines: List[str],
    max_q: int,
) -> List[Dict[str, str]]:
    """无 LLM 时的模板兜底。"""
    seeds: List[str] = []
    for line in portrait_lines[:6]:
        m = re.search(r"\)\s*(.+)$", line)
        if m:
            seeds.append(_trim(m.group(1).strip(), 24))
        else:
            seeds.append(_trim(line.replace("- ", "").strip(), 24))
    if not seeds and file_lines:
        for block in file_lines[:3]:
            if "### 文件:" in block:
                m = re.search(r"### 文件:\s*([^(\n]+)", block)
                if m:
                    seeds.append(_trim(m.group(1).strip(), 24))
    seeds = [s for s in seeds if s][:6]
    if not seeds:
        seeds = ["知识库内容"]

    templates = [
        lambda s: f"关于「{s}」，材料里有哪些结论或要点？",
        lambda s: f"「{s}」相关的流程或注意事项是什么？",
        lambda s: f"如何用常识理解「{s}」这条线在材料中的含义？",
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
            return None
        return raw
    except Exception as e:
        logger.debug("读取推荐问题缓存失败: %s", e)
        return None


def _write_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = _cache_path(cache_key)
        tmp = path.with_suffix(".tmp")
        out = {**payload, "cache_key": cache_key, "saved_at": datetime.now(timezone.utc).isoformat()}
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception as e:
        logger.warning("写入推荐问题缓存失败: %s", e)


def _precomputed_path(kb_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", str(kb_id).strip()) or "unknown_kb"
    return PRECOMPUTED_DIR / f"{safe}.json"


def _bank_path(kb_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", str(kb_id).strip()) or "unknown_kb"
    return BANK_DIR / f"{safe}.json"


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
        tmp = path.with_suffix(".tmp")
        out = {
            "kb_id": kb_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "questions": payload.get("questions", []),
        }
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except Exception as e:
        logger.warning("写入问题池失败 kb_id=%s: %s", kb_id, e)


def add_questions_to_bank(
    kb_id: str,
    questions: Sequence[Dict[str, str]],
    *,
    source: str,
    file_id: Optional[str] = None,
    max_total: int = 800,
) -> int:
    """写入知识库问题池（去重、限量）。"""
    if not questions:
        return 0
    bank = _read_question_bank(kb_id)
    existing = bank.get("questions", []) or []
    seen = {str((q or {}).get("text") or "").strip() for q in existing}
    added = 0
    now = datetime.now(timezone.utc).isoformat()
    for q in questions:
        text = str((q or {}).get("text") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        existing.append(
            {
                "id": _sha256_text(f"{kb_id}|{file_id or ''}|{text}")[:16],
                "text": text,
                "kb_name": str((q or {}).get("kb_name") or kb_id),
                "source": source,
                "file_id": file_id,
                "created_at": now,
            }
        )
        added += 1
    if len(existing) > max_total:
        existing = existing[-max_total:]
    _write_question_bank(kb_id, {"questions": existing})
    return added


def remove_questions_by_file(kb_id: str, file_id: str) -> int:
    bank = _read_question_bank(kb_id)
    qs = bank.get("questions", []) or []
    kept = [q for q in qs if str((q or {}).get("file_id") or "") != str(file_id)]
    removed = len(qs) - len(kept)
    if removed > 0:
        _write_question_bank(kb_id, {"questions": kept})
    return removed


def remove_kb_question_bank(kb_id: str) -> None:
    try:
        p1 = _bank_path(kb_id)
        if p1.exists():
            p1.unlink()
        p2 = _precomputed_path(kb_id)
        if p2.exists():
            p2.unlink()
    except Exception as e:
        logger.warning("删除知识库问题缓存失败 kb_id=%s: %s", kb_id, e)


def _write_precomputed_for_kb(kb_id: str, payload: Dict[str, Any]) -> None:
    """每个知识库维护一份“可秒读”的预生成问题快照。"""
    try:
        PRECOMPUTED_DIR.mkdir(parents=True, exist_ok=True)
        path = _precomputed_path(kb_id)
        tmp = path.with_suffix(".tmp")
        out = {
            "kb_id": kb_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
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
    """
    快速读取问题池（不做重计算）。
    - manual: 按指定库拼接
    - files: 按文件所属库拼接（不做文件级过滤，目的是首屏秒出）
    - auto/all: 从全库随机挑若干库拼接
    """
    max_q = max(1, min(int(max_questions or 3), 10))
    all_kbs = await kb_service.list_knowledge_bases()
    if not all_kbs:
        return []

    kb_ids: List[str] = []
    if selected_files:
        kb_ids = sorted({str(f.get("kb_id") or "").strip() for f in selected_files if f.get("kb_id")})
    elif kb_mode == "manual" and knowledge_base_ids:
        kb_ids = [str(x).strip() for x in knowledge_base_ids if str(x).strip()]
    else:
        pool = [str(k.get("id")) for k in all_kbs if k.get("id")]
        random.shuffle(pool)
        kb_ids = pool[:MAX_KB_SAMPLE_GLOBAL]

    # 从每个库的问题池随机抽样后拼接，优先保证“秒出”
    pool: List[Dict[str, str]] = []
    seen = set()
    for kb_id in kb_ids:
        bank = _read_question_bank(kb_id)
        qs = bank.get("questions", []) or []
        random.shuffle(qs)
        for q in qs:
            text = str((q or {}).get("text") or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            pool.append({"text": text, "kb_name": str((q or {}).get("kb_name") or kb_id)})
    random.shuffle(pool)
    return pool[:max_q]


async def _pick_candidate_kbs(
    kb_service: KnowledgeBaseService,
    kb_mode: str,
    knowledge_base_ids: Sequence[str],
    selected_files: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    all_kbs = await kb_service.list_knowledge_bases()
    if not all_kbs:
        return []

    if selected_files:
        kb_ids = sorted({str(f.get("kb_id") or "").strip() for f in selected_files if f.get("kb_id")})
        return [k for k in all_kbs if k.get("id") in kb_ids]

    if kb_mode == "manual" and knowledge_base_ids:
        wanted = {str(x).strip() for x in knowledge_base_ids if str(x).strip()}
        return [k for k in all_kbs if k.get("id") in wanted]

    # auto / all / 未选手动：随机抽样若干知识库
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
    cache_ttl_sec: int = CACHE_TTL_SECONDS_DEFAULT,
) -> Dict[str, Any]:
    """
    生成推荐问题。返回 questions、source、cached、cache_key 等。
    """
    max_q = max(1, min(int(max_questions or 3), 10))

    candidate_kbs = await _pick_candidate_kbs(
        kb_service, kb_mode, knowledge_base_ids, selected_files
    )
    if not candidate_kbs:
        return {
            "questions": [],
            "source": "empty",
            "cached": False,
            "error": "no_knowledge_bases",
        }

    kb_by_id = {k["id"]: k for k in candidate_kbs}
    portrait_lines_all: List[str] = []
    file_blocks_all: List[str] = []

    file_tasks: List[Tuple[str, str, str, str]] = []
    # (kb_id, kb_name, file_id, display_name)

    # 每个候选库都拉主题画像（含「仅指定文件」场景）；并行请求降低首包延迟
    async def _one_portrait_block(kb: Dict[str, Any]) -> Optional[str]:
        kb_id = kb["id"]
        kb_name = kb.get("name") or kb_id
        portraits = await kb_service.get_kb_portraits_with_fallback(kb_id)
        plines = _portrait_summaries(portraits)
        if not plines:
            return None
        return f"## 知识库: {kb_name}\n### 主题聚类摘要\n" + "\n".join(plines)

    portrait_blocks = await asyncio.gather(
        *[_one_portrait_block(kb) for kb in candidate_kbs],
        return_exceptions=True,
    )
    for block in portrait_blocks:
        if isinstance(block, str) and block:
            portrait_lines_all.append(block)
        elif isinstance(block, Exception):
            logger.debug("画像拉取异常: %s", block)

    if selected_files:
        for sf in selected_files:
            kb_id = str(sf.get("kb_id") or "").strip()
            fid = str(sf.get("file_id") or "").strip()
            name = str(sf.get("name") or fid).strip()
            if kb_id and fid:
                kb_name = kb_by_id.get(kb_id, {}).get("name") or kb_id
                file_tasks.append((kb_id, kb_name, fid, name))
    else:
        for kb in candidate_kbs:
            kb_id = kb["id"]
            kb_name = kb.get("name") or kb_id
            try:
                files = await kb_service.list_kb_files(kb_id)
            except Exception as e:
                logger.debug("list_kb_files failed %s: %s", kb_id, e)
                files = []

            eligible = []
            for f in files:
                oid = str(f.get("id") or "")
                if "/keyframes/" in oid:
                    continue
                eligible.append(f)
            random.shuffle(eligible)
            for f in eligible[:MAX_FILES_PER_KB]:
                fid = str(f.get("id") or "")
                fname = str(f.get("name") or fid)
                if fid:
                    file_tasks.append((kb_id, kb_name, fid, fname))

    # 并行拉取文件预览（限制并发）
    sem = asyncio.Semaphore(12)

    async def _one(kb_id: str, kb_name: str, fid: str, fname: str) -> Tuple[str, str]:
        async with sem:
            det = await _preview_with_timeout(kb_service, kb_id, fid)
        block = _format_file_block(kb_name, fname, fid, det)
        header = f"## 知识库: {kb_name}\n"
        return kb_name, header + block

    preview_results = await asyncio.gather(
        *[_one(a, b, c, d) for a, b, c, d in file_tasks],
        return_exceptions=True,
    )
    for pr in preview_results:
        if isinstance(pr, Exception):
            logger.debug("预览聚合异常: %s", pr)
            continue
        _kbn, block = pr
        file_blocks_all.append(block)

    context_parts: List[str] = []
    if portrait_lines_all:
        context_parts.extend(portrait_lines_all)
    if file_blocks_all:
        context_parts.append("\n\n".join(file_blocks_all))

    context = "\n\n---\n\n".join(context_parts).strip()
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[: MAX_CONTEXT_CHARS - 1] + "…"

    revision = _sha256_text(context or "empty")
    scope_obj = {
        "kb_mode": kb_mode,
        "kb_ids": sorted(knowledge_base_ids) if knowledge_base_ids else [],
        "files": sorted(
            (str(f.get("kb_id")), str(f.get("file_id")))
            for f in selected_files
            if f.get("kb_id") and f.get("file_id")
        ),
        "max_q": max_q,
        "revision": revision,
    }
    cache_key = _sha256_text(json.dumps(scope_obj, sort_keys=True, ensure_ascii=False))

    if not refresh:
        cached = _read_cache(cache_key, cache_ttl_sec)
        if cached and isinstance(cached.get("questions"), list):
            logger.info("推荐问题缓存命中 cache_key=%s...", cache_key[:16])
            return {
                "questions": cached["questions"][:max_q],
                "source": cached.get("source", "llm"),
                "cached": True,
                "cache_key": cache_key,
                "revision": revision,
            }

    display_kb_names = [k.get("name") or k["id"] for k in candidate_kbs]
    kb_label = display_kb_names[0] if len(display_kb_names) == 1 else "多个知识库"

    if not context.strip():
        fb = _fallback_questions_from_context(display_kb_names, [], [], max_q)
        return {
            "questions": fb,
            "source": "fallback",
            "cached": False,
            "cache_key": cache_key,
            "revision": revision,
            "note": "empty_context",
        }

    questions_out: List[Dict[str, str]] = []
    source = "fallback"

    if use_llm:
        system = (
            "你是企业知识库检索问题生成器。你的输出必须强依赖输入材料，禁止脱离材料自由发挥。"
            "根据提供的材料摘要，生成用户可能提出的中文检索问题，用于在知识库中查找答案。"
            "【硬性约束】"
            "1) 每个问题都必须能在给定材料中找到明确依据或线索；"
            "2) 不得使用外部知识、常识补全、行业通用经验来构造问题；"
            "3) 不得虚构材料中不存在的实体、指标、结论、时间、数值或关系；"
            "4) 问题应尽量引用材料中出现过的术语、对象、文件主题、caption/摘要表达；"
            "5) 问题要具体、可检索、彼此不重复，避免空泛提问。"
            f"必须恰好输出 {max_q} 个问题。"
            "只输出 JSON 数组，元素为字符串，不要其它说明或 markdown。"
        )
        user = (
            f"材料如下（含主题聚类、文档分块、图片描述、音视频转写等）：\n\n{context}\n\n"
            "请仅基于以上材料生成问题；若某个潜在问题无法在材料中定位依据，则不要生成。"
            f"请输出 {max_q} 条 JSON 字符串数组。"
        )
        try:
            llm_res = await llm_manager.chat(
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                task_type="query_rewriting",
                temperature=0.45,
                max_tokens=900,
            )
            if llm_res.success:
                raw_content = (
                    (llm_res.data or {}).get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                parsed = _safe_json_loads_array(str(raw_content))
                parsed = [p for p in parsed if p][:max_q]
                if len(parsed) >= 1:
                    if len(parsed) < max_q:
                        fb_pad = _fallback_questions_from_context(
                            display_kb_names,
                            "\n".join(portrait_lines_all).split("\n"),
                            file_blocks_all,
                            max_q,
                        )
                        seen = set(parsed)
                        for item in fb_pad:
                            if item["text"] not in seen:
                                parsed.append(item["text"])
                                seen.add(item["text"])
                            if len(parsed) >= max_q:
                                break
                    questions_out = [{"text": t, "kb_name": kb_label} for t in parsed[:max_q]]
                    source = "llm"
                else:
                    logger.warning("LLM 未解析到有效问题: %s", raw_content[:200])
            else:
                logger.warning("LLM 推荐问题调用失败: %s", llm_res.error)
        except Exception as e:
            logger.warning("LLM 推荐问题异常: %s", e, exc_info=True)

    if not questions_out:
        pl_flat: List[str] = []
        for block in portrait_lines_all:
            pl_flat.extend(block.split("\n"))
        fb = _fallback_questions_from_context(display_kb_names, pl_flat, file_blocks_all, max_q)
        questions_out = fb
        source = "fallback"

    payload = {
        "questions": questions_out,
        "source": source,
        "revision": revision,
    }
    _write_cache(cache_key, payload)
    # 更新“按知识库秒读”的预生成缓存（仅在单库范围下写入，避免跨库污染）
    if len(candidate_kbs) == 1:
        kb0 = candidate_kbs[0]
        _write_precomputed_for_kb(
            kb0["id"],
            {
                "questions": questions_out[:max_q],
                "source": source,
                "revision": revision,
            },
        )

    return {
        "questions": questions_out,
        "source": source,
        "cached": False,
        "cache_key": cache_key,
        "revision": revision,
    }


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
    max_questions: int = 20,
    use_llm: bool = True,
) -> int:
    """
    基于单文件材料生成一批问题并写入知识库问题池。
    供“文件入库完成后”触发，避免新会话现场生成。
    """
    kb_service = KnowledgeBaseService()
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
    added = add_questions_to_bank(
        kb_id,
        questions,
        source=f"upload:{payload.get('source','llm')}",
        file_id=file_id,
    )
    logger.info("文件入库问题生成完成 kb_id=%s file_id=%s added=%s", kb_id, file_id, added)
    return added
