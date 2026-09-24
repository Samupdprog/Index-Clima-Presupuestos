// Contratos explícitos para los datos de Holded v2 que Index Clima utiliza.
// No modelamos el objeto completo de Holded: conservamos los campos que
// controlamos y preservamos el resto mediante el índice `[key: string]`.

export interface HoldedBillAddress {
  address?: string;
  city?: string;
  postalCode?: string;
  province?: string;
  country?: string;
  countryCode?: string;
  info?: string;
  [key: string]: unknown;
}

/**
 * Contacto de Holded. Sólo tipamos los campos que leemos/escribimos; el resto
 * se conserva intacto (importante porque el PUT v2 es un reemplazo completo).
 */
export interface HoldedContact {
  id: string;
  name?: string;
  /** NIF / CIF en Holded. */
  code?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  /** client | supplier | lead | debtor | creditor */
  type?: string;
  billAddress?: HoldedBillAddress;
  [key: string]: unknown;
}

/** El listado v2 puede venir como array o envuelto en `{ data, total }`. */
export type HoldedContactListResponse =
  | HoldedContact[]
  | { data?: HoldedContact[]; total?: number; page?: number };

export type HoldedContactSearchResponse = HoldedContactListResponse;

/** Cuerpo para crear un contacto (POST /api/v2/contacts). */
export interface HoldedCreateContactInput {
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  type?: string;
  billAddress?: HoldedBillAddress;
}

/**
 * Cuerpo para actualizar un contacto (PUT /api/v2/contacts/{id}).
 * En v2 el PUT es reemplazo completo, así que este objeto debe partir del
 * contacto remoto existente (ver `mergeLocalChangesIntoHoldedContact`).
 */
export type HoldedUpdateContactInput = Record<string, unknown>;

/** Resultado normalizado de create/update (Holded devuelve formas distintas). */
export interface HoldedContactMutationResult {
  id: string;
  raw: unknown;
}

export type HoldedHealthStatus = "unknown" | "checking" | "healthy" | "unhealthy";
export type HoldedHealthCode =
  | "ok"
  | "invalid_api_key"
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
