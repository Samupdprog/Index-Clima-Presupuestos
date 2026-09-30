import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createMcpApplication, toolTitle } from "./server.js";
import { MCP_SCOPES } from "./auth.js";
import { generatorTools } from "./tools.js";

// ChatGPT (action discovery) rechaza descriptores sin `title` o con schemas abiertos/recursivos
// como los que genera `z.record(...)` o `z.json()`. Este test protege el contrato publicado.
const installationId = "11111111-1111-4111-8111-111111111111";
const token = "test-mcp-access-token-32-characters-long";
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); });

async function listTools() {
  const instance = createMcpApplication({ enabled: true, publicUrl: "http://localhost:4001/mcp", installationId, apiUrl: "http://127.0.0.1:4000", serviceToken: "test-api-service-token-32-characters-long", authToken: token, scopes: MCP_SCOPES.join(" ") });
  disposals.push(instance.close);
  const server = createServer(instance.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  disposals.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("invalid_server_address");
  const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  return JSON.parse(json ?? "null").result.tools as Array<{ name: string; title?: string; inputSchema: unknown; outputSchema?: unknown }>;
}

/** Rutas JSON de las construcciones que el descriptor no puede contener. */
function incompatibleNodes(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => incompatibleNodes(item, `${path}[${index}]`));
  if (!schema || typeof schema !== "object") return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (key === "propertyNames") found.push(`${path}.propertyNames`);
    if (key === "$ref" || key === "$defs" || key === "definitions") found.push(`${path}.${key}`);
    if (key === "additionalProperties" && value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) found.push(`${path}.additionalProperties: {}`);
    found.push(...incompatibleNodes(value, `${path}.${key}`));
  }
  return found;
}

describe("tools/list descriptor for ChatGPT action discovery", () => {
  it("publishes every tool with a human title and closed, non-recursive schemas", async () => {
    const tools = await listTools();
    expect(tools).toHaveLength(generatorTools.length + 1);
    expect(tools).toHaveLength(52);
    const problems = tools.flatMap((tool) => [
      ...(typeof tool.title === "string" && tool.title.trim() && tool.title !== tool.name ? [] : [`${tool.name}: missing title`]),
      ...incompatibleNodes(tool.inputSchema).map((node) => `${tool.name} input ${node}`),
      ...incompatibleNodes(tool.outputSchema).map((node) => `${tool.name} output ${node}`),
    ]);
    expect(problems).toEqual([]);
  });

  it("derives readable titles from tool names", async () => {
    expect(toolTitle("create_material")).toBe("Create material");
    expect(toolTitle("get_mcp_profile")).toBe("Get MCP profile");
    expect(toolTitle("list_holded_estimates")).toBe("List Holded estimates");
    const titles = new Map((await listTools()).map((tool) => [tool.name, tool.title]));
    expect(titles.get("get_mcp_profile")).toBe("Get MCP profile");
    expect(titles.get("delete_quote_permanently")).toBe("Delete quote permanently");
  });

  it("detects the constructs it guards against", () => {
    expect(incompatibleNodes({ type: "object", propertyNames: { type: "string" }, additionalProperties: {} })).toEqual(["$.propertyNames", "$.additionalProperties: {}"]);
    expect(incompatibleNodes({ anyOf: [{ $ref: "#/$defs/json" }] })).toEqual(["$.anyOf[0].$ref"]);
    expect(incompatibleNodes({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false })).toEqual([]);
  });
});
