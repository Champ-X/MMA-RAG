"""Transparent policy for choosing direct retrieval or Agent deep research."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


AGENT_MODES = {"auto", "direct", "agent"}


def normalize_agent_mode(value: Any, *, default: str = "auto") -> str:
    """Normalize new three-state values while accepting legacy booleans."""

    if isinstance(value, bool):
        return "agent" if value else "direct"
    normalized = str(value or "").strip().lower()
    aliases = {
        "true": "agent",
        "1": "agent",
        "on": "agent",
        "enabled": "agent",
        "false": "direct",
        "0": "direct",
        "off": "direct",
        "disabled": "direct",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in AGENT_MODES else default


@dataclass(frozen=True)
class AgentModeResolution:
    requested_mode: str
    selected_mode: str
    reason: str
    score: int = 0

    @property
    def enabled(self) -> bool:
        return self.selected_mode == "agent"

    def metadata(self) -> Dict[str, Any]:
        return {
            "requested": self.requested_mode,
            "selected": self.selected_mode,
            "enabled": self.enabled,
            "reason": self.reason,
            "score": self.score,
        }


_STRONG_RESEARCH_MARKERS = (
    "深入调研",
    "深度调研",
    "深入分析",
    "深度分析",
    "全面分析",
    "系统梳理",
    "多角度",
    "证据链",
    "制定方案",
    "给出方案",
    "stress test",
    "deep research",
    "in-depth",
)
_COMPARISON_MARKERS = (
    "对比",
    "比较",
    "差异",
    "异同",
    "优缺点",
    "利弊",
    "权衡",
    "compare",
    "versus",
    " vs ",
    "pros and cons",
)
_MULTI_TASK_MARKERS = (
    "分别",
    "逐步",
    "首先",
    "其次",
    "然后",
    "最后",
    "每一个",
    "各自",
    "step by step",
)
_SYNTHESIS_MARKERS = (
    "综合",
    "归纳",
    "评估",
    "分析",
    "为什么",
    "依据",
    "原因",
    "建议",
    "synthesize",
    "evaluate",
    "analyze",
)
_MODALITY_MARKERS = {
    "document": ("文档", "文章", "报告", "pdf", "document"),
    "image": ("图片", "图像", "截图", "海报", "image"),
    "audio": ("音频", "录音", "音乐", "语音", "audio"),
    "video": ("视频", "影片", "关键帧", "video"),
}


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    return any(marker in text for marker in markers)


def resolve_agent_mode(
    requested_mode: Any,
    *,
    query: str,
    selected_files: Optional[List[Dict[str, Any]]] = None,
    attachment_context: Optional[str] = None,
) -> AgentModeResolution:
    """Resolve a requested mode using a deterministic, explainable policy.

    Auto mode deliberately favors direct retrieval for focused questions and
    enables Agent only when several complexity signals are present.
    """

    requested = normalize_agent_mode(requested_mode, default="direct")
    if requested == "agent":
        return AgentModeResolution(
            requested_mode=requested,
            selected_mode="agent",
            reason="已手动启用 Agent 深研",
        )
    if requested == "direct":
        return AgentModeResolution(
            requested_mode=requested,
            selected_mode="direct",
            reason="已手动选择直接检索",
        )

    text = re.sub(r"\s+", " ", str(query or "")).strip().lower()
    score = 0
    reasons: List[str] = []

    if _contains_any(text, _STRONG_RESEARCH_MARKERS):
        score += 3
        reasons.append("包含深度调研或方案设计目标")
    if _contains_any(text, _COMPARISON_MARKERS):
        score += 3
        reasons.append("需要对比或权衡多组证据")
    if _contains_any(text, _MULTI_TASK_MARKERS) or re.search(
        r"(?:^|[\s，,；;])(?:[1-9][、.)）]|一[、.)）]|二[、.)）])",
        text,
    ):
        score += 3
        reasons.append("包含多个独立子任务")
    if _contains_any(text, _SYNTHESIS_MARKERS):
        score += 1
        reasons.append("需要分析或综合证据")

    modalities = [
        name
        for name, markers in _MODALITY_MARKERS.items()
        if any(marker in text for marker in markers)
    ]
    if len(modalities) >= 2:
        score += 2
        reasons.append("需要跨模态取证")

    question_count = len(re.findall(r"[?？]", text))
    if question_count >= 2:
        score += 1
        reasons.append("包含多个问题")
    if len(text) >= 160:
        score += 2
        reasons.append("问题描述较长")
    elif len(text) >= 80:
        score += 1
        reasons.append("问题包含较多约束")

    scoped_files = selected_files or []
    if len(scoped_files) >= 2:
        score += 1
        reasons.append("指定了多个证据文件")
    if attachment_context and _contains_any(text, ("结合", "对照", "比较", "综合")):
        score += 1
        reasons.append("需要结合附件与知识库")

    enabled = score >= 3
    return AgentModeResolution(
        requested_mode="auto",
        selected_mode="agent" if enabled else "direct",
        reason=(
            "；".join(reasons[:3])
            if enabled and reasons
            else "问题目标集中，单轮多模态检索即可完成"
        ),
        score=score,
    )
