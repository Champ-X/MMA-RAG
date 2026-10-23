"""Translate only authored prompt text; never traverse user material or evidence."""
from __future__ import annotations

import json
from pathlib import Path

from app.core.prompt_language import get_prompt_language, normalize_language

_TRANSLATIONS = json.loads(Path(__file__).with_name("prompt_translations.json").read_text(encoding="utf-8"))


def translate_prompt(text: str, language: str | None = None) -> str:
    if normalize_language(language if language is not None else get_prompt_language()) != "en-US":
        return text
    if text in _TRANSLATIONS:
        return _TRANSLATIONS[text]
    # A few schema descriptions concatenate shared, complete guidance blocks.
    for original in sorted(_TRANSLATIONS, key=len, reverse=True):
        if original in text:
            text = text.replace(original, _TRANSLATIONS[original])
    return text


def translate_schema(schema, language=None):
    if isinstance(schema, list):
        return [translate_schema(item, language) for item in schema]
    if not isinstance(schema, dict):
        return schema
    return {key: translate_prompt(value, language) if key == "description" and isinstance(value, str)
            else translate_schema(value, language) for key, value in schema.items()}
