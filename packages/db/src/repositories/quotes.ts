import { and, asc, desc, eq, ilike, isNull, max, or, sql } from "drizzle-orm";
import { calculateQuoteRecord } from "@quotes/application";
import { serializeQuoteCalculation, PricingValidationError } from "@quotes/domain";
import type { Database } from "../client.js";
import { QuoteNotFoundError, ReadOnlyQuoteError, RevisionConflictError } from "../errors.js";
import { clients } from "../schema/common.js";
import { auditEvents } from "../schema/operations.js";
import { auditActor } from "../audit-context.js";
import { finalizeQuoteMutation } from "./quote-workflow.js";
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
    const discounts = lineIds.length ? await tx.select().from(quoteLineDiscounts).where(or(...lineIds.map((lineId) => eq(quoteLineDiscounts.quoteLineId, lineId)))).orderBy(asc(quoteLineDiscounts.position)) : [];
    const laborEntries = lineIds.length ? await tx.select().from(quoteLineLaborEntries).where(or(...lineIds.map((lineId) => eq(quoteLineLaborEntries.quoteLineId, lineId)))) : [];
    const adjustments = await tx.select().from(quotePriceAdjustments).where(eq(quotePriceAdjustments.quoteId, quote.id)).orderBy(asc(quotePriceAdjustments.baseQuoteRevision), asc(quotePriceAdjustments.createdAt), asc(quotePriceAdjustments.id));
    const adjustmentIds = adjustments.map((adjustment) => adjustment.id);
    const targets = adjustmentIds.length ? await tx.select().from(quotePriceAdjustmentTargets).where(or(...adjustmentIds.map((adjustmentId) => eq(quotePriceAdjustmentTargets.adjustmentId, adjustmentId)))) : [];
    const texts = await tx.select().from(quoteTextBlocks).where(eq(quoteTextBlocks.quoteId, quote.id)).orderBy(quoteTextBlocks.position);
    const [run] = await tx.select().from(quoteCalculationRuns).where(eq(quoteCalculationRuns.quoteId, quote.id)).orderBy(desc(quoteCalculationRuns.quoteRevision)).limit(1);
    const result = { ...quote, lines: lines.map((line) => ({ ...line, discounts: discounts.filter((discount) => discount.quoteLineId === line.id), laborEntries: laborEntries.filter((entry) => entry.quoteLineId === line.id) })), priceAdjustments: adjustments.map((adjustment) => ({ ...adjustment, targetLineIds: targets.filter((target) => target.adjustmentId === adjustment.id).map((target) => target.quoteLineId) })), texts };
    const calculation = serializeQuoteCalculation(calculateQuoteRecord(result));
    return { ...result, calculation: { ...run, ...calculation, quoteRevision: quote.revision }, revision: quote.revision };
  }

  return {
    async create(input: CreateQuoteInput) {
      return db.transaction(async (tx) => {
        const reference = await nextReference(tx, input.installationId);
        const [client] = input.clientId
          ? await tx.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.installationId, input.installationId), isNull(clients.deletedAt))).limit(1)
          : [];
        if (input.clientId && !client) throw new PricingValidationError("client_not_found");
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
        await tx.insert(auditEvents).values({ installationId: input.installationId, ...auditActor(), action: "quote.created", entityType: "quote", entityId: quote.id, after: { revision: quote.revision } });
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
        if (current.accessMode === "read_only" || current.status === "archived") throw new ReadOnlyQuoteError(input.id);
        const { id, installationId, expectedRevision, ...changes } = input;
        let clientSnapshot = current.clientSnapshot;
        if (input.clientId !== undefined) {
          const [client] = input.clientId ? await tx.select().from(clients).where(and(eq(clients.id, input.clientId), eq(clients.installationId, installationId), isNull(clients.deletedAt))).limit(1) : [];
          if (input.clientId && !client) throw new PricingValidationError("client_not_found");
          clientSnapshot = client ? { id: client.id, name: client.name, taxId: client.taxId, email: client.email, phone: client.phone, address: client.address } : null;
        }
        const [quote] = await tx.update(quotes).set({ ...changes, clientSnapshot, revision: expectedRevision + 1, updatedAt: new Date() })
          .where(and(eq(quotes.id, id), eq(quotes.installationId, installationId), eq(quotes.revision, expectedRevision)))
          .returning();
        if (!quote) throw new RevisionConflictError("quote", id);
        await tx.insert(auditEvents).values({ installationId, ...auditActor(), action: "quote.updated", entityType: "quote", entityId: id, after: { revision: quote.revision } });
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
        const lineIds = new Map<string, string>();
        for (const line of source.lines) {
          const { id: oldId, quoteId: _quoteId, createdAt: _createdAt, updatedAt: _updatedAt, discounts, laborEntries, ...lineData } = line;
          const [created] = await tx.insert(quoteLines).values({ ...lineData, quoteId: copy!.id }).returning({ id: quoteLines.id });
          lineIds.set(oldId, created!.id);
          for (const { id: _id, quoteLineId: _lineId, ...discount } of discounts) await tx.insert(quoteLineDiscounts).values({ ...discount, quoteLineId: created!.id });
          for (const { id: _id, quoteLineId: _lineId, ...entry } of laborEntries) await tx.insert(quoteLineLaborEntries).values({ ...entry, quoteLineId: created!.id });
        }
        for (const [index, adjustment] of source.priceAdjustments.entries()) {
          const { id: _id, quoteId: _quoteId, createdAt: _createdAt, createdBy: _createdBy, targetLineIds, ...values } = adjustment;
          const [created] = await tx.insert(quotePriceAdjustments).values({ ...values, quoteId: copy!.id, baseQuoteRevision: index }).returning({ id: quotePriceAdjustments.id });
          for (const lineId of targetLineIds) await tx.insert(quotePriceAdjustmentTargets).values({ adjustmentId: created!.id, quoteLineId: lineIds.get(lineId)! });
        }
        for (const { id: _id, quoteId: _quoteId, ...text } of source.texts) await tx.insert(quoteTextBlocks).values({ ...text, quoteId: copy!.id });
        await finalizeQuoteMutation(tx, copy!.id, installationId, 0, "quote.duplicated");
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
