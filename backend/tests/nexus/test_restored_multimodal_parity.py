from __future__ import annotations

import io
import shutil
import subprocess
import wave
from pathlib import Path

import pytest

from nexus.bootstrap import NexusContainer
from nexus.infrastructure.source_adapters import ParserRouter
from nexus.shared.domain.enums import Modality


def _long_wav(seconds: int = 65, sample_rate: int = 8_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\x00\x00" * sample_rate * seconds)
    return buffer.getvalue()


class _MediaAnalyzer:
    image_configured = True
    audio_configured = True
    ocr_configured = False

    def __init__(self) -> None:
        self.transcriptions: list[str] = []
        self.sequence_calls = 0

    @staticmethod
    def caption_image(content: bytes, **_: object) -> str:
        assert content
        return "A green frame with a visible synthetic timeline marker."

    def caption_image_sequence(self, frames: list[bytes], **_: object) -> str:
        assert frames and all(frames)
        self.sequence_calls += 1
        return "The ordered scene stays green while the timeline advances."

    def transcribe_audio(self, content: bytes, *, filename: str, **_: object) -> str:
        assert content.startswith(b"RIFF")
        transcript = f"transcript for {filename}"
        self.transcriptions.append(transcript)
        return transcript


def test_audio_uses_overlapping_segment_asr_without_transcript_duplication(
    nexus: NexusContainer,
) -> None:
    analyzer = _MediaAnalyzer()
    nexus.ingestion.parser = ParserRouter(media_analyzer=analyzer)
    space = nexus.spaces.create(name="Segmented audio", slug="segmented-audio")
    result = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="meeting.wav",
        content=_long_wav(),
        mime_type="audio/wav",
    )

    assert result.job.status == "completed"
    evidence, _ = nexus.control_plane.list_evidence(
        space_id=space.id,
        source_id=result.source_version.source_id,
        modality=Modality.AUDIO,
        cursor=None,
        limit=20,
    )
    assert len(evidence) == 3
    assert len(analyzer.transcriptions) == 3
    assert len({item.text_content for item in evidence}) == 3
    assert sorted(item.locator.start_ms for item in evidence) == [0, 28_000, 56_000]
    assert result.source_version.capabilities["asr"] == "ready"
    assert result.source_version.capabilities["vad"] == "ready"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_video_aligns_keyframes_temporal_summary_and_audio_track(
    nexus: NexusContainer, tmp_path: Path
) -> None:
    source = tmp_path / "timeline.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=green:s=320x180:r=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000",
            "-t",
            "3",
            "-c:v",
            "mpeg4",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        check=True,
        timeout=30,
    )
    analyzer = _MediaAnalyzer()
    nexus.ingestion.parser = ParserRouter(media_analyzer=analyzer)
    space = nexus.spaces.create(name="Video timeline", slug="video-timeline")
    result = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename=source.name,
        content=source.read_bytes(),
        mime_type="video/mp4",
    )

    assert result.job.status == "completed"
    assert analyzer.sequence_calls == 1
    assert result.source_version.capabilities["audio_track"] == "ready"
    assert result.source_version.capabilities["temporal_chapter"] == "ready"
    evidence, _ = nexus.control_plane.list_evidence(
        space_id=space.id,
        source_id=result.source_version.source_id,
        modality=None,
        cursor=None,
        limit=20,
    )
    assert {item.modality for item in evidence} == {Modality.VIDEO, Modality.AUDIO}
    scene = next(item for item in evidence if item.modality == Modality.VIDEO)
    assert "Temporal chapter:" in scene.text_content
    assert "Aligned audio:" in scene.text_content
    audio = next(item for item in evidence if item.modality == Modality.AUDIO)
    assert audio.locator.extra["audio_object_key"]
