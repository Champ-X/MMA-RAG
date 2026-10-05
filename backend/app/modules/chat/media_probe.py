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


def inspect_attachment_media(data: bytes, kind: str) -> dict:
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
             "format=duration:stream=codec_type,duration,sample_rate,channels", "-of", "json", str(path)],
            capture_output=True, timeout=10, check=True,
        )
        info = json.loads(result.stdout)
    streams = info.get("streams") or []
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if not audio:
        raise ValueError("附件中没有可解析的音轨")
    duration = float(audio.get("duration") or info.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("无法核验音频时长")
    return {"duration_seconds": round(duration, 3), "sample_rate": int(audio.get("sample_rate") or 0),
            "channels": int(audio.get("channels") or 0), "source": "local_probe"}


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
