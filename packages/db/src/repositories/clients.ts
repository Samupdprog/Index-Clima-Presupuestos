import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { RevisionConflictError } from "../errors.js";
import { clients } from "../schema/common.js";

export type ClientSyncStatus = "pending" | "synced" | "error" | "conflict";

export interface CreateClientInput {
  installationId: string;
  name: string;
  taxId?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  holdedContactId?: string | undefined;
  syncStatus?: ClientSyncStatus | undefined;
  holdedSnapshot?: Record<string, unknown> | undefined;
  holdedPayloadHash?: string | undefined;
  lastSyncedAt?: Date | undefined;
}

export interface UpdateClientInput extends Partial<Omit<CreateClientInput, "installationId" | "holdedContactId" | "syncStatus" | "holdedSnapshot" | "holdedPayloadHash" | "lastSyncedAt">> {
  id: string;
  installationId: string;
  expectedRevision: number;
}

export interface LinkHoldedInput {
  installationId: string;
  id: string;
  holdedContactId: string;
  holdedSnapshot: Record<string, unknown>;
  holdedPayloadHash: string;
}

export interface ApplyHoldedSnapshotInput {
  installationId: string;
  id: string;
  holdedContactId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  holdedSnapshot: Record<string, unknown>;
  holdedPayloadHash: string;
}

export function createClientRepository(db: Database) {
  return {
    async create(input: CreateClientInput) {
      const [client] = await db.insert(clients).values(input).returning();
      if (!client) throw new Error("client_insert_failed");
      return client;
    },

    async getById(installationId: string, id: string) {
      const [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.installationId, installationId), eq(clients.id, id)))
        .limit(1);
      return client ?? null;
    },

    async search(installationId: string, query: string) {
      const trimmed = query.trim();
      const filter = trimmed
        ? and(
            eq(clients.installationId, installationId),
            or(
              ilike(clients.name, `%${trimmed}%`),
              ilike(clients.email, `%${trimmed}%`),
              ilike(clients.taxId, `%${trimmed}%`),
            ),
          )
        : eq(clients.installationId, installationId);
      return db.select().from(clients).where(filter).orderBy(clients.name);
    },

    async findByHoldedContactId(installationId: string, holdedContactId: string) {
      const [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.installationId, installationId), eq(clients.holdedContactId, holdedContactId)))
        .limit(1);
      return client ?? null;
    },

    async findByTaxId(installationId: string, taxId: string) {
      return db
        .select()
        .from(clients)
        .where(and(eq(clients.installationId, installationId), sql`lower(${clients.taxId}) = lower(${taxId})`));
    },

    async findByEmail(installationId: string, email: string) {
      return db
        .select()
        .from(clients)
        .where(and(eq(clients.installationId, installationId), sql`lower(${clients.email}) = lower(${email})`));
    },

    async update(input: UpdateClientInput) {
      const { id, installationId, expectedRevision, ...changes } = input;
      const [client] = await db
        .update(clients)
        .set({ ...changes, revision: expectedRevision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(clients.id, id),
            eq(clients.installationId, installationId),
            eq(clients.revision, expectedRevision),
          ),
        )
        .returning();
      if (!client) throw new RevisionConflictError("client", id);
      return client;
    },

    /** Enlaza un cliente local recién creado con su contacto de Holded. */
    async linkHolded(input: LinkHoldedInput) {
      const [client] = await db
        .update(clients)
        .set({
          holdedContactId: input.holdedContactId,
          holdedSnapshot: input.holdedSnapshot,
          holdedPayloadHash: input.holdedPayloadHash,
          syncStatus: "synced",
          syncError: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, input.id), eq(clients.installationId, input.installationId)))
        .returning();
      if (!client) throw new Error("client_link_failed");
      return client;
    },

    /**
     * Refresco desde Holded: sobrescribe los campos sincronizados y sube la
     * revisión (política Holded-manda). Sólo escribe el hash de payload nuevo.
     */
    async applyHoldedSnapshot(input: ApplyHoldedSnapshotInput) {
      const [client] = await db
        .update(clients)
        .set({
          name: input.name,
          taxId: input.taxId,
          email: input.email,
          phone: input.phone,
          address: input.address,
          holdedContactId: input.holdedContactId,
          holdedSnapshot: input.holdedSnapshot,
          holdedPayloadHash: input.holdedPayloadHash,
          syncStatus: "synced",
          syncError: null,
          lastSyncedAt: new Date(),
          revision: sql`${clients.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, input.id), eq(clients.installationId, input.installationId)))
        .returning();
      if (!client) throw new Error("client_snapshot_failed");
      return client;
    },

    async markSyncError(installationId: string, id: string, message: string) {
      await db
        .update(clients)
        .set({ syncStatus: "error", syncError: message.slice(0, 500), updatedAt: new Date() })
        .where(and(eq(clients.id, id), eq(clients.installationId, installationId)));
    },
  };
}
