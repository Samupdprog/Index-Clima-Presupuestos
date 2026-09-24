"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BriefcaseBusiness, Package, Plus, Trash2, Truck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { calculateLine } from "@quotes/domain";
import type { QuoteCommand } from "@quotes/contracts";
import { RippleButton } from "../../animate-ui/ripple-button";
import { SearchableSelect } from "../../ui/searchable-select";
import type { EmployeeRecord, MaterialRecord, QuoteRecord, TravelRecord } from "../../../lib/api/types";
import { formatMoney } from "../../../lib/format";

type Kind = "material" | "labor" | "travel" | "other";
type Entry = { key: string; employeeId?: string; employeeNameSnapshot: string; hours: string; costRateSnapshot: string; saleRateSnapshot: string };
const kinds: { id: Kind; label: string; icon: typeof Package }[] = [
  { id: "material", label: "Material", icon: Package }, { id: "labor", label: "Mano de obra", icon: BriefcaseBusiness },
  { id: "travel", label: "Desplazamiento", icon: Truck }, { id: "other", label: "Otro concepto", icon: Plus },
];
const dec = (value: string) => value.trim().replace(",", ".") || "0";

export function ConceptComposer({ quote, materials, employees, travels, readOnly, execute }: {
  quote: QuoteRecord; materials: MaterialRecord[]; employees: EmployeeRecord[]; travels: TravelRecord[]; readOnly: boolean;
  execute: (command: QuoteCommand, message?: string) => Promise<QuoteRecord>;
}) {
  const reduceMotion = useReducedMotion();
  const [kind, setKind] = useState<Kind>("material");
  const [formVersion, setFormVersion] = useState(0);
  const [catalogId, setCatalogId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [igic, setIgic] = useState("7");
  const [employeeId, setEmployeeId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reset(next: Kind = kind) {
    setFormVersion((version) => version + 1);
    setKind(next); setCatalogId(""); setDescription(next === "labor" ? "Mano de obra instalación" : "");
    setQuantity("1"); setUnit(next === "travel" ? "km" : "ud"); setCost(""); setPrice(""); setIgic("7");
    setEmployeeId(""); setEntries([]); setError("");
  }
  function selectCatalog(id: string) {
    setCatalogId(id);
    const item = kind === "material" ? materials.find((record) => record.id === id) : travels.find((record) => record.id === id);
    if (!item) return;
    setDescription(item.name); setUnit(item.unit); setIgic(String(Number(item.igicRate)));
    setCost(kind === "material" ? (item as MaterialRecord).supplierUnitPrice ?? "" : (item as TravelRecord).costUnitPrice);
    setPrice(item.saleUnitPrice ?? "");
  }
  function addEmployee(id: string) {
    setEmployeeId("");
    const item = employees.find((employee) => employee.id === id);
    if (item) { setEntries((current) => [...current, { key: crypto.randomUUID(), employeeId: item.id, employeeNameSnapshot: item.name, hours: "1", costRateSnapshot: item.costRate, saleRateSnapshot: item.saleRate }]); setIgic(String(Number(item.defaultIgicRate))); }
  }
  const preview = useMemo(() => {
    try {
      return calculateLine({ id: "preview", type: kind, quantity: kind === "labor" ? "1" : dec(quantity), igicRate: dec(igic),
        saleRule: { type: "unit_price", value: kind === "labor" ? "0" : dec(price) },
        ...(kind === "material" ? { supplierUnitPrice: dec(cost) } : kind !== "labor" ? { directUnitCost: dec(cost) } : {}),
        laborEntries: entries.map((entry) => ({ hours: dec(entry.hours), costRate: dec(entry.costRateSnapshot), saleRate: dec(entry.saleRateSnapshot) })) });
    } catch { return null; }
  }, [kind, quantity, igic, price, cost, entries]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (readOnly || busy || !description.trim() || (kind === "labor" && !entries.length)) return;
    setBusy(true); setError("");
    try {
      await execute({ type: "createQuoteLine", expectedRevision: quote.revision, lineType: kind,
        ...(kind === "material" && catalogId ? { catalogMaterialId: catalogId } : {}),
        line: { description: description.trim(), unit: kind === "labor" ? "h" : unit.trim() || "ud", quantity: kind === "labor" ? "1" : dec(quantity), igicRate: dec(igic), saleRule: "unit_price", saleRuleValue: kind === "labor" ? "0" : dec(price), directUnitCost: kind === "material" || kind === "labor" ? null : dec(cost), supplierUnitPrice: kind === "material" ? dec(cost) : null, baseUnitPrice: null, saleBaseMode: "net_cost" },
        discounts: [], laborEntries: entries.map(({ key: _key, ...entry }) => ({ ...entry, hours: dec(entry.hours), costRateSnapshot: dec(entry.costRateSnapshot), saleRateSnapshot: dec(entry.saleRateSnapshot) })) },
        `${kinds.find((item) => item.id === kind)?.label} añadido`);
      reset();
    } catch { setError("No se pudo añadir. Revisa los valores y vuelve a intentarlo."); }
    finally { setBusy(false); }
  }
  const options = kind === "material" ? materials.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: [item.supplierNameSnapshot, item.supplierCode].filter(Boolean).join(" · ") || item.unit })) : travels.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: item.unit }));
  return <section className="panel concept-composer" aria-labelledby="composer-title">
    <div className="concept-composer-head"><div><p className="eyebrow">Añadir concepto</p><h3 id="composer-title">¿Qué necesitas presupuestar?</h3></div><span>Los valores se aplican solo a este presupuesto</span></div>
    <div className="concept-tabs" role="tablist" aria-label="Tipo de concepto">{kinds.map((item) => <button key={item.id} type="button" role="tab" aria-selected={kind === item.id} className="concept-tab" onClick={() => reset(item.id)}><item.icon aria-hidden="true" />{item.label}{kind === item.id ? <motion.span layoutId="concept-tab-indicator" className="concept-tab-indicator" transition={{ duration: reduceMotion ? 0 : .2 }} /> : null}</button>)}</div>
    <AnimatePresence mode="wait" initial={false}><motion.form key={kind} onSubmit={submit} className="concept-form" initial={{ opacity: 0, y: reduceMotion ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -5 }} transition={{ duration: reduceMotion ? 0 : .16 }}>
      {(kind === "material" || kind === "travel") ? <div className="field concept-wide"><label className="field-label" htmlFor="concept-catalog">{kind === "material" ? "Buscar o escribir material" : "Buscar o escribir desplazamiento"}</label><SearchableSelect key={`${kind}-${formVersion}`} id="concept-catalog" value={catalogId} options={options} onChange={selectCatalog} onQueryChange={setDescription} preserveQueryOnBlur placeholder="Escribe para buscar o crear uno puntual" disabled={readOnly} /></div> : null}
      <div className="field concept-wide"><label className="field-label" htmlFor="concept-description">{kind === "labor" ? "Concepto que verá el cliente" : "Concepto"}</label><input id="concept-description" className="input" value={description} onChange={(event) => setDescription(event.target.value)} required disabled={readOnly} placeholder={kind === "material" ? "Ej. Unidad interior Daikin" : kind === "labor" ? "Mano de obra instalación" : "Descripción para el cliente"} /></div>
      {kind === "labor" ? <div className="concept-wide labor-composer"><div className="labor-column-head"><span>Empleado</span><span>Horas</span><span>Coste empresa / h</span><span>Precio cliente / h</span></div>{entries.map((entry) => <div className="labor-composer-row" key={entry.key}><span className="labor-name">{entry.employeeNameSnapshot}</span>{(["hours", "costRateSnapshot", "saleRateSnapshot"] as const).map((field) => <input key={field} className="input" aria-label={`${field === "hours" ? "Horas" : field === "costRateSnapshot" ? "Coste por hora" : "Precio por hora"} de ${entry.employeeNameSnapshot}`} inputMode="decimal" value={entry[field]} onChange={(event) => setEntries((current) => current.map((item) => item.key === entry.key ? { ...item, [field]: event.target.value } : item))} disabled={readOnly} />)}<button type="button" className="button button-ghost button-icon" aria-label={`Quitar ${entry.employeeNameSnapshot}`} onClick={() => setEntries((current) => current.filter((item) => item.key !== entry.key))} disabled={readOnly}><Trash2 /></button></div>)}<div className="labor-add"><SearchableSelect value={employeeId} onChange={addEmployee} options={employees.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: `${formatMoney(item.costRate)}/h coste · ${formatMoney(item.saleRate)}/h cliente` }))} placeholder="+ Buscar y añadir empleado" disabled={readOnly} /></div></div> : <><div className="field"><label className="field-label" htmlFor="concept-quantity">Cantidad</label><input id="concept-quantity" className="input" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" required disabled={readOnly} /></div><div className="field"><label className="field-label" htmlFor="concept-unit">Unidad</label><input id="concept-unit" className="input" value={unit} onChange={(event) => setUnit(event.target.value)} disabled={readOnly} /></div><div className="field"><label className="field-label" htmlFor="concept-cost">Coste / unidad</label><input id="concept-cost" className="input" value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" disabled={readOnly} placeholder="0,00" /></div><div className="field"><label className="field-label" htmlFor="concept-price">Precio cliente / unidad · sin IGIC</label><input id="concept-price" className="input" value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" required disabled={readOnly} placeholder="0,00" /></div></>}
      <div className="field"><label className="field-label" htmlFor="concept-igic">IGIC</label><select id="concept-igic" className="select" value={igic} onChange={(event) => setIgic(event.target.value)} disabled={readOnly}><option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option></select></div>
      <div className="concept-preview concept-wide" aria-live="polite"><div><span>Coste total</span><strong>{preview ? formatMoney(preview.cost.toFixed(2)) : "—"}</strong></div><div><span>Cliente · sin IGIC</span><strong>{preview ? formatMoney(preview.sale.toFixed(2)) : "—"}</strong></div><div><span>Cliente · con IGIC</span><strong>{preview ? formatMoney(preview.finalSaleWithTax.toFixed(2)) : "—"}</strong></div><div className={preview?.profit.isNegative() ? "negative" : ""}><span>Beneficio</span><strong>{preview ? formatMoney(preview.profit.toFixed(2)) : "—"}</strong></div></div>
      {error ? <p className="error-text concept-wide" role="alert">{error}</p> : null}
      <div className="concept-submit concept-wide"><span>Vista previa; el servidor confirmará el importe al guardar.</span><RippleButton type="submit" disabled={readOnly || busy || !description.trim() || (kind === "labor" && !entries.length)}><Plus />{busy ? "Añadiendo…" : `Añadir ${kind === "labor" ? "mano de obra" : kind === "other" ? "concepto" : kind === "travel" ? "desplazamiento" : "material"}`}</RippleButton></div>
    </motion.form></AnimatePresence>
  </section>;
}
