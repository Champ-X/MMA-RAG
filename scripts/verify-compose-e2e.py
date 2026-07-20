#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import time
import uuid
import wave
from pathlib import Path

import httpx
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas


TERMINAL_RUNS = {"completed", "partial", "failed", "cancelled", "paused"}
TERMINAL_JOBS = {"completed", "failed", "cancelled"}


def _png() -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", (640, 360), color=(238, 243, 241))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, 600, 320), fill=(22, 92, 73))
    draw.text((105, 155), "PROJECT ORION ARCHITECTURE", fill="white", stroke_width=1)
    image.save(output, format="PNG")
    return output.getvalue()


def _wav() -> bytes:
    phrase = "Project Orion meeting confirms mission code Echo Seventeen."
    espeak = shutil.which("espeak-ng")
    if espeak:
        return subprocess.run(
            [espeak, "--stdout", "-s", "145", phrase],
            check=True,
            capture_output=True,
        ).stdout
    docker = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
    container = subprocess.run(
        [
            docker,
            "ps",
            "--filter",
            "label=com.docker.compose.service=api",
            "--format",
            "{{.ID}}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip().splitlines()
    if container:
        return subprocess.run(
            [docker, "exec", container[0], "espeak-ng", "--stdout", "-s", "145", phrase],
            check=True,
            capture_output=True,
        ).stdout
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\x00\x00" * 8000)
    return output.getvalue()


def _mp4() -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        docker = shutil.which("docker") or "/Applications/Docker.app/Contents/Resources/bin/docker"
        container = subprocess.run(
            [
                docker,
                "ps",
                "--filter",
                "label=com.docker.compose.service=api",
                "--format",
                "{{.ID}}",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip().splitlines()
        if not container:
            raise RuntimeError("ffmpeg is unavailable and no Compose API container is running")
        generated = subprocess.run(
            [
                docker,
                "exec",
                container[0],
                "ffmpeg",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x165c49:s=160x90:d=1",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "frag_keyframe+empty_moov",
                "-f",
                "mp4",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        )
        return generated.stdout
    with tempfile.TemporaryDirectory(prefix="nexus-e2e-video-") as directory:
        path = Path(directory) / "orion-demo.mp4"
        subprocess.run(
            [
                ffmpeg,
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x165c49:s=160x90:d=1",
                "-pix_fmt",
                "yuv420p",
                "-y",
                str(path),
            ],
            check=True,
        )
        return path.read_bytes()


def _pdf() -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output)
    document.drawString(72, 760, "Project Orion release date is 2026-11-05.")
    document.drawString(72, 736, "The validated launch allocation is 420000 USD.")
    document.showPage()
    document.save()
    return output.getvalue()


class NexusE2E:
    def __init__(self, base_url: str, *, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(min(timeout, 300), connect=30),
            follow_redirects=True,
        )
        self.timeout = timeout

    def close(self) -> None:
        self.client.close()

    @staticmethod
    def _expect(response: httpx.Response, *codes: int) -> dict[str, object]:
        if response.status_code not in codes:
            raise AssertionError(
                f"{response.request.method} {response.request.url}: "
                f"expected {codes}, got {response.status_code}: {response.text[:1000]}"
            )
        return response.json()

    def _poll(self, path: str, *, terminal: set[str]) -> dict[str, object]:
        deadline = time.monotonic() + self.timeout
        last: dict[str, object] = {}
        while time.monotonic() < deadline:
            last = self._expect(self.client.get(path), 200)
            status = str(last.get("status"))
            if status in terminal:
                return last
            time.sleep(0.5)
        raise AssertionError(f"Timed out polling {path}; last state: {last}")

    def upload(
        self, space_id: str, *, filename: str, content: bytes, mime_type: str
    ) -> dict[str, object]:
        payload = self._expect(
            self.client.post(
                "/api/v1/sources/upload",
                data={"space_id": space_id},
                files={"file": (filename, content, mime_type)},
                headers={"Idempotency-Key": f"e2e:{space_id}:{hashlib.sha256(content).hexdigest()}"},
            ),
            202,
        )
        job = payload["job"]
        assert isinstance(job, dict)
        completed = self._poll(
            f"/api/v1/ingestion-jobs/{job['id']}", terminal=TERMINAL_JOBS
        )
        if completed["status"] != "completed":
            raise AssertionError(f"Ingestion failed for {filename}: {completed}")
        source = payload["source_version"]
        assert isinstance(source, dict)
        payload["job"] = completed
        payload["source_version"] = self._expect(
            self.client.get(f"/api/v1/source-versions/{source['id']}"), 200
        )
        return payload

    def run(self, *, mineru: bool) -> dict[str, object]:
        ready = self._expect(self.client.get("/health/ready"), 200)
        assert ready == {"status": "ready", "control_ready": True}
        initial_system = self._expect(self.client.get("/api/v1/system/health"), 200)
        mineru_health = initial_system["capabilities"]["mineru"]
        suffix = uuid.uuid4().hex[:10]
        space = self._expect(
            self.client.post(
                "/api/v1/spaces",
                json={"name": f"Compose E2E {suffix}", "slug": f"compose-e2e-{suffix}"},
                headers={"Idempotency-Key": f"compose-space-{suffix}"},
            ),
            201,
        )
        space_id = str(space["id"])
        fixtures = [
            (
                "orion-strategy.md",
                b"# Orion Strategy\n\nProject Orion launches on 2026-11-05 for enterprise teams.",
                "text/markdown",
            ),
            (
                "orion-budget.md",
                b"# Orion Budget\n\nProject Orion has a 420000 USD validated launch allocation.",
                "text/markdown",
            ),
            ("orion-metrics.csv", b"Metric,Value\nPilot seats,42\n", "text/csv"),
            ("orion-architecture.png", _png(), "image/png"),
            ("orion-meeting.wav", _wav(), "audio/wav"),
            ("orion-demo.mp4", _mp4(), "video/mp4"),
        ]
        uploads = [
            self.upload(
                space_id,
                filename=filename,
                content=content,
                mime_type=mime_type,
            )
            for filename, content, mime_type in fixtures
        ]
        mineru_verified: bool | str = False
        if mineru and mineru_health["status"] == "ready":
            uploads.append(
                self.upload(
                    space_id,
                    filename="orion-brief.pdf",
                    content=_pdf(),
                    mime_type="application/pdf",
                )
            )
            mineru_verified = True
        elif mineru:
            detail = mineru_health["detail"]
            assert detail.get("status") == "expired", mineru_health
            pdf_content = _pdf()
            failed_upload = self._expect(
                self.client.post(
                    "/api/v1/sources/upload",
                    data={"space_id": space_id},
                    files={"file": ("orion-brief.pdf", pdf_content, "application/pdf")},
                    headers={"Idempotency-Key": f"e2e:{space_id}:expired-mineru"},
                ),
                202,
            )
            failed_job = self._poll(
                f"/api/v1/ingestion-jobs/{failed_upload['job']['id']}",
                terminal=TERMINAL_JOBS,
            )
            assert failed_job["status"] == "failed"
            assert failed_job["error_code"] == "CAPABILITY_UNAVAILABLE"
            failed_source = failed_upload["source_version"]
            retained = self.client.get(f"/api/v1/assets/{failed_source['id']}")
            assert retained.status_code == 200 and retained.content == pdf_content
            mineru_verified = "expired_token_detected_raw_retained"

        evidence_page = self._expect(
            self.client.get("/api/v1/evidence", params={"space_id": space_id, "limit": 200}),
            200,
        )
        evidence = evidence_page["items"]
        assert isinstance(evidence, list) and evidence
        modalities = {str(item["modality"]) for item in evidence if isinstance(item, dict)}
        assert {"text", "table", "image", "audio", "video"} <= modalities
        if mineru_verified is True:
            pdf_upload = next(
                item for item in uploads if item["source_version"]["display_name"] == "orion-brief.pdf"
            )
            capabilities = pdf_upload["source_version"]["capabilities"]
            assert capabilities["parse_structure"] == "ready"

        deadline = time.monotonic() + 30
        index_health: dict[str, object] = {}
        while time.monotonic() < deadline:
            index_health = self._expect(self.client.get("/api/v1/system/indexes"), 200)
            if (
                index_health.get("status") == "ready"
                and len(index_health.get("aliases", {})) == 4
                and index_health.get("native_multimodal") is True
            ):
                break
            time.sleep(0.5)
        assert index_health.get("status") == "ready"
        assert index_health.get("native_multimodal") is True, index_health

        golden_cases = [
            ("Project Orion validated launch allocation 420000", "text", "orion-budget.md"),
            ("Pilot seats 42", "table", "orion-metrics.csv"),
            ("green Project Orion architecture diagram", "image", "orion-architecture.png"),
            ("mission code Echo Seventeen", "audio", "orion-meeting.wav"),
            ("green Project Orion demonstration video", "video", "orion-demo.mp4"),
        ]
        golden_results: list[dict[str, object]] = []
        reciprocal_rank = 0.0
        for query, modality, expected_source in golden_cases:
            result = self._expect(
                self.client.post(
                    "/api/v1/search",
                    json={
                        "query": query,
                        "scope": {"space_ids": [space_id]},
                        "quality_mode": "deep",
                        "modalities": [modality],
                        "limit": 5,
                    },
                ),
                200,
            )
            ranked_sources = [item["evidence"]["source_name"] for item in result["hits"]]
            assert expected_source in ranked_sources, (query, ranked_sources)
            rank = ranked_sources.index(expected_source) + 1
            reciprocal_rank += 1.0 / rank
            golden_results.append(
                {"query": query, "modality": modality, "expected": expected_source, "rank": rank}
            )
        golden_mrr = reciprocal_rank / len(golden_cases)
        assert golden_mrr >= 0.9, golden_results

        search = self._expect(
            self.client.post(
                "/api/v1/search",
                json={
                    "query": "Project Orion validated launch allocation 420000",
                    "scope": {"space_ids": [space_id]},
                    "quality_mode": "deep",
                    "limit": 20,
                },
            ),
            200,
        )
        assert search["hits"]
        channels = {item["channel"]: item["status"] for item in search["channels"]}
        assert channels["exact"] == "completed"
        assert channels["text_dense"] == "completed"
        assert channels["text_sparse"] == "completed"
        assert channels["image"] == "completed"
        assert channels["audio"] == "completed"
        assert channels["video"] == "completed"
        assert channels["reranker"] == "completed"

        quick_created = self._expect(
            self.client.post(
                "/api/v1/runs",
                headers={"Idempotency-Key": f"quick-{suffix}"},
                json={
                    "goal": "What is Project Orion's validated launch allocation?",
                    "kind": "quick",
                    "scope": {"space_ids": [space_id]},
                },
            ),
            202,
        )
        quick = self._poll(f"/api/v1/runs/{quick_created['id']}", terminal=TERMINAL_RUNS)
        assert quick["status"] == "completed"
        assert quick["result"]["verification_status"] == "supported"
        assert quick["result"]["verification_level"] == "T3"
        assert quick["result"]["citations"]
        snapshot = self._expect(self.client.get(f"/api/v1/runs/{quick['id']}/snapshot"), 200)
        assert snapshot["snapshot"]["models"]["gateway"]
        knowledge_tool = self._expect(
            self.client.post(
                f"/api/v1/runs/{quick['id']}/tools/knowledge_search/execute",
                json={
                    "payload": {
                        "query": "Project Orion validated launch allocation",
                        "limit": 5,
                    },
                    "idempotency_key": f"e2e-knowledge-search-{suffix}",
                },
            ),
            200,
        )
        assert knowledge_tool["status"] == "completed"
        assert knowledge_tool["output_payload"]["hits"]
        sql_tool = self._expect(
            self.client.post(
                f"/api/v1/runs/{quick['id']}/tools/sql_read/execute",
                json={
                    "payload": {
                        "query": "SELECT SUM(value) AS total FROM input",
                        "rows": [{"value": 19}, {"value": 23}],
                    },
                    "idempotency_key": f"e2e-sql-read-{suffix}",
                },
            ),
            200,
        )
        assert sql_tool["status"] == "completed"
        assert sql_tool["output_payload"]["rows"] == [[42]]

        research_created = self._expect(
            self.client.post(
                "/api/v1/runs",
                headers={"Idempotency-Key": f"research-{suffix}"},
                json={
                    "goal": "Research Project Orion launch assumptions and validated allocation",
                    "kind": "research",
                    "scope": {"space_ids": [space_id]},
                },
            ),
            202,
        )
        research = self._poll(
            f"/api/v1/runs/{research_created['id']}", terminal=TERMINAL_RUNS
        )
        assert research["status"] == "completed"
        assert research["result"]["verification_level"] == "T3"
        artifact_id = research["result"]["artifact_id"]

        events = self._expect(
            self.client.get(f"/api/v1/runs/{research['id']}/events", params={"stream": "false"}),
            200,
        )["items"]
        sequences = [item["sequence"] for item in events]
        assert sequences == sorted(set(sequences)) and len(sequences) >= 4
        replay = self._expect(
            self.client.get(
                f"/api/v1/runs/{research['id']}/events",
                params={"stream": "false", "after": sequences[0]},
            ),
            200,
        )["items"]
        assert replay and all(item["sequence"] > sequences[0] for item in replay)
        with self.client.stream(
            "GET", f"/api/v1/runs/{research['id']}/events", params={"after": 0}
        ) as stream:
            assert stream.status_code == 200
            sse = "".join(stream.iter_text())
        assert "event: run." in sse and "id: 1" in sse

        canonical_response = self.client.get(
            f"/api/v1/artifacts/{artifact_id}/render", params={"format": "json"}
        )
        canonical = self._expect(canonical_response, 200)
        assert canonical["schema"] == "nexus.block-document.v1"
        markdown = self.client.get(
            f"/api/v1/artifacts/{artifact_id}/render", params={"format": "markdown"}
        )
        assert markdown.status_code == 200 and markdown.text.startswith("# Research")
        pdf = self.client.get(
            f"/api/v1/artifacts/{artifact_id}/render", params={"format": "pdf"}
        )
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        canonical["blocks"].append(
            {"type": "paragraph", "text": "E2E reviewer note.", "origin": "user"}
        )
        revised = self._expect(
            self.client.patch(
                f"/api/v1/artifacts/{artifact_id}",
                json={"expected_revision_no": 1, "canonical_document": canonical},
            ),
            200,
        )
        assert revised["revision_no"] == 2

        first_source = uploads[0]["source_version"]
        ranged = self.client.get(
            f"/api/v1/assets/{first_source['id']}", headers={"Range": "bytes=0-7"}
        )
        assert ranged.status_code == 206 and ranged.content == fixtures[0][1][:8]
        system = self._expect(self.client.get("/api/v1/system/health"), 200)
        assert system["control_ready"] is True
        assert system["capabilities"]["mineru"]["detail"]["token_configured"] is True
        assert system["capabilities"]["workers"]["detail"]["worker_count"] >= 3
        assert self._expect(self.client.get("/api/v1/tools"), 200)["items"]

        mcp = self._expect(
            self.client.post(
                "/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "knowledge_search",
                        "arguments": {"query": "Orion 420000", "space_ids": [space_id]},
                    },
                },
            ),
            200,
        )
        assert mcp["result"]["structuredContent"]["hits"]

        connector = self._expect(
            self.client.post(
                "/api/v1/connectors/sync",
                json={
                    "kind": "markdown",
                    "space_id": space_id,
                    "title": "e2e-connector.md",
                    "content": "# Connector\n\nRaw-first connector contract value is 73.",
                },
            ),
            202,
        )
        assert connector["items"][0]["source_version"]["connector_kind"] == "markdown"

        return {
            "status": "passed",
            "space_id": space_id,
            "sources": len(uploads),
            "evidence": len(evidence),
            "modalities": sorted(modalities),
            "search_channels": channels,
            "native_roles": index_health.get("projection_role_counts", {}),
            "golden_mrr": golden_mrr,
            "golden_cases": golden_results,
            "tools_verified": ["knowledge_search", "sql_read"],
            "quick_run_id": quick["id"],
            "research_run_id": research["id"],
            "artifact_id": artifact_id,
            "artifact_revision": revised["revision_no"],
            "sse_events": len(sequences),
            "mineru_verified": mineru_verified,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=1200)
    parser.add_argument("--mineru", action="store_true")
    args = parser.parse_args()
    verifier = NexusE2E(args.base_url, timeout=args.timeout)
    try:
        result = verifier.run(mineru=args.mineru)
    finally:
        verifier.close()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
