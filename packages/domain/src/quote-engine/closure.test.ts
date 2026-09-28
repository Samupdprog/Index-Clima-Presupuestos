import { describe, expect, it } from "vitest";
import { applyConsecutiveDiscounts, calculateQuote, calculateLine, effectiveSupplierDiscountPct, resolveSaleBaseUnitPrice, type QuoteLineInput } from "./engine.js";
const material = (overrides: Partial<QuoteLineInput> = {}): QuoteLineInput => ({ id: "a", type: "material", quantity: "1", igicRate: "7", supplierUnitPrice: "1000", supplierDiscounts: [{ percentage: "40" }, { percentage: "10" }], saleBaseMode: "supplier_list_price", saleRule: { type: "add_percentage", value: "0" }, ...overrides });
describe("functional pricing regression", () => {
  it.each([[[], "1000"], [["40"], "600"], [["40", "10"], "540"], [["30", "10", "5"], "598.5"], [["30", "10", "5", "10"], "538.65"]])("preserves successive supplier discounts %j", (discounts, expected) => {
    expect(applyConsecutiveDiscounts("1000", discounts.map((percentage) => ({ percentage }))).toString()).toBe(expected);
  });
  it("uses gross as sale base, including zero markup and quantity >1", () => {
    const line = calculateLine(material());
    expect(line.cost.toFixed(2)).toBe("540.00"); expect(line.sale.toFixed(2)).toBe("1000.00"); expect(line.profit.toFixed(2)).toBe("460.00");
    expect(line.marginOnSalePct?.toFixed(2)).toBe("46.00"); expect(line.effectiveSupplierDiscount.toString()).toBe("46");
    const marked = calculateLine(material({ quantity: "3", saleRule: { type: "add_percentage", value: "10" } }));
    expect(marked.sale.toFixed(2)).toBe("3300.00"); expect(marked.cost.toFixed(2)).toBe("1620.00"); expect(marked.profit.toFixed(2)).toBe("1680.00");
  });
  it("uses net base and reconstructs gross only when unambiguous", () => {
    expect(calculateLine(material({ saleBaseMode: "net_cost" })).sale.toString()).toBe("540");
    expect(resolveSaleBaseUnitPrice("supplier_list_price", "540", undefined, [{ percentage: "40" }, { percentage: "10" }]).toString()).toBe("1000");
    expect(() => resolveSaleBaseUnitPrice("supplier_list_price", "0", undefined, [{ percentage: "100" }])).toThrow("pricing_data_required");
    expect(() => calculateLine(material({ supplierUnitPrice: undefined } as never))).toThrow("pricing_data_required");
  });
  it.each(["-1", "101", "NaN", "Infinity"])("rejects discount %s", (percentage) => { expect(() => effectiveSupplierDiscountPct([{ percentage }])).toThrow(); });
  it("reproduces five machines without silently selling for zero", () => {
    const lines = ["1283.94", "1260.00", "1159.20", "1283.94", "762.30"].map((cost, i) => material({ id: String(i), supplierUnitPrice: cost, supplierDiscounts: [], directUnitCost: cost }));
    const result = calculateQuote(lines);
    expect(result.cost.toFixed(2)).toBe("5749.38"); expect(result.saleWithoutTax.toFixed(2)).toBe("5749.38"); expect(result.profit.toFixed(2)).toBe("0.00");
    const adjusted = calculateQuote(lines, [{ id: "adjust", scope: "selection", mode: "amount", value: "300", targetLineIds: ["0", "1", "2"], baseQuoteRevision: 0 }]);
    expect(adjusted.saleWithoutTax.toFixed(2)).toBe("6049.38"); expect(adjusted.lines[3]!.adjustment.toFixed(2)).toBe("0.00");
    expect(adjusted.lines.reduce((sum, line) => sum.plus(line.adjustment), result.profit).toFixed(2)).toBe("300.00");
  });
  it("allocates one cent deterministically and rejects stale targets", () => {
    const lines = ["a", "b", "c"].map((id) => material({ id, supplierUnitPrice: "1", supplierDiscounts: [] }));
    const operation = { id: "x", scope: "quote" as const, mode: "amount" as const, value: "0.01", baseQuoteRevision: 0 };
    const result = calculateQuote(lines, [operation]); expect(result.subtotal.toString()).toBe("3.01");
    expect(calculateQuote(lines, [operation]).lines.map((line) => line.sale.toString())).toEqual(result.lines.map((line) => line.sale.toString()));
    expect(() => calculateQuote(lines, [{ ...operation, scope: "selection", targetLineIds: ["missing"] }])).toThrow("adjustment_target_not_found");
    const reversedIds = ["z", "y", "x"].map((id) => material({ id, supplierUnitPrice: "1", supplierDiscounts: [] }));
    expect(calculateQuote(reversedIds, [operation]).lines.map((line) => line.adjustment.toFixed(2))).toEqual(["0.01", "0.00", "0.00"]);
  });
});
