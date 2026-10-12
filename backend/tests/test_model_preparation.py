"""Actionable model diagnostics must never expose transport secrets."""
import errno
import json
import logging

import httpx
import pytest
import requests
from urllib3.exceptions import MaxRetryError, NewConnectionError

from app.core.access_log import QuietSuccessfulPolls
from app.core.model_preparation import model_failure, observe_preparation, report_preparation


@pytest.mark.parametrize("error,code", [
    (OSError(errno.ENETUNREACH, "private endpoint"), "MODEL_NETWORK"),
    (requests.ConnectionError(MaxRetryError(None, "https://user:secret@host", NewConnectionError(None, "[Errno 101] Network is unreachable"))), "MODEL_NETWORK"),
    (requests.exceptions.ProxyError("proxy-secret"), "MODEL_PROXY"),
    (requests.exceptions.SSLError("tls-secret"), "MODEL_TLS"),
    (httpx.ReadTimeout("signed-url-secret"), "MODEL_DOWNLOAD_TIMEOUT"),
    (OSError(errno.ENOSPC, "disk-secret"), "MODEL_DISK_FULL"),
    (PermissionError(errno.EACCES, "path-secret"), "MODEL_CACHE_PERMISSION"),
    (MemoryError("secret"), "MODEL_MEMORY"),
    (ImportError("secret"), "MODEL_DEPENDENCY"),
    (ValueError("BGE-M3 cache is incomplete: path-secret"), "MODEL_CACHE_INVALID"),
    (RuntimeError("secret"), "MODEL_PREPARE_FAILED"),
])
def test_classifies_nested_errors_without_copying_sensitive_text(error, code):
    result = model_failure(error, "metadata")
    assert result["error_code"] == code
    assert result["phase"] == "metadata"
    assert "secret" not in json.dumps(result)
    assert "https://" not in json.dumps(result)
    assert result["hint"] and result["causes"]


@pytest.mark.parametrize("status,code", [(403, "MODEL_ACCESS_DENIED"), (404, "MODEL_NOT_FOUND"), (502, "MODEL_DOWNLOAD_HTTP")])
def test_hub_http_status_remains_visible_without_raw_response(status, code):
    response = requests.Response()
    response.status_code = status
    wrapped = RuntimeError("wrapper-secret")
    wrapped.__cause__ = requests.HTTPError("token-secret", response=response)
    result = model_failure(wrapped, "download")
    assert result["error_code"] == code and result["http_status"] == status
    assert "secret" not in json.dumps(result)


def test_observers_are_scoped_and_restored_after_failure():
    outer, inner = [], []
    with observe_preparation(outer.append):
        report_preparation("cache")
        with pytest.raises(ValueError), observe_preparation(inner.append):
            report_preparation("metadata")
            raise ValueError("synthetic")
        report_preparation("load")
    report_preparation("inference")
    assert [row["phase"] for row in outer] == ["cache", "load"]
    assert [row["phase"] for row in inner] == ["metadata"]


@pytest.mark.parametrize("method,path,status,visible", [
    ("GET", "/health", 200, False),
    ("GET", "/api/setup/progress?poll=1", 200, False),
    ("GET", "/api/upload/progress", 500, True),
    ("GET", "/health", 503, True),
    ("POST", "/api/setup/prepare", 200, True),
    ("GET", "/api/knowledge/", 200, True),
    ("GET", "/health-other", 200, True),
])
def test_only_successful_readonly_poll_access_logs_are_quiet(method, path, status, visible):
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("local", method, path, "1.1", status), None)
    assert QuietSuccessfulPolls().filter(record) is visible
