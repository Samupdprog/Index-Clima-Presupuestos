import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, createQuoteRepository, createQuoteWorkflowRepository, createClientRepository, createDataResetRepository, createQuoteExportRepository, createCatalogRepository, installations, auditEvents, quotes as quotesTable, withAuditActor } from "../src/index.js";
import { applyMaterialImport, executeQuoteCommand, previewMaterialImport, previewPriceAdjustment, previewQuoteLine, type MaterialImportRepository } from "@quotes/application";
import { quoteCommandSchema } from "@quotes/contracts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
describe("functional closure against PostgreSQL", () => {
  const { db, pool } = createDb(databaseUrl);
  const installationId = randomUUID(), otherId = randomUUID();
  const quotes = createQuoteRepository(db), workflow = createQuoteWorkflowRepository(db), clients = createClientRepository(db);
  let quoteId = "";
  beforeAll(async () => { await db.insert(installations).values([{ id: installationId, slug: installationId, displayName: "TEST closure", config: { retained: true } }, { id: otherId, slug: otherId, displayName: "TEST isolation" }]); });
  afterAll(async () => {
    for (const id of [installationId, otherId]) { await createDataResetRepository(db).reset(id); await db.delete(auditEvents).where(eq(auditEvents.installationId, id)); await db.delete(installations).where(eq(installations.id, id)); }
    await pool.end();
  });
  it("imports five machines atomically and attributes AI audit", async () => {
    const client = await clients.create({ installationId, name: "TEST closure client" });
    const quote = await quotes.create({ installationId, title: "TEST five machines", clientId: client.id }); quoteId = quote.id;
    const lines = ["1283.94", "1260", "1159.20", "1283.94", "762.30"].map((directUnitCost, i) => ({ description: `Machine ${i}`, type: "material" as const, quantity: "1", unit: "ud", directUnitCost, discounts: [], saleBaseMode: "supplier_list_price" as const, igicRate: "7" }));
    await withAuditActor({ actorType: "ai", subject: "integration-agent" }, () => workflow.importQuoteLines({ installationId, quoteId, expectedRevision: 0, lines }));
    const saved = (await quotes.getQuoteById(installationId, quoteId))!;
    expect(saved.revision).toBe(1); expect(saved.calculation.cost).toBe("5749.38"); expect(saved.calculation.saleWithoutTax).toBe("5749.38");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, quoteId));
    expect(events.some((event) => event.actorType === "ai")).toBe(true);
    await expect(workflow.importQuoteLines({ installationId, quoteId, expectedRevision: 0, lines })).rejects.toThrow();
    await expect(workflow.importQuoteLines({ installationId, quoteId, expectedRevision: 1, lines: [{ ...lines[0]!, discounts: ["101"] }] })).rejects.toThrow();
    expect((await quotes.getQuoteById(installationId, quoteId))!.lines).toHaveLength(5);
  });
  it("previews selection without writing and apply exactly matches preview", async () => {
    const quote = (await quotes.getQuoteById(installationId, quoteId))!;
    const request = { expectedRevision: quote.revision, scope: "selection" as const, mode: "amount" as const, value: "300", targetLineIds: [quote.lines[0]!.id, quote.lines[1]!.id] };
    const preview = await previewPriceAdjustment(quotes)(installationId, quoteId, request);
    expect(preview.totals.costBefore).toBe("2543.94"); expect(preview.totals.saleBefore).toBe("2543.94"); expect(preview.totals.saleAfter).toBe("2843.94");
    expect((await quotes.getQuoteById(installationId, quoteId))!.revision).toBe(quote.revision);
    await workflow.addAdjustment(installationId, quoteId, quote.revision, request);
    const updated = (await quotes.getQuoteById(installationId, quoteId))!;
    for (const line of preview.lines) expect(updated.calculation.lines.find((item) => item.id === line.id)!.sale).toBe(line.saleAfter);
    expect(updated.calculation.saleWithoutTax).toBe("6049.38");
    const baseline = await previewPriceAdjustment(quotes)(installationId, quoteId, { ...request, expectedRevision: updated.revision, value: "0" });
    expect(baseline.totals.saleBefore).toBe("2843.94");
    expect(baseline.totals.saleAfter).toBe("2843.94");
    expect(baseline.totals.allocatedAdjustment).toBe("0.00");
    const next = await previewPriceAdjustment(quotes)(installationId, quoteId, { ...request, expectedRevision: updated.revision, value: "100" });
    expect(next.totals.saleBefore).toBe("2843.94");
    expect(next.totals.saleAfter).toBe("2943.94");
    await expect(previewPriceAdjustment(quotes)(installationId, quoteId, request)).rejects.toThrow("revision_conflict");
    expect(await quotes.getQuoteById(otherId, quoteId)).toBeNull();
  });
  it("duplicates details and adjustments and keeps an independent revision", async () => {
    const copy = await quotes.duplicateQuote(installationId, quoteId);
    expect(copy.id).not.toBe(quoteId); expect(copy.priceAdjustments).toHaveLength(1); expect(copy.calculation.saleWithoutTax).toBe("6049.38");
  });
  it("previews gross 40+10 with markup and clears no stored details", async () => {
    const quote = (await quotes.getQuoteById(installationId, quoteId))!;
    const preview = await previewQuoteLine(quotes)(installationId, quoteId, { type: "createQuoteLine", lineType: "material", expectedRevision: quote.revision, line: { description: "TEST", unit: "ud", quantity: "2", supplierUnitPrice: "1000", igicRate: "7", saleRule: "add_percentage", saleRuleValue: "10", saleBaseMode: "supplier_list_price" }, discounts: [{ percentage: "40" }, { percentage: "10" }], laborEntries: [] });
    expect(preview.sale.toString()).toBe("2200"); expect(preview.cost.toString()).toBe("1080");
  });
  it("derives the unit cost from an edited line total on the server", async () => {
    const quote = (await quotes.getQuoteById(installationId, quoteId))!;
    const lineId = quote.lines[2]!.id;
    await workflow.updateLine({ installationId, quoteId, expectedRevision: quote.revision, lineId, changes: { quantity: "3", directTotalCost: "10" } });
    const updated = (await quotes.getQuoteById(installationId, quoteId))!;
    const line = updated.lines.find((item) => item.id === lineId)!;
    expect(line.directUnitCost).toBe("3.333333");
    expect(updated.calculation.lines.find((item) => item.id === lineId)!.cost).toBe("10.00");
    await expect(workflow.updateLine({ installationId, quoteId, expectedRevision: updated.revision, lineId, changes: { quantity: "0", directTotalCost: "10" } })).rejects.toThrow("quantity_required_for_total");
  });
  it("inline edits change only the edited field of a catalog material line", async () => {
    // Mismo camino que la web: el contrato valida el comando y la aplicación lo ejecuta.
    const run = async (command: Record<string, unknown>) => {
      const parsed = quoteCommandSchema.parse(command);
      return executeQuoteCommand(workflow, { ...parsed, installationId, quoteId: draft.id });
    };
    const draft = await quotes.create({ installationId, title: "TEST edición en línea" });
    await run({ type: "createQuoteLine", expectedRevision: draft.revision, lineType: "material", line: { description: "TEST tubo cobre", unit: "m", quantity: "1", igicRate: "3", saleRule: "unit_price", saleRuleValue: "20", saleBaseMode: "net_cost", directUnitCost: "10" }, discounts: [], laborEntries: [] });
    const state = async () => {
      const quote = (await quotes.getQuoteById(installationId, draft.id))!;
      const line = quote.lines[0]!;
      const calc = quote.calculation.lines[0]!;
      return { revision: quote.revision, lineId: line.id, row: { description: line.description, unit: line.unit, quantity: Number(line.quantity), igic: Number(line.igicRate), cost: calc.cost, sale: calc.sale } };
    };
    const edit = async (changes: Record<string, unknown>) => {
      const before = await state();
      await run({ type: "updateQuoteLine", expectedRevision: before.revision, lineId: before.lineId, changes });
      return (await state()).row;
    };
    const base = { description: "TEST tubo cobre", unit: "m", igic: 3 };
    expect(await edit({ directUnitCost: "12" })).toEqual({ ...base, quantity: 1, cost: "12.00", sale: "20.00" });
    expect(await edit({ quantity: "3" })).toEqual({ ...base, quantity: 3, cost: "36.00", sale: "60.00" });
    expect(await edit({ directTotalCost: "45" })).toEqual({ ...base, quantity: 3, cost: "45.00", sale: "60.00" });
    expect(await edit({ saleRule: "unit_price", saleRuleValue: "25" })).toEqual({ ...base, quantity: 3, cost: "45.00", sale: "75.00" });
    expect(await edit({ saleLineTotal: "90" })).toEqual({ ...base, quantity: 3, cost: "45.00", sale: "90.00" });
    // Tras fijar el total, cambiar la cantidad escala la venta con el precio por unidad derivado (30 €).
    expect(await edit({ quantity: "4" })).toEqual({ ...base, quantity: 4, cost: "60.00", sale: "120.00" });
    expect(await edit({ description: "TEST tubo cobre 3/8" })).toEqual({ ...base, description: "TEST tubo cobre 3/8", quantity: 4, cost: "60.00", sale: "120.00" });
    expect(await edit({ igicRate: "7" })).toEqual({ ...base, description: "TEST tubo cobre 3/8", igic: 7, quantity: 4, cost: "60.00", sale: "120.00" });
  });
  it("changes the quote number, rejecting duplicates regardless of case", async () => {
    const other = await quotes.create({ installationId, title: "TEST otro número" });
    const current = (await quotes.getQuoteById(installationId, quoteId))!;
    await expect(quotes.update({ installationId, id: quoteId, expectedRevision: current.revision, reference: other.reference.toLowerCase() })).rejects.toThrow("quote_reference_taken");
    const renamed = await quotes.update({ installationId, id: quoteId, expectedRevision: current.revision, reference: "  TEST-RENOMBRADO  " });
    expect(renamed.reference).toBe("TEST-RENOMBRADO");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, quoteId));
    expect(events.some((event) => event.action === "quote.reference.changed")).toBe(true);
  });
  it("moves to trash, blocks edits, restores and deletes permanently only when allowed", async () => {
    const draft = await quotes.create({ installationId, title: "TEST borrador para borrar" });
    const sent = (await quotes.getQuoteById(installationId, quoteId))!;
    await db.update(quotesTable).set({ holdedEstimateId: randomUUID().replace(/-/g, "").slice(0, 24) }).where(eq(quotesTable.id, sent.id));
    // Enviado a Holded y fuera de la papelera: no se puede eliminar directamente.
    await expect(quotes.deleteQuotePermanently({ installationId, id: sent.id, expectedRevision: sent.revision })).rejects.toThrow("quote_delete_requires_trash");
    const trashed = await quotes.trashQuote({ installationId, id: sent.id, expectedRevision: sent.revision });
    expect(trashed.deletedAt).toBeTruthy();
    expect((await quotes.searchQuotes(installationId, "", "active")).some((quote) => quote.id === sent.id)).toBe(false);
    expect((await quotes.searchQuotes(installationId, "", "trash")).some((quote) => quote.id === sent.id)).toBe(true);
    await expect(workflow.updateLine({ installationId, quoteId: sent.id, expectedRevision: trashed.revision, lineId: trashed.lines[0]!.id, changes: { description: "x" } })).rejects.toThrow();
    const restored = await quotes.restoreQuote({ installationId, id: sent.id, expectedRevision: trashed.revision });
    expect(restored.deletedAt).toBeNull();
    // Borrador nunca enviado: eliminación definitiva directa.
    const result = await quotes.deleteQuotePermanently({ installationId, id: draft.id, expectedRevision: draft.revision });
    expect(result).toMatchObject({ deleted: true, holdedUntouched: true });
    expect(await quotes.getQuoteById(installationId, draft.id)).toBeNull();
    // Desde la papelera también se elimina un presupuesto con líneas, ajustes y cálculos.
    const again = await quotes.trashQuote({ installationId, id: sent.id, expectedRevision: restored.revision });
    await quotes.deleteQuotePermanently({ installationId, id: sent.id, expectedRevision: again.revision });
    expect(await quotes.getQuoteById(installationId, sent.id)).toBeNull();
    expect((await db.select().from(auditEvents).where(eq(auditEvents.entityId, sent.id))).some((event) => event.action === "quote.deleted")).toBe(true);
    quoteId = (await quotes.create({ installationId, title: "TEST sustituto" })).id;
  });
  it("previews and applies a bulk material update exactly once", async () => {
    const catalog = createCatalogRepository(db);
    await catalog.createMaterial({ installationId, name: "TEST tubo", supplierCode: "T-1", supplierNameSnapshot: "TEST proveedor", unit: "m", supplierUnitPrice: "5", saleUnitPrice: "9" });
    const importer = catalog as unknown as MaterialImportRepository;
    const rows = [
      { name: "TEST tubo", supplierCode: "T-1", supplierNameSnapshot: "TEST proveedor", unit: "m", igicRate: "7", supplierUnitPrice: "5,5" },
      { name: "TEST nuevo", supplierCode: "T-2", supplierNameSnapshot: "TEST proveedor", unit: "ud", igicRate: "7", supplierUnitPrice: "10" },
    ];
    const plan = await previewMaterialImport(importer)(installationId, rows);
    expect(plan.summary).toMatchObject({ updated: 1, created: 1, unchanged: 0 });
    expect((await catalog.listMaterials(installationId)).find((item) => item.supplierCode === "T-1")!.supplierUnitPrice).toBe("5.000000");
    await applyMaterialImport(importer)(installationId, rows, plan.planHash);
    const after = await catalog.listMaterials(installationId);
    expect(after.find((item) => item.supplierCode === "T-1")!.supplierUnitPrice).toBe("5.500000");
    expect(after.some((item) => item.supplierCode === "T-2")).toBe(true);
    // Repetir el mismo apply: el catálogo ya cambió, así que el plan antiguo se rechaza.
    await expect(applyMaterialImport(importer)(installationId, rows, plan.planHash)).rejects.toThrow("catalog_changed_since_preview");
    expect((await previewMaterialImport(importer)(installationId, rows)).summary).toMatchObject({ unchanged: 2, created: 0, updated: 0 });
  });
  it("links remote Holded estimates to local quotes only within the installation", async () => {
    const estimateId = randomUUID().replace(/-/g, "").slice(0, 24);
    await createQuoteExportRepository(db).recordId(installationId, quoteId, estimateId);
    const saved = (await quotes.getQuoteById(installationId, quoteId))!;
    expect(await quotes.findByHoldedEstimateIds(installationId, [estimateId, "f".repeat(24)])).toEqual([{ quoteId, reference: saved.reference, holdedEstimateId: estimateId }]);
    expect(await quotes.findByHoldedEstimateIds(otherId, [estimateId])).toEqual([]);
    expect(await quotes.findByHoldedEstimateIds(installationId, [])).toEqual([]);
  });
  it("reset preserves installation/config and does not affect another installation", async () => {
    const other = await clients.create({ installationId: otherId, name: "TEST other" });
    await createDataResetRepository(db).reset(installationId);
    expect(await quotes.searchQuotes(installationId)).toEqual([]);
    expect(await clients.search(installationId, "")).toEqual([]);
    const [row] = await db.select().from(installations).where(eq(installations.id, installationId)); expect(row?.config).toEqual({ retained: true });
    expect(await clients.getById(otherId, other.id)).not.toBeNull();
  });
});
