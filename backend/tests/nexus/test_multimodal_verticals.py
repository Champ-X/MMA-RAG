from __future__ import annotations

import io
import wave
from pathlib import Path

from openpyxl import Workbook
from PIL import Image

from nexus.bootstrap import build_container
from nexus.config import NexusSettings
from nexus.infrastructure.postgres.models import IndexGeneration, IndexRelease
from nexus.infrastructure.qdrant import QdrantEvidenceIndex
from nexus.modules.retrieval.domain import ScopeCapsule, SearchRequest
from nexus.shared.domain.enums import CapabilityStatus, Modality, QualityMode


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (12, 8), color=(26, 94, 74)).save(buffer, format="PNG")
    return buffer.getvalue()


def _wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def _xlsx() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Metrics"
    sheet.append(["Metric", "Value"])
    sheet.append(["Launch budget", 250000])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class FakeMultimodalEncoder:
    name = "fake-clip-clap-v1"
    visual_dimension = 4
    acoustic_dimension = 4

    @staticmethod
    def encode_image(content: bytes) -> list[float]:
        return [1.0, 0.0, 0.0, 0.0]

    @staticmethod
    def encode_audio(
        content: bytes, *, start_ms: int | None = None, end_ms: int | None = None
    ) -> list[float]:
        return [0.0, 1.0, 0.0, 0.0]

    @staticmethod
    def encode_video_frame(content: bytes, *, timestamp_ms: int = 0) -> list[float]:
        return [0.0, 0.0, 1.0, 0.0]

    @staticmethod
    def encode_visual_query(text: str) -> list[float]:
        return [1.0, 0.0, 0.0, 0.0]

    @staticmethod
    def encode_acoustic_query(text: str) -> list[float]:
        return [0.0, 1.0, 0.0, 0.0]

    @staticmethod
    def manifest() -> dict[str, object]:
        return {"type": "test-feature-models", "revision": "v1"}

    @staticmethod
    def health() -> dict[str, object]:
        return {"status": "ready"}


def test_four_modality_raw_evidence_projection_and_locator_verticals(tmp_path: Path) -> None:
    settings = NexusSettings.for_test(tmp_path).model_copy(update={"qdrant_url": ":memory:"})
    nexus = build_container(settings)
    try:
        space = nexus.spaces.create(name="Multimodal Gate", slug="multimodal-gate")
        samples = [
            ("metrics.csv", b"Metric,Value\nPilot seats,42\n", "text/csv", Modality.TABLE),
            (
                "budget.xlsx",
                _xlsx(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                Modality.TABLE,
            ),
            ("launch-diagram.png", _png(), "image/png", Modality.IMAGE),
            ("meeting.wav", _wav(), "audio/wav", Modality.AUDIO),
            ("demo.mp4", b"nexus-invalid-video-for-metadata-gate", "video/mp4", Modality.VIDEO),
        ]
        results = []
        for filename, content, mime_type, modality in samples:
            result = nexus.ingestion.ingest_bytes(
                space_id=space.id,
                filename=filename,
                content=content,
                mime_type=mime_type,
            )
            assert result.job.status == "completed"
            assert result.source_version.modality == modality
            assert result.source_version.capabilities["parse_structure"] == CapabilityStatus.READY
            assert nexus.blob_store.get(result.source_version.object_key) == content
            results.append(result)

        refreshed_space = nexus.spaces.get(space.id)
        assert refreshed_space.cover_source_version_id == results[2].source_version.id
        assert refreshed_space.cover_source_name == "launch-diagram.png"

        evidence, _ = nexus.control_plane.list_evidence(
            space_id=space.id,
            source_id=None,
            modality=None,
            cursor=None,
            limit=100,
        )
        locator_types = {item.modality: item.locator.locator_type for item in evidence}
        assert locator_types[Modality.TABLE] == "cell_range"
        assert sum(item.evidence_type == "table_column_profile" for item in evidence) == 4
        assert any(
            item.evidence_type == "table_column_profile"
            and item.locator.extra.get("column_name") == "Value"
            and item.locator.extra.get("data_type") == "numeric"
            for item in evidence
        )
        assert locator_types[Modality.IMAGE] == "image"
        assert locator_types[Modality.AUDIO] == "time_range"
        assert locator_types[Modality.VIDEO] == "time_range"
        image_evidence = [item for item in evidence if item.modality == Modality.IMAGE]
        assert len(image_evidence) == 1
        assert image_evidence[0].evidence_type == "whole_image"
        assert image_evidence[0].locator.extra["scope"] == "whole_image"
        assert any("caption_unavailable" in item.quality_flags for item in evidence)
        assert any("transcript_unavailable" in item.quality_flags for item in evidence)

        assert nexus.index is not None and nexus.qdrant_client is not None
        feature_encoder = FakeMultimodalEncoder()
        nexus.index = QdrantEvidenceIndex(
            database=nexus.database,
            client=nexus.qdrant_client,
            blob_store=nexus.blob_store,
            feature_encoder=feature_encoder,
        )
        nexus.retrieval.channels["image"].feature_encoder = feature_encoder
        projection = nexus.index.project_pending()
        assert projection["failures"] == []
        assert projection["projected"] == len(evidence)
        projected_sources = {
            item.source_version.display_name: nexus.control_plane.get_source_version(
                item.source_version.id
            )
            for item in results
        }
        assert projected_sources["metrics.csv"].capabilities["text_index"] == "ready"
        assert projected_sources["launch-diagram.png"].capabilities["visual_index"] == "ready"
        assert projected_sources["meeting.wav"].capabilities["acoustic_index"] == "ready"
        health = nexus.index.health()
        assert health["status"] == "ready"
        assert len(health["collections"]) == 4
        assert set(health["aliases"]) == {
            "text_evidence_active",
            "image_evidence_active",
            "audio_evidence_active",
            "video_evidence_active",
        }
        assert health["native_multimodal"] is True
        assert health["native_roles"] == {
            "text_evidence": [],
            "image_evidence": ["visual"],
            "audio_evidence": ["acoustic"],
            "video_evidence": ["frame_visual"],
        }

        first_release_id = str(projection["release_id"])
        first_aliases = dict(health["aliases"])
        partial_rebuild = nexus.index.project_pending(limit=1, force_rebuild=True)
        assert partial_rebuild["release_status"] == "building"
        assert partial_rebuild["release_id"] != first_release_id
        assert nexus.index.health()["aliases"] == first_aliases

        completed_rebuild = nexus.index.project_pending(limit=100)
        assert completed_rebuild["release_id"] == partial_rebuild["release_id"]
        assert completed_rebuild["release_status"] == "active"
        assert nexus.index.health()["aliases"] != first_aliases
        with nexus.database.transaction() as session:
            first_release = session.get(IndexRelease, first_release_id)
            assert first_release is not None and first_release.status == "superseded"
            assert all(
                generation is not None and generation.status == "retired"
                for generation in (
                    session.get(IndexGeneration, generation_id)
                    for generation_id in first_release.generation_map.values()
                )
            )

        pack = nexus.retrieval.search(
            SearchRequest(
                query="launch diagram",
                scope=ScopeCapsule(space_ids=(space.id,)),
                quality_mode=QualityMode.QUALITY,
                modalities=(Modality.IMAGE,),
            )
        )
        image_channel = next(item for item in pack.channels if item.channel == "image")
        assert image_channel.status == "completed"
        assert image_channel.native_modality is True
        assert any(hit.evidence.modality == Modality.IMAGE for hit in pack.hits)
    finally:
        nexus.database.engine.dispose()
