import { createHash, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

import { scopes, type Scope } from "@quotes/auth";

/** Fuente única de scopes, compartida con el Authorization Server (`@quotes/auth`). */
export const MCP_SCOPES = scopes;
export type McpScope = Scope;

/**
 * - `bearer`: solo el token estático MCP_AUTH_TOKEN (pruebas, scripts, administración).
 * - `oauth`: solo access tokens JWT del Authorization Server (ChatGPT, Claude). El token estático NO se acepta.
 * - `hybrid`: ambos; un JWT se valida siempre como OAuth y nunca cae al token estático.
 */
export const MCP_AUTH_MODES = ["bearer", "oauth", "hybrid"] as const;
export type McpAuthMode = typeof MCP_AUTH_MODES[number];

export interface McpPrincipal {
  subject: string;
  installationId: string;
  scopes: McpScope[];
}

export function parseScopes(value: string): McpScope[] {
  const entries = value.split(/[\s,]+/).filter(Boolean);
  if (!entries.length || entries.some((entry) => !MCP_SCOPES.includes(entry as McpScope))) throw new Error("invalid_mcp_scopes");
  return [...new Set(entries)] as McpScope[];
}

export function parseAuthMode(value: string | undefined): McpAuthMode {
  const mode = (value?.trim() || "bearer").toLowerCase();
  if (!MCP_AUTH_MODES.includes(mode as McpAuthMode)) throw new Error("invalid_mcp_auth_mode");
  return mode as McpAuthMode;
}

export function createLocalTokenVerifier(options: { token: string; principal: McpPrincipal; resourceUrl: string; expiresAt?: number }): OAuthTokenVerifier {
  if (options.token.length < 32) throw new Error("mcp_auth_token_must_have_at_least_32_characters");
  const digest = createHash("sha256").update(options.token).digest();
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const candidate = createHash("sha256").update(token).digest();
      if (!timingSafeEqual(digest, candidate)) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      return {
        token,
        clientId: options.principal.subject,
        scopes: options.principal.scopes,
        expiresAt: options.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(options.resourceUrl),
        extra: { installationId: options.principal.installationId, authMethod: "bearer" },
      };
    },
  };
}

export interface JwtVerifierOptions {
  /** Issuer exacto del Authorization Server (`iss`). */
  issuer: string;
  /** Recurso canónico = MCP_PUBLIC_URL. El token debe llevarlo en `aud`. */
  resourceUrl: string;
  /** JWKS del Authorization Server, o un resolvedor de claves (tests). */
  jwks: URL | JWTVerifyGetKey;
  installationId: string;
  /** Techo de scopes de la instalación: el token nunca obtiene más. */
  allowedScopes: readonly McpScope[];
  /** Si se define, solo estos `sub` pueden usar el MCP. */
  allowedSubjects?: readonly string[];
}

/**
 * HTTPS obligatorio salvo en loopback (desarrollo y tests) y, si se permite, en un
 * nombre de servicio interno de Docker sin puntos (p. ej. `http://oauth:4003`).
 */
export function assertSecureUrl(value: string, name: string, options: { allowInternalHttp?: boolean } = {}) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`invalid_${name}`); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const internal = options.allowInternalHttp === true && /^[a-z][a-z0-9-]*$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || internal))) throw new Error(`${name}_must_use_https`);
  if (url.hash || url.username || url.password) throw new Error(`invalid_${name}`);
  return url;
}

// Solo firmas asimétricas: un secreto HMAC compartido o `none` no sirven para un resource server público.
const JWT_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

function tokenScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(" ").filter(Boolean);
  if (Array.isArray(payload.scp)) return payload.scp.filter((entry): entry is string => typeof entry === "string");
  if (typeof payload.scp === "string") return payload.scp.split(" ").filter(Boolean);
  return [];
}

/** Identificador auditable del usuario OAuth; sin caracteres de control y de longitud acotada. */
export function oauthSubject(sub: string) {
  return `oauth:${sub.replace(/[^\x21-\x7e]/g, "_").slice(0, 150)}`;
}

/**
 * Valida access tokens JWT (RFC 9068) con JWKS: firma asimétrica, `iss`, `aud` = recurso
 * canónico, `exp`/`nbf`, `sub` y scopes. La instalación la fija la configuración, nunca el token
 * ni los argumentos; un claim `installation_id` distinto se rechaza.
 */
export function createJwtTokenVerifier(options: JwtVerifierOptions): OAuthTokenVerifier {
  // `iss` se compara exactamente con el valor configurado (RFC 8414 / RFC 9207).
  const issuer = options.issuer.trim();
  assertSecureUrl(issuer, "auth_issuer_url");
  const resource = new URL(options.resourceUrl);
  const keys = options.jwks instanceof URL ? createRemoteJWKSet(options.jwks, { timeoutDuration: 5000, cooldownDuration: 30_000 }) : options.jwks;
  const allowedSubjects = options.allowedSubjects?.length ? new Set(options.allowedSubjects) : null;
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, keys, { issuer, audience: resource.href, algorithms: JWT_ALGORITHMS, clockTolerance: 5, requiredClaims: ["exp", "sub"] }));
      } catch (error) {
        const expired = error instanceof joseErrors.JWTExpired;
        throw new OAuthError(OAuthErrorCode.InvalidToken, expired ? "Token has expired" : "Invalid access token");
      }
      const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
      if (!sub) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      if (allowedSubjects && !allowedSubjects.has(sub)) throw new OAuthError(OAuthErrorCode.InvalidToken, "Subject not allowed for this installation");
      if (payload.installation_id !== undefined && payload.installation_id !== options.installationId) throw new OAuthError(OAuthErrorCode.InvalidToken, "Token issued for another installation");
      const granted = new Set(tokenScopes(payload));
      return {
        token,
        clientId: oauthSubject(sub),
        scopes: options.allowedScopes.filter((scope) => granted.has(scope)),
        expiresAt: payload.exp as number,
        resource,
        extra: { installationId: options.installationId, authMethod: "oauth", subject: sub, issuer },
      };
    },
  };
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Selecciona el verificador según el modo. En `hybrid` un JWT nunca se compara con el token estático. */
export function createModeTokenVerifier(mode: McpAuthMode, verifiers: { bearer?: OAuthTokenVerifier; oauth?: OAuthTokenVerifier }): OAuthTokenVerifier {
  const bearer = mode === "oauth" ? undefined : verifiers.bearer;
  const oauth = mode === "bearer" ? undefined : verifiers.oauth;
  if (!bearer && !oauth) throw new Error("mcp_auth_not_configured");
  if ((mode === "hybrid" && (!bearer || !oauth)) || (mode === "oauth" && !oauth) || (mode === "bearer" && !bearer)) throw new Error(`mcp_auth_mode_${mode}_incomplete`);
  return {
    async verifyAccessToken(token) {
      if (JWT_SHAPE.test(token)) {
        if (oauth) return oauth.verifyAccessToken(token);
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      }
      if (bearer) return bearer.verifyAccessToken(token);
      throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
    },
  };
}

/** AuthInfo is supplied only after transport verification; never from tool arguments. */
export function principalFromAuth(auth: AuthInfo | undefined, installationId: string): McpPrincipal {
  if (!auth || auth.extra?.installationId !== installationId) throw new Error("installation_forbidden");
  return { subject: auth.clientId, installationId, scopes: auth.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope)) };
}
