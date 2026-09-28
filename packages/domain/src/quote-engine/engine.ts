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
  saleBaseMode?: "net_cost" | "supplier_list_price";
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
  costUnit: Money;
  saleUnit: Money;
  saleUnitWithTax: Money;
  effectiveSupplierDiscount: Money;
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
  return nonNegative(value, "supplier_price").times(supplierDiscountMultiplier(discounts));
}

export class PricingValidationError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "PricingValidationError"; }
}

function finite(value: Decimal.Value, field: string): Money {
  let result: Money;
  try { result = money(value); } catch { throw new PricingValidationError(`invalid_${field}`); }
  if (!result.isFinite()) throw new PricingValidationError(`invalid_${field}`);
  return result;
}

function nonNegative(value: Decimal.Value, field: string): Money {
  const result = finite(value, field);
  if (result.lt(0)) throw new PricingValidationError(`invalid_${field}`);
  return result;
}

export function supplierDiscountMultiplier(discounts: SupplierDiscount[] = []): Money {
  return discounts.reduce((multiplier, discount) => {
    const percentage = nonNegative(discount.percentage, "supplier_discount");
    if (percentage.gt(100)) throw new PricingValidationError("invalid_supplier_discount");
    return multiplier.times(money(1).minus(percentage.div(100)));
  }, money(1));
}

export function effectiveSupplierDiscountPct(discounts: SupplierDiscount[] = []): Money {
  return money(1).minus(supplierDiscountMultiplier(discounts)).times(100);
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
  const automatic = line.saleRule.type === "add_euros_per_unit" || line.saleRule.type === "add_percentage";
  const baseUnitPrice = automatic
    ? line.saleBaseMode !== undefined || line.saleRule.baseUnitPrice === undefined
      ? resolveSaleBaseUnitPrice(line.saleBaseMode ?? "net_cost", line.directUnitCost, line.supplierUnitPrice, line.supplierDiscounts)
      : nonNegative(line.saleRule.baseUnitPrice, "sale_base")
    : money(0);
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
  nonNegative(line.quantity, "quantity");
  nonNegative(line.igicRate ?? 0, "igic_rate");
  finite(line.saleRule.value, "sale_rule_value");
  supplierDiscountMultiplier(line.supplierDiscounts);
  if (line.directUnitCost !== undefined) nonNegative(line.directUnitCost, "unit_cost");
  if (line.supplierUnitPrice !== undefined) nonNegative(line.supplierUnitPrice, "supplier_price");
  for (const entry of line.laborEntries ?? []) {
    nonNegative(entry.hours, "labor_hours"); nonNegative(entry.costRate, "labor_cost"); nonNegative(entry.saleRate, "labor_sale");
  }
  const cost = calculateCost(line);
  const baseSale = calculateSaleFromLabor(line) ?? calculateBaseSale(line);
  const sale = baseSale.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (sale.lt(0)) throw new PricingValidationError("negative_sale");
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
    costUnit: money(line.quantity).isZero() ? money(0) : roundedCost.div(line.quantity),
    saleUnit: money(line.quantity).isZero() ? money(0) : sale.div(line.quantity),
    saleUnitWithTax: money(line.quantity).isZero() ? money(0) : sale.plus(igic).div(line.quantity),
    effectiveSupplierDiscount: effectiveSupplierDiscountPct(line.supplierDiscounts),
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
  const eligible = lines.filter((line) => line.type !== "adjustment" && line.type !== "title" && line.sale.gte(0) && line.eligibleForPriceAllocation !== false);
  const total = eligible.reduce((sum, line) => sum.plus(line.sale), money(0));
  const result = new Map<string, Money>();
  const target = finite(amount, "adjustment").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!eligible.length) {
    if (!target.isZero()) throw new PricingValidationError("no_eligible_adjustment_lines");
    return result;
  }
  const sign = target.isNegative() ? -1 : 1;
  const cents = target.abs().times(100);
  const shares = eligible.map((line, index) => {
    const exact = total.isZero() ? cents.div(eligible.length) : cents.times(line.sale).div(total);
    return { id: line.id, index, cents: exact.floor(), remainder: exact.minus(exact.floor()) };
  });
  let remaining = cents.minus(shares.reduce((sum, share) => sum.plus(share.cents), money(0)));
  shares.sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (const share of shares) {
    if (remaining.gt(0)) { share.cents = share.cents.plus(1); remaining = remaining.minus(1); }
    result.set(share.id, share.cents.times(sign).div(100));
  }
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
  if (roundedSale.lt(0)) throw new PricingValidationError("negative_sale_after_adjustment");
  const profit = roundedSale.minus(line.cost);
  const igic = calculateIgic(roundedSale, line.igicRate);
  return {
    ...line,
    sale: roundedSale,
    adjustment: line.adjustment.plus(roundedSale.minus(line.sale)),
    profit,
    profitOnCostPct: calculateProfitOnCostPct(roundedSale, line.cost),
    marginOnSalePct: calculateMarginOnSalePct(roundedSale, line.cost),
    igic,
    finalSaleWithTax: roundedSale.plus(igic),
    saleUnit: line.quantity.isZero() ? money(0) : roundedSale.div(line.quantity),
    saleUnitWithTax: line.quantity.isZero() ? money(0) : roundedSale.plus(igic).div(line.quantity),
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
    validatePriceAdjustment(calculated, adjustment);
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
  const multiplier = supplierDiscountMultiplier(discounts);
  if (mode === "supplier_list_price") {
    if (supplierUnitPrice !== null && supplierUnitPrice !== undefined) return nonNegative(supplierUnitPrice, "supplier_price");
    if (directUnitCost !== null && directUnitCost !== undefined && !multiplier.isZero()) return nonNegative(directUnitCost, "unit_cost").div(multiplier);
    throw new PricingValidationError("pricing_data_required");
  }
  if (directUnitCost !== null && directUnitCost !== undefined) return nonNegative(directUnitCost, "unit_cost");
  if (supplierUnitPrice !== null && supplierUnitPrice !== undefined) return applyConsecutiveDiscounts(supplierUnitPrice, discounts);
  throw new PricingValidationError("pricing_data_required");
}

export function validatePriceAdjustment(lines: CalculatedLine[], adjustment: PriceAdjustment): void {
  const value = finite(adjustment.value, "adjustment");
  if (adjustment.mode === "target_total" && value.lt(0)) throw new PricingValidationError("invalid_target_total");
  const ids = adjustment.targetLineIds ?? [];
  if (new Set(ids).size !== ids.length) throw new PricingValidationError("duplicate_adjustment_targets");
  if (adjustment.scope === "line" && ids.length !== 1) throw new PricingValidationError("adjustment_requires_one_line");
  if (adjustment.scope === "selection" && !ids.length) throw new PricingValidationError("adjustment_requires_selection");
  if (adjustment.scope === "quote" && ids.length) throw new PricingValidationError("quote_adjustment_has_targets");
  for (const id of ids) {
    const line = lines.find((item) => item.id === id);
    if (!line) throw new PricingValidationError("adjustment_target_not_found");
    if (line.type === "title" || line.type === "adjustment" || !line.eligibleForPriceAllocation) throw new PricingValidationError("ineligible_adjustment_target");
  }
}

export function serializeQuoteCalculation(calculation: QuoteCalculation) {
  return {
    subtotal: calculation.subtotal.toFixed(2), igic: calculation.igic.toFixed(2), total: calculation.total.toFixed(2),
    cost: calculation.cost.toFixed(2), profit: calculation.profit.toFixed(2),
    saleWithoutTax: calculation.saleWithoutTax.toFixed(2), taxTotal: calculation.taxTotal.toFixed(2), saleWithTax: calculation.saleWithTax.toFixed(2),
    profitOnCostPct: calculation.profitOnCostPct?.toFixed(6) ?? null, marginOnSalePct: calculation.marginOnSalePct?.toFixed(6) ?? null,
    lines: calculation.lines.map((line) => ({
      id: line.id, quoteLineId: line.id, type: line.type, quantity: line.quantity.toString(), igicRate: line.igicRate.toString(),
      cost: line.cost.toFixed(2), sale: line.sale.toFixed(2), baseSale: line.baseSale.toFixed(2), adjustment: line.adjustment.toFixed(2),
      profit: line.profit.toFixed(2), igic: line.igic.toFixed(2), finalSaleWithTax: line.finalSaleWithTax.toFixed(2),
      profitOnCostPct: line.profitOnCostPct?.toFixed(6) ?? null, marginOnSalePct: line.marginOnSalePct?.toFixed(6) ?? null,
      costUnit: line.costUnit.toFixed(6), saleUnit: line.saleUnit.toFixed(6), saleUnitWithTax: line.saleUnitWithTax.toFixed(6),
      effectiveSupplierDiscount: line.effectiveSupplierDiscount.toFixed(6),
    })),
  };
}
