#!/usr/bin/env python3
"""Dependency-free local CLI for MMA-RAG's HTTP API."""

from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import re
import ssl
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen


SCHEMA_VERSION = "1"
DEFAULT_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_TIMEOUT = 360.0
DEFAULT_UPLOAD_TIMEOUT = 1800.0
DEFAULT_INGEST_WAIT_TIMEOUT = 5400.0
ALLOWED_EXTENSIONS = {
    "pdf", "docx", "doc", "pptx", "txt", "md",
    "xlsx", "xls", "csv",
    "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif",
    "mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "opus",
    "mp4", "avi", "mov", "mkv", "webm", "flv", "wmv", "m4v",
}
SENSITIVE_PARTS = {".ssh", ".aws", ".gnupg", ".kube"}
SENSITIVE_NAMES = {
    ".env", ".env.local", ".env.production", "id_rsa", "id_ed25519",
    "credentials", "credentials.json", "service-account.json",
}

EXIT_USAGE = 2
EXIT_UNAVAILABLE = 3
EXIT_API = 4
EXIT_JOB_FAILED = 5
EXIT_TIMEOUT = 6


class CliError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_API,
        status: Optional[int] = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.status = status
        self.details = details


def _json_loads(raw: bytes) -> Any:
    if not raw:
        return {}
    text = raw.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        detail = payload.get("detail") or payload.get("error") or payload.get("message")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        if isinstance(detail, list):
            messages = []
            for item in detail:
                if isinstance(item, dict) and item.get("msg"):
                    messages.append(str(item["msg"]))
            if messages:
                return "; ".join(messages)
    return fallback


class ApiClient:
    def __init__(self, base_url: str, timeout: float, upload_timeout: float) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        parsed = urlsplit(self.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise CliError(
                "INVALID_BASE_URL",
                "MMA-RAG base URL must be an http(s) URL",
                exit_code=EXIT_USAGE,
                details={"base_url": base_url},
            )
        self.timeout = timeout
        self.upload_timeout = upload_timeout

    def request_json(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = urljoin(self.base_url, path.lstrip("/"))
        data = None
        headers = {
            "Accept": "application/json",
            "User-Agent": "mma-rag-codex-cli/1",
        }
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return _json_loads(response.read())
        except HTTPError as error:
            body = _json_loads(error.read())
            raise CliError(
                "API_ERROR",
                _error_message(body, f"MMA-RAG returned HTTP {error.code}"),
                status=error.code,
                details=body,
            ) from error
        except (URLError, TimeoutError, ConnectionError, OSError) as error:
            raise CliError(
                "SERVICE_UNAVAILABLE",
                f"MMA-RAG is not reachable at {self.base_url.rstrip('/')}",
                exit_code=EXIT_UNAVAILABLE,
                details={"reason": str(error)},
            ) from error

    def upload_files(self, kb_id: str, paths: Sequence[Path]) -> Any:
        boundary = f"----mma-rag-{uuid.uuid4().hex}"
        field_parts = [_form_field(boundary, "kb_id", kb_id)]
        file_parts = [
            (
                _file_preamble(boundary, path),
                path,
                b"\r\n",
            )
            for path in paths
        ]
        closing = f"--{boundary}--\r\n".encode("ascii")
        content_length = sum(len(part) for part in field_parts) + len(closing)
        for preamble, path, suffix in file_parts:
            content_length += len(preamble) + path.stat().st_size + len(suffix)

        url = urlsplit(urljoin(self.base_url, "api/upload/batch/start"))
        target = url.path or "/"
        if url.query:
            target = f"{target}?{url.query}"
        connection_cls = (
            http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
        )
        connection_kwargs: Dict[str, Any] = {"timeout": self.upload_timeout}
        if url.scheme == "https":
            connection_kwargs["context"] = ssl.create_default_context()
        connection = connection_cls(url.hostname, url.port, **connection_kwargs)

        try:
            connection.putrequest("POST", target)
            connection.putheader("Accept", "application/json")
            connection.putheader("User-Agent", "mma-rag-codex-cli/1")
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(content_length))
            connection.endheaders()
            for part in field_parts:
                connection.send(part)
            for preamble, path, suffix in file_parts:
                connection.send(preamble)
                with path.open("rb") as stream:
                    while True:
                        chunk = stream.read(1024 * 1024)
                        if not chunk:
                            break
                        connection.send(chunk)
                connection.send(suffix)
            connection.send(closing)
            response = connection.getresponse()
            body = _json_loads(response.read())
            if response.status >= 400:
                raise CliError(
                    "API_ERROR",
                    _error_message(body, f"MMA-RAG returned HTTP {response.status}"),
                    status=response.status,
                    details=body,
                )
            return body
        except CliError:
            raise
        except (TimeoutError, ConnectionError, OSError, http.client.HTTPException) as error:
            raise CliError(
                "SERVICE_UNAVAILABLE",
                f"MMA-RAG is not reachable at {self.base_url.rstrip('/')}",
                exit_code=EXIT_UNAVAILABLE,
                details={"reason": str(error)},
            ) from error
        finally:
            connection.close()


def _form_field(boundary: str, name: str, value: str) -> bytes:
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
        f"{value}\r\n"
    ).encode("utf-8")


def _file_preamble(boundary: str, path: Path) -> bytes:
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", path.name) or "uploaded_file"
    encoded_name = quote(path.name, safe="")
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="{ascii_name}"; '
        f"filename*=UTF-8''{encoded_name}\r\n"
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")


def _split_roots(raw: str) -> List[str]:
    if not raw.strip():
        return []
    separators = "," if "," in raw else os.pathsep
    return [part.strip() for part in raw.split(separators) if part.strip()]


def _allowed_roots(explicit_roots: Sequence[str]) -> List[Path]:
    configured = list(explicit_roots)
    configured.extend(_split_roots(os.getenv("MMA_RAG_ALLOWED_ROOTS", "")))
    if not configured:
        home = Path.home()
        configured = [
            str(Path.cwd()),
            str(home / "Desktop"),
            str(home / "Documents"),
            str(home / "Downloads"),
        ]
    roots: List[Path] = []
    for raw in configured:
        try:
            root = Path(raw).expanduser().resolve(strict=False)
        except OSError:
            continue
        if root not in roots:
            roots.append(root)
    return roots


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_upload_path(raw_path: str, roots: Sequence[Path]) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        raise CliError(
            "PATH_NOT_ABSOLUTE",
            "Upload paths must be absolute",
            exit_code=EXIT_USAGE,
            details={"path": raw_path},
        )
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise CliError(
            "FILE_NOT_FOUND",
            f"Upload file does not exist: {raw_path}",
            exit_code=EXIT_USAGE,
        ) from error
    if not resolved.is_file():
        raise CliError(
            "NOT_A_FILE",
            f"Upload path is not a regular file: {raw_path}",
            exit_code=EXIT_USAGE,
        )
    if not any(_is_relative_to(resolved, root) for root in roots):
        raise CliError(
            "PATH_NOT_ALLOWED",
            "Upload file is outside MMA_RAG_ALLOWED_ROOTS",
            exit_code=EXIT_USAGE,
            details={"path": str(resolved), "allowed_roots": [str(root) for root in roots]},
        )
    lowered_parts = {part.lower() for part in resolved.parts}
    if lowered_parts & SENSITIVE_PARTS or resolved.name.lower() in SENSITIVE_NAMES:
        raise CliError(
            "SENSITIVE_FILE",
            "Refusing to upload a common credential or secret file",
            exit_code=EXIT_USAGE,
            details={"path": str(resolved)},
        )
    extension = resolved.suffix.lower().lstrip(".")
    if extension not in ALLOWED_EXTENSIONS:
        raise CliError(
            "UNSUPPORTED_FILE_TYPE",
            f"Unsupported upload file type: {extension or 'unknown'}",
            exit_code=EXIT_USAGE,
            details={"path": str(resolved)},
        )
    if resolved.stat().st_size <= 0:
        raise CliError(
            "EMPTY_FILE",
            f"Upload file is empty: {resolved}",
            exit_code=EXIT_USAGE,
        )
    return resolved


def _success(command: str, data: Any) -> Dict[str, Any]:
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "command": command,
        "data": data,
    }


def _failure(command: str, error: CliError) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "ok": False,
        "schema_version": SCHEMA_VERSION,
        "command": command,
        "error": {
            "code": error.code,
            "message": error.message,
        },
    }
    if error.status is not None:
        payload["error"]["http_status"] = error.status
    if error.details is not None:
        payload["error"]["details"] = error.details
    return payload


def _processing_ids(payload: Any) -> List[str]:
    if not isinstance(payload, dict):
        return []
    values: List[str] = []
    for item in payload.get("results", []) or []:
        if isinstance(item, dict) and item.get("processing_id"):
            values.append(str(item["processing_id"]))
    return values


def _compact_knowledge_base(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    allowed = ("id", "name", "description", "created_at", "updated_at", "stats")
    return {key: item.get(key) for key in allowed if key in item}


def _compact_knowledge_base_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    if isinstance(payload.get("knowledge_bases"), list):
        return {
            "knowledge_bases": [
                _compact_knowledge_base(item) for item in payload["knowledge_bases"]
            ]
        }
    return _compact_knowledge_base(payload)


def _compact_file(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    allowed = (
        "id", "file_id", "name", "filename", "file_name", "file_path", "type",
        "file_type", "size", "status", "processing_id", "stage", "progress",
        "message", "error", "created_at", "updated_at",
    )
    compact = {key: item.get(key) for key in allowed if key in item}
    return compact or item


def _compact_file_payload(payload: Any) -> Any:
    if not isinstance(payload, dict) or not isinstance(payload.get("files"), list):
        return payload
    return {"files": [_compact_file(item) for item in payload["files"]]}


def _compact_citation(item: Any) -> Any:
    if not isinstance(item, dict):
        return item
    compact = {
        key: item.get(key)
        for key in ("id", "type", "file_name", "content", "score")
        if key in item
    }
    metadata = item.get("metadata")
    if isinstance(metadata, dict):
        safe_metadata_keys = (
            "kb_id", "file_id", "chunk_id", "chunk_index", "page", "page_number",
            "shot_start_time", "shot_end_time", "scene_start_time", "scene_end_time",
        )
        safe_metadata = {
            key: metadata.get(key) for key in safe_metadata_keys if key in metadata
        }
        if safe_metadata:
            compact["metadata"] = safe_metadata
    return compact


def _compact_answer_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    metadata = payload.get("metadata")
    safe_metadata = {}
    if isinstance(metadata, dict):
        safe_metadata = {
            key: metadata.get(key)
            for key in (
                "query", "intent_type", "processing_time", "chunks_used",
                "images_used", "tokens_used", "model_used", "agent",
                "agent_selection",
            )
            if key in metadata
        }
    compact = {
        "success": bool(payload.get("success", True)),
        "session_id": payload.get("sessionId") or payload.get("session_id"),
        "answer": payload.get("message") or payload.get("answer") or "",
        "citations": [
            _compact_citation(item) for item in (payload.get("citations") or [])
        ],
    }
    if safe_metadata:
        compact["metadata"] = safe_metadata
    return compact


def _get_statuses(client: ApiClient, ids: Iterable[str]) -> List[Dict[str, Any]]:
    statuses = []
    for processing_id in ids:
        status = client.request_json(
            "GET",
            f"api/upload/progress/{quote(processing_id, safe='')}",
        )
        statuses.append({"processing_id": processing_id, **(status if isinstance(status, dict) else {})})
    return statuses


def _terminal_status(status: Dict[str, Any]) -> str:
    return str(status.get("status") or "").strip().lower()


def execute(args: argparse.Namespace, client: ApiClient) -> Tuple[str, Any]:
    if args.command == "health":
        return "health", client.request_json("GET", "health")

    if args.command == "kb":
        if args.kb_command == "list":
            return "kb.list", _compact_knowledge_base_payload(
                client.request_json("GET", "api/knowledge/")
            )
        if args.kb_command == "show":
            return "kb.show", _compact_knowledge_base_payload(
                client.request_json(
                    "GET", f"api/knowledge/{quote(args.kb_id, safe='')}"
                )
            )
        if args.kb_command == "create":
            return "kb.create", _compact_knowledge_base_payload(
                client.request_json(
                    "POST",
                    "api/knowledge/",
                    {"name": args.name, "description": args.description or ""},
                )
            )

    if args.command == "file" and args.file_command == "list":
        return "file.list", _compact_file_payload(
            client.request_json(
                "GET", f"api/knowledge/{quote(args.kb_id, safe='')}/files"
            )
        )

    if args.command == "ingest":
        if args.ingest_command == "files":
            roots = _allowed_roots(args.allow_root)
            paths = [validate_upload_path(raw, roots) for raw in args.paths]
            payload = client.upload_files(args.kb_id, paths)
            if isinstance(payload, dict):
                payload = {**payload, "processing_ids": _processing_ids(payload)}
            return "ingest.files", payload
        if args.ingest_command == "status":
            return "ingest.status", {
                "statuses": _get_statuses(client, args.processing_ids)
            }
        if args.ingest_command == "wait":
            deadline = time.monotonic() + args.wait_timeout
            last_statuses: List[Dict[str, Any]] = []
            while True:
                last_statuses = _get_statuses(client, args.processing_ids)
                terminal = [_terminal_status(item) for item in last_statuses]
                if any(status == "failed" for status in terminal):
                    raise CliError(
                        "INGESTION_FAILED",
                        "One or more ingestion jobs failed",
                        exit_code=EXIT_JOB_FAILED,
                        details={"statuses": last_statuses},
                    )
                if terminal and all(status == "completed" for status in terminal):
                    return "ingest.wait", {"statuses": last_statuses}
                if time.monotonic() >= deadline:
                    raise CliError(
                        "INGESTION_TIMEOUT",
                        "Timed out waiting for ingestion jobs",
                        exit_code=EXIT_TIMEOUT,
                        details={"statuses": last_statuses, "timeout": args.wait_timeout},
                    )
                time.sleep(args.poll_interval)

    if args.command == "search":
        payload = {
            "query": args.query,
            "knowledge_base_ids": args.kb_ids,
            "file_ids": args.file_ids,
            "modalities": args.modalities,
            "top_k": args.top_k,
        }
        return "search", client.request_json("POST", "api/v1/retrieval/search", payload)

    if args.command == "ask":
        selected_files = []
        if args.file_ids:
            if len(args.kb_ids) != 1:
                raise CliError(
                    "INVALID_FILE_SCOPE",
                    "--file-id requires exactly one --kb-id",
                    exit_code=EXIT_USAGE,
                )
            selected_files = [
                {"kb_id": args.kb_ids[0], "file_id": file_id}
                for file_id in args.file_ids
            ]
        payload = {
            "message": args.query,
            "knowledgeBaseIds": args.kb_ids,
            "selectedFiles": selected_files,
            "agentMode": args.agent_mode,
        }
        if args.session_id:
            payload["sessionId"] = args.session_id
        return "ask", _compact_answer_payload(
            client.request_json("POST", "api/chat/message", payload)
        )

    raise CliError("INVALID_COMMAND", "Unsupported command", exit_code=EXIT_USAGE)


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mma-rag", description="Local MMA-RAG agent CLI")
    parser.add_argument(
        "--base-url",
        default=os.getenv("MMA_RAG_BASE_URL", DEFAULT_BASE_URL),
        help="MMA-RAG API base URL",
    )
    parser.add_argument(
        "--timeout",
        type=_positive_float,
        default=float(os.getenv("MMA_RAG_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT))),
        help="ordinary HTTP timeout in seconds",
    )
    parser.add_argument(
        "--upload-timeout",
        type=_positive_float,
        default=float(
            os.getenv("MMA_RAG_UPLOAD_TIMEOUT_SECONDS", str(DEFAULT_UPLOAD_TIMEOUT))
        ),
        help="upload HTTP timeout in seconds",
    )
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON")
    parser.add_argument(
        "--allow-root",
        action="append",
        default=[],
        help="additional allowed upload root; repeat as needed",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("health", help="check the local service")

    kb = commands.add_parser("kb", help="manage knowledge bases")
    kb_commands = kb.add_subparsers(dest="kb_command", required=True)
    kb_commands.add_parser("list", help="list knowledge bases")
    kb_show = kb_commands.add_parser("show", help="show a knowledge base")
    kb_show.add_argument("--kb-id", required=True)
    kb_create = kb_commands.add_parser("create", help="create a knowledge base")
    kb_create.add_argument("--name", required=True)
    kb_create.add_argument("--description")

    file_parser = commands.add_parser("file", help="inspect indexed files")
    file_commands = file_parser.add_subparsers(dest="file_command", required=True)
    file_list = file_commands.add_parser("list", help="list files in a knowledge base")
    file_list.add_argument("--kb-id", required=True)

    ingest = commands.add_parser("ingest", help="submit and inspect ingestion jobs")
    ingest_commands = ingest.add_subparsers(dest="ingest_command", required=True)
    ingest_files = ingest_commands.add_parser("files", help="upload one or more local files")
    ingest_files.add_argument("--kb-id", required=True)
    ingest_files.add_argument("--path", dest="paths", action="append", required=True)
    ingest_status = ingest_commands.add_parser("status", help="get ingestion status")
    ingest_status.add_argument(
        "--processing-id", dest="processing_ids", action="append", required=True
    )
    ingest_wait = ingest_commands.add_parser("wait", help="wait for ingestion completion")
    ingest_wait.add_argument(
        "--processing-id", dest="processing_ids", action="append", required=True
    )
    ingest_wait.add_argument(
        "--timeout",
        dest="wait_timeout",
        type=_positive_float,
        default=DEFAULT_INGEST_WAIT_TIMEOUT,
    )
    ingest_wait.add_argument("--poll-interval", type=_positive_float, default=2.0)

    search = commands.add_parser("search", help="retrieve compact multimodal evidence")
    search.add_argument("--query", required=True)
    search.add_argument("--kb-id", dest="kb_ids", action="append", default=[])
    search.add_argument("--file-id", dest="file_ids", action="append", default=[])
    search.add_argument(
        "--modality",
        dest="modalities",
        action="append",
        choices=("doc", "image", "audio", "video"),
        default=[],
    )
    search.add_argument("--top-k", type=int, default=8, choices=range(1, 51))

    ask = commands.add_parser("ask", help="retrieve and generate a grounded answer")
    ask.add_argument("--query", required=True)
    ask.add_argument("--kb-id", dest="kb_ids", action="append", default=[])
    ask.add_argument("--file-id", dest="file_ids", action="append", default=[])
    ask.add_argument("--session-id")
    ask.add_argument(
        "--agent-mode",
        choices=("direct", "auto", "agent"),
        default="auto",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = str(args.command or "unknown")
    try:
        client = ApiClient(args.base_url, args.timeout, args.upload_timeout)
        command, data = execute(args, client)
        output = _success(command, data)
        exit_code = 0
    except CliError as error:
        output = _failure(command, error)
        exit_code = error.exit_code
    except Exception as error:  # keep stdout machine-readable even for unexpected failures
        wrapped = CliError(
            "INTERNAL_ERROR",
            str(error) or type(error).__name__,
            details={"type": type(error).__name__},
        )
        output = _failure(command, wrapped)
        exit_code = wrapped.exit_code

    json.dump(
        output,
        sys.stdout,
        ensure_ascii=False,
        indent=2 if args.pretty else None,
        separators=None if args.pretty else (",", ":"),
    )
    sys.stdout.write("\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
