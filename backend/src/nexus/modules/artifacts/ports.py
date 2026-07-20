from __future__ import annotations

from typing import Protocol

from nexus.modules.artifacts.domain import ArtifactRefreshProposalView, ArtifactView


class ArtifactRepositoryPort(Protocol):
    def create_artifact(
        self,
        *,
        run_id: str | None,
        title: str,
        artifact_type: str,
        canonical_document: dict[str, object],
        evidence_revision_ids: list[str],
    ) -> ArtifactView: ...

    def get_artifact(self, artifact_id: str) -> ArtifactView: ...

    def create_artifact_from_template(
        self,
        *,
        source_artifact_id: str,
        template_id: str,
        title: str,
        review_text: str | None = None,
    ) -> ArtifactView: ...

    def set_artifact_status(
        self, artifact_id: str, *, status: str, expected_revision_no: int
    ) -> ArtifactView: ...

    def list_artifacts(
        self, *, cursor: str | None, limit: int
    ) -> tuple[list[ArtifactView], str | None]: ...

    def list_artifact_refresh_proposals(
        self, artifact_id: str
    ) -> list[ArtifactRefreshProposalView]: ...

    def resolve_artifact_refresh_proposal(
        self, proposal_id: str, *, accept: bool
    ) -> ArtifactRefreshProposalView: ...
