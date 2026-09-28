// Smoke OAuth 2.1 con el cliente oficial del SDK MCP TypeScript:
// discovery -> DCR -> authorize (PKCE S256 + resource) -> login -> consentimiento -> token (iss RFC 9207)
// -> tools/list -> lecturas -> refresh con rotación -> escritura TEST archivada al final.
// Uso (desde la raíz del repositorio, con node_modules instalados):
//   MCP_URL=https://mcp.example.com/mcp AUTH_OWNER_PASSWORD=... node scripts/live-oauth-smoke.mjs
// Registra un cliente DCR de prueba con redirect loopback. Nunca imprime secretos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";

const fromFile = process.env.OAUTH_ENV_FILE ? Object.fromEntries(readFileSync(process.env.OAUTH_ENV_FILE, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) : {};
const env = { AUTH_OWNER_USERNAME: "index-clima", ...fromFile, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("AUTH_"))) };
assert(env.AUTH_OWNER_PASSWORD, "AUTH_OWNER_PASSWORD requerido");
const MCP_URL = new URL(process.env.MCP_URL ?? "http://localhost:4411/mcp");
const REDIRECT = "http://127.0.0.1:43299/callback";
const secrets = [env.AUTH_OWNER_PASSWORD, env.AUTH_COOKIE_SECRET];
const log = [];

// "Usuario" que completa la pantalla del Authorization Server.
const cookies = new Map();
async function go(url, init = {}) {
  const r = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1)); }
  return r;
}
async function hop(url, init) {
  let r = await go(url, init);
  let loc = r.headers.get("location");
  while (r.status >= 300 && r.status < 400 && loc && !loc.startsWith(REDIRECT) && !new URL(loc, url).pathname.startsWith("/oauth/interaction/")) {
    url = new URL(loc, url).href; r = await go(url); loc = r.headers.get("location");
  }
  return { r, loc: loc && new URL(loc, url).href };
}
async function userAuthorizes(authorizationUrl) {
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.get("resource"), MCP_URL.href);
  log.push(`authorize: scope="${authorizationUrl.searchParams.get("scope")}" resource=${authorizationUrl.searchParams.get("resource")} PKCE=S256`);
  let { loc } = await hop(authorizationUrl.href);
  const loginHtml = await (await go(loc)).text();
  assert.match(loginHtml, /Iniciar sesi/);
  ({ loc } = await hop(`${loc}/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: env.AUTH_OWNER_USERNAME, password: env.AUTH_OWNER_PASSWORD }).toString() }));
  const consentHtml = await (await go(loc)).text();
  assert.match(consentHtml, /Autorizar acceso/);
  const form = new URLSearchParams();
  for (const m of consentHtml.matchAll(/name="scope" value="([^"]+)"/g)) form.append("scope", m[1]);
  log.push(`consent: ${form.getAll("scope").join(" ")}`);
  ({ loc } = await hop(`${loc}/confirm`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() }));
  const callback = new URL(loc);
  assert(callback.href.startsWith(REDIRECT));
  assert.equal(callback.searchParams.get("iss"), authorizationUrl.origin, "RFC 9207 iss");
  return callback.searchParams;
}

const store = {};
let pendingCode;
const provider = {
  get redirectUrl() { return REDIRECT; },
  get clientMetadata() { return { client_name: "SDK OAuth E2E (TEST)", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
  state: () => "e2e-state",
  clientInformation: () => store.client,
  saveClientInformation: (info) => { store.client = info; log.push(`DCR client_id=${info.client_id.slice(0, 8)}...`); },
  tokens: () => store.tokens,
  saveTokens: (t) => { store.tokens = t; },
  redirectToAuthorization: async (url) => { pendingCode = await userAuthorizes(url); },
  saveCodeVerifier: (v) => { store.verifier = v; },
  saveDiscoveryState: (s) => { store.discovery = s; },
  discoveryState: () => store.discovery,
  codeVerifier: () => store.verifier,
};

async function connect() {
  const client = new Client({ name: "oauth-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
  await client.connect(transport);
  return { client, transport };
}

let session;
try {
  session = await connect();
} catch (error) {
  assert(error instanceof UnauthorizedError, `expected UnauthorizedError, got ${error?.message}`);
  const transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
  await transport.finishAuth(pendingCode);
  log.push("callback: code + iss validados por el SDK (RFC 9207)");
  log.push(`token: access=${store.tokens.access_token.split(".").length === 3 ? "JWT" : "opaque"} refresh=${Boolean(store.tokens.refresh_token)} expires_in=${store.tokens.expires_in}`);
  session = await connect();
}
const tools = await session.client.listTools();
log.push(`tools/list: ${tools.tools.length} tools; sync_quote_to_holded securitySchemes=${JSON.stringify(tools.tools.find((t) => t.name === "sync_quote_to_holded")?._meta?.securitySchemes)}`);
const call = async (name, args = {}) => {
  const r = await session.client.callTool({ name, arguments: args });
  const text = JSON.stringify(r);
  for (const s of secrets) assert(!text.includes(s), "secret leak");
  assert(!text.includes(store.tokens.access_token), "token leak");
  return r;
};
const profile = await call("get_mcp_profile");
log.push(`get_mcp_profile: ${JSON.stringify(profile.structuredContent)}`);
for (const [name, args] of [["get_holded_status", {}], ["search_clients", { q: "Prueba" }], ["search_quotes", { q: "P-15" }], ["list_holded_estimates", { limit: 2 }]]) {
  const r = await call(name, args);
  assert(r.structuredContent?.ok, `${name}: ${JSON.stringify(r.structuredContent?.error)}`);
  log.push(`${name}: ok`);
}
const estimates = await call("list_holded_estimates", { limit: 1 });
const detail = await call("get_holded_estimate", { holdedEstimateId: estimates.structuredContent.data.items[0].holdedEstimateId });
log.push(`get_holded_estimate: ${detail.structuredContent.data.documentNumber} total=${detail.structuredContent.data.total}`);

// Refresh: se invalida el access token guardado; el SDK recibe 401, usa el refresh token y reintenta.
const oldRefresh = store.tokens.refresh_token;
store.tokens = { ...store.tokens, access_token: "invalid.access.token" };
await session.transport.close();
session = await connect();
await session.client.listTools();
log.push(`refresh: new access token=${store.tokens.access_token !== "invalid.access.token"} refresh rotated=${store.tokens.refresh_token !== oldRefresh}`);

// Escritura controlada con datos TEST, archivada al terminar.
const created = await call("create_quote", { title: `TEST OAuth ${new Date().toISOString()}` });
const quote = created.structuredContent.data;
assert(quote?.id, JSON.stringify(created.structuredContent));
try {
  const line = await call("add_other_line", { quoteId: quote.id, expectedRevision: quote.revision, line: { description: "TEST linea OAuth", unit: "ud", quantity: "2", igicRate: "7", saleRule: "unit_price", saleRuleValue: "50" } });
  assert(line.structuredContent.ok, JSON.stringify(line.structuredContent.error));
  const read = await call("get_quote", { quoteId: quote.id });
  log.push(`write TEST: ${quote.reference} backend sale=${read.structuredContent.data.calculation.saleWithoutTax} total=${read.structuredContent.data.calculation.saleWithTax}`);
} finally {
  const read = await call("get_quote", { quoteId: quote.id });
  const archived = await call("archive_quote", { quoteId: quote.id, expectedRevision: read.structuredContent.data.revision });
  log.push(`archive TEST: ${archived.structuredContent.ok}`);
}
await session.transport.close();
console.log(JSON.stringify(log, null, 1));
