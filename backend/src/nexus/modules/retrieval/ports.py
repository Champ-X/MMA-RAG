from __future__ import annotations

from typing import Protocol

from nexus.modules.retrieval.domain import ChannelQuery, ChannelResult


class RetrievalChannelPort(Protocol):
    name: str

    def search(self, request: ChannelQuery) -> ChannelResult: ...


class ProjectionPublisherPort(Protocol):
    def ensure_release(self) -> dict[str, object]: ...

    def project_pending(self, *, limit: int = 1000) -> dict[str, object]: ...

    def remove_source(self, source_id: str) -> int: ...

    def health(self) -> dict[str, object]: ...
