# Despliegue en servidor

Instalación de producción con Docker Compose y el Traefik compartido del servidor, que termina HTTPS con Let's Encrypt. Todos los servicios publican puertos solo en `127.0.0.1`: el tráfico público entra únicamente por Traefik.

## Requisitos

- Linux con Docker Engine y el plugin `docker compose` v2, `git` y `openssl`.
- DNS: registros A/AAAA de `APP_HOST` (web) y `MCP_HOST` (MCP) apuntando al servidor.
- Puertos 80/443 gestionados por un único reverse proxy. Si el servidor es desconocido, audítalo primero con `sudo ./infra/server-audit/audit.sh`.

## Instalación desde cero

```bash
git clone https://github.com/Samupdprog/Index-Clima-Presupuestos.git
cd Index-Clima-Presupuestos

# Genera .env con INSTALLATION_ID, contraseñas y tokens aleatorios (no los muestra).
./scripts/setup-instance.sh index-clima presupuestos.example.com mcp.example.com admin@example.com
```

Como alternativa, ejecuta `cp .env.example .env` y sustituye cada `CHANGE_ME` a mano (`openssl rand -hex 32` para secretos y `cat /proc/sys/kernel/random/uuid` para `INSTALLATION_ID`).

Revisa `.env`:

- `INSTALLATION_NAME` y `APP_ACCESS_USERNAME`.
- `FEATURE_MCP`, `MCP_AUTH_MODE=oauth` y `COMPOSE_PROFILES=mcp,oauth` para publicar el MCP con OAuth (ChatGPT y Claude). Si no quieres IA, pon `FEATURE_MCP=false` y deja `COMPOSE_PROFILES` vacío.
- `MCP_SCOPES`: techo de permisos. Para una IA que solo consulte: `quotes:read,clients:read,holded:read`.
- `AUTH_OWNER_USERNAME`: la contraseña `AUTH_OWNER_PASSWORD` es la que se usa para autorizar ChatGPT y Claude.
- `TRAEFIK_NETWORK`, la red Docker del Traefik existente (por defecto `app-net`).

Si el servidor todavía no tiene Traefik, instálalo una sola vez para todo el servidor:

```bash
cd infra/traefik
cp .env.example .env    # ACME_EMAIL y TRAEFIK_NETWORK
./install.sh
cd ../..
```

No instales un segundo Traefik si ya hay un proxy en 80/443.

Comprueba y despliega:

```bash
./scripts/preflight.sh
./scripts/deploy.sh
```

`deploy.sh` equivale a `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. El orden de arranque es automático:

1. `postgres` arranca y espera a estar healthy.
2. `migrate` (one-shot) aplica las migraciones y crea o actualiza la fila `installations` con `INSTALLATION_ID`. Es idempotente y no inserta datos demo.
3. `api`, `worker` y `oauth` arrancan solo si `migrate` termina con éxito. Después arrancan `web` y `mcp`.

## Verificación

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -fsS https://presupuestos.example.com/api/health
curl -fsS https://mcp.example.com/health     # {"status":"ok","service":"mcp","toolsEnabled":true,"authMode":"oauth"}
curl -fsS https://mcp.example.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://mcp.example.com/.well-known/oauth-authorization-server
```

Abre `https://APP_HOST`. El navegador pedirá `APP_ACCESS_USERNAME` y `APP_ACCESS_PASSWORD`, que puedes consultar con `grep ^APP_ACCESS_PASSWORD= .env`.

## Holded

1. En la web: Configuración → Holded. Pega la API key; se guarda cifrada con `HOLDED_ENCRYPTION_KEY` y la web solo muestra una máscara.
2. La clave necesita los permisos `contacts:contacts.read/write`, `sales:estimates.read/write` y `accounting:taxes.read`.
3. Pulsa "Comprobar conexión" y asigna los impuestos IGIC normales (`s_igic_0`, `s_igic_3`, `s_igic_7`, `s_igic_15` en la cuenta probada).

No cambies `HOLDED_ENCRYPTION_KEY` después de guardar la clave: dejaría de poder descifrarse y habría que volver a introducirla. `HOLDED_API_KEY` en `.env` es un fallback opcional.

## Cliente MCP

- ChatGPT y Claude: URL `MCP_PUBLIC_URL` con autenticación OAuth. Sigue [chatgpt-mcp-oauth.md](chatgpt-mcp-oauth.md).
- Clientes propios sin OAuth: `MCP_AUTH_MODE=bearer` (o `hybrid` temporalmente) con la cabecera `Authorization: Bearer <MCP_AUTH_TOKEN>`.
- La IA descubre las herramientas y la guía `generator://guide`. Con `holded:read` puede consultar los Estimates existentes; enviar a Holded requiere `quotes:write` y `holded:write`.

Prueba completa del MCP. Crea un presupuesto `TEST`, lo archiva al terminar y solo lee Holded:

```bash
docker compose exec -T mcp node --input-type=module < scripts/live-mcp-smoke.mjs
```

## Actualización

```bash
git pull --ff-only
./scripts/backup-postgres.sh
./scripts/deploy.sh
```

Las migraciones pendientes se aplican solas antes de arrancar la API. También se pueden lanzar a mano con `docker compose run --rm migrate`.

## Persistencia y backups

- PostgreSQL usa el volumen con nombre `${INSTANCE_SLUG}-postgres-data`. Recrear contenedores, reconstruir imágenes o reiniciar el servidor no lo borra.
- Nunca ejecutes `docker compose down -v` salvo que quieras borrar la base de datos.
- Para backups y restauración, consulta [backup-restore.md](backup-restore.md).

## Otro reverse proxy

Sin Traefik, usa solo `docker-compose.yml` y apunta tu proxy HTTPS (Nginx, Caddy…) a `127.0.0.1:${WEB_PORT}` y `127.0.0.1:${MCP_PORT}`. En el host del MCP, envía `/oauth/*`, `/.well-known/oauth-authorization-server` y `/.well-known/openid-configuration` a `127.0.0.1:${OAUTH_PORT}` y conserva `X-Forwarded-Proto`/`Host`. En este modo define igualmente `APP_ACCESS_PASSWORD`, porque la web no tiene otra autenticación. Mantén `MCP_PUBLIC_URL` igual a la URL pública exacta: su host es el único `Host` público que acepta el MCP.

## Logs

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200 api mcp
```

Los logs registran método, ruta sin query, estado y duración de las llamadas a Holded. Nunca registran API keys, cabeceras `Authorization`, tokens MCP ni `DATABASE_URL`.

La red `private` es interna (PostgreSQL, API y worker). API y worker salen a Internet por `egress` para llamar a Holded. Web y MCP están en `public`, la red de Traefik en producción.
