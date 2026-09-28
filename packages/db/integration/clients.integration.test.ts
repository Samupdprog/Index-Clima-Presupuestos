import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { upsertHoldedContact, hashHoldedSnapshot, type HoldedClientContact } from "@quotes/application";
import { createInstallationRepository, InstallationNotFoundError } from "../src/index.js";
import {
  clients,
  createClientRepository,
  createDb,
  installations,
  RevisionConflictError,
  createQuoteRepository,
  quoteLines,
  quotes,
  referenceCounters,
  ReadOnlyQuoteError,
  createQuoteWorkflowRepository,
  quoteCalculationRuns,
  quoteLineCalculations,
  quoteLineDiscounts,
  quoteLineLaborEntries,
  quotePriceAdjustments,
  quotePriceAdjustmentTargets,
  quoteTextBlocks,
  quoteVersions,
  auditEvents,
  catalogMaterials,
  createCatalogRepository,
  createDataResetRepository,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for test:integration");
}

describe("clients repository integration", () => {
  const installationId = randomUUID();
  let clientId: string;
  const { db, pool } = createDb(databaseUrl);
  const repository = createClientRepository(db);

  beforeAll(async () => {
    await db.insert(installations).values({
      id: installationId,
      slug: `integration-${installationId}`,
      displayName: "Integration test",
    });
  });

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("creates and gets a client", async () => {
    const created = await repository.create({
      installationId,
      name: "Cliente integración",
      email: "integration@example.test",
    });

    clientId = created.id;
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Cliente integración");
    expect(created.revision).toBe(0);
  });

  it("updates with the expected revision and rejects stale updates", async () => {
    const current = await repository.getById(installationId, clientId);
    expect(current).not.toBeNull();

    const updated = await repository.update({
      id: current!.id,
      installationId,
      expectedRevision: current!.revision,
      phone: "+34900111222",
    });
    expect(updated.phone).toBe("+34900111222");
    expect(updated.revision).toBe(current!.revision + 1);

    await expect(repository.update({
      id: current!.id,
      installationId,
      expectedRevision: current!.revision,
      phone: "stale-update",
    })).rejects.toBeInstanceOf(RevisionConflictError);

    const unchanged = await repository.getById(installationId, clientId);
    expect(unchanged?.phone).toBe("+34900111222");
    expect(unchanged?.revision).toBe(updated.revision);
  });
});

describe("installation config integration", () => {
  const installationId = randomUUID();
  const { db, pool } = createDb(databaseUrl);
  const repo = createInstallationRepository(db);

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("ensures an installation idempotently by fixed id", async () => {
    const first = await repo.ensure({ id: installationId, slug: `cfg-${installationId}`, displayName: "Cfg" });
    expect(first.id).toBe(installationId);
    const second = await repo.ensure({ id: installationId, slug: `cfg-${installationId}`, displayName: "Cfg 2" });
    expect(second.id).toBe(installationId); // sin duplicar
  });

  it("persists and reads back config (survives re-read)", async () => {
    await repo.writeConfig(installationId, { holded: { apiKeyEncrypted: "enc-abc", checkIntervalMinutes: 10 } });
    const config = await repo.getConfig(installationId);
    expect((config.holded as Record<string, unknown>).apiKeyEncrypted).toBe("enc-abc");
  });

  it("throws InstallationNotFoundError on a zero-row update (no silent save)", async () => {
    await expect(repo.writeConfig(randomUUID(), { holded: {} })).rejects.toBeInstanceOf(InstallationNotFoundError);
  });

  it("exists() reflects presence", async () => {
    expect(await repo.exists(installationId)).toBe(true);
    expect(await repo.exists(randomUUID())).toBe(false);
  });
});

describe("clients Holded sync integration", () => {
  const installationId = randomUUID();
  const { db, pool } = createDb(databaseUrl);
  const repository = createClientRepository(db);

  function contact(partial: Partial<HoldedClientContact> & { id: string }): HoldedClientContact {
    return {
      name: "Contacto Holded",
      taxId: null,
      email: null,
      phone: null,
      address: null,
      isClient: true,
      snapshot: { id: partial.id, name: partial.name ?? "Contacto Holded" },
      ...partial,
    };
  }

  beforeAll(async () => {
    await db.insert(installations).values({ id: installationId, slug: `holded-${installationId}`, displayName: "Holded sync" });
  });

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("persists and finds a client by its stable holdedContactId", async () => {
    const created = await repository.create({ installationId, name: "Con enlace", holdedContactId: "hld-1", syncStatus: "synced" });
    expect(created.holdedContactId).toBe("hld-1");
    const found = await repository.findByHoldedContactId(installationId, "hld-1");
    expect(found?.id).toBe(created.id);
  });

  it("creates a linked local client from a new remote contact, and does not duplicate on repeat", async () => {
    const remote = contact({ id: "hld-new", name: "Cliente remoto", taxId: "B-NEW", email: "remote@acme.test", snapshot: { id: "hld-new", name: "Cliente remoto", code: "B-NEW", email: "remote@acme.test" } });
    const first = await upsertHoldedContact(repository, installationId, remote);
    expect(first?.holdedContactId).toBe("hld-new");
    expect(first?.syncStatus).toBe("synced");

    // Segundo upsert con el MISMO snapshot: no-op, sin duplicar.
    const second = await upsertHoldedContact(repository, installationId, remote);
    expect(second?.id).toBe(first?.id);
    const all = await db.select().from(clients).where(and(eq(clients.installationId, installationId), eq(clients.holdedContactId, "hld-new")));
    expect(all).toHaveLength(1);
  });

  it("refreshes local fields and bumps revision when the remote contact changed", async () => {
    const created = await repository.create({ installationId, name: "Antiguo", holdedContactId: "hld-upd", holdedPayloadHash: "stale", syncStatus: "synced" });
    const remote = contact({ id: "hld-upd", name: "Nombre Nuevo", email: "nuevo@acme.test", snapshot: { id: "hld-upd", name: "Nombre Nuevo", email: "nuevo@acme.test" } });
    const refreshed = await upsertHoldedContact(repository, installationId, remote);
    expect(refreshed?.name).toBe("Nombre Nuevo");
    expect(refreshed?.email).toBe("nuevo@acme.test");
    expect(refreshed?.revision).toBe(created.revision + 1);
    expect(refreshed?.holdedPayloadHash).toBe(hashHoldedSnapshot(remote.snapshot));
  });

  it("links a unique local client matched by exact NIF", async () => {
    const local = await repository.create({ installationId, name: "Por NIF", taxId: "B-UNIQUE" });
    const remote = contact({ id: "hld-nif", name: "Por NIF", taxId: "b-unique", snapshot: { id: "hld-nif", code: "B-UNIQUE" } });
    const result = await upsertHoldedContact(repository, installationId, remote);
    expect(result?.id).toBe(local.id);
    expect(result?.holdedContactId).toBe("hld-nif");
  });

  it("does NOT auto-merge or create when the NIF is ambiguous", async () => {
    await repository.create({ installationId, name: "Ambiguo A", taxId: "B-DUP" });
    await repository.create({ installationId, name: "Ambiguo B", taxId: "B-DUP" });
    const before = await db.select().from(clients).where(eq(clients.installationId, installationId));
    const result = await upsertHoldedContact(repository, installationId, contact({ id: "hld-amb", taxId: "B-DUP", snapshot: { id: "hld-amb", code: "B-DUP" } }));
    expect(result).toBeNull();
    const after = await db.select().from(clients).where(eq(clients.installationId, installationId));
    expect(after.length).toBe(before.length); // no se creó duplicado
  });

  it("records a recoverable sync error", async () => {
    const created = await repository.create({ installationId, name: "Con error", holdedContactId: "hld-err", syncStatus: "synced" });
    await repository.markSyncError(installationId, created.id, "holded down");
    const found = await repository.getById(installationId, created.id);
    expect(found?.syncStatus).toBe("error");
    expect(found?.syncError).toBe("holded down");
  });
});

describe("quotes repository integration", () => {
  const installationId = randomUUID();
  const { db, pool } = createDb(databaseUrl);
  const repository = createQuoteRepository(db);
  const quoteIds: string[] = [];

  beforeAll(async () => {
    await db.insert(installations).values({
      id: installationId,
      slug: `quote-integration-${installationId}`,
      displayName: "Quote integration test",
    });
  });

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("creates, duplicates from root and preserves the duplicate root", async () => {
    const root = await repository.create({ installationId, title: "Instalación vivienda" });
    quoteIds.push(root.id);
    expect(root.reference).toBe("P-1");
    expect(root.status).toBe("draft");
    expect(root.origin).toBe("generator");
    expect(root.accessMode).toBe("editable");

    const first = await repository.duplicateQuote(installationId, root.id);
    quoteIds.push(first.id);
    expect(first.title).toBe("Instalación vivienda.1");
    expect(first.duplicateRootQuoteId).toBe(root.id);

    const second = await repository.duplicateQuote(installationId, first.id);
    quoteIds.push(second.id);
    expect(second.title).toBe("Instalación vivienda.2");
    expect(second.duplicateRootQuoteId).toBe(root.id);
  });

  it("rejects normal updates to read-only quotes but allows duplication", async () => {
    const imported = await repository.create({
      installationId,
      title: "Holded estimate",
      origin: "holded",
      accessMode: "read_only",
    });
    quoteIds.push(imported.id);

    await expect(repository.update({
      installationId,
      id: imported.id,
      expectedRevision: imported.revision,
      title: "No permitido",
    })).rejects.toBeInstanceOf(ReadOnlyQuoteError);

    const copy = await repository.duplicateQuote(installationId, imported.id);
    quoteIds.push(copy.id);
    expect(copy.origin).toBe("generator");
    expect(copy.accessMode).toBe("editable");
    expect(copy.holdedEstimateId).toBeNull();
  });

  it("changes status and preserves the Holded link when reopened", async () => {
    const created = await repository.create({ installationId, title: "Estado editable" });
    quoteIds.push(created.id);
    const finalized = await repository.update({ installationId, id: created.id, expectedRevision: created.revision, status: "finalized", holdedEstimateId: "holded-estimate-test" });
    expect(finalized.status).toBe("finalized");
    expect(finalized.holdedEstimateId).toBe("holded-estimate-test");
    const reopened = await repository.update({ installationId, id: created.id, expectedRevision: finalized.revision, status: "draft" });
    expect(reopened.status).toBe("draft");
    expect(reopened.holdedEstimateId).toBe("holded-estimate-test");
  });
});

describe("catalog material import integration", () => {
  const installationId = randomUUID();
  const { db, pool } = createDb(databaseUrl);
  const repository = createCatalogRepository(db);

  beforeAll(async () => {
    await db.insert(installations).values({ id: installationId, slug: `catalog-import-${installationId}`, displayName: "Catalog import" });
  });

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("imports a material batch in one transaction", async () => {
    const imported = await repository.importMaterials(installationId, [
      { name: "Unidad interior", supplierNameSnapshot: "Proveedor A", unit: "ud", supplierUnitPrice: "120.50", saleUnitPrice: "180", igicRate: "7" },
      { name: "Tubería cobre", supplierCode: "COBRE-12", unit: "m", supplierUnitPrice: "8.25", saleUnitPrice: "14.50", igicRate: "7" },
    ]);
    expect(imported).toHaveLength(2);
    expect(imported[0]?.supplierUnitPrice).toBe("120.500000");
    expect(await repository.listMaterials(installationId)).toHaveLength(2);
  });
});

describe("quote vertical workflow integration", () => {
  const installationId = randomUUID();
  const { db, pool } = createDb(databaseUrl);
  const quotesRepository = createQuoteRepository(db);
  const workflow = createQuoteWorkflowRepository(db);
  let quoteId: string;
  let materialLineId: string;
  let laborLineId: string;

  beforeAll(async () => {
    await db.insert(installations).values({ id: installationId, slug: `vertical-${installationId}`, displayName: "Vertical integration" });
  });

  afterAll(async () => {
    await createDataResetRepository(db).reset(installationId);
    await db.delete(auditEvents).where(eq(auditEvents.installationId, installationId));
    await db.delete(installations).where(eq(installations.id, installationId));
    await pool.end();
  });

  it("persists material, labor, travel, adjustment, text and calculation atomically", async () => {
    const quote = await quotesRepository.create({ installationId, title: "Presupuesto vertical" });
    quoteId = quote.id;
    const material = await workflow.addLine({ installationId, quoteId, expectedRevision: 0, type: "material", description: "Material", quantity: "1", igicRate: "7", saleRule: "unit_price", saleRuleValue: "115", supplierUnitPrice: "100" });
    materialLineId = (await quotesRepository.getQuoteById(installationId, quoteId))!.lines[0]!.id;
    await workflow.addSupplierDiscount(installationId, quoteId, materialLineId, 1, "20");
    await workflow.addSupplierDiscount(installationId, quoteId, materialLineId, 2, "5");
    const labor = await workflow.addLine({ installationId, quoteId, expectedRevision: 3, type: "labor", description: "Instalación", quantity: "1", igicRate: "0", saleRule: "unit_price", saleRuleValue: "0" });
    laborLineId = (await quotesRepository.getQuoteById(installationId, quoteId))!.lines[1]!.id;
    await workflow.addLaborEntry(installationId, quoteId, laborLineId, 4, { employeeNameSnapshot: "A", hours: "2", costRateSnapshot: "10", saleRateSnapshot: "20" });
    await workflow.addLaborEntry(installationId, quoteId, laborLineId, 5, { employeeNameSnapshot: "B", hours: "3", costRateSnapshot: "12", saleRateSnapshot: "25" });
    await workflow.addLine({ installationId, quoteId, expectedRevision: 6, type: "travel", description: "Desplazamiento", quantity: "1", igicRate: "3", saleRule: "unit_price", saleRuleValue: "50", directUnitCost: "20" });
    await workflow.addAdjustment(installationId, quoteId, 7, { scope: "quote", mode: "amount", value: "300" });
    await workflow.addText(installationId, quoteId, 8, "Condiciones", "Texto snapshot");

    const result = await quotesRepository.getQuoteById(installationId, quoteId);
    expect(result?.revision).toBe(9);
    expect(result?.lines).toHaveLength(3);
    expect(result?.lines[0]?.discounts).toHaveLength(2);
    expect(result?.lines[1]?.laborEntries).toHaveLength(2);
    expect(result?.priceAdjustments).toHaveLength(1);
    expect(result?.texts).toHaveLength(1);
    expect(result?.calculation).not.toBeNull();
    const runs = await db.select().from(quoteCalculationRuns).where(eq(quoteCalculationRuns.quoteId, quoteId));
    const run = runs.sort((left, right) => right.quoteRevision - left.quoteRevision)[0];
    expect(run?.saleWithoutTax).toBe("580.00");
    expect(run?.taxTotal).toBe("19.78");
    expect(await db.select().from(quoteVersions).where(eq(quoteVersions.quoteId, quoteId))).toHaveLength(9);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, quoteId));
    expect(events).toHaveLength(10);
    expect(events.some((event) => event.action === "quote.created")).toBe(true);
  });

  it("deletes a line after calculations have been persisted", async () => {
    await workflow.deleteLine({ installationId, quoteId, expectedRevision: 9, lineId: materialLineId });

    const result = await quotesRepository.getQuoteById(installationId, quoteId);
    expect(result?.revision).toBe(10);
    expect(result?.lines).toHaveLength(2);
    expect(result?.lines.some((line) => line.id === materialLineId)).toBe(false);
    expect(await db.select().from(quoteLineCalculations).where(eq(quoteLineCalculations.quoteLineId, materialLineId))).toHaveLength(0);
  });

  it("creates and updates a discounted material with one revision per transaction", async () => {
    const line = { description: "Material compuesto", unit: "ud", quantity: "2", igicRate: "7", saleRule: "add_percentage" as const, saleRuleValue: "10", saleBaseMode: "net_cost" as const, baseUnitPrice: null, directUnitCost: null, supplierUnitPrice: "100" };
    await workflow.createLineWithDetails({ installationId, quoteId, expectedRevision: 10, lineType: "material", line, discounts: [{ percentage: "20" }, { percentage: "5" }], laborEntries: [] });
    let result = (await quotesRepository.getQuoteById(installationId, quoteId))!;
    expect(result.revision).toBe(11);
    const created = result.lines.find((item) => item.description === "Material compuesto")!;
    expect(created.discounts.map((item) => Number(item.percentage))).toEqual([20, 5]);
    expect(created.baseUnitPrice).toBe("76.000000");
    expect(result.calculation?.lines.find((item) => item.quoteLineId === created.id)?.baseSale).toBe("167.20");
    await expect(workflow.createLineWithDetails({ installationId, quoteId, expectedRevision: 10, lineType: "material", line, discounts: [], laborEntries: [] })).rejects.toBeInstanceOf(RevisionConflictError);
    result = (await quotesRepository.getQuoteById(installationId, quoteId))!;
    expect(result.lines.filter((item) => item.description === "Material compuesto")).toHaveLength(1);
    await workflow.updateLineDetails({ installationId, quoteId, expectedRevision: 11, lineId: created.id, line, discounts: [{ id: created.discounts[1]!.id, percentage: "5" }, { id: created.discounts[0]!.id, percentage: "10" }], laborEntries: [] });
    result = (await quotesRepository.getQuoteById(installationId, quoteId))!;
    expect(result.revision).toBe(12);
    expect(result.lines.find((item) => item.id === created.id)?.discounts.map((item) => Number(item.percentage))).toEqual([5, 10]);
    expect(result.lines.find((item) => item.id === created.id)?.baseUnitPrice).toBe("85.500000");
  });

  it("creates one labor line with employees and edits them together", async () => {
    const line = { description: "Equipo instalación", unit: "h", quantity: "1", igicRate: "7", saleRule: "unit_price" as const, saleRuleValue: "0", saleBaseMode: "net_cost" as const, baseUnitPrice: null, directUnitCost: null, supplierUnitPrice: null };
    const workers = [{ employeeNameSnapshot: "Juan", hours: "4", costRateSnapshot: "22.50", saleRateSnapshot: "42" }, { employeeNameSnapshot: "Pedro", hours: "3", costRateSnapshot: "21", saleRateSnapshot: "40" }];
    await workflow.createLineWithDetails({ installationId, quoteId, expectedRevision: 12, lineType: "labor", line, discounts: [], laborEntries: workers });
    let result = (await quotesRepository.getQuoteById(installationId, quoteId))!;
    expect(result.revision).toBe(13);
    const created = result.lines.find((item) => item.description === "Equipo instalación")!;
    expect(created.laborEntries).toHaveLength(2);
    expect(result.calculation?.lines.find((item) => item.quoteLineId === created.id)?.baseSale).toBe("288.00");
    await workflow.updateLineDetails({ installationId, quoteId, expectedRevision: 13, lineId: created.id, line, discounts: [], laborEntries: [{ id: created.laborEntries[0]!.id, ...workers[0]!, hours: "5", saleRateSnapshot: "43" }] });
    result = (await quotesRepository.getQuoteById(installationId, quoteId))!;
    expect(result.revision).toBe(14);
    expect(result.lines.find((item) => item.id === created.id)?.laborEntries).toHaveLength(1);
    expect(result.calculation?.lines.find((item) => item.quoteLineId === created.id)?.baseSale).toBe("215.00");
    expect(result.calculation?.lines.find((item) => item.quoteLineId === created.id)?.cost).toBe("112.50");
  });
});
