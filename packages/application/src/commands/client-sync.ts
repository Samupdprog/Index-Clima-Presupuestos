import type {
  ApplyHoldedSnapshotInput,
  ClientRecord,
  ClientRepository,
  CreateClientCommand,
  HoldedClientContact,
  HoldedContactGateway,
  HoldedLocalContactInput,
  UpdateClientCommand,
} from "../ports/clients.js";

// ---------------------------------------------------------------------------
// Hash estable del snapshot remoto (sin dependencias de Node), para detectar
// si un contacto de Holded cambió y evitar escrituras/refrescos innecesarios.
// ---------------------------------------------------------------------------
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashHoldedSnapshot(snapshot: Record<string, unknown>): string {
  const input = stableStringify(snapshot);
  // FNV-1a 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toLocalContactInput(record: {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}): HoldedLocalContactInput {
  return {
    name: record.name,
    taxId: record.taxId,
    email: record.email,
    phone: record.phone,
    address: record.address,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "holded_sync_failed";
}

export interface ClientSyncDeps {
  clients: ClientRepository;
  /** null si Holded no está habilitado/configurado (modo degradado). */
  holded: HoldedContactGateway | null;
}

// ---------------------------------------------------------------------------
// Upsert de un contacto remoto de Holded en el catálogo local.
// Resolución conservadora: holdedContactId → NIF exacto único → email exacto
// único. Ante ambigüedad no se mezcla ni se crea (se devuelve null).
// ---------------------------------------------------------------------------
export async function upsertHoldedContact(
  clients: ClientRepository,
  installationId: string,
  contact: HoldedClientContact,
): Promise<ClientRecord | null> {
  const payloadHash = hashHoldedSnapshot(contact.snapshot);
  const linked = await clients.findByHoldedContactId(installationId, contact.id);
  if (linked) {
    if (linked.deletedAt) return null;
    if (!contact.isClient) return clients.archive({ installationId, id: linked.id, expectedRevision: linked.revision, source: "holded" });
    // A failed/pending outbound change is never overwritten by a search or reconciliation.
    if (linked.syncStatus === "pending" || linked.syncStatus === "error" || linked.syncStatus === "conflict") return linked;
    // Sin cambios remotos → no reescribimos (evita churn en cada búsqueda).
    if (linked.holdedPayloadHash && linked.holdedPayloadHash === payloadHash) return linked;
    return applySnapshot(clients, installationId, linked.id, contact, payloadHash, linked.revision);
  }
  if (!contact.isClient) return null;

  const match = await resolveUnambiguousMatch(clients, installationId, contact);
  if (match === "ambiguous") return null;

  if (match) {
    // Un cliente local existente sin enlace (o con el mismo enlace) recibe el
    // vínculo y el snapshot; Holded manda sobre los campos sincronizados.
    return applySnapshot(clients, installationId, match.id, contact, payloadHash, match.revision);
  }

  // No existe localmente: lo creamos ya enlazado.
  return clients.create({
    installationId,
    name: contact.name,
    taxId: contact.taxId ?? undefined,
    email: contact.email ?? undefined,
    phone: contact.phone ?? undefined,
    address: contact.address ?? undefined,
    holdedContactId: contact.id,
    syncStatus: "synced",
    holdedSnapshot: contact.snapshot,
    holdedPayloadHash: payloadHash,
    lastSyncedAt: new Date(),
  });
}

async function applySnapshot(
  clients: ClientRepository,
  installationId: string,
  id: string,
  contact: HoldedClientContact,
  payloadHash: string,
  expectedRevision: number,
): Promise<ClientRecord> {
  const input: ApplyHoldedSnapshotInput = {
    installationId,
    id,
    holdedContactId: contact.id,
    name: contact.name,
    taxId: contact.taxId,
    email: contact.email,
    phone: contact.phone,
    address: contact.address,
    holdedSnapshot: contact.snapshot,
    holdedPayloadHash: payloadHash,
    expectedRevision,
  };
  return clients.applyHoldedSnapshot(input);
}

async function resolveUnambiguousMatch(
  clients: ClientRepository,
  installationId: string,
  contact: HoldedClientContact,
): Promise<ClientRecord | "ambiguous" | null> {
  if (contact.taxId) {
    const byTax = await clients.findByTaxId(installationId, contact.taxId);
    const candidates = byTax.filter((c) => !c.holdedContactId || c.holdedContactId === contact.id);
    if (byTax.length > 1) return "ambiguous";
    if (candidates.length === 1) return candidates[0]!;
    if (byTax.length === 1) return "ambiguous"; // el único match ya está enlazado a otro contacto
  }
  if (contact.email) {
    const byEmail = await clients.findByEmail(installationId, contact.email);
    const candidates = byEmail.filter((c) => !c.holdedContactId || c.holdedContactId === contact.id);
    if (byEmail.length > 1) return "ambiguous";
    if (candidates.length === 1) return candidates[0]!;
    if (byEmail.length === 1) return "ambiguous";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Crear cliente desde el Generador (con enlace a Holded si está disponible).
// ---------------------------------------------------------------------------
export function createClientWithHolded(deps: ClientSyncDeps) {
  return async (input: CreateClientCommand): Promise<ClientRecord> => {
    const local = await deps.clients.create({ ...input, syncStatus: "pending" });
    if (!deps.holded) return local;
    try {
      const remote = await deps.holded.createFromLocal(toLocalContactInput(local));
      return await deps.clients.linkHolded({
        installationId: local.installationId,
        id: local.id,
        holdedContactId: remote.id,
        holdedSnapshot: remote.snapshot,
        holdedPayloadHash: hashHoldedSnapshot(remote.snapshot),
        expectedRevision: local.revision,
      });
    } catch (error) {
      // El cliente local queda guardado y marcado como error (recuperable).
      await deps.clients.markSyncError(local.installationId, local.id, errorMessage(error));
      return (await deps.clients.getById(local.installationId, local.id)) ?? local;
    }
  };
}

// ---------------------------------------------------------------------------
// Editar cliente desde el Generador (respeta optimistic locking local).
// ---------------------------------------------------------------------------
export function updateClientWithHolded(deps: ClientSyncDeps) {
  return async (input: UpdateClientCommand): Promise<ClientRecord> => {
    return deps.clients.withSyncLock(input.installationId, input.id, async () => {
    // Optimistic locking local (lanza RevisionConflictError si está obsoleto).
    const updated = await deps.clients.update(input);
    if (!deps.holded || !updated.holdedContactId) return updated;
    try {
      const remote = await deps.holded.applyLocalChanges(updated.holdedContactId, toLocalContactInput(updated));
      return await deps.clients.linkHolded({
        installationId: updated.installationId,
        id: updated.id,
        holdedContactId: remote.id,
        holdedSnapshot: remote.snapshot,
        holdedPayloadHash: hashHoldedSnapshot(remote.snapshot),
        expectedRevision: updated.revision,
      });
    } catch (error) {
      await deps.clients.markSyncError(updated.installationId, updated.id, errorMessage(error));
      return (await deps.clients.getById(updated.installationId, updated.id)) ?? updated;
    }
    });
  };
}

// ---------------------------------------------------------------------------
// Búsqueda combinada local + Holded con degradación segura.
// ---------------------------------------------------------------------------
export type HoldedSearchStatus = "disabled" | "ok" | "degraded";

export interface CombinedSearchResult {
  clients: ClientRecord[];
  holded: HoldedSearchStatus;
}

export function searchClientsWithHolded(deps: ClientSyncDeps) {
  return async (installationId: string, query: string): Promise<CombinedSearchResult> => {
    const localResults = await deps.clients.search(installationId, query);
    const trimmed = query.trim();
    if (!deps.holded || trimmed.length < 2) {
      return { clients: localResults, holded: deps.holded ? "ok" : "disabled" };
    }

    let remote: HoldedClientContact[];
    try {
      remote = await deps.holded.searchContacts(trimmed);
    } catch {
      // Holded caído: seguimos con resultados locales, aviso no bloqueante.
      return { clients: localResults, holded: "degraded" };
    }

    const byId = new Map<string, ClientRecord>();
    for (const record of localResults) byId.set(record.id, record);
    for (const contact of remote) {
      try {
        const upserted = await upsertHoldedContact(deps.clients, installationId, contact);
        if (upserted) byId.set(upserted.id, upserted);
      } catch {
        // Un contacto remoto problemático no debe tumbar toda la búsqueda.
      }
    }

    const merged = [...byId.values()].filter((client) => !client.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
    return { clients: merged, holded: "ok" };
  };
}

export function deleteClientWithHolded(deps: ClientSyncDeps) {
  return async (input: { installationId: string; id: string; expectedRevision: number; deleteFromHolded: boolean }): Promise<ClientRecord> => {
    return deps.clients.withSyncLock(input.installationId, input.id, async () => {
      const local = await deps.clients.getById(input.installationId, input.id);
      if (!local) throw new Error("client_not_found");
      if (local.revision !== input.expectedRevision) throw new Error("revision_conflict");
      if (local.deletedAt) return local;
      if (local.holdedContactId) {
        if (!input.deleteFromHolded) throw new Error("holded_delete_confirmation_required");
        if (!deps.holded) throw new Error("holded_not_configured");
        await deps.holded.deleteContact(local.holdedContactId);
      }
      return deps.clients.archive({ ...input, source: "local" });
    });
  };
}

export function syncClientWithHolded(deps: ClientSyncDeps) {
  return async (input: { installationId: string; id: string; expectedRevision: number }): Promise<ClientRecord> => {
    if (!deps.holded) throw new Error("holded_not_configured");
    const gateway = deps.holded;
    return deps.clients.withSyncLock(input.installationId, input.id, async () => {
      const local = await deps.clients.getById(input.installationId, input.id);
      if (!local || local.deletedAt) throw new Error("client_not_found");
      if (local.revision !== input.expectedRevision) throw new Error("revision_conflict");
      if (!local.holdedContactId) {
        // A failed POST might have created the contact. Resolve exact identity before retry.
        const candidates = (await gateway.searchContacts(local.name)).filter((c) => c.isClient &&
          ((local.taxId && c.taxId?.toLowerCase() === local.taxId.toLowerCase()) || (local.email && c.email?.toLowerCase() === local.email.toLowerCase())));
        if (candidates.length > 1) throw new Error("client_match_ambiguous");
        if (!candidates.length && local.syncStatus === "error") throw new Error("holded_contact_creation_uncertain");
        const remote = candidates[0] ?? await gateway.createFromLocal(toLocalContactInput(local));
        return deps.clients.linkHolded({ ...input, holdedContactId: remote.id, holdedSnapshot: remote.snapshot, holdedPayloadHash: hashHoldedSnapshot(remote.snapshot) });
      }
      const remote = await gateway.getContact(local.holdedContactId);
      if (!remote || !remote.isClient) return deps.clients.archive({ ...input, source: "holded" });
      if (local.syncStatus === "pending" || local.syncStatus === "error") {
        const pushed = await gateway.applyLocalChanges(local.holdedContactId, toLocalContactInput(local));
        return deps.clients.linkHolded({ ...input, holdedContactId: pushed.id, holdedSnapshot: pushed.snapshot, holdedPayloadHash: hashHoldedSnapshot(pushed.snapshot) });
      }
      return (await upsertHoldedContact(deps.clients, input.installationId, remote)) ?? local;
    });
  };
}

export function syncClientsWithHolded(deps: ClientSyncDeps) {
  return async (installationId: string) => {
    if (!deps.holded) throw new Error("holded_not_configured");
    const gateway = deps.holded;
    return deps.clients.withSyncLock(installationId, "reconciliation", async () => {
      const remote = new Map<string, HoldedClientContact>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      // Read the complete inventory first: incomplete reads must never imply deletion.
      for (let pageNumber = 0; ; pageNumber += 1) {
        if (pageNumber >= 1000) throw new Error("holded_pagination_limit");
        const page = await gateway.listContactsPage(cursor);
        for (const contact of page.items) {
          if (!contact.id) throw new Error("holded_invalid_contact");
          remote.set(contact.id, contact);
        }
        if (!page.hasMore) break;
        if (!page.cursor || cursors.has(page.cursor)) throw new Error("holded_invalid_cursor");
        cursors.add(page.cursor);
        cursor = page.cursor;
      }
      let updated = 0;
      let archived = 0;
      let conflicts = 0;
      for (const contact of remote.values()) {
        const before = await deps.clients.findByHoldedContactId(installationId, contact.id);
        const result = await deps.clients.withSyncLock(installationId, before?.id ?? contact.id, () => upsertHoldedContact(deps.clients, installationId, contact));
        if (!result) { if (contact.isClient && !before?.deletedAt) conflicts += 1; continue; }
        if (result.deletedAt) archived += 1;
        else if (!before || result.revision !== before.revision) updated += 1;
        if (result.syncStatus === "pending" || result.syncStatus === "error" || result.syncStatus === "conflict") conflicts += 1;
      }
      for (const local of await deps.clients.search(installationId, "")) {
        if (!local.holdedContactId || remote.has(local.holdedContactId)) continue;
        const contact = await gateway.getContact(local.holdedContactId);
        if (contact) continue;
        await deps.clients.withSyncLock(installationId, local.id, async () => {
          const current = await deps.clients.getById(installationId, local.id);
          if (current && !current.deletedAt) {
            await deps.clients.archive({ installationId, id: current.id, expectedRevision: current.revision, source: "holded" });
            archived += 1;
          }
        });
      }
      return { scanned: remote.size, updated, archived, conflicts, syncedAt: new Date().toISOString() };
    });
  };
}
