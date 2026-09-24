import { and, asc, eq, sql } from "drizzle-orm";
import { calculateQuote, type PriceAdjustment, type QuoteLineInput } from "@quotes/domain";
import type { Database } from "../client.js";
import { QuoteNotFoundError, ReadOnlyQuoteError, RevisionConflictError } from "../errors.js";
import { auditEvents } from "../schema/operations.js";
import { catalogMaterials } from "../schema/common.js";
import { quoteLineDiscounts, quoteLineLaborEntries, quoteLines, quotePriceAdjustmentTargets, quotePriceAdjustments, quoteCalculationRuns, quoteLineCalculations, quoteTextBlocks, quoteVersions, quotes } from "../schema/quotes.js";

type QueryExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;

export interface AddLineInput {
  installationId: string;
  quoteId: string;
  expectedRevision: number;
  type: "material" | "labor" | "travel" | "adjustment" | "other" | "title";
  description: string;
  unit?: string;
  quantity?: string;
  igicRate?: string;
  saleRule: "unit_price" | "fixed_line_total" | "add_euros_per_unit" | "add_percentage";
  saleRuleValue: string;
  baseUnitPrice?: string;
  directUnitCost?: string;
  supplierUnitPrice?: string;
  saleBaseMode?: "net_cost" | "supplier_list_price";
  eligibleForPriceAllocation?: boolean;
  catalogMaterialId?: string;
}

function decimal(value: string | null | undefined) { return value ?? "0"; }

async function loadQuoteCalculation(tx: QueryExecutor, quoteId: string) {
  const rows = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).orderBy(asc(quoteLines.position));
  const inputs: QuoteLineInput[] = [];
  for (const line of rows) {
    const discounts = await tx.select().from(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, line.id)).orderBy(asc(quoteLineDiscounts.position));
    const labor = await tx.select().from(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.quoteLineId, line.id));
    inputs.push({
      id: line.id,
      type: line.type,
      description: line.description,
      quantity: line.quantity,
      igicRate: line.igicRate,
      eligibleForPriceAllocation: line.eligibleForPriceAllocation,
      saleRule: { type: line.saleRule, value: line.saleRuleValue, ...(line.baseUnitPrice !== null ? { baseUnitPrice: line.baseUnitPrice } : {}) },
      ...(line.directUnitCost !== null ? { directUnitCost: line.directUnitCost } : {}),
      ...(line.supplierUnitPrice !== null ? { supplierUnitPrice: line.supplierUnitPrice } : {}),
      supplierDiscounts: discounts.map((discount) => ({ percentage: discount.percentage })),
      laborEntries: labor.map((entry) => ({ hours: entry.hours, costRate: entry.costRateSnapshot, saleRate: entry.saleRateSnapshot })),
    });
  }
  const adjustments = await tx.select().from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quoteId));
  const adjustmentInputs: PriceAdjustment[] = [];
  for (const adjustment of adjustments) {
    const targets = await tx.select().from(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, adjustment.id));
    adjustmentInputs.push({ id: adjustment.id, scope: adjustment.scope, mode: adjustment.mode, value: adjustment.value, baseQuoteRevision: adjustment.baseQuoteRevision, targetLineIds: targets.map((target) => target.quoteLineId) });
  }
  return calculateQuote(inputs, adjustmentInputs);
}

async function finalize(tx: QueryExecutor, quoteId: string, installationId: string, expectedRevision: number, action: string) {
  const [current] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.installationId, installationId))).limit(1);
  if (!current) throw new QuoteNotFoundError(quoteId);
  if (current.accessMode === "read_only" || current.status === "archived") throw new ReadOnlyQuoteError(quoteId);
  if (current.revision !== expectedRevision) throw new RevisionConflictError("quote", quoteId);
  const nextRevision = expectedRevision + 1;
  const calculation = await loadQuoteCalculation(tx, quoteId);
  const [updated] = await tx.update(quotes).set({ revision: nextRevision, updatedAt: new Date() }).where(and(eq(quotes.id, quoteId), eq(quotes.revision, expectedRevision))).returning();
  if (!updated) throw new RevisionConflictError("quote", quoteId);
  const [run] = await tx.insert(quoteCalculationRuns).values({ quoteId, quoteRevision: nextRevision, subtotal: calculation.saleWithoutTax.toFixed(2), igic: calculation.taxTotal.toFixed(2), total: calculation.saleWithTax.toFixed(2), cost: calculation.cost.toFixed(2), profit: calculation.profit.toFixed(2), saleWithoutTax: calculation.saleWithoutTax.toFixed(2), taxTotal: calculation.taxTotal.toFixed(2), saleWithTax: calculation.saleWithTax.toFixed(2) }).returning();
  for (const line of calculation.lines) {
    await tx.insert(quoteLineCalculations).values({ calculationRunId: run!.id, quoteLineId: line.id, cost: line.cost.toFixed(2), baseSale: line.baseSale.toFixed(2), sale: line.sale.toFixed(2), adjustment: line.adjustment.toFixed(2), profit: line.profit.toFixed(2), igic: line.igic.toFixed(2), finalSaleWithTax: line.finalSaleWithTax.toFixed(2) });
  }
  await tx.insert(quoteVersions).values({ quoteId, revision: nextRevision, snapshot: { quote: updated, calculation: { saleWithoutTax: calculation.saleWithoutTax.toFixed(2), taxTotal: calculation.taxTotal.toFixed(2), saleWithTax: calculation.saleWithTax.toFixed(2) } } });
  await tx.insert(auditEvents).values({ installationId, actorType: "system", action, entityType: "quote", entityId: quoteId, after: { revision: nextRevision } });
  return { quote: updated, calculation };
}

export function createQuoteWorkflowRepository(db: Database) {
  return {
    async addLine(input: AddLineInput) {
      return db.transaction(async (tx) => {
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLines.position}), -1)` }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
        const [material] = input.catalogMaterialId ? await tx.select().from(catalogMaterials).where(eq(catalogMaterials.id, input.catalogMaterialId)).limit(1) : [];
        await tx.insert(quoteLines).values({ quoteId: input.quoteId, position: Number(last?.position ?? -1) + 1, type: input.type, description: input.description || material?.name || "", unit: input.unit ?? material?.unit ?? "unit", quantity: input.quantity ?? "1", igicRate: input.igicRate ?? material?.igicRate ?? "7", saleRule: input.saleRule, saleRuleValue: input.saleRuleValue, baseUnitPrice: input.baseUnitPrice ?? material?.saleUnitPrice ?? undefined, directUnitCost: input.directUnitCost ?? material?.supplierUnitPrice ?? undefined, supplierUnitPrice: input.supplierUnitPrice ?? material?.supplierUnitPrice ?? undefined, supplierNameSnapshot: material?.supplierNameSnapshot, supplierCodeSnapshot: material?.supplierCode, supplierListPriceSnapshot: material?.supplierUnitPrice, costSnapshot: material?.supplierUnitPrice, priceSnapshot: material?.saleUnitPrice, catalogMaterialId: material?.id, saleBaseMode: input.saleBaseMode ?? "net_cost", eligibleForPriceAllocation: input.eligibleForPriceAllocation ?? true });
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.added");
      });
    },

    async addSupplierDiscount(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, percentage: string) {
      return db.transaction(async (tx) => {
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLineDiscounts.position}), -1)` }).from(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, quoteLineId));
        await tx.insert(quoteLineDiscounts).values({ quoteLineId, position: Number(last?.position ?? -1) + 1, percentage });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.line.discount.added");
      });
    },

    async addLaborEntry(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, entry: { employeeId?: string; employeeNameSnapshot: string; hours: string; costRateSnapshot: string; saleRateSnapshot: string; supplementPerHourSnapshot?: string }) {
      return db.transaction(async (tx) => {
        await tx.insert(quoteLineLaborEntries).values({ quoteLineId, employeeId: entry.employeeId, employeeNameSnapshot: entry.employeeNameSnapshot, hours: entry.hours, costRateSnapshot: entry.costRateSnapshot, saleRateSnapshot: entry.saleRateSnapshot, supplementPerHourSnapshot: entry.supplementPerHourSnapshot });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.labor_entry.added");
      });
    },

    async addAdjustment(installationId: string, quoteId: string, expectedRevision: number, adjustment: { scope: "line" | "selection" | "quote"; mode: "amount" | "percentage" | "target_total"; value: string; targetLineIds?: string[] }) {
      return db.transaction(async (tx) => {
        const [created] = await tx.insert(quotePriceAdjustments).values({ quoteId, scope: adjustment.scope, mode: adjustment.mode, value: adjustment.value, baseQuoteRevision: expectedRevision }).returning();
        if (adjustment.targetLineIds) for (const quoteLineId of adjustment.targetLineIds) await tx.insert(quotePriceAdjustmentTargets).values({ adjustmentId: created!.id, quoteLineId });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.adjustment.added");
      });
    },

    async addText(installationId: string, quoteId: string, expectedRevision: number, title: string, body: string) {
      return db.transaction(async (tx) => {
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteTextBlocks.position}), -1)` }).from(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, quoteId));
        await tx.insert(quoteTextBlocks).values({ quoteId, position: Number(last?.position ?? -1) + 1, title, body, titleSnapshot: title, bodySnapshot: body });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.text.added");
      });
    },
    async updateLine(input: { installationId: string; quoteId: string; expectedRevision: number; lineId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await tx.update(quoteLines).set({ ...input.changes, updatedAt: new Date() }).where(and(eq(quoteLines.id, input.lineId), eq(quoteLines.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.updated"); });
    },
    async deleteLine(input: { installationId: string; quoteId: string; expectedRevision: number; lineId: string }) {
      return db.transaction(async (tx) => { await tx.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, input.lineId)); await tx.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.quoteLineId, input.lineId)); await tx.delete(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.quoteLineId, input.lineId)); await tx.delete(quoteLineCalculations).where(eq(quoteLineCalculations.quoteLineId, input.lineId)); await tx.delete(quoteLines).where(and(eq(quoteLines.id, input.lineId), eq(quoteLines.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.deleted"); });
    },
    async reorderLines(input: { installationId: string; quoteId: string; expectedRevision: number; orderedLineIds: string[] }) {
      return db.transaction(async (tx) => { for (const [position, id] of input.orderedLineIds.entries()) await tx.update(quoteLines).set({ position: position + 1000000 }).where(and(eq(quoteLines.id, id), eq(quoteLines.quoteId, input.quoteId))); for (const [position, id] of input.orderedLineIds.entries()) await tx.update(quoteLines).set({ position }).where(and(eq(quoteLines.id, id), eq(quoteLines.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.reordered"); });
    },
    async updateDiscount(input: { installationId: string; quoteId: string; expectedRevision: number; discountId: string; percentage: string }) {
      return db.transaction(async (tx) => { await tx.update(quoteLineDiscounts).set({ percentage: input.percentage }).where(eq(quoteLineDiscounts.id, input.discountId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.updated"); });
    },
    async removeDiscount(input: { installationId: string; quoteId: string; expectedRevision: number; discountId: string }) {
      return db.transaction(async (tx) => { await tx.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.id, input.discountId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.removed"); });
    },
    async updateLaborEntry(input: { installationId: string; quoteId: string; expectedRevision: number; entryId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await tx.update(quoteLineLaborEntries).set(input.changes).where(eq(quoteLineLaborEntries.id, input.entryId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.labor_entry.updated"); });
    },
    async reorderDiscounts(input: { installationId: string; quoteId: string; expectedRevision: number; orderedDiscountIds: string[] }) {
      return db.transaction(async (tx) => { for (const [position, id] of input.orderedDiscountIds.entries()) await tx.update(quoteLineDiscounts).set({ position: position + 1000000 }).where(eq(quoteLineDiscounts.id, id)); for (const [position, id] of input.orderedDiscountIds.entries()) await tx.update(quoteLineDiscounts).set({ position }).where(eq(quoteLineDiscounts.id, id)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.reordered"); });
    },
    async removeLaborEntry(input: { installationId: string; quoteId: string; expectedRevision: number; entryId: string }) {
      return db.transaction(async (tx) => { await tx.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.id, input.entryId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.labor_entry.removed"); });
    },
    async updateAdjustment(input: { installationId: string; quoteId: string; expectedRevision: number; adjustmentId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await tx.update(quotePriceAdjustments).set(input.changes).where(eq(quotePriceAdjustments.id, input.adjustmentId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.adjustment.updated"); });
    },
    async removeAdjustment(input: { installationId: string; quoteId: string; expectedRevision: number; adjustmentId: string }) {
      return db.transaction(async (tx) => { await tx.delete(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, input.adjustmentId)); await tx.delete(quotePriceAdjustments).where(eq(quotePriceAdjustments.id, input.adjustmentId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.adjustment.removed"); });
    },
    async updateText(input: { installationId: string; quoteId: string; expectedRevision: number; textId: string; title: string; body: string }) {
      return db.transaction(async (tx) => { await tx.update(quoteTextBlocks).set({ title: input.title, body: input.body, titleSnapshot: input.title, bodySnapshot: input.body }).where(eq(quoteTextBlocks.id, input.textId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.updated"); });
    },
    async removeText(input: { installationId: string; quoteId: string; expectedRevision: number; textId: string }) {
      return db.transaction(async (tx) => { await tx.delete(quoteTextBlocks).where(eq(quoteTextBlocks.id, input.textId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.removed"); });
    },
    async reorderTexts(input: { installationId: string; quoteId: string; expectedRevision: number; orderedTextIds: string[] }) {
      return db.transaction(async (tx) => { for (const [position, id] of input.orderedTextIds.entries()) await tx.update(quoteTextBlocks).set({ position: position + 1000000 }).where(and(eq(quoteTextBlocks.id, id), eq(quoteTextBlocks.quoteId, input.quoteId))); for (const [position, id] of input.orderedTextIds.entries()) await tx.update(quoteTextBlocks).set({ position }).where(and(eq(quoteTextBlocks.id, id), eq(quoteTextBlocks.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.reordered"); });
    },
  };
}
