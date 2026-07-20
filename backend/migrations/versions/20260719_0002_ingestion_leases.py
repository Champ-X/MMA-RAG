"""Add authoritative ingestion leases and fencing epochs.

Revision ID: 20260719_0002
Revises: 20260719_0001
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260719_0002"
down_revision = "20260719_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    columns = {column["name"] for column in inspector.get_columns("ingestion_jobs")}
    additions = {
        "owner_worker_id": sa.Column("owner_worker_id", sa.String(255)),
        "lease_expires_at": sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        "execution_epoch": sa.Column(
            "execution_epoch", sa.Integer(), nullable=False, server_default="0"
        ),
        "attempt_count": sa.Column(
            "attempt_count", sa.Integer(), nullable=False, server_default="0"
        ),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("ingestion_jobs", column)
    indexes = {index["name"] for index in inspector.get_indexes("ingestion_jobs")}
    if "ix_ingestion_jobs_owner_worker_id" not in indexes:
        op.create_index(
            "ix_ingestion_jobs_owner_worker_id", "ingestion_jobs", ["owner_worker_id"]
        )
    if "ix_ingestion_jobs_lease_expires_at" not in indexes:
        op.create_index(
            "ix_ingestion_jobs_lease_expires_at", "ingestion_jobs", ["lease_expires_at"]
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("ingestion_jobs")}
    if "ix_ingestion_jobs_lease_expires_at" in indexes:
        op.drop_index("ix_ingestion_jobs_lease_expires_at", table_name="ingestion_jobs")
    if "ix_ingestion_jobs_owner_worker_id" in indexes:
        op.drop_index("ix_ingestion_jobs_owner_worker_id", table_name="ingestion_jobs")
    columns = {column["name"] for column in inspector.get_columns("ingestion_jobs")}
    for name in (
        "attempt_count",
        "execution_epoch",
        "lease_expires_at",
        "owner_worker_id",
    ):
        if name in columns:
            op.drop_column("ingestion_jobs", name)
