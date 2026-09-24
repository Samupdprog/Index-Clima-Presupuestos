import type {
  HoldedBillAddress,
  HoldedContact,
  HoldedCreateContactInput,
  HoldedUpdateContactInput,
} from "./contracts.js";

/**
 * Vista local de un cliente derivada de un contacto de Holded.
 * Coincide con las columnas que Index Clima controla en `clients`.
 */
export interface LocalClientFields {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface LocalClientLike {
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Decisiones de mapeo Holded v2 ↔ local (documentadas en SPEC-001):
//   taxId   ← code (NIF/CIF en cuentas ES) y, si vacío, vat_number.
//             Al escribir → `code` (compatible con v1 y con el dato real).
//   phone   ← phone y, si vacío, mobile. Al escribir → `phone` (se conserva
//             `mobile` intacto).
//   address ← bill_address.address (1:1, línea de dirección). Ciudad/CP/
//             provincia/país se conservan en Holded pero no se editan aquí,
//             para no corromper la dirección estructurada en el PUT completo.

/** Holded → cliente local (para snapshot y refresco). */
export function holdedContactToLocalClient(contact: HoldedContact): LocalClientFields {
  const bill = contact.bill_address ?? {};
  return {
    name: trimmedOrNull(contact.name) ?? "",
    taxId: trimmedOrNull(contact.code) ?? trimmedOrNull(contact.vat_number),
    email: trimmedOrNull(contact.email),
    phone: trimmedOrNull(contact.phone) ?? trimmedOrNull(contact.mobile),
    address: trimmedOrNull(bill.address),
  };
}

/** Cliente local → cuerpo de creación en Holded (tipo "client"). */
export function localClientToHoldedCreate(client: LocalClientLike): HoldedCreateContactInput {
  const input: HoldedCreateContactInput = { name: client.name.trim(), type: "client" };
  const code = trimmedOrNull(client.taxId);
  const email = trimmedOrNull(client.email);
  const phone = trimmedOrNull(client.phone);
  const address = trimmedOrNull(client.address);
  if (code) input.code = code;
  if (email) input.email = email;
  if (phone) input.phone = phone;
  if (address) input.bill_address = { address };
  return input;
}

/**
 * Fusiona los cambios locales sobre el contacto remoto EXISTENTE y devuelve el
 * objeto completo listo para el PUT (reemplazo total en v2).
 *
 * Sólo se sobrescriben los campos que Index Clima controla; el resto del
 * contacto (vat_number, mobile, iban, tags, contact_persons, notes, defaults,
 * etc.) se conserva. NO cambiamos `type` (un proveedor no se vuelve cliente).
 */
export function mergeLocalChangesIntoHoldedContact(
  existing: HoldedContact,
  changes: Partial<LocalClientFields>,
): HoldedUpdateContactInput {
  const merged: Record<string, unknown> = { ...existing };
  // `id` va en la URL, no en el cuerpo.
  delete merged.id;

  if (changes.name !== undefined) merged.name = changes.name;
  if (changes.taxId !== undefined) merged.code = changes.taxId ?? "";
  if (changes.email !== undefined) merged.email = changes.email ?? "";
  if (changes.phone !== undefined) merged.phone = changes.phone ?? "";

  if (changes.address !== undefined) {
    const existingBill = (existing.bill_address ?? {}) as HoldedBillAddress;
    // Preservamos ciudad/CP/provincia/país que Index Clima no gestiona.
    merged.bill_address = { ...existingBill, address: changes.address ?? "" };
  }

  return merged;
}
