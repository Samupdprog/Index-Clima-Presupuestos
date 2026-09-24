import type { QuoteWorkflowRepository } from "../ports/quote-workflow.js";

export function addMaterialLine(repository: QuoteWorkflowRepository) { return (input: Record<string, unknown>) => repository.addLine({ ...input, type: "material" }); }
export function addLaborLine(repository: QuoteWorkflowRepository) { return (input: Record<string, unknown>) => repository.addLine({ ...input, type: "labor" }); }
export function addTravelLine(repository: QuoteWorkflowRepository) { return (input: Record<string, unknown>) => repository.addLine({ ...input, type: "travel" }); }
export function addOtherLine(repository: QuoteWorkflowRepository) { return (input: Record<string, unknown>) => repository.addLine({ ...input, type: "other" }); }
export function addSupplierDiscount(repository: QuoteWorkflowRepository) { return (input: { installationId: string; quoteId: string; quoteLineId: string; expectedRevision: number; percentage: string }) => repository.addSupplierDiscount(input.installationId, input.quoteId, input.quoteLineId, input.expectedRevision, input.percentage); }
export function addLaborEntry(repository: QuoteWorkflowRepository) { return (input: { installationId: string; quoteId: string; quoteLineId: string; expectedRevision: number; entry: Record<string, unknown> }) => repository.addLaborEntry(input.installationId, input.quoteId, input.quoteLineId, input.expectedRevision, input.entry); }
export function addPriceAdjustment(repository: QuoteWorkflowRepository) { return (input: { installationId: string; quoteId: string; expectedRevision: number; adjustment: Record<string, unknown> }) => repository.addAdjustment(input.installationId, input.quoteId, input.expectedRevision, input.adjustment); }
export function addQuoteText(repository: QuoteWorkflowRepository) { return (input: { installationId: string; quoteId: string; expectedRevision: number; title: string; body: string }) => repository.addText(input.installationId, input.quoteId, input.expectedRevision, input.title, input.body); }

export async function executeQuoteCommand(repository: QuoteWorkflowRepository, command: Record<string, unknown>) {
	const input = { ...command, installationId: command.installationId, quoteId: command.quoteId };
	switch (command.type) {
		case "createQuoteLine": return repository.createLineWithDetails(input);
		case "updateQuoteLineDetails": return repository.updateLineDetails(input);
		case "updateQuoteLine": return repository.updateLine(input);
		case "deleteQuoteLine": return repository.deleteLine(input);
		case "reorderQuoteLines": return repository.reorderLines(input);
		case "updateSupplierDiscount": return repository.updateDiscount(input);
		case "removeSupplierDiscount": return repository.removeDiscount(input);
		case "reorderSupplierDiscounts": return repository.reorderDiscounts(input);
		case "updateLaborEntry": return repository.updateLaborEntry(input);
		case "removeLaborEntry": return repository.removeLaborEntry(input);
		case "updatePriceAdjustment": return repository.updateAdjustment(input);
		case "removePriceAdjustment": return repository.removeAdjustment(input);
		case "updateQuoteText": return repository.updateText(input);
		case "removeQuoteText": return repository.removeText(input);
		case "reorderQuoteTexts": return repository.reorderTexts(input);
		default: throw new Error("unsupported_quote_command");
	}
}
