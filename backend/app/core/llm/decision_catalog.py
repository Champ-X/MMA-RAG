"""Explicit Decision routes and response aliases; never a general chat catalog.

The OpenRouter IDs and canonical aliases were observed in the October 8–9,
2026 endpoint studies. Those studies establish short Noul connectivity only,
not RAG quality. The settings connection test checks the richer contract
required by this application. Respan is intentionally excluded: a live probe
confirmed that it only accepts Noul and cannot run the shared Choice stages.
"""
from dataclasses import dataclass
from typing import Literal


DecisionProvider = Literal["typesafe", "openrouter"]
DEFAULT_DECISION_PROVIDER: DecisionProvider = "typesafe"
DEFAULT_DECISION_MODEL = "jev-1.13.0"
DECISION_ENDPOINTS = {
    "typesafe": "https://api.typesafe.ai/v1/systemone",
    "openrouter": "https://openrouter.ai/api/alpha/decisions",
}


@dataclass(frozen=True)
class DecisionModel:
    id: str
    name: str
    provider: DecisionProvider
    response_model_ids: tuple[str, ...] = ()

    def accepts_response_model(self, model: str) -> bool:
        # Deliberately no prefix match: selecting one model must never accept
        # another variant or a silent model fallback from the gateway.
        return model == self.id or model in self.response_model_ids


DECISION_MODELS = (
    DecisionModel("jev-1.13.0", "Jev 1.13 · TypeSafe", "typesafe"),
    DecisionModel("openai/gpt-6-luna-decisions", "OpenAI · GPT-6 Luna Decisions", "openrouter",
                  ("openai/gpt-6-luna-decisions-20261006",)),
    DecisionModel("typesafe/jev-1.13", "TypeSafe · Jev 1.13", "openrouter",
                  ("typesafe/jev-1.13-20260917",)),
    DecisionModel("inception/mercury-decide:free", "Inception · Mercury Decide (free)", "openrouter",
                  ("inception/mercury-decide-20260930",)),
    DecisionModel("perplexity/pplx-decider-v1.1-27b", "Perplexity · Decider V1.1 27B", "openrouter",
                  ("perplexity/pplx-decider-v1.1-27b-20261006",)),
    DecisionModel("liquid/d1", "LiquidAI · d1", "openrouter", ("liquid/d1-20260930",)),
    DecisionModel("cloudflare/clef", "Cloudflare · Clef", "openrouter"),
    DecisionModel("cloudflare/clef-flash", "Cloudflare · Clef Flash", "openrouter"),
    DecisionModel("togethercomputer/tev1-4b-experimental", "Together · Tev1 4B Experimental", "openrouter",
                  ("togethercomputer/tev1-4b-experimental-20260923",)),
    DecisionModel("jaredpalmer/kev-4b", "Jared Palmer · Kev 4B", "openrouter",
                  ("jaredpalmer/kev-4b-20260924",)),
    DecisionModel("upstage/solar-decide-flash", "Upstage · Solar Decide Flash", "openrouter",
                  ("upstage/solar-decide-flash-20261008",)),
    DecisionModel("upstage/solar-decide", "Upstage · Solar Decide", "openrouter",
                  ("upstage/solar-decide-20260928",)),
)


def get_decision_model(provider: str, model: str) -> DecisionModel | None:
    return next((entry for entry in DECISION_MODELS
                 if entry.provider == provider and entry.id == model), None)


def list_decision_models() -> list[dict[str, str]]:
    """Public catalog; credentials and transport internals never enter the API."""
    return [{"id": entry.id, "name": entry.name, "provider": entry.provider}
            for entry in DECISION_MODELS]
