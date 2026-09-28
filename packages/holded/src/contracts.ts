// Contratos de Holded API v2 (verificados contra la API real: envelope
// { items, cursor, has_more } y campos snake_case). Sólo tipamos lo que
// leemos/escribimos; el resto se conserva vía el índice `[key: string]`
// (imprescindible porque el PUT v2 es un reemplazo completo).

export interface HoldedBillAddress {
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  province?: string | null;
  country?: string | null;
  country_code?: string | null;
  info?: string | null;
  [key: string]: unknown;
}

/** Contacto de Holded v2 (snake_case). */
export interface HoldedContact {
  id: string;
  name?: string;
  /** Código de contacto: en cuentas ES es el NIF/CIF (suele estar poblado). */
  code?: string | null;
  /** VAT intracomunitario; a menudo null en clientes nacionales. */
  vat_number?: string | null;
  trade_name?: string | null;
  is_person?: boolean;
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  /** client | supplier | lead | debtor | creditor */
  type?: string;
  bill_address?: HoldedBillAddress;
  updated_at?: string | null;
  [key: string]: unknown;
}

/** Envelope oficial de los listados v2. */
export interface HoldedContactListResponse {
  items: HoldedContact[];
  cursor: string | null;
  has_more: boolean;
}

export type HoldedContactSearchResponse = HoldedContactListResponse;

/** Cuerpo para crear un contacto (POST /api/v2/contacts), snake_case. */
export interface HoldedCreateContactInput {
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  type?: string;
  bill_address?: HoldedBillAddress;
}

/**
 * Cuerpo del PUT (reemplazo completo): debe partir del contacto remoto
 * existente (ver `mergeLocalChangesIntoHoldedContact`).
 */
export type HoldedUpdateContactInput = Record<string, unknown>;

export interface HoldedTax {
  id: string;
  key: string;
  name: string;
  amount: string | null;
  scope: string | null;
  group: string;
  type: string;
  status: boolean;
}

/** Monetary strings remain canonical until JSON serialization at the HTTP boundary. */
export type HoldedEstimateItem =
  | { name: string; type: "title" }
  | { name: string; description?: string; type?: "product" | "service"; units: string; price: string; discount: string; taxes: string[]; unit_type?: string };

export interface HoldedEstimateInput {
  contact_id: string;
  description: string;
  date: string;
  number?: string;
  notes?: string;
  tags?: string[];
  currency: "EUR";
  discount: string;
  tax_included: true;
  show_total: true;
  items: HoldedEstimateItem[];
}

/**
 * Estimate v2 (GET). Campos del OpenAPI oficial; la API real devuelve además
 * `body` (texto enriquecido, que tratamos como SOLO LECTURA) y a veces importes
 * con coma decimal o como number: se normalizan en el adaptador, nunca aquí.
 */
export interface HoldedEstimateLine {
  line_id?: string | null;
  name: string;
  type?: string;
  description?: string | null;
  units: string | number | null;
  price: string | number | null;
  discount: string | number | null;
  tax: string | number | null;
  taxes: string[];
  unit_type?: string;
  sku?: string | null;
  product_id?: string | null;
  service_id?: string | null;
  supplied?: boolean;
  [key: string]: unknown;
}

export interface HoldedEstimate {
  id: string;
  contact_id: string;
  document_number?: string | null;
  contact_name?: string | null;
  description?: string | null;
  date?: string | number | null;
  due_date?: string | number | null;
  status?: string | null;
  draft?: boolean | null;
  currency?: string | null;
  subtotal: string;
  discount?: string | number | null;
  tax: string;
  total: string;
  tags?: string[];
  notes?: string | null;
  body?: unknown;
  language?: string | null;
  approved_at?: string | null;
  custom_fields?: Array<{ field?: unknown; value?: unknown }>;
  from?: { id?: unknown; doc_type?: unknown } | null;
  lines: HoldedEstimateLine[];
  [key: string]: unknown;
}

/** Envelope oficial del listado v2 de Estimates. */
export interface HoldedEstimateListResponse {
  items: HoldedEstimate[];
  cursor: string | null;
  has_more: boolean;
}

/** Resultado normalizado de create/update. */
export interface HoldedContactMutationResult {
  id: string;
  raw: unknown;
}

export type HoldedHealthStatus = "unknown" | "checking" | "healthy" | "unhealthy";
export type HoldedHealthCode =
  | "ok"
  | "invalid_api_key"
  | "insufficient_permissions"
  | "network_error"
  | "rate_limit"
  | "unexpected_error"
  | "not_configured"
  | "unknown";

export interface HoldedHealthResult {
  status: HoldedHealthStatus;
  code: HoldedHealthCode;
  message: string;
  lastCheckedAt: string | null;
}

/** Tipos de contacto de Holded que aceptamos como cliente de un presupuesto. */
export const CLIENT_CONTACT_TYPES = ["client", "debtor", "lead"] as const;

export function isClientContact(contact: Pick<HoldedContact, "type">): boolean {
  const type = typeof contact.type === "string" ? contact.type.trim().toLowerCase() : "";
  // Sin tipo declarado lo tratamos como cliente (Holded a veces omite el campo);
  // los proveedores/acreedores explícitos se excluyen.
  if (!type) return true;
  return (CLIENT_CONTACT_TYPES as readonly string[]).includes(type);
}
