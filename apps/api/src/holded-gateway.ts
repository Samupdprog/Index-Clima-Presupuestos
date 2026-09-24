import type { HoldedClientContact, HoldedContactGateway, HoldedLocalContactInput } from "@quotes/application";
import {
  HoldedApiError,
  holdedContactToLocalClient,
  isClientContact,
  localClientToHoldedCreate,
  mergeLocalChangesIntoHoldedContact,
  type HoldedClient,
  type HoldedContact,
} from "@quotes/holded";

function toClientContact(raw: HoldedContact): HoldedClientContact {
  const local = holdedContactToLocalClient(raw);
  return {
    id: raw.id,
    name: local.name,
    taxId: local.taxId,
    email: local.email,
    phone: local.phone,
    address: local.address,
    isClient: isClientContact(raw),
    snapshot: raw as Record<string, unknown>,
  };
}

/** Adapta el cliente HTTP de Holded al puerto que consume la capa de aplicación. */
export function createHoldedContactGateway(client: HoldedClient): HoldedContactGateway {
  return {
    async searchContacts(query: string): Promise<HoldedClientContact[]> {
      const contacts = await client.searchContacts(query);
      return contacts.filter((c) => c && typeof c.id === "string").map(toClientContact);
    },

    async getContact(holdedContactId: string): Promise<HoldedClientContact | null> {
      try {
        return toClientContact(await client.getContact(holdedContactId));
      } catch (error) {
        if (error instanceof HoldedApiError && error.code === "not_found") return null;
        throw error;
      }
    },

    async createFromLocal(input: HoldedLocalContactInput): Promise<HoldedClientContact> {
      const created = await client.createContact(localClientToHoldedCreate(input));
      // Releemos el contacto para obtener el snapshot canónico.
      const canonical = await client.getContact(created.id);
      return toClientContact(canonical);
    },

    async applyLocalChanges(holdedContactId: string, changes: HoldedLocalContactInput): Promise<HoldedClientContact> {
      // GET remoto → merge de campos controlados → PUT completo (reemplazo v2).
      const existing = await client.getContact(holdedContactId);
      const merged = mergeLocalChangesIntoHoldedContact(existing, changes);
      await client.updateContact(holdedContactId, merged);
      // El PUT es reemplazo total: el estado remoto ahora es `merged` + id.
      return toClientContact({ ...(merged as object), id: holdedContactId } as HoldedContact);
    },
  };
}
