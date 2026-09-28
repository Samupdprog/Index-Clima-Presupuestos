import {
  HOLDED_ESTIMATES_DATA_NOTICE,
  type GeneratorQuoteLink,
  type HoldedEstimateDetail,
  type HoldedEstimateList,
  type HoldedEstimateSearch,
  type ListHoldedEstimatesQuery,
  type SearchHoldedEstimatesQuery,
} from "@quotes/contracts";
import type { HoldedEstimateQueryDeps, RemoteEstimatePageItem } from "../ports/holded-estimates.js";

/** Tamaño de página usado al recorrer Holded para buscar (máximo documentado: 100). */
export const HOLDED_SEARCH_PAGE_SIZE = 100;

/** Error de consulta Holded detectado por la aplicación (no por HTTP). */
export class HoldedEstimateQueryError extends Error {
  constructor(readonly code: "holded_cursor_loop") {
    super(code);
    this.name = "HoldedEstimateQueryError";
  }
}

// Palabras frecuentes en peticiones en lenguaje natural que no identifican un documento.
const STOPWORDS = new Set(["a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "lo", "los", "para", "por", "presupuesto", "presupuestos", "un", "una", "y"]);
const FIELD_WEIGHTS = { documentNumber: 50, contactName: 20, description: 15, tags: 10, lines: 5 } as const;
type SearchField = keyof typeof FIELD_WEIGHTS;

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
function compact(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}
/**
 * Tokens de búsqueda: palabras separadas por espacios, en forma compacta sin
 * acentos ni signos ("P-15" → "p15"). Se ignoran palabras vacías y tokens de un
 * carácter cuando hay otros más significativos.
 */
export function searchTokens(query: string) {
  const all = normalize(query).split(/\s+/).map(compact).filter(Boolean);
  const meaningful = all.filter((token) => !STOPWORDS.has(token) && token.length > 1);
  return meaningful.length ? [...new Set(meaningful)] : [...new Set(all)];
}

function fieldTexts(item: RemoteEstimatePageItem): Record<SearchField, string[]> {
  return {
    documentNumber: item.documentNumber ? [item.documentNumber] : [],
    contactName: item.contactName ? [item.contactName] : [],
    description: item.description ? [item.description] : [],
    tags: item.tags,
    lines: item.lineTexts,
  };
}

/** Puntúa una coincidencia: todos los tokens deben aparecer en algún campo real. */
export function scoreEstimate(item: RemoteEstimatePageItem, query: string, tokens: string[]) {
  const texts = fieldTexts(item);
  const matched = new Set<SearchField>();
  let score = 0;
  const exactNumber = Boolean(item.documentNumber && compact(query) && compact(item.documentNumber) === compact(query));
  if (exactNumber) { score += 1000; matched.add("documentNumber"); }
  for (const token of tokens) {
    let tokenMatched = false;
    for (const field of Object.keys(texts) as SearchField[]) {
      if (texts[field].some((text) => compact(text).includes(token))) {
        tokenMatched = true;
        matched.add(field);
        score += FIELD_WEIGHTS[field];
      }
    }
    if (!tokenMatched && !exactNumber) return null;
  }
  return { score, matchedFields: [...matched] };
}

async function linksFor(deps: HoldedEstimateQueryDeps, installationId: string, ids: string[]) {
  const map = new Map<string, GeneratorQuoteLink>();
  if (!ids.length) return map;
  for (const link of await deps.links.findByHoldedEstimateIds(installationId, [...new Set(ids)])) {
    map.set(link.holdedEstimateId, { quoteId: link.quoteId, reference: link.reference });
  }
  return map;
}

function withoutLineTexts({ lineTexts: _lineTexts, ...summary }: RemoteEstimatePageItem) {
  return summary;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
}
function isRetryable(error: unknown) {
  return Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable: unknown }).retryable === true);
}

export function listHoldedEstimates(deps: HoldedEstimateQueryDeps) {
  return async (installationId: string, query: ListHoldedEstimatesQuery): Promise<HoldedEstimateList> => {
    const page = await deps.reader.listPage({ limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.contactId ? { contactId: query.contactId } : {}) });
    // Un cursor ausente o idéntico al solicitado haría que el cliente pagine en bucle.
    if (page.hasMore && (!page.cursor || page.cursor === query.cursor)) throw new HoldedEstimateQueryError("holded_cursor_loop");
    const links = await linksFor(deps, installationId, page.items.map((item) => item.holdedEstimateId));
    return {
      source: "holded",
      items: page.items.map((item) => ({ ...withoutLineTexts(item), generatorQuote: links.get(item.holdedEstimateId) ?? null })),
      hasMore: page.hasMore,
      nextCursor: page.hasMore ? page.cursor : null,
      dataNotice: HOLDED_ESTIMATES_DATA_NOTICE,
    };
  };
}

/**
 * Holded v2 no ofrece búsqueda de Estimates: se recorren páginas con límite
 * estricto (`maxPages`), detección de cursores repetidos y sin reintentos. Un
 * fallo transitorio tras la primera página devuelve resultados parciales
 * marcados como truncados, con `resumeCursor` para continuar más tarde.
 */
export function searchHoldedEstimates(deps: HoldedEstimateQueryDeps) {
  return async (installationId: string, query: SearchHoldedEstimatesQuery): Promise<HoldedEstimateSearch> => {
    const tokens = searchTokens(query.q);
    const matches: Array<{ item: RemoteEstimatePageItem; score: number; matchedFields: string[] }> = [];
    const seenCursors = new Set<string>(query.cursor ? [query.cursor] : []);
    const seenIds = new Set<string>();
    let cursor = query.cursor;
    let scannedPages = 0;
    let scannedEstimates = 0;
    let truncatedReason: HoldedEstimateSearch["truncatedReason"] = null;
    let resumeCursor: string | null = null;

    if (tokens.length || compact(query.q)) {
      for (;;) {
        let page;
        try {
          page = await deps.reader.listPage({ limit: HOLDED_SEARCH_PAGE_SIZE, ...(cursor ? { cursor } : {}), ...(query.contactId ? { contactId: query.contactId } : {}) });
        } catch (error) {
          if (scannedPages === 0 || !isRetryable(error)) throw error;
          truncatedReason = errorCode(error) === "rate_limited" ? "rate_limited" : "holded_unavailable";
          resumeCursor = cursor ?? null;
          break;
        }
        scannedPages += 1;
        scannedEstimates += page.items.length;
        for (const item of page.items) {
          if (seenIds.has(item.holdedEstimateId)) continue;
          seenIds.add(item.holdedEstimateId);
          const result = scoreEstimate(item, query.q, tokens);
          if (result) matches.push({ item, ...result });
        }
        if (!page.hasMore) break;
        if (!page.cursor || seenCursors.has(page.cursor)) throw new HoldedEstimateQueryError("holded_cursor_loop");
        seenCursors.add(page.cursor);
        cursor = page.cursor;
        if (scannedPages >= query.maxPages) {
          truncatedReason = "max_pages";
          resumeCursor = cursor;
          break;
        }
      }
    }

    matches.sort((a, b) => b.score - a.score || (b.item.date ?? "").localeCompare(a.item.date ?? ""));
    const selected = matches.slice(0, query.limit);
    const links = await linksFor(deps, installationId, selected.map((match) => match.item.holdedEstimateId));
    return {
      source: "holded",
      query: query.q,
      items: selected.map(({ item, matchedFields }) => ({ ...withoutLineTexts(item), generatorQuote: links.get(item.holdedEstimateId) ?? null, matchedFields })),
      totalMatches: matches.length,
      scannedPages,
      scannedEstimates,
      truncated: truncatedReason !== null,
      truncatedReason,
      resumeCursor,
      dataNotice: HOLDED_ESTIMATES_DATA_NOTICE,
    };
  };
}

export function getHoldedEstimate(deps: HoldedEstimateQueryDeps) {
  return async (installationId: string, id: string): Promise<HoldedEstimateDetail | null> => {
    const estimate = await deps.reader.get(id);
    if (!estimate) return null;
    const links = await linksFor(deps, installationId, [estimate.holdedEstimateId]);
    return { ...estimate, generatorQuote: links.get(estimate.holdedEstimateId) ?? null, dataNotice: HOLDED_ESTIMATES_DATA_NOTICE };
  };
}
