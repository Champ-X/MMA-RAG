"""Add durable connected Source sync schedules and execution history.

Revision ID: 20260720_0010
Revises: 20260720_0009
"""
from __future__ import annotations

from alembic import op

from nexus.infrastructure.postgres.models import SourceSyncExecution, SourceSyncSchedule

revision = "20260720_0010"
down_revision = "20260720_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    SourceSyncSchedule.__table__.create(bind=bind, checkfirst=True)
    SourceSyncExecution.__table__.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    SourceSyncExecution.__table__.drop(bind=bind, checkfirst=True)
    SourceSyncSchedule.__table__.drop(bind=bind, checkfirst=True)
