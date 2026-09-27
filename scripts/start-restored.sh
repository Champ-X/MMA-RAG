#!/usr/bin/env bash
# Run the restored local dataset without starting ingestion workers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PYTHON="${MMA_PYTHON:-$ROOT/.venv/bin/python}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
[[ -x "$PYTHON" ]] || { echo 'Set MMA_PYTHON to the backend virtualenv Python.' >&2; exit 1; }
[[ -f backend/.env && -d minio_data && -d qdrant_storage/collections ]] || {
  echo 'Missing backend/.env or restored storage directories.' >&2; exit 1;
}
"$PYTHON" - "$FRONTEND_PORT" <<'PY'
import socket,sys
for port in (8000,int(sys.argv[1])):
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try: sock.bind(('127.0.0.1',port))
        except OSError: sys.exit(f'Port {port} is already in use. Stop the existing app before starting another instance.')
PY
if [[ -z "${MMA_DOCKER_CONTEXT:-}" ]]; then
  if docker context inspect colima-mma-rag >/dev/null 2>&1; then
    MMA_DOCKER_CONTEXT=colima-mma-rag
  else
    MMA_DOCKER_CONTEXT="$(docker context show)"
  fi
fi
# Keep both Docker Compose variants on the same named daemon. These environment
# changes affect this script only, not the user's global Docker context.
export DOCKER_CONTEXT="$MMA_DOCKER_CONTEXT"
unset DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
DOCKER=(docker --context "$MMA_DOCKER_CONTEXT")
if ! "${DOCKER[@]}" info >/dev/null 2>&1; then
  if [[ "$MMA_DOCKER_CONTEXT" == colima-mma-rag ]] && command -v colima >/dev/null; then
    colima start --profile mma-rag --activate=false
  else
    echo "Start Docker context '$MMA_DOCKER_CONTEXT' first, or set MMA_DOCKER_CONTEXT." >&2; exit 1
  fi
fi
"${DOCKER[@]}" info >/dev/null 2>&1 || { echo "Docker context '$MMA_DOCKER_CONTEXT' is unavailable." >&2; exit 1; }
docker_endpoint="$("${DOCKER[@]}" context inspect "$MMA_DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')"
[[ "$docker_endpoint" == unix://* ]] || {
  echo 'Restored local directories and localhost health checks require a local Unix-socket Docker context.' >&2; exit 1;
}
if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
else
  COMPOSE=(docker-compose)
fi
echo "Docker context: $MMA_DOCKER_CONTEXT"
"${COMPOSE[@]}" -p feat-jev-optm-2 -f "$ROOT/docker-compose.yml" --env-file "$ROOT/backend/.env" up -d minio qdrant redis
for storage in minio qdrant; do
  if [[ "$storage" == minio ]]; then url=http://127.0.0.1:9000/minio/health/live; else url=http://127.0.0.1:6333/healthz; fi
  ready=0
  for ((attempt=0; attempt<60; attempt++)); do
    if "${DOCKER[@]}" inspect --format '{{.State.Running}}' "mmrag_$storage" 2>/dev/null | grep -qx true \
      && curl --noproxy '*' -fsS "$url" >/dev/null; then ready=1; break; fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || { echo "Storage not ready: $url" >&2; exit 1; }
done
"${DOCKER[@]}" exec mmrag_redis redis-cli ping | grep -q PONG
mkdir -p logs
backend_pid=''; frontend_pid=''
cleanup() {
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
  [[ -z "$frontend_pid" ]] || kill "$frontend_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
(cd backend && exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) >logs/restored-backend.log 2>&1 &
backend_pid=$!
ready=0
for ((attempt=0; attempt<90; attempt++)); do
  kill -0 "$backend_pid" 2>/dev/null || { tail -30 logs/restored-backend.log; exit 1; }
  if curl --noproxy '*' -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Backend startup timed out; see logs/restored-backend.log' >&2; exit 1; }
[[ -x frontend/node_modules/.bin/vite ]] || (cd frontend && npm ci)
(cd frontend && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort) >logs/restored-frontend.log 2>&1 &
frontend_pid=$!
ready=0
for ((attempt=0; attempt<30; attempt++)); do
  kill -0 "$frontend_pid" 2>/dev/null || { cat logs/restored-frontend.log; exit 1; }
  if curl --noproxy '*' -fsS "http://127.0.0.1:$FRONTEND_PORT" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Frontend startup timed out.' >&2; exit 1; }
echo "Tessmora: http://localhost:$FRONTEND_PORT (API: http://localhost:8000)"
echo 'Logs: logs/restored-backend.log and logs/restored-frontend.log. Ctrl+C stops the app; storage stays running.'
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do sleep 2; done
exit 1
