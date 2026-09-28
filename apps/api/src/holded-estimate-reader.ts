import type { HoldedEstimateReader, RemoteEstimateDetail, RemoteEstimatePageItem } from "@quotes/application";
import { HoldedApiError, type HoldedClient, type HoldedEstimate, type HoldedEstimateLine } from "@quotes/holded";

// Normalización de transporte: Holded v2 documenta decimal string, pero la API
// real ha devuelto coma decimal y a veces number. Solo se reescribe el formato
// (sin aritmética); un valor irreconocible se expone como null, nunca inventado.
export function holdedDecimalOrNull(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : null;
  if (!raw || !/^-?\d+(?:[.,]\d+)?$/.test(raw)) return null;
  return raw.replace(",", ".");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Fechas ISO tal cual; un timestamp Unix (formato v1) se convierte a fecha ISO. */
function isoDate(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value * 1000).toISOString().slice(0, 10);
  return null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function summary(raw: HoldedEstimate) {
  return {
    source: "holded" as const,
    holdedEstimateId: raw.id,
    documentNumber: text(raw.document_number),
    description: text(raw.description),
    contactId: text(raw.contact_id),
    contactName: text(raw.contact_name),
    date: isoDate(raw.date),
    dueDate: isoDate(raw.due_date),
    status: typeof raw.status === "number" ? String(raw.status) : text(raw.status),
    draft: typeof raw.draft === "boolean" ? raw.draft : null,
    currency: text(raw.currency),
    subtotal: holdedDecimalOrNull(raw.subtotal),
    discount: holdedDecimalOrNull(raw.discount),
    tax: holdedDecimalOrNull(raw.tax),
    total: holdedDecimalOrNull(raw.total),
    tags: strings(raw.tags),
  };
}

function lines(raw: HoldedEstimate): HoldedEstimateLine[] {
  return Array.isArray(raw.lines) ? raw.lines.filter((line): line is HoldedEstimateLine => Boolean(line) && typeof line === "object") : [];
}

export function toRemoteEstimatePageItem(raw: HoldedEstimate): RemoteEstimatePageItem {
  return {
    ...summary(raw),
    lineTexts: lines(raw).flatMap((line) => [text(line.name), text(line.description)]).filter((value): value is string => Boolean(value)),
  };
}

export function toRemoteEstimateDetail(raw: HoldedEstimate): RemoteEstimateDetail {
  const from = raw.from && typeof raw.from === "object" && typeof raw.from.id === "string" ? { id: raw.from.id, docType: text(raw.from.doc_type) } : null;
  return {
    ...summary(raw),
    lines: lines(raw).map((line) => ({
      lineId: text(line.line_id),
      type: text(line.type),
      name: text(line.name) ?? "",
      description: text(line.description),
      units: holdedDecimalOrNull(line.units),
      price: holdedDecimalOrNull(line.price),
      discount: holdedDecimalOrNull(line.discount),
      tax: holdedDecimalOrNull(line.tax),
      taxes: strings(line.taxes),
      unitType: text(line.unit_type),
      sku: text(line.sku),
      productId: text(line.product_id),
      serviceId: text(line.service_id),
      supplied: typeof line.supplied === "boolean" ? line.supplied : null,
    })),
    notes: text(raw.notes),
    // body: SOLO LECTURA. Se expone para consulta; ninguna ruta lo escribe.
    body: text(raw.body),
    language: text(raw.language),
    approvedAt: text(raw.approved_at),
    customFields: Array.isArray(raw.custom_fields)
      ? raw.custom_fields.flatMap((entry) => entry && typeof entry.field === "string" && (typeof entry.value === "string" || typeof entry.value === "number") ? [{ field: entry.field, value: String(entry.value) }] : [])
      : [],
    from,
  };
}

/** Adaptador de solo lectura sobre el cliente Holded compartido (Bearer, timeout, errores y logging seguros). */
export function createHoldedEstimateReader(client: HoldedClient): HoldedEstimateReader {
  return {
    async listPage({ cursor, limit, contactId }) {
      const page = await client.listEstimatesPage({ limit, ...(cursor ? { cursor } : {}), ...(contactId ? { contactId } : {}) });
      return { items: page.items.map(toRemoteEstimatePageItem), cursor: page.cursor, hasMore: page.has_more };
    },
    async get(id) {
      try {
        return toRemoteEstimateDetail(await client.getEstimate(id));
      } catch (error) {
        if (error instanceof HoldedApiError && error.code === "not_found") return null;
        throw error;
      }
    },
  };
}
