import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { catalogMaterials, catalogTravels, employeeSupplements, employees, suppliers, textTemplates } from "../schema/common.js";

export function createCatalogRepository(db: Database) {
  async function validateReferences(installationId: string, input: { supplierId?: string | null | undefined; employeeId?: string | null | undefined }) {
    if (input.supplierId && !(await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.installationId, installationId))))[0]) throw new Error("supplier_not_found");
    if (input.employeeId && !(await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.installationId, installationId))))[0]) throw new Error("employee_not_found");
  }
  function editable<T extends object>(input: T): T {
    const { id, installationId, createdAt, updatedAt, ...changes } = input as T & { id?: unknown; installationId?: unknown; createdAt?: unknown; updatedAt?: unknown };
    return changes as T;
  }
  return {
    listMaterials: (installationId: string) => db.select().from(catalogMaterials).where(eq(catalogMaterials.installationId, installationId)),
    listEmployees: (installationId: string) => db.select().from(employees).where(eq(employees.installationId, installationId)),
    listSupplements: (installationId: string, employeeId?: string) => db.select().from(employeeSupplements).where(and(eq(employeeSupplements.installationId, installationId), employeeId ? eq(employeeSupplements.employeeId, employeeId) : undefined)),
    listTravels: (installationId: string) => db.select().from(catalogTravels).where(eq(catalogTravels.installationId, installationId)),
    listTextTemplates: (installationId: string) => db.select().from(textTemplates).where(eq(textTemplates.installationId, installationId)),
    listSuppliers: (installationId: string) => db.select().from(suppliers).where(eq(suppliers.installationId, installationId)),
    createMaterial: async (input: typeof catalogMaterials.$inferInsert) => { await validateReferences(input.installationId, input); return db.insert(catalogMaterials).values(input).returning(); },
    importMaterials: (installationId: string, rows: Array<Omit<typeof catalogMaterials.$inferInsert, "installationId">>) => db.transaction((tx) => tx.insert(catalogMaterials).values(rows.map((row) => ({ ...row, installationId }))).returning()),
    createEmployee: (input: typeof employees.$inferInsert) => db.insert(employees).values(input).returning(),
    createSupplement: async (input: typeof employeeSupplements.$inferInsert) => { await validateReferences(input.installationId, input); return db.insert(employeeSupplements).values(input).returning(); },
    createTravel: (input: typeof catalogTravels.$inferInsert) => db.insert(catalogTravels).values(input).returning(),
    createTextTemplate: (input: typeof textTemplates.$inferInsert) => db.insert(textTemplates).values(input).returning(),
    createSupplier: (input: typeof suppliers.$inferInsert) => db.insert(suppliers).values(input).returning(),
    updateMaterial: async (id: string, installationId: string, changes: Partial<typeof catalogMaterials.$inferInsert>) => { await validateReferences(installationId, changes); return db.update(catalogMaterials).set({ ...editable(changes), updatedAt: new Date() }).where(and(eq(catalogMaterials.id, id), eq(catalogMaterials.installationId, installationId))).returning(); },
    updateEmployee: (id: string, installationId: string, changes: Partial<typeof employees.$inferInsert>) => db.update(employees).set({ ...editable(changes), updatedAt: new Date() }).where(and(eq(employees.id, id), eq(employees.installationId, installationId))).returning(),
    updateSupplement: async (id: string, installationId: string, changes: Partial<typeof employeeSupplements.$inferInsert>) => { await validateReferences(installationId, changes); return db.update(employeeSupplements).set(editable(changes)).where(and(eq(employeeSupplements.id, id), eq(employeeSupplements.installationId, installationId))).returning(); },
    updateTravel: (id: string, installationId: string, changes: Partial<typeof catalogTravels.$inferInsert>) => db.update(catalogTravels).set({ ...editable(changes), updatedAt: new Date() }).where(and(eq(catalogTravels.id, id), eq(catalogTravels.installationId, installationId))).returning(),
    updateTextTemplate: (id: string, installationId: string, changes: Partial<typeof textTemplates.$inferInsert>) => db.update(textTemplates).set({ ...editable(changes), updatedAt: new Date() }).where(and(eq(textTemplates.id, id), eq(textTemplates.installationId, installationId))).returning(),
    updateSupplier: (id: string, installationId: string, changes: Partial<typeof suppliers.$inferInsert>) => db.update(suppliers).set({ ...editable(changes), updatedAt: new Date() }).where(and(eq(suppliers.id, id), eq(suppliers.installationId, installationId))).returning(),
  };
}
