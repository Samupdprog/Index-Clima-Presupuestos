import { money } from "@quotes/domain";
import type { EstimatePayload, EstimateTax, ExportableQuote, QuoteExportDeps, RemoteEstimate } from "../ports/quote-export.js";

export class QuoteExportError extends Error {
  constructor(public readonly code: string, public readonly details: Record<string, unknown> = {}) { super(code); this.name = "QuoteExportError"; }
}

export function resolveIgicTax(rate: string, taxes: EstimateTax[], mapping: Record<string, string> = {}): string[] {
  const normalized = money(rate).toString();
  const compatible = taxes.filter((tax) => tax.status && tax.scope === "sales" && tax.amount !== null && money(tax.amount).eq(rate) && /igic/i.test(`${tax.key} ${tax.name} ${tax.group} ${tax.type}`));
  const selected = mapping[normalized];
  if (selected) {
    const found = compatible.find((tax) => tax.key === selected || tax.id === selected);
    if (!found) throw new QuoteExportError("holded_invalid_tax_mapping", { rate: normalized, tax: selected });
    return [found.key];
  }
  if (compatible.length > 1) throw new QuoteExportError("holded_ambiguous_igic", { rate: normalized, candidates: compatible.map((tax) => ({ key: tax.key, name: tax.name })) });
  if (compatible.length === 1) return [compatible[0]!.key];
  // Explicit [] prevents the contact's default VAT from being applied on zero-rated lines.
  if (money(rate).isZero()) return [];
  throw new QuoteExportError("holded_missing_igic", { rate: normalized });
}

interface Calculation { saleWithoutTax: string; taxTotal: string; saleWithTax: string; lines: Array<{ quoteLineId: string; sale: string; igic: string }> }
interface ExportLine { id: string; type: string; description: string; quantity: string; igicRate: string; unit: string }

export function buildEstimatePayload(quote: ExportableQuote, contactId: string, taxes: EstimateTax[], mapping: Record<string, string> = {}): EstimatePayload {
  const calculation = quote.calculation as Calculation | null;
  if (!calculation?.lines?.length) throw new QuoteExportError("quote_not_calculated");
  const calculations = new Map(calculation.lines.map((line) => [line.quoteLineId, line]));
  let subtotal = money(0);
  let taxTotal = money(0);
  const items = (quote.lines as ExportLine[]).filter((line) => line.type !== "title" && line.type !== "adjustment").map((line) => {
    const calculated = calculations.get(line.id);
    if (!calculated) throw new QuoteExportError("quote_calculation_stale", { lineId: line.id });
    const quantity = money(line.quantity);
    const sale = money(calculated.sale);
    if (quantity.lte(0) || sale.lt(0)) throw new QuoteExportError("holded_invalid_line", { lineId: line.id });
    const price = sale.div(quantity).toDecimalPlaces(10);
    if (!price.mul(quantity).toDecimalPlaces(2).eq(sale)) throw new QuoteExportError("holded_line_rounding", { lineId: line.id });
    subtotal = subtotal.plus(sale);
    taxTotal = taxTotal.plus(calculated.igic);
    return { name: line.description.slice(0, 250), description: line.description, type: line.type === "material" ? "product" as const : "service" as const, units: quantity.toString(), price: price.toString(), discount: "0", taxes: resolveIgicTax(line.igicRate, taxes, mapping), unit_type: line.unit };
  });
  if (!items.length || !subtotal.eq(calculation.saleWithoutTax) || !taxTotal.eq(calculation.taxTotal)) throw new QuoteExportError("quote_calculation_stale");
  return { contact_id: contactId, description: `${quote.reference} · ${quote.title}`, date: new Date().toISOString().slice(0, 10), notes: `Presupuesto ${quote.reference} generado desde Index Clima`, tags: [`index-clima-${quote.installationId}-${quote.id}`], currency: "EUR", discount: "0", tax_included: false, items };
}

export function verifyEstimate(quote: ExportableQuote, payload: EstimatePayload, remote: RemoteEstimate): void {
  const calculation = quote.calculation as Calculation;
  for (const [field, expected] of [["subtotal", calculation.saleWithoutTax], ["tax", calculation.taxTotal], ["total", calculation.saleWithTax]] as const) {
    const actual = remote[field];
    if (actual === undefined || money(actual).minus(expected).abs().gt("0.01")) throw new QuoteExportError("holded_totals_mismatch", { field, expected, actual: actual ?? null, estimateId: remote.id });
  }
  if (remote.contact_id !== payload.contact_id) throw new QuoteExportError("holded_contact_mismatch", { estimateId: remote.id });
  if (!Array.isArray(remote.lines) || remote.lines.length !== payload.items.length) throw new QuoteExportError("holded_lines_mismatch", { estimateId: remote.id });
  remote.lines.forEach((line, index) => {
    const expected = payload.items[index]!;
    if (!money(line.units).eq(expected.units) || !money(line.discount ?? "0").isZero() || money(line.price).mul(line.units).minus(money(expected.price).mul(expected.units)).abs().gt("0.01")) throw new QuoteExportError("holded_lines_mismatch", { line: index, estimateId: remote.id });
    if (expected.taxes.some((tax) => !line.taxes.includes(tax))) throw new QuoteExportError("holded_tax_mismatch", { line: index, estimateId: remote.id });
  });
}

export function syncQuoteToHolded(deps: QuoteExportDeps) {
  return async (input: { installationId: string; quoteId: string; expectedRevision: number }) => deps.exports.withLock(input.installationId, input.quoteId, async () => {
    const quote = await deps.quotes.getQuoteById(input.installationId, input.quoteId);
    if (!quote) throw new QuoteExportError("quote_not_found");
    if (quote.revision !== input.expectedRevision) throw new QuoteExportError("revision_conflict");
    if (quote.accessMode === "read_only" || quote.status === "archived") throw new QuoteExportError("quote_read_only");
    const client = quote.clientId ? await deps.clients.getById(input.installationId, quote.clientId) : null;
    if (!client || client.deletedAt || !client.holdedContactId) throw new QuoteExportError("holded_client_not_linked");
    const payload = buildEstimatePayload(quote, client.holdedContactId, await deps.holded.listTaxes(), deps.taxMapping);
    const reservation = await deps.exports.reserve(input.installationId, input.quoteId, input.expectedRevision);
    let documentId = reservation.documentId;
    let uncertain = reservation.uncertain;
    let attemptedCreate = false;
    try {
      if (!documentId && uncertain) {
        documentId = await deps.holded.findEstimateByTag(payload.tags![0]!, payload.contact_id);
        if (!documentId) throw new QuoteExportError("holded_creation_uncertain");
        await deps.exports.recordId(input.installationId, input.quoteId, documentId);
      }
      attemptedCreate = !documentId;
      const result = await deps.holded.saveEstimate(payload, documentId);
      documentId = result.id;
      await deps.exports.recordId(input.installationId, input.quoteId, documentId);
      uncertain = false;
      verifyEstimate(quote, payload, await deps.holded.getEstimate(documentId));
      await deps.exports.complete(input.installationId, input.quoteId, input.expectedRevision);
      return deps.quotes.getQuoteById(input.installationId, input.quoteId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const ambiguous = uncertain || (!documentId && attemptedCreate && !(status && status >= 400 && status < 500));
      await deps.exports.fail(input.installationId, input.quoteId, error instanceof Error ? error.message : "holded_export_failed", ambiguous);
      throw error;
    }
  });
}
