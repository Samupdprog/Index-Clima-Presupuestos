import { money } from "@quotes/domain";
import type { MaterialImportRow } from "@quotes/contracts";

/** Material existente tal como lo devuelve el repositorio (decimales como string). */
export interface CatalogMaterialSnapshot {
  id: string;
  name: string;
  supplierNameSnapshot: string | null;
  supplierCode: string | null;
  unit: string;
  supplierUnitPrice: string | null;
  saleUnitPrice: string | null;
  igicRate: string;
  description: string | null;
  active: boolean;
}

export type MaterialField = "name" | "supplierNameSnapshot" | "supplierCode" | "unit" | "supplierUnitPrice" | "saleUnitPrice" | "igicRate" | "description" | "active";
export interface MaterialChange { field: MaterialField; before: string | boolean | null; after: string | boolean | null }
export interface MaterialImportItem {
  row: number;
  name: string;
  action: "create" | "update" | "unchanged" | "invalid";
  materialId: string | null;
  changes: MaterialChange[];
  reason?: "duplicate_row" | "ambiguous_match";
}
export interface MaterialImportPlan {
  summary: { total: number; created: number; updated: number; unchanged: number; invalid: number };
  items: MaterialImportItem[];
  /** Huella del plan: `apply` solo escribe si el catálogo sigue produciendo exactamente este plan. */
  planHash: string;
}

/** Huella determinista (FNV-1a 64 bits) para detectar cambios entre preview y apply; no es un secreto. */
function fingerprint(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

const DECIMAL_FIELDS = new Set<MaterialField>(["supplierUnitPrice", "saleUnitPrice", "igicRate"]);

function norm(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalDecimal(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") return null;
  return money(value.trim().replace(",", ".")).toString();
}

/** Valores de la fila que cambian algo; una celda vacía conserva el valor actual. */
function rowValues(row: MaterialImportRow): Partial<Record<MaterialField, string>> {
  const values: Partial<Record<MaterialField, string>> = { name: row.name.trim(), unit: row.unit.trim() || "ud", igicRate: canonicalDecimal(row.igicRate) ?? "7" };
  if (row.supplierNameSnapshot?.trim()) values.supplierNameSnapshot = row.supplierNameSnapshot.trim();
  if (row.supplierCode?.trim()) values.supplierCode = row.supplierCode.trim();
  const cost = canonicalDecimal(row.supplierUnitPrice);
  if (cost !== null) values.supplierUnitPrice = cost;
  const sale = canonicalDecimal(row.saleUnitPrice);
  if (sale !== null) values.saleUnitPrice = sale;
  if (row.description?.trim()) values.description = row.description.trim();
  return values;
}

function sameValue(field: MaterialField, before: string | null, after: string) {
  if (DECIMAL_FIELDS.has(field)) return before !== null && money(before).eq(after);
  return (before ?? "") === after;
}

/** Clave de identidad: código de proveedor (y proveedor si viene) o, sin código, nombre + proveedor. */
function rowKey(row: MaterialImportRow) {
  const code = norm(row.supplierCode);
  return code ? `code:${code}|${norm(row.supplierNameSnapshot)}` : `name:${norm(row.name)}|${norm(row.supplierNameSnapshot)}`;
}

function candidates(existing: CatalogMaterialSnapshot[], row: MaterialImportRow) {
  const code = norm(row.supplierCode);
  const supplier = norm(row.supplierNameSnapshot);
  if (code) return existing.filter((item) => norm(item.supplierCode) === code && (!supplier || !item.supplierNameSnapshot || norm(item.supplierNameSnapshot) === supplier));
  return existing.filter((item) => norm(item.name) === norm(row.name) && (!supplier || norm(item.supplierNameSnapshot) === supplier));
}

/**
 * Compara filas importadas (Excel de proveedor, IA) con el catálogo sin escribir nada.
 * Nunca desactiva materiales ausentes del fichero.
 */
export function planMaterialImport(existing: CatalogMaterialSnapshot[], rows: MaterialImportRow[]): MaterialImportPlan {
  const seen = new Set<string>();
  const items: MaterialImportItem[] = rows.map((row, index) => {
    const key = rowKey(row);
    const base = { row: index + 1, name: row.name.trim() };
    if (seen.has(key)) return { ...base, action: "invalid", materialId: null, changes: [], reason: "duplicate_row" };
    seen.add(key);
    const values = rowValues(row);
    const matches = candidates(existing, row);
    if (matches.length > 1) return { ...base, action: "invalid", materialId: null, changes: [], reason: "ambiguous_match" };
    const current = matches[0];
    if (!current) return { ...base, action: "create", materialId: null, changes: (Object.entries(values) as Array<[MaterialField, string]>).map(([field, after]) => ({ field, before: null, after })) };
    const changes: MaterialChange[] = [];
    for (const [field, after] of Object.entries(values) as Array<[MaterialField, string]>) {
      const before = current[field as keyof CatalogMaterialSnapshot] as string | null;
      if (!sameValue(field, before, after)) changes.push({ field, before, after });
    }
    if (!current.active) changes.push({ field: "active", before: false, after: true });
    return { ...base, action: changes.length ? "update" : "unchanged", materialId: current.id, changes };
  });
  const count = (action: MaterialImportItem["action"]) => items.filter((item) => item.action === action).length;
  const planHash = fingerprint(JSON.stringify(items.map((item) => [item.row, item.action, item.materialId, item.changes])));
  return { summary: { total: items.length, created: count("create"), updated: count("update"), unchanged: count("unchanged"), invalid: count("invalid") }, items, planHash };
}

export class MaterialImportError extends Error {
  constructor(readonly code: "catalog_changed_since_preview" | "material_import_has_invalid_rows") {
    super(code);
    this.name = "MaterialImportError";
  }
}

export interface MaterialImportRepository {
  listMaterials(installationId: string): Promise<CatalogMaterialSnapshot[]>;
  applyMaterialImport(installationId: string, plan: { creates: Array<Partial<Record<MaterialField, string | boolean>>>; updates: Array<{ id: string; changes: Partial<Record<MaterialField, string | boolean>> }>; summary: MaterialImportPlan["summary"] }): Promise<void>;
}

export function previewMaterialImport(repository: Pick<MaterialImportRepository, "listMaterials">) {
  return async (installationId: string, rows: MaterialImportRow[]) => planMaterialImport(await repository.listMaterials(installationId), rows);
}

/** Aplica exactamente el plan previsualizado; si el catálogo cambió entretanto, no escribe nada. */
export function applyMaterialImport(repository: MaterialImportRepository) {
  return async (installationId: string, rows: MaterialImportRow[], planHash: string) => {
    const plan = planMaterialImport(await repository.listMaterials(installationId), rows);
    if (plan.planHash !== planHash) throw new MaterialImportError("catalog_changed_since_preview");
    if (plan.summary.invalid) throw new MaterialImportError("material_import_has_invalid_rows");
    const toValues = (item: MaterialImportItem) => Object.fromEntries(item.changes.map((change) => [change.field, change.after])) as Partial<Record<MaterialField, string | boolean>>;
    await repository.applyMaterialImport(installationId, {
      creates: plan.items.filter((item) => item.action === "create").map(toValues),
      updates: plan.items.filter((item) => item.action === "update").map((item) => ({ id: item.materialId!, changes: toValues(item) })),
      summary: plan.summary,
    });
    return plan;
  };
}
