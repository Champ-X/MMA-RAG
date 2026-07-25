"""Agentic knowledge runtime.

The runtime is intentionally layered on top of the existing retrieval and
generation services.  It does not own a second index or a second citation
format, so enabling Agent mode cannot silently downgrade multimodal recall.
"""

from .service import AgenticRetrievalService

__all__ = ["AgenticRetrievalService"]
