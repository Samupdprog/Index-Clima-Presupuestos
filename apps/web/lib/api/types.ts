export type QuoteStatus = "draft" | "ready_for_review" | "finalized" | "archived";
export type QuoteOrigin = "generator" | "holded";
export type QuoteAccessMode = "editable" | "read_only";
export type LineType = "material" | "labor" | "travel" | "adjustment" | "other" | "title";
export type SaleRule = "unit_price" | "fixed_line_total" | "add_euros_per_unit" | "add_percentage";

export interface ClientRecord {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  revision: number;
  updatedAt?: string;
}

export interface LaborEntry {
  id: string;
  quoteLineId: string;
  employeeId: string | null;
  employeeNameSnapshot: string;
  hours: string;
  costRateSnapshot: string;
  saleRateSnapshot: string;
  supplementNameSnapshot: string | null;
  supplementPerHourSnapshot: string | null;
}

export interface SupplierDiscount {
  id: string;
  quoteLineId: string;
  position: number;
  percentage: string;
}

export interface QuoteLine {
  id: string;
  quoteId: string;
  position: number;
  type: LineType;
  description: string;
  unit: string;
  quantity: string;
  igicRate: string;
  saleRule: SaleRule;
  saleBaseMode: "net_cost" | "supplier_list_price";
  saleRuleValue: string;
  baseUnitPrice: string | null;
  directUnitCost: string | null;
  supplierUnitPrice: string | null;
  supplierNameSnapshot: string | null;
  supplierCodeSnapshot: string | null;
  internalReference: string | null;
  internalNotes: string | null;
  eligibleForPriceAllocation: boolean;
  discounts: SupplierDiscount[];
  laborEntries: LaborEntry[];
}

export interface CalculatedLine {
  quoteLineId?: string;
  id?: string;
  cost: string;
  baseSale: string;
  sale: string;
  adjustment: string;
  profit: string;
  igic: string;
  finalSaleWithTax: string;
}

export interface QuoteCalculation {
  cost: string;
  profit: string;
  subtotal: string;
  igic: string;
  total: string;
  saleWithoutTax: string;
  taxTotal: string;
  saleWithTax: string;
  profitOnCostPct?: string | null;
  marginOnSalePct?: string | null;
  lines: CalculatedLine[];
}

export interface QuoteText {
  id: string;
  position: number;
  title: string | null;
  body: string;
}

export interface PriceAdjustment {
  id: string;
  scope: "line" | "selection" | "quote";
  mode: "amount" | "percentage" | "target_total";
  value: string;
  targetLineIds: string[];
}

export interface QuoteRecord {
  id: string;
  clientId: string | null;
  clientSnapshot: { name?: string; taxId?: string; email?: string; phone?: string; address?: string } | null;
  reference: string;
  title: string;
  origin: QuoteOrigin;
  accessMode: QuoteAccessMode;
  status: QuoteStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lines: QuoteLine[];
  priceAdjustments?: PriceAdjustment[];
  texts?: QuoteText[];
  calculation?: QuoteCalculation | null;
}

export interface MaterialRecord {
  id: string; name: string; supplierId: string | null; supplierNameSnapshot: string | null;
  supplierCode: string | null; description: string | null; unit: string;
  supplierUnitPrice: string | null; saleUnitPrice: string | null; igicRate: string; active: boolean;
}
export interface EmployeeRecord { id: string; name: string; costRate: string; saleRate: string; defaultIgicRate: string; active: boolean; }
export interface TravelRecord { id: string; name: string; description: string | null; unit: string; costUnitPrice: string; saleUnitPrice: string; igicRate: string; active: boolean; }
export interface SupplierRecord { id: string; name: string; taxId: string | null; active: boolean; }
export interface TextTemplateRecord { id: string; title: string; body: string; alwaysInclude: boolean; active: boolean; name?: string; }

export type CatalogKind = "materials" | "employees" | "travels" | "text-templates" | "suppliers";
export type CatalogRecord = MaterialRecord | EmployeeRecord | TravelRecord | SupplierRecord | TextTemplateRecord;
