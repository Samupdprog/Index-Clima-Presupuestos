import type { CreateClientRequest, CreateQuoteRequest, QuoteCommand, UpdateClientRequest } from "@quotes/contracts";
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

function query(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) search.set(key, value); });
  return `${path}?${search}`;
}

export const api = {
  searchQuotes: (q = "") => request<QuoteRecord[]>(query("/quotes", { q })),
  getQuote: (id: string) => request<QuoteRecord>(`/quotes/${id}`),
  createQuote: (data: CreateQuoteRequest) => request<QuoteRecord>("/quotes", { method: "POST", body: JSON.stringify(data) }),
  duplicateQuote: (id: string) => request<QuoteRecord>(`/quotes/${id}/duplicate`, { method: "POST", body: "{}" }),
  archiveQuote: (id: string, expectedRevision: number) => request<QuoteRecord>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify({ type: "archiveQuote", expectedRevision }) }),
  command: (id: string, command: QuoteCommand) => request<{ quote: QuoteRecord; calculation: QuoteRecord["calculation"] }>(`/quotes/${id}/commands`, { method: "POST", body: JSON.stringify(command) }),

  searchClients: (q = "") => request<ClientRecord[]>(query("/clients", { q })),
  createClient: (data: CreateClientRequest) => request<ClientRecord>("/clients", { method: "POST", body: JSON.stringify(data) }),
  updateClient: (id: string, data: UpdateClientRequest) => request<ClientRecord>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getCatalog: <T extends CatalogRecord>(kind: CatalogKind) => request<T[]>(`/catalogs/${kind}`),
  createCatalog: <T extends CatalogRecord>(kind: CatalogKind, data: Record<string, unknown>) => request<T>(`/catalogs/${kind}`, { method: "POST", body: JSON.stringify(data) }),
  updateCatalog: <T extends CatalogRecord>(kind: CatalogKind, id: string, data: Record<string, unknown>) => request<T>(`/catalogs/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  archiveCatalog: <T extends CatalogRecord>(kind: CatalogKind, id: string) => request<T>(`/catalogs/${kind}/${id}/archive`, { method: "POST", body: "{}" }),
};

export type { MaterialRecord, EmployeeRecord, TravelRecord, SupplierRecord, TextTemplateRecord };
