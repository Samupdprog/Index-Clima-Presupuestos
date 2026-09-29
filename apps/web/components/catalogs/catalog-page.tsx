"use client";

import { DropdownMenu } from "radix-ui";
import { Archive, ArchiveRestore, BriefcaseBusiness, Building2, CheckCircle2, FileSpreadsheet, FileText, LoaderCircle, MoreHorizontal, Package, PencilLine, Plus, Search, Truck, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { readSheet, type SheetData } from "read-excel-file/browser";
import type { MaterialImportRow } from "@quotes/contracts";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { ErrorState, ToastViewport, useToasts } from "../ui/feedback";
import { api, ApiError, type MaterialImportPlan } from "../../lib/api/client";
import type { CatalogKind, CatalogRecord } from "../../lib/api/types";
import { formatMoney, formatNumber } from "../../lib/format";
import { decimalForApi, formatDecimalForInput, parseDecimalText } from "../../lib/decimal";
import { DecimalInput } from "../ui/decimal-input";

type UiKind = "materiales" | "empleados" | "desplazamientos" | "proveedores" | "textos";
const config: Record<UiKind, { api: CatalogKind; title: string; singular: string; description: string; icon: typeof Package }> = {
  materiales: { api: "materials", title: "Materiales", singular: "material", description: "Costes, precios habituales y referencias de proveedor.", icon: Package },
  empleados: { api: "employees", title: "Empleados", singular: "empleado", description: "Tarifas horarias habituales para líneas de mano de obra.", icon: BriefcaseBusiness },
  desplazamientos: { api: "travels", title: "Desplazamientos", singular: "desplazamiento", description: "Conceptos recurrentes de transporte, salida y kilometraje.", icon: Truck },
  proveedores: { api: "suppliers", title: "Proveedores", singular: "proveedor", description: "Directorio breve para identificar el origen de materiales.", icon: Building2 },
  textos: { api: "text-templates", title: "Textos habituales", singular: "texto", description: "Plantillas reutilizables para condiciones, garantías y protección de datos.", icon: FileText },
};

export function CatalogPage({ kind }: { kind: UiKind }) {
  const item = config[kind]; const Icon = item.icon; const [records, setRecords] = useState<CatalogRecord[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [query, setQuery] = useState(""); const [editing, setEditing] = useState<CatalogRecord | "new" | null>(null); const [importOpen, setImportOpen] = useState(false); const { toasts, push } = useToasts();
  const load = useCallback(async () => { setLoading(true); setError(""); try { setRecords(await api.getCatalog(item.api)); } catch (cause) { setError(cause instanceof ApiError && cause.status === 503 ? "La API no está disponible." : "No se pudo cargar este catálogo."); } finally { setLoading(false); } }, [item.api]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => records.filter((record) => recordName(record).toLowerCase().includes(query.toLowerCase())), [query, records]);
  async function reactivate(record: CatalogRecord) { try { await api.updateCatalog(item.api, record.id, { active: true }); push(`${capitalize(item.singular)} reactivado`); await load(); } catch { push("No se pudo reactivar el registro", "error"); } }
  async function archive(record: CatalogRecord) { try { await api.archiveCatalog(item.api, record.id); push(`${capitalize(item.singular)} desactivado`); await load(); } catch { push("No se pudo actualizar el registro", "error"); } }
  return <div className="page"><div className="page-header"><div><p className="eyebrow">Catálogo</p><h1 className="page-title">{item.title}</h1><p className="page-subtitle">{item.description}</p></div><div className="header-actions">{kind === "materiales" ? <RippleButton variant="secondary" onClick={() => setImportOpen(true)}><FileSpreadsheet />Actualizar desde Excel</RippleButton> : null}<RippleButton onClick={() => setEditing("new")}><Plus />Nuevo {item.singular}</RippleButton></div></div>
    <div className="toolbar"><label className="search-field"><Search /><span className="sr-only">Buscar</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar ${item.title.toLowerCase()}…`} /></label></div>
    {loading ? <div className="catalog-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton" style={{ height: 170 }} key={index} />)}</div> : error ? <div className="panel"><ErrorState message={error} onRetry={() => void load()} /></div> : visible.length === 0 ? <div className="panel empty-state"><div><div className="empty-icon"><Icon /></div><h3>{query ? "No hay coincidencias" : `Aún no hay ${item.title.toLowerCase()}`}</h3><p>{query ? "Prueba con otro término." : `Crea el primer ${item.singular} para utilizarlo en presupuestos.`}</p>{!query ? <RippleButton onClick={() => setEditing("new")}><Plus />Crear {item.singular}</RippleButton> : null}</div></div> : <div className="catalog-grid">{visible.map((record) => <article className="panel catalog-card" key={record.id}><div className="catalog-card-head"><div><h3>{recordName(record)}</h3><p>{recordSubtitle(record)}</p></div><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="button button-ghost button-icon" aria-label="Acciones"><MoreHorizontal /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end"><DropdownMenu.Item className="dropdown-item" onSelect={() => setEditing(record)}><PencilLine />Editar</DropdownMenu.Item>{"active" in record && record.active ? <DropdownMenu.Item className="dropdown-item danger" onSelect={() => void archive(record)}><Archive />Desactivar</DropdownMenu.Item> : <DropdownMenu.Item className="dropdown-item" onSelect={() => void reactivate(record)}><ArchiveRestore />Reactivar</DropdownMenu.Item>}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div><div className="catalog-values">{recordValues(record).map(([label, value]) => <div className="catalog-value" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></article>)}</div>}
    <CatalogDialog kind={kind} apiKind={item.api} record={editing} open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={async (message) => { setEditing(null); push(message); await load(); }} />
    {kind === "materiales" ? <MaterialImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={async (summary) => { setImportOpen(false); push(`${summary.created} nuevos · ${summary.updated} actualizados · ${summary.unchanged} sin cambios`); await load(); }} /> : null}<ToastViewport toasts={toasts} />
  </div>;
}

type ParsedMaterial = { rowNumber: number; data: MaterialImportRow; errors: string[] };

const FIELD_LABELS: Record<string, string> = { name: "Nombre", supplierNameSnapshot: "Proveedor", supplierCode: "Código", unit: "Unidad", supplierUnitPrice: "Coste", saleUnitPrice: "Venta", igicRate: "IGIC", description: "Descripción", active: "Activo" };
function changeValue(field: string, value: string | boolean | null) {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field === "supplierUnitPrice" || field === "saleUnitPrice") return formatMoney(value);
  if (field === "igicRate") return `${formatNumber(value)} %`;
  return value;
}

function MaterialImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: (summary: MaterialImportPlan["summary"]) => void }) {
  const [fileName, setFileName] = useState(""); const [rows, setRows] = useState<ParsedMaterial[]>([]); const [plan, setPlan] = useState<MaterialImportPlan | null>(null); const [error, setError] = useState(""); const [reading, setReading] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFileName(""); setRows([]); setPlan(null); setError(""); setReading(false); setBusy(false); } }, [open]);
  async function chooseFile(file?: File) {
    if (!file) return; setFileName(file.name); setRows([]); setPlan(null); setError(""); setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("format");
      const parsed = parseMaterialSheet(await readSheet(file));
      setRows(parsed);
      if (!parsed.length) setError("El Excel no contiene filas de materiales.");
      else if (!parsed.some((row) => row.errors.length)) setPlan(await api.previewMaterialImport(parsed.map((row) => row.data)));
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("headers:") ? cause.message.slice(8) : cause instanceof ApiError ? "El servidor no pudo comparar el fichero con el catálogo." : "No se pudo leer el Excel. Comprueba que sea un .xlsx válido.");
    } finally { setReading(false); }
  }
  async function submit() {
    if (!plan || plan.summary.invalid || (!plan.summary.created && !plan.summary.updated)) return; setBusy(true); setError("");
    try { const applied = await api.applyMaterialImport(rows.map((row) => row.data), plan.planHash); await onImported(applied.summary); }
    catch (cause) { setError(cause instanceof ApiError && cause.code === "catalog_changed_since_preview" ? "El catálogo cambió desde la previsualización. Vuelve a seleccionar el fichero." : "No se pudo completar la importación. No se ha guardado ninguna fila."); }
    finally { setBusy(false); }
  }
  const invalidRows = rows.filter((row) => row.errors.length);
  const pending = plan ? plan.summary.created + plan.summary.updated : 0;
  const visibleItems = plan ? plan.items.filter((item) => item.action !== "unchanged") : [];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent wide title="Actualizar materiales desde Excel" description="El servidor compara el fichero con el catálogo. Revisa el resumen y confirma: nada se escribe antes." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton onClick={() => void submit()} disabled={busy || reading || !plan || pending === 0 || plan.summary.invalid > 0}>{busy ? <LoaderCircle className="spin" /> : <Upload />}{busy ? "Aplicando…" : pending ? `Aplicar ${pending} ${pending === 1 ? "cambio" : "cambios"}` : "Sin cambios"}</RippleButton></>}>
    <div className="excel-import"><div className="notice"><FileSpreadsheet /><span><strong>Cabeceras:</strong> Nombre, Proveedor, Código proveedor, Unidad, Coste proveedor, Precio venta, IGIC y Descripción. Se identifican por código de proveedor o, sin código, por nombre y proveedor. Las celdas vacías conservan el valor actual y nunca se desactivan artículos ausentes.</span></div><label className="excel-drop"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event.target.files?.[0])} /><FileSpreadsheet /><span><strong>{fileName || "Seleccionar archivo .xlsx"}</strong><small>{reading ? "Leyendo y comparando con el catálogo…" : "Puedes reemplazarlo antes de confirmar"}</small></span></label>
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {invalidRows.length ? <><p className="error-text" role="alert">{invalidRows.length} {invalidRows.length === 1 ? "fila tiene errores" : "filas tienen errores"}. Corrige el Excel y vuelve a seleccionarlo.</p><div className="table-wrap excel-preview"><table className="data-table"><thead><tr><th>Fila</th><th>Nombre</th><th>Problema</th></tr></thead><tbody>{invalidRows.slice(0, 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td><strong>{row.data.name || "—"}</strong></td><td className="error-text">{row.errors.join(" · ")}</td></tr>)}</tbody></table></div></> : null}
    {plan ? <><div className="import-summary" aria-live="polite"><span><CheckCircle2 />{plan.summary.unchanged} sin cambios</span><span data-kind="update"><PencilLine />{plan.summary.updated} actualizaciones</span><span data-kind="create"><Plus />{plan.summary.created} nuevos</span>{plan.summary.invalid ? <span data-kind="invalid"><Archive />{plan.summary.invalid} no válidos</span> : null}</div>
    {visibleItems.length ? <div className="table-wrap excel-preview"><table className="data-table"><thead><tr><th>Fila</th><th>Material</th><th>Acción</th><th>Cambios</th></tr></thead><tbody>{visibleItems.slice(0, 200).map((item) => <tr key={item.row} data-invalid={item.action === "invalid" || undefined}><td>{item.row + 1}</td><td><strong>{item.name}</strong></td><td>{item.action === "create" ? "Nuevo" : item.action === "update" ? "Actualizar" : item.reason === "ambiguous_match" ? "Varios materiales coinciden" : "Fila repetida"}</td><td>{item.action === "update" ? item.changes.map((change) => <span className="change-chip" key={change.field}>{FIELD_LABELS[change.field] ?? change.field}: {changeValue(change.field, change.before)} → <strong>{changeValue(change.field, change.after)}</strong></span>) : item.action === "create" ? item.changes.filter((change) => ["supplierUnitPrice", "saleUnitPrice"].includes(change.field)).map((change) => <span className="change-chip" key={change.field}>{FIELD_LABELS[change.field]}: <strong>{changeValue(change.field, change.after)}</strong></span>) : "—"}</td></tr>)}</tbody></table></div> : <p className="field-hint">El catálogo ya coincide con el fichero.</p>}
    {visibleItems.length > 200 ? <p className="field-hint">Se muestran 200 de {visibleItems.length} filas con cambios.</p> : null}</> : null}</div>
  </DialogContent></Dialog>;
}

function parseMaterialSheet(sheet: SheetData): ParsedMaterial[] {
  const [headerRow, ...dataRows] = sheet;
  if (!headerRow) return [];
  const headers = new Map(headerRow.map((cell, index) => [normalizeHeader(cellText(cell)), index]));
  const column = (...aliases: string[]) => aliases.map(normalizeHeader).map((alias) => headers.get(alias)).find((index) => index !== undefined);
  const indexes = {
    name: column("Nombre", "Material", "Name"), supplier: column("Proveedor", "Supplier"), code: column("Código proveedor", "Codigo proveedor", "Código", "Supplier code"), unit: column("Unidad", "Unit"), cost: column("Coste proveedor", "Coste", "Precio proveedor", "Supplier price"), sale: column("Precio venta", "Venta habitual", "PVP venta", "Sale price"), tax: column("IGIC", "IGIC %", "Impuesto", "Tax"), description: column("Descripción", "Descripcion", "Description"),
  };
  if (indexes.name === undefined) throw new Error("headers:Falta la columna obligatoria “Nombre”.");
  return dataRows.map((cells, index) => {
    const read = (columnIndex: number | undefined) => columnIndex === undefined ? "" : cellText(cells[columnIndex]);
    const name = read(indexes.name); const supplierUnitPrice = decimalCell(read(indexes.cost)); const saleUnitPrice = decimalCell(read(indexes.sale)); const igicRate = decimalCell(read(indexes.tax)) || "7"; const errors: string[] = [];
    if (!name) errors.push("Nombre obligatorio");
    if (supplierUnitPrice && !isDecimal(supplierUnitPrice)) errors.push("Coste inválido");
    if (saleUnitPrice && !isDecimal(saleUnitPrice)) errors.push("Venta inválida");
    if (!isDecimal(igicRate)) errors.push("IGIC inválido");
    return { rowNumber: index + 2, errors, data: { name, unit: read(indexes.unit) || "ud", igicRate, ...(read(indexes.supplier) ? { supplierNameSnapshot: read(indexes.supplier) } : {}), ...(read(indexes.code) ? { supplierCode: read(indexes.code) } : {}), ...(supplierUnitPrice ? { supplierUnitPrice } : {}), ...(saleUnitPrice ? { saleUnitPrice } : {}), ...(read(indexes.description) ? { description: read(indexes.description) } : {}) } };
  }).filter((row) => Object.values(row.data).some((value) => value !== "" && value !== "ud" && value !== "7"));
}

function cellText(value: unknown) { return value === null || value === undefined ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim(); }
function normalizeHeader(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[%_\-]+/g, " ").replace(/\s+/g, " ").trim(); }
function decimalCell(value: string) { return value.trim() ? parseDecimalText(value) ?? value.trim() : ""; }
function isDecimal(value: string) { return /^-?\d+(?:\.\d+)?$/.test(value); }

function CatalogDialog({ kind, apiKind, record, open, onOpenChange, onSaved }: { kind: UiKind; apiKind: CatalogKind; record: CatalogRecord | "new" | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (message: string) => void }) {
  const existing = record && record !== "new" ? record : null; const [form, setForm] = useState<Record<string, string | boolean>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const fields = fieldConfig(kind);
  useEffect(() => { const initial: Record<string, string | boolean> = {}; fields.forEach((field) => { const source = existing as unknown as Record<string, unknown> | null; const raw = source?.[field.key] as string | boolean | null | undefined ?? field.defaultValue ?? ""; initial[field.key] = field.numeric && typeof raw === "string" ? formatDecimalForInput(raw) : raw ?? ""; }); setForm(initial); setError(""); }, [existing, open, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(event: FormEvent) { event.preventDefault(); const invalid = fields.find((field) => field.numeric && typeof form[field.key] === "string" && String(form[field.key]).trim() !== "" && parseDecimalText(String(form[field.key])) === null); if (invalid) { setError(`“${invalid.label}” no es un número válido.`); return; } setBusy(true); setError(""); try { const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, typeof value === "string" && fields.find((field) => field.key === key)?.numeric ? decimalForApi(value, "0") : value])); if (existing) await api.updateCatalog(apiKind, existing.id, payload); else await api.createCatalog(apiKind, payload); onSaved(existing ? "Registro actualizado" : "Registro creado"); } catch { setError("No se pudo guardar. Revisa los campos."); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title={`${existing ? "Editar" : "Nuevo"} ${config[kind].singular}`} description="Estos valores son habituales; cada presupuesto conserva su propio snapshot editable." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="catalog-form" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</RippleButton></>}><form id="catalog-form" onSubmit={submit} className="form-grid">{fields.map((field) => { const fieldId = `catalog-${kind}-${field.key}`; return field.type === "textarea" ? <div className="field span-2" key={field.key}><label className="field-label" htmlFor={fieldId}>{field.label}</label><textarea id={fieldId} className="textarea" value={String(form[field.key] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} required={field.required} /></div> : field.type === "checkbox" ? <label className="panel span-2" key={field.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12 }}><input id={fieldId} type="checkbox" checked={Boolean(form[field.key])} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.checked }))} />{field.label}</label> : <div className={`field${field.full ? " span-2" : ""}`} key={field.key}><label className="field-label" htmlFor={fieldId}>{field.label}</label>{field.numeric ? <DecimalInput id={fieldId} className="input" value={String(form[field.key] ?? "")} onValueChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} required={field.required} /> : <input id={fieldId} className="input" value={String(form[field.key] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} required={field.required} />}</div>; })}{error ? <p className="error-text span-2">{error}</p> : null}</form></DialogContent></Dialog>;
}

type Field = { key: string; label: string; type?: "input" | "textarea" | "checkbox"; defaultValue?: string | boolean; full?: boolean; numeric?: boolean; required?: boolean };
function fieldConfig(kind: UiKind): Field[] { if (kind === "materiales") return [{ key: "name", label: "Nombre", full: true, required: true }, { key: "supplierNameSnapshot", label: "Proveedor" }, { key: "supplierCode", label: "Código proveedor" }, { key: "unit", label: "Unidad", defaultValue: "ud" }, { key: "supplierUnitPrice", label: "Coste / PVP proveedor", numeric: true }, { key: "saleUnitPrice", label: "Venta habitual", numeric: true }, { key: "igicRate", label: "IGIC %", defaultValue: "7", numeric: true }, { key: "description", label: "Descripción", type: "textarea" }]; if (kind === "empleados") return [{ key: "name", label: "Nombre", full: true, required: true }, { key: "costRate", label: "Coste / hora", defaultValue: "0", numeric: true }, { key: "saleRate", label: "Venta / hora", defaultValue: "0", numeric: true }, { key: "defaultIgicRate", label: "IGIC %", defaultValue: "7", numeric: true }]; if (kind === "desplazamientos") return [{ key: "name", label: "Nombre", full: true, required: true }, { key: "unit", label: "Unidad", defaultValue: "km" }, { key: "costUnitPrice", label: "Coste / unidad", defaultValue: "0", numeric: true }, { key: "saleUnitPrice", label: "Venta / unidad", defaultValue: "0", numeric: true }, { key: "igicRate", label: "IGIC %", defaultValue: "7", numeric: true }, { key: "description", label: "Descripción", type: "textarea" }]; if (kind === "proveedores") return [{ key: "name", label: "Nombre", full: true, required: true }, { key: "taxId", label: "NIF / CIF" }]; return [{ key: "title", label: "Título", full: true, required: true }, { key: "body", label: "Contenido", type: "textarea", required: true }, { key: "alwaysInclude", label: "Incluir por defecto", type: "checkbox", defaultValue: false }]; }
function recordName(record: CatalogRecord) { return "title" in record ? record.title : record.name; }
function recordSubtitle(record: CatalogRecord) { if ("supplierNameSnapshot" in record) return record.supplierNameSnapshot || record.supplierCode || "Sin proveedor"; if ("body" in record) return record.body.slice(0, 90); if ("taxId" in record) return record.taxId || "Sin NIF/CIF"; if ("description" in record) return record.description || record.unit; return "Tarifa habitual"; }
function recordValues(record: CatalogRecord): Array<[string, string]> { if ("supplierUnitPrice" in record) return [["Coste", formatMoney(record.supplierUnitPrice)], ["Venta", formatMoney(record.saleUnitPrice)], ["Unidad", record.unit], ["IGIC", `${formatNumber(record.igicRate)} %`]]; if ("costRate" in record) return [["Coste / h", formatMoney(record.costRate)], ["Venta / h", formatMoney(record.saleRate)], ["IGIC", `${formatNumber(record.defaultIgicRate)} %`], ["Estado", record.active ? "Activo" : "Inactivo"]]; if ("costUnitPrice" in record) return [["Coste", formatMoney(record.costUnitPrice)], ["Venta", formatMoney(record.saleUnitPrice)], ["Unidad", record.unit], ["Estado", record.active ? "Activo" : "Inactivo"]]; if ("alwaysInclude" in record) return [["Por defecto", record.alwaysInclude ? "Sí" : "No"], ["Estado", record.active ? "Activo" : "Inactivo"]]; return [["Estado", record.active ? "Activo" : "Inactivo"]]; }
function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
