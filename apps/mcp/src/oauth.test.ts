import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { createMcpApplication, profileFor, type McpAppOptions } from "./server.js";
import type { GeneratorApi } from "./api-client.js";
import { MCP_SCOPES, parseAuthMode } from "./auth.js";
import { generatorTools } from "./tools.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const resource = "https://mcp-generador.indexclima.com/mcp";
const issuer = "https://auth.indexclima.test";
const staticToken = "test-mcp-access-token-32-characters-long";
const serviceToken = "test-api-service-token-32-characters-long";
const quote = { id: "22222222-2222-4222-8222-222222222222", revision: 0, reference: "TEST-OAUTH", title: "TEST OAuth", status: "draft", origin: "generator", accessMode: "editable", lines: [] };

let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let jwks: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  foreignKey = (await generateKeyPair("ES256")).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] });
});

async function token(claims: Record<string, unknown> = {}, options: { key?: CryptoKey; expires?: string | number; issuer?: string; audience?: string | string[] | null; notBefore?: string | number } = {}) {
  const jwt = new SignJWT({ scope: "quotes:read clients:read holded:read", ...claims }).setProtectedHeader({ alg: "ES256", kid: "k1", typ: "at+jwt" }).setSubject(String(claims.sub ?? "user-123")).setIssuer(options.issuer ?? issuer).setIssuedAt().setExpirationTime(options.expires ?? "5m");
  if (options.audience !== null) jwt.setAudience(options.audience ?? resource);
  if (options.notBefore !== undefined) jwt.setNotBefore(options.notBefore);
  return jwt.sign(options.key ?? signingKey);
}

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });
async function serve(overrides: Partial<McpAppOptions> = {}) {
  const api: GeneratorApi = { request: vi.fn().mockResolvedValue([quote]) };
  const instance = createMcpApplication({ enabled: true, publicUrl: resource, installationId, apiUrl: "http://127.0.0.1:4000", serviceToken, authToken: staticToken, scopes: MCP_SCOPES.join(" "), authMode: "oauth", authIssuerUrl: issuer, authJwks: jwks, api, ...overrides });
  disposals.push(instance.close);
  const server: Server = createServer(instance.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  disposals.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("invalid_server_address");
  return { base: `http://127.0.0.1:${address.port}`, api };
}
async function rpc(base: string, bearer: string | null, method: string, params: unknown = {}) {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) });
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  return { status: response.status, challenge: response.headers.get("www-authenticate"), body: json ? JSON.parse(json) : null, text };
}
const metadataUrl = "https://mcp-generador.indexclima.com/.well-known/oauth-protected-resource/mcp";

describe("OAuth access token validation", () => {
  it("accepts a valid JWT and forwards the OAuth subject, never the token", async () => {
    const { base, api } = await serve();
    const accessToken = await token();
    expect((await rpc(base, accessToken, "tools/list")).status).toBe(200);
    const call = await rpc(base, accessToken, "tools/call", { name: "search_quotes", arguments: { q: "" } });
    expect(call.body.result.structuredContent.ok).toBe(true);
    const principal = vi.mocked(api.request).mock.calls[0]![2];
    expect(principal).toEqual({ subject: "oauth:user-123", installationId, scopes: ["clients:read", "quotes:read", "holded:read"] });
    expect(call.text).not.toContain(accessToken);
  });
  it.each([
    ["expired", () => token({}, { expires: Math.floor(Date.now() / 1000) - 60 })],
    ["signed by another key", () => token({}, { key: foreignKey })],
    ["from another issuer", () => token({}, { issuer: "https://evil.example.com" })],
    ["for another resource", () => token({}, { audience: "https://other.example.com/mcp" })],
    ["for the bare host instead of the canonical resource", () => token({}, { audience: "https://mcp-generador.indexclima.com" })],
    ["without audience", () => token({}, { audience: null })],
    ["not yet valid", () => token({}, { notBefore: Math.floor(Date.now() / 1000) + 600 })],
    ["bound to another installation", () => token({ installation_id: "99999999-9999-4999-8999-999999999999" })],
    ["malformed", async () => "aaa.bbb.ccc"],
  ])("rejects a token %s with 401 and a discovery challenge", async (_label, make) => {
    const { base, api } = await serve();
    const response = await rpc(base, await make(), "tools/list");
    expect(response.status).toBe(401);
    expect(response.challenge).toContain(`resource_metadata="${metadataUrl}"`);
    expect(response.challenge).toContain('error="invalid_token"');
    expect(api.request).not.toHaveBeenCalled();
  });
  it("rejects symmetric (HS256) and unsigned tokens", async () => {
    const { base } = await serve();
    const hs = await new SignJWT({ scope: "quotes:read" }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setIssuer(issuer).setAudience(resource).setExpirationTime("5m").sign(new TextEncoder().encode("a".repeat(32)));
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "x", iss: issuer, aud: resource, exp: Math.floor(Date.now() / 1000) + 300, scope: "quotes:read" })).toString("base64url")}.`;
    expect((await rpc(base, hs, "tools/list")).status).toBe(401);
    expect((await rpc(base, none, "tools/list")).status).toBe(401);
  });
  it("answers a missing token with 401 pointing at the protected resource metadata", async () => {
    const { base } = await serve();
    const response = await rpc(base, null, "initialize");
    expect(response.status).toBe(401);
    expect(response.challenge).toMatch(/^Bearer /);
    expect(response.challenge).toContain(`resource_metadata="${metadataUrl}"`);
  });
  it("restricts OAuth subjects when an allowlist is configured", async () => {
    const { base } = await serve({ authAllowedSubjects: "owner-1, owner-2" });
    expect((await rpc(base, await token({ sub: "owner-2" }), "tools/list")).status).toBe(200);
    expect((await rpc(base, await token({ sub: "intruder" }), "tools/list")).status).toBe(401);
  });
});

describe("scopes are enforced on the server", () => {
  it("lets a read token read and refuses writes with a step-up challenge for Claude and ChatGPT", async () => {
    const { base, api } = await serve();
    const read = await token();
    expect((await rpc(base, read, "tools/call", { name: "get_holded_status", arguments: {} })).status).toBe(200);
    vi.mocked(api.request).mockClear();
    const denied = await rpc(base, read, "tools/call", { name: "create_quote", arguments: { title: "TEST" } });
    expect(denied.status).toBe(403);
    expect(denied.challenge).toContain('error="insufficient_scope"');
    expect(denied.challenge).toContain("quotes:write");
    expect(denied.challenge).toContain("quotes:read");
    expect(denied.challenge).toContain(`resource_metadata="${metadataUrl}"`);
    expect(denied.body).toMatchObject({ jsonrpc: "2.0", id: 7, result: { isError: true, _meta: { "mcp/www_authenticate": [denied.challenge] } } });
    expect(api.request).not.toHaveBeenCalled();
  });
  it("lets a write token write", async () => {
    const { base, api } = await serve();
    vi.mocked(api.request).mockResolvedValue(quote);
    const write = await token({ scope: "quotes:read quotes:write" });
    const created = await rpc(base, write, "tools/call", { name: "create_quote", arguments: { title: "TEST OAuth" } });
    expect(created.body.result.structuredContent.ok).toBe(true);
    expect(api.request).toHaveBeenCalledWith("POST", "/quotes", expect.objectContaining({ subject: "oauth:user-123" }), { title: "TEST OAuth" });
  });
  it("never grants more than the installation ceiling (MCP_SCOPES) and ignores unknown scopes", async () => {
    const { base } = await serve({ scopes: "quotes:read clients:read holded:read" });
    const greedy = await token({ scope: "quotes:read quotes:write holded:write admin:all offline_access" });
    expect((await rpc(base, greedy, "tools/call", { name: "create_quote", arguments: { title: "x" } })).status).toBe(403);
  });
  it("accepts the scp array claim used by some identity providers", async () => {
    const { base } = await serve();
    const scp = await token({ scope: undefined, scp: ["quotes:read", "quotes:write"] });
    expect((await rpc(base, scp, "tools/call", { name: "create_quote", arguments: { title: "x" } })).status).toBe(200);
  });
});

describe("authentication modes", () => {
  it("parses only known modes and defaults to bearer", () => {
    expect(parseAuthMode(undefined)).toBe("bearer");
    expect(parseAuthMode("OAuth")).toBe("oauth");
    expect(() => parseAuthMode("none")).toThrow("invalid_mcp_auth_mode");
  });
  it("oauth mode never accepts the static token", async () => {
    const { base } = await serve({ authMode: "oauth" });
    expect((await rpc(base, staticToken, "tools/list")).status).toBe(401);
  });
  it("hybrid mode accepts both, and a JWT never falls back to the static comparison", async () => {
    const { base } = await serve({ authMode: "hybrid" });
    expect((await rpc(base, staticToken, "tools/list")).status).toBe(200);
    expect((await rpc(base, await token(), "tools/list")).status).toBe(200);
    expect((await rpc(base, await token({}, { key: foreignKey }), "tools/list")).status).toBe(401);
  });
  it("bearer mode keeps the legacy behaviour and rejects JWTs", async () => {
    const { base } = await serve({ authMode: "bearer" });
    expect((await rpc(base, staticToken, "tools/list")).status).toBe(200);
    expect((await rpc(base, await token(), "tools/list")).status).toBe(401);
  });
  it.each([
    [{ authIssuerUrl: undefined }, "auth_issuer_url_required"],
    [{ authJwks: undefined, authJwksUrl: undefined }, "auth_jwks_url_required"],
    [{ authIssuerUrl: "http://auth.example.com" }, "auth_issuer_url_must_use_https"],
    [{ authJwks: undefined, authJwksUrl: "http://auth.example.com/jwks" }, "auth_jwks_url_must_use_https"],
    [{ authMode: "hybrid", authToken: "short" }, "mcp_auth_token_must_have_at_least_32_characters"],
    [{ authMode: "public" }, "invalid_mcp_auth_mode"],
  ])("reports incomplete OAuth configuration in /health without exposing tools", async (overrides, error) => {
    const { base } = await serve(overrides as Partial<McpAppOptions>);
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ status: "unconfigured", toolsEnabled: false, error });
    expect((await rpc(base, await token(), "tools/list")).status).toBe(503);
  });
});

describe("discovery metadata", () => {
  it("serves RFC 9728 metadata at the path-inserted and root URLs with the exact resource", async () => {
    const { base } = await serve();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toEqual({ resource, resource_name: "Index Clima · Presupuestos", authorization_servers: [issuer], scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ["header"] });
    }
  });
  it("does not advertise an authorization server in bearer mode", async () => {
    const { base } = await serve({ authMode: "bearer" });
    expect(await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()).not.toHaveProperty("authorization_servers");
  });
});

describe("tool security declarations and profile", () => {
  it("publishes securitySchemes derived from the same scopes the server enforces", async () => {
    const { base } = await serve();
    const tools = (await rpc(base, await token(), "tools/list")).body.result.tools as Array<{ name: string; securitySchemes: unknown; _meta: Record<string, unknown>; annotations: Record<string, unknown> }>;
    expect(tools).toHaveLength(generatorTools.length + 1);
    for (const tool of generatorTools) {
      const listed = tools.find((entry) => entry.name === tool.name)!;
      expect(listed.securitySchemes).toEqual([{ type: "oauth2", scopes: tool.scopes }]);
      expect(listed._meta.securitySchemes).toEqual(listed.securitySchemes);
      expect(listed.annotations.readOnlyHint).toBe(tool.readOnly);
    }
    expect(tools.find((entry) => entry.name === "sync_quote_to_holded")!.securitySchemes).toEqual([{ type: "oauth2", scopes: ["quotes:write", "holded:write"] }]);
    expect(tools.find((entry) => entry.name === "list_holded_estimates")!.securitySchemes).toEqual([{ type: "oauth2", scopes: ["holded:read"] }]);
  });
  it("does not advertise OAuth schemes in pure bearer mode", async () => {
    const { base } = await serve({ authMode: "bearer" });
    const tools = (await rpc(base, staticToken, "tools/list")).body.result.tools as Array<Record<string, unknown>>;
    expect(tools.every((tool) => tool.securitySchemes === undefined)).toBe(true);
  });
  it("returns a stable, secret-free profile marked with openai/profile", async () => {
    const { base } = await serve();
    const first = await token({ scope: "quotes:read" });
    const tools = (await rpc(base, first, "tools/list")).body.result.tools as Array<{ name: string; _meta: Record<string, unknown>; annotations: Record<string, unknown> }>;
    expect(tools.find((tool) => tool.name === "get_mcp_profile")).toMatchObject({ _meta: { "openai/profile": true }, annotations: { readOnlyHint: true } });
    const profile = await rpc(base, first, "tools/call", { name: "get_mcp_profile", arguments: {} });
    const refreshed = await rpc(base, await token({ scope: "quotes:read quotes:write" }), "tools/call", { name: "get_mcp_profile", arguments: {} });
    expect(profile.body.result.structuredContent).toEqual({ id: profileFor({ subject: "oauth:user-123", installationId, scopes: [] }).id, name: "Index Clima", nickname: "oauth:user-123" });
    expect(refreshed.body.result.structuredContent.id).toBe(profile.body.result.structuredContent.id);
    expect(JSON.parse(profile.body.result.content[0].text)).toEqual(profile.body.result.structuredContent);
    expect(profile.body.result.content[1].text).toContain("quotes:read");
    for (const secret of [first, staticToken, serviceToken]) expect(profile.text).not.toContain(secret);
  });
});
