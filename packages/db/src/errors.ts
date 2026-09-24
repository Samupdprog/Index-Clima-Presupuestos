export class RevisionConflictError extends Error {
  constructor(public readonly entity: string, public readonly id: string) {
    super(`${entity} ${id} revision conflict`);
    this.name = "RevisionConflictError";
  }
}

export class QuoteNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`quote ${id} not found`);
    this.name = "QuoteNotFoundError";
  }
}

export class ReadOnlyQuoteError extends Error {
  constructor(public readonly id: string) {
    super(`quote ${id} is read-only`);
    this.name = "ReadOnlyQuoteError";
  }
}

/**
 * Se lanza cuando una operación apunta a una installation inexistente
 * (p. ej. un UPDATE que afectaría a cero filas). Evita "guardados" silenciosos
 * que en realidad no persisten nada.
 */
export class InstallationNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`installation ${id} not found`);
    this.name = "InstallationNotFoundError";
  }
}