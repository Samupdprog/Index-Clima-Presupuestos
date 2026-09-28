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
    async listContactsPage(cursor?: string) {
      const page = await client.listContactsPage({ ...(cursor ? { cursor } : {}), limit: 100 });
      return { items: page.items.map(toClientContact), cursor: page.cursor, hasMore: page.has_more };
    },
    async deleteContact(id: string) {
      try { await client.deleteContact(id); }
      catch (error) { if (!(error instanceof HoldedApiError && error.code === "not_found")) throw error; }
    },
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
      // Preserve the known ID even if the following read fails; retrying POST would duplicate it.
      try { return toClientContact(await client.getContact(created.id)); }
      catch { return toClientContact({ ...localClientToHoldedCreate(input), id: created.id }); }
    },

    async applyLocalChanges(holdedContactId: string, changes: HoldedLocalContactInput): Promise<HoldedClientContact> {
      // GET remoto → merge de campos controlados → PUT completo (reemplazo v2).
      const existing = await client.getContact(holdedContactId);
      const merged = mergeLocalChangesIntoHoldedContact(existing, changes);
      await client.updateContact(holdedContactId, merged);
      return toClientContact(await client.getContact(holdedContactId));
    },
  };
}
