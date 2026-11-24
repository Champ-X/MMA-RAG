"""Observed source identities and one-based page locators shared by citations."""
from __future__ import annotations

from typing import Any, Mapping


def positive_page(value: Any) -> int | None:
    """Accept explicit positive integer page numbers, never guess from order."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        number = int(value.strip())
        return number if number > 0 else None
    return None


def source_locator_fields(record: Mapping[str, Any] | None) -> dict[str, Any]:
    """Normalize legacy nested payloads without manufacturing missing locators."""
    if not isinstance(record, Mapping):
        return {}
    layers = [record]
    layers.extend(value for key in ("metadata", "debug_info")
                  if isinstance(value := record.get(key), Mapping))
    fields: dict[str, Any] = {}
    for key in ("kb_id", "file_id"):
        value = next((layer[key] for layer in layers
                      if isinstance(layer.get(key), str) and layer[key].strip()), None)
        if value is not None:
            fields[key] = value
    page = next((number for layer in layers for key in ("page_number", "page")
                 if (number := positive_page(layer.get(key))) is not None), None)
    if page is not None:
        fields["page_number"] = page
        end = next((number for layer in layers
                    if (number := positive_page(layer.get("page_end"))) is not None), None)
        if end is not None and end > page:
            fields["page_end"] = end
    return fields
