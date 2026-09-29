import { describe, expect, it, vi } from "vitest";
import type { GeneratorApi } from "./api-client.js";
import type { McpPrincipal } from "./auth.js";
import { callGeneratorTool, generatorTools } from "./tools.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const writer: McpPrincipal = { subject: "ai", installationId, scopes: ["quotes:read", "quotes:write"] };
const reader: McpPrincipal = { ...writer, scopes: ["quotes:read"] };
const tool = (name: string) => { const found = generatorTools.find((entry) => entry.name === name); if (!found) throw new Error(`missing ${name}`); return found; };
const quote = { id: quoteId, revision: 3, reference: "P-40", title: "TEST", status: "draft", origin: "generator", accessMode: "editable", lines: [] };

describe("catalog tools", () => {
  it("exposes typed create/update tools for every catalog kind", () => {
    for (const kind of ["material", "employee", "travel", "supplier", "text_template"]) {
      expect(tool(`create_${kind}`)).toMatchObject({ scopes: ["quotes:write"], readOnly: false });
      expect(tool(`update_${kind}`)).toMatchObject({ scopes: ["quotes:write"], readOnly: false });
    }
  });
  it("creates an employee through the internal API with exact decimal strings", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue({ id: itemId, name: "Javi" }) };
    const result = await callGeneratorTool(tool("create_employee"), api, writer, { name: "Javi", costRate: "18.5", saleRate: "32" });
    expect(result.structuredContent.ok).toBe(true);
    expect(api.request).toHaveBeenCalledWith("POST", "/catalogs/employees", writer, { name: "Javi", costRate: "18.5", saleRate: "32" });
  });
  it("rejects numbers, unknown fields and IGIC outside the allowed rates", async () => {
    const api: GeneratorApi = { request: vi.fn() };
    for (const args of [{ name: "X", costRate: 18 }, { name: "X", sql: "drop" }, { name: "X", defaultIgicRate: "21" }]) {
      expect((await callGeneratorTool(tool("create_employee"), api, writer, args)).structuredContent.ok).toBe(false);
    }
    expect(api.request).not.toHaveBeenCalled();
  });
  it("updates only the requested fields and archives/restores by kind", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue({ id: itemId }) };
    await callGeneratorTool(tool("update_material"), api, writer, { id: itemId, supplierUnitPrice: "6.2" });
    expect(api.request).toHaveBeenLastCalledWith("PATCH", `/catalogs/materials/${itemId}`, writer, { supplierUnitPrice: "6.2" });
    await callGeneratorTool(tool("archive_catalog_item"), api, writer, { kind: "travels", id: itemId });
    expect(api.request).toHaveBeenLastCalledWith("POST", `/catalogs/travels/${itemId}/archive`, writer, {});
    await callGeneratorTool(tool("restore_catalog_item"), api, writer, { kind: "travels", id: itemId });
    expect(api.request).toHaveBeenLastCalledWith("PATCH", `/catalogs/travels/${itemId}`, writer, { active: true });
    expect(tool("archive_catalog_item").destructive).toBe(true);
  });
  it("previews with quotes:read but applies only with quotes:write and a plan hash", async () => {
    const plan = { summary: { total: 1, created: 0, updated: 1, unchanged: 0, invalid: 0 }, items: [{ row: 1, name: "Tubo", action: "update", materialId: itemId, changes: [{ field: "supplierUnitPrice", before: "5.000000", after: "6" }] }], planHash: "0123456789abcdef" };
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue(plan) };
    const rows = [{ name: "Tubo", supplierCode: "T-1", supplierUnitPrice: "6" }];
    const preview = await callGeneratorTool(tool("preview_material_import"), api, reader, { rows });
    expect(preview.structuredContent).toMatchObject({ ok: true, data: { summary: { updated: 1 } } });
    expect(api.request).toHaveBeenLastCalledWith("POST", "/catalogs/materials/import/preview", reader, { rows: [{ ...rows[0], unit: "ud", igicRate: "7" }] });
    expect((await callGeneratorTool(tool("apply_material_import"), api, reader, { rows, planHash: plan.planHash })).structuredContent.error).toMatchObject({ code: "forbidden" });
    expect((await callGeneratorTool(tool("apply_material_import"), api, writer, { rows })).structuredContent.ok).toBe(false);
    await callGeneratorTool(tool("apply_material_import"), api, writer, { rows, planHash: plan.planHash });
    expect(api.request).toHaveBeenLastCalledWith("POST", "/catalogs/materials/import/apply", writer, expect.objectContaining({ planHash: plan.planHash }));
  });
});

describe("quote lifecycle tools", () => {
  it("changes the number, trashes and restores through typed commands", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue(quote) };
    await callGeneratorTool(tool("change_quote_reference"), api, writer, { quoteId, expectedRevision: 3, reference: "P-40B" });
    expect(api.request).toHaveBeenLastCalledWith("POST", `/quotes/${quoteId}/commands`, writer, { type: "changeQuoteReference", expectedRevision: 3, reference: "P-40B" });
    await callGeneratorTool(tool("trash_quote"), api, writer, { quoteId, expectedRevision: 3 });
    expect(api.request).toHaveBeenLastCalledWith("POST", `/quotes/${quoteId}/commands`, writer, { type: "trashQuote", expectedRevision: 3 });
    expect((await callGeneratorTool(tool("change_quote_reference"), api, writer, { quoteId, expectedRevision: 3, reference: "; DROP" })).structuredContent.ok).toBe(false);
  });
  it("requires an explicit confirm: true to delete permanently", async () => {
    const api: GeneratorApi = { request: vi.fn().mockResolvedValue({ deleted: true, id: quoteId, reference: "P-40", holdedEstimateId: null, holdedUntouched: true }) };
    for (const args of [{ quoteId, expectedRevision: 3 }, { quoteId, expectedRevision: 3, confirm: false }, { quoteId, expectedRevision: 3, confirm: "true" }]) {
      expect((await callGeneratorTool(tool("delete_quote_permanently"), api, writer, args)).structuredContent.ok).toBe(false);
    }
    expect(api.request).not.toHaveBeenCalled();
    const done = await callGeneratorTool(tool("delete_quote_permanently"), api, writer, { quoteId, expectedRevision: 3, confirm: true });
    expect(done.structuredContent).toMatchObject({ ok: true, data: { deleted: true, holdedUntouched: true } });
    expect(tool("delete_quote_permanently")).toMatchObject({ destructive: true, readOnly: false });
  });
});
