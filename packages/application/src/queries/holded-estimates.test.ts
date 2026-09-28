import { describe, expect, it, vi } from "vitest";
import { searchHoldedEstimatesQuerySchema } from "@quotes/contracts";
import { getHoldedEstimate, HoldedEstimateQueryError, listHoldedEstimates, searchHoldedEstimates, searchTokens } from "./holded-estimates.js";
import type { HoldedEstimateQueryDeps, RemoteEstimateDetail, RemoteEstimatePage, RemoteEstimatePageItem } from "../ports/holded-estimates.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const localQuoteId = "22222222-2222-4222-8222-222222222222";
let sequence = 0;
function estimate(overrides: Partial<RemoteEstimatePageItem> = {}): RemoteEstimatePageItem {
  sequence += 1;
  return {
    source: "holded", holdedEstimateId: sequence.toString(16).padStart(24, "0"), documentNumber: `E-${sequence}`, description: "Mantenimiento", contactId: "c".repeat(24), contactName: "Cliente genérico",
    date: "2026-01-01", dueDate: null, status: "pending", draft: false, currency: "EUR", subtotal: "100.00", discount: "0.00", tax: "7.00", total: "107.00", tags: [], lineTexts: [], ...overrides,
  };
}
function page(items: RemoteEstimatePageItem[], cursor: string | null, hasMore = cursor !== null): RemoteEstimatePage {
  return { items, cursor, hasMore };
}
function deps(pages: Array<RemoteEstimatePage | Error>, links: Array<{ quoteId: string; reference: string; holdedEstimateId: string }> = []) {
  const listPage = vi.fn();
  for (const entry of pages) entry instanceof Error ? listPage.mockRejectedValueOnce(entry) : listPage.mockResolvedValueOnce(entry);
  const value: HoldedEstimateQueryDeps = { reader: { listPage, get: vi.fn() }, links: { findByHoldedEstimateIds: vi.fn().mockResolvedValue(links) } };
  return value;
}
const search = (q: string, extra: Record<string, unknown> = {}) => searchHoldedEstimatesQuerySchema.parse({ q, ...extra });
class TransientError extends Error { retryable = true; constructor(readonly code: string) { super(code); } }

describe("list Holded estimates", () => {
  it("returns small summaries, the next cursor and the linked local quote", async () => {
    const linked = estimate({ documentNumber: "P-15", lineTexts: ["Split 3,5 kW"] });
    const d = deps([page([linked, estimate()], "page:2")], [{ quoteId: localQuoteId, reference: "P-15", holdedEstimateId: linked.holdedEstimateId }]);
    const result = await listHoldedEstimates(d)(installationId, { limit: 20, contactId: "c".repeat(24) });
    expect(d.reader.listPage).toHaveBeenCalledWith({ limit: 20, contactId: "c".repeat(24) });
    expect(result).toMatchObject({ source: "holded", hasMore: true, nextCursor: "page:2" });
    expect(result.items[0]).toMatchObject({ documentNumber: "P-15", generatorQuote: { quoteId: localQuoteId, reference: "P-15" } });
    expect(result.items[1]?.generatorQuote).toBeNull();
    expect(result.items[0]).not.toHaveProperty("lineTexts");
    expect(d.links.findByHoldedEstimateIds).toHaveBeenCalledWith(installationId, [linked.holdedEstimateId, result.items[1]!.holdedEstimateId]);
  });
  it("hides the cursor on the last page", async () => {
    const result = await listHoldedEstimates(deps([page([estimate()], "stale", false)]))(installationId, { limit: 20 });
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
  });
  it("rejects a repeated or missing cursor instead of paging forever", async () => {
    await expect(listHoldedEstimates(deps([page([], "page:2")]))(installationId, { limit: 20, cursor: "page:2" })).rejects.toBeInstanceOf(HoldedEstimateQueryError);
    await expect(listHoldedEstimates(deps([page([], null, true)]))(installationId, { limit: 20 })).rejects.toBeInstanceOf(HoldedEstimateQueryError);
  });
});

describe("search Holded estimates", () => {
  it("normalizes natural language queries into compact tokens", () => {
    expect(searchTokens("Busca el presupuesto P-15")).toEqual(["busca", "p15"]);
    expect(searchTokens("aire acondicionado de La Laguna")).toEqual(["aire", "acondicionado", "laguna"]);
    expect(searchTokens("de")).toEqual(["de"]);
  });
  it("finds an estimate by document number and ranks the exact match first", async () => {
    const exact = estimate({ documentNumber: "P-15", date: "2025-01-01" });
    const d = deps([page([estimate({ documentNumber: "P-150", date: "2026-05-01" }), exact, estimate({ documentNumber: "E-9" })], null)]);
    const result = await searchHoldedEstimates(d)(installationId, search("P-15"));
    expect(result.items.map((item) => item.documentNumber)).toEqual(["P-15", "P-150"]);
    expect(result.items[0]?.matchedFields).toContain("documentNumber");
    expect(result).toMatchObject({ totalMatches: 2, scannedPages: 1, scannedEstimates: 3, truncated: false, truncatedReason: null, resumeCursor: null });
    expect(d.reader.listPage).toHaveBeenCalledWith({ limit: 100 });
  });
  it("returns an empty, non-truncated result when nothing matches", async () => {
    const result = await searchHoldedEstimates(deps([page([estimate(), estimate()], null)]))(installationId, search("inexistente"));
    expect(result).toMatchObject({ items: [], totalMatches: 0, truncated: false, scannedEstimates: 2 });
  });
  it("matches client names, descriptions and line texts ignoring accents and stopwords", async () => {
    const juan = estimate({ contactName: "Juan Pérez", date: "2026-02-01" });
    const juan2 = estimate({ contactName: "JUAN PEREZ SL", date: "2026-03-01" });
    const laguna = estimate({ description: "Instalación en La Laguna", lineTexts: ["Aire acondicionado split"] });
    const d = deps([page([juan, laguna, estimate({ contactName: "Juana López" })], "page:2"), page([juan2], null)]);
    const byClient = await searchHoldedEstimates(d)(installationId, search("Juan Perez"));
    expect(byClient.items.map((item) => item.holdedEstimateId)).toEqual([juan2.holdedEstimateId, juan.holdedEstimateId]);
    expect(byClient.items[0]?.matchedFields).toEqual(["contactName"]);
    const byText = await searchHoldedEstimates(deps([page([juan, laguna], null)]))(installationId, search("presupuesto de aire acondicionado de La Laguna"));
    expect(byText.items.map((item) => item.holdedEstimateId)).toEqual([laguna.holdedEstimateId]);
    expect(byText.items[0]?.matchedFields.sort()).toEqual(["description", "lines"]);
  });
  it("limits returned items while reporting the total number of matches", async () => {
    const items = Array.from({ length: 5 }, () => estimate({ tags: ["climatizacion"] }));
    const result = await searchHoldedEstimates(deps([page(items, null)]))(installationId, search("climatizacion", { limit: 2 }));
    expect(result.items).toHaveLength(2);
    expect(result.totalMatches).toBe(5);
  });
  it("stops at maxPages and returns a resume cursor", async () => {
    const d = deps([page([estimate()], "page:2"), page([estimate()], "page:3"), page([estimate()], "page:4")]);
    const result = await searchHoldedEstimates(d)(installationId, search("E-1", { maxPages: 2 }));
    expect(d.reader.listPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ truncated: true, truncatedReason: "max_pages", resumeCursor: "page:3", scannedPages: 2 });
  });
  it("resumes from a cursor and forwards the contact filter on every page", async () => {
    const contactId = "a".repeat(24);
    const d = deps([page([estimate()], "page:4"), page([estimate()], null)]);
    await searchHoldedEstimates(d)(installationId, search("E", { cursor: "page:3", contactId }));
    expect(d.reader.listPage).toHaveBeenNthCalledWith(1, { limit: 100, cursor: "page:3", contactId });
    expect(d.reader.listPage).toHaveBeenNthCalledWith(2, { limit: 100, cursor: "page:4", contactId });
  });
  it("detects repeated or missing cursors", async () => {
    await expect(searchHoldedEstimates(deps([page([], "page:2"), page([], "page:2")]))(installationId, search("x"))).rejects.toBeInstanceOf(HoldedEstimateQueryError);
    await expect(searchHoldedEstimates(deps([page([], null, true)]))(installationId, search("x"))).rejects.toBeInstanceOf(HoldedEstimateQueryError);
  });
  it("returns partial results on rate limit after the first page without retrying", async () => {
    const found = estimate({ documentNumber: "P-7" });
    const d = deps([page([found], "page:2"), new TransientError("rate_limited")]);
    const result = await searchHoldedEstimates(d)(installationId, search("P-7"));
    expect(d.reader.listPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ truncated: true, truncatedReason: "rate_limited", resumeCursor: "page:2", totalMatches: 1 });
    const timeout = await searchHoldedEstimates(deps([page([], "page:2"), new TransientError("timeout")]))(installationId, search("P-7"));
    expect(timeout.truncatedReason).toBe("holded_unavailable");
  });
  it("propagates the first-page failure and non-transient failures", async () => {
    await expect(searchHoldedEstimates(deps([new TransientError("rate_limited")]))(installationId, search("x"))).rejects.toMatchObject({ code: "rate_limited" });
    const forbidden = Object.assign(new Error("forbidden"), { code: "forbidden", retryable: false });
    await expect(searchHoldedEstimates(deps([page([], "page:2"), forbidden]))(installationId, search("x"))).rejects.toBe(forbidden);
  });
});

describe("get Holded estimate", () => {
  const detail: RemoteEstimateDetail = {
    ...estimate({ documentNumber: "P-15" }), lines: [], notes: "Nota", body: "<p>solo lectura</p>", language: "es", approvedAt: null, customFields: [], from: null,
  };
  it("returns the remote detail with local link and untrusted-data notice", async () => {
    const { lineTexts: _ignored, ...withoutLines } = detail as RemoteEstimateDetail & { lineTexts?: string[] };
    const d = deps([], [{ quoteId: localQuoteId, reference: "P-15", holdedEstimateId: detail.holdedEstimateId }]);
    vi.mocked(d.reader.get).mockResolvedValue(withoutLines);
    const result = await getHoldedEstimate(d)(installationId, detail.holdedEstimateId);
    expect(result).toMatchObject({ body: "<p>solo lectura</p>", generatorQuote: { quoteId: localQuoteId } });
    expect(result?.dataNotice).toContain("no confiable");
  });
  it("returns null when Holded does not have the estimate", async () => {
    const d = deps([]);
    vi.mocked(d.reader.get).mockResolvedValue(null);
    expect(await getHoldedEstimate(d)(installationId, "f".repeat(24))).toBeNull();
    expect(d.links.findByHoldedEstimateIds).not.toHaveBeenCalled();
  });
});
