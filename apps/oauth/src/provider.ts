import Provider, { errors, type Adapter, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import type { OAuthServerConfig } from "./config.js";
import { cimdFetchAllowed, loopbackMatches, redirectUriAllowed } from "./redirect-policy.js";

export const ROUTE_PREFIX = "/oauth";
const DAY = 24 * 60 * 60;

/** Sujeto OAuth estable del propietario de la instalación (única cuenta que puede autorizar). */
export function ownerAccountId(config: Pick<OAuthServerConfig, "ownerUsername">) {
  return `owner:${config.ownerUsername}`;
}

export function createOAuthProvider(config: OAuthServerConfig, adapter: new (name: string) => Adapter, options: { fetch?: typeof fetch } = {}) {
  const accountId = ownerAccountId(config);
  const configuration: Configuration = {
    adapter: adapter as unknown as Configuration["adapter"],
    // Solo tests: por defecto oidc-provider usa fetch con protección SSRF (sin IP privadas) y timeout.
    ...(options.fetch ? { fetch: options.fetch as Configuration["fetch"] } : {}),
    jwks: { keys: [config.signingJwk as never] },
    cookies: { keys: config.cookieKeys },
    routes: {
      authorization: `${ROUTE_PREFIX}/authorize`,
      token: `${ROUTE_PREFIX}/token`,
      jwks: `${ROUTE_PREFIX}/jwks`,
      registration: `${ROUTE_PREFIX}/register`,
      revocation: `${ROUTE_PREFIX}/revoke`,
      userinfo: `${ROUTE_PREFIX}/userinfo`,
      end_session: `${ROUTE_PREFIX}/logout`,
      pushed_authorization_request: `${ROUTE_PREFIX}/par`,
      introspection: `${ROUTE_PREFIX}/introspect`,
      device_authorization: `${ROUTE_PREFIX}/device`,
      code_verification: `${ROUTE_PREFIX}/device/verify`,
      backchannel_authentication: `${ROUTE_PREFIX}/backchannel`,
      challenge: `${ROUTE_PREFIX}/challenge`,
    },
    interactions: { url: (_ctx, interaction) => `${ROUTE_PREFIX}/interaction/${interaction.uid}` },
    // OAuth 2.1: solo authorization code con PKCE S256 obligatorio para todos los clientes.
    responseTypes: ["code"],
    pkce: { required: () => true },
    clientAuthMethods: ["none", "private_key_jwt", "client_secret_basic", "client_secret_post"],
    clientDefaults: { grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", id_token_signed_response_alg: "ES256" },
    scopes: ["openid", "offline_access"],
    claims: { openid: ["sub"], profile: ["name"] },
    findAccount: async (_ctx, sub) => sub === accountId ? { accountId, claims: async () => ({ sub: accountId, name: config.ownerUsername }) } : undefined,
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
      revocation: { enabled: true },
      userinfo: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => config.resource,
        useGrantedResource: async () => true,
        // Único recurso protegido: el MCP de esta instalación. Otro `resource` se rechaza.
        getResourceServerInfo: async (_ctx: KoaContextWithOIDC, resourceIndicator: string) => {
          if (resourceIndicator !== config.resource) throw new errors.InvalidTarget();
          return { scope: config.scopes.join(" "), audience: config.resource, accessTokenTTL: 3600, accessTokenFormat: "jwt", jwt: { sign: { alg: "ES256" } } };
        },
      },
      clientIdMetadataDocument: {
        enabled: true,
        ack: "draft-02",
        allowFetch: async (_ctx: KoaContextWithOIDC, clientId: string) => cimdFetchAllowed(clientId, config.cimdAllowedHosts),
      },
    },
    extraClientMetadata: {
      properties: ["index_clima_redirect_policy"],
      // Se ejecuta para clientes DCR y CIMD: solo redirects de ChatGPT, Claude y loopback.
      validator(_ctx, key, _value, metadata) {
        if (key !== "index_clima_redirect_policy") return;
        for (const uri of (metadata.redirect_uris as string[] | undefined) ?? []) {
          if (!redirectUriAllowed(uri, config.extraRedirectUris)) throw new errors.InvalidRedirectUri(`redirect_uri no permitido: ${uri}`);
        }
      },
    },
    // Refresh tokens para que ChatGPT/Claude no pidan login continuamente; rotación por defecto de oidc-provider.
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    extraTokenClaims: async (_ctx, token) => token.kind === "AccessToken" ? { installation_id: config.installationId } : undefined,
    ttl: { AccessToken: 3600, AuthorizationCode: 60, IdToken: 3600, Interaction: 600, Grant: 180 * DAY, RefreshToken: 30 * DAY, Session: 14 * DAY },
    renderError: async (ctx, out) => {
      ctx.type = "html";
      const code = String(out.error ?? "error").replace(/[^a-z0-9_]/gi, "");
      ctx.body = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Error de autorización</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>No se pudo completar la autorización</h1><p>Código: <code>${code}</code></p><p>Vuelve a la aplicación y reintenta la conexión.</p></body></html>`;
    },
  };
  const provider = new Provider(config.issuer, configuration);
  // Detrás de Traefik: HTTPS y host los fija el proxy de confianza.
  provider.proxy = true;
  // La metadata del AS (RFC 8414 / OIDC Discovery) anuncia también los scopes del recurso MCP;
  // Claude y ChatGPT la consultan para decidir los scopes y si piden offline_access.
  provider.use(async (ctx, next) => {
    await next();
    if (ctx.path === "/.well-known/openid-configuration" && ctx.status === 200 && ctx.body && typeof ctx.body === "object") {
      const body = ctx.body as Record<string, unknown>;
      body.scopes_supported = [...new Set([...(body.scopes_supported as string[] ?? []), ...config.scopes])];
    }
  });

  // Claude Code declara `http://localhost/callback` en su CIMD (cliente web) y usa un puerto efímero:
  // se admite el mismo loopback con cualquier puerto (RFC 8252 §7.3). El resto sigue siendo coincidencia exacta.
  const clientPrototype = provider.Client.prototype as unknown as { redirectUriAllowed(value: string): boolean; redirectUris?: string[] };
  const exactRedirect = clientPrototype.redirectUriAllowed;
  clientPrototype.redirectUriAllowed = function redirectUriAllowedWithLoopback(value: string) {
    return exactRedirect.call(this, value) || loopbackMatches(value, this.redirectUris ?? []);
  };
  return provider;
}
