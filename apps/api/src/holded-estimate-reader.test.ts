import { describe, expect, it, vi } from "vitest";
import { HoldedEstimateQueryError } from "@quotes/application";
import { holdedEstimateDetailSchema, holdedEstimateSummarySchema } from "@quotes/contracts";
import { HoldedApiError, type HoldedClient, type HoldedEstimate } from "@quotes/holded";
import { createHoldedEstimateReader, holdedDecimalOrNull, toRemoteEstimateDetail } from "./holded-estimate-reader.js";
import { holdedReadErrorResponse } from "./holded-read-errors.js";
import { allowedAiRequest } from "./access.js";

const ID = "6aba7b1deb4469c5fc0d28ca";
// Forma real observada en Holded v2 (importes con punto o coma, body HTML).
const raw = {
  id: ID, document_number: "P-15", contact_id: "6aba51af51860a9db806f638", contact_name: "Prueba", description: "P-15 · Prueba", date: "2026-09-28", due_date: null,
  subtotal: "1035,00", discount: "0.00", tax: 72.45, total: "1107.45", currency: "EUR", status: "pending", draft: false, tags: ["index"],
  notes: "Texto", body: "<p><b>Rich</b></p>", language: "es", approved_at: "2026-09-28T17:32:22", custom_fields: [{ field: "ref", value: 7 }], from: null,
  api_key: "should-never-leak", internal_token: "nope",
  lines: [{ line_id: "l1", type: "product", name: "Split", description: "", units: "1.00", price: "1010,00", discount: "0", tax: "7", taxes: ["s_igic_7"], unit_type: null, sku: null, product_id: null, service_id: null, supplied: false }],
} as unknown as HoldedEstimate;

describe("Holded estimate read adapter", () => {
  it("normalizes only the decimal format, never inventing values", () => {
    expect(holdedDecimalOrNull("1035,50")).toBe("1035.50");
    expect(holdedDecimalOrNull(72.45)).toBe("72.45");
    expect(holdedDecimalOrNull("-3")).toBe("-3");
    for (const value of ["1.234,56", "abc", "", null, undefined, Number.NaN, 1e21]) expect(holdedDecimalOrNull(value)).toBeNull();
  });
  it("maps the full remote estimate to the typed contract, keeping body as read-only data", () => {
    const detail = toRemoteEstimateDetail(raw);
    expect(detail).toMatchObject({ holdedEstimateId: ID, documentNumber: "P-15", subtotal: "1035.00", tax: "72.45", total: "1107.45", body: "<p><b>Rich</b></p>", customFields: [{ field: "ref", value: "7" }] });
    expect(detail.lines[0]).toMatchObject({ lineId: "l1", units: "1.00", price: "1010.00", taxes: ["s_igic_7"], unitType: null });
    expect(holdedEstimateDetailSchema.safeParse({ ...detail, generatorQuote: null, dataNotice: "x" }).success).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/should-never-leak|internal_token/);
  });
  it("lists summaries plus line texts used only for search", async () => {
    const client = { listEstimatesPage: vi.fn().mockResolvedValue({ items: [raw], cursor: "page:2", has_more: true }) } as unknown as HoldedClient;
    const page = await createHoldedEstimateReader(client).listPage({ limit: 20, cursor: "page:1" });
    expect(client.listEstimatesPage).toHaveBeenCalledWith({ limit: 20, cursor: "page:1" });
    expect(page).toMatchObject({ cursor: "page:2", hasMore: true });
    expect(page.items[0]?.lineTexts).toEqual(["Split"]);
    const { lineTexts: _lineTexts, ...summary } = page.items[0]!;
    expect(holdedEstimateSummarySchema.safeParse({ ...summary, generatorQuote: null }).success).toBe(true);
  });
  it("returns null for a missing estimate and propagates other failures", async () => {
    const getEstimate = vi.fn().mockRejectedValueOnce(new HoldedApiError("not_found", 404)).mockRejectedValueOnce(new HoldedApiError("forbidden", 403));
    const reader = createHoldedEstimateReader({ getEstimate } as unknown as HoldedClient);
    await expect(reader.get(ID)).resolves.toBeNull();
    await expect(reader.get(ID)).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Holded read error responses", () => {
  it.each([
    ["unauthorized", 401, 502, "holded_unauthorized"],
    ["forbidden", 403, 502, "holded_forbidden"],
    ["not_found", 404, 404, "holded_estimate_not_found"],
    ["timeout", null, 504, "holded_unavailable"],
    ["invalid_response", 200, 502, "holded_invalid_response"],
  ] as const)("maps %s without forwarding the remote body", (code, status, httpStatus, error) => {
    const mapped = holdedReadErrorResponse(new HoldedApiError(code, status, { detail: "remote text with secret" }));
    expect(mapped).toEqual({ status: httpStatus, body: { error } });
  });
  it("exposes Retry-After for rate limits", () => {
    expect(holdedReadErrorResponse(new HoldedApiError("rate_limited", 429, undefined, 12))).toEqual({ status: 429, body: { error: "holded_rate_limited", retryAfterSeconds: 12 } });
  });
  it("maps cursor loops and ignores unrelated errors", () => {
    expect(holdedReadErrorResponse(new HoldedEstimateQueryError("holded_cursor_loop"))).toEqual({ status: 502, body: { error: "holded_invalid_response" } });
    expect(holdedReadErrorResponse(new Error("boom"))).toBeNull();
  });
});

describe("AI access to Holded estimates", () => {
  it("requires holded:read for every read endpoint", () => {
    for (const path of [["holded", "estimates"], ["holded", "estimates", "search"], ["holded", "estimates", ID]]) {
      expect(allowedAiRequest("GET", path, "holded:read")).toBe(true);
      expect(allowedAiRequest("GET", path, "quotes:read clients:read quotes:write")).toBe(false);
    }
  });
  it("does not let holded:read write to Holded or export quotes", () => {
    expect(allowedAiRequest("POST", ["holded", "estimates"], "holded:read")).toBe(false);
    expect(allowedAiRequest("PUT", ["holded", "estimates", ID], "holded:read")).toBe(false);
    expect(allowedAiRequest("POST", ["quotes", "id", "holded"], "holded:read quotes:write")).toBe(false);
    expect(allowedAiRequest("POST", ["quotes", "id", "holded"], "holded:write quotes:write")).toBe(true);
  });
});
