"""视频关键帧只作内部证据、不得成为回答图片的回归测试。"""

import asyncio

from app.modules.generation.context_builder import ContextBuilder, ReferenceMap
from app.modules.generation.stream_manager import _reference_map_to_frontend_refs


def _video_reference() -> ReferenceMap:
    return ReferenceMap(
        id="1",
        content_type="video",
        file_path="videos/video-1_茶叶驯化史.mp4",
        content="画面：讲解茶树驯化。\n语音：茶树经历长期选择。",
        metadata={
            "kb_id": "kb-video",
            "score": 0.91,
            "shot_start_time": 12.0,
            "shot_end_time": 24.0,
            "key_frames": [{
                "timestamp": 18.0,
                "description": "茶树种植画面。",
                "frame_image_path": "videos/video-1/keyframes/shot-1-frame-1.jpg",
                "img_url": "https://example.test/frame.jpg",
            }],
        },
        presigned_url="https://example.test/video.mp4",
    )


def test_streamed_video_citation_does_not_expose_keyframes():
    refs = _reference_map_to_frontend_refs({"1": _video_reference()})

    assert len(refs) == 1
    assert refs[0]["type"] == "video"
    assert refs[0]["video_url"] == "https://example.test/video.mp4"
    assert "key_frames" not in refs[0]


def test_validated_video_citation_strips_internal_keyframe_metadata():
    builder = ContextBuilder()
    refs = {"1": _video_reference()}

    public_refs = builder.validate_references("茶树驯化经历长期选择。[1]", refs)

    assert len(public_refs) == 1
    assert "key_frames" not in public_refs[0]
    assert "key_frames" not in public_refs[0]["metadata"]
    assert public_refs[0]["start_sec"] == 12.0
    assert public_refs[0]["end_sec"] == 24.0


def test_context_builder_keeps_keyframes_internal_and_does_not_create_image_references():
    async def run():
        builder = ContextBuilder()
        reference_map = {"1": _video_reference()}

        async def fake_process(_retrieval_result):
            return []

        async def fake_reference_map(_processed_results, target_kb_ids=None):
            return reference_map

        async def fake_enrich(_reference_map):
            return None

        builder._process_retrieval_results = fake_process
        builder._generate_reference_map = fake_reference_map
        builder._enrich_audio_video_presigned_urls = fake_enrich

        result = await builder.build_context(
            type("Retrieval", (), {"reranked_results": [], "context": None})(),
            query="介绍一下茶叶的驯化史",
        )

        assert list(result.reference_map) == ["1"]
        assert result.total_images == 0
        assert "类型: 图片" not in result.context_string

    asyncio.run(run())
