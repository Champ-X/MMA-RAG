"""Add PostgreSQL saved Collections / Views.

Revision ID: 20260720_0008
Revises: 20260719_0007
"""
from __future__ import annotations

from alembic import op

from nexus.infrastructure.postgres.models import (
    Collection,
    CollectionRule,
    CollectionSourceLink,
)

revision = "20260720_0008"
down_revision = "20260719_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Fresh databases import current Base metadata from 0001; checkfirst keeps
    # the historical bootstrap migration and this expand migration compatible.
    Collection.__table__.create(bind=bind, checkfirst=True)
    CollectionSourceLink.__table__.create(bind=bind, checkfirst=True)
    CollectionRule.__table__.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    CollectionRule.__table__.drop(bind=bind, checkfirst=True)
    CollectionSourceLink.__table__.drop(bind=bind, checkfirst=True)
    Collection.__table__.drop(bind=bind, checkfirst=True)
