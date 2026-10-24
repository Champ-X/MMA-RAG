"""Accurate video windows with one bounded, cancellation-safe lookahead."""

import asyncio
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
import os
from pathlib import Path
import tempfile
import time
from typing import AsyncIterator, Awaitable, Callable, Iterable, Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class VideoSegment:
    index: int
    start: float
    duration: float


@dataclass(frozen=True)
class PreparedVideoSegment:
    segment: VideoSegment
    path: Optional[str]
    preparation_seconds: float


def video_segments(duration: float, window: float, overlap: float) -> list[VideoSegment]:
    """Preserve the ingestion window/overlap contract, including the last window."""
    step = max(1.0, window - overlap)
    segments = []
    start = 0.0
    while start < duration:
        segments.append(VideoSegment(len(segments) + 1, start, min(window, duration - start)))
        start += step
    return segments


def segment_command(ffmpeg: str, source: str, start: float, duration: float, target: str) -> list[str]:
    # Input seeking jumps to a nearby keyframe. With transcoding, accurate_seek
    # decodes/discards the lead-in instead of retaining it as stream-copy would.
    # Output timestamps start at zero; audio stays on the same source timeline.
    return [
        ffmpeg, "-nostdin", "-y", "-loglevel", "error",
        "-ss", str(start), "-accurate_seek", "-i", source,
        "-t", str(duration), "-map", "0:v:0?", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-movflags", "+faststart", target,
    ]


def remove_segment(path: Optional[str]) -> None:
    if path:
        with suppress(OSError):
            os.unlink(path)


async def extract_segment(
    ffmpeg: str, source: str, start: float, duration: float, *, timeout: float = 120,
) -> Optional[str]:
    """Own the ffmpeg child until exit, also when timeout/cancellation interrupts it."""
    if duration <= 0 or not Path(source).is_file() or Path(source).stat().st_size == 0:
        return None
    fd, target = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    process = None
    keep = False
    try:
        process = await asyncio.create_subprocess_exec(
            *segment_command(ffmpeg, source, start, duration, target),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        if process.returncode != 0 or Path(target).stat().st_size == 0:
            logger.warning(
                "ffmpeg 切段失败 start={:.3f} dur={:.3f} returncode={}: {}",
                start, duration, process.returncode, (stderr or b"").decode(errors="replace")[-800:],
            )
            return None
        keep = True
        return target
    except asyncio.TimeoutError:
        logger.warning("ffmpeg 切段超时 start={:.3f} dur={:.3f}", start, duration)
        return None
    except (OSError, ValueError) as error:
        logger.warning("ffmpeg 切段异常 start={:.3f} dur={:.3f}: {}", start, duration, error)
        return None
    finally:
        # Cancelling to_thread(subprocess.run) leaves the encoder running and can
        # leak its eventual output. Own an async subprocess so cancellation can
        # reap it before the caller removes the source video.
        try:
            if process is not None and process.returncode is None:
                with suppress(ProcessLookupError):
                    process.kill()
                await process.communicate()
        finally:
            if not keep:
                remove_segment(target)


@asynccontextmanager
async def prefetch_segments(
    segments: Iterable[VideoSegment],
    extract: Callable[[VideoSegment], Awaitable[Optional[str]]],
) -> AsyncIterator[AsyncIterator[PreparedVideoSegment]]:
    """At most the consumed file plus one lookahead; never parallel model calls.

    The context owns both files and closes the producer on normal completion,
    early exit, exception and cancellation. The source must outlive the context.
    """
    async def prepare(segment: VideoSegment) -> PreparedVideoSegment:
        started = time.perf_counter()
        path = await extract(segment)
        return PreparedVideoSegment(segment, path, time.perf_counter() - started)

    async def iterate() -> AsyncIterator[PreparedVideoSegment]:
        iterator = iter(segments)
        first = next(iterator, None)
        if first is None:
            return
        pending = asyncio.create_task(prepare(first), name="video-segment-prepare")
        try:
            while pending is not None:
                prepared = await pending
                pending = None
                following = next(iterator, None)
                if following is not None:
                    pending = asyncio.create_task(prepare(following), name="video-segment-prefetch")
                try:
                    yield prepared
                finally:
                    remove_segment(prepared.path)
        finally:
            if pending is not None:
                pending.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    leftover = await pending
                    remove_segment(leftover.path)

    stream = iterate()
    try:
        yield stream
    finally:
        await stream.aclose()
