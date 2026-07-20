"""Remove the image-region contract from current whole-image evidence.

Revision ID: 20260719_0006
Revises: 20260719_0005
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0006"
down_revision = "20260719_0005"
branch_labels = None
depends_on = None


def _whole_image_revision_ids() -> sa.Select:
    evidence = sa.table(
        "evidence_revisions",
        sa.column("id", sa.String()),
        sa.column("evidence_type", sa.String()),
    )
    return sa.select(evidence.c.id).where(evidence.c.evidence_type == "whole_image")


def _image_source_version_ids() -> sa.Select:
    versions = sa.table(
        "source_versions",
        sa.column("id", sa.String()),
        sa.column("modality", sa.String()),
    )
    return sa.select(versions.c.id).where(versions.c.modality == "image")


def upgrade() -> None:
    connection = op.get_bind()
    locators = sa.table(
        "evidence_locators",
        sa.column("evidence_revision_id", sa.String()),
        sa.column("locator_type", sa.String()),
        sa.column("bbox", sa.JSON()),
    )
    capabilities = sa.table(
        "capability_readiness",
        sa.column("source_version_id", sa.String()),
        sa.column("capability", sa.String()),
    )
    connection.execute(
        sa.update(locators)
        .where(
            locators.c.evidence_revision_id.in_(_whole_image_revision_ids()),
            locators.c.locator_type == "image_region",
        )
        .values(locator_type="image", bbox=None)
    )
    connection.execute(
        sa.delete(capabilities).where(
            capabilities.c.source_version_id.in_(_image_source_version_ids()),
            capabilities.c.capability == "regions",
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    locators = sa.table(
        "evidence_locators",
        sa.column("evidence_revision_id", sa.String()),
        sa.column("locator_type", sa.String()),
    )
    connection.execute(
        sa.update(locators)
        .where(
            locators.c.evidence_revision_id.in_(_whole_image_revision_ids()),
            locators.c.locator_type == "image",
        )
        .values(locator_type="image_region")
    )
