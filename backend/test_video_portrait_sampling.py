"""视频 Scene 画像采样与小语料聚类回归测试。"""

import asyncio

from app.modules.knowledge.portraits import PortraitGenerator, VectorSample


def test_video_shots_are_collapsed_to_scene_samples_with_asr_fusion():
    records = [
        {
            "id": "shot-1",
            "file_id": "video-a",
            "scene_id": "scene-001",
            "shot_id": "shot-001",
            "shot_start_time": 0,
            "caption_vector": [1.0, 0.0, 0.0],
            "asr_vector": [0.0, 1.0, 0.0],
        },
        {
            "id": "shot-2",
            "file_id": "video-a",
            "scene_id": "scene-001",
            "shot_id": "shot-002",
            "shot_start_time": 8,
            "caption_vector": [0.8, 0.2, 0.0],
            "asr_vector": [0.0, 1.0, 0.0],
        },
        {
            "id": "shot-3",
            "file_id": "video-a",
            "scene_id": "scene-002",
            "shot_id": "shot-003",
            "shot_start_time": 16,
            "caption_vector": [0.0, 0.0, 1.0],
            "asr_vector": None,
        },
    ]

    scenes = PortraitGenerator._collapse_video_shots_to_scenes(records)

    assert len(scenes) == 2
    assert [scene.scene_id for scene in scenes] == ["scene-001", "scene-002"]
    assert all(scene.source_type == "video" for scene in scenes)
    # Scene 001 同时保留视觉 caption 与 ASR 语义，不退化为只取第一条 Shot 的向量。
    assert scenes[0].vector[0] > 0
    assert scenes[0].vector[1] > 0


def test_short_video_only_corpus_builds_one_portrait_cluster():
    # 绕开 __init__ 中的外部存储初始化；该单元测试只覆盖纯聚类逻辑。
    generator = PortraitGenerator.__new__(PortraitGenerator)
    samples = [
        VectorSample(id="scene-1", vector=[1.0, 0.0, 0.0], source_type="video"),
        VectorSample(id="scene-2", vector=[0.9, 0.1, 0.0], source_type="video"),
    ]

    result = asyncio.run(generator._perform_clustering(samples))

    assert result["k"] == 1
    assert result["labels"] == [0, 0]
    assert result["silhouette_score"] is None
    assert len(samples) == 2
