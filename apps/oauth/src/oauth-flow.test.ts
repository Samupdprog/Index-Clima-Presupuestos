import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createMcpApplication } from "../../mcp/src/server.js";
import type { GeneratorApi } from "../../mcp/src/api-client.js";
import { loadOAuthConfig } from "./config.js";
import { createOAuthHttpServer, type OAuthStore } from "./server.js";
import { cimdFetchAllowed, loopbackMatches, redirectUriAllowed } from "./redirect-policy.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const ownerPassword = "owner-password-for-tests-1234";
const signingKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();

function memoryStore(): OAuthStore & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (model: string, id: string) => `${model}:${id}`;
  return {
    rows,
    async upsert(model, id, payload, expiresIn) { rows.set(key(model, id), { ...payload, __model: model, __exp: expiresIn ? Date.now() + expiresIn * 1000 : null }); },
    async find(model, id) { const row = rows.get(key(model, id)); if (!row || (row.__exp && (row.__exp as number) < Date.now())) return undefined; const { __model, __exp, ...payload } = row; return payload; },
    async findByUid(model, uid) { for (const [k, row] of rows) if (k.startsWith(`${model}:`) && row.uid === uid) { const { __model, __exp, ...payload } = row; return payload; } return undefined; },
    async findByUserCode() { return undefined; },
    async consume(model, id) { const row = rows.get(key(model, id)); if (row) row.consumed = Math.floor(Date.now() / 1000); },
    async destroy(model, id) { rows.delete(key(model, id)); },
    async revokeByGrantId(grantId) { for (const [k, row] of rows) if (row.grantId === grantId) rows.delete(k); },
  };
}

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });
function track(server: Server) {
  closers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
}

async function stack(env: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const [oauthPort, mcpPort] = [await freePort(), await freePort()];
  const issuer = `http://127.0.0.1:${oauthPort}`;
  const resource = `http://127.0.0.1:${mcpPort}/mcp`;
  const config = loadOAuthConfig({ MCP_PUBLIC_URL: resource, AUTH_ISSUER_URL: issuer, INSTALLATION_ID: installationId, AUTH_SIGNING_KEY: signingKey, AUTH_COOKIE_SECRET: "c".repeat(40), AUTH_OWNER_USERNAME: "owner", AUTH_OWNER_PASSWORD: ownerPassword, MCP_SCOPES: "clients:read quotes:read quotes:write holded:read", ...env });
  const store = memoryStore();
  const { server: oauth } = createOAuthHttpServer(config, store, fetchImpl ? { fetch: fetchImpl } : {});
  await new Promise<void>((resolve) => oauth.listen(oauthPort, "127.0.0.1", resolve));
  track(oauth);
  const api: GeneratorApi = { request: vi.fn().mockResolvedValue([]) };
  const mcp = createMcpApplication({ enabled: true, host: "127.0.0.1", publicUrl: resource, installationId, apiUrl: "http://127.0.0.1:1", serviceToken: "s".repeat(40), authMode: "oauth", authIssuerUrl: issuer, authJwksUrl: `${issuer}/oauth/jwks`, scopes: "clients:read quotes:read quotes:write holded:read", api });
  closers.push(mcp.close);
  const mcpServer = createServer(mcp.app);
  await new Promise<void>((resolve) => mcpServer.listen(mcpPort, "127.0.0.1", resolve));
  track(mcpServer);
  return { issuer, resource, store, api };
}

class Browser {
  cookies = new Map<string, string>();
  async go(url: string, init: RequestInit = {}) {
    const response = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers as Record<string, string>), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = pair!.split("=");
      this.cookies.set(name!.trim(), value.join("="));
    }
    return response;
  }
  /** Sigue redirecciones dentro del AS y se detiene al salir hacia el redirect_uri. */
  async follow(url: string, stopAt: string, init?: RequestInit) {
    let response = await this.go(url, init);
    let location = response.headers.get("location");
    while (response.status >= 300 && response.status < 400 && location && !location.startsWith(stopAt) && !new URL(location, url).pathname.startsWith("/oauth/interaction/")) {
      response = await this.go(new URL(location, url).href);
      location = response.headers.get("location");
    }
    return response;
  }
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function register(issuer: string, redirectUri: string, scope = "clients:read quotes:read quotes:write holded:read offline_access") {
  const response = await fetch(`${issuer}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "TEST MCP client", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope }) });
  return { status: response.status, body: await response.json() as Record<string, string> };
}

async function authorize(issuer: string, resource: string, clientId: string, redirectUri: string, options: { scope?: string; password?: string; uncheck?: string[]; challenge?: string; method?: string } = {}) {
  const browser = new Browser();
  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: options.scope ?? "clients:read quotes:read quotes:write holded:read offline_access", state: "state-123", code_challenge: options.challenge ?? challenge, code_challenge_method: options.method ?? "S256", resource });
  let response = await browser.go(`${issuer}/oauth/authorize?${params}`);
  const start = response.headers.get("location") ?? "";
  if (!new URL(start, issuer).pathname.startsWith("/oauth/interaction/")) return { response, browser, verifier };
  const interaction = new URL(start, issuer).href;
  const loginPage = await browser.go(interaction);
  const html = await loginPage.text();
  response = await browser.follow(`${interaction}/login`, redirectUri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "owner", password: options.password ?? ownerPassword }).toString() });
  if (response.status === 401) return { response, browser, verifier, html };
  const consent = new URL(response.headers.get("location")!, issuer).href;
  const consentHtml = await (await browser.go(consent)).text();
  const scopes = [...consentHtml.matchAll(/name="scope" value="([^"]+)"/g)].map((match) => match[1]!).filter((scope) => !options.uncheck?.includes(scope));
  const form = new URLSearchParams();
  for (const scope of scopes) form.append("scope", scope);
  response = await browser.follow(`${consent}/confirm`, redirectUri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  return { response, browser, verifier, html, consentHtml };
}

async function tokenRequest(issuer: string, body: Record<string, string>) {
  const response = await fetch(`${issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  return { status: response.status, body: await response.json() as Record<string, string> };
}

async function mcp(resource: string, token: string, method: string, params: unknown = {}) {
  const response = await fetch(resource, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  return { status: response.status, body: json ? JSON.parse(json) : null };
}

describe("redirect and CIMD policy", () => {
  it("allows only the documented ChatGPT/Claude callbacks and loopback", () => {
    for (const uri of ["https://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/abc_123", "https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback", "http://localhost:6274/oauth/callback", "http://127.0.0.1:3118/callback"]) expect(redirectUriAllowed(uri)).toBe(true);
    for (const uri of ["https://evil.example.com/callback", "https://chatgpt.com.evil.io/connector_platform_oauth_redirect", "http://example.com/callback", "https://chatgpt.com/connector/oauth/../x", "http://user@localhost/cb"]) expect(redirectUriAllowed(uri)).toBe(false);
    expect(redirectUriAllowed("https://mi-app.example.com/cb", ["https://mi-app.example.com/cb"])).toBe(true);
    expect(loopbackMatches("http://localhost:51234/callback", ["http://localhost/callback"])).toBe(true);
    expect(loopbackMatches("http://localhost:51234/other", ["http://localhost/callback"])).toBe(false);
  });
  it("fetches client metadata documents only from trusted HTTPS hosts", () => {
    const hosts = ["chatgpt.com", "claude.ai"];
    expect(cimdFetchAllowed("https://chatgpt.com/oauth/client.json", hosts)).toBe(true);
    expect(cimdFetchAllowed("https://claude.ai/oauth/mcp-oauth-client-metadata", hosts)).toBe(true);
    for (const id of ["https://evil.example.com/client.json", "http://chatgpt.com/oauth/client.json", "https://chatgpt.com:8443/x", "https://user@chatgpt.com/x", "https://169.254.169.254/latest"]) expect(cimdFetchAllowed(id, hosts)).toBe(false);
  });
});

describe("embedded OAuth 2.1 authorization server", () => {
  let first: Awaited<ReturnType<typeof stack>>;
  beforeAll(() => undefined);

  it("publishes discovery metadata that MCP, ChatGPT and Claude require", async () => {
    first = await stack();
    const prm = await (await fetch(first.resource.replace("/mcp", "/.well-known/oauth-protected-resource/mcp"))).json();
    expect(prm).toMatchObject({ resource: first.resource, authorization_servers: [first.issuer] });
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const metadata = await (await fetch(`${first.issuer}${path}`)).json();
      expect(metadata).toMatchObject({
        issuer: first.issuer,
        authorization_endpoint: `${first.issuer}/oauth/authorize`,
        token_endpoint: `${first.issuer}/oauth/token`,
        jwks_uri: `${first.issuer}/oauth/jwks`,
        registration_endpoint: `${first.issuer}/oauth/register`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
      expect(metadata.token_endpoint_auth_methods_supported).toEqual(expect.arrayContaining(["none", "private_key_jwt"]));
      expect(metadata.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]));
      expect(metadata.scopes_supported).toEqual(expect.arrayContaining(["offline_access", "quotes:read", "quotes:write"]));
    }
  });

  it("runs discovery → DCR → authorize (PKCE S256) → login → consent → token → MCP → refresh", async () => {
    const { issuer, resource, api } = await stack();
    const redirectUri = "http://127.0.0.1:43210/callback";
    const client = await register(issuer, redirectUri);
    expect(client.status).toBe(201);
    const { response, verifier, html, consentHtml } = await authorize(issuer, resource, client.body.client_id!, redirectUri);
    expect(html).toContain("Iniciar sesión");
    expect(consentHtml).toContain("127.0.0.1:43210");
    const callback = new URL(response.headers.get("location")!);
    expect(callback.searchParams.get("iss")).toBe(issuer);
    expect(callback.searchParams.get("state")).toBe("state-123");
    const code = callback.searchParams.get("code")!;
    const tokens = await tokenRequest(issuer, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.body.client_id!, code_verifier: verifier, resource });
    expect(tokens.status).toBe(200);
    expect(tokens.body.refresh_token).toBeTruthy();
    const claims = decodeJwt(tokens.body.access_token!);
    expect(claims).toMatchObject({ iss: issuer, aud: resource, sub: "owner:owner", installation_id: installationId });
    expect(String(claims.scope).split(" ").sort()).toEqual(["clients:read", "holded:read", "quotes:read", "quotes:write"]);

    const list = await mcp(resource, tokens.body.access_token!, "tools/list");
    expect(list.status).toBe(200);
    expect(list.body.result.tools.length).toBeGreaterThan(30);
    const call = await mcp(resource, tokens.body.access_token!, "tools/call", { name: "search_quotes", arguments: { q: "" } });
    expect(call.body.result.structuredContent.ok).toBe(true);
    expect(vi.mocked(api.request).mock.calls[0]![2]).toMatchObject({ subject: "oauth:owner:owner", installationId });

    const refreshed = await tokenRequest(issuer, { grant_type: "refresh_token", refresh_token: tokens.body.refresh_token!, client_id: client.body.client_id! });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(tokens.body.refresh_token);
    expect(decodeJwt(refreshed.body.access_token!)).toMatchObject({ aud: resource });
    expect((await mcp(resource, refreshed.body.access_token!, "tools/list")).status).toBe(200);
    // Rotación: reutilizar el refresh token consumido revoca la cadena.
    const replay = await tokenRequest(issuer, { grant_type: "refresh_token", refresh_token: tokens.body.refresh_token!, client_id: client.body.client_id! });
    expect(replay.body.error).toBe("invalid_grant");
  });

  it("issues a read-only token when the owner unchecks write scopes, and MCP refuses writes", async () => {
    const { issuer, resource } = await stack();
    const redirectUri = "http://localhost:43211/callback";
    const client = await register(issuer, redirectUri);
    const { response, verifier } = await authorize(issuer, resource, client.body.client_id!, redirectUri, { uncheck: ["quotes:write"] });
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    const tokens = await tokenRequest(issuer, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.body.client_id!, code_verifier: verifier, resource });
    expect(String(decodeJwt(tokens.body.access_token!).scope)).not.toContain("quotes:write");
    expect((await mcp(resource, tokens.body.access_token!, "tools/call", { name: "create_quote", arguments: { title: "x" } })).status).toBe(403);
  });

  it("rejects wrong password, missing PKCE, plain PKCE, foreign resource, bad verifier and foreign redirects", async () => {
    const { issuer, resource } = await stack();
    const redirectUri = "http://127.0.0.1:43212/callback";
    const client = await register(issuer, redirectUri);
    const wrong = await authorize(issuer, resource, client.body.client_id!, redirectUri, { password: "incorrecta-000000000" });
    expect(wrong.response.status).toBe(401);

    const noPkce = await new Browser().follow(`${issuer}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: client.body.client_id!, redirect_uri: redirectUri, scope: "quotes:read", resource })}`, redirectUri);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const plain = await authorize(issuer, resource, client.body.client_id!, redirectUri, { method: "plain", challenge: "a".repeat(43) });
    expect(new URL(plain.response.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const foreign = await new Browser().follow(`${issuer}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: client.body.client_id!, redirect_uri: redirectUri, scope: "quotes:read", resource: "https://other.example.com/mcp", code_challenge: pkce().challenge, code_challenge_method: "S256" })}`, redirectUri);
    expect(new URL(foreign.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");

    const ok = await authorize(issuer, resource, client.body.client_id!, redirectUri);
    const code = new URL(ok.response.headers.get("location")!).searchParams.get("code")!;
    const badVerifier = await tokenRequest(issuer, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.body.client_id!, code_verifier: pkce().verifier, resource });
    expect(badVerifier.body.error).toBe("invalid_grant");

    const evil = await register(issuer, "https://evil.example.com/callback");
    expect(evil.status).toBe(400);
    expect(evil.body.error).toBe("invalid_redirect_uri");
  });

  it("never issues tokens for scopes above the installation ceiling", async () => {
    const { issuer, resource } = await stack({ MCP_SCOPES: "quotes:read" });
    const redirectUri = "http://127.0.0.1:43213/callback";
    // DCR con scopes por encima del techo: rechazado.
    const greedy = await register(issuer, redirectUri, "quotes:read quotes:write holded:write");
    expect(greedy.status).toBe(400);
    expect(greedy.body.error).toBe("invalid_client_metadata");
    // Autorización pidiendo más del techo: los scopes ajenos se descartan y no llegan al token.
    const client = await register(issuer, redirectUri, "quotes:read");
    const { response, verifier, consentHtml } = await authorize(issuer, resource, client.body.client_id!, redirectUri, { scope: "quotes:read quotes:write holded:write" });
    expect(consentHtml).not.toContain('value="quotes:write"');
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    const tokens = await tokenRequest(issuer, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.body.client_id!, code_verifier: verifier, resource });
    expect(decodeJwt(tokens.body.access_token!).scope).toBe("quotes:read");
  });
});

// Documentos CIMD reales publicados por ChatGPT y Claude (capturados el 28-09-2026).
const CHATGPT_CIMD = { client_id: "https://chatgpt.com/oauth/client.json", client_uri: "https://chatgpt.com/", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "private_key_jwt", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], client_name: "ChatGPT", token_endpoint_auth_signing_alg: "RS256", jwks_uri: "https://chatgpt.com/oauth/jwks.json" };
const CLAUDE_CIMD = { client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata", client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
const CLAUDE_CODE_CIMD = { client_id: "https://claude.ai/oauth/claude-code-client-metadata", client_name: "Claude Code", client_uri: "https://claude.ai", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };

describe("Client ID Metadata Documents (ChatGPT, Claude, Claude Code)", () => {
  it("authenticates ChatGPT by CIMD with private_key_jwt and returns iss to its redirect", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "chatgpt-test", alg: "RS256", use: "sig" }] };
    const fetched: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      const target = String(url instanceof Request ? url.url : url);
      fetched.push(target);
      const body = target === CHATGPT_CIMD.client_id ? CHATGPT_CIMD : target === CHATGPT_CIMD.jwks_uri ? jwks : null;
      return body ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }) : new Response("not found", { status: 404 });
    }) as typeof fetch;
    const { issuer, resource } = await stack({}, fakeFetch);
    const redirectUri = CHATGPT_CIMD.redirect_uris[0]!;
    const { response, verifier, consentHtml } = await authorize(issuer, resource, CHATGPT_CIMD.client_id, redirectUri);
    expect(consentHtml).toContain("chatgpt.com");
    const callback = new URL(response.headers.get("location")!);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("iss")).toBe(issuer);
    const assertion = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "chatgpt-test" }).setIssuer(CHATGPT_CIMD.client_id).setSubject(CHATGPT_CIMD.client_id).setAudience(issuer).setJti(randomBytes(12).toString("hex")).setIssuedAt().setExpirationTime("2m").sign(privateKey);
    const tokens = await tokenRequest(issuer, { grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: redirectUri, code_verifier: verifier, resource, client_id: CHATGPT_CIMD.client_id, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion });
    expect(tokens.status).toBe(200);
    expect(decodeJwt(tokens.body.access_token!)).toMatchObject({ aud: resource, iss: issuer });
    expect(tokens.body.refresh_token).toBeTruthy();
    expect(fetched).toEqual(expect.arrayContaining([CHATGPT_CIMD.client_id, CHATGPT_CIMD.jwks_uri]));
  });

  it("accepts Claude (public client) and Claude Code loopback on any port", async () => {
    const docs: Record<string, unknown> = { [CLAUDE_CIMD.client_id]: CLAUDE_CIMD, [CLAUDE_CODE_CIMD.client_id]: CLAUDE_CODE_CIMD };
    const fakeFetch = (async (url: string | URL | Request) => {
      const body = docs[String(url instanceof Request ? url.url : url)];
      return body ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
    }) as typeof fetch;
    const { issuer, resource } = await stack({}, fakeFetch);
    for (const [clientId, redirectUri] of [[CLAUDE_CIMD.client_id, "https://claude.ai/api/mcp/auth_callback"], [CLAUDE_CODE_CIMD.client_id, "http://localhost:51234/callback"]] as const) {
      const { response, verifier } = await authorize(issuer, resource, clientId, redirectUri);
      const callback = new URL(response.headers.get("location")!);
      expect(callback.href.startsWith(redirectUri)).toBe(true);
      const tokens = await tokenRequest(issuer, { grant_type: "authorization_code", code: callback.searchParams.get("code")!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource });
      expect(tokens.status).toBe(200);
      expect(tokens.body.refresh_token).toBeTruthy();
    }
  });

  it("never fetches metadata documents from untrusted hosts", async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const { issuer, resource } = await stack({}, fakeFetch);
    const params = new URLSearchParams({ response_type: "code", client_id: "https://evil.example.com/client.json", redirect_uri: "https://evil.example.com/cb", scope: "quotes:read", code_challenge: pkce().challenge, code_challenge_method: "S256", resource });
    const response = await fetch(`${issuer}/oauth/authorize?${params}`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
