# SPEC-012 — MCP con OAuth 2.1 para ChatGPT y Claude

Estado: implementada (2026-09-28). Decisión de arquitectura: [ADR-006](../adr/006-embedded-authorization-server.md). Operación: [chatgpt-mcp-oauth.md](../operations/chatgpt-mcp-oauth.md).

## Problema

El MCP solo admitía un bearer estático. ChatGPT (modo desarrollador) y Claude (conectores personalizados) necesitan OAuth 2.1 conforme a la especificación de autorización MCP 2025-11-25 para autenticar al usuario, descubrir herramientas y ejecutar lecturas y escrituras con scopes.

## Alcance

- MCP como Resource Server: validación JWT, metadata RFC 9728, retos `WWW-Authenticate`, `securitySchemes` y tool de perfil.
- Authorization Server integrado (`apps/oauth`) y su persistencia.
- Modos `bearer` / `oauth` / `hybrid`, configuración, despliegue y pruebas.

## Fuera de alcance

- Multiusuario, SSO o MFA: se resuelve con un IdP externo, que el MCP ya admite vía `AUTH_ISSUER_URL`/`AUTH_JWKS_URL`.
- Cambios en dominio, cálculo, Holded o API: OAuth solo autentica y autoriza.

## Comportamiento (verificado con documentación oficial actual)

- 401 sin token o con token inválido: `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<MCP>/.well-known/oauth-protected-resource/mcp"`. Claude y ChatGPT inician el login con él.
- Protected Resource Metadata en la ruta con path, que se anuncia y los clientes prueban primero, y en la raíz (compatibilidad). Campos: `resource` (exacto), `authorization_servers` (un issuer), `scopes_supported` (techo) y `bearer_methods_supported`.
- Validación en cada petición: firma asimétrica con JWKS (sin HS*/`none`), `iss` exacto, `aud` = `MCP_PUBLIC_URL`, `exp`/`nbf` (5 s de tolerancia), `sub`, `installation_id` si existe y allowlist opcional de `sub`. El principal resultante es `oauth:<sub>`, la instalación configurada y los scopes del token ∩ `MCP_SCOPES`.
- Scopes insuficientes en `tools/call`: HTTP 403 con `WWW-Authenticate: Bearer error="insufficient_scope", scope="<concedidos + requeridos>", resource_metadata=…` (step-up MCP; Claude reautoriza) y cuerpo JSON-RPC con `result._meta["mcp/www_authenticate"]` (formato OpenAI). La comprobación dentro de la tool añade el mismo `_meta`.
- `securitySchemes: [{type:"oauth2", scopes: tool.scopes}]` en el descriptor y en `_meta.securitySchemes`, derivados de la misma lista que aplica el servidor. Solo se publica en `oauth`/`hybrid`.
- `get_mcp_profile`: solo lectura, `_meta["openai/profile"]: true`, `{id, name, nickname}`. El `id` es estable (hash de instalación y sujeto) y los scopes efectivos van en texto. Sin tokens ni secretos.
- AS: authorization code con PKCE S256 obligatorio, `iss` en la respuesta, `resource` único → `aud`, CIMD (hosts de confianza), DCR (redirects permitidos), `private_key_jwt`/`none`, refresh tokens (30 días, rotación y revocación por reutilización), consentimiento por scope y login del propietario con límite de intentos.

## Contratos y datos

- Variables nuevas: `MCP_AUTH_MODE`, `AUTH_ISSUER_URL`, `AUTH_JWKS_URL`, `AUTH_ALLOWED_SUBJECTS`, `AUTH_SIGNING_KEY`, `AUTH_COOKIE_SECRET`, `AUTH_OWNER_USERNAME`, `AUTH_OWNER_PASSWORD`, `AUTH_CIMD_ALLOWED_HOSTS`, `AUTH_EXTRA_REDIRECT_URIS` y `OAUTH_PORT`. Eliminadas por no tener uso: `AUTH_AUDIENCE` (la audiencia es siempre `MCP_PUBLIC_URL`) y `MCP_REQUIRED_SCOPES` (los scopes son por tool).
- Migración `0006_oauth_artifacts` (tabla nueva, sin tocar datos existentes).
- Scopes: fuente única en `@quotes/auth`, compartida por MCP y AS.

## Invariantes

- Tokens para otro recurso o issuer: 401. Nunca se reenvían tokens de cliente a la API ni a Holded.
- `installationId` sale de la configuración; ni el token ni los argumentos pueden elegir otra instalación.
- En `oauth` el token estático no es válido desde la red.
- La autoridad económica, Holded y la API no cambian.

## Criterios de aceptación

- [x] Tests MCP: bearer, OAuth válido, expirado, firma, issuer, audiencia (incluido el host sin path), `nbf`, instalación, malformado, HS256/`none`, scopes, modos, metadata, `securitySchemes`, perfil y ausencia de secretos.
- [x] Tests AS: discovery, DCR, PKCE S256 (rechaza ausencia y `plain`), login incorrecto, `invalid_target`, verifier incorrecto, redirect ajeno, techo de scopes, consentimiento parcial, refresh con rotación y detección de reutilización, CIMD reales de ChatGPT (`private_key_jwt`), Claude y Claude Code, y CIMD de host no confiable.
- [x] E2E con el cliente oficial del SDK MCP contra servidores DEV: DCR, PKCE, `iss`, token, tools, lecturas Holded, refresh y escritura TEST archivada.
- [ ] Conexión real desde ChatGPT y Claude en producción, que realiza el propietario con la guía de operación.
