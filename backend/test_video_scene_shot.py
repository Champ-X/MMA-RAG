"""Scene–Shot–ASR 解析结果的纯逻辑回归测试。"""

from app.modules.ingestion.video_scene_shot import (
    extract_json_object,
    merge_chunk_analyses,
    normalize_video_analysis,
    shift_video_analysis,
)


def _analysis(caption_prefix: str, asr_prefix: str):
    return {
        "video_summary": "讲解甜瓜品种与果肉特点的视频。",
        "scenes": [
            {
                "start_time": 0,
                "end_time": 20,
                "scene_summary": "讲解者在桌面展示甜瓜，随后切开果实说明果肉颜色与品种特点。",
                "shots": [
                    {
                        "start_time": 0,
                        "end_time": 10,
                        "caption": f"{caption_prefix}讲解者在桌面展示甜瓜并介绍外观和品种特征。",
                        "asr_status": "present",
                        "asr_text": f"{asr_prefix}这是一段完整的第一句语音内容。",
                        "keyframes": [{"timestamp": 5, "description": "讲解者指向桌面上的甜瓜。"}],
                    },
                    {
                        "start_time": 10,
                        "end_time": 20,
                        "caption": f"{caption_prefix}讲解者切开甜瓜展示果肉颜色和内部结构。",
                        "asr_status": "present",
                        "asr_text": f"{asr_prefix}这是一段完整的第二句语音内容。",
                        "keyframes": [{"timestamp": 15, "description": "切开的甜瓜露出浅色果肉。"}],
                    },
                ],
            }
        ],
    }


def test_normalize_enforces_scene_and_shot_coverage_and_keeps_boundary_flag():
    raw = _analysis("", "")
    raw["scenes"][0]["shots"][0]["speech_boundary"] = {"starts_mid_sentence": True}
    normalized = normalize_video_analysis(raw, duration=20)

    scene = normalized["scenes"][0]
    assert (scene["start_time"], scene["end_time"]) == (0.0, 20.0)
    assert [(shot["start_time"], shot["end_time"]) for shot in scene["shots"]] == [
        (0.0, 10.0),
        (10.0, 20.0),
    ]
    assert scene["shots"][0]["speech_boundary"]["starts_mid_sentence"] is True


def test_merge_keeps_adjacent_similar_speech_and_only_deduplicates_true_overlap():
    first = normalize_video_analysis(_analysis("前段", "前段"), duration=20)
    second = shift_video_analysis(normalize_video_analysis(_analysis("后段", "后段"), duration=20), 15)
    merged = merge_chunk_analyses([first, second], duration=35, overlap_seconds=5)

    shots = merged["scenes"][0]["shots"]
    # 当前 overlap 内内容不同，不能因相似口头句式被错误吞掉；输出仍无时间缝隙。
    assert [(shot["start_time"], shot["end_time"]) for shot in shots] == [
        (0.0, 10.0),
        (10.0, 20.0),
        (20.0, 25.0),
        (25.0, 35.0),
    ]


def test_extract_json_object_tolerates_fence_and_surrounding_text():
    result = extract_json_object('说明文字\n```json\n{"scenes": []}\n```')
    assert result == {"scenes": []}
