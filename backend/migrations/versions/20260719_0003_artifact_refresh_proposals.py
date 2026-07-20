"""Add explicit Artifact refresh proposals.

Revision ID: 20260719_0003
Revises: 20260719_0002
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0003"
down_revision = "20260719_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Revision 0001 intentionally bootstraps from reviewed metadata. On a fresh
    # database it therefore sees this later model, while an existing 0002
    # database does not. Keep the expand migration correct in both cases.
    inspector = sa.inspect(op.get_bind())
    if "artifact_refresh_proposals" not in inspector.get_table_names():
        op.create_table(
            "artifact_refresh_proposals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "artifact_id",
                sa.String(36),
                sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "base_revision_id",
                sa.String(36),
                sa.ForeignKey("artifact_revisions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("reason", sa.String(64), nullable=False),
            sa.Column(
                "impacted_evidence_revision_ids", sa.JSON(), nullable=False, server_default="[]"
            ),
            sa.Column("proposed_document", sa.JSON(), nullable=False),
            sa.Column(
                "proposed_evidence_revision_ids", sa.JSON(), nullable=False, server_default="[]"
            ),
            sa.Column("diff", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("resolved_at", sa.DateTime(timezone=True)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_artifact_refresh_proposals_artifact_id",
            "artifact_refresh_proposals",
            ["artifact_id"],
        )
        op.create_index(
            "ix_artifact_refresh_proposals_base_revision_id",
            "artifact_refresh_proposals",
            ["base_revision_id"],
        )
        op.create_index(
            "ix_artifact_refresh_proposals_status",
            "artifact_refresh_proposals",
            ["status"],
        )


def downgrade() -> None:
    op.drop_table("artifact_refresh_proposals")
