import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { auditActor } from "../audit-context.js";
import * as s from "../schema/index.js";
import { InstallationNotFoundError } from "../errors.js";

/** Scoped transactional reset. No remote calls; installation/config/users survive. */
export function createDataResetRepository(db: Database) {
  return {
    async reset(installationId: string) {
      return db.transaction(async (tx) => {
        const rows = await tx.select({ id: s.installations.id }).from(s.installations).where(eq(s.installations.id, installationId)).for("update");
        if (!rows[0]) throw new InstallationNotFoundError(installationId);
        const quoteIds = tx.select({ id: s.quotes.id }).from(s.quotes).where(eq(s.quotes.installationId, installationId));
        const lineIds = tx.select({ id: s.quoteLines.id }).from(s.quoteLines).where(inArray(s.quoteLines.quoteId, quoteIds));
        const adjustmentIds = tx.select({ id: s.quotePriceAdjustments.id }).from(s.quotePriceAdjustments).where(inArray(s.quotePriceAdjustments.quoteId, quoteIds));
        const runIds = tx.select({ id: s.quoteCalculationRuns.id }).from(s.quoteCalculationRuns).where(inArray(s.quoteCalculationRuns.quoteId, quoteIds));
        const employeeIds = tx.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.installationId, installationId));
        const [counts] = await tx.select({ count: sql<number>`count(*)::int` }).from(s.quotes).where(eq(s.quotes.installationId, installationId));
        await tx.delete(s.priceAdjustmentAllocations).where(inArray(s.priceAdjustmentAllocations.quoteId, quoteIds));
        await tx.delete(s.priceAdjustmentApplications).where(inArray(s.priceAdjustmentApplications.adjustmentId, adjustmentIds));
        await tx.delete(s.quotePriceAdjustmentTargets).where(inArray(s.quotePriceAdjustmentTargets.adjustmentId, adjustmentIds));
        await tx.delete(s.quotePriceAdjustments).where(inArray(s.quotePriceAdjustments.quoteId, quoteIds));
        await tx.delete(s.quoteLineCalculations).where(inArray(s.quoteLineCalculations.calculationRunId, runIds));
        await tx.delete(s.quoteCalculationRuns).where(inArray(s.quoteCalculationRuns.quoteId, quoteIds));
        await tx.delete(s.quoteLineDiscounts).where(inArray(s.quoteLineDiscounts.quoteLineId, lineIds));
        await tx.delete(s.quoteLineLaborEntries).where(inArray(s.quoteLineLaborEntries.quoteLineId, lineIds));
        await tx.delete(s.quoteLines).where(inArray(s.quoteLines.quoteId, quoteIds));
        await tx.delete(s.quoteTextBlocks).where(inArray(s.quoteTextBlocks.quoteId, quoteIds));
        await tx.delete(s.quoteVersions).where(inArray(s.quoteVersions.quoteId, quoteIds));
        await tx.delete(s.quotes).where(eq(s.quotes.installationId, installationId));
        await tx.delete(s.employeeSupplements).where(eq(s.employeeSupplements.installationId, installationId));
        await tx.delete(s.catalogMaterials).where(eq(s.catalogMaterials.installationId, installationId));
        await tx.delete(s.catalogTravels).where(eq(s.catalogTravels.installationId, installationId));
        await tx.delete(s.employees).where(eq(s.employees.installationId, installationId));
        await tx.delete(s.suppliers).where(eq(s.suppliers.installationId, installationId));
        await tx.delete(s.textTemplates).where(eq(s.textTemplates.installationId, installationId));
        await tx.delete(s.clients).where(eq(s.clients.installationId, installationId));
        for (const table of [s.jobs, s.holdedOperations, s.holdedEntitySnapshots, s.holdedWebhookEvents, s.holdedSyncCursors, s.idempotencyKeys]) {
          await tx.delete(table).where(eq(table.installationId, installationId));
        }
        await tx.delete(s.referenceCounters).where(eq(s.referenceCounters.installationId, installationId));
        await tx.insert(s.auditEvents).values({ installationId, ...auditActor(), action: "reset_functional_data", entityType: "installation", entityId: installationId, after: { deletedQuotes: counts?.count ?? 0 } });
        return { reset: true, preserved: ["installation", "configuration", "users", "audit"], holdedUntouched: true };
      });
    },
  };
}
