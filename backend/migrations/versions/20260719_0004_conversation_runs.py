"""Add durable multi-turn conversation identity to Runs.

Revision ID: 20260719_0004
Revises: 20260719_0003
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0004"
down_revision = "20260719_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("runs")}
    if "conversation_id" not in columns:
        op.add_column("runs", sa.Column("conversation_id", sa.String(36)))
        op.execute("UPDATE runs SET conversation_id = id WHERE conversation_id IS NULL")
        op.alter_column("runs", "conversation_id", nullable=False)
        op.create_index("ix_runs_conversation_id", "runs", ["conversation_id"])
    if "parent_run_id" not in columns:
        op.add_column(
            "runs",
            sa.Column(
                "parent_run_id",
                sa.String(36),
                sa.ForeignKey("runs.id", ondelete="SET NULL"),
            ),
        )
        op.create_index("ix_runs_parent_run_id", "runs", ["parent_run_id"])
    if "request_context" not in columns:
        op.add_column(
            "runs",
            sa.Column("request_context", sa.JSON(), nullable=False, server_default="{}"),
        )
    if "selected_model_deployment_id" not in columns:
        op.add_column(
            "runs",
            sa.Column(
                "selected_model_deployment_id",
                sa.String(36),
                sa.ForeignKey("model_deployments.id", ondelete="SET NULL"),
            ),
        )
        op.create_index(
            "ix_runs_selected_model_deployment_id",
            "runs",
            ["selected_model_deployment_id"],
        )


def downgrade() -> None:
    op.drop_column("runs", "selected_model_deployment_id")
    op.drop_column("runs", "request_context")
    op.drop_column("runs", "parent_run_id")
    op.drop_column("runs", "conversation_id")
