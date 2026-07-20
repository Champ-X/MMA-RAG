"""Initial Nexus v2 authoritative control plane.

Revision ID: 20260719_0001
Revises: None
"""
from __future__ import annotations

from alembic import op

from nexus.infrastructure.postgres.models import Base

revision = "20260719_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The model metadata is the reviewed initial contract. Later revisions use
    # explicit expand/contract operations and never mutate this migration.
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
