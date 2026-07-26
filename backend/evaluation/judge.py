"""Independent OpenAI-compatible judge for RAGAS-style generation metrics."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .schema import (
    EvalCase,
    EvaluationDataError,
    EvidenceContext,
    GenerationJudgment,
)


JUDGE_PROMPT_VERSION = "ragas-like-judge-v1"

_SYSTEM_PROMPT = """你是严格且可复现的 RAG 评测裁判。你只依据输入中的问题、参考答案、模型回答与上下文进行判断。

请完成三件事：
1. 将模型回答拆为最小、可独立核验的事实性声明。对每条声明判断它是否能由给定上下文直接支持。不要用常识补足证据；仅仅与参考答案一致也不等于有上下文支持。对于明确表示“资料不足”的回答，也把该表述作为一条声明，并检查上下文是否确实表明信息缺失或未规定。
2. 给 answer_relevance 打 0 到 1 分：只评估回答是否直接、完整地回应问题。不要因为事实正确或错误而重复扣分；空答、答非所问为 0。
3. 按输入顺序判断每段上下文是否有助于回答问题或验证参考答案，输出同样长度的布尔数组 context_relevance。

只输出一个 JSON 对象，不要输出 Markdown。格式必须为：
{"claims":[{"claim":"原子声明","supported":true,"reason":"简短理由"}],"answer_relevance":0.0,"context_relevance":[true,false]}
"""


class JudgeError(RuntimeError):
    """Raised when the judge endpoint cannot return a valid judgment."""


@dataclass(frozen=True)
class JudgeConfig:
    base_url: str
    model: str
    api_key: str = ""
    timeout_seconds: float = 120.0
    max_context_chars: int = 6000

    @classmethod
    def from_environment(
        cls,
        *,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout_seconds: float = 120.0,
    ) -> "JudgeConfig":
        resolved_base_url = (
            base_url or os.getenv("TESSMORA_EVAL_JUDGE_BASE_URL", "")
        ).strip()
        resolved_model = (model or os.getenv("TESSMORA_EVAL_JUDGE_MODEL", "")).strip()
        resolved_api_key = (
            api_key
            if api_key is not None
            else os.getenv("TESSMORA_EVAL_JUDGE_API_KEY", "")
        ).strip()
        if not resolved_base_url:
            raise JudgeError(
                "judge base URL is required via --judge-base-url or "
                "TESSMORA_EVAL_JUDGE_BASE_URL"
            )
        if not resolved_model:
            raise JudgeError(
                "judge model is required via --judge-model or "
                "TESSMORA_EVAL_JUDGE_MODEL"
            )
        if not resolved_base_url.startswith(("http://", "https://")):
            raise JudgeError("judge base URL must be an http(s) URL")
        return cls(
            base_url=resolved_base_url.rstrip("/"),
            model=resolved_model,
            api_key=resolved_api_key,
            timeout_seconds=timeout_seconds,
        )


class OpenAICompatibleJudge:
    """Judge generation output through a separate OpenAI-compatible model."""

    def __init__(self, config: JudgeConfig) -> None:
        self.config = config

    @property
    def metadata(self) -> Dict[str, Any]:
        return {
            "backend": "openai-compatible",
            "model": self.config.model,
            "prompt_version": JUDGE_PROMPT_VERSION,
        }

    def judge(
        self,
        *,
        case: EvalCase,
        answer: str,
        contexts: Sequence[EvidenceContext],
    ) -> GenerationJudgment:
        user_payload = {
            "question": case.question,
            "reference_answer": case.reference_answer,
            "answer": answer,
            "contexts": [
                {
                    "index": index,
                    "document_id": context.document_id,
                    "content": context.content[: self.config.max_context_chars],
                }
                for index, context in enumerate(contexts)
            ],
        }
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ]
        last_error = ""
        for attempt in range(2):
            raw_content = self._complete(messages)
            try:
                raw_judgment = _extract_json_object(raw_content)
                judgment = GenerationJudgment.from_mapping(
                    raw_judgment, "judge_response"
                )
                if len(judgment.context_relevance) != len(contexts):
                    raise EvaluationDataError(
                        "judge_response.context_relevance length does not match contexts"
                    )
                return judgment
            except (EvaluationDataError, ValueError, json.JSONDecodeError) as error:
                last_error = str(error)
                if attempt == 0:
                    messages.extend(
                        (
                            {"role": "assistant", "content": raw_content},
                            {
                                "role": "user",
                                "content": (
                                    "上一个输出不符合 JSON 合同。请修正并只返回合法 JSON；"
                                    f"context_relevance 必须正好有 {len(contexts)} 项。"
                                ),
                            },
                        )
                    )
        raise JudgeError(f"judge returned an invalid response after retry: {last_error}")

    def _complete(self, messages: Sequence[Mapping[str, str]]) -> str:
        endpoint = f"{self.config.base_url}/chat/completions"
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        payload = {
            "model": self.config.model,
            "messages": list(messages),
            "temperature": 0,
        }
        request = Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            raise JudgeError(
                f"judge request failed: HTTP {error.code}: {detail}"
            ) from error
        except (URLError, TimeoutError, OSError, KeyError, IndexError, json.JSONDecodeError) as error:
            raise JudgeError(f"judge request failed: {error}") from error
        if not isinstance(content, str) or not content.strip():
            raise JudgeError("judge returned empty content")
        return content.strip()


def _extract_json_object(text: str) -> Mapping[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        value = json.loads(stripped)
        if isinstance(value, Mapping):
            return value
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, Mapping):
            return value
    raise json.JSONDecodeError("no JSON object found", stripped, 0)
