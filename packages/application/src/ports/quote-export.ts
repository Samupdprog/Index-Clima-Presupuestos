import type { ClientRepository } from "./clients.js";
import type { QuoteRecord, QuoteRepository } from "./quotes.js";

export interface EstimateTax { id: string; key: string; name: string; amount: string | null; scope: string | null; group: string; type: string; status: boolean }
export interface EstimateItem { name: string; description?: string; type?: "product" | "service" | "title"; units: string; price: string; discount: string; taxes: string[]; unit_type?: string }
export interface EstimatePayload { contact_id: string; description: string; date: string; notes?: string; tags?: string[]; currency: "EUR"; discount: string; tax_included: false; items: EstimateItem[] }
export interface RemoteEstimate { id: string; contact_id: string; subtotal: string; tax: string; total: string; lines: Array<{ name: string; units: string; price: string; discount: string; tax: string; taxes: string[] }> }
export interface EstimateGateway {
  listTaxes(): Promise<EstimateTax[]>;
  saveEstimate(input: EstimatePayload, documentId?: string | null): Promise<{ id: string }>;
  getEstimate(id: string): Promise<RemoteEstimate>;
  findEstimateByTag(tag: string, contactId: string): Promise<string | null>;
}
export interface QuoteExportRepository {
  withLock<T>(installationId: string, quoteId: string, work: () => Promise<T>): Promise<T>;
  reserve(installationId: string, quoteId: string, expectedRevision: number): Promise<{ documentId: string | null; uncertain: boolean }>;
  recordId(installationId: string, quoteId: string, documentId: string): Promise<void>;
  complete(installationId: string, quoteId: string, exportedRevision: number): Promise<void>;
  fail(installationId: string, quoteId: string, message: string, uncertain: boolean): Promise<void>;
}
export interface QuoteExportDeps { quotes: QuoteRepository; clients: ClientRepository; exports: QuoteExportRepository; holded: EstimateGateway; taxMapping?: Record<string, string> }
export type ExportableQuote = QuoteRecord;
