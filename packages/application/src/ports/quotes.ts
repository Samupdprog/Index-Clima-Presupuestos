export interface QuoteRecord {
  id: string;
  installationId: string;
  clientId: string | null;
  clientSnapshot: Record<string, unknown> | null;
  reference: string;
  title: string;
  origin: "generator" | "holded";
  accessMode: "editable" | "read_only";
  status: "draft" | "ready_for_review" | "finalized" | "archived";
  revision: number;
  duplicatedFromQuoteId: string | null;
  duplicateRootQuoteId: string | null;
  duplicateSequence: number | null;
  holdedEstimateId?: string | null;
  calculation?: unknown;
  lines: unknown[];
}

export interface CreateQuoteCommand {
  installationId: string;
  title: string;
  clientId?: string | undefined;
  origin?: "generator" | "holded" | undefined;
  accessMode?: "editable" | "read_only" | undefined;
}

export interface UpdateQuoteCommand {
  installationId: string;
  id: string;
  expectedRevision: number;
  title?: string;
  clientId?: string | null;
  status?: "draft" | "ready_for_review" | "finalized" | "archived";
  holdedEstimateId?: string;
}

export interface QuoteRepository {
  create(input: CreateQuoteCommand): Promise<QuoteRecord>;
  getQuoteById(installationId: string, id: string): Promise<QuoteRecord | null>;
  searchQuotes(installationId: string, query?: string): Promise<QuoteRecord[]>;
  update(input: UpdateQuoteCommand): Promise<QuoteRecord>;
  duplicateQuote(installationId: string, id: string): Promise<QuoteRecord>;
  archiveQuote(input: UpdateQuoteCommand): Promise<QuoteRecord>;
}
