import { describe, expect, it, vi } from "vitest";
import {
  createClientWithHolded,
  hashHoldedSnapshot,
  searchClientsWithHolded,
  updateClientWithHolded,
  upsertHoldedContact,
} from "./client-sync.js";
import type {
  ApplyHoldedSnapshotInput,
  ClientRecord,
  ClientRepository,
  CreateClientCommand,
  HoldedClientContact,
  HoldedContactGateway,
  LinkHoldedInput,
  UpdateClientCommand,
} from "../ports/clients.js";

const INSTALLATION = "inst-1";

class RevisionConflict extends Error {
  constructor() {
    super("revision_conflict");
    this.name = "RevisionConflictError";
  }
}

function baseRecord(partial: Partial<ClientRecord> & { id: string; name: string }): ClientRecord {
  return {
    installationId: INSTALLATION,
    taxId: null,
    email: null,
    phone: null,
    address: null,
    holdedContactId: null,
    holdedPayloadHash: null,
    syncStatus: "pending",
    lastSyncedAt: null,
    syncError: null,
    revision: 0,
    ...partial,
  };
}

/** Repositorio en memoria con espías, suficiente para la orquestación. */
function fakeRepo(seed: ClientRecord[] = []) {
  const store = new Map<string, ClientRecord>(seed.map((r) => [r.id, r]));
  let counter = seed.length;
  const spies = {
    applyHoldedSnapshot: vi.fn(),
    create: vi.fn(),
    linkHolded: vi.fn(),
    markSyncError: vi.fn(),
  };
  const repo: ClientRepository = {
    async create(input: CreateClientCommand) {
      counter += 1;
      const record = baseRecord({
        id: `local-${counter}`,
        name: input.name,
        taxId: input.taxId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        holdedContactId: input.holdedContactId ?? null,
        holdedPayloadHash: input.holdedPayloadHash ?? null,
        syncStatus: input.syncStatus ?? "pending",
        lastSyncedAt: input.lastSyncedAt ?? null,
      });
      store.set(record.id, record);
      spies.create(input);
      return record;
    },
    async getById(_i, id) {
      return store.get(id) ?? null;
    },
    async search(_i, query) {
      const q = query.trim().toLowerCase();
      return [...store.values()].filter((r) => !q || r.name.toLowerCase().includes(q));
    },
    async findByHoldedContactId(_i, holdedId) {
      return [...store.values()].find((r) => r.holdedContactId === holdedId) ?? null;
    },
    async findByTaxId(_i, taxId) {
      return [...store.values()].filter((r) => r.taxId?.toLowerCase() === taxId.toLowerCase());
    },
    async findByEmail(_i, email) {
      return [...store.values()].filter((r) => r.email?.toLowerCase() === email.toLowerCase());
    },
    async update(input: UpdateClientCommand) {
      const current = store.get(input.id);
      if (!current || current.revision !== input.expectedRevision) throw new RevisionConflict();
      const updated: ClientRecord = {
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        revision: current.revision + 1,
      };
      store.set(updated.id, updated);
      return updated;
    },
    async linkHolded(input: LinkHoldedInput) {
      const current = store.get(input.id)!;
      const updated: ClientRecord = {
        ...current,
        holdedContactId: input.holdedContactId,
        holdedPayloadHash: input.holdedPayloadHash,
        syncStatus: "synced",
        syncError: null,
        lastSyncedAt: new Date(),
      };
      store.set(updated.id, updated);
      spies.linkHolded(input);
      return updated;
    },
    async applyHoldedSnapshot(input: ApplyHoldedSnapshotInput) {
      const current = store.get(input.id)!;
      const updated: ClientRecord = {
        ...current,
        name: input.name,
        taxId: input.taxId,
        email: input.email,
        phone: input.phone,
        address: input.address,
        holdedContactId: input.holdedContactId,
        holdedPayloadHash: input.holdedPayloadHash,
        syncStatus: "synced",
        revision: current.revision + 1,
      };
      store.set(updated.id, updated);
      spies.applyHoldedSnapshot(input);
      return updated;
    },
    async markSyncError(_i, id, message) {
      const current = store.get(id);
      if (current) store.set(id, { ...current, syncStatus: "error", syncError: message });
      spies.markSyncError(id, message);
    },
  };
  return { repo, store, spies };
}

function contact(partial: Partial<HoldedClientContact> & { id: string }): HoldedClientContact {
  return {
    name: "Contacto",
    taxId: null,
    email: null,
    phone: null,
    address: null,
    isClient: true,
    snapshot: { id: partial.id, name: partial.name ?? "Contacto" },
    ...partial,
  };
}

function fakeGateway(overrides: Partial<HoldedContactGateway> = {}): HoldedContactGateway {
  return {
    searchContacts: vi.fn(async () => []),
    getContact: vi.fn(async () => null),
    createFromLocal: vi.fn(async (input) => contact({ id: "remote-1", name: input.name, snapshot: { id: "remote-1", name: input.name } })),
    applyLocalChanges: vi.fn(async (id, input) => contact({ id, name: input.name, snapshot: { id, name: input.name } })),
    ...overrides,
  };
}

describe("createClientWithHolded", () => {
  it("links the new local client to Holded when the gateway is available", async () => {
    const { repo, store } = fakeRepo();
    const gateway = fakeGateway();
    const result = await createClientWithHolded({ clients: repo, holded: gateway })({ installationId: INSTALLATION, name: "ACME" });
    expect(result.holdedContactId).toBe("remote-1");
    expect(result.syncStatus).toBe("synced");
    expect(gateway.createFromLocal).toHaveBeenCalledOnce();
    expect(store.get(result.id)?.holdedContactId).toBe("remote-1");
  });

  it("keeps the client local and pending when Holded is disabled", async () => {
    const { repo } = fakeRepo();
    const result = await createClientWithHolded({ clients: repo, holded: null })({ installationId: INSTALLATION, name: "ACME" });
    expect(result.holdedContactId).toBeNull();
    expect(result.syncStatus).toBe("pending");
  });

  it("saves the client and records a recoverable error if Holded fails", async () => {
    const { repo, spies } = fakeRepo();
    const gateway = fakeGateway({ createFromLocal: vi.fn(async () => { throw new Error("boom"); }) });
    const result = await createClientWithHolded({ clients: repo, holded: gateway })({ installationId: INSTALLATION, name: "ACME" });
    expect(result.id).toBeDefined();
    expect(result.syncStatus).toBe("error");
    expect(spies.markSyncError).toHaveBeenCalledWith(result.id, "boom");
  });
});

describe("updateClientWithHolded", () => {
  it("pushes controlled changes to Holded for a linked client", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Old", holdedContactId: "remote-1", revision: 3, syncStatus: "synced" })]);
    const gateway = fakeGateway();
    const result = await updateClientWithHolded({ clients: repo, holded: gateway })({ installationId: INSTALLATION, id: "local-1", expectedRevision: 3, email: "new@x.test" });
    expect(gateway.applyLocalChanges).toHaveBeenCalledOnce();
    expect(result.revision).toBe(4);
    expect(result.syncStatus).toBe("synced");
  });

  it("propagates a revision conflict from the local update", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Old", revision: 5 })]);
    await expect(
      updateClientWithHolded({ clients: repo, holded: fakeGateway() })({ installationId: INSTALLATION, id: "local-1", expectedRevision: 2, name: "X" }),
    ).rejects.toBeInstanceOf(RevisionConflict);
  });

  it("does not call Holded for an unlinked client", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Old", revision: 0 })]);
    const gateway = fakeGateway();
    await updateClientWithHolded({ clients: repo, holded: gateway })({ installationId: INSTALLATION, id: "local-1", expectedRevision: 0, name: "New" });
    expect(gateway.applyLocalChanges).not.toHaveBeenCalled();
  });

  it("marks a sync error when the remote update fails but keeps the local change", async () => {
    const { repo, store } = fakeRepo([baseRecord({ id: "local-1", name: "Old", holdedContactId: "remote-1", revision: 0, syncStatus: "synced" })]);
    const gateway = fakeGateway({ applyLocalChanges: vi.fn(async () => { throw new Error("holded down"); }) });
    const result = await updateClientWithHolded({ clients: repo, holded: gateway })({ installationId: INSTALLATION, id: "local-1", expectedRevision: 0, name: "New" });
    expect(result.syncStatus).toBe("error");
    expect(store.get("local-1")?.name).toBe("New");
  });
});

describe("upsertHoldedContact — conservative resolution", () => {
  it("creates a new linked local client for an unseen remote contact", async () => {
    const { repo, spies } = fakeRepo();
    const result = await upsertHoldedContact(repo, INSTALLATION, contact({ id: "remote-9", name: "Nuevo", taxId: "B9" }));
    expect(result?.holdedContactId).toBe("remote-9");
    expect(spies.create).toHaveBeenCalledOnce();
  });

  it("is a no-op when the linked contact snapshot has not changed", async () => {
    const c = contact({ id: "remote-1", name: "Same" });
    const hash = hashHoldedSnapshot(c.snapshot);
    const { repo, spies } = fakeRepo([baseRecord({ id: "local-1", name: "Same", holdedContactId: "remote-1", holdedPayloadHash: hash, syncStatus: "synced" })]);
    const result = await upsertHoldedContact(repo, INSTALLATION, c);
    expect(result?.id).toBe("local-1");
    expect(spies.applyHoldedSnapshot).not.toHaveBeenCalled();
  });

  it("refreshes local fields when the linked contact changed remotely", async () => {
    const { repo, spies } = fakeRepo([baseRecord({ id: "local-1", name: "Old", holdedContactId: "remote-1", holdedPayloadHash: "stale", syncStatus: "synced" })]);
    const result = await upsertHoldedContact(repo, INSTALLATION, contact({ id: "remote-1", name: "Renamed" }));
    expect(spies.applyHoldedSnapshot).toHaveBeenCalledOnce();
    expect(result?.name).toBe("Renamed");
  });

  it("links a unique local client matched by exact NIF", async () => {
    const { repo, spies } = fakeRepo([baseRecord({ id: "local-1", name: "ACME", taxId: "B123" })]);
    const result = await upsertHoldedContact(repo, INSTALLATION, contact({ id: "remote-1", name: "ACME", taxId: "b123" }));
    expect(result?.id).toBe("local-1");
    expect(result?.holdedContactId).toBe("remote-1");
    expect(spies.applyHoldedSnapshot).toHaveBeenCalledOnce();
  });

  it("does NOT auto-merge when the NIF is ambiguous (two locals)", async () => {
    const { repo, spies } = fakeRepo([
      baseRecord({ id: "local-1", name: "ACME A", taxId: "B123" }),
      baseRecord({ id: "local-2", name: "ACME B", taxId: "B123" }),
    ]);
    const result = await upsertHoldedContact(repo, INSTALLATION, contact({ id: "remote-1", name: "ACME", taxId: "B123" }));
    expect(result).toBeNull();
    expect(spies.applyHoldedSnapshot).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
  });

  it("ignores supplier contacts (not valid as clients)", async () => {
    const { repo } = fakeRepo();
    const result = await upsertHoldedContact(repo, INSTALLATION, contact({ id: "remote-1", isClient: false }));
    expect(result).toBeNull();
  });
});

describe("searchClientsWithHolded — graceful degradation", () => {
  it("returns local results with a degraded flag when Holded is down", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Pepe" })]);
    const gateway = fakeGateway({ searchContacts: vi.fn(async () => { throw new Error("timeout"); }) });
    const result = await searchClientsWithHolded({ clients: repo, holded: gateway })(INSTALLATION, "Pep");
    expect(result.holded).toBe("degraded");
    expect(result.clients.map((c) => c.id)).toEqual(["local-1"]);
  });

  it("reports disabled and skips Holded when the gateway is null", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Pepe" })]);
    const result = await searchClientsWithHolded({ clients: repo, holded: null })(INSTALLATION, "Pep");
    expect(result.holded).toBe("disabled");
  });

  it("merges freshly upserted remote contacts into the results", async () => {
    const { repo } = fakeRepo([baseRecord({ id: "local-1", name: "Pepe Local" })]);
    const gateway = fakeGateway({ searchContacts: vi.fn(async () => [contact({ id: "remote-1", name: "Pepe Remoto", taxId: "B1" })]) });
    const result = await searchClientsWithHolded({ clients: repo, holded: gateway })(INSTALLATION, "Pepe");
    expect(result.holded).toBe("ok");
    expect(result.clients.some((c) => c.holdedContactId === "remote-1")).toBe(true);
    expect(result.clients.length).toBe(2);
  });
});
