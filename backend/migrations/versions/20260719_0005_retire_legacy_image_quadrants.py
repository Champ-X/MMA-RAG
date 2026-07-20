"""Retire legacy arbitrary image quadrant evidence.

Revision ID: 20260719_0005
Revises: 20260719_0004
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0005"
down_revision = "20260719_0004"
branch_labels = None
depends_on = None


def _legacy_region_ids(connection: sa.Connection) -> sa.Select:
    content_units = sa.table(
        "content_units",
        sa.column("id", sa.String()),
        sa.column("unit_type", sa.String()),
        sa.column("native_anchor", sa.String()),
    )
    return sa.select(content_units.c.id).where(
        content_units.c.unit_type == "image_region",
        content_units.c.native_anchor.like("image:region-%"),
    )


def upgrade() -> None:
    connection = op.get_bind()
    evidence = sa.table(
        "evidence_revisions",
        sa.column("content_unit_id", sa.String()),
        sa.column("evidence_type", sa.String()),
        sa.column("status", sa.String()),
        sa.column("visible_until_sequence", sa.Integer()),
    )
    publish_counter = sa.table(
        "publish_counter",
        sa.column("singleton", sa.Integer()),
        sa.column("sequence", sa.Integer()),
    )
    current_sequence = connection.execute(
        sa.select(publish_counter.c.sequence).where(publish_counter.c.singleton == 1)
    ).scalar_one_or_none()
    connection.execute(
        sa.update(evidence)
        .where(
            evidence.c.evidence_type == "image_region",
            evidence.c.content_unit_id.in_(_legacy_region_ids(connection)),
            evidence.c.status == "published",
        )
        .values(
            status="tombstoned",
            visible_until_sequence=(current_sequence or 0) + 1,
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    evidence = sa.table(
        "evidence_revisions",
        sa.column("content_unit_id", sa.String()),
        sa.column("evidence_type", sa.String()),
        sa.column("status", sa.String()),
        sa.column("visible_until_sequence", sa.Integer()),
    )
    connection.execute(
        sa.update(evidence)
        .where(
            evidence.c.evidence_type == "image_region",
            evidence.c.content_unit_id.in_(_legacy_region_ids(connection)),
            evidence.c.status == "tombstoned",
        )
        .values(status="published", visible_until_sequence=None)
    )
