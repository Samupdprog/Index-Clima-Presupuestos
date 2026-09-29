"use client";

import { DropdownMenu } from "radix-ui";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  Package,
  PencilLine,
  Plus,
  Search,
  Trash2,
  Truck,
  UserRoundPlus,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { QuoteCommand } from "@quotes/contracts";
import { Sheet, SheetClose, SheetContent } from "../../animate-ui/overlay";
import { RippleButton } from "../../animate-ui/ripple-button";
import { SearchableSelect } from "../../ui/searchable-select";
import type {
  CalculatedLine,
  EmployeeRecord,
  LaborEntry,
  MaterialRecord,
  QuoteLine,
  QuoteRecord,
  SaleRule,
  TravelRecord,
} from "../../../lib/api/types";
import { formatDecimalInput, formatMoney, formatNumber } from "../../../lib/format";
import { parseDecimalText } from "../../../lib/decimal";
import { DecimalInput } from "../../ui/decimal-input";
import styles from "./concept-workspace.module.css";
import { useLinePreview } from "./use-line-preview";

type Execute = (command: QuoteCommand, successMessage?: string) => Promise<QuoteRecord>;
type ComposerType = "material" | "labor" | "travel" | "other";
type InlineField = "description" | "quantity" | "costUnit" | "costTotal" | "saleUnit" | "saleTotal" | "igic";

type LaborDraft = {
  key: string;
  id?: string;
  employeeId: string;
  employeeName: string;
  hours: string;
  costRate: string;
  saleRate: string;
};

type ConceptWorkspaceProps = {
  quote: QuoteRecord;
  materials: MaterialRecord[];
  employees: EmployeeRecord[];
  travels: TravelRecord[];
  calculations: Map<string, CalculatedLine>;
  readOnly: boolean;
  execute: Execute;
  onReorder: (ordered: QuoteLine[]) => Promise<void>;
  onOptimisticReorder: (ordered: QuoteLine[]) => void;
  onReviewPrice: () => void;
};

const TYPE_LABELS: Record<ComposerType, string> = {
  material: "Material",
  labor: "Mano de obra",
  travel: "Desplazamiento",
  other: "Otro concepto",
};

const SALE_RULE_COPY: Record<SaleRule, { title: string; description: string; valueLabel: string }> = {
  add_percentage: {
    title: "Sumar porcentaje",
    description: "Añadir un porcentaje sobre la base elegida.",
    valueLabel: "Porcentaje que quieres sumar",
  },
  add_euros_per_unit: {
    title: "Sumar € por unidad",
    description: "Añadir un importe por cada unidad.",
    valueLabel: "Euros que quieres sumar por unidad",
  },
  unit_price: {
    title: "Precio por unidad",
    description: "Fijar directamente lo que paga el cliente por unidad.",
    valueLabel: "Precio cliente / unidad · sin IGIC",
  },
  fixed_line_total: {
    title: "Total de la línea",
    description: "Fijar directamente el precio total de esta línea.",
    valueLabel: "Precio cliente total · sin IGIC",
  },
};

export function ConceptWorkspace({
  quote,
  materials,
  employees,
  travels,
  calculations,
  readOnly,
  execute,
  onReorder,
  onOptimisticReorder,
  onReviewPrice,
}: ConceptWorkspaceProps) {
  const [composerType, setComposerType] = useState<ComposerType>("material");
  const [advancedLineId, setAdvancedLineId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const advancedLine = quote.lines.find((line) => line.id === advancedLineId) ?? null;

  async function deleteLine(line: QuoteLine) {
    if (readOnly) return;
    await execute(
      {
        type: "deleteQuoteLine",
        expectedRevision: quote.revision,
        lineId: line.id,
      },
      "Concepto eliminado",
    );
    if (advancedLineId === line.id) setAdvancedLineId(null);
  }

  async function moveLine(line: QuoteLine, direction: -1 | 1) {
    if (readOnly) return;
    const index = quote.lines.findIndex((item) => item.id === line.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= quote.lines.length) return;
    const ordered = [...quote.lines];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    onOptimisticReorder(ordered);
    await onReorder(ordered);
  }

  async function updateLine(line: QuoteLine, changes: Record<string, unknown>, message?: string) {
    if (readOnly) return;
    await execute(
      {
        type: "updateQuoteLine",
        expectedRevision: quote.revision,
        lineId: line.id,
        changes,
      },
      message,
    );
  }

  return (
    <div className={styles.workspace}>
      <QuickComposer
        type={composerType}
        onTypeChange={setComposerType}
        quote={quote}
        materials={materials}
        employees={employees}
        travels={travels}
        readOnly={readOnly}
        execute={execute}
      />

      <section className={styles.linesSection} aria-labelledby="concept-lines-title">
        <div className={styles.linesHeading}>
          <div>
            <strong id="concept-lines-title">
              Líneas del presupuesto <span>· {quote.lines.length}</span>
            </strong>
            <p>Arrastra desde los puntos para ordenar. Haz doble clic en un dato para corregirlo.</p>
          </div>

          <label className={styles.moreToggle}>
            <input
              type="checkbox"
              checked={showMore}
              onChange={(event) => setShowMore(event.target.checked)}
            />
            <span className={styles.checkUi} aria-hidden="true">{showMore ? <Check /> : null}</span>
            <span>
              <strong>Mostrar más información</strong>
              <small>Proveedor, referencia y forma de precio.</small>
            </span>
          </label>
        </div>

        {quote.lines.length ? (
          <div className={styles.tableShell}>
            <div className={styles.tableHeader} aria-hidden="true">
              <span />
              <span>Concepto</span>
              <span>Cantidad</span>
              <span>Coste</span>
              <span>Precio cliente</span>
              <span>IGIC</span>
              <span>Beneficio</span>
              <span />
              <span />
            </div>

            <Reorder.Group
              axis="y"
              values={quote.lines}
              onReorder={(ordered: QuoteLine[]) => {
                if (!readOnly) onOptimisticReorder(ordered);
              }}
              className={styles.lineList}
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {quote.lines.map((line, index) => (
                <ConceptLineRow
                  key={line.id}
                  line={line}
                  calculation={calculations.get(line.id)}
                  readOnly={readOnly}
                  showMore={showMore}
                  first={index === 0}
                  last={index === quote.lines.length - 1}
                  onCommit={(changes, message) => updateLine(line, changes, message)}
                  onEdit={() => setAdvancedLineId(line.id)}
                  onDelete={() => void deleteLine(line)}
                  onMove={(direction) => void moveLine(line, direction)}
                  onDragEnd={() => void onReorder(quote.lines)}
                />
              ))}
            </Reorder.Group>
          </div>
        ) : (
          <div className={styles.emptyLines}>
            <Package />
            <strong>Añade el primer concepto</strong>
            <span>Material, mano de obra, desplazamiento u otro concepto.</span>
          </div>
        )}
      </section>

      <EconomicStrip quote={quote} onReviewPrice={onReviewPrice} />

      <AdvancedLineSheet
        line={advancedLine}
        quote={quote}
        calculation={advancedLine ? calculations.get(advancedLine.id) : undefined}
        employees={employees}
        open={Boolean(advancedLine)}
        onOpenChange={(open) => {
          if (!open) setAdvancedLineId(null);
        }}
        execute={execute}
        readOnly={readOnly}
      />
    </div>
  );
}

function QuickComposer({
  type,
  onTypeChange,
  quote,
  materials,
  employees,
  travels,
  readOnly,
  execute,
}: {
  type: ComposerType;
  onTypeChange: (type: ComposerType) => void;
  quote: QuoteRecord;
  materials: MaterialRecord[];
  employees: EmployeeRecord[];
  travels: TravelRecord[];
  readOnly: boolean;
  execute: Execute;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <section className={styles.composer} aria-label="Añadir concepto">
      <div className={styles.composerTop}>
        <div>
          <p className={styles.composerEyebrow}>Añadir concepto</p>
          <h3>¿Qué necesitas presupuestar?</h3>
        </div>
        <span>Los valores se aplican solo a este presupuesto</span>
      </div>

      <div className={styles.typeTabs} role="tablist" aria-label="Tipo de concepto">
        {(Object.keys(TYPE_LABELS) as ComposerType[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={type === item}
            data-active={type === item || undefined}
            onClick={() => onTypeChange(item)}
          >
            {item === "material" ? <Package /> : null}
            {item === "labor" ? <BriefcaseBusiness /> : null}
            {item === "travel" ? <Truck /> : null}
            {item === "other" ? <Plus /> : null}
            {TYPE_LABELS[item]}
          </button>
        ))}
      </div>

      <div
        className={styles.composerBody}
        style={{ transitionDuration: reduceMotion ? "0ms" : undefined }}
      >
        {type === "material" ? (
          <MaterialComposer quote={quote} materials={materials} execute={execute} readOnly={readOnly} />
        ) : null}
        {type === "labor" ? (
          <LaborComposer quote={quote} employees={employees} execute={execute} readOnly={readOnly} />
        ) : null}
        {type === "travel" ? (
          <TravelComposer quote={quote} travels={travels} execute={execute} readOnly={readOnly} />
        ) : null}
        {type === "other" ? (
          <OtherComposer quote={quote} execute={execute} readOnly={readOnly} />
        ) : null}
      </div>
    </section>
  );
}

function MaterialComposer({
  quote,
  materials,
  execute,
  readOnly,
}: {
  quote: QuoteRecord;
  materials: MaterialRecord[];
  execute: Execute;
  readOnly: boolean;
}) {
  const [catalogId, setCatalogId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [cost, setCost] = useState("");
  const [saleUnit, setSaleUnit] = useState("");
  const [igic, setIgic] = useState("7");
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = normalize(description);
    if (!needle) return materials.filter((item) => item.active).slice(0, 8);
    return materials
      .filter((item) => item.active)
      .filter((item) => normalize(`${item.name} ${item.supplierNameSnapshot ?? ""} ${item.supplierCode ?? ""} ${item.description ?? ""}`).includes(needle))
      .slice(0, 8);
  }, [description, materials]);

  const command = simpleCommand(quote.revision, "material", description, quantity, unit, cost, saleUnit, igic, catalogId);
  const preview = useEconomicPreview(quote.id, command);

  function chooseMaterial(item: MaterialRecord) {
    setCatalogId(item.id);
    setDescription(item.name);
    setUnit(item.unit || "ud");
    setCost(toInputDecimal(item.supplierUnitPrice));
    setSaleUnit(toInputDecimal(item.saleUnitPrice));
    setIgic(normalizedRate(item.igicRate));
    setOpenSuggestions(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !description.trim()) return;
    setBusy(true);
    try {
      await execute(command, "Material añadido");
      setCatalogId("");
      setDescription("");
      setQuantity("1");
      setUnit("ud");
      setCost("");
      setSaleUnit("");
      setIgic("7");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.quickForm}>
      <div className={`${styles.quickField} ${styles.materialName}`}>
        <label htmlFor="quick-material-name">Material</label>
        <div className={styles.catalogInput}>
          <Search />
          <input
            ref={inputRef}
            id="quick-material-name"
            value={description}
            disabled={readOnly}
            autoComplete="off"
            placeholder="Ej. Tubo cobre 3/8"
            onFocus={() => setOpenSuggestions(true)}
            onChange={(event) => {
              setCatalogId("");
              setDescription(event.target.value);
              setOpenSuggestions(true);
            }}
            onBlur={() => window.setTimeout(() => setOpenSuggestions(false), 120)}
          />
          {description ? (
            <button
              type="button"
              aria-label="Limpiar material"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setCatalogId("");
                setDescription("");
                inputRef.current?.focus();
              }}
            >
              <X />
            </button>
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
          {openSuggestions && matches.length ? (
            <div className={styles.catalogMenu}>
              {matches.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMaterial(item)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {[item.supplierNameSnapshot, item.supplierCode].filter(Boolean).join(" · ") || "Material guardado"}
                    </small>
                  </span>
                  <span className={styles.catalogPrice}>{formatMoney(item.saleUnitPrice)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <QuickNumberField label="Cantidad" value={quantity} onChange={setQuantity} readOnly={readOnly} className={styles.qtyField} />
      <QuickTextField label="Unidad" value={unit} onChange={setUnit} readOnly={readOnly} className={styles.unitField} />
      <QuickMoneyField label="Coste / ud" value={cost} onChange={setCost} readOnly={readOnly} className={styles.costField} />
      <QuickMoneyField label="Precio cliente / ud" hint="sin IGIC" value={saleUnit} onChange={setSaleUnit} readOnly={readOnly} className={styles.saleField} />
      <QuickOutput label="Con IGIC / ud" value={preview.saleUnitGross} className={styles.grossField} />

      <div className={`${styles.quickField} ${styles.igicField}`}>
        <label htmlFor="quick-material-igic">IGIC</label>
        <select id="quick-material-igic" value={igic} disabled={readOnly} onChange={(event) => setIgic(event.target.value)}>
          <option value="0">0 %</option>
          <option value="3">3 %</option>
          <option value="7">7 %</option>
          <option value="15">15 %</option>
        </select>
      </div>

      <button className={`${styles.addButton} ${styles.addField}`} type="submit" disabled={readOnly || busy || !description.trim()}>
        <Plus /> {busy ? "Añadiendo…" : "Añadir material"}
      </button>

      <QuickTotals preview={preview} />
    </form>
  );
}

function TravelComposer({
  quote,
  travels,
  execute,
  readOnly,
}: {
  quote: QuoteRecord;
  travels: TravelRecord[];
  execute: Execute;
  readOnly: boolean;
}) {
  const [presetId, setPresetId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [cost, setCost] = useState("");
  const [saleUnit, setSaleUnit] = useState("");
  const [igic, setIgic] = useState("7");
  const [busy, setBusy] = useState(false);
  const command = simpleCommand(quote.revision, "travel", description, quantity, unit, cost, saleUnit, igic);
  const preview = useEconomicPreview(quote.id, command);

  function choosePreset(value: string) {
    setPresetId(value);
    const item = travels.find((record) => record.id === value);
    if (!item) return;
    setDescription(item.name);
    setQuantity("1");
    setUnit(item.unit || "ud");
    setCost(toInputDecimal(item.costUnitPrice));
    setSaleUnit(toInputDecimal(item.saleUnitPrice));
    setIgic(normalizedRate(item.igicRate));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !description.trim()) return;
    setBusy(true);
    try {
      await execute(command, "Desplazamiento añadido");
      setPresetId("");
      setDescription("");
      setQuantity("1");
      setUnit("ud");
      setCost("");
      setSaleUnit("");
      setIgic("7");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.quickForm}>
      <div className={`${styles.quickField} ${styles.travelPreset}`}>
        <label htmlFor="quick-travel-preset">Desplazamiento guardado</label>
        <select id="quick-travel-preset" value={presetId} disabled={readOnly} onChange={(event) => choosePreset(event.target.value)}>
          <option value="">Puntual / escribir manualmente</option>
          {travels.filter((item) => item.active).map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>
      <QuickTextField label="Concepto" value={description} onChange={setDescription} readOnly={readOnly} className={styles.travelName} placeholder="Ej. Desplazamiento zona norte" />
      <QuickNumberField label="Cantidad" value={quantity} onChange={setQuantity} readOnly={readOnly} className={styles.qtyField} />
      <QuickTextField label="Unidad" value={unit} onChange={setUnit} readOnly={readOnly} className={styles.unitField} />
      <QuickMoneyField label="Coste / ud" value={cost} onChange={setCost} readOnly={readOnly} className={styles.costField} />
      <QuickMoneyField label="Precio cliente / ud" hint="sin IGIC" value={saleUnit} onChange={setSaleUnit} readOnly={readOnly} className={styles.saleField} />
      <QuickOutput label="Con IGIC / ud" value={preview.saleUnitGross} className={styles.grossField} />
      <div className={`${styles.quickField} ${styles.igicField}`}>
        <label htmlFor="quick-travel-igic">IGIC</label>
        <select id="quick-travel-igic" value={igic} disabled={readOnly} onChange={(event) => setIgic(event.target.value)}>
          <option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option>
        </select>
      </div>
      <button className={`${styles.addButton} ${styles.addField}`} type="submit" disabled={readOnly || busy || !description.trim()}>
        <Plus /> {busy ? "Añadiendo…" : "Añadir desplazamiento"}
      </button>
      <QuickTotals preview={preview} />
    </form>
  );
}

function OtherComposer({
  quote,
  execute,
  readOnly,
}: {
  quote: QuoteRecord;
  execute: Execute;
  readOnly: boolean;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [cost, setCost] = useState("");
  const [saleUnit, setSaleUnit] = useState("");
  const [igic, setIgic] = useState("7");
  const [busy, setBusy] = useState(false);
  const command = simpleCommand(quote.revision, "other", description, quantity, unit, cost, saleUnit, igic);
  const preview = useEconomicPreview(quote.id, command);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !description.trim()) return;
    setBusy(true);
    try {
      await execute(command, "Concepto añadido");
      setDescription("");
      setQuantity("1");
      setUnit("ud");
      setCost("");
      setSaleUnit("");
      setIgic("7");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.quickForm}>
      <QuickTextField label="Concepto" value={description} onChange={setDescription} readOnly={readOnly} className={styles.otherName} placeholder="Descripción para el cliente" />
      <QuickNumberField label="Cantidad" value={quantity} onChange={setQuantity} readOnly={readOnly} className={styles.qtyField} />
      <QuickTextField label="Unidad" value={unit} onChange={setUnit} readOnly={readOnly} className={styles.unitField} />
      <QuickMoneyField label="Coste / ud" value={cost} onChange={setCost} readOnly={readOnly} className={styles.costField} />
      <QuickMoneyField label="Precio cliente / ud" hint="sin IGIC" value={saleUnit} onChange={setSaleUnit} readOnly={readOnly} className={styles.saleField} />
      <QuickOutput label="Con IGIC / ud" value={preview.saleUnitGross} className={styles.grossField} />
      <div className={`${styles.quickField} ${styles.igicField}`}>
        <label htmlFor="quick-other-igic">IGIC</label>
        <select id="quick-other-igic" value={igic} disabled={readOnly} onChange={(event) => setIgic(event.target.value)}>
          <option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option>
        </select>
      </div>
      <button className={`${styles.addButton} ${styles.addField}`} type="submit" disabled={readOnly || busy || !description.trim()}>
        <Plus /> {busy ? "Añadiendo…" : "Añadir concepto"}
      </button>
      <QuickTotals preview={preview} />
    </form>
  );
}

function LaborComposer({
  quote,
  employees,
  execute,
  readOnly,
}: {
  quote: QuoteRecord;
  employees: EmployeeRecord[];
  execute: Execute;
  readOnly: boolean;
}) {
  const [description, setDescription] = useState("Mano de obra instalación");
  const [igic, setIgic] = useState("7");
  const [rows, setRows] = useState<LaborDraft[]>([emptyLaborDraft()]);
  const [busy, setBusy] = useState(false);
  const command = laborCommand(quote.revision, description, igic, rows);
  const preview = useEconomicPreview(quote.id, command);

  function updateEmployee(index: number, employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      employeeId,
      employeeName: employee?.name ?? "",
      costRate: toInputDecimal(employee?.costRate),
      saleRate: toInputDecimal(employee?.saleRate),
    } : row));
  }

  function updateRow(index: number, changes: Partial<LaborDraft>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validRows = rows.filter((row) => row.employeeId && num(row.hours) > 0);
    if (readOnly || !description.trim() || !validRows.length) return;
    setBusy(true);
    try {
      await execute(command, "Mano de obra añadida");
      setRows([emptyLaborDraft()]);
      setDescription("Mano de obra instalación");
      setIgic("7");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.laborComposer}>
      <div className={styles.laborTop}>
        <QuickTextField label="Concepto que verá el cliente" value={description} onChange={setDescription} readOnly={readOnly} className={styles.laborName} />
        <div className={styles.quickField}>
          <label htmlFor="quick-labor-igic">IGIC de la línea</label>
          <select id="quick-labor-igic" value={igic} disabled={readOnly} onChange={(event) => setIgic(event.target.value)}>
            <option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option>
          </select>
        </div>
        <button type="button" className={styles.smallAdd} disabled={readOnly} onClick={() => setRows((current) => [...current, emptyLaborDraft()])}>
          <UserRoundPlus /> Añadir empleado
        </button>
      </div>

      <div className={styles.laborTable}>
        <div className={styles.laborHead} aria-hidden="true">
          <span>Empleado</span><span>Horas</span><span>Coste empresa / h</span><span>Precio cliente / h</span><span />
        </div>
        {rows.map((row, index) => (
          <div className={styles.laborRow} key={row.key}>
            <SearchableSelect
              value={row.employeeId}
              onChange={(value) => updateEmployee(index, value)}
              disabled={readOnly}
              allowClear={false}
              placeholder="Buscar empleado…"
              options={employees.filter((item) => item.active).map((item) => ({
                value: item.id,
                label: item.name,
                description: `${formatMoney(item.costRate)}/h coste · ${formatMoney(item.saleRate)}/h venta`,
              }))}
            />
            <DecimalInput value={row.hours} disabled={readOnly} aria-label="Horas" onValueChange={(value) => updateRow(index, { hours: value })} />
            <DecimalInput value={row.costRate} disabled={readOnly} aria-label="Coste por hora" onValueChange={(value) => updateRow(index, { costRate: value })} />
            <DecimalInput value={row.saleRate} disabled={readOnly} aria-label="Precio cliente por hora" onValueChange={(value) => updateRow(index, { saleRate: value })} />
            <button type="button" aria-label="Quitar empleado" disabled={readOnly || rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 /></button>
          </div>
        ))}
      </div>

      <div className={styles.laborSummary} aria-live="polite">
        <PreviewMetric label="Coste total" value={preview.costTotal} />
        <PreviewMetric label="Precio cliente · sin IGIC" value={preview.saleNet} />
        <PreviewMetric label="Precio cliente · con IGIC" value={preview.saleGross} />
        <PreviewMetric label="Beneficio" value={preview.profit} profit />
        <button className={styles.addButton} type="submit" disabled={readOnly || busy || !rows.some((row) => row.employeeId && num(row.hours) > 0)}>
          <Plus /> {busy ? "Añadiendo…" : "Añadir mano de obra"}
        </button>
      </div>
      <p className={styles.help}>Cada empleado carga sus valores habituales. Puedes cambiarlos solo para este presupuesto sin modificar su ficha.</p>
    </form>
  );
}

function ConceptLineRow({
  line,
  calculation,
  readOnly,
  showMore,
  first,
  last,
  onCommit,
  onEdit,
  onDelete,
  onMove,
  onDragEnd,
}: {
  line: QuoteLine;
  calculation: CalculatedLine | undefined;
  readOnly: boolean;
  showMore: boolean;
  first: boolean;
  last: boolean;
  onCommit: (changes: Record<string, unknown>, message?: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragEnd: () => void;
}) {
  const dragControls = useDragControls();
  const quantity = line.type === "labor" ? laborHours(line) : num(line.quantity);
  const costTotal = calculation?.cost;
  const costUnit = calculation?.costUnit;
  const saleTotal = calculation?.sale;
  const saleUnit = calculation?.saleUnit;
  const saleGross = calculation?.finalSaleWithTax;
  const profit = calculation?.profit;

  async function commitInline(field: InlineField, value: string) {
    const clean = normalizeDecimal(value);
    if (field === "description") {
      if (value.trim() && value.trim() !== line.description) await onCommit({ description: value.trim() }, "Concepto actualizado");
      return;
    }
    if (!clean) return;
    if (field === "quantity") {
      if (line.type !== "labor" && clean !== normalizeDecimal(line.quantity)) await onCommit({ quantity: clean }, "Cantidad actualizada");
      return;
    }
    if (field === "costUnit") {
      if (line.type !== "labor") await onCommit({ directUnitCost: clean }, "Coste actualizado");
      return;
    }
    if (field === "costTotal") {
      // El servidor deriva el coste unitario a partir del total y la cantidad.
      if (line.type !== "labor") await onCommit({ directTotalCost: clean }, "Coste total actualizado");
      return;
    }
    if (field === "saleUnit") {
      if (line.type !== "labor") await onCommit({ saleRule: "unit_price", saleRuleValue: clean }, "Precio por unidad actualizado");
      return;
    }
    if (field === "saleTotal") {
      if (line.type !== "labor") await onCommit({ saleRule: "fixed_line_total", saleRuleValue: clean }, "Precio total actualizado");
      return;
    }
    if (field === "igic") {
      await onCommit({ igicRate: clean }, "IGIC actualizado");
    }
  }

  return (
    <Reorder.Item
      value={line}
      as="li"
      className={styles.lineItem}
      layout
      dragListener={false}
      dragControls={dragControls}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
    >
      <div className={styles.mainRow}>
        <button
          type="button"
          className={styles.dragHandle}
          disabled={readOnly}
          aria-label={`Reordenar ${line.description}`}
          title="Arrastra para ordenar"
          onPointerDown={(event) => dragControls.start(event)}
          onPointerUp={onDragEnd}
        >
          <GripVertical />
        </button>

        <div className={styles.conceptCell}>
          <span>{lineTypeLabel(line)}</span>
          <InlineEditor
            disabled={readOnly}
            type="text"
            value={line.description}
            display={<strong>{line.description}</strong>}
            ariaLabel="Descripción"
            onSave={(value) => commitInline("description", value)}
          />
          <small>{lineSubtitle(line)}</small>
        </div>

        <div className={styles.valueCell}>
          <span>Cantidad</span>
          {line.type === "labor" ? (
            <strong>{formatNumber(quantity)} h</strong>
          ) : (
            <InlineEditor
              disabled={readOnly}
              type="number"
              value={toInputDecimal(line.quantity)}
              display={<strong>{formatNumber(line.quantity)}</strong>}
              ariaLabel="Cantidad"
              onSave={(value) => commitInline("quantity", value)}
            />
          )}
          <small>{line.type === "labor" ? `${line.laborEntries.length} ${line.laborEntries.length === 1 ? "empleado" : "empleados"}` : line.unit}</small>
        </div>

        <div className={styles.valueCell}>
          <span>Coste</span>
          {line.type !== "labor" ? (
            <InlineEditor
              disabled={readOnly}
              type="number"
              value={toInputDecimal(costTotal)}
              display={<strong>{formatMoney(costTotal)}</strong>}
              ariaLabel="Coste total de la línea"
              onSave={(value) => commitInline("costTotal", value)}
            />
          ) : <strong>{formatMoney(costTotal)}</strong>}
          {line.type !== "labor" ? (
            <InlineEditor
              disabled={readOnly}
              type="number"
              value={toInputDecimal(costUnit)}
              display={<small>{formatMoney(costUnit)} / {line.unit || "ud"}</small>}
              ariaLabel="Coste por unidad"
              onSave={(value) => commitInline("costUnit", value)}
              compact
            />
          ) : <small>Equipo interno</small>}
        </div>

        <div className={`${styles.valueCell} ${styles.priceCell}`}>
          <span>Precio cliente</span>
          <InlineEditor
            disabled={readOnly || line.type === "labor"}
            type="number"
            value={toInputDecimal(saleTotal)}
            display={line.type === "labor" ? <strong>{formatMoney(saleTotal)}</strong> : <strong>{formatMoney(saleTotal)} <em>sin IGIC</em></strong>}
            ariaLabel="Precio cliente total sin IGIC"
            onSave={(value) => commitInline("saleTotal", value)}
          />
          <div className={styles.priceMeta}>
            {line.type !== "labor" ? (
              <InlineEditor
                disabled={readOnly}
                type="number"
                value={toInputDecimal(saleUnit)}
                display={<small>{formatMoney(saleUnit)} / {line.unit || "ud"}</small>}
                ariaLabel="Precio cliente por unidad sin IGIC"
                onSave={(value) => commitInline("saleUnit", value)}
                compact
              />
            ) : <small>{formatNumber(quantity)} h · sin IGIC</small>}
            <small>{formatMoney(saleGross)} con IGIC</small>
          </div>
        </div>

        <div className={styles.valueCell}>
          <span>IGIC</span>
          <InlineSelect
            disabled={readOnly}
            value={normalizedRate(line.igicRate)}
            options={["0", "3", "7", "15"]}
            display={<strong>{formatNumber(line.igicRate)} %</strong>}
            ariaLabel="IGIC"
            onSave={(value) => commitInline("igic", value)}
          />
        </div>

        <div className={styles.valueCell}>
          <span>Beneficio</span>
          <strong className={String(profit ?? "").startsWith("-") ? styles.negative : styles.positive}>{formatMoney(profit)}</strong>
        </div>

        <button className={styles.editButton} type="button" disabled={readOnly} onClick={onEdit}>
          <PencilLine /> Editar
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.moreButton} type="button" aria-label={`Acciones de ${line.description}`}>
              <MoreHorizontal />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={6}>
              <DropdownMenu.Item className="dropdown-item" disabled={first || readOnly} onSelect={() => onMove(-1)}><ArrowUp />Subir línea</DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item" disabled={last || readOnly} onSelect={() => onMove(1)}><ArrowDown />Bajar línea</DropdownMenu.Item>
              <DropdownMenu.Separator style={{ height: 1, background: "var(--border)", margin: 4 }} />
              <DropdownMenu.Item className="dropdown-item danger" disabled={readOnly} onSelect={onDelete}><Trash2 />Eliminar concepto</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {showMore ? (
        <div className={styles.detailRow}>
          {line.type === "labor" ? (
            <>
              <Detail label="Equipo interno" value={line.laborEntries.length ? line.laborEntries.map((entry) => `${entry.employeeNameSnapshot} · ${formatNumber(entry.hours)} h`).join(" · ") : "—"} />
              <Detail label="Coste interno" value={formatMoney(costTotal)} />
              <Detail label="IGIC mano de obra" value={`${formatNumber(line.igicRate)} %`} />
              <Detail label="Cliente verá" value="Una única línea" />
            </>
          ) : (
            <>
              <Detail label="Proveedor" value={line.supplierNameSnapshot || "—"} />
              <Detail label="Descuento proveedor" value={line.discounts.length ? discountText(line.discounts.map((item) => item.percentage)) : "0 %"} />
              <Detail label="Código / referencia" value={line.supplierCodeSnapshot || line.internalReference || "—"} />
              <Detail label="Precio cliente" value={SALE_RULE_COPY[line.saleRule]!.title} />
            </>
          )}
        </div>
      ) : null}
    </Reorder.Item>
  );
}

function InlineEditor({
  value,
  display,
  type,
  disabled,
  ariaLabel,
  onSave,
  compact = false,
}: {
  value: string;
  display: ReactNode;
  type: "text" | "number";
  disabled: boolean;
  ariaLabel: string;
  onSave: (value: string) => Promise<void>;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function finish(save: boolean) {
    if (!editing) return;
    if (!save || draft === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${styles.inlineInput}${compact ? ` ${styles.inlineCompact}` : ""}`}
        value={draft}
        disabled={saving}
        inputMode={type === "number" ? "decimal" : undefined}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void finish(true)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void finish(true);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            void finish(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`${styles.inlineDisplay}${compact ? ` ${styles.inlineCompact}` : ""}`}
      disabled={disabled}
      title={disabled ? undefined : "Doble clic para editar"}
      aria-label={`${ariaLabel}. ${disabled ? "" : "Doble clic para editar."}`}
      onDoubleClick={() => {
        if (!disabled) setEditing(true);
      }}
    >
      {display}
    </button>
  );
}

function InlineSelect({
  value,
  options,
  display,
  disabled,
  ariaLabel,
  onSave,
}: {
  value: string;
  options: string[];
  display: ReactNode;
  disabled: boolean;
  ariaLabel: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        className={styles.inlineInput}
        value={value}
        autoFocus
        aria-label={ariaLabel}
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          const next = event.target.value;
          setEditing(false);
          void onSave(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
      >
        {options.map((option) => <option value={option} key={option}>{option} %</option>)}
      </select>
    );
  }

  return (
    <button
      type="button"
      className={styles.inlineDisplay}
      disabled={disabled}
      title={disabled ? undefined : "Doble clic para editar"}
      onDoubleClick={() => {
        if (!disabled) setEditing(true);
      }}
    >
      {display}
    </button>
  );
}

function AdvancedLineSheet({
  line,
  quote,
  calculation,
  employees,
  open,
  onOpenChange,
  execute,
  readOnly,
}: {
  line: QuoteLine | null;
  quote: QuoteRecord;
  calculation: CalculatedLine | undefined;
  employees: EmployeeRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  execute: Execute;
  readOnly: boolean;
}) {
  const [form, setForm] = useState<AdvancedForm>(() => emptyAdvancedForm());
  const [discountTextValue, setDiscountTextValue] = useState("");
  const [laborRows, setLaborRows] = useState<LaborDraft[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!line || !open) return;
    setForm({ ...formFromLine(line), directTotalCost: toInputDecimal(calculation?.cost) });
    setDiscountTextValue(line.discounts.map((item) => toInputDecimal(item.percentage)).join(", "));
    setLaborRows(line.laborEntries.map((entry) => laborDraftFromEntry(entry)));
    setMoreOpen(false);
    setError("");
  }, [line, open]); // eslint-disable-line react-hooks/exhaustive-deps -- solo al abrir otra línea

  const discountValues = parseDiscounts(discountTextValue);
  const command: Extract<QuoteCommand, { type: "updateQuoteLineDetails" }> | null = line && open && form.description.trim() ? {
    type: "updateQuoteLineDetails", expectedRevision: quote.revision, lineId: line.id,
    line: { description: form.description.trim(), unit: form.unit.trim() || "ud", quantity: decimalOr(form.quantity, "1"), igicRate: decimalOr(form.igicRate, "7"),
      saleRule: form.saleRule, saleRuleValue: decimalOrZero(form.saleRuleValue), saleBaseMode: form.useSupplierListBase ? "supplier_list_price" : "net_cost",
      ...(form.costSource === "total" && form.directTotalCost.trim() ? { directUnitCost: null, directTotalCost: decimalOrZero(form.directTotalCost) } : { directUnitCost: form.directUnitCost.trim() ? decimalOrZero(form.directUnitCost) : null }), supplierUnitPrice: form.supplierUnitPrice.trim() ? decimalOrZero(form.supplierUnitPrice) : null,
      supplierNameSnapshot: form.supplierName || null, supplierCodeSnapshot: form.supplierCode || null, internalReference: form.internalReference || null, internalNotes: form.internalNotes || null },
    discounts: discountValues.map((percentage) => ({ percentage })), laborEntries: laborEntries(laborRows),
  } : null;
  const localPreview = useEconomicPreview(quote.id, open ? command : null);
  if (!line) return <Sheet open={false}><></></Sheet>;
  const activeLine = line;

  function set(key: keyof AdvancedForm, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLaborEmployee(index: number, employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    setLaborRows((current) => current.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      employeeId,
      employeeName: employee?.name ?? row.employeeName,
      costRate: toInputDecimal(employee?.costRate ?? row.costRate),
      saleRate: toInputDecimal(employee?.saleRate ?? row.saleRate),
    } : row));
  }

  function patchLaborRow(index: number, patch: Partial<LaborDraft>) {
    setLaborRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setError("");
    try {
      if (!command) return;
      await execute(command, "Línea actualizada");
      onOpenChange(false);
    } catch {
      setError("No se pudieron guardar todos los cambios. Revisa los datos y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  const autoRule = form.saleRule === "add_percentage" || form.saleRule === "add_euros_per_unit";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        wide
        eyebrow="Edición avanzada"
        title={activeLine.description}
        description="Cambia solo lo que necesites. Los importes que ya funcionan pueden quedarse como están."
        footer={
          <>
            <SheetClose asChild><RippleButton variant="secondary">Cancelar</RippleButton></SheetClose>
            {!readOnly ? <RippleButton type="submit" form="advanced-line-v2" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</RippleButton> : null}
          </>
        }
      >
        <form id="advanced-line-v2" onSubmit={save} className={styles.advancedForm}>
          <EditorSection title="Concepto">
            <div className={styles.formGrid}>
              <Field className={styles.span2} label="Descripción">
                <input value={form.description} disabled={readOnly} onChange={(event) => set("description", event.target.value)} />
              </Field>
              <Field label="Tipo">
                <input value={lineTypeLabel(activeLine)} disabled aria-label="Tipo de línea" />
              </Field>
              <Field label="IGIC">
                <select value={form.igicRate} disabled={readOnly} onChange={(event) => set("igicRate", event.target.value)}>
                  <option value="0">0 %</option><option value="3">3 %</option><option value="7">7 %</option><option value="15">15 %</option>
                </select>
              </Field>
              {activeLine.type !== "labor" ? (
                <>
                  <Field label="Cantidad"><DecimalInput value={form.quantity} disabled={readOnly} onValueChange={(value) => set("quantity", value)} /></Field>
                  <Field label="Unidad"><input value={form.unit} disabled={readOnly} onChange={(event) => set("unit", event.target.value)} /></Field>
                </>
              ) : null}
            </div>
          </EditorSection>

          {activeLine.type === "labor" ? (
            <EditorSection
              title="Equipo de trabajo"
              description="Solo para Index Clima. El cliente verá una única línea de mano de obra."
              action={
                <button type="button" className={styles.sectionAction} disabled={readOnly} onClick={() => setLaborRows((current) => [...current, emptyLaborDraft()])}>
                  <Plus /> Empleado
                </button>
              }
            >
              <div className={styles.advancedLabor}>
                <div className={styles.advancedLaborHead} aria-hidden="true"><span>Empleado</span><span>Horas</span><span>Coste / h</span><span>Precio / h</span><span /></div>
                {laborRows.map((row, index) => (
                  <div className={styles.advancedLaborRow} key={row.key}>
                    <SearchableSelect
                      value={row.employeeId}
                      onChange={(value) => setLaborEmployee(index, value)}
                      disabled={readOnly}
                      allowClear={false}
                      placeholder="Buscar empleado…"
                      options={employees.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, description: `${formatMoney(item.costRate)}/h coste · ${formatMoney(item.saleRate)}/h venta` }))}
                    />
                    <DecimalInput value={row.hours} disabled={readOnly} aria-label="Horas" onValueChange={(value) => patchLaborRow(index, { hours: value })} />
                    <DecimalInput value={row.costRate} disabled={readOnly} aria-label="Coste por hora" onValueChange={(value) => patchLaborRow(index, { costRate: value })} />
                    <DecimalInput value={row.saleRate} disabled={readOnly} aria-label="Precio por hora" onValueChange={(value) => patchLaborRow(index, { saleRate: value })} />
                    <button type="button" aria-label="Eliminar empleado" disabled={readOnly} onClick={() => setLaborRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 /></button>
                  </div>
                ))}
                {!laborRows.length ? <p className={styles.emptyTeam}>No hay empleados en esta línea. Añade uno para calcular la mano de obra.</p> : null}
              </div>
              <div className={styles.editorPreview}><PreviewMetric label="Horas internas" value={laborRows.reduce((sum, row) => sum + num(row.hours), 0)} suffix=" h" plain /><PreviewMetric label="Coste" value={localPreview.costTotal} /><PreviewMetric label="Precio cliente · sin IGIC" value={localPreview.saleNet} /><PreviewMetric label="Precio cliente · con IGIC" value={localPreview.saleGross} /><PreviewMetric label="Beneficio" value={localPreview.profit} profit /></div>
            </EditorSection>
          ) : (
            <>
              <EditorSection title="Proveedor y coste">
                <div className={styles.formGrid}>
                  <Field className={styles.span2} label="Proveedor"><input value={form.supplierName} disabled={readOnly} onChange={(event) => set("supplierName", event.target.value)} placeholder="Opcional" /></Field>
                  <Field label="Código"><input value={form.supplierCode} disabled={readOnly} onChange={(event) => set("supplierCode", event.target.value)} placeholder="Referencia del proveedor" /></Field>
                  <Field label="PVP proveedor / ud"><DecimalInput value={form.supplierUnitPrice} disabled={readOnly} onValueChange={(value) => set("supplierUnitPrice", value)} /></Field>
                  <Field label="Coste neto / ud"><DecimalInput value={form.costSource === "total" ? toDisplayDecimal(localPreview.costUnit) : form.directUnitCost} disabled={readOnly} onValueChange={(value) => setForm((current) => ({ ...current, directUnitCost: value, costSource: "unit" }))} /></Field>
                  <Field label="Coste total de la línea"><DecimalInput value={form.costSource === "unit" ? toDisplayDecimal(localPreview.costTotal) : form.directTotalCost} disabled={readOnly} onValueChange={(value) => setForm((current) => ({ ...current, directTotalCost: value, costSource: "total" }))} /></Field>
                  <p className={`${styles.span2} ${styles.fieldHint}`}>Edita el coste por unidad o el total: el servidor calcula el otro con la cantidad.</p>
                </div>

                {activeLine.type === "material" ? (
                  <div className={styles.discountEditor}>
                    <div>
                      <strong>Descuento del proveedor</strong>
                      <span>Puede ser uno o varios descuentos consecutivos.</span>
                    </div>
                    <input value={discountTextValue} disabled={readOnly} onChange={(event) => setDiscountTextValue(event.target.value)} placeholder="Ej. 40 + 10 + 5" />
                    <small>Descuento efectivo: {formatDiscount(localPreview.effectiveDiscount)}{discountValues.length ? ` · Descuentos: ${discountValues.map((value) => `${formatNumber(value)} %`).join(" + ")}` : ""}</small>
                  </div>
                ) : null}
              </EditorSection>

              <EditorSection title="Precio para el cliente">
                <div className={styles.ruleGrid}>
                  {(Object.keys(SALE_RULE_COPY) as SaleRule[]).map((rule) => (
                    <label key={rule} data-selected={form.saleRule === rule || undefined}>
                      <input type="radio" name="advanced-sale-rule-v2" value={rule} checked={form.saleRule === rule} disabled={readOnly} onChange={() => set("saleRule", rule)} />
                      <span><strong>{SALE_RULE_COPY[rule]!.title}</strong><small>{SALE_RULE_COPY[rule]!.description}</small></span>
                    </label>
                  ))}
                </div>

                <Field label={SALE_RULE_COPY[form.saleRule]!.valueLabel}>
                  <DecimalInput value={form.saleRuleValue} disabled={readOnly} onValueChange={(value) => set("saleRuleValue", value)} />
                </Field>

                {activeLine.type === "material" && autoRule ? (
                  <label className={styles.switchRow}>
                    <input type="checkbox" checked={form.useSupplierListBase} disabled={readOnly} onChange={(event) => set("useSupplierListBase", event.target.checked)} />
                    <span className={styles.switchUi} aria-hidden="true" />
                    <span>
                      <strong>Sumar descuento proveedor al precio cliente</strong>
                      <small>Si lo activas, el precio automático parte del PVP del proveedor. Si lo desactivas, parte del coste neto.</small>
                      <em>Base calculada: {formatMoney(localPreview.saleBase)}</em>
                    </span>
                  </label>
                ) : null}

                <div className={styles.editorPreview} aria-live="polite">
                  <PreviewMetric label="Coste" value={localPreview.costTotal} />
                  <PreviewMetric label="Precio cliente · sin IGIC" value={localPreview.saleNet} />
                  <PreviewMetric label="Precio cliente · con IGIC" value={localPreview.saleGross} />
                  <PreviewMetric label="Beneficio" value={localPreview.profit} profit />
                </div>
              </EditorSection>
            </>
          )}

          <section className={styles.moreSection}>
            <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen}>
              <strong>Más información</strong><ChevronDown data-open={moreOpen || undefined} />
            </button>
            {moreOpen ? (
              <div className={styles.moreBody}>
                <Field label="Referencia interna"><input value={form.internalReference} disabled={readOnly} onChange={(event) => set("internalReference", event.target.value)} /></Field>
                <Field label="Notas internas"><textarea rows={4} value={form.internalNotes} disabled={readOnly} onChange={(event) => set("internalNotes", event.target.value)} /></Field>
              </div>
            ) : null}
          </section>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          {localPreview.pending ? <p role="status">Calculando en el servidor…</p> : localPreview.error ? <p role="alert" className={styles.error}>{localPreview.error}</p> : null}
          <div className={styles.serverResult}>
            <span>Resultado confirmado actualmente por el servidor</span>
            <strong>{formatMoney(calculation?.sale)} sin IGIC · {formatMoney(calculation?.finalSaleWithTax)} con IGIC</strong>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type AdvancedForm = {
  description: string;
  quantity: string;
  unit: string;
  igicRate: string;
  supplierName: string;
  supplierCode: string;
  supplierUnitPrice: string;
  directUnitCost: string;
  /** Coste total de la línea; si es el último editado, el servidor deriva el unitario. */
  directTotalCost: string;
  costSource: "unit" | "total";
  baseUnitPrice: string;
  saleRule: SaleRule;
  saleRuleValue: string;
  useSupplierListBase: boolean;
  internalReference: string;
  internalNotes: string;
};

function emptyAdvancedForm(): AdvancedForm {
  return {
    description: "",
    quantity: "1",
    unit: "ud",
    igicRate: "7",
    supplierName: "",
    supplierCode: "",
    supplierUnitPrice: "",
    directUnitCost: "",
    directTotalCost: "",
    costSource: "unit",
    baseUnitPrice: "",
    saleRule: "unit_price",
    saleRuleValue: "",
    useSupplierListBase: false,
    internalReference: "",
    internalNotes: "",
  };
}

function formFromLine(line: QuoteLine): AdvancedForm {
  return {
    description: line.description,
    quantity: toInputDecimal(line.quantity) || "1",
    unit: line.unit || "ud",
    igicRate: normalizedRate(line.igicRate),
    supplierName: line.supplierNameSnapshot ?? "",
    supplierCode: line.supplierCodeSnapshot ?? "",
    supplierUnitPrice: toInputDecimal(line.supplierUnitPrice),
    directUnitCost: toInputDecimal(line.directUnitCost),
    directTotalCost: "",
    costSource: "unit",
    baseUnitPrice: toInputDecimal(line.baseUnitPrice),
    saleRule: line.saleRule,
    saleRuleValue: toInputDecimal(line.saleRuleValue),
    useSupplierListBase: line.saleBaseMode === "supplier_list_price",
    internalReference: line.internalReference ?? "",
    internalNotes: line.internalNotes ?? "",
  };
}

function QuickTextField({ label, value, onChange, readOnly, className = "", placeholder }: { label: string; value: string; onChange: (value: string) => void; readOnly: boolean; className?: string | undefined; placeholder?: string | undefined }) {
  return <div className={`${styles.quickField} ${className}`}><label>{label}</label><input value={value} disabled={readOnly} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function QuickNumberField({ label, value, onChange, readOnly, className = "" }: { label: string; value: string; onChange: (value: string) => void; readOnly: boolean; className?: string | undefined }) {
  return <div className={`${styles.quickField} ${className}`}><label>{label}</label><DecimalInput value={value} disabled={readOnly} onValueChange={(value) => onChange(value)} /></div>;
}

function QuickMoneyField({ label, hint, value, onChange, readOnly, className = "" }: { label: string; hint?: string; value: string; onChange: (value: string) => void; readOnly: boolean; className?: string | undefined }) {
  return <div className={`${styles.quickField} ${className}`}><label>{label}{hint ? <small>{hint}</small> : null}</label><DecimalInput value={value} disabled={readOnly} placeholder="0" onValueChange={onChange} /></div>;
}

function QuickOutput({ label, value, className = "" }: { label: string; value: string | number | undefined; className?: string | undefined }) {
  return <div className={`${styles.quickField} ${styles.outputField} ${className}`}><label>{label}</label><output>{formatMoney(value)}</output></div>;
}

function QuickTotals({ preview }: { preview: SimplePreview }) {
  return (
    <div className={styles.quickTotals} aria-live="polite">
      <PreviewMetric label="Coste total" value={preview.costTotal} />
      <PreviewMetric label="Cliente · sin IGIC" value={preview.saleNet} />
      <PreviewMetric label="Cliente · con IGIC" value={preview.saleGross} />
      <PreviewMetric label="Beneficio" value={preview.profit} profit />
    </div>
  );
}

function PreviewMetric({ label, value, profit = false, plain = false, suffix = "" }: { label: string; value: string | number | undefined; profit?: boolean; plain?: boolean; suffix?: string }) {
  return <div className={`${styles.previewMetric}${profit ? ` ${styles.previewProfit}` : ""}${profit && String(value ?? "").startsWith("-") ? ` ${styles.previewNegative}` : ""}`}><span>{label}</span><strong>{plain ? `${formatNumber(value)}${suffix}` : formatMoney(value)}</strong></div>;
}

function EconomicStrip({ quote, onReviewPrice }: { quote: QuoteRecord; onReviewPrice: () => void }) {
  const calculation = quote.calculation;
  return (
    <section className={styles.economicStrip} aria-label="Resumen económico">
      <PreviewMetric label="Coste total" value={calculation?.cost} />
      <PreviewMetric label="Precio cliente · sin IGIC" value={calculation?.saleWithoutTax} />
      <PreviewMetric label="Precio cliente · con IGIC" value={calculation?.saleWithTax} />
      <PreviewMetric label="Beneficio estimado" value={calculation?.profit} profit />
      <div className={styles.stripAction}>
        <span>Cuando estén todas las líneas, comprueba el precio final.</span>
        <RippleButton onClick={onReviewPrice} disabled={!quote.lines.length}>Revisar precio final</RippleButton>
      </div>
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string | undefined }) {
  return <label className={`${styles.field} ${className}`}><span>{label}</span>{children}</label>;
}

function EditorSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return <section className={styles.editorSection}>
    <div className={styles.editorSectionHead}>
      <button type="button" className="editor-section-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span><strong>{title}</strong>{description ? <small>{description}</small> : null}</span><ChevronDown data-open={expanded || undefined} /></button>
      {action}
    </div>
    <div hidden={!expanded}>{children}</div>
  </section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

type SimplePreview = { costTotal: string | undefined; costUnit?: string | undefined; saleNet: string | undefined; saleGross: string | undefined; profit: string | undefined; saleUnitGross: string | undefined; effectiveDiscount?: string; saleBase?: string | null; error?: string | undefined; pending: boolean };

function simpleCommand(revision: number, type: ComposerType, description: string, quantity: string, unit: string, cost: string, price: string, igic: string, catalogId?: string): Extract<QuoteCommand, { type: "createQuoteLine" }> {
  return { type: "createQuoteLine", expectedRevision: revision, lineType: type,
    ...(catalogId ? { catalogMaterialId: catalogId } : {}),
    line: { description: description.trim(), unit: unit.trim() || "ud", quantity: decimalOr(quantity, "1"), igicRate: decimalOr(igic, "7"),
      saleRule: price.trim() ? "unit_price" : "add_percentage", saleRuleValue: decimalOrZero(price), saleBaseMode: "net_cost", directUnitCost: decimalOrZero(cost) }, discounts: [], laborEntries: [] };
}
function laborEntries(rows: LaborDraft[]) {
  return rows.filter((row) => row.employeeId || row.employeeName).map((row) => ({ ...(row.id ? { id: row.id } : {}), ...(row.employeeId ? { employeeId: row.employeeId } : {}), employeeNameSnapshot: row.employeeName || "Empleado", hours: decimalOr(row.hours, "1"), costRateSnapshot: decimalOrZero(row.costRate), saleRateSnapshot: decimalOrZero(row.saleRate) }));
}
function laborCommand(revision: number, description: string, igic: string, rows: LaborDraft[]): Extract<QuoteCommand, { type: "createQuoteLine" }> {
  return { type: "createQuoteLine", expectedRevision: revision, lineType: "labor", line: { description: description.trim(), unit: "h", quantity: "1", igicRate: decimalOr(igic, "7"), saleRule: "unit_price", saleRuleValue: "0" }, discounts: [], laborEntries: laborEntries(rows) };
}
function useEconomicPreview(quoteId: string, command: QuoteCommand | null): SimplePreview {
  const validCommand = command && (command.type === "createQuoteLine" || command.type === "updateQuoteLineDetails") && command.line.description.trim() ? command : null;
  const { result, error, pending } = useLinePreview(quoteId, validCommand);
  return { costTotal: result?.cost, costUnit: result?.costUnit, saleNet: result?.sale, saleGross: result?.finalSaleWithTax, profit: result?.profit, saleUnitGross: result?.saleUnitWithTax,
    ...(result?.effectiveSupplierDiscount !== undefined ? { effectiveDiscount: result.effectiveSupplierDiscount } : {}), ...(result?.saleBase !== undefined ? { saleBase: result.saleBase } : {}), error, pending };
}

function emptyLaborDraft(): LaborDraft {
  return { key: `labor-${Date.now()}-${Math.random().toString(36).slice(2)}`, employeeId: "", employeeName: "", hours: "1", costRate: "", saleRate: "" };
}

function laborDraftFromEntry(entry: LaborEntry): LaborDraft {
  return {
    key: entry.id,
    id: entry.id,
    employeeId: entry.employeeId ?? "",
    employeeName: entry.employeeNameSnapshot,
    hours: toInputDecimal(entry.hours) || "1",
    costRate: toInputDecimal(entry.costRateSnapshot),
    saleRate: toInputDecimal(entry.saleRateSnapshot),
  };
}

function findCreatedLine(before: Set<string>, current: QuoteRecord, type: QuoteLine["type"]) {
  return [...current.lines].reverse().find((line) => !before.has(line.id) && line.type === type);
}

function lineTypeLabel(line: QuoteLine) {
  if (line.type === "material") return "Material";
  if (line.type === "labor") return "Mano de obra";
  if (line.type === "travel") return "Desplazamiento";
  if (line.type === "other") return "Otro concepto";
  if (line.type === "adjustment") return "Ajuste";
  return "Título";
}

function lineSubtitle(line: QuoteLine) {
  if (line.type === "labor") return line.laborEntries.length ? line.laborEntries.map((entry) => entry.employeeNameSnapshot).join(" · ") : "Equipo de trabajo";
  if (line.supplierNameSnapshot) return line.supplierNameSnapshot;
  if (line.internalReference) return line.internalReference;
  return line.type === "material" ? "Material" : line.type === "travel" ? "Tarifas y conceptos" : "Concepto manual";
}

function laborHours(line: QuoteLine) {
  return line.laborEntries.reduce((sum, entry) => sum + num(entry.hours), 0);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function num(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const result = Number(String(value).replace(",", "."));
  return Number.isFinite(result) ? result : 0;
}

/** Decimal canónico para la API ("" si vacío o inválido). Acepta 13,96 · 13.96 · 1.234,50. */
function normalizeDecimal(value: string | number | null | undefined) {
  return parseDecimalText(value) ?? "";
}

function decimalOr(value: string, fallback: string) {
  return normalizeDecimal(value) || fallback;
}

function decimalOrZero(value: string) {
  return normalizeDecimal(value) || "0";
}

function toInputDecimal(value: string | number | null | undefined) {
  return formatDecimalInput(value);
}

/** Valor calculado por el servidor mostrado en un campo (presentación, máx. 6 decimales). */
function toDisplayDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatDecimalInput(numeric.toFixed(6)) : "";
}

function normalizedRate(value: string | null | undefined) {
  return toInputDecimal(value) || "7";
}

/** "40 + 10", "40; 12,5" o "40, 10": la coma seguida de espacio separa; "12,5" es decimal. */
function parseDiscounts(value: string) {
  return value.replaceAll("%", "").split(/\s*[+;]\s*|,\s+|\s+/).map((part) => normalizeDecimal(part)).filter(Boolean);
}

function formatDiscount(value: string | undefined) { return value === undefined ? "—" : `${formatNumber(value)} %`; }

function discountText(discounts: string[]) {
  if (!discounts.length) return "0 %";
  return discounts.map((value) => `${formatNumber(value)} %`).join(" + ");
}
