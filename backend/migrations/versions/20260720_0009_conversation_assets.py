"""Promote Run conversations to durable, user-managed assets.

Revision ID: 20260720_0009
Revises: 20260720_0008
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from nexus.infrastructure.postgres.models import Conversation

revision = "20260720_0009"
down_revision = "20260720_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Conversation.__table__.create(bind=bind, checkfirst=True)

    runs = sa.table(
        "runs",
        sa.column("id", sa.String(36)),
        sa.column("conversation_id", sa.String(36)),
        sa.column("goal", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    rows = list(
        bind.execute(
            sa.select(
                runs.c.id,
                runs.c.conversation_id,
                runs.c.goal,
                runs.c.created_at,
                runs.c.updated_at,
            ).order_by(runs.c.conversation_id, runs.c.created_at, runs.c.id)
        ).mappings()
    )
    existing = set(bind.execute(sa.select(Conversation.id)).scalars())
    grouped: dict[str, list[sa.RowMapping]] = {}
    for row in rows:
        identifier = str(row["conversation_id"])
        if identifier not in existing:
            grouped.setdefault(identifier, []).append(row)
    if grouped:
        bind.execute(
            sa.insert(Conversation),
            [
                {
                    "id": identifier,
                    "title": str(items[0]["goal"])[:160],
                    "pinned": False,
                    "archived": False,
                    "revision": 1,
                    "created_at": items[0]["created_at"],
                    "updated_at": items[0]["created_at"],
                    "last_activity_at": max(item["updated_at"] for item in items),
                }
                for identifier, items in grouped.items()
            ],
        )


def downgrade() -> None:
    Conversation.__table__.drop(bind=op.get_bind(), checkfirst=True)
