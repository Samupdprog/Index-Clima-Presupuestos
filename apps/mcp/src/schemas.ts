import { z } from "zod/v4";
import { TOOL_ERROR_CODES } from "./api-client.js";

export const decimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/, "Usa un decimal string con punto");
export const revisionSchema = z.number().int().nonnegative();
const optionalText = z.string().nullable().optional();
const optionalDecimal = decimalSchema.nullable().optional();

export const clientOutput = z.object({
  id: z.uuid(), name: z.string(), revision: revisionSchema,
  taxId: optionalText, email: optionalText, phone: optionalText, address: optionalText,
  holdedContactId: optionalText, syncStatus: z.string().optional(),
  active: z.boolean().optional(), archivedAt: optionalText, remoteDeletedAt: optionalText,
  deletedAt: optionalText, deletionSource: z.enum(["local", "holded"]).nullable().optional(),
  lastSyncedAt: optionalText, syncError: optionalText,
});

const discountOutput = z.object({ id: z.uuid().optional(), percentage: decimalSchema, position: z.number().int().optional() });
const laborOutput = z.object({ id: z.uuid().optional(), employeeId: optionalText, employeeNameSnapshot: z.string().optional(), hours: decimalSchema, costRateSnapshot: optionalDecimal, saleRateSnapshot: optionalDecimal, supplementPerHourSnapshot: optionalDecimal });
const lineOutput = z.object({
  id: z.uuid(), type: z.string(), description: z.string(), unit: z.string(), quantity: decimalSchema, igicRate: decimalSchema,
  position: z.number().int(), saleRule: z.string(), saleRuleValue: decimalSchema, saleBaseMode: z.string(),
  baseUnitPrice: optionalDecimal, directUnitCost: optionalDecimal, supplierUnitPrice: optionalDecimal,
  supplierNameSnapshot: optionalText, supplierCodeSnapshot: optionalText, internalReference: optionalText, internalNotes: optionalText,
  catalogMaterialId: optionalText, supplierId: optionalText, eligibleForPriceAllocation: z.boolean().optional(),
  discounts: z.array(discountOutput).optional(), laborEntries: z.array(laborOutput).optional(),
});
const calculationLineOutput = z.object({
  id: z.uuid().optional(), quoteLineId: z.uuid().optional(),
  cost: decimalSchema, baseSale: decimalSchema, sale: decimalSchema, adjustment: decimalSchema, profit: decimalSchema,
  igic: decimalSchema, finalSaleWithTax: decimalSchema,
  profitOnCostPct: optionalDecimal, marginOnSalePct: optionalDecimal,
});
export const calculationOutput = z.object({
  quoteRevision: revisionSchema.optional(),
  cost: decimalSchema, saleWithoutTax: decimalSchema, taxTotal: decimalSchema, saleWithTax: decimalSchema, profit: decimalSchema,
  subtotal: decimalSchema.optional(), igic: decimalSchema.optional(), total: decimalSchema.optional(),
  profitOnCostPct: optionalDecimal, marginOnSalePct: optionalDecimal,
  lines: z.array(calculationLineOutput),
});
export const quoteOutput = z.object({
  id: z.uuid(), revision: revisionSchema, reference: z.string(), title: z.string(),
  status: z.enum(["draft", "ready_for_review", "finalized", "archived"]),
  origin: z.enum(["generator", "holded"]), accessMode: z.enum(["editable", "read_only"]),
  clientId: optionalText,
  clientSnapshot: z.object({ id: z.string().optional(), name: z.string().optional(), taxId: optionalText, email: optionalText, phone: optionalText, address: optionalText }).nullable().optional(),
  holdedEstimateId: optionalText,
  holdedSyncedReference: optionalText,
  /** Fecha de envío a la papelera; null si está activo. */
  deletedAt: optionalText,
  duplicatedFromQuoteId: optionalText,
  lines: z.array(lineOutput).optional(),
  priceAdjustments: z.array(z.object({ id: z.uuid(), scope: z.enum(["line", "selection", "quote"]), mode: z.enum(["amount", "percentage", "target_total"]), value: decimalSchema, targetLineIds: z.array(z.uuid()), baseQuoteRevision: revisionSchema })).optional(),
  texts: z.array(z.object({ id: z.uuid(), title: optionalText, body: optionalText, position: z.number().int() })).optional(),
  calculation: calculationOutput.nullable().optional(),
});
export const mutationOutput = z.object({ quote: quoteOutput, calculation: calculationOutput });
const economicsOutput = z.object({ costBefore: decimalSchema, saleBefore: decimalSchema, allocatedAdjustment: decimalSchema, saleAfter: decimalSchema, profitBefore: decimalSchema, profitAfter: decimalSchema, marginBefore: decimalSchema.nullable(), marginAfter: decimalSchema.nullable(), profitOnCostBefore: optionalDecimal, profitOnCostAfter: optionalDecimal });
export const previewOutput = z.object({
  quoteId: z.uuid(), expectedRevision: revisionSchema, resultingRevisionPreview: revisionSchema,
  lines: z.array(economicsOutput.extend({ id: z.uuid(), description: z.string(), quantity: decimalSchema, unitCost: decimalSchema, saleUnitBefore: decimalSchema, saleUnitAfter: decimalSchema })),
  totals: economicsOutput,
  validation: z.object({ valid: z.boolean(), warnings: z.array(z.string()) }),
});
export const holdedStatusOutput = z.object({
  featureEnabled: z.boolean(), isConfigured: z.boolean(), checkIntervalMinutes: z.number().optional(),
  health: z.object({ status: z.string(), code: z.string(), message: z.string(), lastCheckedAt: z.string().nullable() }),
});
export const reviewOutput = z.object({
  quoteId: z.uuid(), revision: revisionSchema, ready: z.boolean(),
  issues: z.array(z.object({ code: z.string(), message: z.string(), lineId: z.uuid().optional() })),
  quote: quoteOutput.optional(),
});
export const syncClientsOutput = z.object({ scanned: z.number().int(), updated: z.number().int(), archived: z.number().int(), conflicts: z.number().int(), syncedAt: z.string() });
export const errorOutput = z.strictObject({
  code: z.enum(TOOL_ERROR_CODES),
  message: z.string(), status: z.number().int().optional(), backendCode: z.string().optional(),
  holdedCode: z.string().optional(), retryAfterSeconds: z.number().int().nonnegative().optional(), retryable: z.boolean(),
});
// Registros de catálogo tal como los devuelve la API (filas de la tabla, importes como decimal string).
// Schemas cerrados y explícitos: `installationId` y `metadata` no se publican y se recortan de la respuesta.
const catalogBase = { id: z.uuid(), active: z.boolean(), createdAt: z.string() };
const nullableText = z.string().nullable();
export const catalogMaterialOutput = z.object({ ...catalogBase, name: z.string(), supplierId: z.uuid().nullable(), supplierNameSnapshot: nullableText, supplierCode: nullableText, description: nullableText, unit: z.string(), supplierUnitPrice: decimalSchema.nullable(), saleUnitPrice: decimalSchema.nullable(), igicRate: decimalSchema, updatedAt: z.string() });
export const catalogEmployeeOutput = z.object({ ...catalogBase, name: z.string(), costRate: decimalSchema, saleRate: decimalSchema, defaultIgicRate: decimalSchema, updatedAt: z.string() });
export const catalogSupplementOutput = z.object({ ...catalogBase, name: z.string(), employeeId: z.uuid().nullable(), amount: decimalSchema, addPerHour: decimalSchema });
export const catalogTravelOutput = z.object({ ...catalogBase, name: z.string(), description: nullableText, unit: z.string(), costUnitPrice: decimalSchema, saleUnitPrice: decimalSchema, igicRate: decimalSchema, updatedAt: z.string() });
export const catalogSupplierOutput = z.object({ ...catalogBase, name: z.string(), taxId: nullableText, updatedAt: z.string() });
export const catalogTextTemplateOutput = z.object({ ...catalogBase, title: z.string(), body: z.string(), alwaysInclude: z.boolean(), updatedAt: z.string() });
/**
 * Cualquier registro de catálogo. Orden de más a menos específico: un proveedor solo
 * tiene campos comunes, así que va el último para no absorber (y recortar) otras filas.
 */
export const catalogRecordOutput = z.union([catalogMaterialOutput, catalogTravelOutput, catalogEmployeeOutput, catalogSupplementOutput, catalogTextTemplateOutput, catalogSupplierOutput]);

export function envelopeOutput(data: z.ZodType) {
  return z.strictObject({ ok: z.boolean(), data: data.nullable(), error: errorOutput.nullable() });
}
