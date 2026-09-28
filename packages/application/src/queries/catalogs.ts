export interface CatalogReader {
  listMaterials(installationId: string): Promise<unknown[]>;
  listEmployees(installationId: string): Promise<unknown[]>;
  listSupplements(installationId: string, employeeId?: string): Promise<unknown[]>;
  listTravels(installationId: string): Promise<unknown[]>;
  listTextTemplates(installationId: string): Promise<unknown[]>;
  listSuppliers(installationId: string): Promise<unknown[]>;
}

export function getCatalog(reader: CatalogReader, kind: "materials" | "employees" | "supplements" | "travels" | "text-templates" | "suppliers") {
  return (installationId: string, employeeId?: string) => {
    if (kind === "materials") return reader.listMaterials(installationId);
    if (kind === "employees") return reader.listEmployees(installationId);
    if (kind === "supplements") return reader.listSupplements(installationId, employeeId);
    if (kind === "travels") return reader.listTravels(installationId);
    if (kind === "text-templates") return reader.listTextTemplates(installationId);
    return reader.listSuppliers(installationId);
  };
}
