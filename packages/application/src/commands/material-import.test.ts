import { describe, expect, it, vi } from "vitest";
import { applyMaterialImport, planMaterialImport, type CatalogMaterialSnapshot } from "./material-import.js";

const base: CatalogMaterialSnapshot = { id: "m1", name: "Tubo cobre 1/4", supplierNameSnapshot: "Salvador Escoda", supplierCode: "SE-100", unit: "m", supplierUnitPrice: "5.000000", saleUnitPrice: "9.000000", igicRate: "7.00", description: null, active: true };
const catalog: CatalogMaterialSnapshot[] = [
  base,
  { ...base, id: "m2", name: "Split 3,5 kW", supplierCode: "SE-200", unit: "ud", supplierUnitPrice: "300.000000", saleUnitPrice: "500.000000" },
  { ...base, id: "m3", name: "Soporte pared", supplierCode: null, supplierNameSnapshot: null, unit: "ud", supplierUnitPrice: "12.000000", saleUnitPrice: null, active: false },
];
const row = (overrides: Record<string, string>) => ({ name: "Tubo cobre 1/4", unit: "m", igicRate: "7", ...overrides });

describe("material import plan", () => {
  it("classifies unchanged, updated and new rows comparing decimals by value", () => {
    const plan = planMaterialImport(catalog, [
      row({ supplierNameSnapshot: "Salvador Escoda", supplierCode: "SE-100", supplierUnitPrice: "5,00", saleUnitPrice: "9" }),
      row({ name: "Split 3,5 kW", supplierNameSnapshot: "Salvador Escoda", supplierCode: "SE-200", unit: "ud", supplierUnitPrice: "320.5" }),
      row({ name: "Bomba condensados", supplierCode: "SE-999", unit: "ud", supplierUnitPrice: "45" }),
    ]);
    expect(plan.summary).toEqual({ total: 3, created: 1, updated: 1, unchanged: 1, invalid: 0 });
    expect(plan.items[1]).toMatchObject({ action: "update", materialId: "m2", changes: [{ field: "supplierUnitPrice", before: "300.000000", after: "320.5" }] });
    expect(plan.items[2]).toMatchObject({ action: "create", materialId: null });
  });
  it("keeps current values for empty cells and reactivates inactive matches", () => {
    const plan = planMaterialImport(catalog, [row({ name: "Soporte pared", unit: "ud" })]);
    expect(plan.items[0]).toMatchObject({ action: "update", materialId: "m3", changes: [{ field: "active", before: false, after: true }] });
  });
  it("does not overwrite unit or IGIC when those cells are empty, and defaults them for new materials", () => {
    const plan = planMaterialImport(catalog, [{ name: "Split 3,5 kW", supplierCode: "SE-200", supplierUnitPrice: "310" }, { name: "Válvula nueva", supplierUnitPrice: "4.5", saleUnitPrice: "9", igicRate: "3" }, { name: "Racor nuevo" }]);
    expect(plan.items[0]).toMatchObject({ action: "update", changes: [{ field: "supplierUnitPrice", before: "300.000000", after: "310" }] });
    const created = (index: number) => Object.fromEntries(plan.items[index]!.changes.map((change) => [change.field, change.after]));
    expect(created(1)).toEqual({ name: "Válvula nueva", unit: "ud", igicRate: "3", supplierUnitPrice: "4.5", saleUnitPrice: "9" });
    expect(created(2)).toEqual({ name: "Racor nuevo", unit: "ud", igicRate: "7" });
  });
  it("flags duplicated rows and ambiguous matches instead of guessing", () => {
    const twins = [...catalog, { ...base, id: "m4" }];
    const plan = planMaterialImport(twins, [row({ supplierCode: "SE-100" }), row({ name: "Otro", supplierCode: "se-200 " }), row({ name: "Otro", supplierCode: "SE-200" })]);
    expect(plan.items.map((item) => item.reason ?? item.action)).toEqual(["ambiguous_match", "update", "duplicate_row"]);
    expect(plan.summary.invalid).toBe(2);
  });
  it("never deactivates materials missing from the file and produces a stable hash", () => {
    const rows = [row({ supplierCode: "SE-100", supplierUnitPrice: "6" })];
    const first = planMaterialImport(catalog, rows);
    expect(first.items).toHaveLength(1);
    expect(planMaterialImport(catalog, rows).planHash).toBe(first.planHash);
    expect(planMaterialImport(catalog, [row({ supplierCode: "SE-100", supplierUnitPrice: "7" })]).planHash).not.toBe(first.planHash);
  });
});

describe("apply material import", () => {
  it("applies exactly the previewed plan", async () => {
    const repository = { listMaterials: vi.fn().mockResolvedValue(catalog), applyMaterialImport: vi.fn() };
    const rows = [row({ supplierCode: "SE-100", supplierUnitPrice: "6" }), row({ name: "Nuevo", supplierCode: "N-1" })];
    const preview = planMaterialImport(catalog, rows);
    await applyMaterialImport(repository)("installation", rows, preview.planHash);
    expect(repository.applyMaterialImport).toHaveBeenCalledWith("installation", expect.objectContaining({ updates: [{ id: "m1", changes: { supplierUnitPrice: "6" } }], creates: [expect.objectContaining({ name: "Nuevo", supplierCode: "N-1" })] }));
  });
  it("refuses to write when the catalog changed since the preview or rows are invalid", async () => {
    const rows = [row({ supplierCode: "SE-100", supplierUnitPrice: "6" })];
    const preview = planMaterialImport(catalog, rows);
    const changed = { listMaterials: vi.fn().mockResolvedValue([{ ...base, supplierUnitPrice: "6.000000" }]), applyMaterialImport: vi.fn() };
    await expect(applyMaterialImport(changed)("installation", rows, preview.planHash)).rejects.toThrow("catalog_changed_since_preview");
    const invalidRows = [row({ supplierCode: "X" }), row({ supplierCode: "X" })];
    const same = { listMaterials: vi.fn().mockResolvedValue(catalog), applyMaterialImport: vi.fn() };
    await expect(applyMaterialImport(same)("installation", invalidRows, planMaterialImport(catalog, invalidRows).planHash)).rejects.toThrow("material_import_has_invalid_rows");
    expect(changed.applyMaterialImport).not.toHaveBeenCalled();
    expect(same.applyMaterialImport).not.toHaveBeenCalled();
  });
});
