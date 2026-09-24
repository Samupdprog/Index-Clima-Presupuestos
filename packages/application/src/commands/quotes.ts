import type { CreateQuoteCommand, QuoteRepository } from "../ports/quotes.js";

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
