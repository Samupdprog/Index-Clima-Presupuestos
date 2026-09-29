"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { AdjustmentDialog } from "./adjustment-dialog";
import { ReviewDocument } from "./review-document";
import { InternalReview } from "./internal-review";
import { QuoteLifecycleDialog, type LifecycleAction } from "./quote-lifecycle";
import { ConceptWorkspace } from "./editor/concept-workspace";
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCopy,
  CloudUpload,
  Eye,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  PencilLine,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  ChartColumn,
  ArchiveRestore,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { QuoteCommand } from "@quotes/contracts";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { OriginBadge, StatusBadge } from "../ui/badges";
import { ErrorState, RevisionConflictDialog, ToastViewport, useToasts } from "../ui/feedback";
import { SearchableSelect } from "../ui/searchable-select";
import { api, ApiError } from "../../lib/api/client";
import type {
  CalculatedLine,
  ClientRecord,
  EmployeeRecord,
  MaterialRecord,
  QuoteLine,
  QuoteRecord,
  QuoteStatus,
  TextTemplateRecord,
  TravelRecord,
} from "../../lib/api/types";
import { formatMoney, formatNumber, formatPercentage } from "../../lib/format";
import { parseDecimalText } from "../../lib/decimal";
import { DecimalInput } from "../ui/decimal-input";

type SaveState = "idle" | "saving" | "saved" | "error";
type WorkflowStep = 1 | 2 | 3 | 4 | 5;

type Execute = (command: QuoteCommand, successMessage?: string) => Promise<QuoteRecord>;

type AiLineDraft = {
  id: string;
  type: "material" | "travel" | "other";
  description: string;
  quantity: string;
  unit: string;
  supplier: string;
  supplierCode: string;
  supplierUnitPrice: string;
  directUnitCost: string;
  saleUnitPrice: string;
  igicRate: string;
  discounts: string[];
};

function editableDecimal(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

function normalizedRate(value: string | null | undefined) {
  return editableDecimal(value) || "7";
}

export function QuoteEditor({ quoteId }: { quoteId: string }) {
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();
  const initializedWorkflow = useRef(false);
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [travels, setTravels] = useState<TravelRecord[]>([]);
  const [templates, setTemplates] = useState<TextTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(1);
  const [conflict, setConflict] = useState(false);
  const { toasts, push } = useToasts();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [loadedQuote, loadedMaterials, loadedEmployees, loadedTravels, loadedTemplates] = await Promise.all([
        api.getQuote(quoteId),
        api.getCatalog<MaterialRecord>("materials"),
        api.getCatalog<EmployeeRecord>("employees"),
        api.getCatalog<TravelRecord>("travels"),
        api.getCatalog<TextTemplateRecord>("text-templates"),
      ]);
      setQuote(loadedQuote); setMaterials(loadedMaterials); setEmployees(loadedEmployees); setTravels(loadedTravels); setTemplates(loadedTemplates);
      if (!initializedWorkflow.current) {
        const start = searchParams.get("inicio");
        setWorkflowStep(start === "ia" ? 2 : start === "manual" ? 3 : loadedQuote.lines.length ? 3 : 1);
        initializedWorkflow.current = true;
      }
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503 ? "La API no está disponible. Inicia la base de datos y el servicio API para continuar." : "No se pudo abrir este presupuesto.");
    } finally { setLoading(false); }
  }, [quoteId, searchParams]);

  useEffect(() => { void load(); }, [load]);
  const refreshQuote = useCallback(async () => {
    const current = await api.getQuote(quoteId); setQuote(current); return current;
  }, [quoteId]);

  const execute = useCallback(async (command: QuoteCommand, successMessage?: string) => {
    setSaveState("saving");
    try {
      await api.command(quoteId, command);
      const current = await refreshQuote();
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
      if (successMessage) push(successMessage);
      return current;
    } catch (cause) {
      setSaveState("error");
      if (cause instanceof ApiError && cause.isRevisionConflict) setConflict(true);
      else push("No se pudo guardar el cambio", "error");
      throw cause;
    }
  }, [push, quoteId, refreshQuote]);

  const readOnly = quote?.accessMode === "read_only" || quote?.status === "archived" || Boolean(quote?.deletedAt);
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);
  const calculationByLine = useMemo(() => {
    const map = new Map<string, CalculatedLine>();
    quote?.calculation?.lines.forEach((line) => map.set(line.quoteLineId ?? line.id ?? "", line));
    return map;
  }, [quote]);

  async function updateLine(line: QuoteLine, changes: Record<string, unknown>) {
    if (!quote || readOnly) return;
    await execute({ type: "updateQuoteLine", expectedRevision: quote.revision, lineId: line.id, changes });
  }

  async function deleteLine(line: QuoteLine) {
    if (!quote || readOnly) return;
    await execute({ type: "deleteQuoteLine", expectedRevision: quote.revision, lineId: line.id }, "Línea eliminada");
  }

  async function exportToHolded() {
    if (!quote || readOnly) return;
    setSaveState("saving");
    try {
      const current = await api.exportQuoteToHolded(quote.id, quote.revision);
      setQuote(current);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
      push(quote.holdedEstimateId ? "Presupuesto actualizado en Holded" : "Presupuesto importado en Holded");
    } catch (cause) {
      setSaveState("error");
      if (cause instanceof ApiError && cause.isRevisionConflict) setConflict(true);
      else if (cause instanceof ApiError && cause.code === "holded_not_configured") push("Conecta Holded desde Configuración para enviar el presupuesto.", "error");
      else push(`No se pudo confirmar el envío a Holded (${cause instanceof ApiError ? cause.code : "error de conexión"}). Los datos locales están guardados; revisa la conexión y los impuestos antes de reintentar.`, "error");
      await refreshQuote().catch(() => undefined);
    }
  }

  async function reorderLines(ordered: QuoteLine[]) {
    if (!quote || readOnly) return;
    setQuote({ ...quote, lines: ordered });
    try { await execute({ type: "reorderQuoteLines", expectedRevision: quote.revision, orderedLineIds: ordered.map((line) => line.id) }); } catch { await refreshQuote(); }
  }

  function moveLine(line: QuoteLine, direction: -1 | 1) {
    if (!quote) return;
    const index = quote.lines.findIndex((item) => item.id === line.id);
    const target = index + direction;
    if (target < 0 || target >= quote.lines.length) return;
    const ordered = [...quote.lines];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    void reorderLines(ordered);
  }

  async function importAiLines(lines: AiLineDraft[]) {
    if (!quote || readOnly) return;
    await execute({ type: "importQuoteLines", expectedRevision: quote.revision, lines: lines.map(({ id: _id, supplierUnitPrice, directUnitCost, saleUnitPrice, ...line }) => ({ ...line,
      saleBaseMode: "supplier_list_price", ...(supplierUnitPrice.trim() ? { supplierUnitPrice } : {}), ...(directUnitCost.trim() ? { directUnitCost } : {}), ...(saleUnitPrice.trim() ? { saleUnitPrice } : {}),
    })) });
    push(`${lines.length} ${lines.length === 1 ? "línea importada" : "líneas importadas"}`);
    setWorkflowStep(3);
  }

  if (loading) return <EditorSkeleton />;
  if (error || !quote) return <div className="page"><ErrorState message={error ?? "El presupuesto no existe."} onRetry={() => void load()} /></div>;

  return (
    <div className="page">
      <div className="editor-header">
        <div className="breadcrumb"><Link href="/presupuestos"><ArrowLeft />Presupuestos</Link><ChevronRight /><span>{quote.reference}</span></div>
        <div className="editor-title-row">
          <div><span className="quote-reference">{quote.reference}{!readOnly ? <button type="button" className="reference-edit" aria-label="Cambiar número del presupuesto" title="Cambiar número" onClick={() => setLifecycle("rename")}><PencilLine /></button> : null}</span><h1 className="editor-title">{quote.title}</h1><div className="editor-meta"><span>{quote.clientSnapshot?.name ?? "Sin cliente"}</span><span>·</span><QuoteStatusControl quote={quote} disabled={readOnly} onChange={(status) => execute({ type: "changeQuoteStatus", expectedRevision: quote.revision, status }, `Estado cambiado a ${statusLabel(status).toLowerCase()}`)} /><OriginBadge origin={quote.origin} />{quote.holdedEstimateId ? <span className="badge badge-origin">En Holded</span> : null}{readOnly ? <span className="badge badge-readonly">Solo lectura</span> : null}<SaveIndicator state={saveState} /></div></div>
          <div className="header-actions"><RippleButton variant="secondary" onClick={() => setWorkflowStep(5)}><Eye />Revisión</RippleButton><RippleButton variant="secondary" onClick={() => setWorkflowStep(4)} disabled={quote.lines.length === 0}><CircleDollarSign />Precio final</RippleButton></div>
        </div>
      </div>
      {quote.accessMode === "read_only" ? <div className="notice notice-warning" style={{ marginBottom: 16 }}><AlertTriangle /><span><strong>Generado desde Holded.</strong> Este presupuesto es de solo lectura. Duplícalo desde el listado para crear una versión editable.</span></div> : null}
      {quote.status === "archived" ? <div className="notice notice-warning" style={{ marginBottom: 16 }}><AlertTriangle /><span>Este presupuesto está archivado y no admite cambios.</span></div> : null}
      {quote.deletedAt ? <div className="notice notice-danger notice-actions" style={{ marginBottom: 16 }}><Trash2 /><span><strong>En la papelera.</strong> No admite cambios hasta que lo restaures.</span><RippleButton variant="secondary" size="sm" onClick={() => setLifecycle("restore")}><ArchiveRestore />Restaurar</RippleButton></div> : null}
      <QuoteLifecycleDialog quote={lifecycle ? quote : null} action={lifecycle} onClose={() => setLifecycle(null)} onDone={({ action, quote: updated }) => { setLifecycle(null); if (updated) setQuote({ ...quote, ...updated, lines: quote.lines }); void refreshQuote(); push(action === "rename" ? "Número actualizado" : "Presupuesto restaurado"); }} />
      <WorkflowSteps current={workflowStep} quote={quote} onSelect={setWorkflowStep} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={workflowStep} className="workflow-stage" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -5 }} transition={{ duration: reduceMotion ? 0 : .2 }}>
          {workflowStep === 1 ? <ClientStep quote={quote} execute={execute} disabled={readOnly} onNext={() => setWorkflowStep(2)} /> : null}
          {workflowStep === 2 ? <AiImportStep readOnly={readOnly} onImport={importAiLines} onBack={() => setWorkflowStep(1)} onSkip={() => setWorkflowStep(3)} /> : null}
          {workflowStep === 3 ? <>
            <div className="stage-heading">
              <div>
                <p className="eyebrow">Paso 3 de 5</p>
                <h2>Construye los conceptos</h2>
                <p>Añade, revisa y corrige líneas sin salir de esta pantalla. Haz doble clic sobre cantidades o importes para editarlos rápidamente.</p>
              </div>
              <RippleButton variant="secondary" onClick={() => setWorkflowStep(2)}><Bot />Añadir oferta con IA</RippleButton>
            </div>

            <ConceptWorkspace
              quote={quote}
              materials={materials}
              employees={employees}
              travels={travels}
              calculations={calculationByLine}
              readOnly={readOnly}
              execute={execute}
              onOptimisticReorder={(ordered) => setQuote({ ...quote, lines: ordered })}
              onReorder={reorderLines}
              onReviewPrice={() => setWorkflowStep(4)}
            />

            <section className="panel texts-section">
              <div className="section-heading">
                <h2>Textos del presupuesto</h2>
                <RippleButton variant="ghost" size="sm" disabled={readOnly} onClick={() => { setEditingTextId(null); setTextOpen(true); }}><Plus />Añadir texto</RippleButton>
              </div>
              {quote.texts?.length ? <DraggableTextBlocks quote={quote} execute={execute} onEdit={(textId) => { setEditingTextId(textId); setTextOpen(true); }} onReorder={(texts) => setQuote({ ...quote, texts })} /> : <div style={{ padding: 20, color: "var(--foreground-muted)", fontSize: 12 }}>Añade condiciones, garantías o protección de datos para incluirlos en la revisión.</div>}
            </section>

            <WorkflowFooter backLabel="Preparación" onBack={() => setWorkflowStep(2)} nextLabel="Revisar precio final" onNext={() => setWorkflowStep(4)} nextDisabled={quote.lines.length === 0} />
          </> : null}
          {workflowStep === 4 ? <PriceStep quote={quote} readOnly={readOnly} onAdjust={() => setAdjustOpen(true)} onBack={() => setWorkflowStep(3)} onNext={() => setWorkflowStep(5)} /> : null}
          {workflowStep === 5 ? <ReviewStep quote={quote} calculations={calculationByLine} readOnly={readOnly} onAddText={() => { setEditingTextId(null); setTextOpen(true); }} onBack={() => setWorkflowStep(4)} onEditLines={() => setWorkflowStep(3)} onSave={() => execute({ type: "changeQuoteStatus", expectedRevision: quote.revision, status: "finalized" }, "Presupuesto guardado como finalizado")} onExport={exportToHolded} /> : null}
        </motion.div>
      </AnimatePresence>

      <AdjustmentDialog open={adjustOpen} onOpenChange={setAdjustOpen} quote={quote} execute={execute} />
      <AddTextDialog open={textOpen} onOpenChange={setTextOpen} editingTextId={editingTextId} quote={quote} templates={templates} execute={execute} />
      <RevisionConflictDialog open={conflict} onOpenChange={setConflict} onReload={() => { setConflict(false); void load(); }} />
      <ToastViewport toasts={toasts} />
    </div>
  );
}

const workflowSteps: Array<{ id: WorkflowStep; label: string; short: string }> = [
  { id: 1, label: "Cliente", short: "Cliente" },
  { id: 2, label: "Preparar datos", short: "Preparar" },
  { id: 3, label: "Conceptos", short: "Conceptos" },
  { id: 4, label: "Precio final", short: "Precio" },
  { id: 5, label: "Revisión", short: "Revisión" },
];

const AI_IMPORT_PROMPT = `Lee las ofertas de proveedor adjuntas y devuelve únicamente un array JSON válido, sin explicaciones ni bloques Markdown.

Cada elemento debe usar esta estructura:
{
  "type": "material",
  "description": "Descripción comercial clara",
  "quantity": "1",
  "unit": "ud",
  "supplier": "Nombre del proveedor",
  "supplierCode": "Referencia",
  "supplierUnitPrice": "100.00",
  "directUnitCost": "76.00",
  "saleUnitPrice": "",
  "igicRate": "7",
  "discounts": ["20", "5"]
}

Reglas: extrae únicamente, no calcules precios ni totales. Nunca inventes un precio de venta; saleUnitPrice solo puede contener un precio de venta explícito autorizado, y queda vacío en ofertas de proveedor. Si falta gross o net, déjalo vacío y conserva los descuentos originales; usa cadenas decimales con punto; conserva los descuentos consecutivos por separado; no inventes importes; usa type "material", "travel" u "other"; si un dato no aparece, déjalo como cadena vacía.`;

function WorkflowSteps({ current, quote, onSelect }: { current: WorkflowStep; quote: QuoteRecord; onSelect: (step: WorkflowStep) => void }) {
  const hasLines = quote.lines.length > 0;
  return <nav className="workflow-steps" aria-label="Progreso del presupuesto"><ol>{workflowSteps.map((step) => {
    const complete = step.id < current || (step.id === 1 && Boolean(quote.clientSnapshot)) || ((step.id === 2 || step.id === 3) && hasLines);
    const disabled = step.id >= 4 && !hasLines;
    return <li key={step.id}><button type="button" data-current={current === step.id} data-complete={complete} aria-current={current === step.id ? "step" : undefined} disabled={disabled} onClick={() => onSelect(step.id)}><span className="workflow-step-number">{complete && current !== step.id ? <Check /> : step.id}</span><span className="workflow-step-copy"><small>Paso {step.id}</small><strong className="workflow-label-full">{step.label}</strong><strong className="workflow-label-short">{step.short}</strong></span></button></li>;
  })}</ol></nav>;
}

function ClientStep({ quote, onNext, execute, disabled }: { quote: QuoteRecord; onNext: () => void; execute: Execute; disabled: boolean }) {
  const client = quote.clientSnapshot;
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void api.searchClients(query).then((items) => { if (active) { setClients(items); setError(""); } }).catch(() => { if (active) setError("No se pudieron buscar los clientes."); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  async function select(clientId: string) {
    if (!clientId) return;
    setBusy(true);
    try { await execute({ type: "selectClient", expectedRevision: quote.revision, clientId }, "Cliente actualizado"); } catch { setError("No se pudo cambiar el cliente."); } finally { setBusy(false); }
  }
  return <section className="guided-card" aria-labelledby="client-step-title"><div className="guided-card-head"><span className="guided-icon"><UserRound /></span><div><p className="eyebrow">Paso 1 de 5</p><h2 id="client-step-title">Confirma el cliente</h2><p>Comprueba que el presupuesto está asociado a la persona o empresa correcta antes de cargar datos.</p></div></div>
    {client ? <div className="client-confirmation"><div><span>Cliente seleccionado</span><strong>{client.name}</strong><p>{[client.taxId, client.email, client.phone, client.address].filter(Boolean).join(" · ") || "Sin datos de contacto adicionales"}</p></div><CheckCircle2 /></div> : <p>Selecciona un cliente para poder enviar el presupuesto a Holded.</p>}
    <label className="field"><span>Seleccionar o cambiar cliente</span><SearchableSelect value={quote.clientId ?? ""} options={clients.map((item) => ({ value: item.id, label: item.name, description: item.taxId ?? item.email ?? "" }))} onQueryChange={setQuery} onChange={(id) => void select(id)} disabled={disabled || busy} allowClear={false} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div className="guided-actions"><Link className="button button-secondary" href="/presupuestos"><ArrowLeft />Volver al listado</Link><RippleButton onClick={onNext}>Continuar a preparación<ArrowRight /></RippleButton></div>
  </section>;
}

function decimalString(value: unknown, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Hay un importe o porcentaje con formato no válido.");
  const normalized = parseDecimalText(value);
  if (normalized === null) throw new Error(`El valor “${String(value)}” no es un decimal válido.`);
  return normalized;
}

function normalizeAiLines(value: unknown): AiLineDraft[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("El resultado debe ser un array con al menos una línea.");
  if (value.length > 100) throw new Error("Revisa la extracción por bloques de 100 líneas como máximo.");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`La línea ${index + 1} no tiene una estructura válida.`);
    const item = raw as Record<string, unknown>;
    const get = (...keys: string[]) => keys.map((key) => item[key]).find((entry) => entry !== undefined);
    const description = String(get("description", "descripcion") ?? "").trim();
    if (!description) throw new Error(`Falta la descripción en la línea ${index + 1}.`);
    const rawType = String(get("type", "tipo") ?? "material").toLowerCase();
    const type: AiLineDraft["type"] = rawType === "travel" || rawType === "desplazamiento" ? "travel" : rawType === "other" || rawType === "otro" ? "other" : "material";
    const rawDiscounts = get("discounts", "descuentos");
    const discountValues = Array.isArray(rawDiscounts) ? rawDiscounts : typeof rawDiscounts === "string" ? rawDiscounts.replaceAll("%", "").split(/[+;,]/) : [];
    const igicRate = decimalString(get("igicRate", "igic"), "7");
    if (!["0", "3", "7", "15"].includes(igicRate)) throw new Error(`El IGIC de la línea ${index + 1} debe ser 0, 3, 7 o 15.`);
    return {
      id: `ai-line-${index + 1}`,
      type,
      description,
      quantity: decimalString(get("quantity", "cantidad"), "1"),
      unit: String(get("unit", "unidad") ?? "ud").trim() || "ud",
      supplier: String(get("supplier", "proveedor") ?? "").trim(),
      supplierCode: String(get("supplierCode", "codigoProveedor", "codigo") ?? "").trim(),
      supplierUnitPrice: decimalString(get("supplierUnitPrice", "pvpProveedor")),
      directUnitCost: decimalString(get("directUnitCost", "costeNeto", "cost")),
      saleUnitPrice: decimalString(get("saleUnitPrice", "precioCliente", "price")),
      igicRate,
      discounts: discountValues.map((entry) => decimalString(entry)).filter(Boolean),
    };
  });
}

function AiImportStep({ readOnly, onImport, onBack, onSkip }: { readOnly: boolean; onImport: (lines: AiLineDraft[]) => Promise<void>; onBack: () => void; onSkip: () => void }) {
  const [json, setJson] = useState("");
  const [lines, setLines] = useState<AiLineDraft[]>([]);
  const [message, setMessage] = useState("Pega el array JSON cuando ChatGPT termine de leer las ofertas.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(AI_IMPORT_PROMPT);
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  function validate() {
    setError("");
    try {
      const clean = json.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const normalized = normalizeAiLines(JSON.parse(clean));
      setLines(normalized); setMessage(`${normalized.length} ${normalized.length === 1 ? "línea preparada" : "líneas preparadas"}. Revisa los datos antes de importar.`);
    } catch (cause) {
      setLines([]); setError(cause instanceof Error ? cause.message : "No se pudo leer el JSON.");
    }
  }

  function updateLine(id: string, key: keyof AiLineDraft, value: string) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  }

  async function importLines() {
    setBusy(true); setError("");
    try { await onImport(lines); }
    catch { setError("No se importó ninguna línea. Revisa los datos incompletos o inválidos y vuelve a intentarlo."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="ai-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 2 de 5</p><h2 id="ai-step-title">Prepara los datos sin perderte</h2><p>La IA extrae; tú confirmas. Nada entra en el presupuesto hasta pulsar “Importar líneas”.</p></div><button type="button" className="button button-ghost" onClick={onSkip}>Prefiero añadir manualmente<ArrowRight /></button></div>
    <div className="ai-preparation-grid">
      <div className="panel instruction-panel"><div className="instruction-item"><span>1</span><div><strong>Abre ChatGPT y sube las ofertas</strong><p>Puedes procesar uno o varios PDF en la misma conversación.</p><a href="https://chatgpt.com" target="_blank" rel="noreferrer">Abrir ChatGPT ↗</a></div></div><div className="instruction-item"><span>2</span><div><strong>Copia estas instrucciones</strong><p>Definen los campos y conservan descuentos, PVP, coste neto e IGIC.</p><RippleButton variant="secondary" size="sm" onClick={() => void copyPrompt()}><ClipboardCopy />{copied ? "Instrucciones copiadas" : "Copiar instrucciones"}</RippleButton></div></div><div className="instruction-item"><span>3</span><div><strong>Pega y valida el resultado</strong><p>Primero verás una tabla editable para compararla con las ofertas.</p></div></div></div>
      <div className="panel ai-json-panel"><label className="field-label" htmlFor="ai-json">Resultado de la IA en JSON</label><textarea id="ai-json" className="textarea ai-json-input" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} placeholder='[{ "type": "material", "description": "..." }]' disabled={readOnly} /><div className="ai-json-footer"><span className={error ? "error-text" : "field-hint"} role={error ? "alert" : undefined}>{error || message}</span><div><button type="button" className="button button-ghost button-sm" disabled={readOnly} onClick={() => { setJson('[\n  {\n    "type": "material",\n    "description": "Unidad interior split 3,5 kW",\n    "quantity": "2",\n    "unit": "ud",\n    "supplier": "Proveedor ejemplo",\n    "supplierCode": "UI-35",\n    "supplierUnitPrice": "420.00",\n    "directUnitCost": "319.20",\n    "saleUnitPrice": "510.00",\n    "igicRate": "7",\n    "discounts": ["20", "5"]\n  }\n]'); setLines([]); setError(""); }}>Usar ejemplo</button><RippleButton size="sm" disabled={readOnly || !json.trim()} onClick={validate}>Revisar extracción</RippleButton></div></div></div>
    </div>
    {lines.length ? <div className="panel ai-review"><div className="ai-review-head"><div><p className="eyebrow">Revisión humana</p><h3>Comprueba las líneas extraídas</h3><p>Corrige descripción, cantidad o importes antes de escribir en el presupuesto.</p></div><span>{lines.length} {lines.length === 1 ? "línea" : "líneas"}</span></div><div className="table-wrap"><table className="data-table ai-review-table"><thead><tr><th>Concepto</th><th>Cant.</th><th>Proveedor</th><th>PVP proveedor</th><th>Coste neto</th><th>Venta / ud.</th><th>IGIC</th><th></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><input className="line-input" aria-label="Descripción" value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} /></td><td><DecimalInput className="line-input" aria-label="Cantidad" value={line.quantity} onValueChange={(value) => updateLine(line.id, "quantity", value)} /></td><td><input className="line-input" aria-label="Proveedor" value={line.supplier} onChange={(event) => updateLine(line.id, "supplier", event.target.value)} /></td><td><DecimalInput className="line-input" aria-label="PVP proveedor" value={line.supplierUnitPrice} onValueChange={(value) => updateLine(line.id, "supplierUnitPrice", value)} /></td><td><DecimalInput className="line-input" aria-label="Coste neto" value={line.directUnitCost} onValueChange={(value) => updateLine(line.id, "directUnitCost", value)} /></td><td><DecimalInput className="line-input" aria-label="Precio cliente" value={line.saleUnitPrice} onValueChange={(value) => updateLine(line.id, "saleUnitPrice", value)} /></td><td><DecimalInput className="line-input" aria-label="IGIC" value={line.igicRate} onValueChange={(value) => updateLine(line.id, "igicRate", value)} /></td><td><button type="button" className="button button-ghost button-icon button-danger" aria-label={`Quitar ${line.description}`} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><Trash2 /></button></td></tr>)}</tbody></table></div><div className="ai-review-actions"><span>La importación usará el motor económico del servidor.</span><RippleButton disabled={busy || lines.some((line) => !line.description.trim())} onClick={() => void importLines()}>{busy ? <LoaderCircle className="spin" /> : <Sparkles />}{busy ? "Importando…" : "Importar líneas"}</RippleButton></div></div> : null}
    <WorkflowFooter backLabel="Cliente" onBack={onBack} nextLabel="Continuar sin importar" onNext={onSkip} />
  </section>;
}

function WorkflowFooter({ backLabel, nextLabel, onBack, onNext, nextDisabled = false }: { backLabel: string; nextLabel: string; onBack: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return <div className="workflow-footer"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft />{backLabel}</button><RippleButton onClick={onNext} disabled={nextDisabled}>{nextLabel}<ArrowRight /></RippleButton></div>;
}

function QuoteSummary({
  quote,
  onAdjust,
  readOnly,
}: {
  quote: QuoteRecord;
  onAdjust: () => void;
  readOnly: boolean;
}) {
  const calculation = quote.calculation;
  const negative = Number(calculation?.profit ?? 0) < 0;

  return (
    <aside className="panel summary" aria-label="Resumen económico">
      <div className="summary-header">
        <h2>Resumen económico</h2>
      </div>

      <div className="summary-body">
        <div className="summary-row">
          <span>Coste</span>
          <strong>{formatMoney(calculation?.cost)}</strong>
        </div>

        <div className="summary-row">
          <span>Venta sin IGIC</span>
          <strong>{formatMoney(calculation?.saleWithoutTax)}</strong>
        </div>

        <div className="summary-row">
          <span>IGIC</span>
          <strong>{formatMoney(calculation?.taxTotal)}</strong>
        </div>

        <div className="summary-divider" />

        <div className="summary-row summary-total">
          <span>Total cliente con IGIC</span>
          <strong>{formatMoney(calculation?.saleWithTax)}</strong>
        </div>

        <div className="summary-divider" />

        <div className={`summary-row summary-profit${negative ? " negative" : ""}`}>
          <span>Beneficio</span>
          <strong>{formatMoney(calculation?.profit)}</strong>
        </div>

        <div className="summary-row">
          <span>Beneficio / coste</span>
          <strong>
            {calculation?.profitOnCostPct
              ? `${formatNumber(calculation.profitOnCostPct)} %`
              : "No disponible"}
          </strong>
        </div>

        <div className="summary-row">
          <span>Margen / venta</span>
          <strong>
            {calculation?.marginOnSalePct
              ? `${formatNumber(calculation.marginOnSalePct)} %`
              : "No disponible"}
          </strong>
        </div>

        {negative ? (
          <div className="notice notice-danger" style={{ marginTop: 10 }}>
            <AlertTriangle />
            <span>
              El presupuesto tiene beneficio negativo. Puedes continuar, pero
              conviene revisarlo.
            </span>
          </div>
        ) : null}

        <RippleButton
          variant="secondary"
          style={{ width: "100%", marginTop: 16 }}
          onClick={onAdjust}
          disabled={readOnly || quote.lines.length === 0}
        >
          <CircleDollarSign />
          Ajustar precio
        </RippleButton>

        <p className="summary-note">
          Todos los importes proceden del cálculo confirmado por el servidor.
        </p>
      </div>
    </aside>
  );
}

function PriceStep({ quote, readOnly, onAdjust, onBack, onNext }: { quote: QuoteRecord; readOnly: boolean; onAdjust: () => void; onBack: () => void; onNext: () => void }) {
  return <section aria-labelledby="price-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 4 de 5</p><h2 id="price-step-title">Confirma el precio final</h2><p>Primero mira el resultado del servidor. Ajusta solo si el importe comercial necesita cambiar.</p></div></div><div className="price-step-grid"><div className="guided-card price-decision"><span className="guided-icon"><CircleDollarSign /></span><h3>¿El precio final te parece bien?</h3><p>Si está correcto, pasa a la revisión del documento. Si quieres modificarlo, el ajuste quedará registrado y el motor recalculará el total.</p><div className="decision-actions"><RippleButton onClick={onNext}>Sí, revisar presupuesto<ArrowRight /></RippleButton><RippleButton variant="secondary" onClick={onAdjust} disabled={readOnly}><Settings2 />Quiero ajustar el precio</RippleButton></div><div className="notice"><CheckCircle2 /><span>Todos los importes de este paso proceden del último cálculo confirmado por el backend.</span></div></div><QuoteSummary quote={quote} onAdjust={onAdjust} readOnly={readOnly} /></div><WorkflowFooter backLabel="Conceptos" onBack={onBack} nextLabel="Revisar documento" onNext={onNext} /></section>;
}

function ReviewStep({ quote, calculations, readOnly, onAddText, onBack, onEditLines, onSave, onExport }: { quote: QuoteRecord; calculations: Map<string, CalculatedLine>; readOnly: boolean; onAddText: () => void; onBack: () => void; onEditLines: () => void; onSave: () => Promise<QuoteRecord>; onExport: () => Promise<void> }) {
  const [action, setAction] = useState<"save" | "holded" | null>(null);
  const [view, setView] = useState<"client" | "internal">("client");
  async function run(kind: "save" | "holded") { setAction(kind); try { if (kind === "save") await onSave(); else await onExport(); } catch { /* La acción ya muestra un mensaje contextual. */ } finally { setAction(null); } }
  return <section aria-labelledby="review-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 5 de 5</p><h2 id="review-step-title">{view === "client" ? "Revisa lo que verá el cliente" : "Revisa el resultado interno"}</h2><p>{view === "client" ? "La vista comercial no incluye costes, empleados, beneficios ni reglas internas." : "Solo para Index Clima: coste, venta, beneficio y margen calculados por el servidor."}</p></div><RippleButton variant="secondary" onClick={onAddText} disabled={readOnly}><Plus />Añadir condiciones</RippleButton></div><div className="review-view-switch" role="tablist" aria-label="Vista del presupuesto"><button type="button" role="tab" aria-selected={view === "client"} data-active={view === "client" || undefined} onClick={() => setView("client")}><Eye />Cliente</button><button type="button" role="tab" aria-selected={view === "internal"} data-active={view === "internal" || undefined} onClick={() => setView("internal")}><ChartColumn />Interna</button></div><div className="review-layout"><div className="review-canvas">{view === "client" ? <ReviewDocument quote={quote} calculations={calculations} /> : <InternalReview quote={quote} calculations={calculations} onEditLines={onEditLines} />}</div><aside className="panel review-checklist"><h3>Comprobación final</h3><ul><li data-done={Boolean(quote.clientSnapshot)}><CheckCircle2 />Cliente identificado</li><li data-done={quote.lines.length > 0}><CheckCircle2 />{quote.lines.length} {quote.lines.length === 1 ? "concepto revisado" : "conceptos revisados"}</li><li data-done={Boolean(quote.calculation)}><CheckCircle2 />Precio calculado por el servidor</li><li data-done={Boolean(quote.texts?.length)}><CheckCircle2 />Condiciones y textos</li></ul><div className="summary-divider" /><p className="summary-section-label">Resultado interno</p><div className="summary-row"><span>Coste total</span><strong className="summary-cost">{formatMoney(quote.calculation?.cost)}</strong></div><div className="summary-row"><span>Venta sin IGIC</span><strong>{formatMoney(quote.calculation?.saleWithoutTax)}</strong></div><div className="summary-row"><span>Beneficio</span><strong className={String(quote.calculation?.profit ?? "").startsWith("-") ? "summary-loss" : "summary-profit"}>{formatMoney(quote.calculation?.profit)}</strong></div><div className="summary-row"><span>Margen</span><strong>{formatPercentage(quote.calculation?.marginOnSalePct ?? null)}</strong></div><div className="summary-divider" /><p className="summary-section-label">Cliente</p><div className="summary-row"><span>Total sin IGIC</span><strong>{formatMoney(quote.calculation?.saleWithoutTax)}</strong></div><div className="summary-row"><span>IGIC</span><strong>{formatMoney(quote.calculation?.taxTotal)}</strong></div><div className="summary-row summary-total"><span>Total cliente con IGIC</span><strong>{formatMoney(quote.calculation?.saleWithTax)}</strong></div><p className="field-hint">Se enviará a Holded con impuestos incluidos.</p>{quote.holdedEstimateId ? <div className="notice" style={{ marginTop: 14 }}><CheckCircle2 /><span>Vinculado con Holded. La próxima importación actualizará el mismo presupuesto.</span></div> : null}</aside></div><div className="workflow-footer workflow-footer-final"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft />Precio final</button><div className="final-actions"><RippleButton variant="secondary" disabled={readOnly || Boolean(action) || !quote.calculation} onClick={() => void run("save")}>{action === "save" ? <LoaderCircle className="spin" /> : <Check />}{action === "save" ? "Guardando…" : "Guardar"}</RippleButton><RippleButton disabled={readOnly || Boolean(action) || !quote.calculation} onClick={() => void run("holded")}>{action === "holded" ? <LoaderCircle className="spin" /> : <CloudUpload />}{action === "holded" ? "Importando…" : quote.holdedEstimateId ? "Guardar y actualizar en Holded" : "Guardar e importar en Holded"}</RippleButton></div></div></section>;
}

function QuoteStatusControl({ quote, disabled, onChange }: { quote: QuoteRecord; disabled: boolean; onChange: (status: Exclude<QuoteStatus, "archived">) => Promise<QuoteRecord> }) {
  const [busy, setBusy] = useState(false);
  if (quote.status === "archived") return <StatusBadge status={quote.status} />;
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="status-control" disabled={disabled || busy} aria-label={`Cambiar estado. Estado actual: ${statusLabel(quote.status)}`}><StatusBadge status={quote.status} /><ChevronRight /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content status-menu" align="start" sideOffset={5}>{(["draft", "ready_for_review", "finalized"] as const).map((status) => <DropdownMenu.Item className="dropdown-item" key={status} disabled={busy || status === quote.status} onSelect={() => { setBusy(true); void onChange(status).finally(() => setBusy(false)); }}><StatusBadge status={status} /><span><strong>{statusLabel(status)}</strong><small>{status === "draft" ? "Editable y en preparación" : status === "ready_for_review" ? "Pendiente de comprobación" : "Guardado como terminado"}</small></span>{status === quote.status ? <Check /> : null}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

function statusLabel(status: QuoteStatus) {
  return status === "draft" ? "Borrador" : status === "ready_for_review" ? "Por revisar" : status === "finalized" ? "Finalizado" : "Archivado";
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return <span className="save-status">{state === "saving" ? <LoaderCircle className="spin" /> : state === "saved" ? <Check /> : <AlertTriangle />} {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : "Error al guardar"}</span>;
}

function AddTextDialog({ open, onOpenChange, editingTextId, quote, templates, execute }: { open: boolean; onOpenChange: (open: boolean) => void; editingTextId: string | null; quote: QuoteRecord; templates: TextTemplateRecord[]; execute: Execute }) {
  const [templateId, setTemplateId] = useState(""); const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { const text = quote.texts?.find((item) => item.id === editingTextId); setTemplateId(""); setTitle(text?.title ?? ""); setBody(text?.body ?? ""); } }, [open, editingTextId]);
  function choose(id: string) { setTemplateId(id); const template = templates.find((item) => item.id === id); if (template) { setTitle(template.title); setBody(template.body); } }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await execute(editingTextId ? { type: "updateQuoteText", expectedRevision: quote.revision, textId: editingTextId, title, body } : { type: "addQuoteText", expectedRevision: quote.revision, title, body }, editingTextId ? "Texto actualizado" : "Texto añadido"); onOpenChange(false); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title={editingTextId ? "Editar texto" : "Añadir texto"} description="Parte de una plantilla o escribe un bloque exclusivo para este presupuesto." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="add-text-form" disabled={busy || !body.trim()}>{busy ? "Guardando…" : editingTextId ? "Guardar texto" : "Añadir texto"}</RippleButton></>}><form id="add-text-form" onSubmit={submit} className="form-grid"><div className="field span-2"><label className="field-label" htmlFor="quote-text-template">Plantilla (opcional)</label><SearchableSelect id="quote-text-template" value={templateId} onChange={choose} placeholder="Buscar una plantilla…" clearLabel="Escribir texto libre" options={templates.filter((item) => item.active).map((item) => ({ value: item.id, label: item.title, description: item.body.slice(0, 90) }))} /></div><div className="field span-2"><label className="field-label" htmlFor="quote-text-title">Título</label><input id="quote-text-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="field span-2"><label className="field-label" htmlFor="quote-text-body">Contenido</label><textarea id="quote-text-body" className="textarea" value={body} onChange={(event) => setBody(event.target.value)} required /></div></form></DialogContent></Dialog>;
}

async function reorderTexts(quote: QuoteRecord, textId: string, direction: -1 | 1, execute: Execute) {
  if (!quote.texts) return; const index = quote.texts.findIndex((item) => item.id === textId); const target = index + direction; if (target < 0 || target >= quote.texts.length) return; const ordered = [...quote.texts]; [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]; await execute({ type: "reorderQuoteTexts", expectedRevision: quote.revision, orderedTextIds: ordered.map((item) => item.id) }, "Textos reordenados");
}

function DraggableTextBlocks({ quote, execute, onEdit, onReorder }: { quote: QuoteRecord; execute: Execute; onEdit: (textId: string) => void; onReorder: (texts: NonNullable<QuoteRecord["texts"]>) => void }) {
  const ordered = quote.texts ?? [];
  const orderedRef = useRef(ordered);
  const changedRef = useRef(false);
  orderedRef.current = ordered;
  return <Reorder.Group axis="y" values={ordered} onReorder={(next) => { if (next.some((item, i) => item.id !== orderedRef.current[i]?.id)) changedRef.current = true; orderedRef.current = next; onReorder(next); }} className="text-blocks" as="div">
    {ordered.map((text, index) => <SortableTextBlock key={text.id} text={text} index={index} count={ordered.length} quote={quote} execute={execute} onEdit={() => onEdit(text.id)} onDragEnd={() => {
      const ids = orderedRef.current.map((item) => item.id);
      if (changedRef.current) { changedRef.current = false; void execute({ type: "reorderQuoteTexts", expectedRevision: quote.revision, orderedTextIds: ids }, "Textos reordenados"); }
    }} />)}
  </Reorder.Group>;
}

function SortableTextBlock({ text, index, count, quote, execute, onEdit, onDragEnd }: { text: NonNullable<QuoteRecord["texts"]>[number]; index: number; count: number; quote: QuoteRecord; execute: Execute; onEdit: () => void; onDragEnd: () => void }) {
  const controls = useDragControls();
  return <Reorder.Item value={text} className="text-block" dragListener={false} dragControls={controls} onDragEnd={onDragEnd}>
    <button type="button" className="text-block-drag-handle" aria-label={`Reordenar ${text.title || "texto"}`} title="Arrastra para ordenar" onPointerDown={(event) => controls.start(event)}><GripVertical /></button>
    <div><h3>{text.title || "Sin título"}</h3><p>{text.body}</p></div>
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="button button-ghost button-icon" aria-label="Acciones del texto"><MoreHorizontal /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end"><DropdownMenu.Item className="dropdown-item" onSelect={onEdit}><PencilLine />Editar</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={index === 0} onSelect={() => void reorderTexts(quote, text.id, -1, execute)}><ArrowUp />Subir</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={index === count - 1} onSelect={() => void reorderTexts(quote, text.id, 1, execute)}><ArrowDown />Bajar</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item danger" onSelect={() => void execute({ type: "removeQuoteText", expectedRevision: quote.revision, textId: text.id }, "Texto eliminado")}><Trash2 />Eliminar</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
  </Reorder.Item>;
}

function EditorSkeleton() {
  return <div className="page"><div className="skeleton" style={{ height: 24, width: 180, marginBottom: 18 }} /><div className="skeleton" style={{ height: 44, width: "45%", marginBottom: 30 }} /><div className="editor-grid"><div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>{Array.from({ length: 5 }, (_, index) => <div className="skeleton" key={index} style={{ height: 72 }} />)}</div><div className="panel" style={{ padding: 18 }}><div className="skeleton" style={{ height: 260 }} /></div></div></div>;
}
