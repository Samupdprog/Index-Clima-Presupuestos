"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Reorder, useDragControls } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import type { CalculatedLine, QuoteLine } from "../../../lib/api/types";
import { formatMoney, formatNumber } from "../../../lib/format";

function QuickCell({ value, label, field, readOnly, onCommit, numeric = false, currency = false }: { value: string; label: string; field: string; readOnly: boolean; onCommit: (changes: Record<string, unknown>) => Promise<void>; numeric?: boolean; currency?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const saving = useRef(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  async function save() {
    if (saving.current || !editing) return;
    const next = numeric ? draft.trim().replace(",", ".") : draft.trim();
    if (next === value) { setEditing(false); return; }
    if (!next) { setError(true); return; }
    saving.current = true; setBusy(true);
    try { await onCommit({ [field]: next }); setEditing(false); setError(false); }
    catch { setError(true); }
    finally { saving.current = false; setBusy(false); }
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); setDraft(value); setEditing(false); setError(false); }
    if (event.key === "Enter") { event.preventDefault(); void save(); }
  }
  return <div className={`quick-cell${error ? " quick-cell-error" : ""}`}>
    <span className="quick-label">{label}</span>
    {editing ? <input autoFocus className="input quick-input" aria-label={label} value={draft} inputMode={numeric ? "decimal" : undefined} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} onBlur={() => void save()} disabled={busy} />
      : <button type="button" className="quick-value" title={readOnly ? undefined : `Editar ${label.toLowerCase()}`} disabled={readOnly} onClick={() => setEditing(true)}>{currency ? formatMoney(value) : numeric ? formatNumber(value) : value}</button>}
    {error ? <span className="quick-error" role="alert">No guardado</span> : null}
  </div>;
}

const typeName = { material: "Material", labor: "Mano de obra", travel: "Desplazamiento", other: "Otro", adjustment: "Ajuste", title: "Título" };

export function ConceptLineRow({ line, calculation, readOnly, onCommit, onAdvanced, onDelete, onMove, onDragEnd, first, last, showMore }: {
  line: QuoteLine; calculation: CalculatedLine | undefined; readOnly: boolean; onCommit: (changes: Record<string, unknown>) => Promise<void>;
  onAdvanced: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void; onDragEnd: () => void; first: boolean; last: boolean; showMore: boolean;
}) {
  const dragControls = useDragControls();
  const [igicOpen, setIgicOpen] = useState(false);
  const [igicError, setIgicError] = useState(false);
  async function changeIgic(value: string) { setIgicOpen(false); try { await onCommit({ igicRate: value }); setIgicError(false); } catch { setIgicError(true); } }
  const hours = line.laborEntries.reduce((sum, entry) => sum + Number(entry.hours), 0);
  return <Reorder.Item value={line} as="li" className="concept-line" layout dragListener={false} dragControls={dragControls} onDragEnd={onDragEnd}>
    <button type="button" className="drag-handle" disabled={readOnly} aria-label={`Arrastrar ${line.description} para ordenar`} title="Arrastra para ordenar; menú para usar el teclado" onPointerDown={(event) => dragControls.start(event)}><GripVertical /></button>
    <div className="concept-line-name"><span className="line-type">{typeName[line.type]}</span><QuickCell value={line.description} label="Concepto" field="description" readOnly={readOnly} onCommit={onCommit} />{line.type === "labor" ? <small>{formatNumber(hours)} h · {line.laborEntries.length} {line.laborEntries.length === 1 ? "empleado" : "empleados"}</small> : null}</div>
    <div className="concept-line-quantity">{line.type === "labor" ? <div className="quick-cell"><span className="quick-label">Cantidad</span><span>{formatNumber(hours)} h</span></div> : <><QuickCell value={line.quantity} label="Cantidad" field="quantity" numeric readOnly={readOnly} onCommit={onCommit} /><small>{line.unit}</small></>}</div>
    <div className="concept-line-amount"><span className="quick-label">Coste</span><strong>{formatMoney(calculation?.cost)}</strong></div>
    <div className="concept-line-price"><span className="quick-label">Precio cliente</span>{line.type === "labor" || line.saleRule !== "unit_price" ? <strong>{formatMoney(calculation?.sale)}</strong> : <QuickCell value={line.saleRuleValue} label="Precio por unidad sin IGIC" field="saleRuleValue" numeric currency readOnly={readOnly} onCommit={onCommit} />}<small>Sin IGIC: {formatMoney(calculation?.sale)} · Con IGIC: {formatMoney(calculation?.finalSaleWithTax)}</small></div>
    <div className="concept-line-igic"><span className="quick-label">IGIC</span>{igicOpen ? <select autoFocus className="select" aria-label="IGIC" value={String(Number(line.igicRate))} onChange={(event) => void changeIgic(event.target.value)} onBlur={() => setIgicOpen(false)}><option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option></select> : <button type="button" className="quick-value" disabled={readOnly} onClick={() => setIgicOpen(true)}>{formatNumber(line.igicRate)} %</button>}{igicError ? <small role="alert">No guardado</small> : null}</div>
    <div className={`concept-line-profit${Number(calculation?.profit ?? 0) < 0 ? " negative" : ""}`}><span className="quick-label">Beneficio</span><strong>{formatMoney(calculation?.profit)}</strong></div>
    <button type="button" className="button button-secondary concept-edit" onClick={onAdvanced}><PencilLine />Editar</button>
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="button button-ghost button-icon concept-line-menu" aria-label={`Más acciones para ${line.description}`}><MoreHorizontal /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="end"><DropdownMenu.Item className="dropdown-item" disabled={first || readOnly} onSelect={() => onMove(-1)}><ArrowUp />Subir línea</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item" disabled={last || readOnly} onSelect={() => onMove(1)}><ArrowDown />Bajar línea</DropdownMenu.Item><DropdownMenu.Item className="dropdown-item danger" disabled={readOnly} onSelect={onDelete}><Trash2 />Eliminar</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    {showMore ? <div className="concept-line-more"><span>Proveedor: {line.supplierNameSnapshot || "—"}</span><span>Código: {line.supplierCodeSnapshot || "—"}</span><span>Referencia: {line.internalReference || "—"}</span><span>Precio: {line.saleRule === "unit_price" ? "Por unidad" : line.saleRule === "fixed_line_total" ? "Total de línea" : line.saleRule === "add_euros_per_unit" ? "Incremento por unidad" : "Incremento porcentual"}</span></div> : null}
  </Reorder.Item>;
}
