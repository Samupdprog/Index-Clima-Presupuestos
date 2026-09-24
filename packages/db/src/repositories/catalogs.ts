import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { catalogMaterials, catalogTravels, employeeSupplements, employees, suppliers, textTemplates } from "../schema/common.js";

export function createCatalogRepository(db: Database) {
  return {
    listMaterials: (installationId: string) => db.select().from(catalogMaterials).where(eq(catalogMaterials.installationId, installationId)),
    listEmployees: (installationId: string) => db.select().from(employees).where(eq(employees.installationId, installationId)),
    listSupplements: (employeeId?: string) => employeeId ? db.select().from(employeeSupplements).where(eq(employeeSupplements.employeeId, employeeId)) : db.select().from(employeeSupplements),
    listTravels: (installationId: string) => db.select().from(catalogTravels).where(eq(catalogTravels.installationId, installationId)),
    listTextTemplates: (installationId: string) => db.select().from(textTemplates).where(eq(textTemplates.installationId, installationId)),
    listSuppliers: (installationId: string) => db.select().from(suppliers).where(eq(suppliers.installationId, installationId)),
    createMaterial: (input: typeof catalogMaterials.$inferInsert) => db.insert(catalogMaterials).values(input).returning(),
    importMaterials: (installationId: string, rows: Array<Omit<typeof catalogMaterials.$inferInsert, "installationId">>) => db.transaction((tx) => tx.insert(catalogMaterials).values(rows.map((row) => ({ ...row, installationId }))).returning()),
    createEmployee: (input: typeof employees.$inferInsert) => db.insert(employees).values(input).returning(),
    createSupplement: (input: typeof employeeSupplements.$inferInsert) => db.insert(employeeSupplements).values(input).returning(),
    createTravel: (input: typeof catalogTravels.$inferInsert) => db.insert(catalogTravels).values(input).returning(),
    createTextTemplate: (input: typeof textTemplates.$inferInsert) => db.insert(textTemplates).values(input).returning(),
    createSupplier: (input: typeof suppliers.$inferInsert) => db.insert(suppliers).values(input).returning(),
    updateMaterial: (id: string, installationId: string, changes: Partial<typeof catalogMaterials.$inferInsert>) => db.update(catalogMaterials).set({ ...changes, updatedAt: new Date() }).where(and(eq(catalogMaterials.id, id), eq(catalogMaterials.installationId, installationId))).returning(),
    updateEmployee: (id: string, installationId: string, changes: Partial<typeof employees.$inferInsert>) => db.update(employees).set({ ...changes, updatedAt: new Date() }).where(and(eq(employees.id, id), eq(employees.installationId, installationId))).returning(),
    updateSupplement: (id: string, changes: Partial<typeof employeeSupplements.$inferInsert>) => db.update(employeeSupplements).set(changes).where(eq(employeeSupplements.id, id)).returning(),
    updateTravel: (id: string, installationId: string, changes: Partial<typeof catalogTravels.$inferInsert>) => db.update(catalogTravels).set({ ...changes, updatedAt: new Date() }).where(and(eq(catalogTravels.id, id), eq(catalogTravels.installationId, installationId))).returning(),
    updateTextTemplate: (id: string, installationId: string, changes: Partial<typeof textTemplates.$inferInsert>) => db.update(textTemplates).set({ ...changes, updatedAt: new Date() }).where(and(eq(textTemplates.id, id), eq(textTemplates.installationId, installationId))).returning(),
    updateSupplier: (id: string, installationId: string, changes: Partial<typeof suppliers.$inferInsert>) => db.update(suppliers).set({ ...changes, updatedAt: new Date() }).where(and(eq(suppliers.id, id), eq(suppliers.installationId, installationId))).returning(),
  };
}
