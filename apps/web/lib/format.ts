import { money } from "@quotes/domain";

export const moneyFormatter = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const wholeMoneyFormatter = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const numberFormatter = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
export const dateFormatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });

export function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? (Number.isInteger(numeric) ? wholeMoneyFormatter : moneyFormatter).format(numeric) : "—";
}

export function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numberFormatter.format(numeric) : "—";
}

export function formatQuantity(value: string | number | null | undefined) { return formatNumber(value); }
export function formatPercentage(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "—" : `${formatNumber(value)} %`;
}
export function formatMoneyCompact(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? (Number.isInteger(numeric) ? wholeMoneyFormatter : moneyFormatter).format(numeric) : "—";
}
/** Input text is normalized without rounding or changing the canonical DB value. */
export function formatDecimalInput(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  try { return money(String(value).trim().replace(",", ".")).toString().replace(".", ","); }
  catch { return ""; }
}
export function formatAdjustment(adjustment: { scope: "line" | "selection" | "quote"; mode: "amount" | "percentage" | "target_total"; value: string; targetLineIds?: string[] }) {
  const scope = adjustment.scope === "quote" ? "Presupuesto completo" : adjustment.scope === "line" ? "Una línea" : "Selección de líneas";
  const numeric = Number(adjustment.value);
  const sign = numeric > 0 && adjustment.mode !== "target_total" ? "+" : "";
  const amount = adjustment.mode === "percentage" ? formatPercentage(adjustment.value) : formatMoneyCompact(adjustment.value);
  return `${scope} · ${adjustment.mode === "target_total" ? "Precio objetivo " : sign}${amount}${adjustment.targetLineIds?.length ? ` · ${adjustment.targetLineIds.length} líneas` : ""}`;
}

export function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}
