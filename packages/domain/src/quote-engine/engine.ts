import { Decimal } from "decimal.js";
import { money, type Money } from "../money/money.js";

export type QuoteLineType = "material" | "labor" | "travel" | "adjustment" | "other" | "title";
export type SaleRuleType = "unit_price" | "fixed_line_total" | "add_euros_per_unit" | "add_percentage";
export type AdjustmentMode = "amount" | "percentage" | "target_total";

export interface SupplierDiscount {
  percentage: Decimal.Value;
}

export interface LaborEntry {
  employeeId?: string;
  employeeName?: string;
  hours: Decimal.Value;
  costRate: Decimal.Value;
  saleRate: Decimal.Value;
}

export interface QuoteLineInput {
  id: string;
  type: QuoteLineType;
  description?: string;
  quantity: Decimal.Value;
  igicRate?: Decimal.Value;
  eligibleForPriceAllocation?: boolean;
  saleRule: { type: SaleRuleType; value: Decimal.Value; baseUnitPrice?: Decimal.Value };
  directUnitCost?: Decimal.Value;
  supplierUnitPrice?: Decimal.Value;
  supplierDiscounts?: SupplierDiscount[];
  laborEntries?: LaborEntry[];
}

export interface PriceAdjustment {
  id: string;
  scope: "line" | "selection" | "quote";
  mode: AdjustmentMode;
  value: Decimal.Value;
  targetLineIds?: string[];
  allocationMethod?: "proportional";
  baseQuoteRevision: number;
}

export interface CalculatedLine {
  id: string;
  type: QuoteLineType;
  quantity: Money;
  igicRate: Money;
  eligibleForPriceAllocation: boolean;
  cost: Money;
  baseSale: Money;
  sale: Money;
  adjustment: Money;
  profit: Money;
  profitOnCostPct: Money | null;
  marginOnSalePct: Money | null;
  igic: Money;
  finalSaleWithTax: Money;
}

export interface QuoteCalculation {
  lines: CalculatedLine[];
  subtotal: Money;
  igic: Money;
  total: Money;
  cost: Money;
  profit: Money;
  profitOnCostPct: Money | null;
  marginOnSalePct: Money | null;
  saleWithoutTax: Money;
  taxTotal: Money;
  saleWithTax: Money;
}

export function applyConsecutiveDiscounts(value: Decimal.Value, discounts: SupplierDiscount[] = []): Money {
  return discounts.reduce(
    (current, discount) => current.times(new Decimal(100).minus(discount.percentage).div(100)),
    money(value),
  );
}

export function calculateCost(line: QuoteLineInput): Money {
  if (line.laborEntries?.length) {
    return line.laborEntries.reduce(
      (total, entry) => total.plus(money(entry.hours).times(entry.costRate)),
      money(0),
    );
  }
  if (line.directUnitCost !== undefined) return money(line.quantity).times(line.directUnitCost);
  if (line.supplierUnitPrice !== undefined) {
    return money(line.quantity).times(applyConsecutiveDiscounts(line.supplierUnitPrice, line.supplierDiscounts));
  }
  return money(0);
}

export function calculateBaseSale(line: QuoteLineInput): Money {
  const quantity = money(line.quantity);
  const value = money(line.saleRule.value);
  const baseUnitPrice = money(line.saleRule.baseUnitPrice ?? 0);
  switch (line.saleRule.type) {
    case "fixed_line_total":
      return value;
    case "add_euros_per_unit":
      return quantity.times(baseUnitPrice.plus(value));
    case "add_percentage":
      return quantity.times(baseUnitPrice).times(new Decimal(1).plus(value.div(100)));
    case "unit_price":
      return quantity.times(value);
  }
}

function calculateSaleFromLabor(line: QuoteLineInput): Money | undefined {
  if (!line.laborEntries?.length) return undefined;
  return line.laborEntries.reduce(
    (total, entry) => total.plus(money(entry.hours).times(entry.saleRate)),
    money(0),
  );
}

export function calculateLine(line: QuoteLineInput): CalculatedLine {
  const cost = calculateCost(line);
  const baseSale = calculateSaleFromLabor(line) ?? calculateBaseSale(line);
  const sale = baseSale.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const roundedCost = cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const profit = sale.minus(roundedCost);
  const igic = calculateIgic(sale, line.igicRate ?? 0);
  return {
    id: line.id,
    type: line.type,
    quantity: money(line.quantity),
    igicRate: money(line.igicRate ?? 0),
    eligibleForPriceAllocation: line.eligibleForPriceAllocation !== false,
    cost: roundedCost,
    baseSale: sale,
    sale,
    adjustment: money(0),
    profit,
    profitOnCostPct: roundedCost.isZero() ? null : profit.div(roundedCost).times(100),
    marginOnSalePct: sale.isZero() ? null : profit.div(sale).times(100),
    igic,
    finalSaleWithTax: sale.plus(igic),
  };
}

export function calculateIgic(subtotal: Decimal.Value, rate: Decimal.Value): Money {
  return money(subtotal).times(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function calculateProfitEur(sale: Decimal.Value, cost: Decimal.Value): Money {
  return money(sale).minus(cost);
}

export function calculateProfitOnCostPct(sale: Decimal.Value, cost: Decimal.Value): Money | null {
  const costValue = money(cost);
  return costValue.isZero() ? null : calculateProfitEur(sale, cost).div(costValue).times(100);
}

export function calculateMarginOnSalePct(sale: Decimal.Value, cost: Decimal.Value): Money | null {
  const saleValue = money(sale);
  return saleValue.isZero() ? null : calculateProfitEur(sale, cost).div(saleValue).times(100);
}

export function allocateProportionalAdjustment(
  amount: Decimal.Value,
  lines: Pick<CalculatedLine, "id" | "sale" | "type" | "eligibleForPriceAllocation">[],
): Map<string, Money> {
  const eligible = lines.filter((line) => line.type !== "adjustment" && line.type !== "title" && line.sale.gt(0) && line.eligibleForPriceAllocation !== false);
  const total = eligible.reduce((sum, line) => sum.plus(line.sale), money(0));
  const result = new Map<string, Money>();
  if (total.isZero()) return result;
  const target = money(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let allocated = money(0);
  eligible.forEach((line, index) => {
    const value = index === eligible.length - 1
      ? target.minus(allocated)
      : target.times(line.sale).div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    result.set(line.id, value);
    allocated = allocated.plus(value);
  });
  return result;
}

export function applyLineAdjustment(line: CalculatedLine, adjustment: PriceAdjustment): CalculatedLine {
  const delta = adjustment.mode === "amount"
    ? money(adjustment.value)
    : adjustment.mode === "percentage"
      ? line.sale.times(adjustment.value).div(100)
      : money(adjustment.value).minus(line.sale);
  return withSale(line, line.sale.plus(delta), delta);
}

function withSale(line: CalculatedLine, sale: Money, adjustment: Money): CalculatedLine {
  const roundedSale = sale.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const profit = roundedSale.minus(line.cost);
  const igic = calculateIgic(roundedSale, line.igicRate);
  return {
    ...line,
    sale: roundedSale,
    adjustment: line.adjustment.plus(adjustment),
    profit,
    profitOnCostPct: calculateProfitOnCostPct(roundedSale, line.cost),
    marginOnSalePct: calculateMarginOnSalePct(roundedSale, line.cost),
    igic,
    finalSaleWithTax: roundedSale.plus(igic),
  };
}

export function applySelectionAdjustment(lines: CalculatedLine[], adjustment: PriceAdjustment): CalculatedLine[] {
  const selected = lines.filter((line) => adjustment.targetLineIds?.includes(line.id));
  const current = selected.reduce((sum, line) => sum.plus(line.sale), money(0));
  const amount = adjustment.mode === "amount"
    ? money(adjustment.value)
    : adjustment.mode === "percentage"
      ? current.times(adjustment.value).div(100)
      : money(adjustment.value).minus(current);
  const allocations = allocateProportionalAdjustment(amount, selected);
  return lines.map((line) => allocations.has(line.id) ? withSale(line, line.sale.plus(allocations.get(line.id)!), allocations.get(line.id)!) : line);
}

export function applyGlobalAdjustment(lines: CalculatedLine[], adjustment: PriceAdjustment): CalculatedLine[] {
  const current = lines.reduce((sum, line) => sum.plus(line.sale), money(0));
  const amount = adjustment.mode === "amount"
    ? money(adjustment.value)
    : adjustment.mode === "percentage"
      ? current.times(adjustment.value).div(100)
      : money(adjustment.value).minus(current);
  const allocations = allocateProportionalAdjustment(amount, lines);
  return lines.map((line) => allocations.has(line.id) ? withSale(line, line.sale.plus(allocations.get(line.id)!), allocations.get(line.id)!) : line);
}

export function applyTargetTotalAdjustment(lines: CalculatedLine[], targetTotal: Decimal.Value): CalculatedLine[] {
  return applyGlobalAdjustment(lines, {
    id: "target-total",
    scope: "quote",
    mode: "target_total",
    value: targetTotal,
    baseQuoteRevision: 0,
  });
}

export function calculateQuote(
  lines: QuoteLineInput[],
  adjustments: PriceAdjustment[] = [],
  _igicRate: Decimal.Value = 0,
): QuoteCalculation {
  let calculated = lines.map(calculateLine);
  for (const adjustment of adjustments) {
    if (adjustment.scope === "line") {
      calculated = calculated.map((line) => line.id === adjustment.targetLineIds?.[0] ? applyLineAdjustment(line, adjustment) : line);
    } else if (adjustment.scope === "selection") {
      calculated = applySelectionAdjustment(calculated, adjustment);
    } else {
      calculated = applyGlobalAdjustment(calculated, adjustment);
    }
  }
  const subtotal = calculated.reduce((sum, line) => sum.plus(line.sale), money(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const cost = calculated.reduce((sum, line) => sum.plus(line.cost), money(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const igic = calculated.reduce((sum, line) => sum.plus(line.igic), money(0)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = subtotal.plus(igic).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const profit = subtotal.minus(cost);
  return {
    lines: calculated,
    subtotal,
    igic,
    total,
    cost,
    profit,
    profitOnCostPct: calculateProfitOnCostPct(subtotal, cost),
    marginOnSalePct: calculateMarginOnSalePct(subtotal, cost),
    saleWithoutTax: subtotal,
    taxTotal: igic,
    saleWithTax: total,
  };
}

export function resolveSaleBaseUnitPrice(mode: "net_cost" | "supplier_list_price", directUnitCost: Decimal.Value | null | undefined, supplierUnitPrice: Decimal.Value | null | undefined, discounts: SupplierDiscount[] = []): Money {
  if (mode === "supplier_list_price") return money(supplierUnitPrice ?? 0);
  if (directUnitCost !== null && directUnitCost !== undefined) return money(directUnitCost);
  return applyConsecutiveDiscounts(supplierUnitPrice ?? 0, discounts);
}
