# Conectar ChatGPT y Claude al MCP con OAuth 2.1

Guía operativa del acceso de IA con OAuth. Decisiones y alcance: [SPEC-012](../specs/012-mcp-oauth.md) y [ADR-006](../adr/006-embedded-authorization-server.md).

## Arquitectura

```text
ChatGPT / Claude
   │  OAuth 2.1 (authorization code + PKCE S256, resource = URL del MCP)
   ▼
https://mcp-generador.indexclima.com          (Traefik termina TLS)
   ├── /oauth/*, /.well-known/oauth-authorization-server, /.well-known/openid-configuration
   │        → servicio oauth (Authorization Server integrado, oidc-provider)
   └── /mcp, /.well-known/oauth-protected-resource[/mcp], /health
            → servicio mcp (Resource Server: valida el JWT y los scopes)
                 │  INTERNAL_SERVICE_TOKEN (red interna)
                 ▼
               API → Application → Domain → PostgreSQL / Holded
```

ChatGPT y Claude solo reciben su access token (JWT de 1 hora) y su refresh token. Nunca reciben `INTERNAL_SERVICE_TOKEN`, `HOLDED_API_KEY`, `DATABASE_URL`, `MCP_AUTH_TOKEN` ni la clave de firma.

| Concepto | Valor en producción |
| --- | --- |
| Recurso protegido (`resource`, `aud`) | `https://mcp-generador.indexclima.com/mcp` (= `MCP_PUBLIC_URL`, sin barra final) |
| Issuer | `https://mcp-generador.indexclima.com` (origen de `MCP_PUBLIC_URL`) |
| Protected Resource Metadata (RFC 9728) | `https://mcp-generador.indexclima.com/.well-known/oauth-protected-resource/mcp` (anunciada en el 401) y `…/.well-known/oauth-protected-resource` |
| Metadata del AS (RFC 8414 / OIDC) | `https://mcp-generador.indexclima.com/.well-known/oauth-authorization-server` y `…/.well-known/openid-configuration` |
| Endpoints | `/oauth/authorize`, `/oauth/token`, `/oauth/jwks`, `/oauth/register` (DCR), `/oauth/revoke` |
| Access token | JWT ES256, 1 h, `aud` = recurso, `installation_id`, `scope` |
| Refresh token | 30 días, rotación (reutilizar uno consumido revoca la cadena) |

## Identificación de clientes

1. **CIMD, preferido.** ChatGPT y Claude se identifican con la URL de su Client ID Metadata Document. El AS solo descarga documentos de `AUTH_CIMD_ALLOWED_HOSTS` (por defecto `chatgpt.com,claude.ai,claude.com`), por HTTPS y con protección SSRF. No hay que registrar nada. Documentos verificados el 28-09-2026:
   - ChatGPT: `https://chatgpt.com/oauth/client.json`, `private_key_jwt` con `https://chatgpt.com/oauth/jwks.json`.
   - Claude (web, Desktop, móvil): `https://claude.ai/oauth/mcp-oauth-client-metadata`, cliente público.
   - Claude Code: `https://claude.ai/oauth/claude-code-client-metadata`, loopback en cualquier puerto.
2. **DCR, alternativa** (`/oauth/register`) para clientes sin CIMD (MCP Inspector, SDKs). Solo acepta estos redirects.

Redirect URIs permitidos:

- `https://chatgpt.com/connector_platform_oauth_redirect` (ChatGPT, con `iss` RFC 9207).
- `https://chatgpt.com/connector/oauth/{callback_id}`.
- `https://claude.ai/api/mcp/auth_callback` y `https://claude.com/api/mcp/auth_callback`.
- `http://localhost|127.0.0.1|[::1]:<cualquier puerto>/…` (Claude Code, MCP Inspector).
- Los añadidos en `AUTH_EXTRA_REDIRECT_URIS` (HTTPS exactos).

Ningún `client_id` está fijado en el código.

## Scopes

| Scope | Permite |
| --- | --- |
| `clients:read` | Consultar clientes |
| `clients:write` | Crear/editar clientes (con `holded:write` si sincroniza) |
| `quotes:read` | Consultar presupuestos, catálogos, revisión y previews |
| `quotes:write` | Crear/modificar presupuestos, líneas y ajustes |
| `holded:read` | Estado de Holded y Estimates existentes |
| `holded:write` | Enviar presupuestos a Holded (`sync_quote_to_holded`) |
| `offline_access` | Refresh token (conexión duradera) |

`MCP_SCOPES` es el techo de la instalación: el AS no concede más y el MCP ignora cualquier otro. En la pantalla de consentimiento el propietario puede desmarcar permisos. Por ejemplo, desmarcar `quotes:write` y `holded:write` deja una conexión de solo lectura. El servidor comprueba siempre `tool.scopes ⊆ scopes del token`. Cada tool publica los mismos scopes en `securitySchemes`.

## Variables `.env`

| Variable | Uso |
| --- | --- |
| `MCP_AUTH_MODE` | `oauth` (producción), `bearer` (solo token estático) o `hybrid` (diagnóstico temporal) |
| `COMPOSE_PROFILES` | `mcp,oauth` para levantar MCP y el Authorization Server |
| `MCP_PUBLIC_URL` | URL exacta del MCP que se configura en ChatGPT/Claude |
| `MCP_SCOPES` | Techo de scopes (y scopes del token estático) |
| `AUTH_ISSUER_URL` | Vacío = origen de `MCP_PUBLIC_URL`. Solo se rellena con un IdP externo |
| `AUTH_JWKS_URL` | Vacío = `http://oauth:4003/oauth/jwks` (red interna) |
| `AUTH_ALLOWED_SUBJECTS` | Opcional, útil con IdP externos (`sub` permitidos) |
| `AUTH_SIGNING_KEY` | Clave EC P-256 PKCS#8 PEM en base64. `setup-instance.sh` la genera |
| `AUTH_COOKIE_SECRET` | Secreto de cookies (≥ 32) |
| `AUTH_OWNER_USERNAME` / `AUTH_OWNER_PASSWORD` | Cuenta que autoriza conexiones (contraseña ≥ 16) |
| `AUTH_CIMD_ALLOWED_HOSTS` | Hosts CIMD de confianza |
| `AUTH_EXTRA_REDIRECT_URIS` | Redirects HTTPS adicionales exactos |

Genera los secretos en el servidor sin imprimirlos:

```bash
printf 'AUTH_SIGNING_KEY=%s\n' "$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | openssl base64 -A)" >> .env
printf 'AUTH_COOKIE_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
printf 'AUTH_OWNER_PASSWORD=%s\n' "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)" >> .env
```

Borra antes cualquier línea previa con el mismo nombre (`CHANGE_ME`) y comprueba con `./scripts/preflight.sh`.

## Modos de autenticación

- `oauth`: ChatGPT y Claude con OAuth. `MCP_AUTH_TOKEN` solo se acepta en llamadas directas desde dentro del contenedor MCP (loopback y sin cabeceras de proxy), como `docker compose exec mcp …`. Desde Internet el token estático devuelve 401.
- `bearer`: comportamiento anterior. Solo token estático y sin metadata OAuth.
- `hybrid`: acepta ambos desde Internet. Un JWT nunca se compara con el token estático. Úsalo solo para diagnóstico y vuelve a `oauth`.

## Desplegar

Sigue [deployment.md](deployment.md). En resumen, con `.env` completo:

```bash
./scripts/backup-postgres.sh
git pull --ff-only
./scripts/preflight.sh
./scripts/deploy.sh
```

`migrate` crea la tabla `oauth_artifacts` antes de arrancar `oauth`, `api` y `worker`.

Comprobaciones desde Internet:

```bash
curl -fsS https://mcp-generador.indexclima.com/health
curl -fsS https://mcp-generador.indexclima.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://mcp-generador.indexclima.com/.well-known/oauth-authorization-server
curl -si https://mcp-generador.indexclima.com/mcp -X POST -H 'content-type: application/json' -d '{}' | grep -i www-authenticate
```

`/health` debe devolver `"status":"ok"`, `"toolsEnabled":true` y `"authMode":"oauth"`. El 401 debe incluir `resource_metadata=`. La metadata del AS debe anunciar `code_challenge_methods_supported: ["S256"]`, `authorization_response_iss_parameter_supported: true` y `client_id_metadata_document_supported: true`.

## Probar antes de ChatGPT/Claude

Smoke con el cliente oficial del SDK MCP. Ejecútalo desde un equipo con el repositorio y `npm ci` hecho. Ejecuta DCR, PKCE, login, consentimiento, token, tools, refresh y crea un presupuesto TEST que archiva al final:

```bash
MCP_URL=https://mcp-generador.indexclima.com/mcp AUTH_OWNER_PASSWORD='<contraseña>' node scripts/live-oauth-smoke.mjs
```

MCP Inspector (`npx @modelcontextprotocol/inspector`): añade un servidor Streamable HTTP con la URL del MCP y conecta. Completa el login con `AUTH_OWNER_USERNAME` y `AUTH_OWNER_PASSWORD` y autoriza. Después prueba `tools/list` y una tool de lectura.

## Conectar ChatGPT

Según la documentación de OpenAI, el modo desarrollador está disponible en la web para Plus, Pro, Business, Enterprise y Education, con MCP completo (lectura y escritura). En workspaces depende de la política del administrador.

1. Settings → Security and login → **Developer mode**.
2. [ChatGPT Plugins](https://chatgpt.com/plugins) → **+**. Pon nombre y descripción. En **Connection**, elige endpoint público `https://mcp-generador.indexclima.com/mcp` con autenticación **OAuth**. No introduzcas client ID: ChatGPT usa CIMD.
3. ChatGPT abre la pantalla del Generador. Inicia sesión como propietario, revisa los permisos y autoriza.
4. Revisa las tools descubiertas (**Refresh** tras cambios de metadata).
5. Prueba sin escritura en un chat nuevo: `get_mcp_profile`, `get_holded_status`, `search_clients`, `search_quotes`, `list_holded_estimates` y `get_holded_estimate`.
6. Prueba de escritura controlada, que ChatGPT pedirá confirmar: crea un presupuesto «TEST OAuth», añade una línea TEST, lee el cálculo con `get_quote` y archívalo con `archive_quote`. No uses `sync_quote_to_holded` en pruebas.

## Conectar Claude

Válido para claude.ai, Desktop, móvil y Cowork (misma infraestructura). En Claude Code se usa `claude mcp add`.

1. Claude → **Customize → Connectors → Add custom connector**. Introduce la URL `https://mcp-generador.indexclima.com/mcp` y deja vacíos client ID y secret: Claude usa CIMD.
2. **Connect** abre la misma pantalla de login y consentimiento.
3. Claude refresca el token antes de caducar. Si ves una tarjeta «Connect» en el chat, falta un permiso: reautoriza (step-up con 403 `insufficient_scope`).
4. Claude Code:

   ```bash
   claude mcp add --transport http index-clima https://mcp-generador.indexclima.com/mcp
   ```

   Después ejecuta `/mcp` para autenticarte (redirect loopback).

Anthropic conecta desde `160.79.104.0/21`. No bloquees ese rango en el firewall.

## Revocar o rotar accesos

- **Una conexión:** elimínala en ChatGPT o Claude.
- **Todas las conexiones OAuth** (refresh tokens, grants y sesiones):

  ```bash
  echo "delete from oauth_artifacts where model in ('Grant','RefreshToken','Session','AuthorizationCode');" | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  ```

  Los clientes tendrán que volver a autorizar. Los access tokens emitidos caducan en menos de 1 h.
- **Inmediata y total:** regenera `AUTH_SIGNING_KEY` y ejecuta `./scripts/deploy.sh`. Invalida todos los tokens al instante y cada cliente vuelve a autorizar.
- **Contraseña del propietario:** cambia `AUTH_OWNER_PASSWORD` y ejecuta `docker compose up -d oauth`. Las sesiones abiertas caducan en 14 días. Bórralas con el comando anterior si hace falta.
- **Token estático:** cambia `MCP_AUTH_TOKEN`.

## Volver temporalmente a bearer

Pon `MCP_AUTH_MODE=hybrid` (o `bearer`) y ejecuta `docker compose up -d mcp`. Con `bearer` ChatGPT y Claude dejan de funcionar hasta volver a `oauth`. Para smoke tests no hace falta cambiar de modo:

```bash
docker compose exec -T mcp node --input-type=module < scripts/live-mcp-smoke.mjs
```

## Problemas frecuentes

| Síntoma | Causa |
| --- | --- |
| «Couldn't reach the MCP server» / sin pantalla de login | Traefik no enruta `/oauth/*` o `/.well-known/*` al servicio `oauth` (¿perfil `oauth` activo?) |
| `invalid_redirect_uri` | Cliente con redirect fuera de la lista. Añádelo a `AUTH_EXTRA_REDIRECT_URIS` solo si es de confianza |
| `invalid_client` al usar CIMD | Host no permitido en `AUTH_CIMD_ALLOWED_HOSTS` o el contenedor `oauth` sin salida (`egress`) |
| 401 `invalid_token` tras conectar | `MCP_PUBLIC_URL` distinto de la URL configurada en el cliente (audiencia), o `AUTH_ISSUER_URL` incoherente |
| Tools de escritura con `forbidden` | Permiso desmarcado en el consentimiento: reconecta y márcalo |
