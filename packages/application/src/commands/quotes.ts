import type { CreateQuoteCommand, QuoteLifecycleCommand, QuoteRepository } from "../ports/quotes.js";

export function createQuote(repository: QuoteRepository) {
  return (input: CreateQuoteCommand) => repository.create(input);
}

export function duplicateQuote(repository: QuoteRepository) {
  return (installationId: string, id: string) => repository.duplicateQuote(installationId, id);
}

export function archiveQuote(repository: QuoteRepository) {
  return (input: Parameters<QuoteRepository["archiveQuote"]>[0]) => repository.archiveQuote(input);
}

export function updateQuote(repository: QuoteRepository) {
  return (input: Parameters<QuoteRepository["update"]>[0]) => repository.update(input);
}

/** Cambia el número del presupuesto. Único por instalación; si está en Holded se actualizará el mismo Estimate. */
export function changeQuoteReference(repository: QuoteRepository) {
  return (input: QuoteLifecycleCommand & { reference: string }) => repository.update({ installationId: input.installationId, id: input.id, expectedRevision: input.expectedRevision, reference: input.reference });
}

export function trashQuote(repository: QuoteRepository) {
  return (input: QuoteLifecycleCommand) => repository.trashQuote(input);
}

export function restoreQuote(repository: QuoteRepository) {
  return (input: QuoteLifecycleCommand) => repository.restoreQuote(input);
}

/** Solo datos locales; el Estimate de Holded, si existe, no se toca. */
export function deleteQuotePermanently(repository: QuoteRepository) {
  return (input: QuoteLifecycleCommand) => repository.deleteQuotePermanently(input);
}
