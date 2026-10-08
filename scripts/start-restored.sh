#!/usr/bin/env bash
# Compatibility entry point: reuse existing data and never create empty storage.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/start-dev.sh" --restored "$@"
