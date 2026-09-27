# System One Adapter

A drop-in replacement for `typesafe_sdk`'s `system_one` evaluation API, backed by LLM
APIs instead of TypeSafe. 

Useful for comparing TypeSafe against an LLM on
cost/speed/intelligence.

## Install

The provider SDKs are optional extras — install the one(s) you use:

```bash
pip install 'system-one-adapter[openai]'      # OpenAI-compatible providers
pip install 'system-one-adapter[anthropic]'   # native Anthropic
```

## Usage

Unlike `TypeSafeClient`, the client is configured with how the LLM should answer, and
each call names a `provider` alongside the `model`:

```python
from system_one_adapter import SystemOneAdapterClient, Noul, Score, Choice

client = SystemOneAdapterClient(
    structured_outputs=True,  # use the provider's native structured-output mode
    llm_answer_mode="probabilities",  # or "discrete"
    normalize_probabilities=True,
)

response = client.system_one(
    state="This book was a delight to read.",
    questions={"positive": Noul(instructions="The book review is positive.")},
    provider="openai",  # "openai" or "anthropic"
    model="gpt-4o-mini",
)
```

`provider` and `model` may also be set on the constructor as defaults. `provider`
is required unless `model` is a provider instance (e.g. a custom OpenAI-compatible
endpoint):

```python
from system_one_adapter.providers.openai import OpenAIProvider

client.system_one(state, questions, model=OpenAIProvider("grok-4", base_url="https://api.x.ai/v1"))
```

Use clients as context managers (`with` / `async with`), or call `close()` /
`await aclose()` after all evaluations finish. The adapter closes providers it
creates; provider instances passed as `model` remain caller-owned.

OpenAI's endpoint uses the Responses API, with strict JSON Schema for structured
output and JSON mode for prompted output. Custom endpoints (including
`OPENAI_BASE_URL`) default to Chat Completions. Pass `api="responses"` or
`api="chat_completions"` to `OpenAIProvider` / `AsyncOpenAIProvider` to select
explicitly, for example when using an OpenAI proxy. Responses are requested with
`store=False`; corrective retries send the conversation history with each request.

For larger Anthropic evaluations, configure the output token limit on the provider
(default: 4,096 tokens):

```python
from system_one_adapter.providers.anthropic import AnthropicProvider

client.system_one(state, questions, model=AnthropicProvider("claude-haiku-4-5", max_tokens=8192))
```

`AsyncAnthropicProvider` accepts the same option. A response that reaches the limit
raises `typesafe_sdk.TypeSafeError` with instructions to increase `max_tokens` or
request fewer questions; it does not consume malformed-output retries.

### Response

The response is a `typesafe_sdk.SystemOneResponse` subclass — same `answers` and typed
views — with two additions:

- `response.usage` adds `input_tokens_total` / `output_tokens_total` (across retries),
  `n_retries`, `n_retries_malformed_structure`, and `latency`.
- `response.debug` holds `llm_attempts`, `retry_reasons`, and probability-normalization
  diagnostics.

`llm_attempts` records every provider call in order, including transient failures and
malformed responses. Each entry contains a snapshot of `messages`,
`model_request_parameters` (`schema` and `structured`), `llm_response`, and `debug_info`
with the model, provider, and any error. The built-in providers also include the exact
SDK `request` arguments, the full provider response in `llm_response`, and the API and
finish reason in `debug_info`. Custom providers return their text and token counts in
`llm_response`. Calls that fail before returning a model response leave it as `None`.
Terminal `TypeSafeError` exceptions expose the same attempt history in `error.debug`.

To replay an attempt through the same configured provider (use `await` for async):

```python
from system_one_adapter.providers import Message

attempt = response.debug["llm_attempts"][0]
result = provider.request(
    [Message(**message) for message in attempt["messages"]],
    **attempt["model_request_parameters"],
)
```

It is a Pydantic model like every SDK response in `typesafe-sdk>=0.7.0`, so use
`model_dump()` for a dictionary or `model_dump_json()` for JSON:

```python
print(response.model_dump_json())
```

### Async

`AsyncSystemOneAdapterClient` mirrors the sync client with `await client.system_one(...)`
and `async with`.

## Options

| Option | Meaning |
| --- | --- |
| `structured_outputs` | Use the provider's native structured output, else prompt for JSON and validate client-side (works with any chat model). |
| `llm_answer_mode` | `"probabilities"` (per-label distribution) or `"discrete"` (one value per question). |
| `normalize_probabilities` | Rescale invalid LLM probability distributions to sum to 1. |
| `n_retry_malformed_structure` | Corrective retries when the model's output fails schema validation. |
| `retry` | `typesafe_sdk.RetryPolicy` for transient provider failures. |

The transient retry count and time budget apply separately to each provider request.
Corrective requests share the evaluation's `n_retry_malformed_structure` allowance
and preserve the earlier responses and correction messages.
