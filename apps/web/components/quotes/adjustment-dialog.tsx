"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PriceAdjustmentPreview, QuoteCommand, PreviewPriceAdjustmentRequest } from "@quotes/contracts";
import { api, ApiError } from "../../lib/api/client";
import type { QuoteRecord } from "../../lib/api/types";
import { formatMoney, formatNumber } from "../../lib/format";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";

export function AdjustmentDialog({ open, onOpenChange, quote, execute }: { open: boolean; onOpenChange: (open: boolean) => void; quote: QuoteRecord; execute: (command: QuoteCommand, message?: string) => Promise<QuoteRecord> }) {
  const [scope, setScope] = useState<"quote" | "selection">("quote");
  const [mode, setMode] = useState<PreviewPriceAdjustmentRequest["mode"]>("amount");
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<{ key: string; preview: PriceAdjustmentPreview } | null>(null);
  const input: PreviewPriceAdjustmentRequest = { expectedRevision: quote.revision, scope, mode, value: value.trim().replace(",", ".") || "0", ...(scope === "selection" ? { targetLineIds: selected } : {}) };
  const key = JSON.stringify(input);
  const preview = response?.key === key ? response.preview : null;
  useEffect(() => { if (open) { setValue(""); setScope("quote"); setSelected([]); setError(""); setResponse(null); } }, [open]);
  useEffect(() => {
    if (!open || (scope === "selection" && !selected.length)) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      setError("");
      void api.previewAdjustment(quote.id, JSON.parse(key) as PreviewPriceAdjustmentRequest).then((result) => {
        if (!stale) setResponse({ key, preview: result });
      }).catch((cause: unknown) => {
        if (!stale) setError(cause instanceof ApiError && cause.isRevisionConflict ? "El presupuesto ha cambiado. Cierra y recarga para revisar la nueva versión." : "No se puede aplicar este ajuste. Revisa el valor y las líneas seleccionadas.");
      });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, key, quote.id]); // key includes every field and the revision

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview || !value.trim() || busy) return;
    setBusy(true); setError("");
    try { await execute({ type: "addPriceAdjustment", ...input }, "Ajuste aplicado"); onOpenChange(false); }
    catch (cause) { setError(cause instanceof ApiError && cause.isRevisionConflict ? "El presupuesto cambió; recarga antes de aplicar." : "No se guardó el ajuste. Puedes volver a intentarlo."); }
    finally { setBusy(false); }
  }
  const pct = (number: string | null) => number === null ? "—" : `${formatNumber(number)} %`;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent wide title="Ajustar precio" description="Revisa el reparto y el beneficio calculados por el servidor antes de aplicar." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="adjustment-form" disabled={busy || !value.trim() || !preview || Boolean(error)}>{busy ? "Aplicando…" : "Aplicar ajuste"}</RippleButton></>}>
    <form id="adjustment-form" onSubmit={submit} className="form-grid">
      <label className="field"><span className="field-label">Aplicar a</span><select className="select" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="quote">Presupuesto completo</option><option value="selection">Selección de líneas</option></select></label>
      <label className="field"><span className="field-label">Tipo de ajuste</span><select className="select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="amount">Sumar €</option><option value="percentage">Aumentar %</option><option value="target_total">Fijar total sin IGIC</option></select></label>
      <label className="field span-2"><span className="field-label">Valor</span><input className="input" value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" placeholder={mode === "percentage" ? "Ej. 5" : "Ej. 300"} /></label>
      {scope === "selection" ? <fieldset className="span-2 adjustment-selection"><legend>Líneas incluidas</legend>{quote.lines.filter((line) => !["title", "adjustment"].includes(line.type)).map((line) => <label key={line.id}><input type="checkbox" checked={selected.includes(line.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, line.id] : ids.filter((id) => id !== line.id))} />{line.description}</label>)}</fieldset> : null}
      {error ? <p role="alert" className="error-text span-2">{error}</p> : null}
      {!preview && !error ? <p role="status" className="span-2">{scope === "selection" && !selected.length ? "Selecciona al menos una línea." : "Calculando previsualización…"}</p> : null}
      {preview ? <div className="span-2" aria-live="polite">
        <div className="adjustment-totals">{[
          ["Coste seleccionado", formatMoney(preview.totals.costBefore)], ["Precio actual seleccionado", formatMoney(preview.totals.saleBefore)],
          ["Ajuste", formatMoney(preview.totals.allocatedAdjustment)], ["Nuevo precio", formatMoney(preview.totals.saleAfter)],
          ["Beneficio antes", formatMoney(preview.totals.profitBefore)], ["Beneficio después", formatMoney(preview.totals.profitAfter)],
          ["Margen antes", pct(preview.totals.marginBefore)], ["Margen después", pct(preview.totals.marginAfter)],
        ].map(([label, amount]) => <div key={label}><span>{label}</span><strong>{amount}</strong></div>)}</div>
        <div className="table-wrap"><table className="data-table adjustment-table"><thead><tr><th>Concepto / cantidad</th><th>Coste / ud · total</th><th>Venta actual / ud · total</th><th>Beneficio · margen antes</th><th>Ajuste</th><th>Nueva venta / ud · total</th><th>Beneficio · margen después</th></tr></thead><tbody>{preview.lines.map((line) => <tr key={line.id}><td>{line.description}<small>{formatNumber(line.quantity)} unidades</small></td><td>{formatMoney(line.unitCost)}<strong>{formatMoney(line.costBefore)}</strong></td><td>{formatMoney(line.saleUnitBefore)}<strong>{formatMoney(line.saleBefore)}</strong></td><td>{formatMoney(line.profitBefore)}<small>{pct(line.marginBefore)}</small></td><td>{formatMoney(line.allocatedAdjustment)}</td><td>{formatMoney(line.saleUnitAfter)}<strong>{formatMoney(line.saleAfter)}</strong></td><td>{formatMoney(line.profitAfter)}<small>{pct(line.marginAfter)}</small></td></tr>)}</tbody></table></div>
        <p className="field-hint">Todos los precios y beneficios se muestran sin IGIC. Margen = beneficio sobre venta.</p>
      </div> : null}
    </form>
    {quote.priceAdjustments?.length ? <details className="adjustment-history"><summary>Ajustes guardados</summary>{quote.priceAdjustments.map((adjustment) => <div key={adjustment.id}><span>{adjustment.scope} · {adjustment.mode} · {adjustment.value}</span><button type="button" className="button button-ghost" disabled={busy} onClick={() => { setBusy(true); void execute({ type: "removePriceAdjustment", expectedRevision: quote.revision, adjustmentId: adjustment.id }, "Ajuste retirado").catch(() => setError("No se pudo retirar el ajuste.")).finally(() => setBusy(false)); }}>Retirar ajuste</button></div>)}</details> : null}
  </DialogContent></Dialog>;
}
