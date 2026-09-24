"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { ArrowLeft, ArrowRight, Archive, ArchiveRestore, Bot, Copy, FilePlus2, MoreHorizontal, PenLine, Search, Sparkles, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { ErrorState, ToastViewport, useToasts } from "../ui/feedback";
import { OriginBadge, StatusBadge } from "../ui/badges";
import { SearchableSelect } from "../ui/searchable-select";
import { api, ApiError } from "../../lib/api/client";
import type { ClientRecord, QuoteRecord, QuoteStatus } from "../../lib/api/types";
import { formatDate, formatMoney } from "../../lib/format";

const filters: Array<{ value: "all" | QuoteStatus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "draft", label: "Borradores" },
  { value: "ready_for_review", label: "Por revisar" },
  { value: "finalized", label: "Finalizados" },
  { value: "archived", label: "Archivados" },
];

export function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<QuoteRecord | null>(null);
  const { toasts, push } = useToasts();

  const load = useCallback(async (search = query) => {
    setLoading(true); setError(null);
    try {
      const base = await api.searchQuotes(search);
      const details = await Promise.all(base.map(async (quote) => {
        try { return await api.getQuote(quote.id); } catch { return quote; }
      }));
      setQuotes(details);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503 ? "La API no está disponible. Comprueba que PostgreSQL y el servicio API estén iniciados." : "Se produjo un error inesperado al consultar los presupuestos.");
    } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { void load(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = window.setTimeout(() => void load(query), 260);
    return () => window.clearTimeout(id);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => quotes.filter((quote) => filter === "all" || quote.status === filter), [quotes, filter]);

  async function duplicate(quote: QuoteRecord) {
    try {
      const copy = await api.duplicateQuote(quote.id);
      push("Presupuesto duplicado");
      router.push(`/presupuestos/${copy.id}`);
    } catch { push("No se pudo duplicar el presupuesto", "error"); }
  }

  async function archive() {
    if (!archiveTarget) return;
    try {
      await api.archiveQuote(archiveTarget.id, archiveTarget.revision);
      setArchiveTarget(null); push("Presupuesto archivado"); await load();
    } catch (cause) {
      push(cause instanceof ApiError && cause.isRevisionConflict ? "El presupuesto cambió; recarga antes de archivarlo" : "No se pudo archivar", "error");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><p className="eyebrow">Espacio de trabajo</p><h1 className="page-title">Presupuestos</h1><p className="page-subtitle">Crea, revisa y continúa trabajos en curso sin perder de vista su estado.</p></div>
        <div className="header-actions"><RippleButton onClick={() => setCreateOpen(true)}><FilePlus2 />Nuevo presupuesto</RippleButton></div>
      </div>
      <div className="toolbar">
        <label className="search-field"><Search /><span className="sr-only">Buscar presupuestos</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por referencia o título…" /></label>
        <div className="segmented" aria-label="Filtrar por estado">
          {filters.map((item) => <button className="segment" data-active={filter === item.value} key={item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? <QuotesSkeleton /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : visible.length === 0 ? (
          <div className="empty-state"><div><div className="empty-icon"><FilePlus2 /></div><h3>{query || filter !== "all" ? "No hay coincidencias" : "Tu primer presupuesto empieza aquí"}</h3><p>{query || filter !== "all" ? "Prueba con otra búsqueda o cambia el filtro." : "Selecciona un cliente, añade un título y entra directamente al editor."}</p>{!query && filter === "all" ? <RippleButton onClick={() => setCreateOpen(true)}><FilePlus2 />Crear presupuesto</RippleButton> : null}</div></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Referencia</th><th>Título y cliente</th><th>Estado</th><th>Origen</th><th>Importe</th><th>Modificado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{visible.map((quote) => (
              <tr key={quote.id}>
                <td><Link className="row-title" href={`/presupuestos/${quote.id}`}>{quote.reference}</Link></td>
                <td><Link className="row-title" href={`/presupuestos/${quote.id}`}>{quote.title}</Link><span className="row-subtitle">{quote.clientSnapshot?.name ?? "Sin cliente"}</span></td>
                <td><StatusBadge status={quote.status} /></td><td><OriginBadge origin={quote.origin} /></td>
                <td className="money"><strong>{formatMoney(quote.calculation?.saleWithTax)}</strong></td><td>{formatDate(quote.updatedAt)}</td>
                <td>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild><button className="button button-ghost button-icon" aria-label={`Acciones para ${quote.reference}`}><MoreHorizontal /></button></DropdownMenu.Trigger>
                    <DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end" sideOffset={5}>
                      <DropdownMenu.Item className="dropdown-item" asChild><Link href={`/presupuestos/${quote.id}`}><ArchiveRestore />Abrir</Link></DropdownMenu.Item>
                      <DropdownMenu.Item className="dropdown-item" onSelect={() => void duplicate(quote)}><Copy />Duplicar</DropdownMenu.Item>
                      {quote.status !== "archived" ? <DropdownMenu.Item className="dropdown-item danger" onSelect={() => setArchiveTarget(quote)}><Archive />Archivar</DropdownMenu.Item> : null}
                    </DropdownMenu.Content></DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <CreateQuoteDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(quote, method) => { push("Presupuesto creado"); router.push(`/presupuestos/${quote.id}?inicio=${method}`); }} />
      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <DialogContent title="Archivar presupuesto" description={`Podrás seguir consultando ${archiveTarget?.reference ?? "este presupuesto"}, pero quedará en modo archivado.`} footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton variant="danger" onClick={() => void archive()}><Archive />Archivar</RippleButton></>}>
          <p style={{ margin: 0, color: "var(--foreground-muted)" }}>Esta acción no elimina los datos.</p>
        </DialogContent>
      </Dialog>
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function CreateQuoteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (quote: QuoteRecord, method: "ia" | "manual") => void }) {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [method, setMethod] = useState<"ia" | "manual" | null>(null);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [quickClient, setQuickClient] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientDetails, setClientDetails] = useState({ taxId: "", email: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setStep(1); setMethod(null); setClientId(""); setTitle(""); setQuickClient(false); setClientName(""); setClientDetails({ taxId: "", email: "", phone: "", address: "" }); setError("");
      void api.searchClients("").then(setClients).catch(() => setClients([]));
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let selectedClientId = clientId || undefined;
      if (quickClient && clientName.trim()) selectedClientId = (await api.createClient({ name: clientName.trim(), ...(clientDetails.taxId.trim() ? { taxId: clientDetails.taxId.trim() } : {}), ...(clientDetails.email.trim() ? { email: clientDetails.email.trim() } : {}), ...(clientDetails.phone.trim() ? { phone: clientDetails.phone.trim() } : {}), ...(clientDetails.address.trim() ? { address: clientDetails.address.trim() } : {}) })).id;
      const quote = await api.createQuote({ title: title.trim(), clientId: selectedClientId, origin: "generator", accessMode: "editable" });
      onOpenChange(false); onCreated(quote, method ?? "manual");
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503 ? "La API no está disponible." : "Revisa los datos e inténtalo de nuevo.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={step === 1 ? "¿Cómo quieres empezar?" : "Cliente y trabajo"}
        description={step === 1 ? "Elige el camino más cómodo. Ambos terminan en el mismo editor guiado." : "Deja identificado el presupuesto antes de preparar los conceptos."}
        footer={step === 1
          ? <><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton disabled={!method} onClick={() => setStep(2)}>Continuar<ArrowRight /></RippleButton></>
          : <><RippleButton variant="ghost" onClick={() => setStep(1)}><ArrowLeft />Atrás</RippleButton><RippleButton type="submit" form="create-quote-form" disabled={busy || !title.trim() || (quickClient ? !clientName.trim() : !clientId)}>{busy ? "Creando…" : method === "ia" ? "Crear y preparar con IA" : "Crear y añadir conceptos"}<ArrowRight /></RippleButton></>}
      >
        <div className="dialog-progress" aria-label="Progreso de creación"><span data-active={step === 1}>1. Camino</span><span data-active={step === 2}>2. Cliente y trabajo</span></div>
        {step === 1 ? (
          <div className="start-paths">
            <button type="button" className="start-path" data-selected={method === "ia"} onClick={() => setMethod("ia")}>
              <span className="start-path-icon"><Bot /></span><span><strong>Preparar con IA</strong><small>Copia unas instrucciones, procesa las ofertas y revisa el JSON antes de importar.</small><em><Sparkles />Recomendado para ofertas de proveedor</em></span>
            </button>
            <button type="button" className="start-path" data-selected={method === "manual"} onClick={() => setMethod("manual")}>
              <span className="start-path-icon"><PenLine /></span><span><strong>Crear paso a paso</strong><small>Añade material, mano de obra y desplazamientos desde formularios breves.</small><em>Control manual completo</em></span>
            </button>
          </div>
        ) : (
          <form id="create-quote-form" onSubmit={submit} className="form-grid">
            <div className="field span-2"><label className="field-label" htmlFor="quote-title">Nombre del trabajo</label><input id="quote-title" className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Climatización vivienda Las Palmas" required /></div>
            <div className="field span-2">
              <div className="field-label-row"><label className="field-label" htmlFor="quote-client">Cliente</label><button type="button" className="button button-ghost button-sm" onClick={() => setQuickClient((value) => !value)}><UserPlus />{quickClient ? "Elegir existente" : "Crear cliente rápido"}</button></div>
              {quickClient ? <div className="quick-client-fields"><div className="field span-2"><label className="field-label" htmlFor="quote-client">Nombre o razón social</label><input id="quote-client" className="input" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Nombre del nuevo cliente" required /></div><div className="field"><label className="field-label" htmlFor="quick-client-tax">NIF / CIF</label><input id="quick-client-tax" className="input" value={clientDetails.taxId} onChange={(event) => setClientDetails((current) => ({ ...current, taxId: event.target.value }))} /></div><div className="field"><label className="field-label" htmlFor="quick-client-phone">Teléfono</label><input id="quick-client-phone" className="input" value={clientDetails.phone} onChange={(event) => setClientDetails((current) => ({ ...current, phone: event.target.value }))} /></div><div className="field span-2"><label className="field-label" htmlFor="quick-client-email">Email</label><input id="quick-client-email" className="input" type="email" value={clientDetails.email} onChange={(event) => setClientDetails((current) => ({ ...current, email: event.target.value }))} /></div><div className="field span-2"><label className="field-label" htmlFor="quick-client-address">Dirección</label><input id="quick-client-address" className="input" value={clientDetails.address} onChange={(event) => setClientDetails((current) => ({ ...current, address: event.target.value }))} /></div></div> : <SearchableSelect id="quote-client" value={clientId} onChange={setClientId} required allowClear={false} placeholder="Escribe para buscar un cliente…" options={clients.map((client) => ({ value: client.id, label: client.name, description: [client.taxId, client.email].filter(Boolean).join(" · ") || "Cliente guardado", keywords: `${client.phone ?? ""} ${client.address ?? ""}` }))} />}
              <span className="field-hint">El cliente quedará asociado al crear el presupuesto.</span>
            </div>
            <div className="notice span-2"><Sparkles /><span><strong>Siguiente:</strong> {method === "ia" ? "te guiaremos para extraer y revisar las ofertas." : "entrarás directamente en los conceptos."}</span></div>
            {error ? <p className="error-text span-2" role="alert">{error}</p> : null}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuotesSkeleton() {
  return <div style={{ padding: 16, display: "grid", gap: 12 }}>{Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} style={{ height: 50 }} />)}</div>;
}
