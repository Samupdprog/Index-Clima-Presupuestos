import { and, desc, eq, ilike, max, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { QuoteNotFoundError, ReadOnlyQuoteError, RevisionConflictError } from "../errors.js";
import { clients } from "../schema/common.js";
import { quoteCalculationRuns, quoteLineCalculations, quoteLineDiscounts, quoteLineLaborEntries, quotePriceAdjustmentTargets, quotePriceAdjustments, quoteTextBlocks, quoteVersions, quoteLines, quotes, referenceCounters } from "../schema/quotes.js";

export interface CreateQuoteInput {
  installationId: string;
  title: string;
  clientId?: string;
  origin?: "generator" | "holded";
  accessMode?: "editable" | "read_only";
  status?: "draft" | "ready_for_review" | "finalized" | "archived";
}

export interface UpdateQuoteInput {
  id: string;
  installationId: string;
  expectedRevision: number;
  title?: string;
  clientId?: string | null;
  status?: "draft" | "ready_for_review" | "finalized" | "archived";
  holdedEstimateId?: string;
}

type QueryExecutor = Pick<Database, "select" | "insert" | "update">;

export function createQuoteRepository(db: Database) {
  async function nextReference(tx: QueryExecutor, installationId: string): Promise<string> {
    await tx.insert(referenceCounters).values({ installationId }).onConflictDoNothing();
    const [counter] = await tx.update(referenceCounters)
      .set({ quoteNextValue: sql`${referenceCounters.quoteNextValue} + 1` })
      .where(eq(referenceCounters.installationId, installationId))
      .returning({ value: referenceCounters.quoteNextValue });
    return `P-${Number(counter!.value) - 1}`;
  }

  async function getById(tx: QueryExecutor, installationId: string, id: string) {
    const [quote] = await tx.select().from(quotes).where(and(eq(quotes.installationId, installationId), eq(quotes.id, id))).limit(1);
    if (!quote) return null;
    const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.id)).orderBy(quoteLines.position);
    const lineIds = lines.map((line) => line.id);
    const discounts = lineIds.length ? await tx.select().from(quoteLineDiscounts).where(or(...lineIds.map((lineId) => eq(quoteLineDiscounts.quoteLineId, lineId)))) : [];
    const laborEntries = lineIds.length ? await tx.select().from(quoteLineLaborEntries).where(or(...lineIds.map((lineId) => eq(quoteLineLaborEntries.quoteLineId, lineId)))) : [];
    const adjustments = await tx.select().from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quote.id));
    const adjustmentIds = adjustments.map((adjustment) => adjustment.id);
    const targets = adjustmentIds.length ? await tx.select().from(quotePriceAdjustmentTargets).where(or(...adjustmentIds.map((adjustmentId) => eq(quotePriceAdjustmentTargets.adjustmentId, adjustmentId)))) : [];
    const texts = await tx.select().from(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, quote.id)).orderBy(quoteTextBlocks.position);
    const [run] = await tx.select().from(quoteCalculationRuns).where(eq(quoteCalculationRuns.quoteId, quote.id)).orderBy(desc(quoteCalculationRuns.quoteRevision)).limit(1);
    const calculations = run ? await tx.select().from(quoteLineCalculations).where(eq(quoteLineCalculations.calculationRunId, run.id)) : [];
    return { ...quote, lines: lines.map((line) => ({ ...line, discounts: discounts.filter((discount) => discount.quoteLineId === line.id), laborEntries: laborEntries.filter((entry) => entry.quoteLineId === line.id) })), priceAdjustments: adjustments.map((adjustment) => ({ ...adjustment, targetLineIds: targets.filter((target) => target.adjustmentId === adjustment.id).map((target) => target.quoteLineId) })), texts, calculation: run ? { ...run, lines: calculations } : null, revision: quote.revision };
  }

  return {
    async create(input: CreateQuoteInput) {
      return db.transaction(async (tx) => {
        const reference = await nextReference(tx, input.installationId);
        const [client] = input.clientId
          ? await tx.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.installationId, input.installationId))).limit(1)
          : [];
        const [quote] = await tx.insert(quotes).values({
          installationId: input.installationId,
          reference,
          title: input.title,
          clientId: client?.id,
          clientSnapshot: client ? { id: client.id, name: client.name, taxId: client.taxId, email: client.email, phone: client.phone, address: client.address } : undefined,
          origin: input.origin ?? "generator",
          accessMode: input.accessMode ?? "editable",
          status: input.status ?? "draft",
        }).returning();
        if (!quote) throw new Error("quote_insert_failed");
        return { ...quote, lines: [] };
      });
    },

    async getQuoteById(installationId: string, id: string) {
      return getById(db, installationId, id);
    },

    async searchQuotes(installationId: string, query = "") {
      const rows = await db.select().from(quotes).where(and(
        eq(quotes.installationId, installationId),
        query ? or(ilike(quotes.reference, `%${query}%`), ilike(quotes.title, `%${query}%`)) : undefined,
      )).orderBy(desc(quotes.updatedAt));
      return rows.map((quote) => ({ ...quote, lines: [] }));
    },

    async update(input: UpdateQuoteInput) {
      return db.transaction(async (tx) => {
        const current = await getById(tx, input.installationId, input.id);
        if (!current) throw new QuoteNotFoundError(input.id);
        if (current.accessMode === "read_only") throw new ReadOnlyQuoteError(input.id);
        const { id, installationId, expectedRevision, ...changes } = input;
        const [quote] = await tx.update(quotes).set({ ...changes, revision: expectedRevision + 1, updatedAt: new Date() })
          .where(and(eq(quotes.id, id), eq(quotes.installationId, installationId), eq(quotes.revision, expectedRevision)))
          .returning();
        if (!quote) throw new RevisionConflictError("quote", id);
        return { ...quote, lines: current.lines };
      });
    },

    async duplicateQuote(installationId: string, id: string) {
      return db.transaction(async (tx) => {
        const source = await getById(tx, installationId, id);
        if (!source) throw new QuoteNotFoundError(id);
        const rootId = source.duplicateRootQuoteId ?? source.id;
        const [root] = await tx.select().from(quotes).where(eq(quotes.id, rootId)).for("update");
        const [last] = await tx.select({ sequence: max(quotes.duplicateSequence) }).from(quotes)
          .where(or(eq(quotes.id, rootId), eq(quotes.duplicateRootQuoteId, rootId)));
        const sequence = Number(last?.sequence ?? 0) + 1;
        const reference = await nextReference(tx, installationId);
        const [copy] = await tx.insert(quotes).values({
          installationId,
          reference,
          title: `${root!.title}.${sequence}`,
          clientId: source.clientId,
          clientSnapshot: source.clientSnapshot,
          origin: "generator",
          accessMode: "editable",
          status: "draft",
          duplicatedFromQuoteId: source.id,
          duplicateRootQuoteId: rootId,
          duplicateSequence: sequence,
        }).returning();
        for (const line of source.lines) {
          const { id: _lineId, quoteId: _quoteId, createdAt: _createdAt, updatedAt: _updatedAt, ...lineData } = line;
          await tx.insert(quoteLines).values({ ...lineData, quoteId: copy!.id });
        }
        const result = await getById(tx, installationId, copy!.id);
        if (!result) throw new Error("quote_duplicate_read_failed");
        return result;
      });
    },

    async archiveQuote(input: UpdateQuoteInput) {
      return this.update({ ...input, status: "archived" });
    },
  };
}
