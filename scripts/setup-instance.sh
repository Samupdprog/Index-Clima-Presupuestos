#!/usr/bin/env bash
set -euo pipefail

# Genera un `.env` de producción con secretos aleatorios a partir de
# `.env.example`. Nunca sobrescribe un `.env` existente ni muestra secretos.

if [ "$#" -ne 4 ]; then
  echo "Uso:"
  echo "  $0 INSTANCE_SLUG APP_HOST MCP_HOST ACME_EMAIL"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [ -e "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE ya existe. No se sobrescribe."
  exit 1
fi

SLUG="$1"
APP_HOST="$2"
MCP_HOST="$3"
ACME_EMAIL="$4"

case "$SLUG" in
  *[!a-z0-9-]*|"")
    echo "ERROR: INSTANCE_SLUG solo puede usar a-z, 0-9 y guiones."
    exit 1
    ;;
esac

command -v openssl >/dev/null 2>&1 || {
  echo "ERROR: openssl es necesario para generar secretos."
  exit 1
}

secret() { openssl rand -hex 32; }
uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else
    local h; h="$(openssl rand -hex 16)"
    echo "${h:0:8}-${h:8:4}-4${h:13:3}-a${h:17:3}-${h:20:12}"
  fi
}

POSTGRES_PASSWORD="$(secret)"
declare -A VALUES=(
  [INSTANCE_SLUG]="$SLUG"
  [INSTALLATION_ID]="$(uuid)"
  [INSTALLATION_SLUG]="$SLUG"
  [APP_ACCESS_PASSWORD]="$(secret)"
  [APP_HOST]="$APP_HOST"
  [MCP_HOST]="$MCP_HOST"
  [MCP_PUBLIC_URL]="https://$MCP_HOST/mcp"
  [ACME_EMAIL]="$ACME_EMAIL"
  [POSTGRES_PASSWORD]="$POSTGRES_PASSWORD"
  [DATABASE_URL]="postgresql://quotes:$POSTGRES_PASSWORD@postgres:5432/quotes"
  [INTERNAL_SERVICE_TOKEN]="$(secret)"
  [HOLDED_ENCRYPTION_KEY]="$(secret)"
  [MCP_AUTH_TOKEN]="$(secret)"
)

umask 077
while IFS= read -r line || [ -n "$line" ]; do
  key="${line%%=*}"
  if [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] && [ -n "${VALUES[$key]+set}" ]; then
    printf '%s=%s\n' "$key" "${VALUES[$key]}"
  else
    printf '%s\n' "$line"
  fi
done < "$ROOT/.env.example" > "$ENV_FILE"

chmod 600 "$ENV_FILE"
echo "Creado $ENV_FILE con permisos 600 (INSTALLATION_ID y secretos generados)."
echo "Los secretos no se muestran. Consulta los que necesites con, por ejemplo:"
echo "  grep -E '^(APP_ACCESS_PASSWORD|MCP_AUTH_TOKEN)=' .env"
