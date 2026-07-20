#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---profile}"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if [[ "$MODE" == "--local" ]]; then
  if [[ ! -x "$ROOT/.venv/bin/nexus" ]]; then
    echo "Missing .venv Nexus installation. See README.md local setup." >&2
    exit 1
  fi
  require pnpm
  require node
  DATA_ROOT="${NEXUS_DATA_ROOT:-$ROOT/data/dev-nexus}"
  mkdir -p "$DATA_ROOT/blobs"
  export NEXUS_ENVIRONMENT=development
  export NEXUS_DATABASE_URL="${NEXUS_DATABASE_URL:-sqlite:///$DATA_ROOT/nexus.db}"
  export NEXUS_BLOB_BACKEND="${NEXUS_BLOB_BACKEND:-filesystem}"
  export NEXUS_BLOB_ROOT="${NEXUS_BLOB_ROOT:-$DATA_ROOT/blobs}"
  export NEXUS_QDRANT_URL="${NEXUS_QDRANT_URL:-:memory:}"
  export NEXUS_REDIS_URL="${NEXUS_REDIS_URL:-}"
  export NEXUS_AUTO_CREATE_SCHEMA=true
  export NEXUS_INLINE_WORKER=true
  export NEXUS_BIND_HOST=127.0.0.1

  API_PORT="${NEXUS_API_PORT:-8000}"
  WEB_PORT="${NEXUS_WEB_PORT:-3000}"

  "$ROOT/.venv/bin/nexus" serve --host 127.0.0.1 --port "$API_PORT" &
  api_pid=$!
  (
    cd "$ROOT/frontend"
    VITE_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" pnpm dev --host 127.0.0.1 --port "$WEB_PORT"
  ) &
  web_pid=$!
  cleanup() {
    kill "$api_pid" "$web_pid" 2>/dev/null || true
    wait "$api_pid" "$web_pid" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  echo "Nexus local mode: Web http://127.0.0.1:$WEB_PORT · API http://127.0.0.1:$API_PORT"

  # macOS still ships Bash 3.2, whose `wait` does not support `-n`. Polling
  # the two child PIDs keeps the launcher portable and still exits as soon as
  # either the API or web process stops.
  while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
    sleep 1
  done
  status=0
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || status=$?
  else
    wait "$web_pid" || status=$?
  fi
  exit "$status"
fi

if command -v docker >/dev/null 2>&1; then
  DOCKER_BIN="$(command -v docker)"
elif [[ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]]; then
  DOCKER_BIN="/Applications/Docker.app/Contents/Resources/bin/docker"
else
  echo "Missing required command: docker" >&2
  exit 1
fi
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable." >&2
  exit 1
fi
if [[ "$MODE" != "--profile" ]]; then
  echo "Usage: ./start-dev.sh [--profile lite|standard|full] | --local" >&2
  exit 2
fi
PROFILE="${2:-standard}"
if [[ ! "$PROFILE" =~ ^(lite|standard|full)$ ]]; then
  echo "Unknown profile: $PROFILE" >&2
  exit 2
fi
ENV_FILE="$ROOT/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing backend/.env; copy backend/.env.example first." >&2
  exit 1
fi
cd "$ROOT"
exec "$DOCKER_BIN" compose --env-file "$ENV_FILE" --profile "$PROFILE" up --build
