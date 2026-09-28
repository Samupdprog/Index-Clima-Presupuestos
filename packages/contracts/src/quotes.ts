import { z } from "zod/v4";

export const createQuoteRequestSchema = z.object({
  title: z.string().trim().min(1),
  clientId: z.uuid().optional(),
  origin: z.enum(["generator", "holded"]).default("generator"),
  accessMode: z.enum(["editable", "read_only"]).default("editable"),
});

export const searchQuotesRequestSchema = z.object({
  q: z.string().trim().default(""),
});

export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const decimalStringSchema = z.string().regex(/^-?\d{1,12}(?:\.\d{1,6})?$/, "Usa una cadena decimal finita con punto y hasta seis decimales");
export const nonNegativeDecimalSchema = decimalStringSchema.refine((value) => !value.startsWith("-"), "El valor no puede ser negativo");
export const discountPercentageSchema = nonNegativeDecimalSchema.refine((value) => {
  const [integer = "0", fraction = ""] = value.split(".");
  return BigInt(integer) < 100n || (BigInt(integer) === 100n && !/[1-9]/.test(fraction));
}, "El descuento debe estar entre 0 y 100");

export const priceAdjustmentFields = {
  expectedRevision: z.number().int().nonnegative(),
  scope: z.enum(["line", "selection", "quote"]),
  mode: z.enum(["amount", "percentage", "target_total"]),
  value: decimalStringSchema,
  targetLineIds: z.array(z.uuid()).optional(),
};
export const previewPriceAdjustmentRequestSchema = z.strictObject(priceAdjustmentFields);
export type PreviewPriceAdjustmentRequest = z.infer<typeof previewPriceAdjustmentRequestSchema>;

export interface PriceAdjustmentEconomics {
  costBefore: string; saleBefore: string; allocatedAdjustment: string; saleAfter: string;
  profitBefore: string; profitAfter: string; marginBefore: string | null; marginAfter: string | null;
  profitOnCostBefore: string | null; profitOnCostAfter: string | null;
}
export interface PriceAdjustmentPreview {
  quoteId: string; expectedRevision: number; resultingRevisionPreview: number;
  lines: Array<PriceAdjustmentEconomics & { id: string; description: string; quantity: string; unitCost: string; saleUnitBefore: string; saleUnitAfter: string }>;
  totals: PriceAdjustmentEconomics;
  validation: { valid: true; warnings: string[] };
}

export const extractedLineSchema = z.strictObject({
  description: z.string().trim().min(1),
  type: z.enum(["material", "labor", "travel", "other"]).default("material"),
  quantity: nonNegativeDecimalSchema.default("1"), unit: z.string().trim().min(1).default("ud"),
  supplier: z.string().optional(), supplierCode: z.string().optional(), reference: z.string().optional(),
  supplierUnitPrice: nonNegativeDecimalSchema.optional(), directUnitCost: nonNegativeDecimalSchema.optional(),
  discounts: z.array(discountPercentageSchema).default([]), saleUnitPrice: nonNegativeDecimalSchema.optional(),
  saleBaseMode: z.enum(["net_cost", "supplier_list_price"]).default("supplier_list_price"),
  igicRate: nonNegativeDecimalSchema.default("7"), metadata: z.record(z.string(), z.unknown()).optional(),
});
export const importedDocumentSchema = z.strictObject({ lines: z.array(extractedLineSchema).min(1).max(500), source: z.string().optional() });
export type ExtractedLine = z.infer<typeof extractedLineSchema>;
export type ImportedDocument = z.infer<typeof importedDocumentSchema>;
