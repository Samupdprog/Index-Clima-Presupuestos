export interface QuoteWorkflowRepository {
  createLineWithDetails(input: Record<string, unknown>): Promise<unknown>;
  updateLineDetails(input: Record<string, unknown>): Promise<unknown>;
  addLine(input: Record<string, unknown>): Promise<unknown>;
  addSupplierDiscount(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, percentage: string): Promise<unknown>;
  addLaborEntry(installationId: string, quoteId: string, quoteLineId: string, expectedRevision: number, entry: Record<string, unknown>): Promise<unknown>;
  addAdjustment(installationId: string, quoteId: string, expectedRevision: number, adjustment: Record<string, unknown>): Promise<unknown>;
  addText(installationId: string, quoteId: string, expectedRevision: number, title: string, body: string): Promise<unknown>;
  updateLine(input: Record<string, unknown>): Promise<unknown>;
  deleteLine(input: Record<string, unknown>): Promise<unknown>;
  reorderLines(input: Record<string, unknown>): Promise<unknown>;
  updateDiscount(input: Record<string, unknown>): Promise<unknown>;
  removeDiscount(input: Record<string, unknown>): Promise<unknown>;
  reorderDiscounts(input: Record<string, unknown>): Promise<unknown>;
  updateLaborEntry(input: Record<string, unknown>): Promise<unknown>;
  removeLaborEntry(input: Record<string, unknown>): Promise<unknown>;
  updateAdjustment(input: Record<string, unknown>): Promise<unknown>;
  removeAdjustment(input: Record<string, unknown>): Promise<unknown>;
  updateText(input: Record<string, unknown>): Promise<unknown>;
  removeText(input: Record<string, unknown>): Promise<unknown>;
  reorderTexts(input: Record<string, unknown>): Promise<unknown>;
}
