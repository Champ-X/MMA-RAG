"""Public evidence-policy entry point; frozen v1 and production v2 stay separate."""
from .decision_evidence_incremental import (
    LEGACY_POLICY_VERSION, POLICY_VERSION, PROMPT_VERSION,
    MAX_CANDIDATES, MAX_ADDITIONS, MAX_DOCUMENT_CHARS, MAX_QUERY_CHARS,
    MAX_BASELINE_CHARS, MAX_BASELINE_ITEMS, MAX_INPUT_BYTES,
    MICROBATCH_SIZE, MAX_CONCURRENCY, SIGNAL_THRESHOLD, THRESHOLDS,
    evidence_summary, answer_bearing_question, incremental_questions,
    duplicate_reason, supplement_evidence,
)
