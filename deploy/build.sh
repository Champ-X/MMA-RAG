#!/bin/sh
# Build local application images without requiring installation credentials or .env.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
docker build --build-arg "HTTP_PROXY=${TESSMORA_BUILD_PROXY:-}" --build-arg "HTTPS_PROXY=${TESSMORA_BUILD_PROXY:-}" --build-arg "DEBIAN_MIRROR=${TESSMORA_DEBIAN_MIRROR:-https://deb.debian.org}" -f "$ROOT/deploy/Dockerfile.backend" -t "${TESSMORA_BACKEND_IMAGE:-tessmora-backend:local}" "$ROOT"
docker build --build-arg "HTTP_PROXY=${TESSMORA_BUILD_PROXY:-}" --build-arg "HTTPS_PROXY=${TESSMORA_BUILD_PROXY:-}" -f "$ROOT/deploy/Dockerfile.frontend" -t "${TESSMORA_FRONTEND_IMAGE:-tessmora-frontend:local}" "$ROOT"
