"""Dependency-free Decision route configuration, shared by settings and transport."""
import re
from typing import Literal
from urllib.parse import urlsplit


DecisionProvider = Literal["typesafe", "openrouter", "bailian"]
DECISION_ENDPOINTS = {
    "typesafe": "https://api.typesafe.ai/v1/systemone",
    "openrouter": "https://openrouter.ai/api/alpha/decisions",
    "bailian": "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone",
}
DECISION_DEFAULT_MODELS = {
    "typesafe": "jev-1.13.0",
    "openrouter": "openai/gpt-6-luna-decisions",
    "bailian": "decision-model-preview",
}
# The Bailian trial gateway rejects more than 16 questions (live contract,
# 2026-10-09), despite the public documentation describing 16 as a suggestion.
# Other routes retain the existing application limit of 64 per native request.
DECISION_QUESTION_LIMITS = {"bailian": 16}
DECISION_CREDENTIALS = {
    "typesafe": ("typesafe_api_key", "TYPESAFE_API_KEY"),
    "openrouter": ("openrouter_api_key", "OPENROUTER_API_KEY"),
    "bailian": ("bailian_decision_api_key", "BAILIAN_DECISION_API_KEY"),
}


def validate_bailian_endpoint(endpoint: str) -> str:
    """Only documented official regional gateways can receive the credential."""
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com", parsed.netloc)
            or parsed.path != "/compatible-mode/v1/systemone"
            or parsed.query or parsed.fragment):
        raise ValueError("百炼 Decision 地址须为北京或新加坡的官方业务空间 / 试用 System One HTTPS 地址。")
    return endpoint
