#!/usr/bin/env bash
set -euo pipefail

[ "$#" -eq 1 ] || { echo "Uso: RESTORE_CONFIRM=YES $0 fichero.dump"; exit 1; }
[ "${RESTORE_CONFIRM:-}" = "YES" ] || { echo "ERROR: falta RESTORE_CONFIRM=YES"; exit 1; }
[ -f "$1" ] || { echo "ERROR: no existe $1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
set -a
source .env
set +a

docker compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-acl < "$1"
