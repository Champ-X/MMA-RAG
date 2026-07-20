# Nexus database migrations

`20260719_0001` establishes the clean v2 control plane. It intentionally does not
read or migrate legacy MinIO tags, Qdrant payload metadata, or in-memory sessions.

Production startup runs `alembic upgrade head` before the API becomes ready. Future
schema changes follow expand/contract: add nullable structures first, deploy readers
that understand both shapes, backfill, then remove the retired shape in a later
release.
