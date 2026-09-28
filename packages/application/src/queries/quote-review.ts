import { calculateQuoteRecord } from "./quotes.js";
import type { QuoteRepository } from "../ports/quotes.js";

export function getQuoteReview(repository: QuoteRepository) {
  return async (installationId: string, quoteId: string) => {
    const quote = await repository.getQuoteById(installationId, quoteId);
    if (!quote) return null;
    const issues: Array<{ code: string; message: string; lineId?: string }> = [];
    if (!quote.clientId) issues.push({ code: "client_required", message: "Selecciona un cliente antes de enviar el presupuesto." });
    if (!quote.lines.length) issues.push({ code: "lines_required", message: "Añade al menos un concepto." });
    try {
      const calculation = calculateQuoteRecord(quote);
      for (const line of calculation.lines) {
        if (line.sale.isZero() && line.cost.greaterThan(0)) issues.push({ code: "sale_price_pending", message: "La venta es cero y existe un coste. Confirma o corrige el precio.", lineId: line.id });
        if (line.profit.isNegative()) issues.push({ code: "negative_profit", message: "Revisa la línea con beneficio negativo.", lineId: line.id });
      }
    } catch {
      issues.push({ code: "pricing_incomplete", message: "Faltan datos válidos para calcular el presupuesto." });
    }
    return { quoteId, revision: quote.revision, ready: issues.length === 0, issues, quote };
  };
}
