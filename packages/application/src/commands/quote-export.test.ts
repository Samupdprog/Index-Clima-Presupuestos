import { describe, expect, it, vi } from "vitest";
import { buildEstimatePayload, resolveIgicTax, syncQuoteToHolded, verifyEstimate } from "./quote-export.js";
import type { ExportableQuote, EstimateTax, QuoteExportDeps } from "../ports/quote-export.js";

const tax: EstimateTax = { id: "t7", key: "igic7", name: "IGIC 7%", amount: "7", scope: "sales", group: "igic", type: "percentage", status: true };
const quote: ExportableQuote = { id: "quote", installationId: "installation", clientId: "client", clientSnapshot: {}, reference: "TEST", title: "TEST", revision: 4, origin: "generator", accessMode: "editable", status: "draft", duplicatedFromQuoteId: null, duplicateRootQuoteId: null, duplicateSequence: null, lines: [{ id: "line", type: "material", description: "Equipo", quantity: "3", unit: "ud", igicRate: "7" }], calculation: { saleWithoutTax: "100.00", taxTotal: "7.00", saleWithTax: "107.00", lines: [{ quoteLineId: "line", sale: "100.00", igic: "7.00" }] } };
const remote = { id: "estimate", contact_id: "contact", document_number: "TEST", notes: "", subtotal: "100", tax: "7", total: "107", lines: [{ name: "Equipo", units: "3", price: "33.3333333333", discount: "0", tax: "7", taxes: ["igic7"], unit_type: "unidades" }] };
function dependencies() {
  return { quotes: { getQuoteById: vi.fn().mockResolvedValue(quote) }, clients: { getById: vi.fn().mockResolvedValue({ holdedContactId: "contact" }) }, exports: { withLock: vi.fn((_i, _q, work) => work()), reserve: vi.fn().mockResolvedValue({ documentId: null, uncertain: false }), recordId: vi.fn(), complete: vi.fn(), fail: vi.fn() }, holded: { listTaxes: vi.fn().mockResolvedValue([tax]), saveEstimate: vi.fn().mockResolvedValue({ id: "estimate" }), getEstimate: vi.fn().mockResolvedValue(remote), approveEstimate: vi.fn(), getEstimatePdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])), findEstimateByTag: vi.fn().mockResolvedValue(null) }, logExport: vi.fn() };
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
    expect(payload.items[0]).toMatchObject({ price: "33.3333333333" });
    expect(payload.tax_included).toBe(true);
    expect(() => verifyEstimate(quote, payload, remote)).not.toThrow();
    expect(() => verifyEstimate(quote, payload, { ...remote, total: "107.02" })).toThrow("holded_totals_mismatch");
  });
  it("exports ordered quote text in notes and keeps it outside billable lines", () => {
    const withDetails = { ...quote, reference: "P-15", texts: [{ id: "later", position: 1, title: "Garantía", body: "Dos años" }, { id: "first", position: 0, title: "Condiciones", body: "Pago al contado" }] };
    const payload = buildEstimatePayload(withDetails, "contact", [tax]);
    expect(payload.number).toBe("P-15");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).not.toHaveProperty("unit_type");
    expect(payload.notes).toBe("Condiciones\nPago al contado\n\nGarantía\nDos años");
    expect(() => verifyEstimate(withDetails, payload, { ...remote, document_number: "P-15", notes: payload.notes })).not.toThrow();
    expect(() => verifyEstimate(withDetails, payload, { ...remote, document_number: "P-15", notes: "other" })).toThrow("holded_notes_mismatch");
  });
  it("sends empty notes to clear previously exported text", () => {
    expect(buildEstimatePayload(quote, "contact", [tax]).notes).toBe("");
  });
  it.each([["0", "0", "200", []], ["3", "6", "206", ["igic3"]], ["7", "14", "214", ["igic7"]]])("encodes two units at %s %% IGIC as gross %s", (rate, igic, gross, expectedTaxes) => {
    const taxes = [tax, { ...tax, id: "t3", key: "igic3", name: "IGIC 3%", amount: "3" }];
    const priced = { ...quote, lines: [{ ...quote.lines[0]!, quantity: "2", igicRate: rate }], calculation: { saleWithoutTax: "200", taxTotal: igic, saleWithTax: gross, lines: [{ quoteLineId: "line", sale: "200", igic }] } };
    const payload = buildEstimatePayload(priced, "contact", taxes);
    expect(payload.tax_included).toBe(true);
    expect(payload.items[0]).toMatchObject({ units: "2", price: "100", taxes: expectedTaxes });
  });
  it("keeps commercial line order and places text in the document notes", () => {
    const orderedQuote = { ...quote, lines: [
      { ...quote.lines[0]!, id: "a", description: "A", position: 0 },
      { ...quote.lines[0]!, id: "b", description: "B", position: 1 },
      { ...quote.lines[0]!, id: "c", description: "C", position: 3 },
    ], texts: [{ id: "x", position: 2, title: "Texto X", body: "X" }, { id: "y", position: 4, title: "Texto Y", body: "Y" }], calculation: { saleWithoutTax: "300", taxTotal: "21", saleWithTax: "321", lines: ["a", "b", "c"].map((quoteLineId) => ({ quoteLineId, sale: "100", igic: "7" })) } };
    const payload = buildEstimatePayload(orderedQuote, "contact", [tax]);
    expect(payload.items.map((item) => item.name)).toEqual(["A", "B", "C"]);
    expect(payload.notes).toBe("Texto X\nX\n\nTexto Y\nY");
  });
  it("rejects a remote document with a different number or reordered lines", () => {
    const payload = buildEstimatePayload(quote, "contact", [tax]);
    expect(() => verifyEstimate(quote, payload, { ...remote, document_number: "OTHER" })).toThrow("holded_number_mismatch");
    expect(() => verifyEstimate(quote, payload, { ...remote, lines: [{ ...remote.lines[0]!, name: "Otro concepto" }] })).toThrow("holded_lines_mismatch");
  });
  it("persists created ID before verification and preserves it on mismatch", async () => {
    const deps = dependencies(); deps.holded.getEstimate.mockResolvedValue({ ...remote, total: "121" });
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("holded_totals_mismatch");
    expect(deps.exports.recordId).toHaveBeenCalledWith("installation", "quote", "estimate");
    expect(deps.exports.complete).not.toHaveBeenCalled();
    expect(deps.exports.fail).toHaveBeenCalledWith("installation", "quote", "holded_totals_mismatch", false);
    expect(deps.logExport).toHaveBeenCalledWith(expect.objectContaining({ operation: "estimate.create", quoteId: "quote", holdedEstimateId: "estimate", lineCount: 1, status: "failed", errorCode: "holded_totals_mismatch" }));
  });
  it("updates the same ID and rejects stale revision before sending", async () => {
    const deps = dependencies(); deps.exports.reserve.mockResolvedValue({ documentId: "estimate", uncertain: false });
    await syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input);
    expect(deps.holded.saveEstimate).toHaveBeenCalledWith(expect.any(Object), "estimate");
    expect(deps.logExport).toHaveBeenCalledWith(expect.objectContaining({ operation: "estimate.update", quoteId: "quote", holdedEstimateId: "estimate", status: "synced" }));
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)({ ...input, expectedRevision: 3 })).rejects.toThrow("revision_conflict");
    expect(deps.holded.saveEstimate).toHaveBeenCalledTimes(1);
  });
  it("approves a draft so its local number appears in the PDF before completing sync", async () => {
    const deps = dependencies();
    deps.holded.getEstimate.mockResolvedValueOnce({ ...remote, draft: true }).mockResolvedValueOnce({ ...remote, draft: false });
    await syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input);
    expect(deps.holded.approveEstimate).toHaveBeenCalledWith("estimate");
    expect(deps.holded.getEstimatePdf).toHaveBeenCalledWith("estimate");
    expect(deps.exports.complete).toHaveBeenCalled();
  });
  it("blocks an existing estimate with a different number without duplicating it", async () => {
    const deps = dependencies();
    deps.exports.reserve.mockResolvedValue({ documentId: "estimate", uncertain: false });
    deps.holded.getEstimate.mockResolvedValueOnce({ ...remote, document_number: null });
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("holded_number_mismatch");
    expect(deps.holded.saveEstimate).not.toHaveBeenCalled();
    expect(deps.exports.recordId).not.toHaveBeenCalled();
  });
  it("does not duplicate an uncertain estimate whose recovered number differs", async () => {
    const deps = dependencies();
    deps.exports.reserve.mockResolvedValue({ documentId: null, uncertain: true });
    deps.holded.findEstimateByTag.mockResolvedValue("estimate");
    deps.holded.getEstimate.mockResolvedValueOnce({ ...remote, document_number: null });
    await expect(syncQuoteToHolded(deps as unknown as QuoteExportDeps)(input)).rejects.toThrow("holded_number_mismatch");
    expect(deps.holded.findEstimateByTag).toHaveBeenCalledWith("index-clima-installation-quote", "contact");
    expect(deps.holded.saveEstimate).not.toHaveBeenCalled();
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
