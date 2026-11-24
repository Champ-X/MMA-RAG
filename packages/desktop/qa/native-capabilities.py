"""Exercise real offline media encoders and bundled Office conversion on synthetic inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    state = args.output / "state"
    state.mkdir()
    root = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(root / "backend"))
    manifest = json.loads((args.runtime / "runtime.json").read_text())
    office = (args.runtime / manifest["executables"]["office"]).resolve()
    os.environ.update({"TESSMORA_STATE_DIR": str(state.resolve()), "TESSMORA_RUNTIME_PROFILE": "desktop",
                       "HF_HOME": str(args.cache.resolve()), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "LIBREOFFICE_PATH": str(office), "PRELOAD_LOCAL_MODELS_ON_STARTUP": "false"})
    import numpy as np
    from app.core.local_models import LocalModelRuntime
    from app.modules.ingestion.service import IngestionService
    from app.modules.ingestion.parsers.mineru_client import office_to_pdf_bytes
    import pymupdf
    from docx import Document
    from pptx import Presentation
    from pptx.util import Inches
    runtime = LocalModelRuntime()
    service = IngestionService.__new__(IngestionService)
    service.local_models = runtime
    results = {"offline": True, "cloud_calls": 0, "python": sys.version.split()[0], "encoders": {}, "office": {}}

    def record(name, callback, dimension):
        started = time.perf_counter()
        vector = callback()
        assert len(vector) == dimension and all(math.isfinite(value) for value in vector)
        norm = float(np.linalg.norm(vector))
        assert abs(norm - 1.0) < 1e-4
        results["encoders"][name] = {"dimensions": dimension, "norm": norm, "seconds": round(time.perf_counter() - started, 3)}
        print(name, "passed", flush=True)
        return np.array(vector)

    image = (args.fixtures / "blue-marker.png").read_bytes()
    image_vector = record("clip_image", lambda: service._vectorize_clip_image_data_sync({"image_bytes": image}), 768)
    image_query = record("clip_text", lambda: runtime.encode_clip_text("a blue rectangle on a black background"), 768)
    audio = (args.fixtures / "tone.wav").read_bytes()
    audio_vector = record("clap_audio", lambda: service._extract_audio_clap_features(audio, "wav"), 512)
    audio_query = record("clap_text", lambda: runtime.encode_clap_text("An electronic sine wave tone"), 512)
    results["diagnostic_cosines"] = {"image_text": float(image_vector @ image_query), "audio_text": float(audio_vector @ audio_query)}
    results["models"] = runtime.snapshot()

    document = Document()
    document.add_heading("Tessmora Office acceptance", 0)
    document.add_paragraph("DOCX-CEDAR-17: 中文桌面验收")
    document.save(args.output / "sample.docx")
    slides = Presentation()
    slide = slides.slides.add_slide(slides.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2))
    box.text_frame.text = "PPTX-WIND-21: 中文桌面验收"
    slides.save(args.output / "sample.pptx")
    for extension, marker in (("docx", "DOCX-CEDAR-17"), ("pptx", "PPTX-WIND-21")):
        started = time.perf_counter()
        data = office_to_pdf_bytes((args.output / f"sample.{extension}").read_bytes(), extension)
        assert data and data.startswith(b"%PDF-")
        target = args.output / f"{extension}-preview.pdf"
        target.write_bytes(data)
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            text = "\n".join(page.get_text() for page in pdf)
            assert marker in text
            pdf[0].get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(args.output / f"{extension}-preview.png")
            chinese_regions = pdf[0].search_for("中文桌面验收")
            assert chinese_regions, "Chinese text did not survive PDF conversion"
            chinese_pixels = []
            for region in chinese_regions:
                crop = pdf[0].get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=region, colorspace=pymupdf.csGRAY)
                chinese_pixels.append(sum(value < 160 for value in crop.samples))
            assert all(count > 100 for count in chinese_pixels), "Chinese text exists but its glyphs are blank"
            results["office"][extension] = {"pages": len(pdf), "marker_retained": True,
                "chinese_text_retained": "中文桌面验收" in text, "bytes": len(data),
                "chinese_rendered_ink_pixels": chinese_pixels,
                "sha256": hashlib.sha256(data).hexdigest(), "seconds": round(time.perf_counter() - started, 3)}
        print(extension, "conversion passed", flush=True)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    results["process_peak_rss_bytes"] = peak if sys.platform == "darwin" else peak * 1024
    results["scope"] = "Real offline encoders and Office preview; not cloud generation, full RAG quality or cold download acceptance."
    (args.output / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"ok": True, "report": str(args.output / "report.json")}), flush=True)


if __name__ == "__main__":
    main()
