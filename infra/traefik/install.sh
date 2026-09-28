#!/usr/bin/env sh
set -eu

NETWORK="${TRAEFIK_NETWORK:-app-net}"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  docker network create "$NETWORK"
fi

docker compose up -d
