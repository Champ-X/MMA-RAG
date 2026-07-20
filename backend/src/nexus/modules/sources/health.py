from __future__ import annotations

from nexus.modules.sources.domain import (
    SourceHealthView,
    SourceIngestionSummaryView,
    SourceProjectionView,
)

_ACTIVE_JOB_STATUSES = {"pending", "running"}
_DEGRADED_CAPABILITIES = {"partial", "failed", "stale"}


def assess_source_health(
    *,
    source_status: str,
    evidence_count: int,
    capabilities: dict[str, str],
    latest_job: SourceIngestionSummaryView | None,
    projection: SourceProjectionView,
) -> SourceHealthView:
    searchable = evidence_count > 0
    if latest_job and latest_job.status in _ACTIVE_JOB_STATUSES:
        return SourceHealthView(
            outcome="refreshing_with_evidence" if searchable else "processing",
            severity="neutral",
            summary=(
                "Existing evidence remains searchable while this material is refreshed."
                if searchable
                else "The original is stored and evidence is still being prepared."
            ),
            searchable=searchable,
            blockers=(),
            primary_action="open_ingestion",
        )

    if source_status == "failed" or (latest_job and latest_job.status == "failed"):
        failure = (
            latest_job.error_message
            if latest_job and latest_job.error_message
            else "The latest ingestion attempt failed."
        )
        return SourceHealthView(
            outcome=(
                "refresh_failed_evidence_available" if searchable else "ingestion_failed"
            ),
            severity="warning" if searchable else "negative",
            summary=(
                "The latest refresh failed, but previously published evidence remains searchable."
                if searchable
                else "The original is retained, but no searchable evidence was published."
            ),
            searchable=searchable,
            blockers=(failure,),
            primary_action="retry_ingestion",
        )

    if not searchable:
        return SourceHealthView(
            outcome="no_published_evidence",
            severity="warning",
            summary="The original is retained, but it has no published evidence yet.",
            searchable=False,
            blockers=("No published Evidence Revision exists for the current source version.",),
            primary_action="reprocess",
        )

    degraded = tuple(
        f"{name.replace('_', ' ')}: {status.replace('_', ' ')}"
        for name, status in sorted(capabilities.items())
        if status in _DEGRADED_CAPABILITIES
    )
    if source_status == "partial" or degraded:
        return SourceHealthView(
            outcome="searchable_with_capability_gaps",
            severity="warning",
            summary=(
                "Published evidence is searchable, but one or more enrichment paths "
                "are degraded."
            ),
            searchable=True,
            blockers=degraded,
            primary_action="inspect_capabilities",
        )

    if projection.state in {"pending", "partial", "failed"}:
        return SourceHealthView(
            outcome="searchable_projection_incomplete",
            severity="warning",
            summary=(
                "Exact evidence search works; advanced semantic or native-media projection "
                "is incomplete."
            ),
            searchable=True,
            blockers=(
                f"Advanced projection is {projection.state.replace('_', ' ')} "
                f"({projection.active_evidence_count}/"
                f"{projection.expected_evidence_count} evidence).",
            ),
            primary_action="open_system_status",
        )

    if projection.state == "not_configured":
        return SourceHealthView(
            outcome="searchable_exact_only",
            severity="neutral",
            summary=(
                "Published evidence is searchable; advanced vector/media projection is "
                "not configured."
            ),
            searchable=True,
            blockers=(),
            primary_action="open_system_status",
        )

    return SourceHealthView(
        outcome="ready",
        severity="positive",
        summary="Evidence is published and the configured retrieval projections are active.",
        searchable=True,
        blockers=(),
        primary_action=None,
    )
