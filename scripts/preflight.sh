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

has_profile() { case ",${COMPOSE_PROFILES:-}," in *,"$1",*) return 0 ;; *) return 1 ;; esac; }

if [ "${FEATURE_MCP:-false}" = "true" ]; then
  [ -n "${MCP_HOST:-}" ] && [ -n "${MCP_PUBLIC_URL:-}" ] || { echo "ERROR: FEATURE_MCP=true requiere MCP_HOST y MCP_PUBLIC_URL"; exit 1; }
  case "$MCP_PUBLIC_URL" in https://"$MCP_HOST"/*) ;; *) echo "ERROR: MCP_PUBLIC_URL debe ser https://$MCP_HOST/<ruta> (recurso OAuth canónico)"; exit 1 ;; esac
  has_profile mcp || echo "AVISO: FEATURE_MCP=true pero COMPOSE_PROFILES no incluye 'mcp': el contenedor MCP no se levantará."
  MODE="${MCP_AUTH_MODE:-bearer}"
  case "$MODE" in
    bearer|hybrid)
      [ "${#MCP_AUTH_TOKEN}" -ge 32 ] || { echo "ERROR: MCP_AUTH_MODE=$MODE necesita MCP_AUTH_TOKEN de al menos 32 caracteres"; exit 1; } ;;
    oauth) ;;
    *) echo "ERROR: MCP_AUTH_MODE debe ser bearer, oauth o hybrid"; exit 1 ;;
  esac
  if [ -n "${MCP_AUTH_TOKEN:-}" ] && [ "$MCP_AUTH_TOKEN" = "$INTERNAL_SERVICE_TOKEN" ]; then echo "ERROR: MCP_AUTH_TOKEN debe ser distinto de INTERNAL_SERVICE_TOKEN"; exit 1; fi
  [ "$MODE" = "hybrid" ] && echo "AVISO: MCP_AUTH_MODE=hybrid acepta el token estático desde Internet. Úsalo solo temporalmente."
  if [ "$MODE" != "bearer" ]; then
    if has_profile oauth; then
      [ -z "${AUTH_ISSUER_URL:-}" ] || [ "$AUTH_ISSUER_URL" = "https://$MCP_HOST" ] || { echo "ERROR: con el Authorization Server integrado AUTH_ISSUER_URL debe quedar vacío o ser https://$MCP_HOST"; exit 1; }
      [ -n "${AUTH_SIGNING_KEY:-}" ] || { echo "ERROR: falta AUTH_SIGNING_KEY"; exit 1; }
      [ "${#AUTH_COOKIE_SECRET}" -ge 32 ] || { echo "ERROR: AUTH_COOKIE_SECRET necesita al menos 32 caracteres"; exit 1; }
      [ "${#AUTH_OWNER_PASSWORD}" -ge 16 ] || { echo "ERROR: AUTH_OWNER_PASSWORD necesita al menos 16 caracteres"; exit 1; }
      printf '%s' "$AUTH_SIGNING_KEY" | openssl base64 -d -A 2>/dev/null | openssl pkey -noout 2>/dev/null || { echo "ERROR: AUTH_SIGNING_KEY no es una clave privada PEM en base64"; exit 1; }
    else
      [ -n "${AUTH_ISSUER_URL:-}" ] && [ -n "${AUTH_JWKS_URL:-}" ] || { echo "ERROR: sin el perfil 'oauth' (IdP externo) hacen falta AUTH_ISSUER_URL y AUTH_JWKS_URL"; exit 1; }
    fi
  fi
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
