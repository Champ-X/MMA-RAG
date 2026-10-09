"""Bounded citation evidence from the current answer's existing reference map.

Media content here is its already supplied description/transcript. This module
never follows URLs, fetches original media, expands scope, or truncates evidence.
"""

LEGACY_SOURCE_POLICY = 'document_text_v1'
SOURCE_POLICY = 'bounded_reference_text_v2'
SOURCE_SCOPE_RULE = (
    ' source_context identifies the basis of each cited source. For derived_text, '
    'judge only whether the provided description or transcript supports the claim; '
    'the original image, audio or video has NOT been inspected. Do not use world '
    'knowledge or assume a description reports every detail of the original media. '
    'A missing detail in a description is insufficient evidence, not proof that '
    'the detail is absent from the original media.'
)


def prepare_citation_unit(unit, reference_map, *, source_policy=LEGACY_SOURCE_POLICY):
    """Return complete cited text and safe provenance, or a deterministic error."""
    if source_policy not in (LEGACY_SOURCE_POLICY, SOURCE_POLICY):
        raise ValueError('unknown_citation_source_policy')
    claim, ids = unit['claim'], unit['citation_ids']
    if not isinstance(claim, str) or not claim.strip() or len(claim) > 4000:
        return None, {}, {'status': 'not_evaluated', 'reason': 'invalid_claim'}
    if not ids or len(ids) > 10 or any(not isinstance(i, str) for i in ids):
        return None, {}, {'status': 'not_evaluated', 'reason': 'invalid_citation_ids'}
    ids = list(dict.fromkeys(ids))
    missing = [i for i in ids if i not in reference_map]
    if missing:
        return None, {}, {'status': 'not_evaluated', 'reason': 'missing_reference',
                          'missing_ids': missing}
    sources, source_context = {}, {}
    for ref_id in ids:
        ref = reference_map[ref_id]
        kind = ref.get('content_type') if isinstance(ref, dict) else getattr(ref, 'content_type', None)
        content = ref.get('content') if isinstance(ref, dict) else getattr(ref, 'content', None)
        if kind != 'doc' and source_policy == LEGACY_SOURCE_POLICY:
            return None, {}, {'status': 'not_evaluated', 'reason': 'non_text_source'}
        if kind not in ('doc', 'image', 'audio', 'video'):
            return None, {}, {'status': 'not_evaluated', 'reason': 'unsupported_source_type'}
        if not isinstance(content, str) or not content.strip():
            return None, {}, {'status': 'not_evaluated', 'reason': 'empty_source'}
        sources[ref_id] = content
        source_context[ref_id] = {
            'modality': kind, 'basis': 'source_text' if kind == 'doc' else 'derived_text',
        }
    if sum(len(content) for content in sources.values()) > 12000:
        return None, {}, {'status': 'not_evaluated', 'reason': 'source_too_large'}
    data = {'claim': claim, 'cited_sources': sources}
    provenance = {}
    if source_policy == SOURCE_POLICY:
        derived = any(item['basis'] == 'derived_text' for item in source_context.values())
        data['source_context'] = source_context
        provenance = {
            'evidence_basis': 'derived_text' if derived else 'source_text',
            'source_modalities': list(dict.fromkeys(item['modality'] for item in source_context.values())),
            'limitations': ['derived_text_only', 'original_media_not_checked'] if derived else [],
        }
    return data, provenance, None
