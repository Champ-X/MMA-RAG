"""Task-local preparation events and safe, actionable model failures.

No exception text, request URLs, local paths or credentials enter the public
progress response. The observer follows asyncio.to_thread without changing
global Hugging Face logging or other inference tasks.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import errno
import re

_observer = ContextVar("model_preparation_observer", default=None)

PHASES = {
    "cache": "检查本地缓存", "metadata": "连接下载源，读取模型清单",
    "download": "下载模型文件", "verify": "校验模型文件",
    "load": "载入模型", "load_download": "复用缓存或下载并载入模型",
    "inference": "验证真实推理", "artifacts": "记录已验证的模型缓存",
}


@contextmanager
def observe_preparation(callback):
    token = _observer.set(callback)
    try:
        yield
    finally:
        _observer.reset(token)


def report_preparation(phase: str, **metrics) -> None:
    callback = _observer.get()
    if callback:
        callback({"phase": phase, "message": PHASES[phase], **metrics})


def model_failure(error: Exception, phase: str) -> dict:
    # requests/urllib3 wrap causes in .reason and occasionally exception args.
    chain, pending, seen = [], [error], set()
    while pending and len(chain) < 20:
        item = pending.pop()
        if not isinstance(item, BaseException) or id(item) in seen:
            continue
        seen.add(id(item))
        chain.append(item)
        pending.extend([item.__cause__, item.__context__, getattr(item, "reason", None)])
        pending.extend(arg for arg in item.args if isinstance(arg, BaseException))
    types = {type(item).__name__ for item in chain}
    # Text is used only for classification. Never return/log it: Hub failures
    # can contain signed URLs, auth headers and proxy passwords.
    text = " ".join(str(item).lower() for item in chain)
    status = next((getattr(getattr(item, "response", None), "status_code", None) for item in chain
                   if type(getattr(getattr(item, "response", None), "status_code", None)) is int), None)
    codes = {getattr(item, "errno", None) for item in chain}
    network_hint = "检查 Docker / WSL 的网络；可在终端选择“调整模型下载网络”，设置可信下载源或容器可达的代理后重试。"
    code, message, hint = "MODEL_PREPARE_FAILED", "模型准备失败。", "请查看诊断代码及后端日志，再重试。"
    if errno.ENOSPC in codes or errno.EDQUOT in codes or "no space left" in text:
        code, message, hint = "MODEL_DISK_FULL", "模型缓存所在磁盘空间不足。", "释放数据目录或 Docker / WSL 磁盘空间后重试；无需删除已有模型缓存。"
    elif "MemoryError" in types or "OutOfMemoryError" in types or any(s in text for s in ("out of memory", "can't allocate memory", "cannot allocate memory")):
        code, message, hint = "MODEL_MEMORY", "载入或推理时可用内存不足。", "关闭占用内存的程序，增加 Docker / WSL 的可用内存后重试。"
    elif status in (401, 403):
        code, message, hint = "MODEL_ACCESS_DENIED", f"下载源拒绝访问（HTTP {status}）。", "检查下载源访问权限；可调整为有权访问的官方源或可信镜像。"
    elif status == 404:
        code, message, hint = "MODEL_NOT_FOUND", "下载源未找到所需模型文件（HTTP 404）。", "确认模型名称及下载源是否完整，可换用官方源或可信镜像。"
    elif status:
        code, message, hint = "MODEL_DOWNLOAD_HTTP", f"下载源返回 HTTP {status}。", network_hint
    elif any("SSL" in name or "Certificate" in name for name in types):
        code, message, hint = "MODEL_TLS", "下载源的安全连接校验失败。", "检查系统时间、代理及可信证书配置；不要关闭证书校验。"
    elif any("Proxy" in name for name in types):
        code, message, hint = "MODEL_PROXY", "无法通过代理连接模型下载源。", network_hint
    elif any("Timeout" in name for name in types) or "timed out" in text:
        code, message, hint = "MODEL_DOWNLOAD_TIMEOUT", "连接模型下载源或等待下载数据超时。", network_hint
    elif any("Connection" in name for name in types) or codes & {errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ECONNREFUSED} or "network is unreachable" in text:
        code, message, hint = "MODEL_NETWORK", "模型下载源无法连接，容器网络不可达。", network_hint
    elif errno.EACCES in codes or errno.EPERM in codes:
        code, message, hint = "MODEL_CACHE_PERMISSION", "无法读写模型缓存目录。", "检查数据目录权限及 Docker 挂载是否可写后重试。"
    elif "ImportError" in types or "ModuleNotFoundError" in types or "weights_only" in text:
        code, message, hint = "MODEL_DEPENDENCY", "模型运行依赖不兼容或不完整。", "更新源码并执行 tessmora setup --rebuild，保留已有资料和缓存。"
    elif "cache is incomplete" in text or "missing required inference" in text or "SafetensorError" in types:
        code, message, hint = "MODEL_CACHE_INVALID", "模型文件不完整或无法读取。", "检查本地模型目录或下载源是否完整后重试；不要清空整个缓存目录。"
    safe_types = [type(item).__name__ for item in chain]
    safe_types = [name for name in dict.fromkeys(safe_types) if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", name)]
    return {"error_code": code, "error_type": safe_types[0] if safe_types else "Exception",
            "causes": safe_types, "phase": phase, "message": message,
            "hint": hint + " 已下载缓存会保留。", **({"http_status": status} if status else {})}
