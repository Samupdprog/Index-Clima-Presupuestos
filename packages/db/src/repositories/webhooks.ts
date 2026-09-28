import { and, eq, isNull, lte } from "drizzle-orm";
import type { Database } from "../client.js";
import { holdedWebhookEvents, holdedSyncCursors } from "../schema/operations.js";
export function createWebhookRepository(db: Database) {
  return {
    async receive(installationId: string, externalEventId: string, eventType: string, entityId: string) {
      const rows = await db.insert(holdedWebhookEvents).values({ installationId, externalEventId, eventType, payload: { id: entityId } }).onConflictDoNothing().returning({ id: holdedWebhookEvents.id });
      return { accepted: true, duplicate: rows.length === 0 };
    },
    async completeReconciliation(installationId: string, startedAt: Date) {
      await db.transaction(async (tx) => {
        await tx.update(holdedWebhookEvents).set({ processedAt: new Date(), error: null }).where(and(eq(holdedWebhookEvents.installationId, installationId), isNull(holdedWebhookEvents.processedAt), lte(holdedWebhookEvents.createdAt, startedAt)));
        await tx.insert(holdedSyncCursors).values({ installationId, resource: "contacts", cursor: null }).onConflictDoUpdate({ target: [holdedSyncCursors.installationId, holdedSyncCursors.resource], set: { updatedAt: new Date(), cursor: null } });
      });
    },
  };
}
