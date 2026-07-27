"""
检索服务
协调查询预处理、检索和重排的完整流程
"""

from typing import Dict, List, Any, Optional, AsyncGenerator, Tuple
from datetime import datetime
from dataclasses import dataclass
import copy
import re

from .processors.intent import IntentProcessor
from .processors.rewriter import QueryRewriter
from .search_engine import HybridSearchEngine
from .reranker import Reranker
from app.core.logger import get_logger, audit_log
from app.modules.knowledge.router import KnowledgeRouter

logger = get_logger(__name__)

IMAGE_FILE_TYPES = {
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff", "tif", "ico", "heic", "heif"
}
AUDIO_FILE_TYPES = {
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"
}
VIDEO_FILE_TYPES = {
    "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpeg", "mpg"
}
DEICTIC_REFERENCE_PATTERNS = (
    "这是", "这是什么", "这是啥", "图里", "图中", "图片里", "这张图", "这个图", "这幅图",
    "什么意思", "讲了什么", "说了什么", "介绍一下这个",
    "whatisthis", "whatsthis", "what is this", "what's this", "what is shown",
)

_MODALITY_INTENT_PRIORITY = {
    "unnecessary": 0,
    "implicit_enrichment": 1,
    "explicit_demand": 2,
}


def _normalize_modality_intent(value: Any) -> str:
    intent = str(value or "unnecessary").strip()
    return intent if intent in _MODALITY_INTENT_PRIORITY else "unnecessary"


def _apply_agent_base_modality_intents(
    preprocessing_result: Dict[str, Any],
    base_modality_intents: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Keep explicit original-query modality demands on Agent subqueries.

    An Agent may deliberately use a terse textual sub-query.  That is useful
    for recall, but must not silently drop an explicit request such as
    "show the poster".  Implicit enrichment is covered by a dedicated Agent
    coverage query instead, avoiding three duplicate visual searches per
    round.
    """
    if not base_modality_intents:
        return preprocessing_result

    updated = dict(preprocessing_result)
    for modality, field, reasoning_field in (
        ("image", "visual_intent", "visual_reasoning"),
        ("audio", "audio_intent", "audio_reasoning"),
        ("video", "video_intent", "video_reasoning"),
    ):
        base_intent = _normalize_modality_intent(
            base_modality_intents.get(modality)
        )
        current_intent = _normalize_modality_intent(updated.get(field))
        if (
            base_intent == "explicit_demand"
            and _MODALITY_INTENT_PRIORITY[base_intent]
            > _MODALITY_INTENT_PRIORITY[current_intent]
        ):
            updated[field] = base_intent
            updated[reasoning_field] = "继承原始问题的明确模态需求"
    return updated


def _apply_agent_target_modality_fallback(
    preprocessing_result: Dict[str, Any],
    *,
    target_kb_ids: List[str],
    modality_inventory: Optional[Dict[str, Dict[str, Any]]],
    routing_details: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Enable one implicit modal route when Agent's semantic anchor is non-text.

    A user can ask a purely factual question whose best matching knowledge
    base is indexed only as video (or audio/image).  Text dense/sparse recall
    then returns zero even though the correct KB was selected.  Direct and
    Agent modes must both be able to consume that evidence, but the safeguard
    is intentionally scoped to Agent routing so it does not turn ordinary
    queries into blanket multimodal searches.

    Explicit user modality requirements are never substituted.  For example,
    an explicit image request should not silently become a video answer just
    because the first KB happens to be video-only.
    """
    inventory = modality_inventory or {}
    if not target_kb_ids or not inventory:
        return preprocessing_result, {}

    current_intents = {
        "image": _normalize_modality_intent(preprocessing_result.get("visual_intent")),
        "audio": _normalize_modality_intent(preprocessing_result.get("audio_intent")),
        "video": _normalize_modality_intent(preprocessing_result.get("video_intent")),
    }
    if any(intent == "explicit_demand" for intent in current_intents.values()):
        return preprocessing_result, {}

    details = routing_details or {}
    preferred_kb_id = str(details.get("anchor_kb_id") or "").strip()
    primary_kb_id = (
        preferred_kb_id
        if preferred_kb_id in inventory
        else str(target_kb_ids[0] or "").strip()
    )
    primary = inventory.get(primary_kb_id) or {}
    if int(primary.get("text") or 0) > 0:
        return preprocessing_result, {}

    # Prefer the modality with the richest actual index.  The deterministic
    # tiebreak keeps video ahead of audio ahead of images, which is useful for
    # knowledge bases that hold both keyframes and their source video.
    order = {"video": 3, "audio": 2, "image": 1}
    candidates = [
        modality
        for modality in ("video", "audio", "image")
        if int(primary.get(modality) or 0) > 0
        and current_intents[modality] == "unnecessary"
    ]
    if not candidates:
        return preprocessing_result, {}
    modality = max(
        candidates,
        key=lambda item: (int(primary.get(item) or 0), order[item]),
    )

    fields = {
        "image": ("visual_intent", "visual_reasoning"),
        "audio": ("audio_intent", "audio_reasoning"),
        "video": ("video_intent", "video_reasoning"),
    }
    intent_field, reasoning_field = fields[modality]
    updated = dict(preprocessing_result)
    kb_name = str(primary.get("name") or primary_kb_id)
    updated[intent_field] = "implicit_enrichment"
    updated[reasoning_field] = (
        f"Agent 命中知识库“{kb_name}”未建文本索引，"
        f"自动补充{ {'image': '图片', 'audio': '音频', 'video': '视频'}[modality] }证据检索"
    )
    return updated, {
        "kb_id": primary_kb_id,
        "kb_name": kb_name,
        "modality": modality,
        "available_count": int(primary.get(modality) or 0),
    }


def _infer_selected_file_modality(file_info: Dict[str, Any]) -> str:
    raw_type = str(file_info.get("type") or "").strip().lower()
    raw_name = str(file_info.get("name") or "").strip().lower()
    ext = raw_type or (raw_name.rsplit(".", 1)[-1] if "." in raw_name else "")
    if ext in IMAGE_FILE_TYPES:
        return "image"
    if ext in AUDIO_FILE_TYPES:
        return "audio"
    if ext in VIDEO_FILE_TYPES:
        return "video"
    return "doc"


def _collect_selected_file_modalities(selected_files: List[Dict[str, Any]]) -> List[str]:
    seen = set()
    modalities: List[str] = []
    for item in selected_files:
        modality = _infer_selected_file_modality(item)
        if modality not in seen:
            seen.add(modality)
            modalities.append(modality)
    return modalities


def _is_deictic_reference_query(query: str) -> bool:
    normalized = re.sub(r"\s+", "", (query or "").strip().lower())
    if not normalized:
        return False
    if any(pattern in normalized for pattern in DEICTIC_REFERENCE_PATTERNS):
        return True
    if len(normalized) <= 6 and any(token in normalized for token in ("这", "它", "此")) and any(token in normalized for token in ("是", "啥", "谁", "什么")):
        return True
    return False


def _override_intents_for_selected_files(
    query: str,
    preprocessing_result: Dict[str, Any],
    selected_files: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], List[str]]:
    if not selected_files:
        return preprocessing_result, []

    updated = dict(preprocessing_result)
    selected_modalities = _collect_selected_file_modalities(selected_files)
    is_deictic_query = _is_deictic_reference_query(query)

    if "image" in selected_modalities:
        current = updated.get("visual_intent", "unnecessary")
        target = "explicit_demand" if is_deictic_query else "implicit_enrichment"
        if current == "unnecessary" or (is_deictic_query and current != "explicit_demand"):
            updated["visual_intent"] = target
            updated["visual_reasoning"] = "用户已指定图片文件，本轮需优先结合所选图片检索和理解"

    if "audio" in selected_modalities:
        current = updated.get("audio_intent", "unnecessary")
        target = "explicit_demand" if is_deictic_query else "implicit_enrichment"
        if current == "unnecessary" or (is_deictic_query and current != "explicit_demand"):
            updated["audio_intent"] = target
            updated["audio_reasoning"] = "用户已指定音频文件，本轮需优先结合所选音频检索和理解"

    if "video" in selected_modalities:
        current = updated.get("video_intent", "unnecessary")
        target = "explicit_demand" if is_deictic_query else "implicit_enrichment"
        if current == "unnecessary" or (is_deictic_query and current != "explicit_demand"):
            updated["video_intent"] = target
            updated["video_reasoning"] = "用户已指定视频文件，本轮需优先结合所选视频检索和理解"

    return updated, selected_modalities

@dataclass
class RetrievalContext:
    """检索上下文数据类"""
    original_query: str
    refined_query: str
    intent_type: str
    is_complex: bool
    visual_intent: str  # 视觉意图：explicit_demand, implicit_enrichment, unnecessary
    visual_reasoning: str  # 视觉意图推理说明
    audio_intent: str  # 音频意图：explicit_demand, implicit_enrichment, unnecessary
    audio_reasoning: str  # 音频意图推理说明
    video_intent: str  # 视频意图：explicit_demand, implicit_enrichment, unnecessary
    video_reasoning: str  # 视频意图推理说明
    search_strategies: Dict[str, Any]
    target_kb_ids: List[str]
    target_kbs: List[Dict[str, Any]]
    target_file_ids: List[str]
    selected_files: List[Dict[str, Any]]
    selected_file_modalities: List[str]
    confidence_scores: Dict[str, float]
    processing_time: float = 0.0

@dataclass
class RetrievalResult:
    """检索结果数据类"""
    context: RetrievalContext
    raw_results: Dict[str, List[Dict[str, Any]]]
    reranked_results: List[Dict[str, Any]]
    processing_time: float
    debug_info: Dict[str, Any]

class RetrievalService:
    """检索服务"""
    
    def __init__(self):
        self.intent_processor = IntentProcessor()
        self.query_rewriter = QueryRewriter()
        self.search_engine = HybridSearchEngine()
        self.reranker = Reranker()
        self.kb_router = KnowledgeRouter()
        
        # 检索统计信息存储（生产环境应使用Redis或数据库）
        self._retrieval_stats: Dict[str, Any] = {
            "total_searches": 0,
            "total_processing_time": 0.0,
            "intent_distribution": {},
            "routing_distribution": {},
            "retrieval_strategy_usage": {},
            "average_result_count": 0.0,
            "total_result_count": 0,
            "last_updated": datetime.utcnow().isoformat()
        }
    
    async def search(
        self,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
        preplanned: bool = False,
        routing_hints: Optional[Dict[str, Any]] = None,
        preprocessing_result: Optional[Dict[str, Any]] = None,
    ) -> RetrievalResult:
        """
        执行完整检索流程
        
        Args:
            query: 用户查询
            kb_context: 知识库上下文
            user_id: 用户ID
            session_context: 会话上下文
            
        Returns:
            检索结果
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"开始检索流程: {query}")
            
            # Agent 已经完成问题拆解时，子查询本身就是可执行检索计划。
            # 跳过每个子查询重复的远端意图识别与查询改写，仍保留本地
            # 多模态意图补正、知识库路由、混合召回与重排。
            # Agent 的原问题锚点会复用一次已经完成的完整预处理。这样既保留
            # 直接检索的意图/改写能力，也避免深研模式重复调用远端模型。
            if preprocessing_result is not None:
                preprocessing_result = copy.deepcopy(preprocessing_result)
            else:
                preprocessing_result = (
                    self._preprocess_preplanned_query(query)
                    if preplanned
                    else await self._preprocess_query(
                        query=query,
                        session_context=session_context or [],
                        attachment_context=attachment_context,
                    )
                )
            selected_files = list((kb_context or {}).get("selected_files", []) or [])
            preprocessing_result, selected_file_modalities = _override_intents_for_selected_files(
                query,
                preprocessing_result,
                selected_files,
            )
            effective_routing_hints = dict(routing_hints or {})
            if effective_routing_hints.get("agent_mode"):
                preprocessing_result = _apply_agent_base_modality_intents(
                    preprocessing_result,
                    effective_routing_hints.get("agent_base_modality_intents"),
                )
                effective_routing_hints["modality_intents"] = {
                    "image": preprocessing_result.get("visual_intent", "unnecessary"),
                    "audio": preprocessing_result.get("audio_intent", "unnecessary"),
                    "video": preprocessing_result.get("video_intent", "unnecessary"),
                }
            
            # 2. 知识库路由
            routing_result = await self._route_to_knowledge_bases(
                preprocessing_result["refined_query"],
                kb_context=kb_context,
                query_variants=preprocessing_result["search_strategies"].get("multi_view_queries", []),
                max_targets=3 if preprocessing_result.get("is_complex") else 2,
                routing_hints=effective_routing_hints,
            )
            target_kb_ids = getattr(routing_result, "target_kb_ids", []) or []
            confidence_scores = getattr(routing_result, "confidence_scores", {}) or {}
            target_kbs = getattr(routing_result, "target_kbs", None)
            if not target_kbs:
                target_kbs = [
                    {"id": kb_id, "name": kb_id, "score": float(confidence_scores.get(kb_id, 0))}
                    for kb_id in target_kb_ids
                ]

            # Agent child queries are intentionally terse.  When their
            # semantic anchor is a KB with no text index (e.g. a source video
            # KB), use the available indexed modality instead of returning an
            # empty text retrieval result despite having routed correctly.
            agent_target_modality_fallback: Dict[str, Any] = {}
            if effective_routing_hints.get("agent_mode"):
                inventory_getter = getattr(self.kb_router, "get_modality_inventory", None)
                if callable(inventory_getter):
                    try:
                        modality_inventory = await inventory_getter()
                        preprocessing_result, agent_target_modality_fallback = (
                            _apply_agent_target_modality_fallback(
                                preprocessing_result,
                                target_kb_ids=target_kb_ids,
                                modality_inventory=modality_inventory,
                                routing_details=getattr(routing_result, "routing_details", None),
                            )
                        )
                    except Exception as exc:
                        logger.debug("Agent 目标库模态兜底判断失败，继续常规检索: {}", exc)
            
            # 3. 构建检索上下文
            retrieval_context = RetrievalContext(
                original_query=query,
                refined_query=preprocessing_result["refined_query"],
                intent_type=preprocessing_result["intent_type"],
                is_complex=preprocessing_result["is_complex"],
                visual_intent=preprocessing_result.get("visual_intent", "unnecessary"),
                visual_reasoning=preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                audio_intent=preprocessing_result.get("audio_intent", "unnecessary"),
                audio_reasoning=preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                video_intent=preprocessing_result.get("video_intent", "unnecessary"),
                video_reasoning=preprocessing_result.get("video_reasoning", "未检测到视频需求"),
                search_strategies=preprocessing_result["search_strategies"],
                target_kb_ids=target_kb_ids,
                target_kbs=target_kbs,
                target_file_ids=[item.get("file_id", "") for item in selected_files if item.get("file_id")],
                selected_files=selected_files,
                selected_file_modalities=selected_file_modalities,
                confidence_scores=confidence_scores,
            )
            if retrieval_context.target_file_ids:
                logger.info(
                    "检索上下文已附加文件级过滤: kb_ids=%s, file_ids=%s",
                    retrieval_context.target_kb_ids,
                    retrieval_context.target_file_ids,
                )
            if retrieval_context.selected_file_modalities:
                logger.info(
                    "所选文件触发模态增强: modalities=%s, visual=%s, audio=%s, video=%s",
                    retrieval_context.selected_file_modalities,
                    retrieval_context.visual_intent,
                    retrieval_context.audio_intent,
                    retrieval_context.video_intent,
                )
            
            # 4. 混合检索
            search_results = await self._perform_hybrid_search(retrieval_context)
            
            # 5. 两阶段重排
            reranked_results = await self._apply_reranking(
                retrieval_context, search_results
            )
            
            # 6. 计算总处理时间
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            retrieval_context.processing_time = processing_time
            
            # 7. 构建调试信息
            debug_info = {
                "preprocessing_time": preprocessing_result.get("processing_time", 0),
                "routing_time": routing_result.processing_time,
                "search_time": search_results.get("processing_time", 0),
                "reranking_time": reranked_results.get("processing_time", 0),
                "total_time": processing_time,
                "routing_method": routing_result.routing_method,
                "routing_query_count": getattr(routing_result, "query_count", 1),
                "retrieval_strategy": search_results.get("strategy"),
                "total_candidates": sum(
                    len(results) for results in search_results.get("raw_results", {}).values()
                ),
                "preplanned_query": preplanned,
                "routing_details": getattr(routing_result, "routing_details", None),
                "agent_target_modality_fallback": agent_target_modality_fallback,
            }
            
            # 更新检索统计信息
            self._update_retrieval_stats(
                intent_type=preprocessing_result["intent_type"],
                routing_method=routing_result.routing_method,
                retrieval_strategy=search_results.get("strategy", "unknown"),
                processing_time=processing_time,
                result_count=len(reranked_results.get("results", []))
            )
            
            audit_log(
                f"检索流程完成: {query[:50]}...",
                query_length=len(query),
                intent_type=preprocessing_result["intent_type"],
                target_kbs=retrieval_context.target_kb_ids,
                result_count=len(reranked_results.get("results", [])),
                processing_time=processing_time
            )
            
            logger.info(
                f"检索完成: 查询='{query}', 意图='{preprocessing_result['intent_type']}', "
                f"目标KB={len(retrieval_context.target_kb_ids)}, "
                f"结果数={len(reranked_results.get('results', []))}"
            )
            
            return RetrievalResult(
                context=retrieval_context,
                raw_results=search_results.get("raw_results", {}),
                reranked_results=reranked_results.get("results", []),
                processing_time=processing_time,
                debug_info=debug_info
            )
            
        except Exception as e:
            logger.error(f"检索流程失败: {str(e)}")
            raise

    async def get_agent_modality_requirements(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
    ) -> Dict[str, str]:
        """Analyze the original Agent question once for modality requirements.

        Agent child queries intentionally skip remote intent analysis to keep
        the Observe → Decide → Act loop bounded.  Running that shortcut on
        the *original* question, however, lost the semantic visual signal in
        requests such as "阿凡达的经典取景地在哪里".  This lightweight preflight
        preserves the existing IntentProcessor (without query rewriting) and
        leaves the Agent UI free of the normal intent/routing panels.
        """
        clean_query = " ".join((query or "").split()).strip()
        if not clean_query:
            return {"image": "unnecessary", "audio": "unnecessary", "video": "unnecessary"}

        try:
            intent_result = await self.intent_processor.process(
                query=clean_query,
                chat_history=session_context or [],
                attachment_context_block=attachment_context,
            )
            selected_files = list((kb_context or {}).get("selected_files", []) or [])
            intent_result, _ = _override_intents_for_selected_files(
                clean_query,
                intent_result,
                selected_files,
            )
        except Exception as exc:
            logger.warning("Agent 原始问题多模态预分析失败，使用本地兜底: %s", exc)
            intent_result = self._preprocess_preplanned_query(clean_query)

        return {
            "image": _normalize_modality_intent(intent_result.get("visual_intent")),
            "audio": _normalize_modality_intent(intent_result.get("audio_intent")),
            "video": _normalize_modality_intent(intent_result.get("video_intent")),
        }

    async def prepare_agent_original_query(
        self,
        *,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Prepare the original Agent question with the normal direct path.

        Agent child queries deliberately use the lightweight ``preplanned``
        path.  That is efficient, but it does not inherit the full query
        rewriting and semantic intent analysis of a normal chat request.  A
        single reusable preparation result gives Agent mode a faithful
        original-question anchor without doubling those LLM calls.
        """
        clean_query = " ".join((query or "").split()).strip()
        if not clean_query:
            return self._preprocess_preplanned_query("")

        preprocessing_result = await self._preprocess_query(
            query=clean_query,
            session_context=session_context or [],
            attachment_context=attachment_context,
        )
        selected_files = list((kb_context or {}).get("selected_files", []) or [])
        preprocessing_result, _ = _override_intents_for_selected_files(
            clean_query,
            preprocessing_result,
            selected_files,
        )
        return preprocessing_result

    async def search_stream(
        self,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        session_context: Optional[List[Dict[str, str]]] = None,
        attachment_context: Optional[str] = None,
    ) -> AsyncGenerator[Tuple[str, Any], None]:
        """
        流式检索：每完成一个阶段就 yield (stage, payload)，最后 yield ("_result", retrieval_result)。
        用于 SSE 流式聊天时按阶段推送思考过程，避免等全部检索完才一次性展示。
        """
        start_time = datetime.utcnow()
        try:
            logger.info(f"开始检索流程(流式): {query}")

            # 1. 查询预处理 - One-Pass 意图识别
            preprocessing_result = await self._preprocess_query(
                query=query,
                session_context=session_context or [],
                attachment_context=attachment_context,
            )
            selected_files = list((kb_context or {}).get("selected_files", []) or [])
            preprocessing_result, selected_file_modalities = _override_intents_for_selected_files(
                query,
                preprocessing_result,
                selected_files,
            )
            intent_payload = {
                "message": "意图解析完成",
                "intent_type": preprocessing_result.get("intent_type", "factual"),
                "original_query": preprocessing_result.get("original_query", query),
                "refined_query": preprocessing_result.get("refined_query", query),
                "visual_intent": preprocessing_result.get("visual_intent", "unnecessary"),
                "visual_reasoning": preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                "audio_intent": preprocessing_result.get("audio_intent", "unnecessary"),
                "audio_reasoning": preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                "video_intent": preprocessing_result.get("video_intent", "unnecessary"),
                "video_reasoning": preprocessing_result.get("video_reasoning", "未检测到视频需求"),
                "is_complex": preprocessing_result.get("is_complex", False),
                "sub_queries": preprocessing_result.get("sub_queries", []) or [],
            }
            yield ("intent", intent_payload)

            # 2. 知识库路由
            routing_result = await self._route_to_knowledge_bases(
                preprocessing_result["refined_query"],
                kb_context=kb_context,
                query_variants=preprocessing_result["search_strategies"].get("multi_view_queries", []),
                max_targets=3 if preprocessing_result.get("is_complex") else 2,
            )
            target_kb_ids = getattr(routing_result, "target_kb_ids", []) or []
            confidence_scores = getattr(routing_result, "confidence_scores", {}) or {}
            target_kbs = getattr(routing_result, "target_kbs", None)
            if not target_kbs:
                target_kbs = [
                    {"id": kb_id, "name": kb_id, "score": float(confidence_scores.get(kb_id, 0))}
                    for kb_id in target_kb_ids
                ]
            routing_payload = {
                "message": "智能路由完成",
                "target_kbs": target_kbs,
                "fallback_search": len(target_kb_ids) == 0,
                "routing_method": getattr(routing_result, "routing_method", ""),
                "query_count": getattr(routing_result, "query_count", 1),
            }
            yield ("routing", routing_payload)

            # 3. 构建检索上下文
            retrieval_context = RetrievalContext(
                original_query=query,
                refined_query=preprocessing_result["refined_query"],
                intent_type=preprocessing_result["intent_type"],
                is_complex=preprocessing_result["is_complex"],
                visual_intent=preprocessing_result.get("visual_intent", "unnecessary"),
                visual_reasoning=preprocessing_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                audio_intent=preprocessing_result.get("audio_intent", "unnecessary"),
                audio_reasoning=preprocessing_result.get("audio_reasoning", "未检测到音频需求"),
                video_intent=preprocessing_result.get("video_intent", "unnecessary"),
                video_reasoning=preprocessing_result.get("video_reasoning", "未检测到视频需求"),
                search_strategies=preprocessing_result["search_strategies"],
                target_kb_ids=target_kb_ids,
                target_kbs=target_kbs,
                target_file_ids=[item.get("file_id", "") for item in selected_files if item.get("file_id")],
                selected_files=selected_files,
                selected_file_modalities=selected_file_modalities,
                confidence_scores=confidence_scores,
            )
            if retrieval_context.target_file_ids:
                logger.info(
                    "流式检索上下文已附加文件级过滤: kb_ids=%s, file_ids=%s",
                    retrieval_context.target_kb_ids,
                    retrieval_context.target_file_ids,
                )
            if retrieval_context.selected_file_modalities:
                logger.info(
                    "流式所选文件触发模态增强: modalities=%s, visual=%s, audio=%s, video=%s",
                    retrieval_context.selected_file_modalities,
                    retrieval_context.visual_intent,
                    retrieval_context.audio_intent,
                    retrieval_context.video_intent,
                )

            # 4. 混合检索
            search_results = await self._perform_hybrid_search(retrieval_context)

            # 5. 两阶段重排
            reranked_results = await self._apply_reranking(
                retrieval_context, search_results
            )
            results_list = reranked_results.get("results", [])

            # 6. 总处理时间与调试信息
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            retrieval_context.processing_time = processing_time
            debug_info = {
                "preprocessing_time": preprocessing_result.get("processing_time", 0),
                "routing_time": getattr(routing_result, "processing_time", 0),
                "search_time": search_results.get("processing_time", 0),
                "reranking_time": reranked_results.get("processing_time", 0),
                "total_time": processing_time,
                "routing_method": getattr(routing_result, "routing_method", ""),
                "routing_query_count": getattr(routing_result, "query_count", 1),
                "retrieval_strategy": search_results.get("strategy"),
                "total_candidates": sum(
                    len(results) for results in search_results.get("raw_results", {}).values()
                ),
            }
            strategies = retrieval_context.search_strategies or {}
            sparse_keywords = list(strategies.get("sparse_keywords", []) or [])
            # 获取重排统计信息
            coarse_ranking_count = reranked_results.get("coarse_ranking_count", 0)
            final_ranking_count = reranked_results.get("final_ranking_count", len(results_list))
            retrieval_payload = {
                "message": f"检索完成，找到 {len(results_list)} 个相关结果",
                "sparse_keywords": sparse_keywords,
                "sub_queries": getattr(retrieval_context, "sub_queries", []) or preprocessing_result.get("sub_queries", []) or [],
                "total_found": coarse_ranking_count if coarse_ranking_count > 0 else len(results_list),  # 粗排后的候选数量
                "reranked_count": final_ranking_count,  # 重排后保留的数量
            }
            yield ("retrieval", retrieval_payload)

            self._update_retrieval_stats(
                intent_type=preprocessing_result["intent_type"],
                routing_method=getattr(routing_result, "routing_method", "unknown"),
                retrieval_strategy=search_results.get("strategy", "unknown"),
                processing_time=processing_time,
                result_count=len(results_list),
            )
            audit_log(
                f"检索流程完成: {query[:50]}...",
                query_length=len(query),
                intent_type=preprocessing_result["intent_type"],
                target_kbs=retrieval_context.target_kb_ids,
                result_count=len(results_list),
                processing_time=processing_time,
            )

            retrieval_result = RetrievalResult(
                context=retrieval_context,
                raw_results=search_results.get("raw_results", {}),
                reranked_results=results_list,
                processing_time=processing_time,
                debug_info=debug_info,
            )
            yield ("_result", retrieval_result)

        except Exception as e:
            logger.error(f"检索流程(流式)失败: {str(e)}")
            raise

    async def _preprocess_query(
        self,
        query: str,
        session_context: List[Dict[str, str]],
        attachment_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """查询预处理"""
        try:
            # One-Pass 意图识别
            intent_result = await self.intent_processor.process(
                query=query,
                chat_history=session_context,
                attachment_context_block=attachment_context,
            )
            
            # 获取 refined_query，如果不存在则从 search_strategies 或使用 original_query
            refined_query = intent_result.get(
                "refined_query",
                intent_result.get("search_strategies", {}).get("dense_query", intent_result.get("original_query", query))
            )
            
            # 查询改写与扩展
            rewriter_result = await self.query_rewriter.rewrite(
                original_query=refined_query,
                chat_history=session_context,
                intent_analysis=intent_result
            )
            
            # 合并结果
            final_refined_query = rewriter_result.get("refined_query", refined_query)
            preprocessing_result = {
                "original_query": query,
                "refined_query": final_refined_query,
                "intent_type": intent_result.get("intent_type", "factual"),
                "is_complex": intent_result.get("is_complex", False),
                "visual_intent": intent_result.get("visual_intent", "unnecessary"),
                "visual_reasoning": intent_result.get("visual_reasoning", "未检测到明确的视觉需求"),
                "audio_intent": intent_result.get("audio_intent", "unnecessary"),
                "audio_reasoning": intent_result.get("audio_reasoning", "未检测到音频需求"),
                "video_intent": intent_result.get("video_intent", "unnecessary"),
                "video_reasoning": intent_result.get("video_reasoning", "未检测到视频需求"),
                "search_strategies": {
                    "dense_query": final_refined_query,
                    "original_query": intent_result.get("original_query", query),
                    "multi_view_queries": rewriter_result.get("multi_view_queries", []),
                    "sparse_keywords": rewriter_result.get("keywords", [])
                },
                "sub_queries": intent_result.get("sub_queries", []),
                "processing_time": 0.0
            }

            return preprocessing_result
            
        except Exception as e:
            logger.error(f"查询预处理失败: {str(e)}")
            # 返回默认值
            return {
                "original_query": query,
                "refined_query": query,
                "intent_type": "factual",
                "is_complex": False,
                "visual_intent": "unnecessary",
                "visual_reasoning": "使用默认规则，未检测到明确的视觉需求",
                "audio_intent": "unnecessary",
                "audio_reasoning": "使用默认规则，未检测到音频需求",
                "video_intent": "unnecessary",
                "video_reasoning": "使用默认规则，未检测到视频需求",
                "search_strategies": {
                    "dense_query": query,
                    "original_query": query,
                    "multi_view_queries": [],
                    "sparse_keywords": []
                },
                "sub_queries": [],
                "processing_time": 0.0
            }

    def _preprocess_preplanned_query(self, query: str) -> Dict[str, Any]:
        """为 Agent 已规划的子查询构造无远端 LLM 的检索预处理结果。"""
        intent_result = self.intent_processor._validate_intent_analysis(
            {
                "intent_type": "analysis",
                "is_complex": False,
                "reasoning": "Agent 已完成问题拆解，直接执行子查询",
            },
            query,
        )
        return {
            "original_query": query,
            "refined_query": query,
            "intent_type": intent_result.get("intent_type", "analysis"),
            "is_complex": False,
            "visual_intent": intent_result.get("visual_intent", "unnecessary"),
            "visual_reasoning": intent_result.get("visual_reasoning", "未检测到明确的视觉需求"),
            "audio_intent": intent_result.get("audio_intent", "unnecessary"),
            "audio_reasoning": intent_result.get("audio_reasoning", "未检测到音频需求"),
            "video_intent": intent_result.get("video_intent", "unnecessary"),
            "video_reasoning": intent_result.get("video_reasoning", "未检测到视频需求"),
            "search_strategies": {
                "dense_query": query,
                "original_query": query,
                "multi_view_queries": [],
                "sparse_keywords": [],
            },
            "sub_queries": [],
            "processing_time": 0.0,
        }
        
    async def _route_to_knowledge_bases(
        self,
        query: str,
        kb_context: Optional[Dict[str, Any]] = None,
        query_variants: Optional[List[str]] = None,
        max_targets: int = 2,
        routing_hints: Optional[Dict[str, Any]] = None,
    ):
        """路由到知识库"""
        try:
            return await self.kb_router.route_query(
                query,
                kb_context=kb_context,
                query_variants=query_variants,
                max_targets=max_targets,
                routing_hints=routing_hints,
            )
        except Exception as e:
            logger.error(f"知识库路由失败: {str(e)}")
            # 返回默认路由
            from app.modules.knowledge.router import RoutingResult
            return RoutingResult(
                target_kb_ids=[],
                confidence_scores={},
                routing_method="error",
                total_candidates=0,
                processing_time=0.0
            )
    
    async def _perform_hybrid_search(
        self,
        context: RetrievalContext
    ) -> Dict[str, Any]:
        """执行混合检索。仅使用 Qdrant 中的 kb_id，将指定知识库的 ID 解析为向量库实际存储的 kb_id 后再检索。"""
        try:
            qdrant_kb_ids = await self.kb_router.resolve_to_qdrant_kb_ids(context.target_kb_ids)
            return await self.search_engine.search(
                query_strategies=context.search_strategies,
                target_kb_ids=qdrant_kb_ids,
                target_file_ids=context.target_file_ids,
                selected_files=context.selected_files,
                visual_intent=context.visual_intent,
                audio_intent=context.audio_intent,
                video_intent=context.video_intent,
                intent_type=context.intent_type
            )
        except Exception as e:
            logger.error(f"混合检索失败: {str(e)}")
            return {
                "raw_results": {},
                "strategy": "error",
                "processing_time": 0.0
            }
    
    async def _apply_reranking(
        self,
        context: RetrievalContext,
        search_results: Dict[str, Any]
    ) -> Dict[str, Any]:
        """应用重排序"""
        try:
            return await self.reranker.rerank(
                query=context.refined_query,
                raw_results=search_results.get("raw_results", {}),
                context=context
            )
        except Exception as e:
            logger.error(f"重排序失败: {str(e)}")
            return {
                "results": [],
                "processing_time": 0.0
            }
    
    async def batch_search(
        self,
        queries: List[str],
        kb_context: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> List[RetrievalResult]:
        """批量检索"""
        try:
            results = []
            
            for query in queries:
                result = await self.search(
                    query=query,
                    kb_context=kb_context,
                    user_id=user_id
                )
                results.append(result)
            
            return results
            
        except Exception as e:
            logger.error(f"批量检索失败: {str(e)}")
            return []
    
    def _update_retrieval_stats(
        self,
        intent_type: str,
        routing_method: str,
        retrieval_strategy: str,
        processing_time: float,
        result_count: int
    ):
        """更新检索统计信息"""
        try:
            # 更新总检索次数
            self._retrieval_stats["total_searches"] += 1
            
            # 更新总处理时间
            self._retrieval_stats["total_processing_time"] += processing_time
            
            # 更新意图分布
            intent_dist = self._retrieval_stats["intent_distribution"]
            intent_dist[intent_type] = intent_dist.get(intent_type, 0) + 1
            
            # 更新路由分布
            routing_dist = self._retrieval_stats["routing_distribution"]
            routing_dist[routing_method] = routing_dist.get(routing_method, 0) + 1
            
            # 更新检索策略使用情况
            strategy_usage = self._retrieval_stats["retrieval_strategy_usage"]
            strategy_usage[retrieval_strategy] = strategy_usage.get(retrieval_strategy, 0) + 1
            
            # 更新结果数量统计
            self._retrieval_stats["total_result_count"] += result_count
            
            # 更新最后更新时间
            self._retrieval_stats["last_updated"] = datetime.utcnow().isoformat()
            
        except Exception as e:
            logger.error(f"更新检索统计失败: {str(e)}")
    
    async def get_retrieval_statistics(self) -> Dict[str, Any]:
        """
        获取检索统计信息
        
        Returns:
            包含以下统计信息的字典：
            - total_searches: 总检索次数
            - average_processing_time: 平均处理时间
            - intent_distribution: 意图类型分布
            - routing_distribution: 路由方法分布
            - retrieval_strategy_usage: 检索策略使用情况
            - average_result_count: 平均结果数量
        """
        try:
            stats = self._retrieval_stats.copy()
            
            # 计算平均处理时间
            total_searches = stats["total_searches"]
            if total_searches > 0:
                stats["average_processing_time"] = stats["total_processing_time"] / total_searches
                stats["average_result_count"] = stats["total_result_count"] / total_searches
            else:
                stats["average_processing_time"] = 0.0
                stats["average_result_count"] = 0.0
            
            # 计算意图分布百分比
            intent_dist = stats["intent_distribution"]
            if intent_dist and total_searches > 0:
                intent_percentages = {
                    intent: round((count / total_searches) * 100, 2)
                    for intent, count in intent_dist.items()
                }
                stats["intent_distribution_percentages"] = intent_percentages
            
            # 计算路由分布百分比
            routing_dist = stats["routing_distribution"]
            if routing_dist and total_searches > 0:
                routing_percentages = {
                    method: round((count / total_searches) * 100, 2)
                    for method, count in routing_dist.items()
                }
                stats["routing_distribution_percentages"] = routing_percentages
            
            # 计算检索策略使用百分比
            strategy_usage = stats["retrieval_strategy_usage"]
            if strategy_usage and total_searches > 0:
                strategy_percentages = {
                    strategy: round((count / total_searches) * 100, 2)
                    for strategy, count in strategy_usage.items()
                }
                stats["retrieval_strategy_usage_percentages"] = strategy_percentages
            
            return stats
            
        except Exception as e:
            logger.error(f"获取检索统计失败: {str(e)}")
            return {
                "total_searches": 0,
                "average_processing_time": 0.0,
                "intent_distribution": {},
                "routing_distribution": {},
                "retrieval_strategy_usage": {},
                "error": str(e)
            }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            component_health = {
                "intent_processor": await self.intent_processor.health_check(),
                "query_rewriter": await self.query_rewriter.health_check(),
                "search_engine": await self.search_engine.health_check(),
                "reranker": await self.reranker.health_check(),
                "kb_router": await self.kb_router.get_routing_statistics()
            }
            
            all_healthy = all(
                health.get("status") == "healthy" 
                for health in component_health.values()
            )
            
            return {
                "status": "healthy" if all_healthy else "unhealthy",
                "components": component_health
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }
