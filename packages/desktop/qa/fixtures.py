"""Generate versioned, synthetic desktop acceptance inputs using the bundled tools."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

import openpyxl
import pymupdf


def create(output, runtime):
    output.mkdir(parents=True, exist_ok=False)
    with pymupdf.open() as pdf:
        for title in ["Tessmora acceptance manual", "Recovery code: CEDAR-17"]:
            pdf.new_page().insert_text((72, 90), title)
        pdf.save(output / "manual.pdf", no_new_id=True)
    workbook = openpyxl.Workbook()
    workbook.active["B2"] = 17
    workbook.properties.created = workbook.properties.modified = datetime(2020, 1, 1)
    tmp = io.BytesIO()
    workbook.save(tmp)
    with zipfile.ZipFile(tmp) as source, zipfile.ZipFile(output / "counts.xlsx", "w") as target:
        for name in sorted(source.namelist()):
            content = source.read(name)
            if name == "docProps/core.xml":
                import re
                content = re.sub(rb'(<dcterms:modified[^>]*>)[^<]*', rb'\g<1>2020-01-01T00:00:00Z', content)
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            target.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED)
    manifest = json.loads((runtime / "runtime.json").read_text("utf-8"))
    ffmpeg = runtime / manifest["executables"]["ffmpeg"]
    def run(*args):
        subprocess.run([str(ffmpeg), "-v", "error", "-nostdin", *map(str, args)], check=True)
    video = output / "recording.mp4"
    run("-f", "lavfi", "-i", "color=black:size=320x180:rate=10:duration=12",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
        "-vf", "drawbox=x=110:y=50:w=100:h=80:color=blue:t=fill:enable='gte(t,6)*lt(t,8)'",
        "-af", "volume=0:enable='lt(t,6)+gte(t,8)'", "-c:v", "libx264", "-threads", 1,
        "-c:a", "aac", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video)
    run("-ss", 7, "-i", video, "-frames:v", 1, "-threads", 1, output / "blue-marker.png")
    run("-i", video, "-map", "0:a:0", "-c:a", "pcm_s16le", output / "tone.wav")
    (output / "attachment").mkdir()
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 90), "Chat attachment only: WIND-21")
        pdf.save(output / "attachment/manual.pdf", no_new_id=True)
    with pymupdf.open(output / "manual.pdf") as pdf:
        assert len(pdf) == 2 and "CEDAR-17" in pdf[1].get_text()
    assert openpyxl.load_workbook(output / "counts.xlsx", read_only=True).active["B2"].value == 17
    files = sorted(p for p in output.rglob("*") if p.is_file())
    records = [{"path": p.relative_to(output).as_posix(), "bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
    (output / "manifest.json").write_text(json.dumps({"format": 1, "files": records,
        "reference": {"manualPage": 2, "manualPhrase": "CEDAR-17", "sheetCell": "B2", "sheetValue": 17,
                      "videoSeconds": [6, 8], "frameSecond": 7, "toneHz": 440}}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    args = parser.parse_args()
    create(args.output, args.runtime.resolve())
