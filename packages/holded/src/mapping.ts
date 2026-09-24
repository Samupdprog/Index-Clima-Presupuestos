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

/** Holded → cliente local (para snapshot y refresco). */
export function holdedContactToLocalClient(contact: HoldedContact): LocalClientFields {
  const bill = contact.billAddress ?? {};
  return {
    name: trimmedOrNull(contact.name) ?? "",
    taxId: trimmedOrNull(contact.code),
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
  if (address) input.billAddress = { address };
  return input;
}

/**
 * Fusiona los cambios locales sobre el contacto remoto EXISTENTE y devuelve el
 * objeto completo listo para el PUT (reemplazo total en v2).
 *
 * Sólo se sobrescriben los campos que Index Clima controla; el resto del
 * contacto (tipo, iban, tags, personas de contacto, notas, etc.) se conserva.
 * En particular NO cambiamos `type`, para no convertir un proveedor en cliente.
 */
export function mergeLocalChangesIntoHoldedContact(
  existing: HoldedContact,
  changes: Partial<LocalClientFields>,
): HoldedUpdateContactInput {
  // Copia profunda superficial preservando todos los campos desconocidos.
  const merged: Record<string, unknown> = { ...existing };
  // `id` va en la URL, no en el cuerpo.
  delete merged.id;

  if (changes.name !== undefined) merged.name = changes.name;
  if (changes.taxId !== undefined) merged.code = changes.taxId ?? "";
  if (changes.email !== undefined) merged.email = changes.email ?? "";
  if (changes.phone !== undefined) merged.phone = changes.phone ?? "";

  if (changes.address !== undefined) {
    const existingBill = (existing.billAddress ?? {}) as HoldedBillAddress;
    // Preservamos ciudad/CP/provincia/país que Index Clima no gestiona.
    merged.billAddress = { ...existingBill, address: changes.address ?? "" };
  }

  return merged;
}
