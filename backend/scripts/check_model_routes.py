"""Probe configured routes with synthetic inputs and no provider failover.

PYTHONPATH=backend .venv/bin/python backend/scripts/check_model_routes.py \
    --include-fallbacks --media --output /tmp/model-routes.json

Catalog discovery is read-only. Inference incurs the configured providers' usual
charges. No user documents, credentials or full model responses enter the report.
"""
from __future__ import annotations
import argparse
import asyncio
import base64
import io
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time
import wave

from app.core.llm.manager import llm_manager
from app.core.llm.models_catalog import ensure_llm_catalog_fresh, get_llm_catalog_status
from loguru import logger


def synthetic_media(directory: Path) -> dict:
    from PIL import Image
    image = io.BytesIO()
    Image.new("RGB", (128, 128), (220, 20, 20)).save(image, format="PNG")
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(b"".join(struct.pack("<h", int(2000 * math.sin(2 * math.pi * 440 * t / 16000))) for t in range(32000)))
    result = {"image": "data:image/png;base64," + base64.b64encode(image.getvalue()).decode(),
              "audio": base64.b64encode(audio.getvalue()).decode()}
    if shutil.which("ffmpeg"):
        video = directory / "probe.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
            "color=c=red:s=128x128:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)], check=True)
        result["video"] = str(video)
    return result


async def run(args) -> dict:
    r = llm_manager.registry
    logger.remove()
    await ensure_llm_catalog_fresh(r, force=True)
    routes = {task: {"model": r.get_task_model(task), "fallbacks": r.get_task_fallbacks(task)}
              for task in r._task_config}
    report = {"captured_at": time.time(), "catalog": get_llm_catalog_status(),
              "routes": routes, "probes": [], "scope": "synthetic connectivity; not answer quality"}
    probes = {}
    for task, route in routes.items():
        if args.tasks and task not in args.tasks:
            continue
        for model in [route["model"], *(route["fallbacks"] if args.include_fallbacks else [])]:
            if not model: continue
            kind = task if task in {"embedding", "reranking"} else "chat"
            probes.setdefault((model, kind), []).append(task)
            if args.media and task in {"image_captioning", "audio_transcription", "video_parsing"}:
                probes.setdefault((model, task), []).append(task)
    sem = asyncio.Semaphore(3)
    with tempfile.TemporaryDirectory(prefix="tessmora-model-probe-") as tmp:
        media = synthetic_media(Path(tmp)) if args.media else {}
        async def probe(model, kind, tasks):
            async with sem:
                messages = [{"role": "user", "content": "Reply with OK."}]
                method = "chat_completion"
                params = {"messages": messages, "max_tokens": 512, "timeout": args.timeout}
                if kind == "embedding":
                    method, params = "embed_texts", {"texts": ["model connectivity check"]}
                elif kind == "reranking":
                    method, params = "rerank", {"query": "apple", "documents": ["apple fruit", "blue sky"]}
                elif kind == "image_captioning":
                    messages[0]["content"] = [{"type": "text", "text": "Name the main color."},
                        {"type": "image_url", "image_url": {"url": media["image"]}}]
                elif kind == "audio_transcription":
                    messages[0]["content"] = [{"type": "text", "text": "Describe the sound. Do not invent speech."},
                        {"type": "input_audio", "input_audio": {"data": media["audio"], "format": "wav"}}]
                elif kind == "video_parsing":
                    if "video" not in media:
                        report["probes"].append({"model": model, "kind": kind, "success": None, "error": "ffmpeg unavailable"})
                        return
                    messages[0]["content"] = [{"type": "text", "text": "Describe the video color and sound briefly."},
                        {"type": "video_local", "path": media["video"], "fps": 1}]
                started = time.monotonic()
                try:
                    result = await asyncio.wait_for(llm_manager._call_with_model(method, model, params), args.timeout + 2)
                    row = {"model": model, "kind": kind, "tasks": tasks, "success": result.success,
                           "error_category": result.error_category, "status_code": result.status_code}
                    if result.success and method == "chat_completion":
                        choice = (result.data.get("choices") or [{}])[0]
                        row["has_content"] = bool(choice.get("message", {}).get("content"))
                        row["finish_reason"] = choice.get("finish_reason")
                        row["success"] = row["has_content"]
                    if result.success and kind == "embedding":
                        row["dimensions"] = len(result.data[0]) if result.data else 0
                        row["success"] = row["dimensions"] > 0
                    if result.success and kind == "reranking":
                        row["result_count"] = len(result.data)
                        row["success"] = row["result_count"] == 2
                except Exception as exc:
                    row = {"model": model, "kind": kind, "tasks": tasks, "success": False, "error_category": type(exc).__name__}
                row.update(seconds=round(time.monotonic() - started, 3),
                           catalog_presence=r.get_model_config(model).get("catalog_presence", "unknown"))
                report["probes"].append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)
        await asyncio.gather(*(probe(model, kind, tasks) for (model, kind), tasks in probes.items()))
    report["model_health"] = r.model_health.snapshot()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-fallbacks", action="store_true")
    parser.add_argument("--media", action="store_true")
    parser.add_argument("--tasks", nargs="+", choices=list(llm_manager.registry._task_config))
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = asyncio.run(run(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    raise SystemExit(0 if all(row["success"] is True for row in report["probes"]) else 1)


if __name__ == "__main__":
    main()
