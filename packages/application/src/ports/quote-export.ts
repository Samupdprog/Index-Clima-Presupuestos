import type { ClientRepository } from "./clients.js";
import type { QuoteRecord, QuoteRepository } from "./quotes.js";

export interface EstimateTax { id: string; key: string; name: string; amount: string | null; scope: string | null; group: string; type: string; status: boolean }
export type EstimateItem = { name: string; description?: string; type?: "product" | "service"; units: string; price: string; discount: string; taxes: string[]; unit_type?: string };
export interface EstimatePayload { contact_id: string; description: string; date: string; number: string; notes: string; tags?: string[]; currency: "EUR"; discount: string; tax_included: true; show_total: true; items: EstimateItem[] }
export interface RemoteEstimate { id: string; contact_id: string; document_number?: string | null; notes?: string | null; draft?: boolean | null; subtotal: string; tax: string; total: string; lines: Array<{ name: string; type?: string; units: string; price: string; discount: string; tax: string; taxes: string[]; unit_type?: string }> }
export interface EstimateGateway {
  listTaxes(): Promise<EstimateTax[]>;
  saveEstimate(input: EstimatePayload, documentId?: string | null): Promise<{ id: string }>;
  getEstimate(id: string): Promise<RemoteEstimate>;
  approveEstimate(id: string): Promise<void>;
  getEstimatePdf(id: string): Promise<Uint8Array>;
  findEstimateByTag(tag: string, contactId: string): Promise<string | null>;
}
export interface QuoteExportRepository {
  withLock<T>(installationId: string, quoteId: string, work: () => Promise<T>): Promise<T>;
  reserve(installationId: string, quoteId: string, expectedRevision: number): Promise<{ documentId: string | null; uncertain: boolean }>;
  recordId(installationId: string, quoteId: string, documentId: string | null): Promise<void>;
  complete(installationId: string, quoteId: string, exportedRevision: number): Promise<void>;
  fail(installationId: string, quoteId: string, message: string, uncertain: boolean): Promise<void>;
}
export interface QuoteExportDeps { quotes: QuoteRepository; clients: ClientRepository; exports: QuoteExportRepository; holded: EstimateGateway; taxMapping?: Record<string, string>; logExport?: (event: { operation: "estimate.create" | "estimate.update"; quoteId: string; holdedEstimateId: string | null; number: string; lineCount: number; taxIncluded: boolean; status: "synced" | "failed"; errorCode?: string; httpStatus?: number }) => void }
export type ExportableQuote = QuoteRecord;
