import { z } from "zod/v4";

export const catalogMutationSchema = z.object({
  name: z.string().min(1),
}).passthrough();

export const catalogUpdateSchema = z.record(z.string(), z.unknown());

const optionalCatalogText = z.string().trim().max(500).optional();
const optionalCatalogDecimal = z.string().trim().regex(/^-?\d+(?:[.,]\d+)?$/).optional();

export const materialImportRowSchema = z.object({
  name: z.string().trim().min(1).max(250),
  supplierNameSnapshot: optionalCatalogText,
  supplierCode: optionalCatalogText,
  unit: z.string().trim().min(1).max(30).default("ud"),
  supplierUnitPrice: optionalCatalogDecimal,
  saleUnitPrice: optionalCatalogDecimal,
  igicRate: z.string().trim().regex(/^\d+(?:[.,]\d+)?$/).default("7"),
  description: z.string().trim().max(2000).optional(),
});

export const materialImportRequestSchema = z.object({
  rows: z.array(materialImportRowSchema).min(1).max(2000),
});

export type MaterialImportRow = z.infer<typeof materialImportRowSchema>;
