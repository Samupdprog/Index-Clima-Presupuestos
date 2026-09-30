"use client";

import { AlertTriangle, Archive, CheckCircle2, CircleCheck, CircleDashed, Download, FileSpreadsheet, LoaderCircle, PencilLine, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { api, ApiError, type MaterialImportPlan } from "../../lib/api/client";
import { formatMoney, formatNumber } from "../../lib/format";
import { MATERIAL_COLUMNS, MaterialSheetError, parseMaterialSheet, type MaterialColumnKey, type ParsedMaterialSheet } from "../../lib/material-import";

const TEMPLATE_URL = "/plantillas/plantilla-materiales.xlsx";
/** Columnas económicas: si faltan, el Excel solo actualizaría nombres. */
const PRICE_COLUMNS: MaterialColumnKey[] = ["cost", "sale", "tax"];
const FIELD_LABELS: Record<string, string> = { name: "Nombre", supplierNameSnapshot: "Proveedor", supplierCode: "Código", unit: "Unidad", supplierUnitPrice: "Coste", saleUnitPrice: "Venta", igicRate: "IGIC", description: "Descripción", active: "Activo" };
const CREATE_FIELDS = ["supplierUnitPrice", "saleUnitPrice", "igicRate", "unit", "supplierNameSnapshot", "supplierCode"];

function changeValue(field: string, value: string | boolean | null) {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field === "supplierUnitPrice" || field === "saleUnitPrice") return formatMoney(value);
  if (field === "igicRate") return `${formatNumber(value)} %`;
  return value;
}

export function MaterialImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: (summary: MaterialImportPlan["summary"]) => void | Promise<void> }) {
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedMaterialSheet | null>(null);
  const [plan, setPlan] = useState<MaterialImportPlan | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setFileName(""); setSheet(null); setPlan(null); setError(""); setReading(false); setBusy(false); }
  }, [open]);

  async function chooseFile(file?: File) {
    if (!file) return;
    setFileName(file.name); setSheet(null); setPlan(null); setError(""); setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new MaterialSheetError("El archivo debe ser un Excel .xlsx. Si lo tienes en .xls o .csv, ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».");
      const parsed = parseMaterialSheet(await readSheet(file));
      setSheet(parsed);
      if (!parsed.rows.length) setError("El Excel no tiene filas de materiales debajo de las cabeceras.");
      else if (!parsed.rows.some((row) => row.errors.length)) setPlan(await api.previewMaterialImport(parsed.rows.map((row) => row.data)));
    } catch (cause) {
      setError(cause instanceof MaterialSheetError ? cause.message : cause instanceof ApiError ? "El servidor no pudo comparar el fichero con el catálogo. Inténtalo de nuevo." : "No se pudo leer el Excel. Comprueba que sea un .xlsx válido.");
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    if (!sheet || !plan || plan.summary.invalid || (!plan.summary.created && !plan.summary.updated)) return;
    setBusy(true); setError("");
    try {
      const applied = await api.applyMaterialImport(sheet.rows.map((row) => row.data), plan.planHash);
      await onImported(applied.summary);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "catalog_changed_since_preview" ? "El catálogo cambió desde la previsualización. Vuelve a seleccionar el fichero." : "No se pudo completar la importación. No se ha guardado ninguna fila.");
    } finally {
      setBusy(false);
    }
  }

  const invalidRows = sheet?.rows.filter((row) => row.errors.length) ?? [];
  const missingPrices = sheet ? PRICE_COLUMNS.filter((key) => !sheet.columns[key]) : [];
  const pending = plan ? plan.summary.created + plan.summary.updated : 0;
  const visibleItems = plan ? plan.items.filter((item) => item.action !== "unchanged") : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        wide
        title="Importar materiales desde Excel"
        description="Crea materiales nuevos y actualiza los existentes con su coste, precio de venta e IGIC. Revisas el resultado antes de guardar."
        footer={<>
          <DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose>
          <RippleButton onClick={() => void submit()} disabled={busy || reading || !plan || pending === 0 || plan.summary.invalid > 0}>
            {busy ? <LoaderCircle className="spin" /> : <Upload />}
            {busy ? "Aplicando…" : pending ? `Aplicar ${pending} ${pending === 1 ? "cambio" : "cambios"}` : "Sin cambios"}
          </RippleButton>
        </>}
      >
        <div className="excel-import">
          {sheet ? <details className="import-guide-toggle"><summary>Ver la estructura del Excel</summary><ImportGuide /></details> : <ImportGuide />}

          <label className="excel-drop">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
            <FileSpreadsheet />
            <span><strong>{fileName || "Seleccionar archivo .xlsx"}</strong><small>{reading ? "Leyendo y comparando con el catálogo…" : sheet ? "Pulsa para elegir otro archivo" : "Nada se guarda hasta que confirmes"}</small></span>
          </label>

          {error ? <p className="error-text" role="alert">{error}</p> : null}

          {sheet ? <DetectedColumns sheet={sheet} /> : null}
          {missingPrices.length ? (
            <div className="notice notice-warning" role="status">
              <AlertTriangle />
              <span>No se ha encontrado la columna de <strong>{missingPrices.map((key) => MATERIAL_COLUMNS.find((column) => column.key === key)!.label).join(", ")}</strong>. Esos datos no se importarán: los materiales existentes conservan el valor actual{missingPrices.includes("tax") ? " y los nuevos tendrán IGIC 7 %" : ""}. Si tu Excel los tiene, renombra la cabecera como en la plantilla.</span>
            </div>
          ) : null}

          {sheet && sheet.rows.length ? <ReadPreview sheet={sheet} /> : null}

          {invalidRows.length ? <>
            <p className="error-text" role="alert">{invalidRows.length} {invalidRows.length === 1 ? "fila tiene errores" : "filas tienen errores"}. Corrige el Excel y vuelve a seleccionarlo.</p>
            <div className="table-wrap excel-preview"><table className="data-table"><thead><tr><th>Fila</th><th>Nombre</th><th>Problema</th></tr></thead><tbody>{invalidRows.slice(0, 100).map((row) => <tr key={row.rowNumber} data-invalid><td>{row.rowNumber}</td><td><strong>{row.data.name || "—"}</strong></td><td className="error-text">{row.errors.join(" · ")}</td></tr>)}</tbody></table></div>
          </> : null}

          {plan && sheet ? <>
            <h3 className="import-section-title">Cambios en el catálogo</h3>
            <div className="import-summary" aria-live="polite">
              <span><CheckCircle2 />{plan.summary.unchanged} sin cambios</span>
              <span data-kind="update"><PencilLine />{plan.summary.updated} actualizaciones</span>
              <span data-kind="create"><Plus />{plan.summary.created} nuevos</span>
              {plan.summary.invalid ? <span data-kind="invalid"><Archive />{plan.summary.invalid} no válidos</span> : null}
            </div>
            {visibleItems.length ? (
              <div className="table-wrap excel-preview"><table className="data-table"><thead><tr><th>Fila</th><th>Material</th><th>Acción</th><th>Datos</th></tr></thead><tbody>
                {visibleItems.slice(0, 200).map((item) => (
                  <tr key={item.row} data-invalid={item.action === "invalid" || undefined}>
                    <td>{sheet.rows[item.row - 1]?.rowNumber ?? item.row}</td>
                    <td><strong>{item.name}</strong></td>
                    <td>{item.action === "create" ? "Nuevo" : item.action === "update" ? "Actualizar" : item.reason === "ambiguous_match" ? "Varios materiales coinciden" : "Fila repetida"}</td>
                    <td>{item.action === "update"
                      ? item.changes.map((change) => <span className="change-chip" key={change.field}>{FIELD_LABELS[change.field] ?? change.field}: {changeValue(change.field, change.before)} → <strong>{changeValue(change.field, change.after)}</strong></span>)
                      : item.action === "create"
                        ? CREATE_FIELDS.map((field) => item.changes.find((change) => change.field === field)).filter((change) => change !== undefined).map((change) => <span className="change-chip" key={change.field}>{FIELD_LABELS[change.field]}: <strong>{changeValue(change.field, change.after)}</strong></span>)
                        : "—"}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <p className="field-hint">El catálogo ya coincide con el fichero.</p>}
            {visibleItems.length > 200 ? <p className="field-hint">Se muestran 200 de {visibleItems.length} filas con cambios.</p> : null}
          </> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Estructura del Excel, generada desde la misma definición que usa el lector. */
function ImportGuide() {
  return (
    <section className="import-guide" aria-labelledby="import-guide-title">
      <div className="import-guide-head">
        <div>
          <h3 id="import-guide-title" className="import-section-title">Cómo preparar el Excel</h3>
          <p className="field-hint">Un archivo <strong>.xlsx</strong> con una fila de cabeceras y <strong>un material por fila</strong>. Solo «Nombre» es obligatoria, pero incluye coste, precio de venta e IGIC para importar el material completo.</p>
        </div>
        <a className="button button-secondary" href={TEMPLATE_URL} download="plantilla-materiales.xlsx"><Download />Descargar plantilla</a>
      </div>
      <div className="table-wrap import-guide-table">
        <table className="data-table">
          <thead><tr><th>Columna</th><th>Qué poner</th><th>Ejemplo</th></tr></thead>
          <tbody>
            {MATERIAL_COLUMNS.map((column) => (
              <tr key={column.key}>
                <td><strong>{column.label}</strong>{column.required ? <span className="badge">Obligatoria</span> : null}<small>También: {column.aliases.slice(0, 4).join(", ")}</small></td>
                <td>{column.help}</td>
                <td className="import-example">{column.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="import-rules">
        <li>Un material se <strong>actualiza</strong> si coincide su código de proveedor (o, sin código, nombre y proveedor); si no existe, se <strong>crea</strong>.</li>
        <li>Importes <strong>sin impuestos</strong>, con coma o punto (9,90 · 9.90 · 1.234,50 €). IGIC: 0, 3, 7 o 15.</li>
        <li>Una celda vacía <strong>conserva</strong> el valor actual. Los materiales que no estén en el Excel no se tocan.</li>
      </ul>
    </section>
  );
}

function DetectedColumns({ sheet }: { sheet: ParsedMaterialSheet }) {
  return (
    <section className="import-columns" aria-label="Columnas detectadas">
      <h3 className="import-section-title">Columnas detectadas <small>cabeceras en la fila {sheet.headerRow}</small></h3>
      <ul>
        {MATERIAL_COLUMNS.map((column) => {
          const found = sheet.columns[column.key];
          return (
            <li key={column.key} data-found={found ? true : undefined} data-important={!found && PRICE_COLUMNS.includes(column.key) ? true : undefined}>
              {found ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
              <span><strong>{column.label}</strong><small>{found ? (found === column.label ? "Encontrada" : `Columna «${found}»`) : "No está en el Excel"}</small></span>
            </li>
          );
        })}
      </ul>
      {sheet.ignored.length ? <p className="field-hint">Se ignoran: {sheet.ignored.join(", ")}.</p> : null}
    </section>
  );
}

/** Cómo se ha leído cada fila, antes de compararla con el catálogo. */
function ReadPreview({ sheet }: { sheet: ParsedMaterialSheet }) {
  const rows = sheet.rows.slice(0, 8);
  const cell = (value: string | undefined, money = false) => (value ? (money ? formatMoney(value) : value) : <span className="import-empty">—</span>);
  return (
    <section aria-label="Lectura del Excel">
      <h3 className="import-section-title">Así se ha leído <small>{sheet.rows.length} {sheet.rows.length === 1 ? "material" : "materiales"}{sheet.rows.length > rows.length ? ` · primeras ${rows.length} filas` : ""}</small></h3>
      <div className="table-wrap excel-preview">
        <table className="data-table">
          <thead><tr><th>Fila</th><th>Nombre</th><th>Proveedor</th><th>Código</th><th>Ud.</th><th className="numeric">Coste</th><th className="numeric">Venta</th><th className="numeric">IGIC</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} data-invalid={row.errors.length ? true : undefined}>
                <td>{row.rowNumber}</td>
                <td><strong>{row.data.name || "—"}</strong></td>
                <td>{cell(row.data.supplierNameSnapshot)}</td>
                <td>{cell(row.data.supplierCode)}</td>
                <td>{cell(row.data.unit)}</td>
                <td className="numeric">{cell(row.data.supplierUnitPrice, true)}</td>
                <td className="numeric">{cell(row.data.saleUnitPrice, true)}</td>
                <td className="numeric">{row.data.igicRate ? `${formatNumber(row.data.igicRate)} %` : <span className="import-empty">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">«—» significa celda vacía: se conserva el valor actual del catálogo.</p>
    </section>
  );
}
