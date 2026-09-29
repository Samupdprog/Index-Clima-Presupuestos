import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clients, employees, installations, quoteAccessMode, quoteOrigin, quoteStatus, suppliers, users } from "./common.js";

export const quoteLineType = pgEnum("quote_line_type", ["material", "labor", "travel", "adjustment", "other", "title"]);
export const saleRuleType = pgEnum("sale_rule_type", ["unit_price", "fixed_line_total", "add_euros_per_unit", "add_percentage"]);
export const saleBaseMode = pgEnum("sale_base_mode", ["net_cost", "supplier_list_price"]);
export const adjustmentScope = pgEnum("adjustment_scope", ["line", "selection", "quote"]);
export const adjustmentMode = pgEnum("adjustment_mode", ["amount", "percentage", "target_total"]);

export const referenceCounters = pgTable("reference_counters", {
  installationId: uuid("installation_id").primaryKey().references(() => installations.id),
  quoteNextValue: integer("quote_next_value").notNull().default(1),
});

export const quotes = pgTable("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  clientId: uuid("client_id").references(() => clients.id),
  clientSnapshot: jsonb("client_snapshot").$type<Record<string, unknown>>(),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  origin: quoteOrigin("origin").notNull().default("generator"),
  accessMode: quoteAccessMode("access_mode").notNull().default("editable"),
  status: quoteStatus("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(0),
  holdedEstimateId: text("holded_estimate_id"),
  holdedSyncStatus: text("holded_sync_status").notNull().default("idle"),
  holdedSyncError: text("holded_sync_error"),
  holdedLastSyncedAt: timestamp("holded_last_synced_at", { withTimezone: true }),
  holdedLastSyncedRevision: integer("holded_last_synced_revision"),
  /** Número con el que se sincronizó por última vez en Holded (permite renombrar el mismo Estimate). */
  holdedSyncedReference: text("holded_synced_reference"),
  /** Papelera: el presupuesto queda oculto y en solo lectura hasta restaurarlo o eliminarlo. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  duplicatedFromQuoteId: uuid("duplicated_from_quote_id"),
  duplicateRootQuoteId: uuid("duplicate_root_quote_id"),
  duplicateSequence: integer("duplicate_sequence"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  referenceUnique: uniqueIndex("quotes_installation_reference_unique").on(table.installationId, table.reference),
  searchIndex: index("quotes_installation_status_idx").on(table.installationId, table.status, table.updatedAt),
  holdedIdUnique: uniqueIndex("quotes_installation_holded_id_unique").on(table.installationId, table.holdedEstimateId),
}));

export const quoteLines = pgTable("quote_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  position: integer("position").notNull(),
  type: quoteLineType("type").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull().default("unit"),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull().default("1"),
  igicRate: numeric("igic_rate", { precision: 5, scale: 2 }).notNull().default("7"),
  saleRule: saleRuleType("sale_rule").notNull(),
  saleBaseMode: saleBaseMode("sale_base_mode").notNull().default("net_cost"),
  saleRuleValue: numeric("sale_rule_value", { precision: 18, scale: 6 }).notNull().default("0"),
  baseUnitPrice: numeric("base_unit_price", { precision: 18, scale: 6 }),
  directUnitCost: numeric("direct_unit_cost", { precision: 18, scale: 6 }),
  supplierUnitPrice: numeric("supplier_unit_price", { precision: 18, scale: 6 }),
  supplierNameSnapshot: text("supplier_name_snapshot"),
  supplierCodeSnapshot: text("supplier_code_snapshot"),
  supplierListPriceSnapshot: numeric("supplier_list_price_snapshot", { precision: 18, scale: 6 }),
  costSnapshot: numeric("cost_snapshot", { precision: 18, scale: 6 }),
  priceSnapshot: numeric("price_snapshot", { precision: 18, scale: 6 }),
  eligibleForPriceAllocation: boolean("eligible_for_price_allocation").notNull().default(true),
  internalReference: text("internal_reference"),
  internalNotes: text("internal_notes"),
  catalogMaterialId: uuid("catalog_material_id"),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  quotePositionUnique: uniqueIndex("quote_lines_quote_position_unique").on(table.quoteId, table.position),
  quantityNonNegative: check("quote_lines_quantity_non_negative", sql`${table.quantity} >= 0`),
}));

export const quoteLineDiscounts = pgTable("quote_line_discounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteLineId: uuid("quote_line_id").notNull().references(() => quoteLines.id),
  position: integer("position").notNull(),
  percentage: numeric("percentage", { precision: 9, scale: 6 }).notNull(),
}, (table) => ({
  orderUnique: uniqueIndex("quote_line_discounts_order_unique").on(table.quoteLineId, table.position),
}));

export const quoteLineLaborEntries = pgTable("quote_line_labor_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteLineId: uuid("quote_line_id").notNull().references(() => quoteLines.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  employeeNameSnapshot: text("employee_name_snapshot").notNull(),
  hours: numeric("hours", { precision: 18, scale: 6 }).notNull(),
  costRateSnapshot: numeric("cost_rate_snapshot", { precision: 18, scale: 6 }).notNull(),
  saleRateSnapshot: numeric("sale_rate_snapshot", { precision: 18, scale: 6 }).notNull(),
  supplementId: uuid("supplement_id"),
  supplementNameSnapshot: text("supplement_name_snapshot"),
  supplementPerHourSnapshot: numeric("supplement_per_hour_snapshot", { precision: 18, scale: 6 }),
});

export const quotePriceAdjustments = pgTable("quote_price_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  scope: adjustmentScope("scope").notNull(),
  mode: adjustmentMode("mode").notNull(),
  value: numeric("value", { precision: 18, scale: 6 }).notNull(),
  allocationMethod: text("allocation_method").notNull().default("proportional"),
  baseQuoteRevision: integer("base_quote_revision").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const quotePriceAdjustmentTargets = pgTable("quote_price_adjustment_targets", {
  adjustmentId: uuid("adjustment_id").notNull().references(() => quotePriceAdjustments.id),
  quoteLineId: uuid("quote_line_id").notNull().references(() => quoteLines.id),
}, (table) => ({
  primaryKey: uniqueIndex("quote_price_adjustment_targets_unique").on(table.adjustmentId, table.quoteLineId),
}));

export const quoteTextBlocks = pgTable("quote_text_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  position: integer("position").notNull(),
  templateId: uuid("template_id"),
  title: text("title"),
  body: text("body").notNull(),
  titleSnapshot: text("title_snapshot"),
  bodySnapshot: text("body_snapshot"),
});

export const quoteCalculationRuns = pgTable("quote_calculation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  quoteRevision: integer("quote_revision").notNull(),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
  igic: numeric("igic", { precision: 18, scale: 2 }).notNull(),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
  profit: numeric("profit", { precision: 18, scale: 2 }).notNull(),
  saleWithoutTax: numeric("sale_without_tax", { precision: 18, scale: 2 }).notNull(),
  taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull(),
  saleWithTax: numeric("sale_with_tax", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const quoteLineCalculations = pgTable("quote_line_calculations", {
  id: uuid("id").defaultRandom().primaryKey(),
  calculationRunId: uuid("calculation_run_id").notNull().references(() => quoteCalculationRuns.id),
  quoteLineId: uuid("quote_line_id").notNull().references(() => quoteLines.id),
  cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
  baseSale: numeric("base_sale", { precision: 18, scale: 2 }).notNull(),
  sale: numeric("sale", { precision: 18, scale: 2 }).notNull(),
  adjustment: numeric("adjustment", { precision: 18, scale: 2 }).notNull(),
  profit: numeric("profit", { precision: 18, scale: 2 }).notNull(),
  igic: numeric("igic", { precision: 18, scale: 2 }).notNull().default("0"),
  finalSaleWithTax: numeric("final_sale_with_tax", { precision: 18, scale: 2 }).notNull().default("0"),
});

export const quoteVersions = pgTable("quote_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  revisionUnique: uniqueIndex("quote_versions_quote_revision_unique").on(table.quoteId, table.revision),
}));
