// Presentación y entrada de decimales en la UI. Solo formato: el backend sigue
// recibiendo y devolviendo strings decimales canónicos ("1234.5") y calcula con decimal.js.

const CANONICAL = /^-?\d+(?:\.\d+)?$/;

/** Quita ceros a la izquierda y ceros decimales inútiles de un decimal canónico. */
function trimCanonical(value: string) {
  const negative = value.startsWith("-");
  const [integerRaw = "0", fraction = ""] = value.replace("-", "").split(".");
  const integer = integerRaw.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  const body = decimals ? `${integer}.${decimals}` : integer;
  return negative && /[1-9]/.test(body) ? `-${body}` : body;
}

/**
 * Convierte lo que escribe el usuario en un decimal canónico o `null` si no es válido.
 * Acepta `13,96`, `13.96`, `1.234,50`, `1,234.50`, `1 234,5`, `12 €` o `7 %`.
 */
export function parseDecimalText(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let text = String(input).trim().replace(/[\s €%]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal; el otro, de miles.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    if (text.indexOf(",") !== lastComma) return null;
    text = text.replace(",", ".");
  } else if (lastDot >= 0 && text.indexOf(".") !== lastDot) {
    // Varios puntos sin coma: agrupación de miles (1.234.567).
    if (!/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) return null;
    text = text.replace(/\./g, "");
  }
  if (text.startsWith(".")) text = `0${text}`;
  if (text.endsWith(".")) text = text.slice(0, -1);
  return CANONICAL.test(text) ? trimCanonical(text) : null;
}

/** Valor para un campo editable: coma decimal, sin separador de miles ni ceros inútiles. */
export function formatDecimalForInput(value: string | number | null | undefined): string {
  const canonical = parseDecimalText(typeof value === "number" ? String(value) : value);
  return canonical === null ? "" : canonical.replace(".", ",");
}

/** Decimal canónico para enviar a la API, o `fallback` si el campo está vacío o es inválido. */
export function decimalForApi(value: string | number | null | undefined, fallback = ""): string {
  return parseDecimalText(value) ?? fallback;
}
