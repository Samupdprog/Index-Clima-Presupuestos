import { z } from "zod/v4";
import { decimalStringSchema, nonNegativeDecimalSchema, discountPercentageSchema, extractedLineSchema } from "./quotes.js";

const common = { expectedRevision: z.number().int().nonnegative(), description: z.string().min(1), saleRule: z.enum(["unit_price", "fixed_line_total", "add_euros_per_unit", "add_percentage"]), saleRuleValue: decimalStringSchema, quantity: nonNegativeDecimalSchema.default("1"), igicRate: nonNegativeDecimalSchema.default("7") };
const laborEntry = z.object({ id: z.uuid().optional(), employeeId: z.uuid().optional(), employeeNameSnapshot: z.string().min(1), hours: nonNegativeDecimalSchema, costRateSnapshot: nonNegativeDecimalSchema, saleRateSnapshot: nonNegativeDecimalSchema });
const discountEntry = z.object({ id: z.uuid().optional(), percentage: discountPercentageSchema });
const lineDetails = z.object({ description: common.description, unit: z.string().min(1), quantity: common.quantity, igicRate: common.igicRate, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, baseUnitPrice: nonNegativeDecimalSchema.nullable().optional(), directUnitCost: nonNegativeDecimalSchema.nullable().optional(), supplierUnitPrice: nonNegativeDecimalSchema.nullable().optional(), saleBaseMode: z.enum(["net_cost", "supplier_list_price"]).optional(), supplierNameSnapshot: z.string().nullable().optional(), supplierCodeSnapshot: z.string().nullable().optional(), internalReference: z.string().nullable().optional(), internalNotes: z.string().nullable().optional() });
export const quoteCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("importQuoteLines"), expectedRevision: common.expectedRevision, lines: z.array(extractedLineSchema).min(1).max(500) }),
  z.object({ type: z.literal("recalculateQuote"), expectedRevision: common.expectedRevision }),
  z.object({ type: z.literal("selectClient"), expectedRevision: common.expectedRevision, clientId: z.uuid().nullable() }),
  z.object({ type: z.literal("createQuoteLine"), expectedRevision: common.expectedRevision, lineType: z.enum(["material", "labor", "travel", "other"]), line: lineDetails, catalogMaterialId: z.uuid().optional(), discounts: z.array(discountEntry.omit({ id: true })).default([]), laborEntries: z.array(laborEntry.omit({ id: true })).default([]) }),
  z.object({ type: z.literal("updateQuoteLineDetails"), expectedRevision: common.expectedRevision, lineId: z.uuid(), line: lineDetails, discounts: z.array(discountEntry), laborEntries: z.array(laborEntry) }),
  z.object({ type: z.literal("addMaterialLine"), expectedRevision: common.expectedRevision, description: common.description, catalogMaterialId: z.uuid().optional(), saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate, directUnitCost: nonNegativeDecimalSchema.optional(), supplierUnitPrice: nonNegativeDecimalSchema.optional(), baseUnitPrice: nonNegativeDecimalSchema.optional() }),
  z.object({ type: z.literal("addLaborLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addTravelLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addOtherLine"), expectedRevision: common.expectedRevision, description: common.description, saleRule: common.saleRule, saleRuleValue: common.saleRuleValue, quantity: common.quantity, igicRate: common.igicRate }),
  z.object({ type: z.literal("addSupplierDiscount"), expectedRevision: common.expectedRevision, quoteLineId: z.uuid(), percentage: discountPercentageSchema }),
  z.object({ type: z.literal("addLaborEntry"), expectedRevision: common.expectedRevision, quoteLineId: z.uuid(), employeeNameSnapshot: z.string().min(1), hours: z.string(), costRateSnapshot: z.string(), saleRateSnapshot: z.string(), supplementPerHourSnapshot: z.string().optional() }),
  z.object({ type: z.literal("addPriceAdjustment"), expectedRevision: common.expectedRevision, scope: z.enum(["line", "selection", "quote"]), mode: z.enum(["amount", "percentage", "target_total"]), value: decimalStringSchema, targetLineIds: z.array(z.uuid()).optional() }),
  z.object({ type: z.literal("addQuoteText"), expectedRevision: common.expectedRevision, title: z.string(), body: z.string() }),
  z.object({ type: z.literal("updateQuoteLine"), expectedRevision: common.expectedRevision, lineId: z.uuid(), changes: lineDetails.partial().strict() }),
  z.object({ type: z.literal("deleteQuoteLine"), expectedRevision: common.expectedRevision, lineId: z.uuid() }),
  z.object({ type: z.literal("reorderQuoteLines"), expectedRevision: common.expectedRevision, orderedLineIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("updateSupplierDiscount"), expectedRevision: common.expectedRevision, discountId: z.uuid(), percentage: discountPercentageSchema }),
  z.object({ type: z.literal("removeSupplierDiscount"), expectedRevision: common.expectedRevision, discountId: z.uuid() }),
  z.object({ type: z.literal("reorderSupplierDiscounts"), expectedRevision: common.expectedRevision, orderedDiscountIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("updateLaborEntry"), expectedRevision: common.expectedRevision, entryId: z.uuid(), changes: laborEntry.omit({ id: true }).partial().strict() }),
  z.object({ type: z.literal("removeLaborEntry"), expectedRevision: common.expectedRevision, entryId: z.uuid() }),
  z.object({ type: z.literal("updatePriceAdjustment"), expectedRevision: common.expectedRevision, adjustmentId: z.uuid(), changes: z.strictObject({ mode: z.enum(["amount", "percentage", "target_total"]).optional(), value: decimalStringSchema.optional() }) }),
  z.object({ type: z.literal("removePriceAdjustment"), expectedRevision: common.expectedRevision, adjustmentId: z.uuid() }),
  z.object({ type: z.literal("updateQuoteText"), expectedRevision: common.expectedRevision, textId: z.uuid(), title: z.string(), body: z.string() }),
  z.object({ type: z.literal("removeQuoteText"), expectedRevision: common.expectedRevision, textId: z.uuid() }),
  z.object({ type: z.literal("reorderQuoteTexts"), expectedRevision: common.expectedRevision, orderedTextIds: z.array(z.uuid()) }),
  z.object({ type: z.literal("changeQuoteStatus"), expectedRevision: common.expectedRevision, status: z.enum(["draft", "ready_for_review", "finalized"]) }),
  z.object({ type: z.literal("archiveQuote"), expectedRevision: common.expectedRevision }),
]);

export type QuoteCommand = z.infer<typeof quoteCommandSchema>;
