"""Rename tombstoned legacy image locators out of the active contract namespace.

Revision ID: 20260719_0007
Revises: 20260719_0006
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0007"
down_revision = "20260719_0006"
branch_labels = None
depends_on = None


def _retired_revision_ids() -> sa.Select:
    evidence = sa.table(
        "evidence_revisions",
        sa.column("id", sa.String()),
        sa.column("evidence_type", sa.String()),
        sa.column("status", sa.String()),
    )
    return sa.select(evidence.c.id).where(
        evidence.c.evidence_type == "image_region",
        evidence.c.status == "tombstoned",
    )


def upgrade() -> None:
    locators = sa.table(
        "evidence_locators",
        sa.column("evidence_revision_id", sa.String()),
        sa.column("locator_type", sa.String()),
    )
    op.get_bind().execute(
        sa.update(locators)
        .where(
            locators.c.evidence_revision_id.in_(_retired_revision_ids()),
            locators.c.locator_type == "image_region",
        )
        .values(locator_type="retired_image_quadrant")
    )


def downgrade() -> None:
    locators = sa.table(
        "evidence_locators",
        sa.column("evidence_revision_id", sa.String()),
        sa.column("locator_type", sa.String()),
    )
    op.get_bind().execute(
        sa.update(locators)
        .where(
            locators.c.evidence_revision_id.in_(_retired_revision_ids()),
            locators.c.locator_type == "retired_image_quadrant",
        )
        .values(locator_type="image_region")
    )
