"""Small, bounded local inspections; model observations must not override these facts."""
from __future__ import annotations

import io
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


def inspect_attachment_media(data: bytes, kind: str, *, max_video_seconds: float | None = 60,
                             probe_timeout: float | None = 10) -> dict:
    if kind == "image":
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            image.verify()
        return {"width": width, "height": height, "source": "local_probe"}
    # ffprobe checks actual tracks/container, not the extension or supplied MIME.
    with tempfile.TemporaryDirectory(prefix="chat-audio-") as directory:
        path = Path(directory) / "media"
        path.write_bytes(data)
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=codec_type,duration,sample_rate,channels,width,height", "-of", "json", str(path)],
            capture_output=True, timeout=probe_timeout, check=True,
        )
        info = json.loads(result.stdout)
    streams = info.get("streams") or []
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if kind == "video":
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        if not video:
            raise ValueError("附件中没有可解析的视频画面")
        duration = float(video.get("duration") or info.get("format", {}).get("duration") or 0)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("无法核验视频时长")
        if max_video_seconds is not None and duration > max_video_seconds:
            raise ValueError(f"本机视频需在 {max_video_seconds:g} 秒以内，较长视频请加入知识库后引用")
        return {"duration_seconds": round(duration, 3), "width": int(video.get("width") or 0),
                "height": int(video.get("height") or 0), "has_audio": bool(audio), "source": "local_probe"}
    if not audio:
        raise ValueError("附件中没有可解析的音轨")
    duration = float(audio.get("duration") or info.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("无法核验音频时长")
    return {"duration_seconds": round(duration, 3), "sample_rate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0), "source": "local_probe"}


def sample_video(data: bytes, media_info: dict) -> tuple[list[tuple[float, bytes]], bytes | None]:
    """Six timestamped frames plus a bounded mono audio track; originals are never ingested."""
    duration = media_info["duration_seconds"]
    frames = []
    audio = None
    with tempfile.TemporaryDirectory(prefix="chat-video-") as directory:
        path = Path(directory) / "media"
        path.write_bytes(data)
        count = min(6, max(1, math.ceil(duration)))
        for index in range(count):
            # Sample within each interval, not at EOF (the final frame may precede duration).
            second = round(duration * index / count, 3)
            result = subprocess.run([
                "ffmpeg", "-v", "error", "-ss", str(second), "-i", str(path), "-frames:v", "1",
                "-vf", "scale=768:768:force_original_aspect_ratio=decrease", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
            ], capture_output=True, timeout=10, check=True)
            if result.stdout:
                frames.append((second, result.stdout))
        if not frames:
            raise ValueError("无法提取视频画面")
        if media_info.get("has_audio"):
            audio_path = Path(directory) / "audio.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000",
                            "-t", "60", str(audio_path)], capture_output=True, timeout=15, check=True)
            audio = audio_path.read_bytes()
    return frames, audio


def audio_input_format(data: bytes) -> str:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE": return "wav"
    if data[:4] == b"fLaC": return "flac"
    if data[:4] == b"OggS": return "ogg"
    if data[4:8] == b"ftyp": return "mp4"
    if data[:4] == b"\x1aE\xdf\xa3": return "webm"
    return "mp3"


def validate_audio_observation(summary: str, media_info: dict) -> None:
    """Reject impossible timestamps/durations rather than forwarding them as evidence."""
    duration = media_info["duration_seconds"]
    upper = duration + max(.75, duration * .02)
    # Speech can legitimately mention a 60-second experiment in an 8-second clip.
    # Inspect claims about this recording, not every time quantity in its transcript.
    claimed = [float(value) for value in re.findall(
        r"(?:时长|全长|总长|长约|长达|一段约|音频约|音频共|duration)\s*(?:为|是|约|大约|为约)?\s*"
        r"(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b)", summary, re.I)]
    # A spoken clock time such as "14:00 开会" is content, not a media offset.
    # Only check timestamp spans explicitly attached to the recording's timeline.
    stamp_pattern = r"(?<!\d)(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?(?!\d)"
    timeline_pattern = (
        r"(?:开头|结尾|尾声|尾段|末尾|最后|时间戳|时间段|timestamp|timecode|"
        r"(?:音频|录音|音乐|片段)(?:在|的)?|播放(?:到|至))\s*[:：]?\s*("
        + stamp_pattern + r"(?:\s*[-–—~～至到]\s*" + stamp_pattern + r")?)"
    )
    for span in re.findall(timeline_pattern, summary, re.I):
        for stamp in re.findall(stamp_pattern, span):
            seconds = 0.0
            for value in stamp.split(":"): seconds = seconds * 60 + float(value)
            claimed.append(seconds)
    if any(value > upper for value in claimed):
        raise ValueError("模型解析中的时间超出实际音频时长")
