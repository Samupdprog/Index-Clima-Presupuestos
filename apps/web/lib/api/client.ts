import type { CreateClientRequest, CreateQuoteRequest, MaterialImportRow, QuoteCommand, UpdateClientRequest, PreviewPriceAdjustmentRequest, PriceAdjustmentPreview } from "@quotes/contracts";
import type {
  CatalogKind,
  CatalogRecord,
  ClientRecord,
  EmployeeRecord,
  MaterialRecord,
  QuoteRecord,
  SupplierRecord,
  TextTemplateRecord,
  TravelRecord,
  CalculatedLine,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
    this.name = "ApiError";
  }
  get isRevisionConflict() { return this.status === 409 && this.code === "revision_conflict"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; details?: unknown };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "unknown_error", payload.details);
  return payload as T;
}

export type HoldedSearchStatus = "disabled" | "ok" | "degraded" | null;

async function requestWithHoldedStatus<T>(path: string): Promise<{ data: T; holded: HoldedSearchStatus }> {
  const response = await fetch(`/api/backend${path}`, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; details?: unknown };
  if (!response.ok) throw new ApiError(response.status, (payload as { error?: string }).error ?? "unknown_error");
  return { data: payload as T, holded: response.headers.get("x-holded-search") as HoldedSearchStatus };
}

function query(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) search.set(key, value); });
  return `${path}?${search}`;
}

export interface HoldedSettingsResponse {
  taxMapping?: Record<string, string>;
  featureEnabled: boolean;
  isConfigured: boolean;
  keyMasked: string | null;
  checkIntervalMinutes: number;
  health: HoldedHealth;
}

export interface HoldedHealth {
  status: "unknown" | "checking" | "healthy" | "unhealthy";
  code: "ok" | "invalid_api_key" | "insufficient_permissions" | "network_error" | "rate_limit" | "unexpected_error" | "not_configured" | "unknown";
  message: string | null;
  lastCheckedAt: string | null;
}

export const api = {
  searchQuotes: (q = "", scope: "active" | "trash" = "active") => request<QuoteRecord[]>(query("/quotes", { q, scope })),
  getQuote: (id: string) => request<QuoteRecord>(`/quotes/${id}`),
  createQuote: (data: CreateQuoteRequest) => request<QuoteRecord>("/quotes", { method: "POST", body: JSON.stringify(data) }),
  duplicateQuote: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/duplicate`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
  changeQuoteReference: (id: string, expectedRevision: number, reference: string) => request<QuoteRecord>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "changeQuoteReference", expectedRevision, reference }) }),
  trashQuote: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "trashQuote", expectedRevision }) }),
  restoreQuote: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "restoreQuote", expectedRevision }) }),
  deleteQuotePermanently: (id: string, expectedRevision: number) => request<{ deleted: true; reference: string }>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "deleteQuotePermanently", expectedRevision, confirm: true }) }),
  archiveQuote: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "archiveQuote", expectedRevision }) }),
  exportQuoteToHolded: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/holded`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
  command: (id: string, command: QuoteCommand) => request<{ quote: QuoteRecord; calculation: QuoteRecord["calculation"] }>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify(command) }),
  previewAdjustment: (id: string, input: PreviewPriceAdjustmentRequest) => request<PriceAdjustmentPreview>(`/quotes/${id}/adjustments/preview`, { method: "POST", body: JSON.stringify(input) }),
  previewLine: (id: string, command: QuoteCommand) => request<CalculatedLine & { saleBase?: string | null; effectiveSupplierDiscount?: string }>(`/quotes/${id}/preview-line`, { method: "POST", body: JSON.stringify(command) }),
  deleteClient: (id: string, expectedRevision: number, deleteFromHolded: boolean) => request<ClientRecord>(`/clients/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision, deleteFromHolded }) }),
  syncClients: () => request<{ synced?: number; archived?: number }>("/clients/sync", { method: "POST", body: "{}" }),
  syncClient: (id: string, expectedRevision: number) => request<ClientRecord>(`/clients/${id}/sync`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
  dataResetStatus: () => request<{ allowed: boolean }>("/settings/data-reset"),
  resetData: (confirmation: string) => request<{ reset: boolean }>("/settings/data-reset", { method: "POST", body: JSON.stringify({ confirmation, confirmed: true }) }),

  searchClients: (q = "") => request<ClientRecord[]>(query("/clients", { q })),
  searchClientsWithStatus: (q = "") => requestWithHoldedStatus<ClientRecord[]>(query("/clients", { q })),
  createClient: (data: CreateClientRequest) => request<ClientRecord>("/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id: string, data: UpdateClientRequest) => request<ClientRecord>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getHoldedSettings: () => request<HoldedSettingsResponse>("/holded/settings"),
  updateHoldedSettings: (data: { apiKey?: string; checkIntervalMinutes?: number; removeApiKey?: boolean; taxMapping?: Record<string, string> }) => request<HoldedSettingsResponse>("/holded/settings", { method: "PATCH", body: JSON.stringify(data) }),
  getHoldedTaxes: () => request<Array<{ key: string; name: string; amount: string | null; status: boolean; scope: string | null }>>("/holded/taxes"),
  checkHoldedHealth: () => request<HoldedSettingsResponse["health"]>("/holded/health", { method: "POST", body: JSON.stringify({}) }),

  getCatalog: <T extends CatalogRecord>(kind: CatalogKind) => request<T[]>(`/catalogs/${kind}`),
  createCatalog: <T extends CatalogRecord>(kind: CatalogKind, data: Record<string, unknown>) => request<T>(`/catalogs/${kind}`, { method: "POST", body: JSON.stringify(data) }),
  updateCatalog: <T extends CatalogRecord>(kind: CatalogKind, id: string, data: Record<string, unknown>) => request<T>(`/catalogs/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  archiveCatalog: <T extends CatalogRecord>(kind: CatalogKind, id: string) => request<T>(`/catalogs/${kind}/${id}/archive`, { method: "POST", body: "{}" }),
  importMaterials: (rows: MaterialImportRow[]) => request<MaterialRecord[]>("/catalogs/materials/import", { method: "POST", body: JSON.stringify({ rows }) }),
};

export type { MaterialRecord, EmployeeRecord, TravelRecord, SupplierRecord, TextTemplateRecord };
