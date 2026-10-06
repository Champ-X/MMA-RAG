"""Private, strict HTTP recordings for the legacy/Pi isolation verifier.

Only the verification process installs these hooks. Production algorithms and
provider/SDK parsing stay live. Requests match by complete JSON/body, endpoint,
read headers and timeout; concurrent calls may finish in a different order.
Only credentials/signing fields are excluded, never queries, filters or scores.
No unrecorded request may use the network during replay. Corpus writes are
rejected in both modes, including during application import.
"""
from __future__ import annotations

import asyncio
import base64
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar, copy_context
import functools
import hashlib
import io
import json
from pathlib import Path
import re
import socket
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from unittest.mock import patch

import httpx
import urllib3

lane = ContextVar("pi_replay_lane", default="startup")
SAFE_HEADERS = {"content-type", "accept", "range", "if-match", "if-none-match"}
RESPONSE_HEADERS = SAFE_HEADERS | {"content-encoding", "content-range", "etag", "last-modified"}
SIGNING = {"x-amz-credential", "x-amz-signature", "x-amz-security-token", "x-amz-date"}
URL_RE = re.compile(r"https?://[^\s\"<>]+")


class ReplayMismatch(RuntimeError):
    pass


def safe_url(url):
    parts = urlsplit(str(url))
    # These S3 fields change on every signing operation and contain credentials.
    query = [(key, "REDACTED" if key.lower() in SIGNING else value)
             for key, value in parse_qsl(parts.query, keep_blank_values=True)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(sorted(query)), parts.fragment))


def normalize(value):
    if isinstance(value, str):
        return URL_RE.sub(lambda match: safe_url(match.group()), value)
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize(item) for key, item in value.items()}
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":")).encode()).hexdigest()


def write_private(path, value):
    with Path(path).open("x") as target:
        Path(path).chmod(0o600)
        json.dump(value, target, ensure_ascii=False, indent=2)


def request_contract(kind, method, url, headers, body, timeout=None):
    if isinstance(body, str):
        body = body.encode()
    body = body or b""
    if not isinstance(body, bytes):
        raise ReplayMismatch("Unrecordable streaming request body")
    try:
        content = {"json": normalize(json.loads(body))}
    except (ValueError, UnicodeDecodeError):
        content = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
    return {"transport": kind, "method": method.upper(), "url": safe_url(url),
            "headers": {key.lower(): value for key, value in headers.items() if key.lower() in SAFE_HEADERS},
            "body": content, "timeout": timeout}


class Tape:
    def __init__(self, path, mode, *, minio_hosts=(), qdrant_hosts=()):
        self.path, self.mode = Path(path), mode
        self.minio_hosts, self.qdrant_hosts = set(minio_hosts), set(qdrant_hosts)
        self.lock = threading.Lock()
        self.records, self.errors, self.observed = [], [], []
        self.index = defaultdict(list)
        self.used = set()
        self.started = {}
        if mode == "record":
            self.path.mkdir(parents=True, exist_ok=False, mode=0o700)
        elif mode == "replay":
            for path in sorted(self.path.glob("*.json")):
                item = json.loads(path.read_text())
                self.records.append(item)
                self.index[(item["lane"], digest(item["request"]))].append(item)
        else:
            raise ValueError("mode must be record or replay")
        self.patches = []

    def fail(self, reason, **metadata):
        self.errors.append({"lane": lane.get(), "reason": reason, **metadata})
        raise ReplayMismatch(reason)

    def read_only(self, request):
        parts = urlsplit(request["url"])
        method, path = request["method"], parts.path
        if parts.netloc in self.minio_hosts and method not in {"GET", "HEAD"}:
            self.fail("MinIO mutation denied", method=method, path=path)
        if parts.netloc in self.qdrant_hosts:
            query = method == "POST" and re.fullmatch(
                r"/collections/[^/]+/points(?:/(?:query|search|scroll|count|recommend)(?:/batch)?)?", path)
            if method not in {"GET", "HEAD"} and not query:
                self.fail("Qdrant mutation denied", method=method, path=path)

    def begin(self, request):
        self.read_only(request)
        current = lane.get()
        # Explicit live Pi load is outside legacy tapes and remains read-only.
        if current is None:
            return None
        signature = digest(request)
        with self.lock:
            self.observed.append({"lane": current, "request_sha256": signature})
            if self.mode == "record":
                record = {"id": len(self.records), "lane": current, "request": request,
                          "chunks": [], "complete": False, "started_at": time.time()}
                self.records.append(record)
                self.started[record["id"]] = time.monotonic()
                return record
            matches = self.index.get((current, signature), [])
            for record in matches:
                if record["id"] not in self.used:
                    self.used.add(record["id"])
                    return record
        self.fail("Unrecorded request", request=request)

    def finish(self, record):
        if record is not None and self.mode == "record":
            write_private(self.path / f'{record["id"]:06d}.json', record)

    def failure(self, record, error):
        record.update(error={"type": type(error).__name__}, complete=True,
                      error_after_seconds=time.monotonic() - self.started[record["id"]])

    def clock(self, name, read):
        """Clock reads are external inputs too; keep real cache TTL decisions.

        Only the inventory module uses this clock, never asyncio deadlines,
        global model health, or Pi budgets. Each read consumes its own sample.
        """
        record = self.begin(request_contract("clock", "READ", f"clock://{name}", {}, b""))
        if record is None:
            return read()
        if self.mode == "record":
            record.update(value=read(), complete=True)
            self.finish(record)
        return record["value"]

    @staticmethod
    def raise_recorded(record, request=None):
        failure = record.get("error")
        if not failure:
            return
        kind = failure["type"]
        if kind == "CancelledError":
            raise asyncio.CancelledError()
        error_class = getattr(httpx, kind, None)
        if isinstance(error_class, type) and issubclass(error_class, httpx.RequestError):
            raise error_class("Recorded transport failure", request=request)
        raise ReplayMismatch("Unsupported recorded transport failure: " + kind)

    def report(self, current=None):
        expected = [item for item in self.records if current is None or item["lane"] == current]
        return {"mode": self.mode, "exchanges": len(expected),
                "unconsumed_ids": [item["id"] for item in expected
                                   if self.mode == "replay" and item["id"] not in self.used],
                "incomplete_ids": [item["id"] for item in expected if not item["complete"]],
                "errors": [item for item in self.errors if current is None or item["lane"] == current]}

    def install(self):
        tape = self
        original_async = httpx.AsyncHTTPTransport.handle_async_request
        original_sync = httpx.HTTPTransport.handle_request
        original_urlopen = urllib3.PoolManager.urlopen
        original_submit = ThreadPoolExecutor.submit
        original_connect = socket.socket.connect
        original_connect_ex = socket.socket.connect_ex

        async def async_request(transport, request):
            contract = request_contract("httpx", request.method, request.url, request.headers,
                                        await request.aread(), request.extensions.get("timeout"))
            record = tape.begin(contract)
            if record is None:
                return await original_async(transport, request)
            if tape.mode == "replay":
                if "response" not in record:
                    await replay_cancellation(record)
                    tape.raise_recorded(record, request)
                return httpx.Response(**record["response"], stream=ReplayAsyncStream(record, request))
            try:
                response = await original_async(transport, request)
            except BaseException as error:
                tape.failure(record, error)
                tape.finish(record)
                raise
            record["response"] = response_metadata(response.status_code, response.headers)
            response.stream = CaptureAsyncStream(response.stream, tape, record)
            return response

        def sync_request(transport, request):
            contract = request_contract("httpx", request.method, request.url, request.headers,
                                        request.read(), request.extensions.get("timeout"))
            record = tape.begin(contract)
            if record is None:
                return original_sync(transport, request)
            if tape.mode == "replay":
                if "response" not in record:
                    tape.raise_recorded(record, request)
                return httpx.Response(**record["response"], stream=ReplaySyncStream(record, request))
            try:
                response = original_sync(transport, request)
            except BaseException as error:
                tape.failure(record, error)
                tape.finish(record)
                raise
            record["response"] = response_metadata(response.status_code, response.headers)
            response.stream = CaptureSyncStream(response.stream, tape, record)
            return response

        def urlopen(pool, method, url, redirect=True, **kwargs):
            request = request_contract("urllib3", method, url, kwargs.get("headers") or {}, kwargs.get("body"))
            record = tape.begin(request)
            if record is None:
                return original_urlopen(pool, method, url, redirect=redirect, **kwargs)
            if tape.mode == "record":
                try:
                    response = original_urlopen(pool, method, url, redirect=redirect, **kwargs)
                    # MinIO returns finite objects, never SSE. Preserve the SDK's
                    # original bytes/parsing; materialize its body at this I/O boundary.
                    body = response.data
                    record.update(response=response_metadata(response.status, response.headers),
                                  chunks=[base64.b64encode(body).decode()], complete=True)
                    response.close()
                    response.release_conn()
                except BaseException as error:
                    tape.failure(record, error)
                    raise
                finally:
                    tape.finish(record)
            tape.raise_recorded(record)
            return urllib3.response.HTTPResponse(
                body=io.BytesIO(b"".join(base64.b64decode(part) for part in record["chunks"])),
                status=record["response"]["status_code"], headers=record["response"]["headers"],
                preload_content=kwargs.get("preload_content", True), request_method=method)

        def submit(executor, fn, /, *args, **kwargs):
            return original_submit(executor, copy_context().run, functools.partial(fn, *args, **kwargs))

        def check_socket(original, connection, address):
            if tape.mode == "replay" and lane.get() is not None and connection.family in {socket.AF_INET, socket.AF_INET6}:
                tape.fail("Replay attempted a real socket connection", address=str(address))
            return original(connection, address)

        replacements = [(httpx.AsyncHTTPTransport, "handle_async_request", async_request),
                        (httpx.HTTPTransport, "handle_request", sync_request),
                        (urllib3.PoolManager, "urlopen", urlopen),
                        (ThreadPoolExecutor, "submit", submit),
                        (socket.socket, "connect", lambda s, a: check_socket(original_connect, s, a)),
                        (socket.socket, "connect_ex", lambda s, a: check_socket(original_connect_ex, s, a))]
        for target, name, replacement in replacements:
            hook = patch.object(target, name, replacement)
            hook.start()
            self.patches.append(hook)
        return self

    def close(self):
        for hook in reversed(self.patches):
            hook.stop()


def response_metadata(status, headers):
    return {"status_code": status, "headers": {key.lower(): value for key, value in headers.items()
                                               if key.lower() in RESPONSE_HEADERS}}


class CaptureAsyncStream(httpx.AsyncByteStream):
    def __init__(self, source, tape, record):
        self.source, self.tape, self.record, self.saved = source, tape, record, False

    async def __aiter__(self):
        try:
            async for chunk in self.source:
                self.record["chunks"].append(base64.b64encode(chunk).decode())
                yield chunk
            self.record["complete"] = True
        except BaseException as error:
            if not isinstance(error, GeneratorExit):
                self.tape.failure(self.record, error)
            else:
                self.record.update(complete=True, consumer_closed=True)
            raise
        finally:
            self.save()

    def save(self):
        if not self.saved:
            self.tape.finish(self.record)
            self.saved = True

    async def aclose(self):
        try:
            await self.source.aclose()
        finally:
            self.record["consumer_closed"] = True
            self.record["complete"] = True
            self.save()


class CaptureSyncStream(httpx.SyncByteStream):
    def __init__(self, source, tape, record):
        self.source, self.tape, self.record, self.saved = source, tape, record, False

    def __iter__(self):
        try:
            for chunk in self.source:
                self.record["chunks"].append(base64.b64encode(chunk).decode())
                yield chunk
            self.record["complete"] = True
        except BaseException as error:
            if not isinstance(error, GeneratorExit):
                self.tape.failure(self.record, error)
            else:
                self.record.update(complete=True, consumer_closed=True)
            raise
        finally:
            self.save()

    def save(self):
        if not self.saved:
            self.tape.finish(self.record)
            self.saved = True

    def close(self):
        try:
            self.source.close()
        finally:
            self.record["consumer_closed"] = True
            self.record["complete"] = True
            self.save()


class ReplayAsyncStream(httpx.AsyncByteStream):
    def __init__(self, record, request):
        self.record, self.request = record, request

    async def __aiter__(self):
        for part in self.record["chunks"]:
            await asyncio.sleep(0)
            yield base64.b64decode(part)
        await replay_cancellation(self.record)
        Tape.raise_recorded(self.record, self.request)


class ReplaySyncStream(httpx.SyncByteStream):
    def __init__(self, record, request):
        self.record, self.request = record, request

    def __iter__(self):
        for part in self.record["chunks"]:
            yield base64.b64decode(part)
        Tape.raise_recorded(self.record, self.request)


async def replay_cancellation(record):
    if (record.get("error") or {}).get("type") == "CancelledError":
        # Let the unchanged application's wait_for/deadline produce its own
        # TimeoutError. Raising CancelledError immediately would cancel a caller
        # that had originally recovered from its embedding timeout.
        await asyncio.sleep(record["error_after_seconds"] + .1)
