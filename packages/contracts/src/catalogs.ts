import { z } from "zod/v4";

const text = z.string().trim().max(2000);
const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const rate = z.string().transform((value) => value.replace(/\.0+$/, "")).pipe(z.enum(["0", "3", "7", "15"]));
const named = { name: text.min(1), active: z.boolean().optional() };
const schemas = {
  materials: z.object({ ...named, supplierId: z.uuid().nullable().optional(), supplierNameSnapshot: text.optional(), supplierCode: text.optional(), description: text.optional(), unit: text.min(1).optional(), supplierUnitPrice: decimal.nullable().optional(), saleUnitPrice: decimal.nullable().optional(), igicRate: rate.optional(), metadata: z.record(z.string(), z.unknown()).optional() }).strict(),
  employees: z.object({ ...named, costRate: decimal.optional(), saleRate: decimal.optional(), defaultIgicRate: rate.optional() }).strict(),
  supplements: z.object({ ...named, employeeId: z.uuid().nullable().optional(), amount: decimal.optional(), addPerHour: decimal.optional() }).strict(),
  travels: z.object({ ...named, description: text.optional(), unit: text.min(1).optional(), costUnitPrice: decimal.optional(), saleUnitPrice: decimal.optional(), igicRate: rate.optional() }).strict(),
  "text-templates": z.object({ title: text.min(1), body: text, alwaysInclude: z.boolean().optional(), active: z.boolean().optional() }).strict(),
  suppliers: z.object({ ...named, taxId: text.optional() }).strict(),
};
export function catalogMutationSchema(kind: string, partial = false) {
  const schema = schemas[kind as keyof typeof schemas];
  return schema ? (partial ? schema.partial() : schema) : z.never();
}

const optionalCatalogText = z.string().trim().max(500).optional();
const optionalCatalogDecimal = z.string().trim().regex(/^-?\d+(?:[.,]\d+)?$/).optional();

export const materialImportRowSchema = z.object({
  name: z.string().trim().min(1).max(250),
  supplierNameSnapshot: optionalCatalogText,
  supplierCode: optionalCatalogText,
  // Unidad e IGIC vacíos conservan el valor actual; en materiales nuevos se usa "ud" y 7 %.
  unit: z.string().trim().min(1).max(30).optional(),
  supplierUnitPrice: optionalCatalogDecimal,
  saleUnitPrice: optionalCatalogDecimal,
  /** Solo los tipos de IGIC admitidos por el catálogo: 0, 3, 7 o 15 (admite "7", "7.00" o "7,0"). */
  igicRate: z.string().trim().regex(/^(?:0|3|7|15)(?:[.,]0+)?$/, "igic_rate_not_allowed").optional(),
  description: z.string().trim().max(2000).optional(),
});

/** Borrado definitivo de un material: exige confirmación explícita (irreversible). */
export const deleteCatalogMaterialRequestSchema = z.strictObject({ confirm: z.literal(true) });

export const materialImportRequestSchema = z.object({
  rows: z.array(materialImportRowSchema).min(1).max(2000),
});

export type MaterialImportRow = z.infer<typeof materialImportRowSchema>;
