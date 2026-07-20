#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"
RUFF="${RUFF:-$ROOT/.venv/bin/ruff}"
ALEMBIC="${ALEMBIC:-$ROOT/.venv/bin/alembic}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nexus-verify.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

for executable in "$PYTHON" "$RUFF" "$ALEMBIC"; do
  if [[ "$executable" == */* ]]; then
    [[ -x "$executable" ]] || {
      echo "Missing executable: $executable" >&2
      exit 1
    }
  elif ! command -v "$executable" >/dev/null 2>&1; then
    echo "Missing command: $executable" >&2
    exit 1
  fi
done
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required for frontend verification." >&2
  exit 1
fi

(
  cd "$ROOT/backend"
  "$RUFF" check src tests/nexus
  "$PYTHON" -m pytest tests/nexus -q
  NEXUS_DATABASE_URL="sqlite:///$TMP_ROOT/migration.db" "$ALEMBIC" upgrade head
  PYTHONPATH=src "$PYTHON" -m nexus.cli openapi "$TMP_ROOT/nexus-v1.json"
)
cmp "$TMP_ROOT/nexus-v1.json" "$ROOT/contracts/openapi/nexus-v1.json"

(
  cd "$ROOT/frontend"
  pnpm exec openapi-typescript ../contracts/openapi/nexus-v1.json -o "$TMP_ROOT/nexus.ts"
  cmp "$TMP_ROOT/nexus.ts" src/generated/nexus.ts
  pnpm run lint
  pnpm run type-check
  pnpm run test
  pnpm run build
)

bash -n "$ROOT/start-dev.sh" "$ROOT/scripts/verify-nexus.sh"
echo "Nexus verification passed."
