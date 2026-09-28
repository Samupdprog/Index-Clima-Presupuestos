#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a
source .env
set +a

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/${INSTANCE_SLUG}-${STAMP}.dump"

docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-acl > "$OUT"

chmod 600 "$OUT"
echo "$OUT"
