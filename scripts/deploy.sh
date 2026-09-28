#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

./scripts/preflight.sh

set -a
# shellcheck disable=SC1091
source .env
set +a

docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1 || {
  echo "ERROR: la red Traefik '$TRAEFIK_NETWORK' no existe."
  exit 1
}

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  build --pull

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --remove-orphans

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  ps
