#!/usr/bin/env bash
# One entry point for the local FastAPI/Vite lifecycle; safe from any cwd.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${MMA_PYTHON:-}" ]]; then
  PYTHON="$MMA_PYTHON"
  [[ -x "$PYTHON" ]] || { echo "MMA_PYTHON is not executable: $PYTHON" >&2; exit 1; }
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
else
  PYTHON="$(command -v python3.12 || command -v python3.11 || command -v python3 || true)"
  [[ -n "$PYTHON" ]] || { echo 'Install Python 3.11/3.12 and create .venv first.' >&2; exit 1; }
fi
exec "$PYTHON" "$ROOT/scripts/dev.py" "$@"
