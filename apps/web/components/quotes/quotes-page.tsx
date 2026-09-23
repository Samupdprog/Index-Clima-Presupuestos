"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { Archive, ArchiveRestore, Copy, FilePlus2, MoreHorizontal, Search, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { ErrorState, ToastViewport, useToasts } from "../ui/feedback";
import { OriginBadge, StatusBadge } from "../ui/badges";
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
      <CreateQuoteDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(quote) => { push("Presupuesto creado"); router.push(`/presupuestos/${quote.id}`); }} />
      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <DialogContent title="Archivar presupuesto" description={`Podrás seguir consultando ${archiveTarget?.reference ?? "este presupuesto"}, pero quedará en modo archivado.`} footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton variant="danger" onClick={() => void archive()}><Archive />Archivar</RippleButton></>}>
          <p style={{ margin: 0, color: "var(--foreground-muted)" }}>Esta acción no elimina los datos.</p>
        </DialogContent>
      </Dialog>
      <ToastViewport toasts={toasts} />
    </div>
  );
}

function CreateQuoteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (quote: QuoteRecord) => void }) {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [quickClient, setQuickClient] = useState(false);
  const [clientName, setClientName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) void api.searchClients("").then(setClients).catch(() => setClients([])); }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let selectedClientId = clientId || undefined;
      if (quickClient && clientName.trim()) selectedClientId = (await api.createClient({ name: clientName.trim() })).id;
      const quote = await api.createQuote({ title: title.trim(), clientId: selectedClientId, origin: "generator", accessMode: "editable" });
      onOpenChange(false); setTitle(""); setClientId(""); setClientName(""); setQuickClient(false); onCreated(quote);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503 ? "La API no está disponible." : "Revisa los datos e inténtalo de nuevo.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Nuevo presupuesto" description="Dos datos y entrarás directamente al editor." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="create-quote-form" disabled={busy || !title.trim() || (quickClient && !clientName.trim())}>{busy ? "Creando…" : "Crear y editar"}</RippleButton></>}>
        <form id="create-quote-form" onSubmit={submit} className="form-grid">
          <div className="field span-2"><label className="field-label" htmlFor="quote-title">Título del presupuesto</label><input id="quote-title" className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Climatización vivienda Las Palmas" required /></div>
          <div className="field span-2">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><label className="field-label" htmlFor="quote-client">Cliente</label><button type="button" className="button button-ghost button-sm" onClick={() => setQuickClient((value) => !value)}><UserPlus />{quickClient ? "Elegir existente" : "Crear rápido"}</button></div>
            {quickClient ? <input id="quote-client" className="input" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Nombre del nuevo cliente" /> : <select id="quote-client" className="select" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Sin cliente por ahora</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select>}
          </div>
          {error ? <p className="error-text span-2" role="alert">{error}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuotesSkeleton() {
  return <div style={{ padding: 16, display: "grid", gap: 12 }}>{Array.from({ length: 6 }, (_, index) => <div className="skeleton" key={index} style={{ height: 50 }} />)}</div>;
}
