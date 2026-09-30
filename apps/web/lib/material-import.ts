// Lectura del Excel de materiales en el navegador. Solo interpreta celdas: la comparación
// con el catálogo y cualquier escritura las hace el servidor (preview → apply).
import type { MaterialImportRow } from "@quotes/contracts";
import { parseDecimalText } from "./decimal";

export type MaterialColumnKey = "name" | "supplier" | "code" | "unit" | "cost" | "sale" | "tax" | "description";

export interface MaterialColumn {
  key: MaterialColumnKey;
  /** Cabecera recomendada (la de la plantilla). */
  label: string;
  required: boolean;
  example: string;
  help: string;
  /** Otras cabeceras que se reconocen (sin distinguir mayúsculas, tildes ni signos). */
  aliases: string[];
}

/** Estructura del Excel. Es la fuente de la guía de la pantalla y de la plantilla descargable. */
export const MATERIAL_COLUMNS: MaterialColumn[] = [
  { key: "name", label: "Nombre", required: true, example: "Tubo cobre 1/4\"", help: "Nombre del material tal como aparecerá en el presupuesto.", aliases: ["Material", "Artículo", "Producto", "Denominación", "Name"] },
  { key: "supplier", label: "Proveedor", required: false, example: "Salvador Escoda", help: "Nombre del proveedor.", aliases: ["Distribuidor", "Supplier"] },
  { key: "code", label: "Código proveedor", required: false, example: "SE-1014", help: "Referencia del proveedor. Si existe, identifica el material al actualizar.", aliases: ["Código", "Referencia", "Ref", "Ref proveedor", "Código artículo", "SKU", "Supplier code"] },
  { key: "unit", label: "Unidad", required: false, example: "m", help: "ud, m, kg, rollo… Vacía: se conserva la actual (ud en materiales nuevos).", aliases: ["Ud", "Uds", "Unidad de medida", "UM", "Unit"] },
  { key: "cost", label: "Coste", required: false, example: "5,40", help: "Lo que te cuesta cada unidad, sin impuestos (coste o PVP del proveedor).", aliases: ["Coste proveedor", "Coste unitario", "Coste ud", "Precio coste", "Precio de coste", "Precio compra", "Precio de compra", "Precio proveedor", "PVP proveedor", "Tarifa", "Tarifa proveedor", "Supplier price", "Cost"] },
  { key: "sale", label: "Precio venta", required: false, example: "9,90", help: "Precio habitual por unidad al cliente, sin IGIC.", aliases: ["Precio de venta", "Venta", "Venta habitual", "PVP venta", "PVP cliente", "Precio cliente", "Sale price"] },
  { key: "tax", label: "IGIC", required: false, example: "7", help: "Tipo de IGIC: 0, 3, 7 o 15. Vale 7, 7 % o una celda con formato de porcentaje. Vacío: se conserva el actual (7 % en materiales nuevos).", aliases: ["IGIC %", "% IGIC", "Tipo IGIC", "Impuesto", "Impuesto %", "Tipo impuesto", "Tax"] },
  { key: "description", label: "Descripción", required: false, example: "Rollo de 50 m", help: "Detalle interno opcional.", aliases: ["Descripcion", "Detalle", "Observaciones", "Description"] },
];

export const ALLOWED_IGIC_RATES = ["0", "3", "7", "15"];

export interface ParsedMaterialRow {
  /** Número de fila en el Excel (1 = primera fila de la hoja). */
  rowNumber: number;
  data: MaterialImportRow;
  errors: string[];
}

export interface ParsedMaterialSheet {
  /** Fila del Excel donde están las cabeceras. */
  headerRow: number;
  /** Cabecera del Excel usada para cada dato, o `null` si no se encontró. */
  columns: Record<MaterialColumnKey, string | null>;
  /** Cabeceras del Excel que no corresponden a ningún dato (se ignoran). */
  ignored: string[];
  rows: ParsedMaterialRow[];
}

export class MaterialSheetError extends Error {}

/** "IGIC %", "% igic", "Coste (€)" → "igic", "igic", "coste". */
export function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const aliasIndex = new Map<string, MaterialColumnKey>();
for (const column of MATERIAL_COLUMNS) for (const alias of [column.label, ...column.aliases]) aliasIndex.set(normalizeHeader(alias), column.key);

export function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Decimal canónico de una celda: número de Excel, "12,50 €", "1.234,50"… `null` si está vacía, `undefined` si no es válida. */
export function decimalCell(value: unknown): string | null | undefined {
  if (value === null || value === undefined || cellText(value) === "") return null;
  // Los números de Excel pueden arrastrar ruido binario (13.960000000000001): 6 decimales como el catálogo.
  const text = typeof value === "number" ? value.toFixed(6) : cellText(value);
  return parseDecimalText(text) ?? undefined;
}

/** IGIC de una celda: "7", 7, "7 %" o 0,07 (celda con formato de porcentaje) → "7". */
export function igicCell(value: unknown): string | null | undefined {
  // Celda numérica con formato de porcentaje: Excel guarda 7 % como 0,07. Solo se convierte
  // si el resultado es un tipo de IGIC válido; cualquier otro valor se valida tal cual.
  if (typeof value === "number" && value > 0 && value < 1) {
    const percent = parseDecimalText((value * 100).toFixed(6));
    if (percent && ALLOWED_IGIC_RATES.includes(percent)) return percent;
  }
  return decimalCell(value);
}

function findHeaderRow(sheet: unknown[][]) {
  const limit = Math.min(sheet.length, 15);
  for (let index = 0; index < limit; index += 1) {
    if ((sheet[index] ?? []).some((cell) => aliasIndex.get(normalizeHeader(cellText(cell))) === "name")) return index;
  }
  return -1;
}

export function parseMaterialSheet(sheet: unknown[][]): ParsedMaterialSheet {
  const headerIndex = findHeaderRow(sheet);
  if (headerIndex < 0) throw new MaterialSheetError("No se encuentra la fila de cabeceras: el Excel necesita una columna «Nombre» (o «Material», «Artículo»…).");
  const headerCells = (sheet[headerIndex] ?? []).map(cellText);
  const indexes = new Map<MaterialColumnKey, number>();
  const ignored: string[] = [];
  headerCells.forEach((header, index) => {
    if (!header) return;
    const key = aliasIndex.get(normalizeHeader(header));
    if (key && !indexes.has(key)) indexes.set(key, index);
    else ignored.push(header);
  });
  const columns = Object.fromEntries(MATERIAL_COLUMNS.map((column) => [column.key, indexes.has(column.key) ? headerCells[indexes.get(column.key)!]! : null])) as Record<MaterialColumnKey, string | null>;
  const rows: ParsedMaterialRow[] = [];
  sheet.slice(headerIndex + 1).forEach((cells, offset) => {
    const raw = (key: MaterialColumnKey) => (indexes.has(key) ? cells[indexes.get(key)!] : undefined);
    const text = (key: MaterialColumnKey) => cellText(raw(key));
    if (MATERIAL_COLUMNS.every((column) => text(column.key) === "")) return;
    const errors: string[] = [];
    const name = text("name");
    if (!name) errors.push("Falta el nombre");
    const cost = decimalCell(raw("cost"));
    const sale = decimalCell(raw("sale"));
    const tax = igicCell(raw("tax"));
    if (cost === undefined) errors.push(`Coste no válido: «${text("cost")}»`);
    if (sale === undefined) errors.push(`Precio de venta no válido: «${text("sale")}»`);
    if (cost?.startsWith("-") || sale?.startsWith("-")) errors.push("Los importes no pueden ser negativos");
    if (tax === undefined || (tax !== null && !ALLOWED_IGIC_RATES.includes(tax))) errors.push(`IGIC no válido: «${text("tax")}» (usa 0, 3, 7 o 15)`);
    const data: MaterialImportRow = { name };
    if (text("supplier")) data.supplierNameSnapshot = text("supplier");
    if (text("code")) data.supplierCode = text("code");
    if (text("unit")) data.unit = text("unit");
    if (cost) data.supplierUnitPrice = cost;
    if (sale) data.saleUnitPrice = sale;
    if (tax) data.igicRate = tax;
    if (text("description")) data.description = text("description");
    rows.push({ rowNumber: headerIndex + offset + 2, data, errors });
  });
  return { headerRow: headerIndex + 1, columns, ignored, rows };
}
