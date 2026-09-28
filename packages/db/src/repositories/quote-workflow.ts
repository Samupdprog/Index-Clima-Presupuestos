import { and, asc, eq, sql } from "drizzle-orm";
import { calculateQuote, resolveSaleBaseUnitPrice, PricingValidationError, type PriceAdjustment, type QuoteLineInput } from "@quotes/domain";
import type { ExtractedLine } from "@quotes/contracts";
import type { Database } from "../client.js";
import { QuoteNotFoundError, ReadOnlyQuoteError, RevisionConflictError } from "../errors.js";
import { auditEvents } from "../schema/operations.js";
import { auditActor } from "../audit-context.js";
import { catalogMaterials } from "../schema/common.js";
import { quoteLineDiscounts, quoteLineLaborEntries, quoteLines, quotePriceAdjustmentTargets, quotePriceAdjustments, quoteCalculationRuns, quoteLineCalculations, quoteTextBlocks, quoteVersions, quotes } from "../schema/quotes.js";

type QueryExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;
type MutationContext = { installationId: string; quoteId: string; expectedRevision: number };

async function assertQuote(tx: QueryExecutor, input: MutationContext) {
  const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.installationId, input.installationId))).for("update").limit(1);
  if (!quote) throw new QuoteNotFoundError(input.quoteId);
  if (quote.accessMode === "read_only" || quote.status === "archived") throw new ReadOnlyQuoteError(input.quoteId);
  if (quote.revision !== input.expectedRevision) throw new RevisionConflictError("quote", input.quoteId);
  return quote;
}

async function assertLine(tx: QueryExecutor, quoteId: string, lineId: string) {
  const [line] = await tx.select().from(quoteLines).where(and(eq(quoteLines.id, lineId), eq(quoteLines.quoteId, quoteId))).limit(1);
  if (!line) throw new PricingValidationError("quote_line_not_found");
  return line;
}

async function assertChild(tx: QueryExecutor, quoteId: string, table: typeof quoteLineDiscounts | typeof quoteLineLaborEntries, id: string) {
  const [row] = await tx.select({ quoteLineId: table.quoteLineId }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new PricingValidationError("quote_child_not_found");
  await assertLine(tx, quoteId, row.quoteLineId);
  return row;
}

async function assertOwned(tx: QueryExecutor, quoteId: string, table: typeof quotePriceAdjustments | typeof quoteTextBlocks, id: string) {
  const [row] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.quoteId, quoteId))).limit(1);
  if (!row) throw new PricingValidationError("quote_child_not_found");
}

function assertOrder(actual: string[], requested: string[]) {
  if (requested.length !== actual.length || new Set(requested).size !== requested.length || requested.some((id) => !actual.includes(id))) throw new PricingValidationError("invalid_reorder");
}

function onlyFields(changes: Record<string, unknown>, fields: string[]) {
  if (Object.keys(changes).some((field) => !fields.includes(field))) throw new PricingValidationError("invalid_change_field");
  return changes;
}

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

type DetailLine = Pick<typeof quoteLines.$inferInsert, "description" | "unit" | "quantity" | "igicRate" | "saleRule" | "saleRuleValue" | "baseUnitPrice" | "directUnitCost" | "supplierUnitPrice" | "saleBaseMode" | "supplierNameSnapshot" | "supplierCodeSnapshot" | "internalReference" | "internalNotes">;
type DetailDiscount = { id?: string; percentage: string };
type DetailLabor = { id?: string; employeeId?: string; employeeNameSnapshot: string; hours: string; costRateSnapshot: string; saleRateSnapshot: string };
type DetailInput = { installationId: string; quoteId: string; expectedRevision: number; line: DetailLine; discounts: DetailDiscount[]; laborEntries: DetailLabor[] };
function pricedDetails(input: DetailInput): DetailLine {
  if (input.line.saleRule !== "add_percentage" && input.line.saleRule !== "add_euros_per_unit") return input.line;
  return { ...input.line, baseUnitPrice: resolveSaleBaseUnitPrice(input.line.saleBaseMode ?? "net_cost", input.line.directUnitCost, input.line.supplierUnitPrice, input.discounts).toFixed(6) };
}

export async function loadQuoteCalculation(tx: QueryExecutor, quoteId: string) {
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
      saleBaseMode: line.saleBaseMode,
      eligibleForPriceAllocation: line.eligibleForPriceAllocation,
      saleRule: { type: line.saleRule, value: line.saleRuleValue, ...(line.baseUnitPrice !== null ? { baseUnitPrice: line.baseUnitPrice } : {}) },
      ...(line.directUnitCost !== null ? { directUnitCost: line.directUnitCost } : {}),
      ...(line.supplierUnitPrice !== null ? { supplierUnitPrice: line.supplierUnitPrice } : {}),
      supplierDiscounts: discounts.map((discount) => ({ percentage: discount.percentage })),
      laborEntries: labor.map((entry) => ({ hours: entry.hours, costRate: entry.costRateSnapshot, saleRate: entry.saleRateSnapshot })),
    });
  }
  const adjustments = await tx.select().from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quoteId)).orderBy(asc(quotePriceAdjustments.baseQuoteRevision), asc(quotePriceAdjustments.createdAt), asc(quotePriceAdjustments.id));
  const adjustmentInputs: PriceAdjustment[] = [];
  for (const adjustment of adjustments) {
    const targets = await tx.select().from(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, adjustment.id));
    adjustmentInputs.push({ id: adjustment.id, scope: adjustment.scope, mode: adjustment.mode, value: adjustment.value, baseQuoteRevision: adjustment.baseQuoteRevision, targetLineIds: targets.map((target) => target.quoteLineId) });
  }
  return calculateQuote(inputs, adjustmentInputs);
}

export async function finalizeQuoteMutation(tx: QueryExecutor, quoteId: string, installationId: string, expectedRevision: number, action: string) {
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
  await tx.insert(auditEvents).values({ installationId, ...auditActor(), action, entityType: "quote", entityId: quoteId, after: { revision: nextRevision } });
  return { quote: updated, calculation };
}

export function createQuoteWorkflowRepository(db: Database) {
  return {
    async recalculateQuote(input: { installationId: string; quoteId: string; expectedRevision: number }) {
      return db.transaction((tx) => finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.recalculated"));
    },
    async importQuoteLines(input: { installationId: string; quoteId: string; expectedRevision: number; lines: ExtractedLine[] }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, input);
        await assertQuote(tx, input);
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLines.position}), -1)` }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
        for (const [index, extracted] of input.lines.entries()) {
          if (extracted.type !== "material" && extracted.discounts.length) throw new PricingValidationError("invalid_line_details");
          const automatic = extracted.saleUnitPrice === undefined;
          const details: DetailInput = { ...input, discounts: extracted.discounts.map((percentage) => ({ percentage })), laborEntries: [], line: {
            description: extracted.description, unit: extracted.unit, quantity: extracted.quantity, igicRate: extracted.igicRate,
            saleRule: automatic ? "add_percentage" : "unit_price", saleRuleValue: extracted.saleUnitPrice ?? "0",
            saleBaseMode: extracted.saleBaseMode, directUnitCost: extracted.directUnitCost, supplierUnitPrice: extracted.supplierUnitPrice,
            supplierNameSnapshot: extracted.supplier, supplierCodeSnapshot: extracted.supplierCode, internalReference: extracted.reference,
            internalNotes: extracted.metadata ? JSON.stringify({ importedMetadata: extracted.metadata }) : undefined,
          } };
          const [created] = await tx.insert(quoteLines).values({ ...pricedDetails(details), quoteId: input.quoteId, position: Number(last?.position ?? -1) + 1 + index, type: extracted.type }).returning({ id: quoteLines.id });
          for (const [position, discount] of details.discounts.entries()) await tx.insert(quoteLineDiscounts).values({ quoteLineId: created!.id, position, percentage: discount.percentage });
        }
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.lines.imported");
      });
    },
    async createLineWithDetails(input: DetailInput & { lineType: "material" | "labor" | "travel" | "other"; catalogMaterialId?: string }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, input);
        if ((input.laborEntries.length && input.lineType !== "labor") || (input.discounts.length && input.lineType !== "material")) throw new Error("invalid_line_details");
        const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.installationId, input.installationId))).limit(1);
        if (!quote) throw new QuoteNotFoundError(input.quoteId);
        if (quote.accessMode === "read_only" || quote.status === "archived") throw new ReadOnlyQuoteError(input.quoteId);
        if (quote.revision !== input.expectedRevision) throw new RevisionConflictError("quote", input.quoteId);
        const [material] = input.catalogMaterialId ? await tx.select().from(catalogMaterials).where(and(eq(catalogMaterials.id, input.catalogMaterialId), eq(catalogMaterials.installationId, input.installationId))).limit(1) : [];
        if (input.catalogMaterialId && !material) throw new Error("catalog_material_not_found");
        await assertQuote(tx, input);
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLines.position}), -1)` }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
        const [created] = await tx.insert(quoteLines).values({ ...pricedDetails(input), quoteId: input.quoteId, type: input.lineType, position: Number(last?.position ?? -1) + 1, catalogMaterialId: material?.id, supplierNameSnapshot: input.line.supplierNameSnapshot ?? material?.supplierNameSnapshot, supplierCodeSnapshot: input.line.supplierCodeSnapshot ?? material?.supplierCode, supplierListPriceSnapshot: material?.supplierUnitPrice, costSnapshot: material?.supplierUnitPrice, priceSnapshot: material?.saleUnitPrice }).returning({ id: quoteLines.id });
        for (const [position, item] of input.discounts.entries()) await tx.insert(quoteLineDiscounts).values({ quoteLineId: created!.id, position, percentage: item.percentage });
        for (const entry of input.laborEntries) await tx.insert(quoteLineLaborEntries).values({ quoteLineId: created!.id, ...entry });
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.created_with_details");
      });
    },
    async updateLineDetails(input: DetailInput & { lineId: string }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, input);
        const [quote] = await tx.select().from(quotes).where(and(eq(quotes.id, input.quoteId), eq(quotes.installationId, input.installationId))).limit(1);
        if (!quote) throw new QuoteNotFoundError(input.quoteId);
        if (quote.accessMode === "read_only" || quote.status === "archived") throw new ReadOnlyQuoteError(input.quoteId);
        if (quote.revision !== input.expectedRevision) throw new RevisionConflictError("quote", input.quoteId);
        const [line] = await tx.select().from(quoteLines).where(and(eq(quoteLines.id, input.lineId), eq(quoteLines.quoteId, input.quoteId))).limit(1);
        if (!line) throw new Error("quote_line_not_found");
        if ((input.laborEntries.length && line.type !== "labor") || (input.discounts.length && line.type !== "material")) throw new Error("invalid_line_details");
        await tx.update(quoteLines).set({ ...pricedDetails(input), updatedAt: new Date() }).where(eq(quoteLines.id, input.lineId));
        const oldDiscounts = await tx.select().from(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, input.lineId));
        const discountIds = new Set(oldDiscounts.map((item) => item.id));
        if (input.discounts.some((item) => item.id && !discountIds.has(item.id))) throw new Error("discount_not_in_line");
        for (const old of oldDiscounts) if (!input.discounts.some((item) => item.id === old.id)) await tx.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.id, old.id));
        for (const [position, item] of input.discounts.entries()) if (item.id) await tx.update(quoteLineDiscounts).set({ position: position + 1000000, percentage: item.percentage }).where(eq(quoteLineDiscounts.id, item.id));
        for (const [position, item] of input.discounts.entries()) {
          if (item.id) await tx.update(quoteLineDiscounts).set({ position }).where(eq(quoteLineDiscounts.id, item.id));
          else await tx.insert(quoteLineDiscounts).values({ quoteLineId: input.lineId, position, percentage: item.percentage });
        }
        const oldLabor = await tx.select().from(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.quoteLineId, input.lineId));
        const laborIds = new Set(oldLabor.map((item) => item.id));
        if (input.laborEntries.some((item) => item.id && !laborIds.has(item.id))) throw new Error("labor_entry_not_in_line");
        for (const old of oldLabor) if (!input.laborEntries.some((item) => item.id === old.id)) await tx.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.id, old.id));
        for (const entry of input.laborEntries) {
          const { id, ...values } = entry;
          if (id) await tx.update(quoteLineLaborEntries).set(values).where(eq(quoteLineLaborEntries.id, id));
          else await tx.insert(quoteLineLaborEntries).values({ quoteLineId: input.lineId, ...values });
        }
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.details_updated");
      });
    },
    async addLine(input: AddLineInput) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, input);
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLines.position}), -1)` }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
        const [material] = input.catalogMaterialId ? await tx.select().from(catalogMaterials).where(and(eq(catalogMaterials.id, input.catalogMaterialId), eq(catalogMaterials.installationId, input.installationId))).limit(1) : [];
        if (input.catalogMaterialId && !material) throw new PricingValidationError("catalog_material_not_found");
        await tx.insert(quoteLines).values({ quoteId: input.quoteId, position: Number(last?.position ?? -1) + 1, type: input.type, description: input.description || material?.name || "", unit: input.unit ?? material?.unit ?? "unit", quantity: input.quantity ?? "1", igicRate: input.igicRate ?? material?.igicRate ?? "7", saleRule: input.saleRule, saleRuleValue: input.saleRuleValue, baseUnitPrice: input.baseUnitPrice ?? material?.saleUnitPrice ?? undefined, directUnitCost: input.directUnitCost, supplierUnitPrice: input.supplierUnitPrice ?? material?.supplierUnitPrice ?? undefined, supplierNameSnapshot: material?.supplierNameSnapshot, supplierCodeSnapshot: material?.supplierCode, supplierListPriceSnapshot: material?.supplierUnitPrice, costSnapshot: material?.supplierUnitPrice, priceSnapshot: material?.saleUnitPrice, catalogMaterialId: material?.id, saleBaseMode: input.saleBaseMode ?? "net_cost", eligibleForPriceAllocation: input.eligibleForPriceAllocation ?? true });
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.added");
      });
    },

    async addSupplierDiscount(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, percentage: string) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, { installationId, quoteId, expectedRevision });
        const line = await assertLine(tx, quoteId, quoteLineId);
        if (line.type !== "material") throw new PricingValidationError("invalid_line_details");
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteLineDiscounts.position}), -1)` }).from(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, quoteLineId));
        await tx.insert(quoteLineDiscounts).values({ quoteLineId, position: Number(last?.position ?? -1) + 1, percentage });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.line.discount.added");
      });
    },

    async addLaborEntry(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, entry: { employeeId?: string; employeeNameSnapshot: string; hours: string; costRateSnapshot: string; saleRateSnapshot: string; supplementPerHourSnapshot?: string }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, { installationId, quoteId, expectedRevision });
        const line = await assertLine(tx, quoteId, quoteLineId);
        if (line.type !== "labor") throw new PricingValidationError("invalid_line_details");
        await tx.insert(quoteLineLaborEntries).values({ quoteLineId, employeeId: entry.employeeId, employeeNameSnapshot: entry.employeeNameSnapshot, hours: entry.hours, costRateSnapshot: entry.costRateSnapshot, saleRateSnapshot: entry.saleRateSnapshot, supplementPerHourSnapshot: entry.supplementPerHourSnapshot });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.labor_entry.added");
      });
    },

    async addAdjustment(installationId: string, quoteId: string, expectedRevision: number, adjustment: { scope: "line" | "selection" | "quote"; mode: "amount" | "percentage" | "target_total"; value: string; targetLineIds?: string[] }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, { installationId, quoteId, expectedRevision });
        for (const id of adjustment.targetLineIds ?? []) await assertLine(tx, quoteId, id);
        const [created] = await tx.insert(quotePriceAdjustments).values({ quoteId, scope: adjustment.scope, mode: adjustment.mode, value: adjustment.value, baseQuoteRevision: expectedRevision }).returning();
        if (adjustment.targetLineIds) for (const quoteLineId of adjustment.targetLineIds) await tx.insert(quotePriceAdjustmentTargets).values({ adjustmentId: created!.id, quoteLineId });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.adjustment.added");
      });
    },

    async addText(installationId: string, quoteId: string, expectedRevision: number, title: string, body: string) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, { installationId, quoteId, expectedRevision });
        const [last] = await tx.select({ position: sql<number>`coalesce(max(${quoteTextBlocks.position}), -1)` }).from(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, quoteId));
        await tx.insert(quoteTextBlocks).values({ quoteId, position: Number(last?.position ?? -1) + 1, title, body, titleSnapshot: title, bodySnapshot: body });
        return finalize(tx, quoteId, installationId, expectedRevision, "quote.text.added");
      });
    },
    async updateLine(input: { installationId: string; quoteId: string; expectedRevision: number; lineId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertLine(tx, input.quoteId, input.lineId); onlyFields(input.changes, ["description", "unit", "quantity", "igicRate", "saleRule", "saleRuleValue", "saleBaseMode", "baseUnitPrice", "directUnitCost", "supplierUnitPrice", "supplierNameSnapshot", "supplierCodeSnapshot", "internalReference", "internalNotes", "eligibleForPriceAllocation"]); await tx.update(quoteLines).set({ ...input.changes, updatedAt: new Date() }).where(and(eq(quoteLines.id, input.lineId), eq(quoteLines.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.updated"); });
    },
    async deleteLine(input: { installationId: string; quoteId: string; expectedRevision: number; lineId: string }) {
      return db.transaction(async (tx) => {
        await assertQuote(tx, input);
        await assertLine(tx, input.quoteId, input.lineId);
        await tx.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, input.lineId));
        await tx.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.quoteLineId, input.lineId));
        await tx.delete(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.quoteLineId, input.lineId));
        const adjustments = await tx.select().from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, input.quoteId));
        for (const adjustment of adjustments) {
          if (adjustment.scope === "quote") continue;
          const targets = await tx.select().from(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, adjustment.id));
          if (!targets.length) await tx.delete(quotePriceAdjustments).where(eq(quotePriceAdjustments.id, adjustment.id));
        }
        await tx.delete(quoteLineCalculations).where(eq(quoteLineCalculations.quoteLineId, input.lineId));
        await tx.delete(quoteLines).where(and(eq(quoteLines.id, input.lineId), eq(quoteLines.quoteId, input.quoteId)));
        // With no commercial lines left there is no valid recipient for a quote adjustment.
        const remaining = await tx.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId));
        if (!remaining.length) await tx.delete(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, input.quoteId));
        return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.deleted");
      });
    },
    async reorderLines(input: { installationId: string; quoteId: string; expectedRevision: number; orderedLineIds: string[] }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); const rows = await tx.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, input.quoteId)); assertOrder(rows.map((row) => row.id), input.orderedLineIds); for (const [position, id] of input.orderedLineIds.entries()) await tx.update(quoteLines).set({ position: position + 1000000 }).where(and(eq(quoteLines.id, id), eq(quoteLines.quoteId, input.quoteId))); for (const [position, id] of input.orderedLineIds.entries()) await tx.update(quoteLines).set({ position }).where(and(eq(quoteLines.id, id), eq(quoteLines.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.reordered"); });
    },
    async updateDiscount(input: { installationId: string; quoteId: string; expectedRevision: number; discountId: string; percentage: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertChild(tx, input.quoteId, quoteLineDiscounts, input.discountId); await tx.update(quoteLineDiscounts).set({ percentage: input.percentage }).where(eq(quoteLineDiscounts.id, input.discountId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.updated"); });
    },
    async removeDiscount(input: { installationId: string; quoteId: string; expectedRevision: number; discountId: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertChild(tx, input.quoteId, quoteLineDiscounts, input.discountId); await tx.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.id, input.discountId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.removed"); });
    },
    async updateLaborEntry(input: { installationId: string; quoteId: string; expectedRevision: number; entryId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertChild(tx, input.quoteId, quoteLineLaborEntries, input.entryId); onlyFields(input.changes, ["employeeId", "employeeNameSnapshot", "hours", "costRateSnapshot", "saleRateSnapshot", "supplementPerHourSnapshot"]); await tx.update(quoteLineLaborEntries).set(input.changes).where(eq(quoteLineLaborEntries.id, input.entryId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.labor_entry.updated"); });
    },
    async reorderDiscounts(input: { installationId: string; quoteId: string; expectedRevision: number; orderedDiscountIds: string[] }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); const owners = []; for (const id of input.orderedDiscountIds) owners.push(await assertChild(tx, input.quoteId, quoteLineDiscounts, id)); if (!owners.length || new Set(owners.map((row) => row.quoteLineId)).size !== 1) throw new PricingValidationError("invalid_reorder"); const rows = await tx.select({ id: quoteLineDiscounts.id }).from(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, owners[0]!.quoteLineId)); assertOrder(rows.map((row) => row.id), input.orderedDiscountIds); for (const [position, id] of input.orderedDiscountIds.entries()) await tx.update(quoteLineDiscounts).set({ position: position + 1000000 }).where(eq(quoteLineDiscounts.id, id)); for (const [position, id] of input.orderedDiscountIds.entries()) await tx.update(quoteLineDiscounts).set({ position }).where(eq(quoteLineDiscounts.id, id)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.line.discount.reordered"); });
    },
    async removeLaborEntry(input: { installationId: string; quoteId: string; expectedRevision: number; entryId: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertChild(tx, input.quoteId, quoteLineLaborEntries, input.entryId); await tx.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.id, input.entryId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.labor_entry.removed"); });
    },
    async updateAdjustment(input: { installationId: string; quoteId: string; expectedRevision: number; adjustmentId: string; changes: Record<string, unknown> }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertOwned(tx, input.quoteId, quotePriceAdjustments, input.adjustmentId); onlyFields(input.changes, ["mode", "value"]); await tx.update(quotePriceAdjustments).set(input.changes).where(eq(quotePriceAdjustments.id, input.adjustmentId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.adjustment.updated"); });
    },
    async removeAdjustment(input: { installationId: string; quoteId: string; expectedRevision: number; adjustmentId: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertOwned(tx, input.quoteId, quotePriceAdjustments, input.adjustmentId); await tx.delete(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, input.adjustmentId)); await tx.delete(quotePriceAdjustments).where(eq(quotePriceAdjustments.id, input.adjustmentId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.adjustment.removed"); });
    },
    async updateText(input: { installationId: string; quoteId: string; expectedRevision: number; textId: string; title: string; body: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertOwned(tx, input.quoteId, quoteTextBlocks, input.textId); await tx.update(quoteTextBlocks).set({ title: input.title, body: input.body, titleSnapshot: input.title, bodySnapshot: input.body }).where(eq(quoteTextBlocks.id, input.textId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.updated"); });
    },
    async removeText(input: { installationId: string; quoteId: string; expectedRevision: number; textId: string }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); await assertOwned(tx, input.quoteId, quoteTextBlocks, input.textId); await tx.delete(quoteTextBlocks).where(eq(quoteTextBlocks.id, input.textId)); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.removed"); });
    },
    async reorderTexts(input: { installationId: string; quoteId: string; expectedRevision: number; orderedTextIds: string[] }) {
      return db.transaction(async (tx) => { await assertQuote(tx, input); const rows = await tx.select({ id: quoteTextBlocks.id }).from(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, input.quoteId)); assertOrder(rows.map((row) => row.id), input.orderedTextIds); for (const [position, id] of input.orderedTextIds.entries()) await tx.update(quoteTextBlocks).set({ position: position + 1000000 }).where(and(eq(quoteTextBlocks.id, id), eq(quoteTextBlocks.quoteId, input.quoteId))); for (const [position, id] of input.orderedTextIds.entries()) await tx.update(quoteTextBlocks).set({ position }).where(and(eq(quoteTextBlocks.id, id), eq(quoteTextBlocks.quoteId, input.quoteId))); return finalize(tx, input.quoteId, input.installationId, input.expectedRevision, "quote.text.reordered"); });
    },
  };
}

const finalize = finalizeQuoteMutation;
