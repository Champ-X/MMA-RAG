import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest


CLI_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills"
    / "mma-rag"
    / "scripts"
    / "mma_rag_cli.py"
)
SPEC = importlib.util.spec_from_file_location("mma_rag_cli", CLI_PATH)
assert SPEC and SPEC.loader
cli = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cli)


def test_validate_upload_path_accepts_supported_file_inside_root(tmp_path):
    source = tmp_path / "资料.pdf"
    source.write_bytes(b"pdf")

    result = cli.validate_upload_path(str(source), [tmp_path.resolve()])

    assert result == source.resolve()


def test_cli_timeout_defaults_are_relaxed():
    search_args = cli.build_parser().parse_args(["search", "--query", "回滚"])
    wait_args = cli.build_parser().parse_args(
        ["ingest", "wait", "--processing-id", "job-1"]
    )

    assert search_args.timeout == 360.0
    assert search_args.upload_timeout == 1800.0
    assert wait_args.wait_timeout == 5400.0


def test_validate_upload_path_rejects_file_outside_root(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"pdf")

    with pytest.raises(cli.CliError) as error:
        cli.validate_upload_path(str(outside), [allowed.resolve()])

    assert error.value.code == "PATH_NOT_ALLOWED"
    assert error.value.exit_code == cli.EXIT_USAGE


def test_execute_search_builds_stable_api_request():
    calls = []

    class FakeClient:
        def request_json(self, method, path, payload=None):
            calls.append((method, path, payload))
            return {"results": []}

    args = SimpleNamespace(
        command="search",
        query="回滚步骤",
        kb_ids=["kb-1"],
        file_ids=[],
        modalities=["doc", "video"],
        top_k=6,
    )

    command, data = cli.execute(args, FakeClient())

    assert command == "search"
    assert data == {"results": []}
    assert calls == [
        (
            "POST",
            "api/v1/retrieval/search",
            {
                "query": "回滚步骤",
                "knowledge_base_ids": ["kb-1"],
                "file_ids": [],
                "modalities": ["doc", "video"],
                "top_k": 6,
            },
        )
    ]


def test_upload_files_streams_multipart_to_local_api(tmp_path):
    source = tmp_path / "演示.mp4"
    source.write_bytes(b"video-bytes")
    received = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            received["path"] = self.path
            received["content_type"] = self.headers["Content-Type"]
            received["body"] = self.rfile.read(length)
            payload = json.dumps(
                {
                    "results": [
                        {"filename": "演示.mp4", "processing_id": "job-1", "status": "queued"}
                    ]
                }
            ).encode()
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = cli.ApiClient(
            f"http://127.0.0.1:{server.server_port}",
            timeout=2,
            upload_timeout=2,
        )
        response = client.upload_files("kb-1", [source])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert response["results"][0]["processing_id"] == "job-1"
    assert received["path"] == "/api/upload/batch/start"
    assert received["content_type"].startswith("multipart/form-data; boundary=")
    assert b'name="kb_id"' in received["body"]
    assert b"kb-1" in received["body"]
    assert b"video-bytes" in received["body"]


def test_compact_answer_removes_presigned_urls():
    compact = cli._compact_answer_payload(
        {
            "success": True,
            "sessionId": "session-1",
            "message": "答案",
            "citations": [
                {
                    "id": "1",
                    "file_name": "demo.mp4",
                    "content": "证据",
                    "video_url": "http://localhost:9000/signed",
                    "metadata": {
                        "shot_start_time": 1.2,
                        "shot_end_time": 3.4,
                        "presigned_url": "http://localhost:9000/signed",
                    },
                }
            ],
        }
    )

    assert compact["session_id"] == "session-1"
    assert compact["citations"][0]["metadata"] == {
        "shot_start_time": 1.2,
        "shot_end_time": 3.4,
    }
    assert "video_url" not in compact["citations"][0]


def test_main_outputs_json_when_service_is_unavailable(monkeypatch, capsys):
    def fail(*_args, **_kwargs):
        raise cli.CliError(
            "SERVICE_UNAVAILABLE",
            "not running",
            exit_code=cli.EXIT_UNAVAILABLE,
        )

    monkeypatch.setattr(cli.ApiClient, "request_json", fail)

    exit_code = cli.main(["health"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == cli.EXIT_UNAVAILABLE
    assert output["ok"] is False
    assert output["error"]["code"] == "SERVICE_UNAVAILABLE"
