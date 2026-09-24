"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ReviewDocument } from "./review-document";
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  BriefcaseBusiness,
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
  Package,
  PencilLine,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { QuoteCommand } from "@quotes/contracts";
import { Dialog, DialogClose, DialogContent, Sheet, SheetClose, SheetContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { OriginBadge, StatusBadge } from "../ui/badges";
import { ErrorState, RevisionConflictDialog, ToastViewport, useToasts } from "../ui/feedback";
import { SearchableSelect } from "../ui/searchable-select";
import { api, ApiError } from "../../lib/api/client";
import type {
  CalculatedLine,
  EmployeeRecord,
  LineType,
  MaterialRecord,
  QuoteLine,
  QuoteRecord,
  QuoteStatus,
  TextTemplateRecord,
  TravelRecord,
} from "../../lib/api/types";
import { formatMoney, formatNumber } from "../../lib/format";

type SaveState = "idle" | "saving" | "saved" | "error";
type WorkflowStep = 1 | 2 | 3 | 4 | 5;

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

const lineLabels: Record<LineType, string> = {
  material: "Material",
  labor: "Mano de obra",
  travel: "Desplazamiento",
  other: "Otro",
  adjustment: "Ajuste",
  title: "Título",
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
  const [addType, setAddType] = useState<LineType | null>(null);
  const [advancedLine, setAdvancedLine] = useState<QuoteLine | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
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
  useEffect(() => {
    if (advancedLine && quote) setAdvancedLine(quote.lines.find((line) => line.id === advancedLine.id) ?? null);
  }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const readOnly = quote?.accessMode === "read_only" || quote?.status === "archived";
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
    setAdvancedLine(null);
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
      else if (cause instanceof ApiError && cause.code === "holded_not_configured") push("Configura FEATURE_HOLDED y HOLDED_API_KEY en el servidor para importar", "error");
      else push("Holded no pudo guardar el presupuesto. El estado local no ha cambiado.", "error");
      throw cause;
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
    let current = quote;
    for (const draft of lines) {
      const previousIds = new Set(current.lines.map((line) => line.id));
      const common = {
        expectedRevision: current.revision,
        description: draft.description,
        saleRule: "unit_price" as const,
        saleRuleValue: draft.saleUnitPrice || "0",
        quantity: draft.quantity || "1",
        igicRate: draft.igicRate || "7",
      };
      if (draft.type === "material") {
        current = await execute({
          type: "addMaterialLine",
          ...common,
          ...(draft.directUnitCost ? { directUnitCost: draft.directUnitCost } : {}),
          ...(draft.supplierUnitPrice ? { supplierUnitPrice: draft.supplierUnitPrice } : {}),
          ...(draft.saleUnitPrice ? { baseUnitPrice: draft.saleUnitPrice } : {}),
        });
      } else if (draft.type === "travel") current = await execute({ type: "addTravelLine", ...common });
      else current = await execute({ type: "addOtherLine", ...common });

      const created = current.lines.find((line) => !previousIds.has(line.id));
      if (!created) throw new Error("imported_line_not_found");
      const changes: Record<string, unknown> = { unit: draft.unit || "ud" };
      if (draft.directUnitCost) changes.directUnitCost = draft.directUnitCost;
      if (draft.supplierUnitPrice) changes.supplierUnitPrice = draft.supplierUnitPrice;
      if (draft.supplier) changes.supplierNameSnapshot = draft.supplier;
      if (draft.supplierCode) changes.supplierCodeSnapshot = draft.supplierCode;
      if (Object.keys(changes).length) current = await execute({ type: "updateQuoteLine", expectedRevision: current.revision, lineId: created.id, changes });
      if (draft.type === "material") {
        for (const percentage of draft.discounts) current = await execute({ type: "addSupplierDiscount", expectedRevision: current.revision, quoteLineId: created.id, percentage });
      }
    }
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
          <div><span className="quote-reference">{quote.reference}</span><h1 className="editor-title">{quote.title}</h1><div className="editor-meta"><span>{quote.clientSnapshot?.name ?? "Sin cliente"}</span><span>·</span><QuoteStatusControl quote={quote} disabled={readOnly} onChange={(status) => execute({ type: "changeQuoteStatus", expectedRevision: quote.revision, status }, `Estado cambiado a ${statusLabel(status).toLowerCase()}`)} /><OriginBadge origin={quote.origin} />{quote.holdedEstimateId ? <span className="badge badge-origin">En Holded</span> : null}{readOnly ? <span className="badge badge-readonly">Solo lectura</span> : null}<SaveIndicator state={saveState} /></div></div>
          <div className="header-actions"><RippleButton variant="secondary" onClick={() => setWorkflowStep(5)}><Eye />Revisión</RippleButton><RippleButton variant="secondary" onClick={() => setWorkflowStep(4)} disabled={quote.lines.length === 0}><CircleDollarSign />Precio final</RippleButton></div>
        </div>
      </div>
      {quote.accessMode === "read_only" ? <div className="notice notice-warning" style={{ marginBottom: 16 }}><AlertTriangle /><span><strong>Generado desde Holded.</strong> Este presupuesto es de solo lectura. Duplícalo desde el listado para crear una versión editable.</span></div> : null}
      {quote.status === "archived" ? <div className="notice notice-warning" style={{ marginBottom: 16 }}><AlertTriangle /><span>Este presupuesto está archivado y no admite cambios.</span></div> : null}
      <WorkflowSteps current={workflowStep} quote={quote} onSelect={setWorkflowStep} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={workflowStep} className="workflow-stage" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -5 }} transition={{ duration: reduceMotion ? 0 : .2 }}>
          {workflowStep === 1 ? <ClientStep quote={quote} onNext={() => setWorkflowStep(2)} /> : null}
          {workflowStep === 2 ? <AiImportStep readOnly={readOnly} onImport={importAiLines} onBack={() => setWorkflowStep(1)} onSkip={() => setWorkflowStep(3)} /> : null}
          {workflowStep === 3 ? <><div className="stage-heading"><div><p className="eyebrow">Paso 3 de 5</p><h2>Construye los conceptos</h2><p>Añade lo habitual con formularios breves. Los detalles avanzados siguen disponibles cuando los necesites.</p></div><RippleButton variant="secondary" onClick={() => setWorkflowStep(2)}><Bot />Añadir oferta con IA</RippleButton></div><div className="editor-grid">
        <div>
          <section className="panel workspace-panel" aria-labelledby="quote-lines-title">
            <div className="workspace-toolbar"><h2 id="quote-lines-title">Líneas del presupuesto <span style={{ color: "var(--foreground-soft)", fontWeight: 500 }}>· {quote.lines.length}</span></h2>
              <div className="add-line-actions">
                <RippleButton variant="secondary" size="sm" disabled={readOnly} onClick={() => setAddType("material")}><Package />Material</RippleButton>
                <RippleButton variant="secondary" size="sm" disabled={readOnly} onClick={() => setAddType("labor")}><BriefcaseBusiness />Mano de obra</RippleButton>
                <RippleButton variant="secondary" size="sm" disabled={readOnly} onClick={() => setAddType("travel")}><Truck />Desplazamiento</RippleButton>
                <RippleButton variant="ghost" size="sm" disabled={readOnly} onClick={() => setAddType("other")}><Plus />Otro</RippleButton>
              </div>
            </div>
            {quote.lines.length ? (
              <Reorder.Group axis="y" values={quote.lines} onReorder={(ordered) => { if (!readOnly) setQuote({ ...quote, lines: ordered }); }} className="quote-lines" style={{ listStyle: "none", margin: 0 }}>
                {quote.lines.map((line, index) => <QuoteLineRow key={line.id} line={line} calculation={calculationByLine.get(line.id)} readOnly={readOnly} onCommit={(changes) => void updateLine(line, changes)} onAdvanced={() => setAdvancedLine(line)} onDelete={() => void deleteLine(line)} onMove={(direction) => moveLine(line, direction)} onDragEnd={() => void reorderLines(quote.lines)} first={index === 0} last={index === quote.lines.length - 1} />)}
              </Reorder.Group>
            ) : <div className="lines-empty"><div><Wrench /><div><strong>Añade el primer concepto</strong><br /><span>Material, mano de obra, desplazamiento u otro.</span></div></div></div>}
          </section>
          <section className="panel texts-section">
            <div className="section-heading"><h2>Textos del presupuesto</h2><RippleButton variant="ghost" size="sm" disabled={readOnly} onClick={() => setTextOpen(true)}><Plus />Añadir texto</RippleButton></div>
            {quote.texts?.length ? <div className="text-blocks">{quote.texts.map((text, index) => <div className="text-block" key={text.id}><GripVertical style={{ width: 16, color: "var(--foreground-soft)", marginTop: 2 }} /><div><h3>{text.title || "Sin título"}</h3><p>{text.body}</p></div><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="button button-ghost button-icon" aria-label="Acciones del texto"><MoreHorizontal /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end"><DropdownMenu.Item className="dropdown-item" disabled={index === 0} onSelect={() => void reorderTexts(quote, text.id, -1, execute)}><ArrowUp />Subir</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={index === (quote.texts?.length ?? 0) - 1} onSelect={() => void reorderTexts(quote, text.id, 1, execute)}><ArrowDown />Bajar</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item danger" onSelect={() => void execute({ type: "removeQuoteText", expectedRevision: quote.revision, textId: text.id }, "Texto eliminado")}><Trash2 />Eliminar</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>)}</div> : <div style={{ padding: 20, color: "var(--foreground-muted)", fontSize: 12 }}>Añade condiciones, garantías o protección de datos para incluirlos en la revisión.</div>}
          </section>
        </div>
        <QuoteSummary quote={quote} onAdjust={() => setAdjustOpen(true)} readOnly={readOnly} />
      </div><WorkflowFooter backLabel="Preparación" onBack={() => setWorkflowStep(2)} nextLabel="Revisar precio final" onNext={() => setWorkflowStep(4)} nextDisabled={quote.lines.length === 0} /></> : null}
          {workflowStep === 4 ? <PriceStep quote={quote} readOnly={readOnly} onAdjust={() => setAdjustOpen(true)} onBack={() => setWorkflowStep(3)} onNext={() => setWorkflowStep(5)} /> : null}
          {workflowStep === 5 ? <ReviewStep quote={quote} calculations={calculationByLine} readOnly={readOnly} onAddText={() => setTextOpen(true)} onBack={() => setWorkflowStep(4)} onSave={() => execute({ type: "changeQuoteStatus", expectedRevision: quote.revision, status: "finalized" }, "Presupuesto guardado como finalizado")} onExport={exportToHolded} /> : null}
        </motion.div>
      </AnimatePresence>

      <AddLineSheet open={Boolean(addType)} onOpenChange={(open) => { if (!open) setAddType(null); }} type={addType ?? "other"} quote={quote} materials={materials} employees={employees} travels={travels} execute={execute} refreshQuote={refreshQuote} />
      <AdvancedLineSheet line={advancedLine} quote={quote} calculation={advancedLine ? calculationByLine.get(advancedLine.id) : undefined} employees={employees} open={Boolean(advancedLine)} onOpenChange={(open) => { if (!open) setAdvancedLine(null); }} execute={execute} readOnly={readOnly} />
      <AdjustmentDialog open={adjustOpen} onOpenChange={setAdjustOpen} quote={quote} execute={execute} />
      <AddTextDialog open={textOpen} onOpenChange={setTextOpen} quote={quote} templates={templates} execute={execute} />
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
  "directUnitCost": "80.00",
  "saleUnitPrice": "120.00",
  "igicRate": "7",
  "discounts": ["20", "5"]
}

Reglas: usa cadenas decimales con punto; conserva los descuentos consecutivos por separado; no inventes importes; usa type "material", "travel" u "other"; si un dato no aparece, déjalo como cadena vacía.`;

function WorkflowSteps({ current, quote, onSelect }: { current: WorkflowStep; quote: QuoteRecord; onSelect: (step: WorkflowStep) => void }) {
  const hasLines = quote.lines.length > 0;
  return <nav className="workflow-steps" aria-label="Progreso del presupuesto"><ol>{workflowSteps.map((step) => {
    const complete = step.id < current || (step.id === 1 && Boolean(quote.clientSnapshot)) || ((step.id === 2 || step.id === 3) && hasLines);
    const disabled = step.id >= 4 && !hasLines;
    return <li key={step.id}><button type="button" data-current={current === step.id} data-complete={complete} aria-current={current === step.id ? "step" : undefined} disabled={disabled} onClick={() => onSelect(step.id)}><span className="workflow-step-number">{complete && current !== step.id ? <Check /> : step.id}</span><span className="workflow-step-copy"><small>Paso {step.id}</small><strong className="workflow-label-full">{step.label}</strong><strong className="workflow-label-short">{step.short}</strong></span></button></li>;
  })}</ol></nav>;
}

function ClientStep({ quote, onNext }: { quote: QuoteRecord; onNext: () => void }) {
  const client = quote.clientSnapshot;
  return <section className="guided-card" aria-labelledby="client-step-title"><div className="guided-card-head"><span className="guided-icon"><UserRound /></span><div><p className="eyebrow">Paso 1 de 5</p><h2 id="client-step-title">Confirma el cliente</h2><p>Comprueba que el presupuesto está asociado a la persona o empresa correcta antes de cargar datos.</p></div></div>
    {client ? <div className="client-confirmation"><div><span>Cliente seleccionado</span><strong>{client.name}</strong><p>{[client.taxId, client.email, client.phone, client.address].filter(Boolean).join(" · ") || "Sin datos de contacto adicionales"}</p></div><CheckCircle2 /></div> : <div className="notice notice-warning"><AlertTriangle /><span><strong>Este presupuesto no tiene cliente.</strong> El contrato actual no permite cambiarlo después de crear el presupuesto. Crea uno nuevo desde el listado para completar el recorrido.</span></div>}
    <div className="guided-actions"><Link className="button button-secondary" href="/presupuestos"><ArrowLeft />Volver al listado</Link><RippleButton onClick={onNext}>Continuar a preparación<ArrowRight /></RippleButton></div>
  </section>;
}

function decimalString(value: unknown, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Hay un importe o porcentaje con formato no válido.");
  const normalized = String(value).trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`El valor “${String(value)}” no es un decimal válido.`);
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
    const discountValues = Array.isArray(rawDiscounts) ? rawDiscounts : typeof rawDiscounts === "string" ? rawDiscounts.split(",") : [];
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
      saleUnitPrice: decimalString(get("saleUnitPrice", "precioCliente", "price"), "0"),
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
    catch { setError("La importación se detuvo. Revisa el presupuesto antes de volver a intentarlo para evitar duplicados."); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="ai-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 2 de 5</p><h2 id="ai-step-title">Prepara los datos sin perderte</h2><p>La IA extrae; tú confirmas. Nada entra en el presupuesto hasta pulsar “Importar líneas”.</p></div><button type="button" className="button button-ghost" onClick={onSkip}>Prefiero añadir manualmente<ArrowRight /></button></div>
    <div className="ai-preparation-grid">
      <div className="panel instruction-panel"><div className="instruction-item"><span>1</span><div><strong>Abre ChatGPT y sube las ofertas</strong><p>Puedes procesar uno o varios PDF en la misma conversación.</p><a href="https://chatgpt.com" target="_blank" rel="noreferrer">Abrir ChatGPT ↗</a></div></div><div className="instruction-item"><span>2</span><div><strong>Copia estas instrucciones</strong><p>Definen los campos y conservan descuentos, PVP, coste neto e IGIC.</p><RippleButton variant="secondary" size="sm" onClick={() => void copyPrompt()}><ClipboardCopy />{copied ? "Instrucciones copiadas" : "Copiar instrucciones"}</RippleButton></div></div><div className="instruction-item"><span>3</span><div><strong>Pega y valida el resultado</strong><p>Primero verás una tabla editable para compararla con las ofertas.</p></div></div></div>
      <div className="panel ai-json-panel"><label className="field-label" htmlFor="ai-json">Resultado de la IA en JSON</label><textarea id="ai-json" className="textarea ai-json-input" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} placeholder='[{ "type": "material", "description": "..." }]' disabled={readOnly} /><div className="ai-json-footer"><span className={error ? "error-text" : "field-hint"} role={error ? "alert" : undefined}>{error || message}</span><div><button type="button" className="button button-ghost button-sm" disabled={readOnly} onClick={() => { setJson('[\n  {\n    "type": "material",\n    "description": "Unidad interior split 3,5 kW",\n    "quantity": "2",\n    "unit": "ud",\n    "supplier": "Proveedor ejemplo",\n    "supplierCode": "UI-35",\n    "supplierUnitPrice": "420.00",\n    "directUnitCost": "319.20",\n    "saleUnitPrice": "510.00",\n    "igicRate": "7",\n    "discounts": ["20", "5"]\n  }\n]'); setLines([]); setError(""); }}>Usar ejemplo</button><RippleButton size="sm" disabled={readOnly || !json.trim()} onClick={validate}>Revisar extracción</RippleButton></div></div></div>
    </div>
    {lines.length ? <div className="panel ai-review"><div className="ai-review-head"><div><p className="eyebrow">Revisión humana</p><h3>Comprueba las líneas extraídas</h3><p>Corrige descripción, cantidad o importes antes de escribir en el presupuesto.</p></div><span>{lines.length} {lines.length === 1 ? "línea" : "líneas"}</span></div><div className="table-wrap"><table className="data-table ai-review-table"><thead><tr><th>Concepto</th><th>Cant.</th><th>Proveedor</th><th>PVP proveedor</th><th>Coste neto</th><th>Venta / ud.</th><th>IGIC</th><th></th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><input className="line-input" aria-label="Descripción" value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} /></td><td><input className="line-input" aria-label="Cantidad" value={line.quantity} onChange={(event) => updateLine(line.id, "quantity", event.target.value)} /></td><td><input className="line-input" aria-label="Proveedor" value={line.supplier} onChange={(event) => updateLine(line.id, "supplier", event.target.value)} /></td><td><input className="line-input" aria-label="PVP proveedor" value={line.supplierUnitPrice} onChange={(event) => updateLine(line.id, "supplierUnitPrice", event.target.value)} /></td><td><input className="line-input" aria-label="Coste neto" value={line.directUnitCost} onChange={(event) => updateLine(line.id, "directUnitCost", event.target.value)} /></td><td><input className="line-input" aria-label="Precio cliente" value={line.saleUnitPrice} onChange={(event) => updateLine(line.id, "saleUnitPrice", event.target.value)} /></td><td><input className="line-input" aria-label="IGIC" value={line.igicRate} onChange={(event) => updateLine(line.id, "igicRate", event.target.value)} /></td><td><button type="button" className="button button-ghost button-icon button-danger" aria-label={`Quitar ${line.description}`} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><Trash2 /></button></td></tr>)}</tbody></table></div><div className="ai-review-actions"><span>La importación usará el motor económico del servidor.</span><RippleButton disabled={busy || lines.some((line) => !line.description.trim())} onClick={() => void importLines()}>{busy ? <LoaderCircle className="spin" /> : <Sparkles />}{busy ? "Importando…" : "Importar líneas"}</RippleButton></div></div> : null}
    <WorkflowFooter backLabel="Cliente" onBack={onBack} nextLabel="Continuar sin importar" onNext={onSkip} />
  </section>;
}

function WorkflowFooter({ backLabel, nextLabel, onBack, onNext, nextDisabled = false }: { backLabel: string; nextLabel: string; onBack: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return <div className="workflow-footer"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft />{backLabel}</button><RippleButton onClick={onNext} disabled={nextDisabled}>{nextLabel}<ArrowRight /></RippleButton></div>;
}

function PriceStep({ quote, readOnly, onAdjust, onBack, onNext }: { quote: QuoteRecord; readOnly: boolean; onAdjust: () => void; onBack: () => void; onNext: () => void }) {
  return <section aria-labelledby="price-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 4 de 5</p><h2 id="price-step-title">Confirma el precio final</h2><p>Primero mira el resultado del servidor. Ajusta solo si el importe comercial necesita cambiar.</p></div></div><div className="price-step-grid"><div className="guided-card price-decision"><span className="guided-icon"><CircleDollarSign /></span><h3>¿El precio final te parece bien?</h3><p>Si está correcto, pasa a la revisión del documento. Si quieres modificarlo, el ajuste quedará registrado y el motor recalculará el total.</p><div className="decision-actions"><RippleButton onClick={onNext}>Sí, revisar presupuesto<ArrowRight /></RippleButton><RippleButton variant="secondary" onClick={onAdjust} disabled={readOnly}><Settings2 />Quiero ajustar el precio</RippleButton></div><div className="notice"><CheckCircle2 /><span>Todos los importes de este paso proceden del último cálculo confirmado por el backend.</span></div></div><QuoteSummary quote={quote} onAdjust={onAdjust} readOnly={readOnly} /></div><WorkflowFooter backLabel="Conceptos" onBack={onBack} nextLabel="Revisar documento" onNext={onNext} /></section>;
}

function ReviewStep({ quote, calculations, readOnly, onAddText, onBack, onSave, onExport }: { quote: QuoteRecord; calculations: Map<string, CalculatedLine>; readOnly: boolean; onAddText: () => void; onBack: () => void; onSave: () => Promise<QuoteRecord>; onExport: () => Promise<void> }) {
  const [action, setAction] = useState<"save" | "holded" | null>(null);
  async function run(kind: "save" | "holded") { setAction(kind); try { if (kind === "save") await onSave(); else await onExport(); } catch { /* La acción ya muestra un mensaje contextual. */ } finally { setAction(null); } }
  return <section aria-labelledby="review-step-title"><div className="stage-heading"><div><p className="eyebrow">Paso 5 de 5</p><h2 id="review-step-title">Revisa lo que verá el cliente</h2><p>La vista comercial no incluye costes, empleados, beneficios ni reglas internas.</p></div><RippleButton variant="secondary" onClick={onAddText} disabled={readOnly}><Plus />Añadir condiciones</RippleButton></div><div className="review-layout"><div className="review-canvas"><ReviewDocument quote={quote} calculations={calculations} /></div><aside className="panel review-checklist"><h3>Comprobación final</h3><ul><li data-done={Boolean(quote.clientSnapshot)}><CheckCircle2 />Cliente identificado</li><li data-done={quote.lines.length > 0}><CheckCircle2 />{quote.lines.length} {quote.lines.length === 1 ? "concepto revisado" : "conceptos revisados"}</li><li data-done={Boolean(quote.calculation)}><CheckCircle2 />Precio calculado por el servidor</li><li data-done={Boolean(quote.texts?.length)}><CheckCircle2 />Condiciones y textos</li></ul><div className="summary-divider" /><div className="summary-row summary-total"><span>Total cliente</span><strong>{formatMoney(quote.calculation?.saleWithTax)}</strong></div>{quote.holdedEstimateId ? <div className="notice" style={{ marginTop: 14 }}><CheckCircle2 /><span>Vinculado con Holded. La próxima importación actualizará el mismo presupuesto.</span></div> : null}</aside></div><div className="workflow-footer workflow-footer-final"><button type="button" className="button button-ghost" onClick={onBack}><ArrowLeft />Precio final</button><div className="final-actions"><RippleButton variant="secondary" disabled={readOnly || Boolean(action) || !quote.calculation} onClick={() => void run("save")}>{action === "save" ? <LoaderCircle className="spin" /> : <Check />}{action === "save" ? "Guardando…" : "Guardar"}</RippleButton><RippleButton disabled={readOnly || Boolean(action) || !quote.calculation} onClick={() => void run("holded")}>{action === "holded" ? <LoaderCircle className="spin" /> : <CloudUpload />}{action === "holded" ? "Importando…" : quote.holdedEstimateId ? "Guardar y actualizar en Holded" : "Guardar e importar en Holded"}</RippleButton></div></div></section>;
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

function QuoteLineRow({ line, calculation, readOnly, onCommit, onAdvanced, onDelete, onMove, onDragEnd, first, last }: { line: QuoteLine; calculation: CalculatedLine | undefined; readOnly: boolean; onCommit: (changes: Record<string, unknown>) => void; onAdvanced: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void; onDragEnd: () => void; first: boolean; last: boolean }) {
  const dragControls = useDragControls();
  const [description, setDescription] = useState(line.description);
  const [quantity, setQuantity] = useState(editableDecimal(line.quantity));
  const [price, setPrice] = useState(editableDecimal(line.saleRuleValue));
  const [igic, setIgic] = useState(normalizedRate(line.igicRate));
  useEffect(() => { setDescription(line.description); setQuantity(editableDecimal(line.quantity)); setPrice(editableDecimal(line.saleRuleValue)); setIgic(normalizedRate(line.igicRate)); }, [line]);
  const commit = (key: string, value: string, original: string) => { if (!readOnly && value !== original) onCommit({ [key]: value }); };
  return (
    <Reorder.Item value={line} as="li" className="quote-line" layout dragListener={false} dragControls={dragControls} transition={{ type: "spring", stiffness: 420, damping: 38 }}>
      <button className="drag-handle" disabled={readOnly} aria-label={`Reordenar ${line.description}`} title="Arrastra para ordenar. Usa el menú para mover con teclado." onPointerDown={(event) => dragControls.start(event)} onPointerUp={onDragEnd}><GripVertical /></button>
      <div className="line-main"><span className="line-type">{lineLabels[line.type]}</span><input className="line-description" value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} onBlur={() => commit("description", description, line.description)} aria-label="Descripción" />{line.laborEntries.length ? <div className="labor-chips">{line.laborEntries.map((entry) => <span className="labor-chip" key={entry.id}>{entry.employeeNameSnapshot} · {formatNumber(entry.hours)} h</span>)}</div> : null}</div>
      <div className="line-cell"><label htmlFor={`quantity-${line.id}`}>{line.type === "labor" ? "Empleados" : `Cantidad · ${line.unit}`}</label>{line.type === "labor" ? <span>{line.laborEntries.length}</span> : <input id={`quantity-${line.id}`} className="line-input" value={quantity} disabled={readOnly} inputMode="decimal" onChange={(event) => setQuantity(event.target.value)} onBlur={() => commit("quantity", quantity, line.quantity)} />}</div>
      <div className="line-cell"><label htmlFor={`price-${line.id}`}>{line.type === "labor" ? "Horas" : "Precio"}</label>{line.type === "labor" ? <span className="money">{formatNumber(line.laborEntries.reduce((sum, entry) => sum + Number(entry.hours), 0))}</span> : <input id={`price-${line.id}`} className="line-input" value={price} disabled={readOnly} inputMode="decimal" onChange={(event) => setPrice(event.target.value)} onBlur={() => commit("saleRuleValue", price, line.saleRuleValue)} />}</div>
      <div className="line-cell"><label htmlFor={`igic-${line.id}`}>IGIC</label><select id={`igic-${line.id}`} className="line-input" value={igic} disabled={readOnly} onChange={(event) => { setIgic(event.target.value); commit("igicRate", event.target.value, line.igicRate); }}><option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option></select></div>
      <div className="line-cell"><label>Venta con IGIC</label><div className="line-output">{formatMoney(calculation?.finalSaleWithTax)}</div><div className={`line-profit${Number(calculation?.profit ?? 0) < 0 ? " negative" : ""}`}>{formatMoney(calculation?.profit)} beneficio</div></div>
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="button button-ghost button-icon line-menu" aria-label={`Acciones de ${line.description}`}><MoreHorizontal /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end" sideOffset={5}><DropdownMenu.Item className="dropdown-item" onSelect={onAdvanced}><Settings2 />Detalles avanzados</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={first || readOnly} onSelect={() => onMove(-1)}><ArrowUp />Subir línea</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={last || readOnly} onSelect={() => onMove(1)}><ArrowDown />Bajar línea</DropdownMenu.Item><DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: 4 }} /><DropdownMenu.Item className="dropdown-item danger" disabled={readOnly} onSelect={onDelete}><Trash2 />Eliminar</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    </Reorder.Item>
  );
}

function QuoteSummary({ quote, onAdjust, readOnly }: { quote: QuoteRecord; onAdjust: () => void; readOnly: boolean }) {
  const calculation = quote.calculation;
  const negative = Number(calculation?.profit ?? 0) < 0;
  return <aside className="panel summary" aria-label="Resumen económico"><div className="summary-header"><h2>Resumen económico</h2></div><div className="summary-body">
    <div className="summary-row"><span>Coste</span><strong>{formatMoney(calculation?.cost)}</strong></div>
    <div className="summary-row"><span>Venta sin IGIC</span><strong>{formatMoney(calculation?.saleWithoutTax)}</strong></div>
    <div className="summary-row"><span>IGIC</span><strong>{formatMoney(calculation?.taxTotal)}</strong></div><div className="summary-divider" />
    <div className="summary-row summary-total"><span>Total</span><strong>{formatMoney(calculation?.saleWithTax)}</strong></div><div className="summary-divider" />
    <div className={`summary-row summary-profit${negative ? " negative" : ""}`}><span>Beneficio</span><strong>{formatMoney(calculation?.profit)}</strong></div>
    <div className="summary-row"><span>Beneficio / coste</span><strong>{calculation?.profitOnCostPct ? `${formatNumber(calculation.profitOnCostPct)} %` : "No disponible"}</strong></div>
    <div className="summary-row"><span>Margen / venta</span><strong>{calculation?.marginOnSalePct ? `${formatNumber(calculation.marginOnSalePct)} %` : "No disponible"}</strong></div>
    {negative ? <div className="notice notice-danger" style={{ marginTop: 10 }}><AlertTriangle /><span>El presupuesto tiene beneficio negativo. Puedes continuar, pero conviene revisarlo.</span></div> : null}
    <RippleButton variant="secondary" style={{ width: "100%", marginTop: 16 }} onClick={onAdjust} disabled={readOnly || quote.lines.length === 0}><CircleDollarSign />Ajustar precio</RippleButton>
    <p className="summary-note">Todos los importes proceden del cálculo confirmado por el servidor.</p>
  </div></aside>;
}

type Execute = (command: QuoteCommand, successMessage?: string) => Promise<QuoteRecord>;

function AddLineSheet({ open, onOpenChange, type, quote, materials, employees, travels, execute, refreshQuote }: { open: boolean; onOpenChange: (open: boolean) => void; type: LineType; quote: QuoteRecord; materials: MaterialRecord[]; employees: EmployeeRecord[]; travels: TravelRecord[]; execute: Execute; refreshQuote: () => Promise<QuoteRecord> }) {
  const [description, setDescription] = useState(""); const [quantity, setQuantity] = useState("1"); const [unit, setUnit] = useState("ud"); const [price, setPrice] = useState(""); const [cost, setCost] = useState(""); const [igic, setIgic] = useState("7"); const [catalogId, setCatalogId] = useState(""); const [employeeId, setEmployeeId] = useState(""); const [hours, setHours] = useState("1"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (open) { setDescription(""); setQuantity("1"); setUnit(type === "travel" ? "km" : "ud"); setPrice(""); setCost(""); setIgic("7"); setCatalogId(""); setEmployeeId(""); setHours("1"); setError(""); } }, [open, type]);
  function chooseCatalog(id: string) {
    setCatalogId(id);
    if (type === "material") { const item = materials.find((record) => record.id === id); if (item) { setDescription(item.name); setUnit(item.unit); setPrice(editableDecimal(item.saleUnitPrice)); setCost(editableDecimal(item.supplierUnitPrice)); setIgic(normalizedRate(item.igicRate)); } }
    if (type === "travel") { const item = travels.find((record) => record.id === id); if (item) { setDescription(item.name); setUnit(item.unit); setPrice(editableDecimal(item.saleUnitPrice)); setCost(editableDecimal(item.costUnitPrice)); setIgic(normalizedRate(item.igicRate)); } }
    if (type === "labor") { setEmployeeId(id); const item = employees.find((record) => record.id === id); if (item) { setDescription(description || "Mano de obra"); setPrice(editableDecimal(item.saleRate)); setCost(editableDecimal(item.costRate)); setIgic(normalizedRate(item.defaultIgicRate)); } }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const common = { expectedRevision: quote.revision, description: description.trim(), saleRule: "unit_price" as const, saleRuleValue: price || "0", quantity, igicRate: igic };
      if (type === "material") await execute({ type: "addMaterialLine", ...common, ...(catalogId ? { catalogMaterialId: catalogId } : {}), ...(cost ? { directUnitCost: cost, supplierUnitPrice: cost } : {}), ...(price ? { baseUnitPrice: price } : {}) }, "Material añadido");
      else if (type === "labor") {
        await execute({ type: "addLaborLine", ...common, saleRuleValue: "0", quantity: "1" });
        const current = await refreshQuote(); const line = [...current.lines].reverse().find((item) => item.type === "labor"); const employee = employees.find((item) => item.id === employeeId);
        if (line && employee) await execute({ type: "addLaborEntry", expectedRevision: current.revision, quoteLineId: line.id, employeeNameSnapshot: employee.name, hours, costRateSnapshot: employee.costRate, saleRateSnapshot: employee.saleRate }, "Mano de obra añadida");
      } else if (type === "travel") {
        await execute({ type: "addTravelLine", ...common }, "Desplazamiento añadido");
        if (cost || unit !== "unit") { const current = await refreshQuote(); const line = [...current.lines].reverse().find((item) => item.type === "travel"); if (line) await execute({ type: "updateQuoteLine", expectedRevision: current.revision, lineId: line.id, changes: { unit, directUnitCost: cost || "0" } }); }
      } else await execute({ type: "addOtherLine", ...common }, "Concepto añadido");
      onOpenChange(false);
    } catch { setError("No se pudo añadir la línea. Comprueba los valores."); }
    finally { setBusy(false); }
  }
  const title = `Añadir ${lineLabels[type].toLowerCase()}`;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent title={title} description="Completa lo esencial. Los detalles internos se pueden ajustar después." footer={<><SheetClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></SheetClose><RippleButton type="submit" form="add-line-form" disabled={busy || !description.trim() || (type === "labor" && !employeeId)}>{busy ? "Añadiendo…" : "Añadir línea"}</RippleButton></>}>
    <form id="add-line-form" onSubmit={submit} className="form-grid">
      {type === "material" ? <div className="field span-2"><label className="field-label" htmlFor="material-catalog">Material del catálogo (opcional)</label><SearchableSelect id="material-catalog" value={catalogId} onChange={chooseCatalog} placeholder="Escribe nombre, proveedor o código…" clearLabel="Escribir material manualmente" options={materials.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: [item.supplierNameSnapshot, item.supplierCode].filter(Boolean).join(" · ") || `${item.unit} · ${formatMoney(item.saleUnitPrice)}`, keywords: item.description ?? "" }))} /></div> : null}
      {type === "travel" ? <div className="field span-2"><label className="field-label" htmlFor="travel-catalog">Desplazamiento guardado (opcional)</label><SearchableSelect id="travel-catalog" value={catalogId} onChange={chooseCatalog} placeholder="Escribe para buscar un desplazamiento…" clearLabel="Escribir desplazamiento manualmente" options={travels.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: `${item.unit} · ${formatMoney(item.saleUnitPrice)}`, keywords: item.description ?? "" }))} /></div> : null}
      {type === "labor" ? <div className="field span-2"><label className="field-label" htmlFor="employee">Empleado</label><SearchableSelect id="employee" value={employeeId} onChange={chooseCatalog} required allowClear={false} placeholder="Escribe para buscar un empleado…" options={employees.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: `${formatMoney(item.saleRate)}/h venta · ${formatMoney(item.costRate)}/h coste` }))} /></div> : null}
      <div className="field span-2"><label className="field-label" htmlFor="line-description">Descripción comercial</label><input id="line-description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === "labor" ? "Mano de obra instalación" : "Descripción para el cliente"} autoFocus={type === "other"} required /></div>
      {type === "labor" ? <div className="field"><label className="field-label" htmlFor="labor-hours">Horas</label><input id="labor-hours" className="input" value={hours} onChange={(event) => setHours(event.target.value)} inputMode="decimal" required /></div> : <><div className="field"><label className="field-label" htmlFor="line-quantity">Cantidad</label><input id="line-quantity" className="input" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" required /></div><div className="field"><label className="field-label" htmlFor="line-unit">Unidad</label><input id="line-unit" className="input" value={unit} onChange={(event) => setUnit(event.target.value)} /></div></>}
      <div className="field"><label className="field-label" htmlFor="line-price">{type === "labor" ? "Venta habitual / h" : "Precio de venta / unidad"}</label><input id="line-price" className="input" value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" required={type !== "labor"} disabled={type === "labor"} /></div>
      {(type === "material" || type === "travel" || type === "labor") ? <div className="field"><label className="field-label" htmlFor="line-cost">{type === "labor" ? "Coste habitual / h" : "Coste / unidad"}</label><input id="line-cost" className="input" value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" disabled={type === "labor"} /></div> : null}
      <div className="field"><label className="field-label" htmlFor="line-igic">IGIC</label><select id="line-igic" className="select" value={igic} onChange={(event) => setIgic(event.target.value)}><option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option></select></div>
      {error ? <p className="error-text span-2" role="alert">{error}</p> : null}
    </form>
  </SheetContent></Sheet>;
}

function AdvancedLineSheet({ line, quote, calculation, employees, open, onOpenChange, execute, readOnly }: { line: QuoteLine | null; quote: QuoteRecord; calculation: CalculatedLine | undefined; employees: EmployeeRecord[]; open: boolean; onOpenChange: (open: boolean) => void; execute: Execute; readOnly: boolean }) {
  const [form, setForm] = useState<Record<string, string>>({}); const [discount, setDiscount] = useState(""); const [employeeId, setEmployeeId] = useState(""); const [hours, setHours] = useState("1"); const [busy, setBusy] = useState(false);
  useEffect(() => { if (line) setForm({ description: line.description, quantity: editableDecimal(line.quantity), unit: line.unit, igicRate: normalizedRate(line.igicRate), saleRule: line.saleRule, saleRuleValue: editableDecimal(line.saleRuleValue), baseUnitPrice: editableDecimal(line.baseUnitPrice), directUnitCost: editableDecimal(line.directUnitCost), supplierUnitPrice: editableDecimal(line.supplierUnitPrice), internalReference: line.internalReference ?? "", internalNotes: line.internalNotes ?? "" }); }, [line]);
  if (!line) return <Sheet open={false}><></></Sheet>;
  const lineId = line.id;
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); try { await execute({ type: "updateQuoteLine", expectedRevision: quote.revision, lineId, changes: form }, "Detalles actualizados"); onOpenChange(false); } finally { setBusy(false); } }
  async function addDiscount() { if (!discount) return; setBusy(true); try { await execute({ type: "addSupplierDiscount", expectedRevision: quote.revision, quoteLineId: lineId, percentage: discount }, "Descuento añadido"); setDiscount(""); } finally { setBusy(false); } }
  async function addEmployee() { const employee = employees.find((item) => item.id === employeeId); if (!employee) return; setBusy(true); try { await execute({ type: "addLaborEntry", expectedRevision: quote.revision, quoteLineId: lineId, employeeNameSnapshot: employee.name, hours, costRateSnapshot: employee.costRate, saleRateSnapshot: employee.saleRate }, "Empleado añadido"); setEmployeeId(""); } finally { setBusy(false); } }
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent title="Detalles de la línea" description={`${lineLabels[line.type]} · información económica e interna`} footer={<><SheetClose asChild><RippleButton variant="secondary">Cerrar</RippleButton></SheetClose>{!readOnly ? <RippleButton type="submit" form="advanced-line-form" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</RippleButton> : null}</>}>
    <form id="advanced-line-form" onSubmit={save} className="form-grid">
      <div className="field span-2"><label className="field-label" htmlFor="advanced-description">Descripción</label><input id="advanced-description" className="input" value={form.description ?? ""} onChange={(event) => set("description", event.target.value)} disabled={readOnly} /></div>
      <div className="field"><label className="field-label" htmlFor="advanced-quantity">Cantidad</label><input id="advanced-quantity" className="input" value={form.quantity ?? ""} onChange={(event) => set("quantity", event.target.value)} disabled={readOnly} /></div><div className="field"><label className="field-label" htmlFor="advanced-unit">Unidad</label><input id="advanced-unit" className="input" value={form.unit ?? ""} onChange={(event) => set("unit", event.target.value)} disabled={readOnly} /></div>
      <div className="field"><label className="field-label" htmlFor="advanced-sale-rule">Regla de venta</label><select id="advanced-sale-rule" className="select" value={form.saleRule ?? "unit_price"} onChange={(event) => set("saleRule", event.target.value)} disabled={readOnly}><option value="unit_price">Precio unitario</option><option value="fixed_line_total">Total fijo de línea</option><option value="add_euros_per_unit">Sumar € / unidad</option><option value="add_percentage">Añadir porcentaje</option></select></div><div className="field"><label className="field-label" htmlFor="advanced-rule-value">Valor de la regla</label><input id="advanced-rule-value" className="input" value={form.saleRuleValue ?? ""} onChange={(event) => set("saleRuleValue", event.target.value)} disabled={readOnly} /></div>
      {line.type !== "labor" ? <><div className="field"><label className="field-label" htmlFor="advanced-direct-cost">Coste directo / ud.</label><input id="advanced-direct-cost" className="input" value={form.directUnitCost ?? ""} onChange={(event) => set("directUnitCost", event.target.value)} disabled={readOnly} /></div><div className="field"><label className="field-label" htmlFor="advanced-supplier-price">PVP proveedor / ud.</label><input id="advanced-supplier-price" className="input" value={form.supplierUnitPrice ?? ""} onChange={(event) => set("supplierUnitPrice", event.target.value)} disabled={readOnly} /></div><div className="field"><label className="field-label" htmlFor="advanced-base-price">Precio base / ud.</label><input id="advanced-base-price" className="input" value={form.baseUnitPrice ?? ""} onChange={(event) => set("baseUnitPrice", event.target.value)} disabled={readOnly} /></div></> : null}
      <div className="field"><label className="field-label" htmlFor="advanced-igic">IGIC</label><select id="advanced-igic" className="select" value={form.igicRate ?? "7"} onChange={(event) => set("igicRate", event.target.value)} disabled={readOnly}><option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option></select></div>
      <div className="field"><label className="field-label" htmlFor="advanced-reference">Referencia interna</label><input id="advanced-reference" className="input" value={form.internalReference ?? ""} onChange={(event) => set("internalReference", event.target.value)} disabled={readOnly} /></div><div className="field span-2"><label className="field-label" htmlFor="advanced-notes">Notas internas</label><textarea id="advanced-notes" className="textarea" value={form.internalNotes ?? ""} onChange={(event) => set("internalNotes", event.target.value)} disabled={readOnly} /></div>
    </form>
    <div className="panel" style={{ marginTop: 18, padding: 15 }}><strong style={{ display: "block", marginBottom: 10 }}>Resultado del servidor</strong><div className="summary-row"><span>Coste</span><strong>{formatMoney(calculation?.cost)}</strong></div><div className="summary-row"><span>Venta sin IGIC</span><strong>{formatMoney(calculation?.sale)}</strong></div><div className="summary-row"><span>Beneficio</span><strong>{formatMoney(calculation?.profit)}</strong></div></div>
    {line.type === "material" ? <div style={{ marginTop: 22 }}><div className="section-heading" style={{ paddingInline: 0 }}><h2>Descuentos de proveedor</h2></div><div style={{ display: "grid", gap: 8, marginTop: 10 }}>{line.discounts.map((item, index) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}><div className="input">{index + 1}. {formatNumber(item.percentage)} %</div><RippleButton variant="ghost" size="icon" disabled={readOnly || busy} onClick={() => void execute({ type: "removeSupplierDiscount", expectedRevision: quote.revision, discountId: item.id }, "Descuento eliminado")}><Trash2 /></RippleButton></div>)}<div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}><input className="input" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="Ej. 20" inputMode="decimal" disabled={readOnly} /><RippleButton variant="secondary" onClick={() => void addDiscount()} disabled={readOnly || busy || !discount}><Plus />Añadir</RippleButton></div></div></div> : null}
    {line.type === "labor" ? <div style={{ marginTop: 22 }}><div className="section-heading" style={{ paddingInline: 0 }}><h2>Empleados</h2></div><div style={{ display: "grid", gap: 8, marginTop: 10 }}>{line.laborEntries.map((entry) => <div className="panel" key={entry.id} style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}><div><strong>{entry.employeeNameSnapshot}</strong><span className="row-subtitle">{formatNumber(entry.hours)} h · {formatMoney(entry.saleRateSnapshot)}/h</span></div><RippleButton variant="ghost" size="icon" disabled={readOnly || busy} onClick={() => void execute({ type: "removeLaborEntry", expectedRevision: quote.revision, entryId: entry.id }, "Empleado eliminado")}><Trash2 /></RippleButton></div>)}<div className="form-grid"><SearchableSelect value={employeeId} onChange={setEmployeeId} disabled={readOnly} placeholder="Buscar empleado…" options={employees.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: `${formatMoney(item.saleRate)}/h` }))} /><input className="input" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="Horas" /><RippleButton variant="secondary" className="span-2" onClick={() => void addEmployee()} disabled={readOnly || busy || !employeeId}><Plus />Añadir empleado</RippleButton></div></div></div> : null}
  </SheetContent></Sheet>;
}

function AdjustmentDialog({ open, onOpenChange, quote, execute }: { open: boolean; onOpenChange: (open: boolean) => void; quote: QuoteRecord; execute: Execute }) {
  const [scope, setScope] = useState<"quote" | "selection">("quote"); const [mode, setMode] = useState<"amount" | "percentage" | "target_total">("amount"); const [value, setValue] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setValue(""); setSelected([]); } }, [open]);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await execute({ type: "addPriceAdjustment", expectedRevision: quote.revision, scope, mode, value, ...(scope === "selection" ? { targetLineIds: selected } : {}) }, "Ajuste aplicado"); onOpenChange(false); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="Ajustar precio" description="El servidor aplicará y repartirá el ajuste de forma auditable." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="adjustment-form" disabled={busy || !value || (scope === "selection" && selected.length === 0)}>{busy ? "Aplicando…" : "Aplicar ajuste"}</RippleButton></>}>
    <form id="adjustment-form" onSubmit={submit} className="form-grid">
      <div className="field"><label className="field-label" htmlFor="adjust-scope">Aplicar a</label><select id="adjust-scope" className="select" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="quote">Presupuesto completo</option><option value="selection">Selección de líneas</option></select></div>
      <div className="field"><label className="field-label" htmlFor="adjust-mode">Tipo de ajuste</label><select id="adjust-mode" className="select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="amount">Sumar €</option><option value="percentage">Aumentar %</option><option value="target_total">Fijar total sin IGIC</option></select></div>
      <div className="field span-2"><label className="field-label" htmlFor="adjust-value">Valor</label><input id="adjust-value" className="input" value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" placeholder={mode === "percentage" ? "Ej. 5" : "Ej. 300"} required /></div>
      {scope === "selection" ? <fieldset className="span-2" style={{ border: 0, padding: 0, margin: 0 }}><legend className="field-label" style={{ marginBottom: 8 }}>Líneas</legend><div style={{ display: "grid", gap: 7 }}>{quote.lines.filter((line) => !["title", "adjustment"].includes(line.type)).map((line) => <label className="panel" key={line.id} style={{ padding: 10, display: "flex", alignItems: "center", gap: 9 }}><input type="checkbox" checked={selected.includes(line.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id))} />{line.description}</label>)}</div></fieldset> : null}
      <div className="notice span-2"><CircleDollarSign /><span><strong>Precio actual:</strong> {formatMoney(quote.calculation?.saleWithoutTax)}. El nuevo precio aparecerá después de que el motor del servidor confirme el reparto.</span></div>
    </form>
  </DialogContent></Dialog>;
}

function AddTextDialog({ open, onOpenChange, quote, templates, execute }: { open: boolean; onOpenChange: (open: boolean) => void; quote: QuoteRecord; templates: TextTemplateRecord[]; execute: Execute }) {
  const [templateId, setTemplateId] = useState(""); const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTemplateId(""); setTitle(""); setBody(""); } }, [open]);
  function choose(id: string) { setTemplateId(id); const template = templates.find((item) => item.id === id); if (template) { setTitle(template.title); setBody(template.body); } }
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); try { await execute({ type: "addQuoteText", expectedRevision: quote.revision, title, body }, "Texto añadido"); onOpenChange(false); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title="Añadir texto" description="Parte de una plantilla o escribe un bloque exclusivo para este presupuesto." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="add-text-form" disabled={busy || !body.trim()}>{busy ? "Añadiendo…" : "Añadir texto"}</RippleButton></>}><form id="add-text-form" onSubmit={submit} className="form-grid"><div className="field span-2"><label className="field-label" htmlFor="quote-text-template">Plantilla (opcional)</label><SearchableSelect id="quote-text-template" value={templateId} onChange={choose} placeholder="Buscar una plantilla…" clearLabel="Escribir texto libre" options={templates.filter((item) => item.active).map((item) => ({ value: item.id, label: item.title, description: item.body.slice(0, 90) }))} /></div><div className="field span-2"><label className="field-label" htmlFor="quote-text-title">Título</label><input id="quote-text-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="field span-2"><label className="field-label" htmlFor="quote-text-body">Contenido</label><textarea id="quote-text-body" className="textarea" value={body} onChange={(event) => setBody(event.target.value)} required /></div></form></DialogContent></Dialog>;
}

async function reorderTexts(quote: QuoteRecord, textId: string, direction: -1 | 1, execute: Execute) {
  if (!quote.texts) return; const index = quote.texts.findIndex((item) => item.id === textId); const target = index + direction; if (target < 0 || target >= quote.texts.length) return; const ordered = [...quote.texts]; [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]; await execute({ type: "reorderQuoteTexts", expectedRevision: quote.revision, orderedTextIds: ordered.map((item) => item.id) }, "Textos reordenados");
}

function EditorSkeleton() {
  return <div className="page"><div className="skeleton" style={{ height: 24, width: 180, marginBottom: 18 }} /><div className="skeleton" style={{ height: 44, width: "45%", marginBottom: 30 }} /><div className="editor-grid"><div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>{Array.from({ length: 5 }, (_, index) => <div className="skeleton" key={index} style={{ height: 72 }} />)}</div><div className="panel" style={{ padding: 18 }}><div className="skeleton" style={{ height: 260 }} /></div></div></div>;
}
