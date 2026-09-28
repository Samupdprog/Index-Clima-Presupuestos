import { createPrivateKey, createPublicKey } from "node:crypto";
import { scopes as MCP_SCOPES, type Scope } from "@quotes/auth";

export interface OAuthServerConfig {
  /** Issuer público exacto (p. ej. https://mcp-generador.indexclima.com). */
  issuer: string;
  /** Recurso protegido único = MCP_PUBLIC_URL. Es el `aud` de todos los access tokens. */
  resource: string;
  /** Techo de scopes de la instalación (MCP_SCOPES). */
  scopes: Scope[];
  installationId: string;
  installationName: string;
  /** Clave privada EC P-256 (JWK) para firmar tokens. */
  signingJwk: JsonWebKey & { kid: string; alg: "ES256"; use: "sig" };
  cookieKeys: string[];
  ownerUsername: string;
  ownerPassword: string;
  /** Hosts cuyos Client ID Metadata Documents se aceptan. */
  cimdAllowedHosts: string[];
  /** Redirect URIs adicionales exactas (además de ChatGPT, Claude y loopback). */
  extraRedirectUris: string[];
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value || value === "CHANGE_ME") throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function list(value: string | undefined) {
  return (value ?? "").split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

/** HTTPS obligatorio salvo en loopback (desarrollo). */
function publicUrl(value: string, name: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error(`${name}_must_use_https`);
  if (url.search || url.hash || url.username || url.password) throw new Error(`invalid_${name}`);
  return url;
}

/**
 * AUTH_SIGNING_KEY: clave privada PKCS#8 PEM (EC P-256), en una línea como base64 del PEM
 * o como PEM literal. Se genera con `scripts/setup-instance.sh`.
 */
export function signingJwkFrom(value: string) {
  const pem = value.includes("BEGIN") ? value.replace(/\\n/g, "\n") : Buffer.from(value, "base64").toString("utf8");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("auth_signing_key_must_be_ec_p256");
  const jwk = key.export({ format: "jwk" }) as JsonWebKey;
  const publicJwk = createPublicKey(key).export({ format: "jwk" }) as JsonWebKey;
  // kid estable derivado de la clave pública: rotar la clave cambia el kid.
  const kid = Buffer.from(`${publicJwk.x}.${publicJwk.y}`).toString("base64url").slice(0, 16);
  return { ...jwk, kid, alg: "ES256" as const, use: "sig" as const };
}

export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthServerConfig {
  const resource = publicUrl(required(env, "MCP_PUBLIC_URL"), "mcp_public_url");
  const issuer = publicUrl(env.AUTH_ISSUER_URL?.trim() || resource.origin, "auth_issuer_url");
  const scopes = list(env.MCP_SCOPES).length ? list(env.MCP_SCOPES) : [...MCP_SCOPES];
  if (scopes.some((scope) => !MCP_SCOPES.includes(scope as Scope))) throw new Error("invalid_mcp_scopes");
  const installationId = required(env, "INSTALLATION_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installationId)) throw new Error("installation_id_required");
  const ownerPassword = required(env, "AUTH_OWNER_PASSWORD");
  if (ownerPassword.length < 16) throw new Error("auth_owner_password_must_have_at_least_16_characters");
  const cookieSecret = required(env, "AUTH_COOKIE_SECRET");
  if (cookieSecret.length < 32) throw new Error("auth_cookie_secret_must_have_at_least_32_characters");
  return {
    // Sin barra final: el `iss` de la respuesta y de los tokens debe coincidir exactamente.
    issuer: issuer.href.replace(/\/$/, ""),
    resource: resource.href,
    scopes: [...new Set(scopes)] as Scope[],
    installationId: installationId.toLowerCase(),
    installationName: env.INSTALLATION_NAME?.trim() || "Index Clima",
    signingJwk: signingJwkFrom(required(env, "AUTH_SIGNING_KEY")),
    cookieKeys: [cookieSecret],
    ownerUsername: env.AUTH_OWNER_USERNAME?.trim() || "index-clima",
    ownerPassword,
    cimdAllowedHosts: list(env.AUTH_CIMD_ALLOWED_HOSTS ?? "chatgpt.com,claude.ai,claude.com").map((host) => host.toLowerCase()),
    extraRedirectUris: list(env.AUTH_EXTRA_REDIRECT_URIS).map((uri) => publicUrl(uri, "auth_extra_redirect_uri").href),
  };
}
