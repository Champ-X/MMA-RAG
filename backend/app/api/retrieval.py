"""Stable, agent-facing retrieval API.

This router intentionally returns a compact evidence contract instead of
exposing Qdrant payloads or the internal ``RetrievalResult`` dataclass.
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.core.logger import get_logger
from app.modules.retrieval.service import RetrievalResult, RetrievalService


router = APIRouter()
logger = get_logger(__name__)
retrieval_service = RetrievalService()

Modality = Literal["doc", "image", "audio", "video"]


class SelectedFileRequest(BaseModel):
    kb_id: str = Field(..., min_length=1)
    file_id: str = Field(..., min_length=1)
    name: Optional[str] = None
    type: Optional[str] = None


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    knowledge_base_ids: List[str] = Field(default_factory=list)
    file_ids: List[str] = Field(default_factory=list)
    selected_files: List[SelectedFileRequest] = Field(default_factory=list)
    modalities: List[Modality] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=1, le=50)

    @model_validator(mode="after")
    def validate_file_scope(self) -> "KnowledgeSearchRequest":
        if self.file_ids and len(self.knowledge_base_ids) != 1:
            raise ValueError("file_ids requires exactly one knowledge_base_id")
        return self


class EvidenceSource(BaseModel):
    knowledge_base_id: Optional[str] = None
    file_id: Optional[str] = None
    file_name: str = ""
    file_path: str = ""
    chunk_index: Optional[int] = None
    page: Optional[int] = None
    start_seconds: Optional[float] = None
    end_seconds: Optional[float] = None


class EvidenceItem(BaseModel):
    id: str
    modality: Modality
    content: str
    score: float
    source: EvidenceSource


class KnowledgeSearchResponse(BaseModel):
    query: str
    refined_query: str
    intent_type: str
    target_knowledge_bases: List[Dict[str, Any]]
    processing_time: float
    results: List[EvidenceItem]


def _first_value(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None and value != "":
            return value
    return None


def _as_optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_optional_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _infer_modality(item: Dict[str, Any], payload: Dict[str, Any]) -> Modality:
    raw = str(item.get("content_type") or "").strip().lower()
    aliases = {"document": "doc", "text": "doc"}
    raw = aliases.get(raw, raw)
    if raw in {"doc", "image", "audio", "video"}:
        return raw  # type: ignore[return-value]
    if payload.get("shot_id") or payload.get("video_format") or payload.get("segment_id"):
        return "video"
    if "transcript" in payload:
        return "audio"
    if "caption" in payload:
        return "image"
    return "doc"


def _evidence_content(
    item: Dict[str, Any],
    payload: Dict[str, Any],
    modality: Modality,
) -> str:
    if modality == "image":
        return str(_first_value(payload, "caption", "description") or item.get("content") or "")
    if modality == "audio":
        transcript = str(payload.get("transcript") or "").strip()
        description = str(payload.get("description") or "").strip()
        if transcript and description and transcript != description:
            return f"转写：{transcript}\n描述：{description}"
        return transcript or description or str(item.get("content") or "")
    if modality == "video":
        parts: List[str] = []
        for label, key in (("场景", "scene_summary"), ("画面", "caption"), ("语音", "asr_text")):
            value = str(payload.get(key) or "").strip()
            if value:
                parts.append(f"{label}：{value}")
        return "\n".join(parts) or str(
            _first_value(item, "content") or _first_value(payload, "description", "caption") or ""
        )
    return str(_first_value(payload, "text_content", "content", "text") or item.get("content") or "")


def serialize_evidence_item(item: Dict[str, Any]) -> EvidenceItem:
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    modality = _infer_modality(item, payload)
    file_path = str(
        _first_value(payload, "file_path", "object_path")
        or _first_value(item, "file_path")
        or ""
    )
    file_name = str(_first_value(payload, "file_name", "filename") or "")
    if not file_name and file_path:
        file_name = PurePosixPath(file_path.replace("\\", "/")).name

    start_seconds = _as_optional_float(
        _first_value(payload, "shot_start_time", "scene_start_time", "start_time")
    )
    end_seconds = _as_optional_float(
        _first_value(payload, "shot_end_time", "scene_end_time", "end_time")
    )
    point_id = _first_value(item, "id", "point_id")
    if point_id is None:
        point_id = _first_value(payload, "chunk_id", "file_id") or ""

    return EvidenceItem(
        id=str(point_id),
        modality=modality,
        content=_evidence_content(item, payload, modality),
        score=float(_first_value(item, "final_score", "score") or 0.0),
        source=EvidenceSource(
            knowledge_base_id=(
                str(_first_value(payload, "kb_id", "knowledge_base_id"))
                if _first_value(payload, "kb_id", "knowledge_base_id") is not None
                else None
            ),
            file_id=(
                str(_first_value(payload, "file_id", "document_id"))
                if _first_value(payload, "file_id", "document_id") is not None
                else None
            ),
            file_name=file_name,
            file_path=file_path,
            chunk_index=_as_optional_int(payload.get("chunk_index")),
            page=_as_optional_int(_first_value(payload, "page", "page_number", "page_index")),
            start_seconds=start_seconds,
            end_seconds=end_seconds,
        ),
    )


def _build_selected_files(request: KnowledgeSearchRequest) -> List[Dict[str, str]]:
    selected = [item.model_dump(exclude_none=True) for item in request.selected_files]
    if request.file_ids:
        kb_id = request.knowledge_base_ids[0]
        selected.extend({"kb_id": kb_id, "file_id": file_id} for file_id in request.file_ids)

    deduped: List[Dict[str, str]] = []
    seen = set()
    for item in selected:
        key = (str(item["kb_id"]), str(item["file_id"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append({key: str(value) for key, value in item.items() if value is not None})
    return deduped


def serialize_search_response(
    *,
    request: KnowledgeSearchRequest,
    retrieval_result: RetrievalResult,
) -> KnowledgeSearchResponse:
    allowed_modalities = set(request.modalities)
    evidence = [
        serialize_evidence_item(item)
        for item in (retrieval_result.reranked_results or [])
    ]
    if allowed_modalities:
        evidence = [item for item in evidence if item.modality in allowed_modalities]
    evidence = evidence[: request.top_k]

    context = retrieval_result.context
    return KnowledgeSearchResponse(
        query=request.query,
        refined_query=str(getattr(context, "refined_query", request.query) or request.query),
        intent_type=str(getattr(context, "intent_type", "factual") or "factual"),
        target_knowledge_bases=list(getattr(context, "target_kbs", []) or []),
        processing_time=float(retrieval_result.processing_time or 0.0),
        results=evidence,
    )


@router.post("/search", response_model=KnowledgeSearchResponse)
async def search_knowledge(request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
    """Search MMA-RAG and return compact multimodal evidence without generating an answer."""
    query = " ".join(request.query.split()).strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 不能为空")

    selected_files = _build_selected_files(request)
    kb_ids = list(dict.fromkeys(request.knowledge_base_ids))
    if selected_files:
        kb_ids = list(dict.fromkeys([item["kb_id"] for item in selected_files]))
    kb_context = (
        {
            "kb_ids": kb_ids,
            "kb_names": [],
            "selected_files": selected_files,
        }
        if kb_ids or selected_files
        else None
    )

    try:
        result = await retrieval_service.search(query=query, kb_context=kb_context)
        return serialize_search_response(request=request, retrieval_result=result)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("公开检索接口失败 query=%s", query[:100])
        raise HTTPException(status_code=500, detail=str(error)) from error
