import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
    await db.delete(clients).where(eq(clients.id, clientId));
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
    for (const quoteId of quoteIds) await db.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    await db.delete(quotes).where(eq(quotes.installationId, installationId));
    await db.delete(referenceCounters).where(eq(referenceCounters.installationId, installationId));
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
    await db.delete(catalogMaterials).where(eq(catalogMaterials.installationId, installationId));
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
    if (quoteId) {
      await db.delete(quoteLineCalculations).where(eq(quoteLineCalculations.calculationRunId, quoteId));
      const runs = await db.select({ id: quoteCalculationRuns.id }).from(quoteCalculationRuns).where(eq(quoteCalculationRuns.quoteId, quoteId));
      for (const run of runs) await db.delete(quoteLineCalculations).where(eq(quoteLineCalculations.calculationRunId, run.id));
      await db.delete(quoteCalculationRuns).where(eq(quoteCalculationRuns.quoteId, quoteId));
      await db.delete(quoteVersions).where(eq(quoteVersions.quoteId, quoteId));
      await db.delete(auditEvents).where(eq(auditEvents.entityId, quoteId));
      const adjustments = await db.select({ id: quotePriceAdjustments.id }).from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quoteId));
      for (const adjustment of adjustments) await db.delete(quotePriceAdjustmentTargets).where(eq(quotePriceAdjustmentTargets.adjustmentId, adjustment.id));
      const lines = await db.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, quoteId));
      for (const line of lines) {
        await db.delete(quoteLineDiscounts).where(eq(quoteLineDiscounts.quoteLineId, line.id));
        await db.delete(quoteLineLaborEntries).where(eq(quoteLineLaborEntries.quoteLineId, line.id));
      }
      await db.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
      await db.delete(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quoteId));
      await db.delete(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, quoteId));
      await db.delete(quotes).where(eq(quotes.id, quoteId));
      await db.delete(referenceCounters).where(eq(referenceCounters.installationId, installationId));
    }
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
    expect(await db.select().from(auditEvents).where(eq(auditEvents.entityId, quoteId))).toHaveLength(9);
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
