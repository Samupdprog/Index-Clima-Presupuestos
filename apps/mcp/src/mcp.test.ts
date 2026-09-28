import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod/v4";
import { createMcpApplication, type McpAppOptions } from "./server.js";
import { createGeneratorApi, GeneratorApiError, type GeneratorApi } from "./api-client.js";
import { MCP_SCOPES, createLocalTokenVerifier, parseScopes, type McpPrincipal } from "./auth.js";
import { callGeneratorTool, generatorTools } from "./tools.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const token = "test-mcp-access-token-32-characters-long";
const serviceToken = "test-api-service-token-32-characters-long";
const principal: McpPrincipal = { subject: "test-ai", installationId, scopes: [...MCP_SCOPES] };
const quote = { id: quoteId, revision: 0, reference: "TEST-MCP", title: "TEST MCP", status: "draft", origin: "generator", accessMode: "editable", lines: [] };
const calculation = { cost: "540", saleWithoutTax: "1100", taxTotal: "77", saleWithTax: "1177", profit: "560", lines: [{ id: lineId, cost: "540", baseSale: "1100", sale: "1100", adjustment: "0", profit: "560", igic: "77", finalSaleWithTax: "1177" }] };
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("invalid_server_address");
  disposals.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${address.port}`;
}
async function serve(overrides: Partial<McpAppOptions> = {}) {
  const instance = createMcpApplication({ enabled: true, publicUrl: "http://localhost:4001/mcp", installationId, apiUrl: "http://127.0.0.1:4000", serviceToken, authToken: token, scopes: MCP_SCOPES.join(" "), ...overrides });
  disposals.push(instance.close);
  return listen(createServer(instance.app));
}
function request(base: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function rpcBody(response: Response) {
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  return JSON.parse(json ?? "null");
}

describe("MCP transport and permissions", () => {
  it("stays healthy when disabled and does not expose tools", async () => {
    const base = await serve({ enabled: false, authToken: "" });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: "disabled", service: "mcp", toolsEnabled: false });
    expect((await request(base, "tools/list")).status).toBe(404);
  });
  it("reports invalid configuration without exiting or exposing tools", async () => {
    const base = await serve({ authToken: "short" });
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect((await request(base, "tools/list")).status).toBe(503);
  });
  it("requires bearer, validates Origin and does not leak the internal token", async () => {
    const base = await serve();
    const missing = await request(base, "tools/list", {}, { authorization: "" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("resource_metadata");
    expect((await request(base, "tools/list", {}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await request(base, "tools/list", {}, { origin: "https://evil.invalid" })).status).toBe(403);
    expect(JSON.stringify(await (await fetch(`${base}/health`)).json())).not.toContain(serviceToken);
  });
  it("rejects verified tokens for another installation or resource", async () => {
    const wrongInstallation = createLocalTokenVerifier({ token, principal: { ...principal, installationId: quoteId }, resourceUrl: "http://localhost:4001/mcp" });
    const wrongAudience = createLocalTokenVerifier({ token, principal, resourceUrl: "https://other.invalid/mcp" });
    expect((await request(await serve({ verifier: wrongInstallation }), "tools/list")).status).toBe(403);
    expect((await request(await serve({ verifier: wrongAudience }), "tools/list")).status).toBe(403);
  });
  it("rejects expired tokens and unknown scopes", async () => {
    const verifier = createLocalTokenVerifier({ token, principal, resourceUrl: "http://localhost:4001/mcp", expiresAt: 1 });
    expect((await request(await serve({ verifier }), "tools/list")).status).toBe(401);
    expect(() => parseScopes("quotes:admin")).toThrow("invalid_mcp_scopes");
  });
  it("denies write without scope before calling the API", async () => {
    const api: GeneratorApi = { request: vi.fn() };
    const base = await serve({ scopes: "quotes:read", api });
    const denied = await request(base, "tools/call", { name: "create_quote", arguments: { title: "Forbidden" } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain("quotes:write");
    expect(api.request).not.toHaveBeenCalled();
  });
  it("lists every strict tool with output schema and the AI guide", async () => {
    const base = await serve();
    const body = await rpcBody(await request(base, "tools/list"));
    expect(body.result.tools).toHaveLength(generatorTools.length);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.properties).toHaveProperty("error");
      expect(tool.outputSchema.properties).toHaveProperty("data");
      expect(tool.name).not.toMatch(/sql|reset|calculate_money/);
    }
    const read = await rpcBody(await request(base, "resources/read", { uri: "generator://guide" }));
    expect(read.result.contents[0].text).toContain("revision_conflict");
    expect(read.result.contents[0].text).toContain("nunca sumes descuentos ni calcules");
  });
  it("supports 2026-07-28 request metadata through the official handler", async () => {
    const base = await serve();
    const response = await request(base, "tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0" }, "io.modelcontextprotocol/clientCapabilities": {} } }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" });
    const body = await rpcBody(response);
    expect(response.status).toBe(200);
    expect(body.result.tools).toHaveLength(generatorTools.length);
  });
});

describe("typed tools through the internal API", () => {
  it("forwards authenticated actor, installation, scope and exact extracted facts over HTTP", async () => {
    const calls: Array<{ url: string | undefined; headers: Record<string, unknown>; body: unknown }> = [];
    const apiUrl = await listen(createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += String(chunk);
      calls.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ quote: { ...quote, revision: 1 }, calculation }));
    }));
    const base = await serve({ apiUrl });
    const args = { quoteId, expectedRevision: 0, line: { description: "Material 40 + 10", unit: "ud", quantity: "1", igicRate: "7", saleRule: "add_percentage", saleRuleValue: "10", saleBaseMode: "supplier_list_price", supplierUnitPrice: "1000" }, discounts: [{ percentage: "40" }, { percentage: "10" }] };
    const body = await rpcBody(await request(base, "tools/call", { name: "add_material_line", arguments: args }));
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.calculation.saleWithoutTax).toBe("1100");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/quotes/${quoteId}/commands`);
    expect(calls[0]?.headers).toMatchObject({ authorization: `Bearer ${serviceToken}`, "x-actor-type": "ai", "x-actor-id": "local-ai", "x-installation-id": installationId });
    expect(calls[0]?.body).toMatchObject({ type: "createQuoteLine", lineType: "material", discounts: args.discounts, line: args.line, laborEntries: [] });
    expect(JSON.stringify(calls[0])).not.toContain(token);
  });
  it("forwards adjustment operation, IDs and decimals without any allocation", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue({ quote: { ...quote, revision: 1 }, calculation }) };
    const tool = generatorTools.find((tool) => tool.name === "apply_price_adjustment")!;
    const result = await callGeneratorTool(tool, api, principal, { quoteId, expectedRevision: 0, scope: "selection", lineIds: [lineId], operation: "add_amount", value: "200.00" });
    expect(result.structuredContent.ok).toBe(true);
    expect(api.request).toHaveBeenCalledWith("POST", `/quotes/${quoteId}/commands`, principal, { type: "addPriceAdjustment", expectedRevision: 0, scope: "selection", targetLineIds: [lineId], mode: "amount", value: "200.00" });
  });
  it.each([
    [409, "revision_conflict", "revision_conflict"],
    [502, "holded_sync_failed", "holded_failed"],
    [403, "forbidden", "forbidden"],
    [422, "pricing_pending", "validation_failed"],
  ])("propagates API status %s as safe typed error", async (status, backendCode, expected) => {
    const api = createGeneratorApi({ baseUrl: "http://api:4000", serviceToken, fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: backendCode, message: `secret ${token}`, stack: serviceToken }), { status, headers: { "content-type": "application/json" } })) });
    const result = await callGeneratorTool(generatorTools.find((tool) => tool.name === "create_quote")!, api, principal, { title: "TEST" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: expected, status, backendCode });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(serviceToken);
  });
  it("does not retry a mutation after ambiguous network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`network ${serviceToken}`));
    const api = createGeneratorApi({ baseUrl: "http://api:4000", serviceToken, fetch: fetcher });
    await expect(api.request("POST", "/quotes", principal, { title: "TEST" })).rejects.toMatchObject({ detail: { code: "api_unavailable", retryable: false } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects input trying to choose installation, actor, SQL, float money or unknown nested field", async () => {
    const api: GeneratorApi = { request: vi.fn() };
    const tool = generatorTools.find((tool) => tool.name === "create_quote")!;
    for (const extra of [{ installationId }, { actorType: "system" }, { sql: "SELECT 1" }]) {
      expect((await callGeneratorTool(tool, api, principal, { title: "TEST", ...extra })).structuredContent.ok).toBe(false);
    }
    const lineTool = generatorTools.find((tool) => tool.name === "add_material_line")!;
    const line = { description: "TEST", unit: "ud", saleRule: "add_percentage", saleRuleValue: "0" };
    expect(lineTool.input.safeParse({ quoteId, expectedRevision: 0, line: { ...line, supplierUnitPrice: 1000 } }).success).toBe(false);
    expect(lineTool.input.safeParse({ quoteId, expectedRevision: 0, line: { ...line, unknownField: "value" } }).success).toBe(false);
    expect(api.request).not.toHaveBeenCalled();
  });
  it("rejects malformed API output and strips masked key from status", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue({ id: "invalid" }) };
    const malformed = await callGeneratorTool(generatorTools.find((tool) => tool.name === "create_quote")!, api, principal, { title: "TEST" });
    expect(malformed.structuredContent.error).toMatchObject({ code: "invalid_api_response" });
    api.request = vi.fn().mockResolvedValue({ featureEnabled: true, isConfigured: true, keyMasked: "secret", health: { status: "ok", code: "ok", message: "ok", lastCheckedAt: null } });
    const safe = await callGeneratorTool(generatorTools.find((tool) => tool.name === "get_holded_status")!, api, principal, {});
    expect(safe.structuredContent.ok).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("keyMasked");
  });
  it("never imports database/domain/Holded or performs economic calculations", async () => {
    const files = (await readdir(new URL(".", import.meta.url))).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    for (const file of files) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/from ["'](?:@quotes\/(?:db|domain|application|holded)|decimal\.js|pg|drizzle-orm)["']/);
      expect(source).not.toMatch(/(?:calculateQuote|new Decimal|\.toFixed\(|parseFloat\()/);
    }
  });
});
