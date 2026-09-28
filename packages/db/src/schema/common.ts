import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const actorType = pgEnum("actor_type", ["user", "ai", "system", "worker"]);
export const syncStatus = pgEnum("sync_status", ["pending", "synced", "error", "conflict"]);
export const quoteOrigin = pgEnum("quote_origin", ["generator", "holded"]);
export const quoteAccessMode = pgEnum("quote_access_mode", ["editable", "read_only"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "ready_for_review", "finalized", "archived"]);

export const installations = pgTable("installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailUnique: uniqueIndex("users_installation_email_unique").on(table.installationId, table.email),
}));

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  holdedContactId: text("holded_contact_id"),
  syncStatus: syncStatus("sync_status").notNull().default("pending"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncedRevision: integer("last_synced_revision"),
  holdedPayloadHash: text("holded_payload_hash"),
  holdedSnapshot: jsonb("holded_snapshot").$type<Record<string, unknown>>(),
  syncError: text("sync_error"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletionSource: text("deletion_source"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  installationNameIndex: index("clients_installation_name_idx").on(table.installationId, table.name),
  holdedIdUnique: uniqueIndex("clients_installation_holded_id_unique").on(table.installationId, table.holdedContactId),
}));

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  taxId: text("tax_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  installationNameIndex: uniqueIndex("suppliers_installation_name_unique").on(table.installationId, table.name),
}));

export const catalogMaterials = pgTable("catalog_materials", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  name: text("name").notNull(),
  supplierNameSnapshot: text("supplier_name_snapshot"),
  supplierCode: text("supplier_code"),
  description: text("description"),
  unit: text("unit").notNull().default("unit"),
  supplierUnitPrice: numeric("supplier_unit_price", { precision: 18, scale: 6 }),
  saleUnitPrice: numeric("sale_unit_price", { precision: 18, scale: 6 }),
  igicRate: numeric("igic_rate", { precision: 5, scale: 2 }).notNull().default("7"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const catalogTravels = pgTable("catalog_travels", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").notNull().default("km"),
  costUnitPrice: numeric("cost_unit_price", { precision: 18, scale: 6 }).notNull().default("0"),
  saleUnitPrice: numeric("sale_unit_price", { precision: 18, scale: 6 }).notNull().default("0"),
  igicRate: numeric("igic_rate", { precision: 5, scale: 2 }).notNull().default("7"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  name: text("name").notNull(),
  costRate: numeric("cost_rate", { precision: 18, scale: 6 }).notNull().default("0"),
  saleRate: numeric("sale_rate", { precision: 18, scale: 6 }).notNull().default("0"),
  defaultIgicRate: numeric("default_igic_rate", { precision: 5, scale: 2 }).notNull().default("7"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employeeSupplements = pgTable("employee_supplements", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull().default("0"),
  addPerHour: numeric("add_per_hour", { precision: 18, scale: 6 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const textTemplates = pgTable("text_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => installations.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  alwaysInclude: boolean("always_include").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const commonRelations = relations(installations, ({ many }) => ({
  users: many(users),
  clients: many(clients),
  suppliers: many(suppliers),
  materials: many(catalogMaterials),
  travels: many(catalogTravels),
  employees: many(employees),
  textTemplates: many(textTemplates),
}));
