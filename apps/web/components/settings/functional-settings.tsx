"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api/client";
import { Dialog, DialogContent, DialogClose } from "../animate-ui/overlay";
import { RippleButton } from "../animate-ui/ripple-button";

export function DataResetSettings() {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void api.dataResetStatus().then((result) => setAllowed(result.allowed)).catch(() => setAllowed(false)); }, []);
  async function reset() {
    if (!confirmed || confirmation !== "BORRAR DATOS") return;
    setBusy(true);
    try { await api.resetData(confirmation); setOpen(false); setMessage("Datos del Generador borrados. Configuración conservada; Holded no se ha modificado."); }
    catch { setMessage("No se borraron los datos. Revisa que el borrado esté autorizado en el servidor."); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-section"><h2>Zona peligrosa</h2><p>Borra clientes, presupuestos y catálogos de esta instalación. Se conservan la instalación, la configuración, la clave cifrada y la auditoría. No borra datos de Holded.</p>
    <RippleButton variant="secondary" disabled={!allowed} onClick={() => { setConfirmation(""); setConfirmed(false); setOpen(true); }}>Borrar datos del Generador</RippleButton>
    {!allowed ? <p className="field-hint">Deshabilitado por el servidor. Requiere ALLOW_DATA_RESET=true.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Borrar datos del Generador" description="Esta acción elimina los datos funcionales locales y no se puede deshacer desde la aplicación." footer={<><DialogClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></DialogClose><RippleButton disabled={busy || confirmation !== "BORRAR DATOS" || !confirmed} onClick={() => void reset()}>{busy ? "Borrando…" : "Confirmar borrado"}</RippleButton></>}>
      <label className="field"><span>Escribe BORRAR DATOS</span><input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <label className="reset-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que quiero borrar los datos del Generador conservando configuración y Holded.</label>
    </DialogContent></Dialog>
  </section>;
}

export function HoldedTaxSettings() {
  const [taxes, setTaxes] = useState<Array<{ key: string; name: string; amount: string | null; status: boolean; scope: string | null }>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try { const [items, settings] = await Promise.all([api.getHoldedTaxes(), api.getHoldedSettings()]); setTaxes(items); setMapping(settings.taxMapping ?? {}); setMessage("Impuestos de la cuenta cargados."); }
    catch { setMessage("No se pudieron consultar los impuestos. Comprueba la conexión y el permiso accounting:taxes.read."); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-section"><h2>IGIC en Holded</h2><p>La selección automática exige un único impuesto IGIC activo compatible. Puedes elegir aquí el impuesto real de la cuenta si hay varias opciones.</p><RippleButton variant="secondary" disabled={busy} onClick={() => void load()}>Consultar impuestos de Holded</RippleButton>
    {taxes.length ? <><div className="form-grid">{["0", "3", "7", "15"].map((rate) => <label key={rate} className="field"><span>IGIC {rate} %</span><select className="select" value={mapping[rate] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [rate]: event.target.value }))}><option value="">Automático</option>{taxes.filter((tax) => tax.status && tax.scope === "sales" && Number(tax.amount) === Number(rate) && /igic/i.test(`${tax.key} ${tax.name}`)).map((tax) => <option key={tax.key} value={tax.key}>{tax.name} · {tax.amount} %</option>)}</select></label>)}</div><RippleButton disabled={busy} onClick={() => { setBusy(true); void api.updateHoldedSettings({ taxMapping: mapping }).then(() => setMessage("Asignación IGIC guardada.")).catch(() => setMessage("No se pudo guardar la asignación.")).finally(() => setBusy(false)); }}>Guardar asignación IGIC</RippleButton></> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
