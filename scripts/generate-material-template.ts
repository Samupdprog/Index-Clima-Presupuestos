// Genera apps/web/public/plantillas/plantilla-materiales.xlsx a partir de MATERIAL_COLUMNS,
// la misma definición que usa la pantalla de importación. Ejecutar tras cambiar columnas:
//   npx tsx scripts/generate-material-template.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { MATERIAL_COLUMNS } from "../apps/web/lib/material-import";

type Cell = string | number;
const OUTPUT = resolve("apps/web/public/plantillas/plantilla-materiales.xlsx");
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const columnName = (index: number) => String.fromCharCode(65 + index);

function sheetXml(rows: Cell[][], widths: number[], headerStyle = 1) {
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? ` s="${headerStyle}"` : typeof value === "number" && columnIndex >= 4 && columnIndex <= 5 ? ` s="2"` : "";
    return typeof value === "number" ? `<c r="${ref}"${style}><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

const header = MATERIAL_COLUMNS.map((column) => column.label);
const examples: Cell[][] = [
  ["Tubo cobre 1/4\"", "Salvador Escoda", "SE-1014", "m", 5.4, 9.9, 7, "Rollo de 50 m"],
  ["Bomba de condensados", "Salvador Escoda", "SE-2210", "ud", 38.5, 69, 7, ""],
  ["Soporte pared split", "", "", "ud", 12, 24.5, 7, ""],
];
const guide: Cell[][] = [
  ["Columna", "Obligatoria", "Qué poner", "Ejemplo", "También se reconoce como"],
  ...MATERIAL_COLUMNS.map((column) => [column.label, column.required ? "Sí" : "No", column.help, column.example, column.aliases.join(", ")]),
  [],
  ["Cómo se actualiza", "", "Cada material se identifica por su código de proveedor o, si no tiene, por nombre + proveedor. Si ya existe se actualiza; si no, se crea. Una celda vacía conserva el valor actual. Los materiales que no están en el Excel no se tocan.", "", ""],
  ["Importes", "", "Números sin impuestos. Vale 9,90 o 9.90 y el símbolo €.", "", ""],
];

const files = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Materiales" sheetId="1" r:id="rId1"/><sheet name="Instrucciones" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  // Estilos: 0 normal · 1 cabecera en negrita con fondo · 2 importe con dos decimales.
  "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F2EF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": sheetXml([header, ...examples], [34, 22, 18, 10, 12, 14, 8, 30]),
  "xl/worksheets/sheet2.xml": sheetXml(guide, [20, 12, 70, 20, 50]),
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])), { level: 9, mtime: new Date("2026-01-01T00:00:00Z") }));
console.log(`OK ${OUTPUT}`);
