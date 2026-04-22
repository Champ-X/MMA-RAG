"""
为已有知识库批量回填推荐问题（问题池）。

策略：
- 每次从 text_chunks 抽样 10 个 chunk 作为材料
- 单次 LLM 调用生成 20 个问题
- 结果写入 backend/data/suggestion_cache/question_bank_by_kb/<kb_id>.json
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

from qdrant_client.http.models import FieldCondition, Filter, MatchValue

# 兼容从仓库根目录执行：
# python backend/scripts/backfill_suggested_questions.py ...
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.llm.manager import llm_manager
from app.core.logger import get_logger
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.suggested_questions import (
    _safe_json_loads_array,
    add_questions_to_bank,
    remove_kb_question_bank,
)

logger = get_logger(__name__)


def _payload(p: Any) -> Dict[str, Any]:
    return p if isinstance(p, dict) else {}


def _trim(s: str, n: int = 360) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _sample_text_chunks_for_kb(
    kb_service: KnowledgeBaseService,
    kb_id: str,
    *,
    limit: int,
) -> List[Dict[str, str]]:
    candidates = list(dict.fromkeys(kb_service._kb_id_candidates(kb_id)))
    out: List[Dict[str, str]] = []
    seen = set()
    for cid in candidates:
        try:
            filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=cid))])
            pts, _ = kb_service.vector_store.client.scroll(
                collection_name="text_chunks",
                scroll_filter=filt,
                limit=limit,
                with_payload=True,
            )
        except Exception:
            pts = []
        for pt in pts or []:
            p = _payload(getattr(pt, "payload", None))
            text = str(p.get("text_content") or "").strip()
            file_id = str(p.get("file_id") or "").strip()
            if not text:
                continue
            sig = (file_id, text[:120])
            if sig in seen:
                continue
            seen.add(sig)
            out.append({"file_id": file_id, "text": text})
            if len(out) >= limit:
                return out
    return out


def _sample_multimodal_texts_for_kb(
    kb_service: KnowledgeBaseService,
    kb_id: str,
    *,
    total_limit: int,
) -> List[Dict[str, str]]:
    """
    从多模态集合抽取“可用于提问生成”的文本材料：
    - text_chunks.text_content
    - image_vectors.caption / description
    - audio_vectors.transcript / description
    - video_vectors.scene_summary / frame_description
    """
    candidates = list(dict.fromkeys(kb_service._kb_id_candidates(kb_id)))
    out: List[Dict[str, str]] = []
    seen = set()

    def _push(kind: str, file_id: str, text: str) -> None:
        nonlocal out
        t = (text or "").strip()
        if not t:
            return
        sig = (kind, file_id, t[:120])
        if sig in seen:
            return
        seen.add(sig)
        out.append({"kind": kind, "file_id": file_id, "text": t})

    # 1) 文本 chunks（优先更多）
    text_limit = max(10, int(total_limit * 0.5))
    text_rows = _sample_text_chunks_for_kb(kb_service, kb_id, limit=text_limit)
    for r in text_rows:
        _push("text", r.get("file_id", ""), r.get("text", ""))

    # 2) 其它模态文本
    per_collection_limit = max(6, int(total_limit * 0.2))
    collections = {
        "image_vectors": [("caption", "image_caption"), ("description", "image_desc")],
        "audio_vectors": [("transcript", "audio_transcript"), ("description", "audio_desc")],
        "video_vectors": [("scene_summary", "video_scene"), ("frame_description", "video_frame")],
    }
    for cid in candidates:
        filt = Filter(must=[FieldCondition(key="kb_id", match=MatchValue(value=cid))])
        for coll, fields in collections.items():
            try:
                pts, _ = kb_service.vector_store.client.scroll(
                    collection_name=coll,
                    scroll_filter=filt,
                    limit=per_collection_limit,
                    with_payload=True,
                )
            except Exception:
                pts = []
            for pt in pts or []:
                p = _payload(getattr(pt, "payload", None))
                fid = str(p.get("file_id") or "")
                for key, kind in fields:
                    _push(kind, fid, str(p.get(key) or ""))

    random.shuffle(out)
    return out[:total_limit]


async def _generate_questions_from_chunk_batch(
    kb_name: str,
    batch: Sequence[Dict[str, str]],
    *,
    out_count: int,
) -> List[str]:
    context = []
    for i, item in enumerate(batch, 1):
        context.append(
            f"[{i}] kind={item.get('kind','text')} file_id={item.get('file_id')}\n"
            f"{_trim(item.get('text') or '', 380)}"
        )
    prompt = "\n\n".join(context)
    system = (
        "你是知识库检索问题生成器。只基于给定材料片段生成问题。"
        "禁止外部知识推断，禁止虚构。"
        f"请输出恰好 {out_count} 条中文检索问题，JSON 字符串数组格式。"
    )
    user = f"知识库：{kb_name}\n以下是抽样文本分块：\n\n{prompt}\n\n请输出 JSON 数组。"
    res = await llm_manager.chat(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        task_type="query_rewriting",
        temperature=0.5,
        max_tokens=1200,
    )
    if not res.success:
        logger.warning("LLM 生成失败: %s", res.error)
        return []
    raw = (
        (res.data or {}).get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    return _safe_json_loads_array(str(raw))


async def backfill(
    *,
    chunk_batch_size: int,
    out_questions_per_call: int,
    calls_per_kb: int,
    sample_limit_per_kb: int,
    reset: bool,
) -> None:
    kb_service = KnowledgeBaseService()
    kbs = await kb_service.list_knowledge_bases()
    if not kbs:
        logger.info("无知识库，结束")
        return

    logger.info("开始回填推荐问题，知识库数量={}", len(kbs))
    for kb in kbs:
        kb_id = str(kb.get("id") or "").strip()
        kb_name = str(kb.get("name") or kb_id)
        if not kb_id:
            continue
        if reset:
            remove_kb_question_bank(kb_id)
        chunks = _sample_multimodal_texts_for_kb(kb_service, kb_id, total_limit=sample_limit_per_kb)
        if len(chunks) < 3:
            logger.info("跳过 kb_id={}（可用 chunks 太少: {}）", kb_id, len(chunks))
            continue
        random.shuffle(chunks)

        total_added = 0
        for i in range(calls_per_kb):
            start = i * chunk_batch_size
            end = start + chunk_batch_size
            batch = chunks[start:end]
            if len(batch) < max(3, chunk_batch_size // 2):
                break
            qs = await _generate_questions_from_chunk_batch(
                kb_name,
                batch,
                out_count=out_questions_per_call,
            )
            q_objs = [{"text": q, "kb_name": kb_name} for q in qs if q]
            added = add_questions_to_bank(
                kb_id,
                q_objs,
                source="backfill",
                file_id=None,
            )
            total_added += added
            logger.info(
                "kb_id={} 回填批次 {}/{} 完成，新增问题={}",
                kb_id,
                i + 1,
                calls_per_kb,
                added,
            )
        logger.info("kb_id={} 回填结束，累计新增问题={}", kb_id, total_added)


def main() -> None:
    p = argparse.ArgumentParser(description="Backfill suggested questions for all KBs")
    p.add_argument("--chunk-batch-size", type=int, default=10)
    p.add_argument("--out-questions-per-call", type=int, default=20)
    p.add_argument("--calls-per-kb", type=int, default=3)
    p.add_argument("--sample-limit-per-kb", type=int, default=120)
    p.add_argument("--reset", action="store_true", help="先清空每个知识库的问题池再回填")
    args = p.parse_args()

    asyncio.run(
        backfill(
            chunk_batch_size=max(3, args.chunk_batch_size),
            out_questions_per_call=max(1, args.out_questions_per_call),
            calls_per_kb=max(1, args.calls_per_kb),
            sample_limit_per_kb=max(10, args.sample_limit_per_kb),
            reset=bool(args.reset),
        )
    )


if __name__ == "__main__":
    main()

