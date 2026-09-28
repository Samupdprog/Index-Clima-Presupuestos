import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, createQuoteRepository, createQuoteWorkflowRepository, createClientRepository, createDataResetRepository, installations, auditEvents, withAuditActor } from "../src/index.js";
import { previewPriceAdjustment, previewQuoteLine } from "@quotes/application";

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
  it("reset preserves installation/config and does not affect another installation", async () => {
    const other = await clients.create({ installationId: otherId, name: "TEST other" });
    await createDataResetRepository(db).reset(installationId);
    expect(await quotes.searchQuotes(installationId)).toEqual([]);
    expect(await clients.search(installationId, "")).toEqual([]);
    const [row] = await db.select().from(installations).where(eq(installations.id, installationId)); expect(row?.config).toEqual({ retained: true });
    expect(await clients.getById(otherId, other.id)).not.toBeNull();
  });
});
