# ADR-006 — Authorization Server OAuth integrado para el MCP

Estado: aceptada (2026-09-28)

## Contexto

ChatGPT (apps y conectores MCP) y Claude (conectores personalizados) se conectan a servidores MCP remotos con OAuth 2.1. La especificación MCP 2025-11-25 exige al servidor actuar como Resource Server (RFC 9728, validación de audiencia RFC 8707). El Authorization Server debe ofrecer authorization code con PKCE S256, `resource` copiado a `aud`, `iss` en la respuesta (RFC 9207), CIMD o DCR, refresh tokens con rotación para clientes públicos y metadata RFC 8414 u OIDC Discovery.

El SDK MCP TypeScript v2 solo aporta la parte de Resource Server. La instalación es de un único propietario, no multi-tenant, y no hay un IdP corporativo. Crear una cuenta en un IdP SaaS añadiría una dependencia externa y configuración manual del `resource`.

## Decisión

- Nuevo servicio `apps/oauth` basado en `oidc-provider` (OpenID Certified™, autor de `jose`). No se implementa criptografía ni protocolo propios. El servicio solo aporta configuración, login del propietario, consentimiento y el adaptador de persistencia.
- Issuer en el mismo host público que el MCP. Traefik enruta `/oauth/*` y la metadata del AS al servicio `oauth`, y el resto al MCP. No requiere DNS nuevo.
- Un único recurso: `MCP_PUBLIC_URL`. Los tokens son JWT ES256 con `aud` igual al recurso e `installation_id`. Cualquier otro `resource` recibe `invalid_target`.
- Clientes: CIMD solo de hosts de confianza (ChatGPT, Claude) y DCR restringido a los redirects documentados de ChatGPT y Claude y a loopback.
- Persistencia en PostgreSQL (`oauth_artifacts`) a través de `packages/db`. MCP sigue sin acceso SQL.
- El MCP valida los JWT con JWKS y es independiente del AS: con `AUTH_ISSUER_URL` y `AUTH_JWKS_URL` puede usarse un IdP externo sin cambios de código.
- `MCP_AUTH_MODE` separa `bearer`, `oauth` e `hybrid`. En `oauth` el token estático solo sirve dentro del contenedor.

## Consecuencias

- Un servicio más (`oauth`, perfil de Compose) y una tabla más.
- La cuenta que autoriza es la del propietario (`AUTH_OWNER_*`). Para varios usuarios, SSO o MFA conviene migrar a un IdP externo. El MCP ya lo soporta.
- Rotar `AUTH_SIGNING_KEY` revoca todos los tokens de inmediato.
- `clientIdMetadataDocument` es una función experimental de oidc-provider (draft-02). Se fija la versión menor de la dependencia y los tests cubren los documentos reales de ChatGPT y Claude.
