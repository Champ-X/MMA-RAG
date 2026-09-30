"""回填基于已有分块、图片说明、视频场景与 ASR 的自然问题，无需重新解析。"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.logger import get_logger
from app.modules.knowledge.natural_questions import generate_natural_questions, sample_evidence_for_kb
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge import suggested_questions as suggestions

logger = get_logger(__name__)


async def backfill(
    *, chunk_batch_size: int, out_questions_per_call: int, calls_per_kb: int,
    sample_limit_per_kb: int, reset: bool,
) -> None:
    service = KnowledgeBaseService()
    libraries = await service.list_knowledge_bases()
    logger.info("开始回填自然问题，知识库数量={}", len(libraries))
    for kb in libraries:
        kb_id = str(kb.get("id") or "")
        if not kb_id:
            continue
        kb_name = str(kb.get("name") or kb_id)
        with suggestions._bank_lock(kb_id):
            generation_epoch = suggestions._generation_epoch(kb_id)
        evidence = await sample_evidence_for_kb(service, kb_id, kb_name, limit=sample_limit_per_kb)
        if not evidence:
            logger.info("跳过 kb_id={}（无可用内容证据）", kb_id)
            continue
        total_added = 0
        reset_pending = reset
        for index in range(calls_per_kb):
            batch = evidence[index * chunk_batch_size:(index + 1) * chunk_batch_size]
            if not batch:
                break
            result = await generate_natural_questions(batch, max_questions=out_questions_per_call)
            questions = suggestions._current_questions(result["questions"])
            # The CLI shares banks with API/ingestion workers. Check and merge
            # under one lock so deleted source material cannot reappear afterward.
            with suggestions._bank_lock(kb_id):
                if suggestions._generation_epoch(kb_id) != generation_epoch:
                    logger.info("停止回填 kb_id={}（生成期间资料已删除或问题池已重置）", kb_id)
                    break
                # Failed generation leaves the previous bank intact, even with --reset.
                if reset_pending and questions:
                    suggestions._invalidate_generation(kb_id)
                    suggestions._bank_path(kb_id).unlink(missing_ok=True)
                    suggestions._precomputed_path(kb_id).unlink(missing_ok=True)
                    generation_epoch = suggestions._generation_epoch(kb_id)
                    reset_pending = False
                by_file = {}
                for question in questions:
                    by_file.setdefault(question["file_id"], []).append(question)
                for file_id, items in by_file.items():
                    total_added += suggestions._add_questions_to_bank_unlocked(
                        kb_id, items, source="backfill:llm", file_id=file_id)
            logger.info("kb_id={} 批次={}/{} 有效问题={} model={}", kb_id, index + 1,
                        calls_per_kb, len(questions), result.get("model_used", ""))
        logger.info("kb_id={} 回填结束，新增问题={}", kb_id, total_added)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill grounded natural questions from indexed evidence")
    parser.add_argument("--chunk-batch-size", type=int, default=12)
    parser.add_argument("--out-questions-per-call", type=int, default=6)
    parser.add_argument("--calls-per-kb", type=int, default=3)
    parser.add_argument("--sample-limit-per-kb", type=int, default=72)
    parser.add_argument("--reset", action="store_true", help="成功生成新问题后替换每个知识库的旧问题池")
    args = parser.parse_args()
    asyncio.run(backfill(chunk_batch_size=max(1, args.chunk_batch_size),
                         out_questions_per_call=max(1, min(8, args.out_questions_per_call)),
                         calls_per_kb=max(1, args.calls_per_kb),
                         sample_limit_per_kb=max(1, args.sample_limit_per_kb), reset=args.reset))


if __name__ == "__main__":
    main()
