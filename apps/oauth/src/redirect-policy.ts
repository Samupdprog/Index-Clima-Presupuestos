/**
 * Redirect URIs admitidas por el Authorization Server (DCR y CIMD), verificadas
 * contra la documentación oficial de cada cliente:
 * - ChatGPT: https://chatgpt.com/connector_platform_oauth_redirect (con RFC 9207)
 *   y https://chatgpt.com/connector/oauth/{callback_id}
 * - Claude (web, Desktop, móvil, Cowork): https://claude.ai/api/mcp/auth_callback
 *   (y claude.com, anunciado como futuro)
 * - Claude Code, MCP Inspector y otros clientes nativos: loopback HTTP en cualquier puerto.
 */
const FIXED = new Set([
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
const CHATGPT_CALLBACK = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackRedirect(uri: string) {
  const url = URL.parse(uri);
  return Boolean(url && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password && !url.hash);
}

export function redirectUriAllowed(uri: string, extra: readonly string[] = []) {
  return FIXED.has(uri) || CHATGPT_CALLBACK.test(uri) || isLoopbackRedirect(uri) || extra.includes(uri);
}

/** Solo se descargan CIMD de hosts de confianza, por HTTPS, sin credenciales ni puerto (anti-SSRF). */
export function cimdFetchAllowed(clientId: string, allowedHosts: readonly string[]) {
  const url = URL.parse(clientId);
  return Boolean(url && url.protocol === "https:" && !url.port && !url.username && !url.password && allowedHosts.includes(url.hostname.toLowerCase()));
}

/**
 * Compara loopback sin puerto (RFC 8252 §7.3). Claude Code publica
 * `http://localhost/callback` y usa un puerto efímero en cada sesión.
 */
export function loopbackMatches(requested: string, registered: readonly string[]) {
  if (!isLoopbackRedirect(requested)) return false;
  const strip = (uri: string) => { const url = new URL(uri); url.port = ""; return url.href; };
  const target = strip(requested);
  return registered.some((uri) => isLoopbackRedirect(uri) && strip(uri) === target);
}
