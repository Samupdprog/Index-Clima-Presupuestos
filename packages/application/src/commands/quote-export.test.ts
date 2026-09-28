import { describe, expect, it, vi } from "vitest";
import { buildEstimatePayload, resolveIgicTax, syncQuoteToHolded, verifyEstimate } from "./quote-export.js";
import type { ExportableQuote, EstimateTax, QuoteExportDeps } from "../ports/quote-export.js";

const tax: EstimateTax = { id: "t7", key: "igic7", name: "IGIC 7%", amount: "7", scope: "sales", group: "igic", type: "percentage", status: true };
const quote: ExportableQuote = { id: "quote", installationId: "installation", clientId: "client", clientSnapshot: {}, reference: "TEST", title: "TEST", revision: 4, origin: "generator", accessMode: "editable", status: "draft", duplicatedFromQuoteId: null, duplicateRootQuoteId: null, duplicateSequence: null, lines: [{ id: "line", type: "material", description: "Equipo", quantity: "3", unit: "ud", igicRate: "7" }], calculation: { saleWithoutTax: "100.00", taxTotal: "7.00", saleWithTax: "107.00", lines: [{ quoteLineId: "line", sale: "100.00", igic: "7.00" }] } };
const remote = { id: "estimate", contact_id: "contact", subtotal: "100", tax: "7", total: "107", lines: [{ name: "Equipo", units: "3", price: "33.3333333333", discount: "0", tax: "7", taxes: ["igic7"] }] };
function dependencies() {
  return { quotes: { getQuoteById: vi.fn().mockResolvedValue(quote) }, clients: { getById: vi.fn().mockResolvedValue({ holdedContactId: "contact" }) }, exports: { withLock: vi.fn((_i, _q, work) => work()), reserve: vi.fn().mockResolvedValue({ documentId: null, uncertain: false }), recordId: vi.fn(), complete: vi.fn(), fail: vi.fn() }, holded: { listTaxes: vi.fn().mockResolvedValue([tax]), saveEstimate: vi.fn().mockResolvedValue({ id: "estimate" }), getEstimate: vi.fn().mockResolvedValue(remote), findEstimateByTag: vi.fn().mockResolvedValue(null) } };
}
const input = { installationId: "installation", quoteId: "quote", expectedRevision: 4 };
describe("estimate export authority and recovery", () => {
  it("selects only actual active sales IGIC and refuses ambiguous or VAT mapping", () => {
    const vat = { ...tax, key: "vat7", name: "IVA", group: "vat" };
    expect(resolveIgicTax("7.00", [vat, tax])).toEqual(["igic7"]);
    expect(() => resolveIgicTax("7", [tax, { ...tax, key: "custom7" }])).toThrow("holded_ambiguous_igic");
    expect(() => resolveIgicTax("7", [vat], { "7": "vat7" })).toThrow("holded_invalid_tax_mapping");
    expect(resolveIgicTax("0", [tax])).toEqual([]);
    expect(() => resolveIgicTax("15", [tax])).toThrow("holded_missing_igic");
  });
  it("exports final sales with fractional unit precision and verifies totals", () => {
    const payload = buildEstimatePayload(quote, "contact", [tax]);
    expect(payload.items[0]?.price).toBe("33.3333333333");
    expect(payload.tax_included).toBe(false);
    expect(() => verifyEstimate(quote, payload, remote)).not.toThrow();
    expect(() => verifyEstimate(quote, payload, { ...remote, total: "107.02" })).toThrow("holded_totals_mismatch");
  });
  it("persists created ID before verification and preserves it on mismatch", async () => {
    const deps = dependencies(); deps.holded.getEstimate.mockResolvedValue({ ...remote, total: "121" });
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("holded_totals_mismatch");
    expect(deps.exports.recordId).toHaveBeenCalledWith("installation", "quote", "estimate");
    expect(deps.exports.complete).not.toHaveBeenCalled();
    expect(deps.exports.fail).toHaveBeenCalledWith("installation", "quote", "holded_totals_mismatch", false);
  });
  it("updates the same ID and rejects stale revision before sending", async () => {
    const deps = dependencies(); deps.exports.reserve.mockResolvedValue({ documentId: "estimate", uncertain: false });
    await syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input);
    expect(deps.holded.saveEstimate).toHaveBeenCalledWith(expect.any(Object), "estimate");
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)({ ...input, expectedRevision: 3 })).rejects.toThrow("revision_conflict");
    expect(deps.holded.saveEstimate).toHaveBeenCalledTimes(1);
  });
  it("does not repeat POST after an uncertain create without a found document", async () => {
    const deps = dependencies(); deps.exports.reserve.mockResolvedValue({ documentId: null, uncertain: true });
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("holded_creation_uncertain");
    expect(deps.holded.saveEstimate).not.toHaveBeenCalled();
    deps.holded.findEstimateByTag.mockResolvedValue("estimate");
    await syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input);
    expect(deps.holded.saveEstimate).toHaveBeenCalledWith(expect.any(Object), "estimate");
  });
  it("records a network timeout on create as uncertain", async () => {
    const deps = dependencies(); deps.holded.saveEstimate.mockRejectedValue(new Error("timeout"));
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("timeout");
    expect(deps.exports.fail).toHaveBeenCalledWith("installation", "quote", "timeout", true);
  });
});
