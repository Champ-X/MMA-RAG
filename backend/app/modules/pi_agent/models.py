"""Per-run HTTP transports; never update the shared provider health or task routes."""
from __future__ import annotations

from .language import translate_prompt
from app.core.prompt_language import localized

import json
import time
from copy import deepcopy

import httpx

from .policy import UsageLedger, ToolError
from .admission import ProviderCapacity


def model_endpoint(registry, name: str, capability: str):
    config = registry.get_model_config(name)
    if capability not in str(config.get("type", "")).split(","):
        raise ToolError("model_unavailable", localized(f"纯 Agent 的 {capability} 模型尚未配置", f"The Pi Agent {capability} model has not been configured."))
    provider = registry.get_provider(config["provider"])
    if not provider or not getattr(provider, "api_key", None):
        raise ToolError("model_unavailable", localized(f"纯 Agent 的 {capability} 服务商尚未配置", f"The Pi Agent {capability} provider has not been configured."))
    return {"name": name, "model": config.get("raw_model") or name.split(":", 1)[-1],
            "provider": config["provider"], "base_url": provider.base_url.rstrip("/"), "key": provider.api_key}


class ModelTransport:
    def __init__(self, registry, settings, ledger: UsageLedger, emit, *, client=None, provider_capacity=None):
        self.registry, self.settings, self.ledger, self.emit = registry, settings, ledger, emit
        provider_limit = getattr(settings, "max_concurrent_provider_requests", 2)
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(connect=8, read=120, write=30, pool=8),
            # Actual concurrent requests are bounded by shared provider gates;
            # a global HTTP pool cap would make unrelated providers block each other.
            limits=httpx.Limits(max_connections=None, max_keepalive_connections=2 * provider_limit))
        self._call_id = 0
        self._embeddings = {}
        self._routes = {}
        self.provider_capacity = provider_capacity or ProviderCapacity(provider_limit)

    def _endpoint(self, name, capability):
        # A run's cached observations must keep the effective model/endpoint
        # identity that produced them even if the shared catalog is refreshed.
        # New runs resolve fresh routes. Credentials remain private in memory.
        identity = (name, capability)
        if identity not in self._routes:
            self._routes[identity] = deepcopy(model_endpoint(self.registry, name, capability))
        return self._routes[identity]

    def _begin(self, config, kind, input_bytes, parent):
        self._call_id -= 1  # Disjoint from positive Pi reasoning turn IDs.
        call_id = self._call_id
        self.ledger.start_model(call_id)
        span = f"model:{call_id}"
        self.emit("model.started", {"turn": call_id, "model": config["model"], "provider": config["provider"],
                  "purpose": kind, "input_bytes": input_bytes}, span_id=span, parent_span_id=parent)
        return call_id, span, time.monotonic()

    def _finish(self, config, kind, started, usage, call_id, span, parent, status):
        self.ledger.settle_model(call_id, {"totalTokens": (usage or {}).get("total_tokens")})
        self.emit("model.completed", {"turn": call_id, "model": config["model"], "provider": config["provider"],
                  "purpose": kind, "usage": usage or {}, "duration_ms": round((time.monotonic() - started) * 1000),
                  "stop_reason": status, "cost_known": False}, span_id=span, parent_span_id=parent)

    async def embed(self, query: str, parent: str):
        if query in self._embeddings:
            self.emit("model.cache_hit", {"purpose": "embedding"}, parent_span_id=parent)
            return self._embeddings[query]
        config = self._endpoint(self.settings.embedding_model, "embedding")
        gate = await self.provider_capacity.acquire(config["provider"], self.emit, parent_span_id=parent)
        body = {"model": config["model"], "input": [query]}
        try:
            call_id, span, started = self._begin(config, "embedding", len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()), parent)
        except BaseException:
            gate.release()
            raise
        usage, status = None, "error"
        try:
            response = await self.client.post(config["base_url"] + "/embeddings",
                headers={"Authorization": f"Bearer {config['key']}"},
                json=body)
            self.emit("model.response", {"turn": call_id, "purpose": "embedding",
                      "status_code": response.status_code, "elapsed_ms": round((time.monotonic() - started) * 1000)},
                      span_id=span, parent_span_id=parent)
            response.raise_for_status()
            value = response.json()
            usage = value.get("usage")
            vector = value["data"][0]["embedding"]
            if not isinstance(vector, list) or not vector:
                raise ValueError("empty_vector")
            self._embeddings[query] = vector
            status = "stop"
            return vector
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            raise ToolError("embedding_unavailable", translate_prompt("查询向量服务未能完成，本次搜索可继续使用词面匹配"), retryable=True) from None
        finally:
            gate.release()
            self._finish(config, "embedding", started, usage, call_id, span, parent, status)

    async def observe(self, parts: list[dict], *, kind: str, input_units: int, parent: str):
        name = self.settings.audio_model if kind == "audio" else self.settings.vision_model
        config = self._endpoint(name, "audio" if kind == "audio" else "vision")
        usage, status, answer = None, "error", ""
        body = {"model": config["model"], "messages": [{"role": "user", "content": parts}],
                "stream": True, "stream_options": {"include_usage": True},
                "temperature": .2}
        if config["provider"] == "aliyun_bailian":
            body["enable_thinking"] = False
            if kind == "audio":
                body["modalities"] = ["text"]
        gate = await self.provider_capacity.acquire(config["provider"], self.emit, parent_span_id=parent)
        try:
            call_id, span, started = self._begin(config, kind, len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()), parent)
        except BaseException:
            gate.release()
            raise
        first_content = False
        try:
            async with self.client.stream("POST", config["base_url"] + "/chat/completions",
                    headers={"Authorization": f"Bearer {config['key']}"}, json=body) as response:
                self.emit("model.response", {"turn": call_id, "purpose": kind,
                          "status_code": response.status_code, "elapsed_ms": round((time.monotonic() - started) * 1000)},
                          span_id=span, parent_span_id=parent)
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    value = json.loads(line[5:])
                    if value.get("error"):
                        raise ValueError("stream_error")
                    usage = value.get("usage") or usage
                    for choice in value.get("choices") or []:
                        delta = choice.get("delta", {}).get("content") or ""
                        if delta and not first_content:
                            first_content = True
                            self.emit("model.first_content", {"turn": call_id, "purpose": kind,
                                      "elapsed_ms": round((time.monotonic() - started) * 1000)},
                                      span_id=span, parent_span_id=parent)
                        answer += delta
                        status = choice.get("finish_reason") or status
            if not answer.strip() or status not in {"stop", "end_turn"}:
                raise ValueError("incomplete_observation")
            return answer.strip(), {"model": name, "usage": usage or {}, "input_allowance": input_units}
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise ToolError("media_model_unavailable", translate_prompt("媒体模型未返回完整观察结果，请缩小片段或稍后重试"), retryable=True) from None
        finally:
            gate.release()
            self._finish(config, kind, started, usage, call_id, span, parent, status)

    async def close(self):
        await self.client.aclose()
