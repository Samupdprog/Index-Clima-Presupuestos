import assert from "node:assert/strict";
let nextId = 1;
async function rpc(method, params = {}) {
  const response = await fetch("http://127.0.0.1:4001/mcp", { method: "POST", headers: { authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
  const raw = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : raw;
  const data = JSON.parse(json ?? "null");
  assert(response.ok, `${method}: ${response.status} ${JSON.stringify(data)}`);
  assert(!data.error, `${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args });
  const data = result.structuredContent;
  assert(data?.ok, `${name}: ${JSON.stringify(data?.error ?? result)}`);
  return data.data;
}
const health = await (await fetch("http://127.0.0.1:4001/health")).json(); assert.equal(health.status, "ok");
const list = await rpc("tools/list"); assert(list.tools.length >= 20);
const quote = await tool("create_quote", { title: `TEST MCP ${Date.now()}` });
try {
  await tool("import_quote_lines", { quoteId: quote.id, expectedRevision: quote.revision, lines: [{ description: "TEST MCP machine", type: "material", quantity: "2", unit: "ud", supplierUnitPrice: "1000", discounts: ["40", "10"], igicRate: "7" }] });
  let saved = await tool("get_quote", { quoteId: quote.id });
  assert.equal(saved.calculation.saleWithoutTax, "2000.00"); assert.equal(saved.calculation.cost, "1080.00");
  const request = { quoteId: quote.id, expectedRevision: saved.revision, scope: "quote", operation: "add_amount", value: "300" };
  const preview = await tool("preview_price_adjustment", request);
  assert.equal(preview.totals.saleAfter, "2300.00");
  await tool("apply_price_adjustment", request);
  saved = await tool("get_quote", { quoteId: quote.id }); assert.equal(saved.calculation.saleWithoutTax, "2300.00");
  const review = await tool("get_quote_review", { quoteId: quote.id }); assert(review.issues.some((item) => item.code === "client_required"));
  console.log(JSON.stringify({ passed: ["authenticated transport", `${list.tools.length} tools`, "AI import: gross 1000 discount 40+10 quantity 2", "server calculation cost 1080/sale 2000", "backend preview+300", "review readiness"], quoteId: quote.id }));
} finally {
  const saved = await tool("get_quote", { quoteId: quote.id });
  await tool("archive_quote", { quoteId: quote.id, expectedRevision: saved.revision });
}
