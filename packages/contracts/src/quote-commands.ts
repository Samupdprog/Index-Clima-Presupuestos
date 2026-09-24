import { z } from "zod/v4";

const common = { expectedRevision: z.number().int().nonnegative(), description: z.string().min(1), saleRule: z.enum(["unit_price", "fixed_line_total", "add_euros_per_unit", "add_percentage"]), saleRuleValue: z.string(), quantity: z.string().default("1"), igicRate: z.string().default("7") };
export const quoteCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addMaterialLine"), expectedRevision: common.expectedRevision, description: common.description, catalogMaterialId: z.uuid().optional(), saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate, directUnitCost: z.string().optional(), supplierUnitPrice: z.string().optional(), baseUnitPrice: z.string().optional() }),
  z.object({ type: z.literal("addLaborLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addTravelLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addOtherLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addSupplierDiscount"), expectedRevision: common.expectedRevision, quoteLineId: z.uuid(), percentage: z.string() }),
  z.object({ type: z.literal("addLaborEntry"), expectedRevision: common.expectedRevision, quoteLineId: z.uuid(), employeeNameSnapshot: z.string().min(1), hours: z.string(), costRateSnapshot: z.string(), saleRateSnapshot: z.string(), supplementPerHourSnapshot: z.string().optional() }),
  z.object({ type: z.literal("addPriceAdjustment"), expectedRevision: common.expectedRevision, scope: z.enum(["line", "selection", "quote"]), mode: z.enum(["amount", "percentage", "target_total"]), value: z.string(), targetLineIds: z.array(z.uuid()).optional() }),
  z.object({ type: z.literal("addQuoteText"), expectedRevision: common.expectedRevision, title: z.string(), body: z.string() }),
  z.object({ type: z.literal("updateQuoteLine"), expectedRevision: common.expectedRevision, lineId: z.uuid(), changes: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("deleteQuoteLine"), expectedRevision: common.expectedRevision, lineId: z.uuid() }),
  z.object({ type: z.literal("reorderQuoteLines"), expectedRevision: common.expectedRevision, orderedLineIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("updateSupplierDiscount"), expectedRevision: common.expectedRevision, discountId: z.uuid(), percentage: z.string() }),
  z.object({ type: z.literal("removeSupplierDiscount"), expectedRevision: common.expectedRevision, discountId: z.uuid() }),
  z.object({ type: z.literal("reorderSupplierDiscounts"), expectedRevision: common.expectedRevision, orderedDiscountIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("updateLaborEntry"), expectedRevision: common.expectedRevision, entryId: z.uuid(), changes: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("removeLaborEntry"), expectedRevision: common.expectedRevision, entryId: z.uuid() }),
  z.object({ type: z.literal("updatePriceAdjustment"), expectedRevision: common.expectedRevision, adjustmentId: z.uuid(), changes: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("removePriceAdjustment"), expectedRevision: common.expectedRevision, adjustmentId: z.uuid() }),
  z.object({ type: z.literal("updateQuoteText"), expectedRevision: common.expectedRevision, textId: z.uuid(), title: z.string(), body: z.string() }),
  z.object({ type: z.literal("removeQuoteText"), expectedRevision: common.expectedRevision, textId: z.uuid() }),
  z.object({ type: z.literal("reorderQuoteTexts"), expectedRevision: common.expectedRevision, orderedTextIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("changeQuoteStatus"), expectedRevision: common.expectedRevision, status: z.enum(["draft", "ready_for_review", "finalized"]) }),
  z.object({ type: z.literal("archiveQuote"), expectedRevision: common.expectedRevision }),
]);

export type QuoteCommand = z.infer<typeof quoteCommandSchema>;
