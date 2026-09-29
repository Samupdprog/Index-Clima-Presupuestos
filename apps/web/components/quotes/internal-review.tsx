"use client";

import { PencilLine } from "lucide-react";
import type { CalculatedLine, QuoteLine, QuoteRecord } from "../../lib/api/types";
import { formatMoney, formatNumber, formatPercentage } from "../../lib/format";
import styles from "./internal-review.module.css";

/**
 * Vista interna de solo lectura: los importes proceden del cálculo del servidor.
 * Nunca forma parte del documento que ve el cliente.
 */
export function InternalReview({ quote, calculations, onEditLines }: { quote: QuoteRecord; calculations: Map<string, CalculatedLine>; onEditLines: () => void }) {
  const lines = quote.lines.filter((line) => !["title", "adjustment"].includes(line.type));
  const totals = quote.calculation;
  return (
    <div className={styles.wrap} aria-label="Vista interna del presupuesto">
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr><th>Concepto</th><th>Uds.</th><th>Coste</th><th>Venta</th><th>Beneficio</th><th>Margen</th><th><span className="sr-only">Editar</span></th></tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const calc = calculations.get(line.id);
              return (
                <tr key={line.id}>
                  <td data-label="Concepto"><strong>{line.description}</strong><small>{kindLabel(line)}</small></td>
                  <td data-label="Uds.">{units(line)}</td>
                  <td data-label="Coste" className={styles.cost}>{formatMoney(calc?.cost)}</td>
                  <td data-label="Venta" className={styles.sale}>{formatMoney(calc?.sale)}</td>
                  <td data-label="Beneficio" className={profitClass(calc?.profit)}>{formatMoney(calc?.profit)}</td>
                  <td data-label="Margen">{formatPercentage(calc?.marginOnSalePct ?? null)}</td>
                  <td className={styles.actions}><button type="button" className="button button-ghost button-icon" onClick={onEditLines} aria-label={`Editar ${line.description}`} title="Editar en el editor de conceptos"><PencilLine /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className={styles.totals}>
        <div><dt>Coste</dt><dd className={styles.cost}>{formatMoney(totals?.cost)}</dd></div>
        <div><dt>Venta sin IGIC</dt><dd className={styles.sale}>{formatMoney(totals?.saleWithoutTax)}</dd></div>
        <div><dt>Beneficio</dt><dd className={profitClass(totals?.profit)}>{formatMoney(totals?.profit)}</dd></div>
        <div><dt>Margen</dt><dd>{formatPercentage(totals?.marginOnSalePct ?? null)}</dd></div>
      </dl>
    </div>
  );
}

function profitClass(value: string | undefined) {
  return String(value ?? "").startsWith("-") ? styles.loss : styles.profit;
}

function kindLabel(line: QuoteLine) {
  return line.type === "material" ? "Material" : line.type === "labor" ? "Mano de obra" : line.type === "travel" ? "Desplazamiento" : "Otro concepto";
}

function units(line: QuoteLine) {
  if (line.type === "labor") return `${formatNumber(line.laborEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))} h`;
  return `${formatNumber(line.quantity)} ${line.unit || "ud"}`;
}
