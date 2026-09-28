import type { GeneratorQuoteLink, HoldedEstimateDetail, HoldedEstimateSummary } from "@quotes/contracts";

/** Estimate remoto ya normalizado por el adaptador (decimales canónicos, sin enlace local). */
export type RemoteEstimateSummary = Omit<HoldedEstimateSummary, "generatorQuote">;
export type RemoteEstimateDetail = Omit<HoldedEstimateDetail, "generatorQuote" | "dataNotice">;

/** Elemento de listado: resumen + textos de líneas, usados solo para buscar (no se devuelven). */
export type RemoteEstimatePageItem = RemoteEstimateSummary & { lineTexts: string[] };

export interface RemoteEstimatePage {
  items: RemoteEstimatePageItem[];
  cursor: string | null;
  hasMore: boolean;
}

/**
 * Puerto de SOLO LECTURA hacia los Estimates de Holded. No expone escrituras:
 * crear/actualizar Estimates sigue siendo exclusivo de `syncQuoteToHolded`.
 * Los errores del adaptador se propagan; `retryable === true` indica un fallo
 * transitorio (rate limit, timeout, red) que no destruye datos.
 */
export interface HoldedEstimateReader {
  listPage(params: { cursor?: string; limit: number; contactId?: string }): Promise<RemoteEstimatePage>;
  /** `null` si Holded responde 404. */
  get(id: string): Promise<RemoteEstimateDetail | null>;
}

/** Busca presupuestos locales vinculados a Estimates remotos (aislado por instalación). */
export interface GeneratorQuoteLinkLookup {
  findByHoldedEstimateIds(installationId: string, holdedEstimateIds: string[]): Promise<Array<GeneratorQuoteLink & { holdedEstimateId: string }>>;
}

export interface HoldedEstimateQueryDeps {
  reader: HoldedEstimateReader;
  links: GeneratorQuoteLinkLookup;
}
