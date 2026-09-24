import {
  type HoldedContact,
  type HoldedContactListResponse,
  type HoldedContactMutationResult,
  type HoldedCreateContactInput,
  type HoldedHealthCode,
  type HoldedHealthResult,
  type HoldedUpdateContactInput,
} from "./contracts.js";
import { HoldedApiError, mapStatusToErrorCode } from "./errors.js";

type Fetch = typeof fetch;

const DEFAULT_BASE_URL = "https://api.holded.com/api/v2";
/** Base legacy v1, sólo para la exportación de presupuestos aún no migrada. */
const LEGACY_INVOICING_V1_BASE_URL = "https://api.holded.com/api/invoicing/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface HoldedLogEvent {
  method: string;
  /** Ruta lógica sin query (nunca incluye la API key ni cabeceras). */
  path: string;
  status: number | null;
  code?: string;
  ok: boolean;
  durationMs: number;
}

export interface HoldedClientOptions {
  apiKey: string;
  /** Permite apuntar a otro entorno o sandbox sin tocar el resto del código. */
  baseUrl?: string;
  fetch?: Fetch;
  timeoutMs?: number;
  /** Hook de observabilidad. Recibe metadatos seguros, jamás secretos. */
  logger?: (event: HoldedLogEvent) => void;
}

const INVALID_JSON = Symbol("invalid_json");

function parseJson(raw: string): unknown | typeof INVALID_JSON {
  try {
    return JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
}

function extractId(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  for (const key of ["id", "_id", "contactId"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

/**
 * Normaliza la respuesta de listados de Holded v2. El contrato canónico es
 * `{ items, cursor, has_more }`; se toleran, por compatibilidad defensiva, un
 * array directo o `{ data }`.
 */
function normalizeContactList(body: HoldedContactListResponse | unknown): HoldedContact[] {
  if (Array.isArray(body)) return body as HoldedContact[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as HoldedContact[];
    if (Array.isArray(record.data)) return record.data as HoldedContact[];
  }
  return [];
}

export function createHoldedClient(options: HoldedClientOptions) {
  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger;

  function log(event: HoldedLogEvent) {
    if (logger) {
      try { logger(event); } catch { /* la observabilidad nunca rompe la operación */ }
    }
  }

  /**
   * Única capa HTTP hacia Holded. Centraliza auth Bearer, cabeceras, timeout,
   * parseo JSON y traducción de errores. Nunca registra la API key.
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { baseUrl?: string; legacyKeyAuth?: boolean },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const hasBody = body !== undefined;
    const startedAt = Date.now();
    const pathForLog = path.split("?")[0] ?? path; // sin query (nunca secretos)
    let response: Response;
    try {
      response = await fetcher(`${opts?.baseUrl ?? baseUrl}${path}`, {
        method,
        headers: {
          // v2 usa Bearer; sólo la exportación legacy v1 usa la cabecera `key:`.
          ...(opts?.legacyKeyAuth ? { key: apiKey } : { authorization: `Bearer ${apiKey}` }),
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      log({ method, path: pathForLog, status: null, code, ok: false, durationMs: Date.now() - startedAt });
      throw new HoldedApiError(code);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    const parsed = raw ? parseJson(raw) : null;

    if (!response.ok) {
      const code = mapStatusToErrorCode(response.status);
      log({ method, path: pathForLog, status: response.status, code, ok: false, durationMs: Date.now() - startedAt });
      const errorBody = parsed === INVALID_JSON ? undefined : parsed;
      throw new HoldedApiError(code, response.status, errorBody);
    }
    if (parsed === INVALID_JSON) {
      log({ method, path: pathForLog, status: response.status, code: "invalid_response", ok: false, durationMs: Date.now() - startedAt });
      throw new HoldedApiError("invalid_response", response.status);
    }
    log({ method, path: pathForLog, status: response.status, ok: true, durationMs: Date.now() - startedAt });
    return (parsed ?? null) as T;
  }

  const client = {
    // v2 pagina por cursor (`cursor` + `has_more`), no por número de página.
    async listContacts(params: { cursor?: string } = {}): Promise<HoldedContact[]> {
      const search = new URLSearchParams();
      if (params.cursor) search.set("cursor", params.cursor);
      const suffix = search.toString() ? `?${search.toString()}` : "";
      return normalizeContactList(await request<HoldedContactListResponse>("GET", `/contacts${suffix}`));
    },

    /** Página cruda con cursor, por si se necesita paginar en el futuro. */
    async listContactsPage(params: { cursor?: string } = {}): Promise<HoldedContactListResponse> {
      const search = new URLSearchParams();
      if (params.cursor) search.set("cursor", params.cursor);
      const suffix = search.toString() ? `?${search.toString()}` : "";
      const body = await request<HoldedContactListResponse>("GET", `/contacts${suffix}`);
      return {
        items: normalizeContactList(body),
        cursor: (body as HoldedContactListResponse)?.cursor ?? null,
        has_more: Boolean((body as HoldedContactListResponse)?.has_more),
      };
    },

    async searchContacts(query: string): Promise<HoldedContact[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const search = new URLSearchParams({ name: trimmed });
      return normalizeContactList(
        await request<HoldedContactListResponse>("GET", `/contacts/search?${search.toString()}`),
      );
    },

    async getContact(contactId: string): Promise<HoldedContact> {
      const contact = await request<HoldedContact>("GET", `/contacts/${encodeURIComponent(contactId)}`);
      if (!contact || typeof contact !== "object" || !extractId({ id: contact.id })) {
        // Garantizamos que el snapshot tenga id estable.
        return { ...(contact as object), id: contactId } as HoldedContact;
      }
      return contact;
    },

    async createContact(input: HoldedCreateContactInput): Promise<HoldedContactMutationResult> {
      const raw = await request<unknown>("POST", "/contacts", input);
      const id = extractId(raw);
      if (!id) throw new HoldedApiError("invalid_response");
      return { id, raw };
    },

    /** PUT reemplazo completo: `body` debe ser el contacto ya fusionado. */
    async updateContact(contactId: string, body: HoldedUpdateContactInput): Promise<HoldedContactMutationResult> {
      const raw = await request<unknown>("PUT", `/contacts/${encodeURIComponent(contactId)}`, body);
      const id = extractId(raw) ?? contactId;
      return { id, raw };
    },

    async checkHealth(): Promise<HoldedHealthResult> {
      const checkedAt = new Date().toISOString();
      try {
        // Operación representativa: leer contactos v2 (lo que realmente usamos).
        await request<HoldedContactListResponse>("GET", "/contacts");
        return { status: "healthy", code: "ok", message: "Holded responde correctamente.", lastCheckedAt: checkedAt };
      } catch (error) {
        if (error instanceof HoldedApiError) {
          const map: Partial<Record<string, HoldedHealthCode>> = {
            unauthorized: "invalid_api_key",
            forbidden: "insufficient_permissions",
            rate_limited: "rate_limit",
            network_error: "network_error",
            timeout: "network_error",
          };
          const code = map[error.code] ?? "unexpected_error";
          const messages: Record<HoldedHealthCode, string> = {
            ok: "Holded responde correctamente.",
            invalid_api_key: "La clave de Holded no es válida.",
            insufficient_permissions: "La API key no tiene permisos suficientes para consultar contactos.",
            rate_limit: "Holded está limitando las peticiones.",
            network_error: "No se pudo contactar con Holded.",
            unexpected_error: "Holded respondió con un error inesperado.",
            not_configured: "Holded no está configurado.",
            unknown: "Estado de Holded desconocido.",
          };
          return { status: "unhealthy", code, message: messages[code], lastCheckedAt: checkedAt };
        }
        return {
          status: "unhealthy",
          code: "unexpected_error",
          message: "Holded respondió con un error inesperado.",
          lastCheckedAt: checkedAt,
        };
      }
    },

    /**
     * @deprecated Exportación de presupuestos aún sobre la API legacy v1
     * (`/api/invoicing/v1/documents/estimate`). Se migrará en la fase de
     * Estimates v2; queda aislada aquí y fuera del flujo de clientes.
     */
    async saveEstimate(input: LegacyEstimateInput) {
      const path = input.documentId
        ? `/documents/estimate/${encodeURIComponent(input.documentId)}`
        : "/documents/estimate";
      const payload = {
        desc: `${input.reference} · ${input.title}`,
        date: input.date,
        notes: input.notes,
        items: input.items,
        ...(!input.documentId
          ? {
              contactName: input.contactName,
              ...(input.contactCode ? { contactCode: input.contactCode } : {}),
              ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
              ...(input.contactAddress ? { contactAddress: input.contactAddress } : {}),
            }
          : {}),
      };
      const raw = await request<unknown>(
        input.documentId ? "PUT" : "POST",
        path,
        payload,
        { baseUrl: LEGACY_INVOICING_V1_BASE_URL, legacyKeyAuth: true },
      );
      if (input.documentId) return { id: input.documentId, response: raw };
      const id = extractId(raw);
      if (!id) throw new HoldedApiError("invalid_response");
      return { id, response: raw };
    },
  };

  return client;
}

export type HoldedClient = ReturnType<typeof createHoldedClient>;

// ---------------------------------------------------------------------------
// Tipos legacy de la exportación de presupuestos (pendiente de migrar a v2).
// ---------------------------------------------------------------------------
export interface LegacyEstimateItem {
  name: string;
  desc?: string;
  units: number;
  price: number;
  tax: number;
}

export interface LegacyEstimateInput {
  documentId?: string | null;
  reference: string;
  title: string;
  date: number;
  contactCode?: string;
  contactName: string;
  contactEmail?: string;
  contactAddress?: string;
  notes?: string;
  items: LegacyEstimateItem[];
}
