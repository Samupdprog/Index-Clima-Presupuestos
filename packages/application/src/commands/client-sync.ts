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
  if (!contact.isClient) return null;
  const payloadHash = hashHoldedSnapshot(contact.snapshot);

  const linked = await clients.findByHoldedContactId(installationId, contact.id);
  if (linked) {
    // Sin cambios remotos → no reescribimos (evita churn en cada búsqueda).
    if (linked.holdedPayloadHash && linked.holdedPayloadHash === payloadHash) return linked;
    return applySnapshot(clients, installationId, linked.id, contact, payloadHash);
  }

  const match = await resolveUnambiguousMatch(clients, installationId, contact);
  if (match === "ambiguous") return null;

  if (match) {
    // Un cliente local existente sin enlace (o con el mismo enlace) recibe el
    // vínculo y el snapshot; Holded manda sobre los campos sincronizados.
    return applySnapshot(clients, installationId, match.id, contact, payloadHash);
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

function applySnapshot(
  clients: ClientRepository,
  installationId: string,
  id: string,
  contact: HoldedClientContact,
  payloadHash: string,
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
      });
    } catch (error) {
      await deps.clients.markSyncError(updated.installationId, updated.id, errorMessage(error));
      return (await deps.clients.getById(updated.installationId, updated.id)) ?? updated;
    }
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

    const merged = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { clients: merged, holded: "ok" };
  };
}
