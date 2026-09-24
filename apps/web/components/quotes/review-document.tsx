"use client";

import type { CalculatedLine, QuoteLine, QuoteRecord } from "../../lib/api/types";
import { formatMoney, formatNumber } from "../../lib/format";
import styles from "./review-document.module.css";

const COMPANY = {
  name: "INDEX CLIMA MPC SL.",
  addressLine1: "Gran Tinerfe bajo izq. nº 15",
  addressLine2: "San Cristobal de La Laguna",
  addressLine3: "(38108), Sta Cruz de Tenerife,",
  addressLine4: "España - Islas Canarias",
  taxId: "B09713470",
  phone: "619803771",
  email: "indexclima@gmail.com",
};

type Props = {
  quote: QuoteRecord;
  calculations: Map<string, CalculatedLine>;
};

function formatDocumentDate(value: string | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function numeric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLineUnits(line: QuoteLine) {
  if (line.type === "labor") {
    const totalHours = line.laborEntries.reduce(
      (sum, entry) => sum + numeric(entry.hours),
      0,
    );

    return totalHours > 0 ? totalHours : numeric(line.quantity) || 1;
  }

  return numeric(line.quantity) || 1;
}

function getUnitPrice(
  line: QuoteLine,
  calculation: CalculatedLine | undefined,
) {
  const units = getLineUnits(line);
  const sale = numeric(calculation?.sale);

  if (sale && units) {
    return sale / units;
  }

  return numeric(line.saleRuleValue);
}

function getIgicLabel(lines: QuoteLine[]) {
  const rates = Array.from(
    new Set(
      lines
        .map((line) => String(line.igicRate ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (rates.length === 1) {
    return `IGIC ${formatNumber(rates[0])}%`;
  }

  return "IGIC";
}

export function ReviewDocument({ quote, calculations }: Props) {
  const client = quote.clientSnapshot;

  const commercialLines = quote.lines.filter(
    (line) => !["title", "adjustment"].includes(line.type),
  );

  const igicLabel = getIgicLabel(commercialLines);

  return (
    <article className={styles.document} aria-label={`Presupuesto ${quote.reference}`}>
      <div className={styles.topRule} />

      <header className={styles.header}>
        <div className={styles.documentHeading}>
          <h1>Presupuesto</h1>

          <dl className={styles.documentMeta}>
            <div>
              <dt>Número #</dt>
              <dd>{quote.reference}</dd>
            </div>

            <div>
              <dt>Fecha</dt>
              <dd>{formatDocumentDate(quote.createdAt)}</dd>
            </div>

            <div className={styles.jobRow}>
              <dt>Trabajo</dt>
              <dd>{quote.title}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.logoWrap}>
          <img
            src="/index-clima-logo.png"
            alt="Index Clima"
            className={styles.logo}
          />
        </div>
      </header>

      <section className={styles.parties}>
        <div className={styles.companyBlock}>
          <h2>{COMPANY.name}</h2>
          <p>{COMPANY.addressLine1}</p>
          <p>{COMPANY.addressLine2}</p>
          <p>{COMPANY.addressLine3}</p>
          <p>{COMPANY.addressLine4}</p>
          <p>{COMPANY.taxId}</p>
          <p>{COMPANY.phone}</p>
          <p>{COMPANY.email}</p>
        </div>

        <div className={styles.clientBlock}>
          <h2>Cliente</h2>

          <p className={styles.clientName}>{client?.name ?? "Cliente"}</p>

          {client?.taxId ? <p>{client.taxId}</p> : null}
          {client?.address ? <p>{client.address}</p> : null}
          {client?.phone ? <p className={styles.clientContact}>{client.phone}</p> : null}
          {client?.email ? <p>{client.email}</p> : null}
        </div>
      </section>

      <section className={styles.linesSection} aria-label="Conceptos">
        <table className={styles.table}>
          <colgroup>
            <col className={styles.conceptCol} />
            <col className={styles.priceCol} />
            <col className={styles.unitsCol} />
            <col className={styles.taxCol} />
            <col className={styles.totalCol} />
          </colgroup>

          <thead>
            <tr>
              <th>Concepto</th>
              <th>Precio</th>
              <th>Unidades</th>
              <th>IGIC</th>
              <th>Total</th>
            </tr>
          </thead>

          <tbody>
            {commercialLines.map((line) => {
              const calculation = calculations.get(line.id);
              const units = getLineUnits(line);
              const unitPrice = getUnitPrice(line, calculation);

              return (
                <tr key={line.id}>
                  <td className={styles.conceptCell}>
                    <strong>{line.description}</strong>
                  </td>

                  <td className={styles.moneyCell}>
                    {formatMoney(unitPrice)}
                  </td>

                  <td className={styles.unitsCell}>
                    {formatNumber(units)}
                    {line.unit && line.unit !== "ud" ? (
                      <span className={styles.unitSuffix}> {line.unit}</span>
                    ) : null}
                  </td>

                  <td className={styles.taxCell}>
                    {formatNumber(line.igicRate)}%
                  </td>

                  <td className={styles.totalCell}>
                    {formatMoney(calculation?.finalSaleWithTax)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>BASE IMPONIBLE</span>
            <strong>{formatMoney(quote.calculation?.saleWithoutTax)}</strong>
          </div>

          <div className={styles.totalRow}>
            <span>{igicLabel}</span>
            <strong>{formatMoney(quote.calculation?.taxTotal)}</strong>
          </div>

          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>TOTAL</span>
            <strong>{formatMoney(quote.calculation?.saleWithTax)}</strong>
          </div>
        </div>
      </section>

      {quote.texts?.length ? (
        <section className={styles.texts}>
          {quote.texts.map((text) => (
            <div className={styles.textBlock} key={text.id}>
              {text.title ? <h3>{text.title}</h3> : null}
              <p>{text.body}</p>
            </div>
          ))}
        </section>
      ) : null}

      <footer className={styles.footer}>
        <div className={styles.footerRule} />

        <div className={styles.footerContent}>
          <span>
            {quote.reference} - {formatMoney(quote.calculation?.saleWithTax)}
          </span>

          <span>Pág. 1</span>
        </div>
      </footer>
    </article>
  );
}
