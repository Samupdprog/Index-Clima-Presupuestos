import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { auditActor } from "../audit-context.js";
import { QuoteNotFoundError, ReadOnlyQuoteError, RevisionConflictError } from "../errors.js";
import { quotes } from "../schema/quotes.js";
import { auditEvents } from "../schema/operations.js";

export function createQuoteExportRepository(db: Database) {
  const where = (installationId: string, quoteId: string) => and(eq(quotes.installationId, installationId), eq(quotes.id, quoteId));
  return {
    async withLock<T>(installationId: string, quoteId: string, work: () => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`quote-export:${installationId}:${quoteId}`}, 0))`);
        return work();
      });
    },
    async reserve(installationId: string, quoteId: string, expectedRevision: number) {
      return db.transaction(async (tx) => {
        const [quote] = await tx.select().from(quotes).where(where(installationId, quoteId)).for("update");
        if (!quote) throw new QuoteNotFoundError(quoteId);
        if (quote.revision !== expectedRevision) throw new RevisionConflictError("quote", quoteId);
        if (quote.accessMode === "read_only" || quote.status === "archived") throw new ReadOnlyQuoteError(quoteId);
        const uncertain = !quote.holdedEstimateId && ["processing", "uncertain"].includes(quote.holdedSyncStatus);
        await tx.update(quotes).set({ holdedSyncStatus: "processing", holdedSyncError: null }).where(where(installationId, quoteId));
        await tx.insert(auditEvents).values({ installationId, ...auditActor(), action: "quote.holded.start", entityType: "quote", entityId: quoteId, after: { revision: expectedRevision, estimateId: quote.holdedEstimateId, recovering: uncertain } });
        return { documentId: quote.holdedEstimateId, uncertain };
      });
    },
    async recordId(installationId: string, quoteId: string, documentId: string | null) {
      await db.update(quotes).set({ holdedEstimateId: documentId }).where(where(installationId, quoteId));
    },
    async complete(installationId: string, quoteId: string, exportedRevision: number) {
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(quotes).where(where(installationId, quoteId)).for("update");
        if (!current) throw new QuoteNotFoundError(quoteId);
        const unchanged = current.revision === exportedRevision;
        await tx.update(quotes).set({ holdedSyncStatus: unchanged ? "synced" : "pending", holdedSyncError: null, holdedLastSyncedAt: new Date(), holdedLastSyncedRevision: unchanged ? exportedRevision + 1 : exportedRevision, ...(unchanged ? { status: "finalized" as const, revision: exportedRevision + 1 } : {}), updatedAt: new Date() }).where(where(installationId, quoteId));
        await tx.insert(auditEvents).values({ installationId, ...auditActor(), action: "quote.holded.completed", entityType: "quote", entityId: quoteId, after: { exportedRevision, estimateId: current.holdedEstimateId, current: unchanged } });
      });
    },
    async fail(installationId: string, quoteId: string, message: string, uncertain: boolean) {
      await db.transaction(async (tx) => {
        await tx.update(quotes).set({ holdedSyncStatus: uncertain ? "uncertain" : "error", holdedSyncError: message.slice(0, 500) }).where(where(installationId, quoteId));
        await tx.insert(auditEvents).values({ installationId, ...auditActor(), action: "quote.holded.failed", entityType: "quote", entityId: quoteId, after: { error: message.slice(0, 500), uncertain } });
      });
    },
  };
}
