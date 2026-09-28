#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "ERROR: falta Docker"; exit 1; }
docker compose version >/dev/null

[ -f .env ] || { echo "ERROR: falta .env. Usa scripts/setup-instance.sh"; exit 1; }

if grep -Eq '^[A-Z0-9_]+=.*CHANGE_ME' .env; then
  echo "ERROR: .env contiene valores CHANGE_ME:"
  grep -Eo '^[A-Z0-9_]+=.*CHANGE_ME' .env | cut -d= -f1 | sed 's/^/  - /'
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

for name in INSTANCE_SLUG INSTALLATION_ID APP_HOST POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL INTERNAL_SERVICE_TOKEN APP_ACCESS_PASSWORD; do
  [ -n "${!name:-}" ] || { echo "ERROR: $name está vacío"; exit 1; }
done

[[ "$INSTALLATION_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "ERROR: INSTALLATION_ID debe ser un UUID en minúsculas"; exit 1; }
[ "${#INTERNAL_SERVICE_TOKEN}" -ge 32 ] || { echo "ERROR: INTERNAL_SERVICE_TOKEN necesita al menos 32 caracteres"; exit 1; }
[ -n "${HOLDED_ENCRYPTION_KEY:-}" ] || echo "AVISO: HOLDED_ENCRYPTION_KEY vacío; la clave de Holded se cifrará con un secreto derivado de INTERNAL_SERVICE_TOKEN."

if [ "${FEATURE_MCP:-false}" = "true" ]; then
  [ -n "${MCP_HOST:-}" ] && [ -n "${MCP_PUBLIC_URL:-}" ] || { echo "ERROR: FEATURE_MCP=true requiere MCP_HOST y MCP_PUBLIC_URL"; exit 1; }
  [ "${#MCP_AUTH_TOKEN}" -ge 32 ] || { echo "ERROR: MCP_AUTH_TOKEN necesita al menos 32 caracteres"; exit 1; }
  [ "$MCP_AUTH_TOKEN" != "$INTERNAL_SERVICE_TOKEN" ] || { echo "ERROR: MCP_AUTH_TOKEN debe ser distinto de INTERNAL_SERVICE_TOKEN"; exit 1; }
  case ",${COMPOSE_PROFILES:-}," in
    *,mcp,*) ;;
    *) echo "AVISO: FEATURE_MCP=true pero COMPOSE_PROFILES no incluye 'mcp': el contenedor MCP no se levantará." ;;
  esac
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
echo "Compose producción: OK"

if docker network inspect "${TRAEFIK_NETWORK:-app-net}" >/dev/null 2>&1; then
  echo "Red Traefik ${TRAEFIK_NETWORK:-app-net}: OK"
else
  echo "AVISO: no existe la red ${TRAEFIK_NETWORK:-app-net}."
  echo "En producción debes usar un Traefik existente o instalar infra/traefik."
fi

if ss -lnt 2>/dev/null | grep -Eq ':(80|443)[[:space:]]'; then
  echo "Información: 80/443 ya están en uso; revisa qué proxy los gestiona antes de instalar otro."
fi

echo "Preflight completado."
