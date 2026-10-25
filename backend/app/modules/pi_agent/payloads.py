"""Model-facing evidence, separate from the immutable audit and display record.

Text is never summarized or silently shortened here. Full acquisition metadata
and display configuration remain in RunStore; evidence needed to interpret or
continue a read stays in the model's packet.
"""
from __future__ import annotations

from .answers import evidence_units


PROVENANCE_FIELDS = frozenset({
    "source_version", "record_version", "truncated", "text_origin",
    "parent_document", "question", "visual_question", "audio_question",
    "observation_key", "observation_keys", "engine", "content_types",
})


def agent_evidence(evidence, *, checked=False):
    value = evidence.model_dump(exclude={"content", "citation", "provenance"})
    value["provenance"] = {key: item for key, item in evidence.provenance.items()
                           if key in PROVENANCE_FIELDS}
    if checked:
        value["content_units"] = evidence_units(evidence)
    else:
        value["content"] = evidence.content
    return value


def source_navigation(source, scope):
    """Directory entries locate files; they do not attest to their contents."""
    public = source.public(scope)
    return {key: public[key] for key in (
        "source_id", "kb_id", "file_name", "modality", "input_material", "searchable")}
