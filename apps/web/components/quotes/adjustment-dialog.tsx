"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PriceAdjustmentPreview, QuoteCommand, PreviewPriceAdjustmentRequest } from "@quotes/contracts";
import { api, ApiError } from "../../lib/api/client";
import type { QuoteRecord } from "../../lib/api/types";
import { formatAdjustment, formatMoney, formatMoneyCompact, formatNumber, formatPercentage } from "../../lib/format";
import { Dialog, DialogClose, DialogContent } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";
import { decimalForApi } from "../../lib/decimal";
import { DecimalInput } from "../ui/decimal-input";

export function AdjustmentDialog({ open, onOpenChange, quote, execute }: { open: boolean; onOpenChange: (open: boolean) => void; quote: QuoteRecord; execute: (command: QuoteCommand, message?: string) => Promise<QuoteRecord> }) {
  const [scope, setScope] = useState<"quote" | "selection">("quote");
  const [mode, setMode] = useState<PreviewPriceAdjustmentRequest["mode"]>("amount");
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<{ key: string; preview: PriceAdjustmentPreview } | null>(null);
  const input: PreviewPriceAdjustmentRequest = { expectedRevision: quote.revision, scope, mode, value: decimalForApi(value, "0"), ...(scope === "selection" ? { targetLineIds: selected } : {}) };
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
  const pct = formatPercentage;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent wide title="Ajustar precio" description="Revisa el reparto y el beneficio calculados por el servidor antes de aplicar." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton type="submit" form="adjustment-form" disabled={busy || !value.trim() || !preview || Boolean(error)}>{busy ? "Aplicando…" : "Aplicar ajuste"}</RippleButton></>}>
    <form id="adjustment-form" onSubmit={submit} className="form-grid">
      <label className="field"><span className="field-label">Aplicar a</span><select className="select" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="quote">Presupuesto completo</option><option value="selection">Selección de líneas</option></select></label>
      <label className="field"><span className="field-label">Tipo de ajuste</span><select className="select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="amount">Sumar €</option><option value="percentage">Aumentar %</option><option value="target_total">Fijar total sin IGIC</option></select></label>
      <label className="field span-2"><span className="field-label">Valor</span><DecimalInput className="input" value={value} onValueChange={setValue} placeholder={mode === "percentage" ? "Ej. 5" : "Ej. 300"} /></label>
      {scope === "selection" ? <fieldset className="span-2 adjustment-selection"><legend>Líneas incluidas</legend>{quote.lines.filter((line) => !["title", "adjustment"].includes(line.type)).map((line) => <label key={line.id}><input type="checkbox" checked={selected.includes(line.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, line.id] : ids.filter((id) => id !== line.id))} />{line.description}</label>)}</fieldset> : null}
      {error ? <p role="alert" className="error-text span-2">{error}</p> : null}
      {!preview && !error ? <p role="status" className="span-2">{scope === "selection" && !selected.length ? "Selecciona al menos una línea." : "Calculando previsualización…"}</p> : null}
      {preview ? <div className="span-2" aria-live="polite">
        <div className="adjustment-flow">
          <div><span>ANTES · Precio actual</span><strong>{formatMoneyCompact(preview.totals.saleBefore)}</strong></div>
          <div className="adjustment-flow-change"><span>AJUSTE</span><strong>{formatMoneyCompact(preview.totals.allocatedAdjustment)}</strong></div>
          <div className={Number(preview.totals.profitAfter) < 0 ? "adjustment-loss" : "adjustment-gain"}><span>DESPUÉS · Nuevo precio</span><strong>{formatMoneyCompact(preview.totals.saleAfter)}</strong></div>
        </div>
        <div className="adjustment-economics"><span>Coste seleccionado <strong>{formatMoney(preview.totals.costBefore)}</strong></span><span>Beneficio <strong>{formatMoney(preview.totals.profitBefore)} → {formatMoney(preview.totals.profitAfter)}</strong></span><span>Margen <strong>{pct(preview.totals.marginBefore)} → {pct(preview.totals.marginAfter)}</strong></span></div>
        <div className="adjustment-lines">{preview.lines.map((line) => <details key={line.id} className="adjustment-line"><summary><span><strong>{line.description}</strong><small>{formatNumber(line.quantity)} unidades</small></span><span>Antes <strong>{formatMoneyCompact(line.saleBefore)}</strong></span><span>Ajuste <strong>{formatMoneyCompact(line.allocatedAdjustment)}</strong></span><span>Después <strong>{formatMoneyCompact(line.saleAfter)}</strong></span></summary><div className="adjustment-line-detail"><span>Coste: {formatMoney(line.unitCost)} / ud · {formatMoney(line.costBefore)} total</span><span>Venta / ud: {formatMoney(line.saleUnitBefore)} → {formatMoney(line.saleUnitAfter)}</span><span>Beneficio: {formatMoney(line.profitBefore)} → {formatMoney(line.profitAfter)}</span><span>Margen: {pct(line.marginBefore)} → {pct(line.marginAfter)}</span></div></details>)}</div>
        <p className="field-hint">Todos los precios y beneficios se muestran sin IGIC. Margen = beneficio sobre venta.</p>
      </div> : null}
    </form>
    {quote.priceAdjustments?.length ? <details className="adjustment-history" open><summary>Ajustes aplicados</summary>{quote.priceAdjustments.map((adjustment) => <div key={adjustment.id}><span>{formatAdjustment(adjustment)}</span><button type="button" className="button button-ghost" disabled={busy} onClick={() => { setBusy(true); void execute({ type: "removePriceAdjustment", expectedRevision: quote.revision, adjustmentId: adjustment.id }, "Ajuste retirado").catch(() => setError("No se pudo retirar el ajuste.")).finally(() => setBusy(false)); }}>Retirar ajuste</button></div>)}</details> : null}
  </DialogContent></Dialog>;
}
