from app.modules.retrieval.processors.intent import IntentProcessor
from app.modules.retrieval.service import _apply_agent_target_modality_fallback


def _preplanned_validation(query: str):
    return IntentProcessor.__new__(IntentProcessor)._validate_intent_analysis(
        {"intent_type": "analysis", "is_complex": False},
        query,
    )


def test_agent_preplanned_poster_query_triggers_visual_retrieval():
    intent = _preplanned_validation("Peaky Blinders 官方海报封面")

    assert intent["visual_intent"] == "explicit_demand"


def test_agent_preplanned_theme_song_query_triggers_audio_retrieval():
    intent = _preplanned_validation("Peaky Blinders Red Right Hand 主题曲")

    assert intent["audio_intent"] == "explicit_demand"


def test_agent_preplanned_movie_query_triggers_implicit_video_retrieval():
    intent = _preplanned_validation("电影《八仙》中的蓬莱仙境设定有哪些出处？")

    assert intent["video_intent"] == "implicit_enrichment"


def test_agent_uses_video_when_primary_routed_kb_has_no_text_index():
    updated, fallback = _apply_agent_target_modality_fallback(
        {
            "visual_intent": "implicit_enrichment",
            "audio_intent": "unnecessary",
            "video_intent": "unnecessary",
        },
        target_kb_ids=["tea-video", "generic-text"],
        modality_inventory={
            "tea-video": {
                "name": "生物科普",
                "text": 0,
                "image": 0,
                "audio": 0,
                "video": 397,
            },
            "generic-text": {
                "name": "Harness Paper",
                "text": 319,
                "image": 22,
                "audio": 0,
                "video": 0,
            },
        },
        routing_details={"anchor_kb_id": "tea-video"},
    )

    assert updated["visual_intent"] == "implicit_enrichment"
    assert updated["video_intent"] == "implicit_enrichment"
    assert fallback == {
        "kb_id": "tea-video",
        "kb_name": "生物科普",
        "modality": "video",
        "available_count": 397,
    }


def test_agent_target_modality_fallback_does_not_replace_explicit_request():
    updated, fallback = _apply_agent_target_modality_fallback(
        {
            "visual_intent": "explicit_demand",
            "audio_intent": "unnecessary",
            "video_intent": "unnecessary",
        },
        target_kb_ids=["video-only"],
        modality_inventory={
            "video-only": {"text": 0, "image": 0, "audio": 0, "video": 10},
        },
    )

    assert updated["video_intent"] == "unnecessary"
    assert fallback == {}
