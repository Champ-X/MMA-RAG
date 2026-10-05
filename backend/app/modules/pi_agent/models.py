"""Per-run HTTP transports; never update the shared provider health or task routes."""
from __future__ import annotations

import json
import time

import httpx

from .policy import BudgetLedger, ToolError


def model_endpoint(registry, name: str, capability: str):
    config = registry.get_model_config(name)
    if capability not in str(config.get("type", "")).split(","):
        raise ToolError("model_unavailable", f"纯 Agent 的 {capability} 模型尚未配置")
    provider = registry.get_provider(config["provider"])
    if not provider or not getattr(provider, "api_key", None):
        raise ToolError("model_unavailable", f"纯 Agent 的 {capability} 服务商尚未配置")
    return {"name": name, "model": config.get("raw_model") or name.split(":", 1)[-1],
            "provider": config["provider"], "base_url": provider.base_url.rstrip("/"), "key": provider.api_key}


class ModelTransport:
    def __init__(self, registry, settings, ledger: BudgetLedger, emit, *, client=None):
        self.registry, self.settings, self.ledger, self.emit = registry, settings, ledger, emit
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(75, connect=8),
                                                 limits=httpx.Limits(max_connections=2, max_keepalive_connections=2))
        self._call_id = 0
        self._embeddings = {}

    def _begin(self, config, kind, input_units, output, parent):
        if self.ledger.model_requests >= self.ledger.limits.model_requests - 1:
            raise ToolError("research_model_budget_exhausted", "工具模型预算即将用尽，请保留最后一次调用提交回答")
        self._call_id -= 1  # Disjoint from positive Pi reasoning turn IDs.
        call_id = self._call_id
        self.ledger.reserve_model(call_id, input_units, output)
        span = f"model:{call_id}"
        self.emit("model.started", {"turn": call_id, "model": config["model"], "provider": config["provider"],
                  "purpose": kind}, span_id=span, parent_span_id=parent)
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
        config = model_endpoint(self.registry, self.settings.embedding_model, "embedding")
        call_id, span, started = self._begin(config, "embedding", len(query.encode()), 0, parent)
        usage, status = None, "error"
        try:
            response = await self.client.post(config["base_url"] + "/embeddings",
                headers={"Authorization": f"Bearer {config['key']}"},
                json={"model": config["model"], "input": [query]}, timeout=12)
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
            raise ToolError("embedding_unavailable", "查询向量服务未能完成，本次搜索可继续使用词面匹配", retryable=True) from None
        finally:
            self._finish(config, "embedding", started, usage, call_id, span, parent, status)

    async def observe(self, parts: list[dict], *, kind: str, input_units: int, parent: str):
        name = self.settings.audio_model if kind == "audio" else self.settings.vision_model
        config = model_endpoint(self.registry, name, "audio" if kind == "audio" else "vision")
        output_tokens = min(2000, self.ledger.limits.output_tokens)
        call_id, span, started = self._begin(config, kind, input_units, output_tokens, parent)
        usage, status, answer = None, "error", ""
        body = {"model": config["model"], "messages": [{"role": "user", "content": parts}],
                "stream": True, "stream_options": {"include_usage": True}, "max_tokens": output_tokens,
                "temperature": .2}
        if config["provider"] == "aliyun_bailian":
            body["enable_thinking"] = False
            if kind == "audio":
                body["modalities"] = ["text"]
        try:
            async with self.client.stream("POST", config["base_url"] + "/chat/completions",
                    headers={"Authorization": f"Bearer {config['key']}"}, json=body) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    value = json.loads(line[5:])
                    if value.get("error"):
                        raise ValueError("stream_error")
                    usage = value.get("usage") or usage
                    for choice in value.get("choices") or []:
                        answer += choice.get("delta", {}).get("content") or ""
                        status = choice.get("finish_reason") or status
                    if len(answer) > 16000:
                        raise ValueError("observation_too_large")
            if not answer.strip() or status not in {"stop", "end_turn"}:
                raise ValueError("incomplete_observation")
            return answer.strip(), {"model": name, "usage": usage or {}, "input_allowance": input_units}
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise ToolError("media_model_unavailable", "媒体模型未返回完整观察结果，请缩小片段或稍后重试", retryable=True) from None
        finally:
            self._finish(config, kind, started, usage, call_id, span, parent, status)

    async def close(self):
        await self.client.aclose()
