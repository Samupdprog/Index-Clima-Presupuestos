import type { QuoteRepository } from "../ports/quotes.js";
import { calculateQuote, calculateLine, calculateMarginOnSalePct, calculateProfitOnCostPct, money, PricingValidationError, resolveSaleBaseUnitPrice, type PriceAdjustment, type QuoteCalculation, type QuoteLineInput } from "@quotes/domain";
import type { PriceAdjustmentEconomics, PriceAdjustmentPreview, PreviewPriceAdjustmentRequest, QuoteCommand } from "@quotes/contracts";
import type { QuoteRecord } from "../ports/quotes.js";

export function getQuote(repository: QuoteRepository) {
  return (installationId: string, id: string) => repository.getQuoteById(installationId, id);
}

export function searchQuotes(repository: QuoteRepository) {
  return (installationId: string, query = "") => repository.searchQuotes(installationId, query);
}

type RawLine = {
  id: string; type: QuoteLineInput["type"]; description: string; quantity: string; igicRate: string;
  saleRule: QuoteLineInput["saleRule"]["type"]; saleRuleValue: string; saleBaseMode?: "net_cost" | "supplier_list_price" | undefined;
  baseUnitPrice?: string | null | undefined; directUnitCost?: string | null | undefined; supplierUnitPrice?: string | null | undefined; eligibleForPriceAllocation?: boolean;
  discounts?: Array<{ percentage: string }>; laborEntries?: Array<{ hours: string; costRateSnapshot: string; saleRateSnapshot: string }>;
};

export function toQuoteLineInput(line: RawLine): QuoteLineInput {
  return {
    id: line.id, type: line.type, description: line.description, quantity: line.quantity, igicRate: line.igicRate,
    ...(line.eligibleForPriceAllocation !== undefined ? { eligibleForPriceAllocation: line.eligibleForPriceAllocation } : {}),
    ...(line.saleBaseMode ? { saleBaseMode: line.saleBaseMode } : {}),
    saleRule: { type: line.saleRule, value: line.saleRuleValue, ...(line.baseUnitPrice != null ? { baseUnitPrice: line.baseUnitPrice } : {}) },
    ...(line.directUnitCost != null ? { directUnitCost: line.directUnitCost } : {}),
    ...(line.supplierUnitPrice != null ? { supplierUnitPrice: line.supplierUnitPrice } : {}),
    supplierDiscounts: line.discounts ?? [],
    laborEntries: (line.laborEntries ?? []).map((entry) => ({ hours: entry.hours, costRate: entry.costRateSnapshot, saleRate: entry.saleRateSnapshot })),
  };
}

export function calculateQuoteRecord(quote: Pick<QuoteRecord, "lines" | "priceAdjustments">): QuoteCalculation {
  return calculateQuote((quote.lines as RawLine[]).map(toQuoteLineInput), quote.priceAdjustments as PriceAdjustment[] ?? []);
}

async function currentQuote(repository: QuoteRepository, installationId: string, id: string, revision: number) {
  const quote = await repository.getQuoteById(installationId, id);
  if (!quote) throw new PricingValidationError("quote_not_found");
  if (quote.revision !== revision) throw new PricingValidationError("revision_conflict");
  if (quote.accessMode === "read_only" || quote.status === "archived") throw new PricingValidationError("quote_read_only");
  return quote;
}

function economics(cost: ReturnType<typeof money>, before: ReturnType<typeof money>, after: ReturnType<typeof money>): PriceAdjustmentEconomics {
  return {
    costBefore: cost.toFixed(2), saleBefore: before.toFixed(2), saleAfter: after.toFixed(2), allocatedAdjustment: after.minus(before).toFixed(2),
    profitBefore: before.minus(cost).toFixed(2), profitAfter: after.minus(cost).toFixed(2),
    marginBefore: calculateMarginOnSalePct(before, cost)?.toFixed(6) ?? null,
    marginAfter: calculateMarginOnSalePct(after, cost)?.toFixed(6) ?? null,
    profitOnCostBefore: calculateProfitOnCostPct(before, cost)?.toFixed(6) ?? null,
    profitOnCostAfter: calculateProfitOnCostPct(after, cost)?.toFixed(6) ?? null,
  };
}

export function previewPriceAdjustment(repository: QuoteRepository) {
  return async (installationId: string, quoteId: string, input: PreviewPriceAdjustmentRequest): Promise<PriceAdjustmentPreview> => {
    const quote = await currentQuote(repository, installationId, quoteId, input.expectedRevision);
    const lines = (quote.lines as RawLine[]).map(toQuoteLineInput);
    const adjustments = quote.priceAdjustments as PriceAdjustment[] ?? [];
    const operation: PriceAdjustment = { id: "preview", scope: input.scope, mode: input.mode, value: input.value, baseQuoteRevision: input.expectedRevision, ...(input.targetLineIds ? { targetLineIds: input.targetLineIds } : {}) };
    const before = calculateQuote(lines, adjustments);
    const after = calculateQuote(lines, [...adjustments, operation]);
    const selected = before.lines.filter((line) => input.scope === "quote" || input.targetLineIds?.includes(line.id));
    const previewLines = selected.map((line) => {
      const result = after.lines.find((item) => item.id === line.id)!;
      const source = lines.find((item) => item.id === line.id)!;
      const quantity = money(source.quantity);
      return { id: line.id, description: source.description ?? "", quantity: quantity.toString(),
        unitCost: quantity.isZero() ? "0.00" : line.cost.div(quantity).toFixed(6),
        saleUnitBefore: quantity.isZero() ? "0.00" : line.sale.div(quantity).toFixed(6),
        saleUnitAfter: quantity.isZero() ? "0.00" : result.sale.div(quantity).toFixed(6),
        ...economics(line.cost, line.sale, result.sale) };
    });
    const sum = (field: "costBefore" | "saleBefore" | "saleAfter") => previewLines.reduce((total, line) => total.plus(line[field]), money(0));
    return { quoteId, expectedRevision: input.expectedRevision, resultingRevisionPreview: input.expectedRevision + 1, lines: previewLines,
      totals: economics(sum("costBefore"), sum("saleBefore"), sum("saleAfter")), validation: { valid: true, warnings: [] } };
  };
}

export function previewQuoteLine(repository: QuoteRepository) {
  return async (installationId: string, quoteId: string, command: Extract<QuoteCommand, { type: "updateQuoteLineDetails" | "createQuoteLine" }>) => {
    const quote = await currentQuote(repository, installationId, quoteId, command.expectedRevision);
    const current = command.type === "createQuoteLine" ? { id: "preview", type: command.lineType } : (quote.lines as RawLine[]).find((line) => line.id === command.lineId);
    if (!current) throw new PricingValidationError("quote_line_not_found");
    const line = toQuoteLineInput({ ...current, ...command.line, discounts: command.discounts, laborEntries: command.laborEntries });
    const calculated = calculateLine(line);
    return { ...calculated, quoteLineId: line.id,
      saleBase: line.saleRule.type === "add_percentage" || line.saleRule.type === "add_euros_per_unit"
        ? resolveSaleBaseUnitPrice(line.saleBaseMode ?? "net_cost", line.directUnitCost, line.supplierUnitPrice, line.supplierDiscounts).toFixed(6) : null };
  };
}
