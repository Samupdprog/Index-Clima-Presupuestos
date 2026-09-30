import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSheet } from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { igicCell, MATERIAL_COLUMNS, MaterialSheetError, normalizeHeader, parseMaterialSheet } from "./material-import";

describe("material Excel parsing", () => {
  it("reads the template columns with cost, sale price and IGIC", () => {
    const parsed = parseMaterialSheet([
      ["Nombre", "Proveedor", "Código proveedor", "Unidad", "Coste", "Precio venta", "IGIC", "Descripción"],
      ["Tubo cobre 1/4\"", "Salvador Escoda", "SE-1014", "m", 5.4, 9.9, 7, "Rollo de 50 m"],
    ]);
    expect(parsed.headerRow).toBe(1);
    expect(parsed.rows).toEqual([{ rowNumber: 2, errors: [], data: { name: "Tubo cobre 1/4\"", supplierNameSnapshot: "Salvador Escoda", supplierCode: "SE-1014", unit: "m", supplierUnitPrice: "5.4", saleUnitPrice: "9.9", igicRate: "7", description: "Rollo de 50 m" } }]);
  });

  it("finds the header row below titles and recognises other header names", () => {
    const parsed = parseMaterialSheet([
      ["Tarifa proveedor 2026"],
      [],
      ["Referencia", "Artículo", "Precio de coste (€)", "PVP cliente", "% IGIC", "Stock"],
      ["R-1", "Codo 90º", "3,20 €", "6,50 €", "15 %", 40],
    ]);
    expect(parsed.headerRow).toBe(3);
    expect(parsed.columns).toMatchObject({ name: "Artículo", code: "Referencia", cost: "Precio de coste (€)", sale: "PVP cliente", tax: "% IGIC", unit: null, supplier: null });
    expect(parsed.ignored).toEqual(["Stock"]);
    expect(parsed.rows[0]).toEqual({ rowNumber: 4, errors: [], data: { name: "Codo 90º", supplierCode: "R-1", supplierUnitPrice: "3.2", saleUnitPrice: "6.5", igicRate: "15" } });
  });

  it("converts percentage-formatted IGIC cells and rejects rates the catalog does not allow", () => {
    expect([igicCell(0.07), igicCell(0.03), igicCell(0.15), igicCell(0), igicCell("7%"), igicCell(7)]).toEqual(["7", "3", "15", "0", "7", "7"]);
    const parsed = parseMaterialSheet([["Nombre", "IGIC"], ["A", 21], ["B", 0.21], ["C", "exento"]]);
    expect(parsed.rows.map((row) => row.errors.length)).toEqual([1, 1, 1]);
    expect(parsed.rows[0]!.errors[0]).toContain("0, 3, 7 o 15");
  });

  it("keeps empty cells out of the row so the server keeps current values", () => {
    const parsed = parseMaterialSheet([["Nombre", "Unidad", "Coste", "Precio venta", "IGIC"], ["Tubo", "", 12.5, "", ""], ["", "", "", "", ""]]);
    expect(parsed.rows).toEqual([{ rowNumber: 2, errors: [], data: { name: "Tubo", supplierUnitPrice: "12.5" } }]);
  });

  it("reports invalid amounts and missing names with the Excel row number", () => {
    const parsed = parseMaterialSheet([["Nombre", "Coste", "Precio venta"], ["", 5, 9], ["Tubo", "cinco", -3]]);
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 2, errors: ["Falta el nombre"] });
    expect(parsed.rows[1]!.errors).toEqual(["Coste no válido: «cinco»", "Los importes no pueden ser negativos"]);
  });

  it("avoids float noise from Excel numbers", () => {
    expect(parseMaterialSheet([["Nombre", "Coste"], ["Tubo", 13.960000000000001]]).rows[0]!.data.supplierUnitPrice).toBe("13.96");
  });

  it("fails clearly when there is no name column", () => {
    expect(() => parseMaterialSheet([["Código", "Coste"], ["A", 1]])).toThrow(MaterialSheetError);
    expect(normalizeHeader("  IGIC (%) ")).toBe("igic");
  });

  it("imports the downloadable template completely (first sheet, every column)", async () => {
    const template = readFileSync(resolve(__dirname, "../public/plantillas/plantilla-materiales.xlsx"));
    const parsed = parseMaterialSheet(await readSheet(template));
    expect(Object.values(parsed.columns)).toEqual(MATERIAL_COLUMNS.map((column) => column.label));
    expect(parsed.ignored).toEqual([]);
    expect(parsed.rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(parsed.rows[0]!.data).toEqual({ name: "Tubo cobre 1/4\"", supplierNameSnapshot: "Salvador Escoda", supplierCode: "SE-1014", unit: "m", supplierUnitPrice: "5.4", saleUnitPrice: "9.9", igicRate: "7", description: "Rollo de 50 m" });
  });
});
