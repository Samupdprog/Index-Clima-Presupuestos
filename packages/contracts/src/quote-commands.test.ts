import { describe, expect, it } from "vitest";
import { quoteCommandSchema } from "./quote-commands.js";

const line = { description: "Mano de obra instalación", unit: "h", quantity: "1", igicRate: "7", saleRule: "unit_price", saleRuleValue: "0", baseUnitPrice: null, directUnitCost: null, supplierUnitPrice: null, saleBaseMode: "net_cost" };
const worker = { employeeNameSnapshot: "Juan", hours: "4", costRateSnapshot: "22.50", saleRateSnapshot: "42" };

describe("comandos compuestos de líneas", () => {
  it("acepta varios empleados en una única creación con revisión", () => {
    const result = quoteCommandSchema.parse({ type: "createQuoteLine", expectedRevision: 3, lineType: "labor", line, discounts: [], laborEntries: [worker, { ...worker, employeeNameSnapshot: "Pedro", hours: "3" }] });
    expect(result.type).toBe("createQuoteLine");
    if (result.type === "createQuoteLine") expect(result.laborEntries).toHaveLength(2);
  });
  it("acepta editar, quitar y reordenar descuentos y empleados juntos", () => {
    const id = "c51d21ac-04b8-4390-9a20-d35c56f21152";
    const result = quoteCommandSchema.parse({ type: "updateQuoteLineDetails", expectedRevision: 4, lineId: id, line, discounts: [{ id, percentage: "5" }, { percentage: "20" }], laborEntries: [{ id, ...worker }] });
    expect(result.type).toBe("updateQuoteLineDetails");
  });
  it("rechaza cambios sin expectedRevision y campos económicos arbitrarios", () => {
    expect(quoteCommandSchema.safeParse({ type: "createQuoteLine", lineType: "other", line, discounts: [], laborEntries: [] }).success).toBe(false);
    const parsed = quoteCommandSchema.parse({ type: "createQuoteLine", expectedRevision: 0, lineType: "other", line: { ...line, profit: "999" }, discounts: [], laborEntries: [] });
    if (parsed.type === "createQuoteLine") expect("profit" in parsed.line).toBe(false);
  });
});
