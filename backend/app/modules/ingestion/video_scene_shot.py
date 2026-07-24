"""Scene–Shot 视频解析结果的规范化与分块合并。

MLLM 的输出是一个有价值但不完全可靠的中间结果：字段可能缺失、时间戳可能有
轻微偏差，长视频相邻窗口还会在 overlap 内重复描述。本模块不依赖数据库或模型，
负责把这些结果收敛为稳定的 ``scene_shot_asr_v4`` 数据结构，方便入库和单元测试。
"""

from __future__ import annotations

from difflib import SequenceMatcher
import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


SCHEMA_VERSION = "scene_shot_asr_v4"
DEFAULT_MAX_KEYFRAMES_PER_SHOT = 4
DEFAULT_KEYFRAME_MIN_GAP_SECONDS = 1.0


def _number(value: Any, default: float = 0.0) -> float:
    """尽量把模型输出的秒数转换为非负 float。"""
    try:
        if isinstance(value, str) and ":" in value:
            parts = [float(part) for part in value.strip().split(":")]
            if len(parts) == 3:
                return max(0.0, parts[0] * 3600 + parts[1] * 60 + parts[2])
            if len(parts) == 2:
                return max(0.0, parts[0] * 60 + parts[1])
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return default


def _text(value: Any, default: str = "") -> str:
    return str(value or default).strip()


def _boolean(value: Any, default: bool = False) -> bool:
    """兼容模型偶尔把 JSON 布尔值输出为字符串的情况。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no", ""}:
            return False
    return default if value is None else bool(value)


def extract_json_object(raw: Any) -> Optional[Dict[str, Any]]:
    """从模型文本提取首个完整 JSON 对象，兼容 code fence 和前后说明。"""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None

    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    quote: Optional[str] = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if quote:
            if char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ('"', "'"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidate = re.sub(r",\s*([}\]])", r"\1", text[start:index + 1])
                try:
                    parsed = json.loads(candidate)
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, dict) else None
    return None


def _normalize_keyframes(
    frames: Any,
    start: float,
    end: float,
    fallback_description: str,
    *,
    max_keyframes_per_shot: int = DEFAULT_MAX_KEYFRAMES_PER_SHOT,
    min_gap_seconds: float = DEFAULT_KEYFRAME_MIN_GAP_SECONDS,
) -> List[Dict[str, Any]]:
    """校正 MLLM 选择的关键帧，不再把有价值的多帧静默压成单帧/双帧。"""
    max_frames = max(1, int(max_keyframes_per_shot or DEFAULT_MAX_KEYFRAMES_PER_SHOT))
    min_gap = max(0.0, float(min_gap_seconds or 0.0))
    normalized: List[Dict[str, Any]] = []
    if isinstance(frames, list):
        # 先收集有限候选再去重；不能在去重前截断，否则前几个重复帧会挤掉后续有区分度的帧。
        for frame in frames[:max(16, max_frames * 4)]:
            if not isinstance(frame, dict):
                continue
            timestamp = min(end, max(start, _number(frame.get("timestamp"), (start + end) / 2)))
            description = _text(frame.get("description"), fallback_description)
            normalized.append({"timestamp": round(timestamp, 3), "description": description})
    if not normalized and end > start:
        normalized.append({
            "timestamp": round((start + end) / 2, 3),
            "description": fallback_description or "该片段的代表性视频画面。",
        })
    # 接近同一时刻的重复关键帧不会带来额外检索价值。
    deduped: List[Dict[str, Any]] = []
    for frame in sorted(normalized, key=lambda item: item["timestamp"]):
        if not deduped or abs(frame["timestamp"] - deduped[-1]["timestamp"]) >= min_gap:
            deduped.append(frame)
    return deduped[:max_frames]


def _normalize_shot(
    raw: Dict[str, Any],
    start: float,
    end: float,
    scene_index: int,
    shot_index: int,
    *,
    max_keyframes_per_shot: int = DEFAULT_MAX_KEYFRAMES_PER_SHOT,
    keyframe_min_gap_seconds: float = DEFAULT_KEYFRAME_MIN_GAP_SECONDS,
) -> Dict[str, Any]:
    caption = _text(raw.get("caption") or raw.get("shot_description"), "视频片段内容。")
    asr_text = _text(raw.get("asr_text") or raw.get("shot_asr_transcript"))
    asr_status = _text(raw.get("asr_status"), "present" if asr_text else "no_speech").lower()
    if asr_status not in {"present", "no_speech", "inaudible"}:
        asr_status = "present" if asr_text else "no_speech"
    if asr_status != "present" and asr_text:
        asr_status = "present"
    boundary = raw.get("speech_boundary") if isinstance(raw.get("speech_boundary"), dict) else {}
    return {
        "shot_id": _text(raw.get("shot_id"), f"shot_{scene_index:03d}_{shot_index:02d}"),
        "start_time": round(start, 3),
        "end_time": round(end, 3),
        "caption": caption,
        "asr_status": asr_status,
        "asr_text": asr_text,
        "speech_boundary": {
            "starts_mid_sentence": _boolean(boundary.get("starts_mid_sentence", False)),
            "ends_mid_sentence": _boolean(boundary.get("ends_mid_sentence", False)),
        },
        "keyframes": _normalize_keyframes(
            raw.get("keyframes"),
            start,
            end,
            caption,
            max_keyframes_per_shot=max_keyframes_per_shot,
            min_gap_seconds=keyframe_min_gap_seconds,
        ),
    }


def normalize_video_analysis(
    raw: Any,
    duration: float,
    *,
    chunk_start_is_mid_sentence: bool = False,
    chunk_end_is_mid_sentence: bool = False,
    max_keyframes_per_shot: int = DEFAULT_MAX_KEYFRAMES_PER_SHOT,
    keyframe_min_gap_seconds: float = DEFAULT_KEYFRAME_MIN_GAP_SECONDS,
) -> Dict[str, Any]:
    """规范化单个视频窗口的 MLLM 结果。

    时间边界以模型的语义切分为优先，但最终强制 Scene 和 Shot 各自完整覆盖
    ``[0, duration]``。这保证按 shot 索引时不存在检索不到的时间缝隙。
    """
    duration = max(0.0, float(duration or 0.0))
    data = extract_json_object(raw) if not isinstance(raw, dict) else raw
    if not isinstance(data, dict):
        data = {}

    raw_scenes = data.get("scenes")
    if not isinstance(raw_scenes, list):
        # 保持与旧模型的场景数组结果的宽容兼容（调用方可传 {scenes: old_array}）。
        raw_scenes = []

    scenes: List[Dict[str, Any]] = []
    for scene_index, raw_scene in enumerate(raw_scenes, 1):
        if not isinstance(raw_scene, dict):
            continue
        scene_start = min(duration, _number(raw_scene.get("start_time", raw_scene.get("t_start"))))
        scene_end = min(duration, _number(raw_scene.get("end_time", raw_scene.get("t_end")), duration))
        if scene_end <= scene_start:
            continue
        summary = _text(raw_scene.get("scene_summary") or raw_scene.get("scene_description"), "视频场景内容。")
        raw_shots = raw_scene.get("shots")
        if not isinstance(raw_shots, list) or not raw_shots:
            raw_shots = [{
                "start_time": scene_start,
                "end_time": scene_end,
                "caption": summary,
                "asr_status": "no_speech",
                "asr_text": "",
                "keyframes": raw_scene.get("keyframes") or [],
            }]
        shots: List[Dict[str, Any]] = []
        for shot_index, raw_shot in enumerate(raw_shots, 1):
            if not isinstance(raw_shot, dict):
                continue
            raw_start = _number(raw_shot.get("start_time", raw_shot.get("t_start")), scene_start)
            raw_end = _number(raw_shot.get("end_time", raw_shot.get("t_end")), scene_end)
            start = min(scene_end, max(scene_start, raw_start))
            end = min(scene_end, max(start, raw_end))
            if end <= start:
                continue
            shots.append(
                _normalize_shot(
                    raw_shot,
                    start,
                    end,
                    scene_index,
                    shot_index,
                    max_keyframes_per_shot=max_keyframes_per_shot,
                    keyframe_min_gap_seconds=keyframe_min_gap_seconds,
                )
            )
        if not shots:
            shots.append(
                _normalize_shot(
                    {},
                    scene_start,
                    scene_end,
                    scene_index,
                    1,
                    max_keyframes_per_shot=max_keyframes_per_shot,
                    keyframe_min_gap_seconds=keyframe_min_gap_seconds,
                )
            )
        scenes.append({
            "scene_id": _text(raw_scene.get("scene_id"), f"scene_{scene_index:03d}"),
            "start_time": scene_start,
            "end_time": scene_end,
            "scene_summary": summary,
            "shots": shots,
        })

    if not scenes and duration > 0:
        scenes = [{
            "scene_id": "scene_001",
            "start_time": 0.0,
            "end_time": duration,
            "scene_summary": "视频内容，模型未返回结构化场景描述。",
            "shots": [
                _normalize_shot(
                    {},
                    0.0,
                    duration,
                    1,
                    1,
                    max_keyframes_per_shot=max_keyframes_per_shot,
                    keyframe_min_gap_seconds=keyframe_min_gap_seconds,
                )
            ],
        }]

    scenes.sort(key=lambda scene: (scene["start_time"], scene["end_time"]))
    # Scene 连续化；每个 Scene 内的 Shot 也连续化。保留原结尾，只修复重叠/缝隙。
    previous_scene_end = 0.0
    for scene_index, scene in enumerate(scenes, 1):
        scene["scene_id"] = f"scene_{scene_index:03d}"
        scene["start_time"] = round(previous_scene_end, 3)
        desired_end = max(scene["start_time"], min(duration, float(scene["end_time"])))
        if scene_index == len(scenes):
            desired_end = duration
        elif desired_end <= scene["start_time"]:
            # 为后续 Scene 留出边界；异常模型输出仍应有一个可索引的区间。
            desired_end = max(scene["start_time"], min(duration, scenes[scene_index].get("start_time", duration)))
        scene["end_time"] = round(desired_end, 3)
        raw_shots = sorted(scene["shots"], key=lambda shot: (shot["start_time"], shot["end_time"]))
        if not raw_shots:
            raw_shots = [
                _normalize_shot(
                    {},
                    scene["start_time"],
                    scene["end_time"],
                    scene_index,
                    1,
                    max_keyframes_per_shot=max_keyframes_per_shot,
                    keyframe_min_gap_seconds=keyframe_min_gap_seconds,
                )
            ]
        previous_shot_end = scene["start_time"]
        for shot_index, shot in enumerate(raw_shots, 1):
            shot["shot_id"] = f"shot_{scene_index:03d}_{shot_index:02d}"
            shot["start_time"] = round(previous_shot_end, 3)
            shot_end = max(shot["start_time"], min(scene["end_time"], float(shot["end_time"])))
            if shot_index == len(raw_shots):
                shot_end = scene["end_time"]
            shot["end_time"] = round(shot_end, 3)
            shot["keyframes"] = _normalize_keyframes(
                shot.get("keyframes"),
                shot["start_time"],
                shot["end_time"],
                shot.get("caption", ""),
                max_keyframes_per_shot=max_keyframes_per_shot,
                min_gap_seconds=keyframe_min_gap_seconds,
            )
            previous_shot_end = shot["end_time"]
        scene["shots"] = [shot for shot in raw_shots if shot["end_time"] > shot["start_time"]]
        if not scene["shots"] and scene["end_time"] > scene["start_time"]:
            scene["shots"] = [
                _normalize_shot(
                    {},
                    scene["start_time"],
                    scene["end_time"],
                    scene_index,
                    1,
                    max_keyframes_per_shot=max_keyframes_per_shot,
                    keyframe_min_gap_seconds=keyframe_min_gap_seconds,
                )
            ]
        previous_scene_end = scene["end_time"]

    if scenes and scenes[0]["shots"]:
        first = scenes[0]["shots"][0]
        first["speech_boundary"]["starts_mid_sentence"] = (
            bool(chunk_start_is_mid_sentence)
            or bool(first["speech_boundary"].get("starts_mid_sentence", False))
        )
    if scenes and scenes[-1]["shots"]:
        last = scenes[-1]["shots"][-1]
        last["speech_boundary"]["ends_mid_sentence"] = (
            bool(chunk_end_is_mid_sentence)
            or bool(last["speech_boundary"].get("ends_mid_sentence", False))
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "video_summary": _text(data.get("video_summary"), scenes[0]["scene_summary"] if scenes else ""),
        "coverage": {"start_time": 0.0, "end_time": round(duration, 3)},
        "scenes": scenes,
    }


def shift_video_analysis(analysis: Dict[str, Any], offset_seconds: float) -> Dict[str, Any]:
    """将一个本地窗口的规范化结果平移到完整视频时间轴。"""
    offset = float(offset_seconds or 0.0)
    shifted = json.loads(json.dumps(analysis, ensure_ascii=False))
    coverage = shifted.get("coverage") or {}
    coverage["start_time"] = round(_number(coverage.get("start_time")) + offset, 3)
    coverage["end_time"] = round(_number(coverage.get("end_time")) + offset, 3)
    shifted["coverage"] = coverage
    for scene in shifted.get("scenes") or []:
        scene["start_time"] = round(_number(scene.get("start_time")) + offset, 3)
        scene["end_time"] = round(_number(scene.get("end_time")) + offset, 3)
        for shot in scene.get("shots") or []:
            shot["start_time"] = round(_number(shot.get("start_time")) + offset, 3)
            shot["end_time"] = round(_number(shot.get("end_time")) + offset, 3)
            for frame in shot.get("keyframes") or []:
                frame["timestamp"] = round(_number(frame.get("timestamp")) + offset, 3)
    return shifted


def _similarity(left: str, right: str) -> float:
    left, right = _text(left), _text(right)
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left[:500], right[:500]).ratio()


def _shot_quality(shot: Dict[str, Any]) -> Tuple[int, int, float]:
    """ASR 完整度、字幕文本长度、视觉描述长度，用于 overlap 冲突时择优。"""
    asr = _text(shot.get("asr_text"))
    return (
        1 if shot.get("asr_status") == "present" and asr else 0,
        len(asr),
        len(_text(shot.get("caption"))),
    )


def merge_chunk_analyses(
    analyses: Iterable[Dict[str, Any]],
    duration: float,
    overlap_seconds: float,
    *,
    max_keyframes_per_shot: int = DEFAULT_MAX_KEYFRAMES_PER_SHOT,
    keyframe_min_gap_seconds: float = DEFAULT_KEYFRAME_MIN_GAP_SECONDS,
) -> Dict[str, Any]:
    """合并已平移到全局时间轴的长视频窗口结果。

    只在两个 shot 明显落在相邻窗口重叠区、且 ASR 或 caption 高相似时去重；
    不把仅仅视觉相近但语音不同的连续内容误并。之后按相邻 scene summary 合并并重建
    连续时间边界。
    """
    duration = max(0.0, float(duration or 0.0))
    configured_overlap = max(0.0, float(overlap_seconds or 0.0))
    required_intersection = min(0.5, max(0.05, configured_overlap * 0.1))
    flattened: List[Dict[str, Any]] = []
    summaries: List[str] = []
    video_summary = ""
    for analysis in analyses:
        if not isinstance(analysis, dict):
            continue
        if not video_summary:
            video_summary = _text(analysis.get("video_summary"))
        for scene in analysis.get("scenes") or []:
            if not isinstance(scene, dict):
                continue
            summary = _text(scene.get("scene_summary"), "视频场景内容。")
            summaries.append(summary)
            for shot in scene.get("shots") or []:
                if not isinstance(shot, dict):
                    continue
                item = json.loads(json.dumps(shot, ensure_ascii=False))
                item["_scene_summary"] = summary
                flattened.append(item)

    flattened.sort(key=lambda shot: (float(shot.get("start_time", 0)), float(shot.get("end_time", 0))))
    accepted: List[Dict[str, Any]] = []
    for shot in flattened:
        start = _number(shot.get("start_time"))
        end = min(duration, _number(shot.get("end_time"), duration))
        if end <= start:
            continue
        shot["start_time"], shot["end_time"] = start, end
        if not accepted:
            accepted.append(shot)
            continue
        previous = accepted[-1]
        intersection = min(end, _number(previous.get("end_time"))) - max(start, _number(previous.get("start_time")))
        current_asr, previous_asr = _text(shot.get("asr_text")), _text(previous.get("asr_text"))
        current_caption, previous_caption = _text(shot.get("caption")), _text(previous.get("caption"))
        # 只去掉真正重叠的跨窗重复。相邻 Shot 可能有很短、相似的口头表达，不能仅因
        # 文本相似就合并；短文本的 SequenceMatcher 尤其容易给出虚高分。
        same_asr = (
            min(len(current_asr), len(previous_asr)) >= 12
            and _similarity(current_asr, previous_asr) >= 0.9
        )
        same_caption = (
            min(len(current_caption), len(previous_caption)) >= 20
            and _similarity(current_caption, previous_caption) >= 0.78
        )
        # caption 是跨模态重复判断的主证据；只有缺失 caption 时才退回 ASR，以免
        # “第一句/第二句”这类高度相似的连续解说被误去重。
        same_content = same_caption or ((not current_caption or not previous_caption) and same_asr)
        if intersection > required_intersection and same_content:
            if _shot_quality(shot) > _shot_quality(previous):
                accepted[-1] = shot
            continue
        accepted.append(shot)

    # Reconstruct Scene by contiguous same/similar scene description; model scene IDs are local per chunk.
    raw_scenes: List[Dict[str, Any]] = []
    for shot in accepted:
        summary = _text(shot.pop("_scene_summary", ""), shot.get("caption", "视频场景内容。"))
        if raw_scenes and _similarity(summary, raw_scenes[-1]["scene_summary"]) >= 0.72:
            raw_scenes[-1]["shots"].append(shot)
            raw_scenes[-1]["end_time"] = max(raw_scenes[-1]["end_time"], _number(shot.get("end_time")))
        else:
            raw_scenes.append({
                "scene_id": "",
                "start_time": _number(shot.get("start_time")),
                "end_time": _number(shot.get("end_time")),
                "scene_summary": summary,
                "shots": [shot],
            })
    raw = {"video_summary": video_summary, "scenes": raw_scenes}
    return normalize_video_analysis(
        raw,
        duration,
        max_keyframes_per_shot=max_keyframes_per_shot,
        keyframe_min_gap_seconds=keyframe_min_gap_seconds,
    )


def build_previous_context(analysis: Dict[str, Any], max_chars: int = 1800) -> str:
    """构造下一长视频窗口的最小必要上下文，不重复拼接整个历史。"""
    scenes = (analysis or {}).get("scenes") or []
    snippets: List[str] = []
    for scene in scenes[-2:]:
        summary = _text(scene.get("scene_summary"))
        shots = scene.get("shots") or []
        asr_tail = _text((shots[-1] if shots else {}).get("asr_text"))[-500:]
        text = f"场景：{summary}"
        if asr_tail:
            text += f"\n末段语音：{asr_tail}"
        snippets.append(text)
    result = "\n\n".join(snippets).strip()
    return result[-max_chars:] if result else "（本段为视频首段，无前文。）"


def iter_shots(analysis: Dict[str, Any]) -> Iterable[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """按时间顺序产出 ``(scene, shot)``，供入库构造向量点。"""
    for scene in (analysis or {}).get("scenes") or []:
        for shot in scene.get("shots") or []:
            yield scene, shot
