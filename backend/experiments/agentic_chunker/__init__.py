"""Standalone, lossless Agentic Chunker experiment.

This package is deliberately not imported by the ingestion service.  It is an
offline prototype used to validate semantic-boundary chunking before any
production integration is considered.
"""

from .core import (
    AgenticChunker,
    AtomicUnit,
    ChunkPlan,
    ChunkingConfig,
    ChunkingResult,
    DocumentChunk,
    HeuristicPlanningAgent,
    LLMPlanningAgent,
    PlanningError,
    SemanticRelation,
    build_atomic_units,
    estimate_tokens,
)

__all__ = [
    "AgenticChunker",
    "AtomicUnit",
    "ChunkPlan",
    "ChunkingConfig",
    "ChunkingResult",
    "DocumentChunk",
    "HeuristicPlanningAgent",
    "LLMPlanningAgent",
    "PlanningError",
    "SemanticRelation",
    "build_atomic_units",
    "estimate_tokens",
]
